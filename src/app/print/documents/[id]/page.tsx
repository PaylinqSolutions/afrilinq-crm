import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireActor } from "@/server/session";
import { getDocument } from "@/server/services/documents";
import { DocumentView } from "@/components/documents/document-view";
import { PrintButton } from "@/components/documents/print-button";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { const actor = await requireActor(); const d = await getDocument(await getDb(), actor, id); return { title: `${d.d.number} — ${d.company.name}` }; } catch { return { title: "Document" }; }
}

/** Staff print view: A4, no app chrome. The browser's “Save as PDF” produces the downloadable file. */
export default async function PrintDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const data = await getDocument(await getDb(), actor, id).catch(() => null);
  if (!data) notFound();
  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4">
        <Link href={`/documents/${id}`} className="text-sm font-medium text-brand-700 hover:underline">← Back to {data.d.number}</Link>
        <div className="flex items-center gap-2 text-xs text-slate-600">In the print dialog choose <strong>Save as PDF</strong>.<PrintButton /></div>
      </div>
      <DocumentView d={data.d} company={data.company} contact={data.contact} payments={data.payments} billing={data.billing} today={data.today} />
    </div>
  );
}
