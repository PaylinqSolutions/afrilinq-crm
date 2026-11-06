import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { publicDocument } from "@/server/services/documents";
import { DocumentView } from "@/components/documents/document-view";
import { PrintButton } from "@/components/documents/print-button";
import { ClientDecision } from "@/components/documents/client-decision";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your document from Afrilinq", robots: { index: false, follow: false } };

/** What the client sees from the link we send: the document, a PDF download, and accept/sign or decline. */
export default async function PublicDocument({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await publicDocument(await getDb(), token);
  if (!data) notFound();
  const { d } = data;
  const open = d.type !== "invoice" && ["sent", "viewed"].includes(d.status) && !(d.type === "quote" && d.dueDate && d.dueDate < data.today);
  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4">
        <p className="text-sm text-slate-700">{d.type === "invoice" ? "Your invoice" : d.type === "quote" ? "Your quotation" : "Your service level agreement"} from {data.billing.legalName}</p>
        <PrintButton />
      </div>
      <DocumentView d={d} company={data.company} contact={data.contact} payments={data.payments} billing={data.billing} today={data.today} />
      <div className="no-print mx-auto mt-4 max-w-[210mm] px-4">
        {open && <ClientDecision token={token} type={d.type as "sla" | "quote"} contactName={data.contact ? `${data.contact.firstName} ${data.contact.lastName}` : ""} contactTitle={data.contact?.jobTitle ?? ""} companyName={data.company.name} />}
        {d.type !== "invoice" && !open && d.status !== "accepted" && d.status !== "declined" && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This document can no longer be accepted online. Please contact {data.billing.email}.</p>}
        {d.type !== "invoice" && <p className="mt-3 text-xs text-slate-500">Prefer to sign on paper? Download the PDF, sign it, and email the signed copy to {data.billing.email}.</p>}
        {d.type === "invoice" && <p className="text-xs text-slate-500">Card payments online aren&apos;t available yet. Please pay by bank transfer using the details above, quoting {d.number}. Questions: {data.billing.email}.</p>}
      </div>
    </div>
  );
}
