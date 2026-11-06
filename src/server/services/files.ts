import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { files, ticketAttachments } from "@/db/schema";
import { type Actor, assertCan, can } from "../actor";
import { audit } from "../audit";
import { forbidden, invalid, notFound } from "../errors";
import { getCompany, getContact } from "./accounts";
import { getTicket } from "./tickets";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED: Record<string, string[]> = {
  "application/pdf": [".pdf"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"], "text/csv": [".csv"], "text/plain": [".txt"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 4).toString() === "%PDF",
  "image/png": (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === "PNG",
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => b[0] === 0x50 && b[1] === 0x4b,
};

const root = () => path.resolve(process.env.STORAGE_DIR || "./storage");

/** Validates type (extension, declared MIME and file signature) and size; stores under a random key outside any public path. */
async function store(file: File) {
  if (!file || typeof file === "string" || file.size === 0) throw invalid("Choose a file.", { file: "Required." });
  if (file.size > MAX_UPLOAD_BYTES) throw invalid("Files must be 10 MB or smaller.", { file: "Too large." });
  const ext = path.extname(file.name).toLowerCase();
  const allowedExt = ALLOWED[file.type];
  if (!allowedExt || !allowedExt.includes(ext)) throw invalid("Allowed types: PDF, PNG, JPG, DOCX, XLSX, CSV, TXT.", { file: "Unsupported file type." });
  const buf = Buffer.from(await file.arrayBuffer());
  if (MAGIC[file.type] && !MAGIC[file.type](buf)) throw invalid("The file content does not match its type.", { file: "Content mismatch." });
  const key = `${crypto.randomUUID()}${ext}`;
  await fs.mkdir(root(), { recursive: true });
  await fs.writeFile(path.join(root(), key), buf, { mode: 0o600 });
  const safeName = path.basename(file.name).replace(/[^\w.\- ()]/g, "_").slice(0, 150);
  return { key, safeName, size: file.size, mime: file.type };
}

export async function uploadCompanyFile(db: DB, actor: Actor, companyId: string, file: File, restricted: boolean) {
  assertCan(actor, "accounts.edit");
  await getCompany(db, actor, companyId);
  if (restricted && !can(actor, "finance.view", "handover.review", "admin.settings")) throw forbidden("You cannot upload restricted files.");
  const s = await store(file);
  const [row] = await db.insert(files).values({ entityType: "company", entityId: companyId, companyId, filename: s.safeName, mimeType: s.mime, sizeBytes: s.size, storageKey: s.key, restricted, uploadedBy: actor.id }).returning();
  await audit(db, actor, "file.uploaded", "company", companyId, null, `${s.safeName}${restricted ? " (restricted)" : ""}`);
  return row;
}

export async function uploadContactFile(db: DB, actor: Actor, contactId: string, file: File) {
  assertCan(actor, "accounts.edit");
  const { c } = await getContact(db, actor, contactId);
  const s = await store(file);
  const [row] = await db.insert(files).values({ entityType: "contact", entityId: contactId, companyId: c.companyId, filename: s.safeName, mimeType: s.mime, sizeBytes: s.size, storageKey: s.key, restricted: false, uploadedBy: actor.id }).returning();
  await audit(db, actor, "file.uploaded", "contact", contactId, null, s.safeName);
  return row;
}

/** A signed agreement or quote returned by the client: stored on the customer's company record. */
export async function storeDocumentFile(db: DB, actor: Actor, companyId: string, documentId: string, file: File, label: string) {
  const s = await store(file);
  const ext = s.safeName.includes(".") ? s.safeName.slice(s.safeName.lastIndexOf(".")) : "";
  const [row] = await db.insert(files).values({ entityType: "document", entityId: documentId, companyId, filename: `${label}${ext}`.replace(/[^\w.\- ()]/g, "_"), mimeType: s.mime, sizeBytes: s.size, storageKey: s.key, restricted: false, uploadedBy: actor.id }).returning();
  await audit(db, actor, "file.uploaded", "company", companyId, null, row.filename);
  return row;
}

export async function uploadTicketAttachment(db: DB, actor: Actor, ticketId: string, file: File, visibility: "internal" | "public") {
  assertCan(actor, "tickets.edit", "engineering.update");
  await getTicket(db, actor, ticketId);
  const s = await store(file);
  await db.insert(ticketAttachments).values({ ticketId, filename: s.safeName, mimeType: s.mime, sizeBytes: s.size, storageKey: s.key, visibility, uploadedBy: actor.id });
}

/** Resolves a download with full access checks. Returns the bytes; the storage path is never exposed. */
export async function readFileForActor(db: DB, actor: Actor, kind: "file" | "attachment", id: string) {
  if (kind === "file") {
    const [f] = await db.select().from(files).where(eq(files.id, id));
    if (!f) throw notFound("File");
    if (f.entityType === "contact") await getContact(db, actor, f.entityId);
    else if (f.companyId) await getCompany(db, actor, f.companyId);
    if (f.restricted && !can(actor, "finance.view", "handover.review", "admin.settings")) throw forbidden();
    return { name: f.filename, mime: f.mimeType, data: await fs.readFile(path.join(root(), path.basename(f.storageKey))) };
  }
  const [a] = await db.select().from(ticketAttachments).where(eq(ticketAttachments.id, id));
  if (!a) throw notFound("Attachment");
  await getTicket(db, actor, a.ticketId);
  if (a.visibility === "internal" && !can(actor, "tickets.notes")) throw forbidden();
  return { name: a.filename, mime: a.mimeType, data: await fs.readFile(path.join(root(), path.basename(a.storageKey))) };
}
