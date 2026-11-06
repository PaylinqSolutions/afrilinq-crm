import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { integrations, outboundMessages } from "@/db/schema";
import { type Actor, actorRef, assertCan } from "../actor";
import { audit } from "../audit";
import { invalid } from "../errors";

/**
 * Integration boundary. Credentials are read from server environment variables only and are never stored
 * in the database or sent to the browser. An integration is shown as "Connected" only after a provider
 * adapter exists for the configured provider AND a test call has succeeded.
 *
 * To add a provider: implement `Adapter` and register it in ADAPTERS under `${kind}:${provider}`.
 */
export type OutboundMessage = { to: string; subject?: string | null; body: string };
export interface Adapter {
  test(): Promise<void>;
  send(msg: OutboundMessage): Promise<{ providerMessageId?: string }>;
}

const ADAPTERS: Record<string, (env: NodeJS.ProcessEnv) => Adapter> = {
  // Example registration (not shipped — requires a provider contract and credentials):
  // "email:postmark": (env) => new PostmarkAdapter(env.EMAIL_API_KEY!, env.EMAIL_FROM!),
};

export const INTEGRATION_KINDS = [
  { kind: "email", label: "Email", env: ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM"], use: "Customer replies, reminders, CSAT requests" },
  { kind: "sms", label: "SMS", env: ["SMS_PROVIDER", "SMS_API_KEY"], use: "Training and appointment reminders" },
  { kind: "whatsapp", label: "WhatsApp Business", env: ["WHATSAPP_PROVIDER", "WHATSAPP_API_KEY", "WHATSAPP_PHONE_ID"], use: "Sales follow-ups, support updates" },
  { kind: "calendar", label: "Calendar", env: ["CALENDAR_PROVIDER", "CALENDAR_API_KEY"], use: "Meeting and training invites" },
  { kind: "telephony", label: "Telephony", env: ["TELEPHONY_PROVIDER", "TELEPHONY_API_KEY"], use: "Click-to-call and call logging" },
  { kind: "issue_tracker", label: "Engineering issue tracker", env: ["ISSUE_TRACKER_PROVIDER", "ISSUE_TRACKER_API_KEY", "ISSUE_TRACKER_BASE_URL"], use: "Push engineering escalations" },
] as const;

function envStatus(kind: string) {
  const def = INTEGRATION_KINDS.find((k) => k.kind === kind)!;
  const missing = def.env.filter((e) => !process.env[e]);
  const provider = process.env[def.env[0]] || null;
  return { def, missing, provider, adapter: provider ? ADAPTERS[`${kind}:${provider}`] : undefined };
}

export async function listIntegrations(db: DB) {
  const rows = await db.select().from(integrations);
  return INTEGRATION_KINDS.map((k) => {
    const env = envStatus(k.kind);
    const row = rows.find((r) => r.kind === k.kind);
    let status = row?.status ?? "not_configured";
    // Environment is the source of truth: removing credentials always drops back to "Not configured".
    if (env.missing.length) status = "not_configured";
    else if (status === "not_configured") status = "configured";
    return { ...k, status, provider: env.provider, missingEnv: env.missing, hasAdapter: !!env.adapter, lastTestAt: row?.lastTestAt ?? null, lastTestResult: row?.lastTestResult ?? null };
  });
}

export async function integrationStatus(db: DB, kind: string) {
  return (await listIntegrations(db)).find((i) => i.kind === kind)?.status ?? "not_configured";
}

export async function testIntegration(db: DB, actor: Actor, kind: string) {
  assertCan(actor, "admin.integrations");
  const env = envStatus(kind);
  let status = "error";
  let result: string;
  if (env.missing.length) { status = "not_configured"; result = `Missing environment variables: ${env.missing.join(", ")}`; }
  else if (!env.adapter) result = `No adapter is implemented for provider “${env.provider}”. Register one in src/server/services/integrations.ts.`;
  else {
    try { await env.adapter(process.env).test(); status = "connected"; result = "Test succeeded"; }
    catch (e) { result = `Test failed: ${(e as Error).message}`.replace(/(key|token|secret)=\S+/gi, "$1=[redacted]").slice(0, 300); }
  }
  await db.insert(integrations).values({ kind, status, provider: env.provider, lastTestAt: new Date(), lastTestResult: result })
    .onConflictDoUpdate({ target: integrations.kind, set: { status, provider: env.provider, lastTestAt: new Date(), lastTestResult: result, updatedAt: new Date() } });
  await audit(db, actor, "integration.tested", "integration", kind, { status: { from: null, to: status } }, result);
  return { status, result };
}

/**
 * Sends through a connected adapter, or — only with explicit confirmation — records a clearly labelled
 * simulated message. Never reports a simulated message as delivered.
 */
export async function sendViaAdapter(
  db: DB, actor: Actor,
  m: { channel: string; to: string; subject?: string | null; body: string; relatedType?: string; relatedId?: string | null; confirmSimulated: boolean },
) {
  const status = await integrationStatus(db, m.channel);
  const env = envStatus(m.channel);
  if (status === "connected" && env.adapter) {
    try {
      await env.adapter(process.env).send({ to: m.to, subject: m.subject, body: m.body });
      await db.insert(outboundMessages).values({ ...m, recipient: m.to, status: "sent", provider: env.provider, createdBy: actorRef(actor) });
      return { status: "sent" as const };
    } catch (e) {
      const err = (e as Error).message.slice(0, 300);
      await db.insert(outboundMessages).values({ ...m, recipient: m.to, status: "failed", provider: env.provider, error: err, createdBy: actorRef(actor) });
      throw invalid(`Delivery failed via ${env.provider}: ${err}`);
    }
  }
  if (!m.confirmSimulated) {
    throw invalid(`${m.channel === "whatsapp" ? "WhatsApp" : m.channel === "email" ? "Email" : m.channel} is not configured, so nothing can be delivered. Tick “Simulate (demo mode)” to record a simulated message instead.`,
      { confirmSimulated: "Confirm simulation" });
  }
  await db.insert(outboundMessages).values({ channel: m.channel, recipient: m.to, subject: m.subject, body: m.body, status: "simulated", relatedType: m.relatedType, relatedId: m.relatedId ?? null, createdBy: actorRef(actor) });
  return { status: "simulated" as const };
}

export async function recordSystemMessage(db: DB, m: { channel: string; to: string; subject?: string; body: string; relatedType?: string; relatedId?: string }) {
  // Automated messages (acknowledgements, CSAT requests). Delivered only when connected; otherwise logged as simulated.
  const status = await integrationStatus(db, m.channel);
  const env = envStatus(m.channel);
  if (status === "connected" && env.adapter) {
    try {
      await env.adapter(process.env).send({ to: m.to, subject: m.subject, body: m.body });
      await db.insert(outboundMessages).values({ ...m, recipient: m.to, status: "sent", provider: env.provider });
      return "sent";
    } catch (e) {
      await db.insert(outboundMessages).values({ ...m, recipient: m.to, status: "failed", provider: env.provider, error: (e as Error).message.slice(0, 300) });
      return "failed";
    }
  }
  await db.insert(outboundMessages).values({ ...m, recipient: m.to, status: "simulated" });
  return "simulated";
}
