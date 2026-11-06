import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getPortalTicket } from "@/server/services/tickets";
import { fmtDateTime, ticketRef } from "@/lib/format";
import { getSettings } from "@/server/settings";
import { ActionForm, Input, Select, Submit, Textarea } from "@/components/forms";
import { portalConfirmAction, portalCsatAction, portalReplyAction } from "@/app/actions/tickets";

export const metadata = { title: "Your support request", robots: { index: false } };

/**
 * Customer-facing ticket view. Data comes only from getPortalTicket(), which reads customer-safe ticket
 * columns and the public ticket_messages table — internal notes are never queried.
 */
export default async function PortalTicket({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const v = await getPortalTicket(db, token);
  if (!v) notFound();
  const { timezone: tz } = await getSettings(db);
  const t = v.ticket;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">{ticketRef(t.number)} · {t.companyName}</p>
        <h1 className="text-lg font-semibold text-ink-950">{t.subject}</h1>
        <p className="mt-1 text-sm">Status: <strong>{t.statusLabel}</strong> · Priority {t.priority} · Opened {fmtDateTime(t.createdAt, tz)}</p>
      </div>
      {t.status === "resolved" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-medium text-emerald-900">We believe this is resolved</p>
          {t.resolutionSummary && <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">{t.resolutionSummary}</p>}
          <ActionForm action={portalConfirmAction.bind(null, token)} className="mt-3 space-y-2">
            <Textarea name="reason" label="If the issue persists, tell us what's still happening" rows={2} />
            <div className="flex flex-wrap gap-2"><Submit name="choice" value="confirm">Yes, it's resolved</Submit><Submit name="choice" value="reopen" variant="secondary">No, it's still happening</Submit></div>
          </ActionForm>
        </div>
      )}
      {["resolved", "closed"].includes(t.status) && !t.csatScore && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="font-medium">How did we do?</p>
          <ActionForm action={portalCsatAction.bind(null, token)} className="mt-2 space-y-2">
            <Select name="score" label="Rating" required options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${n} — ${["", "Very poor", "Poor", "Okay", "Good", "Excellent"][n]}` }))} />
            <Input name="comment" label="Comment (optional)" />
            <Submit size="sm">Send feedback</Submit>
          </ActionForm>
        </div>
      )}
      <ol className="space-y-3">
        {v.messages.map((m) => (
          <li key={m.id} className={`rounded-xl border p-3 ${m.fromCustomer ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}>
            <p className="mb-1 text-xs text-slate-500"><span className="font-medium text-slate-800">{m.fromCustomer ? "You" : m.authorName}</span> · {fmtDateTime(m.createdAt, tz)}</p>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </li>
        ))}
      </ol>
      {v.attachments.length > 0 && <p className="text-sm">Shared files: {v.attachments.map((a) => a.filename).join(", ")} (ask your support contact for a copy)</p>}
      {t.status !== "closed" && (
        <ActionForm action={portalReplyAction.bind(null, token)} resetOnSuccess className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <Textarea name="body" label="Add a message" rows={3} required />
          <Submit>Send</Submit>
        </ActionForm>
      )}
      <p className="text-center text-xs text-slate-500">Keep this link private — anyone with it can view this ticket's public conversation.</p>
    </div>
  );
}
