import Link from "next/link";
import { ctx, load } from "@/server/page";
import { getArticle } from "@/server/services/kb";
import { usersInRoles } from "@/server/services/admin";
import { fmtDateTime, ticketRef } from "@/lib/format";
import { Badge, Card, KV, LinkButton, Markdown, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { ActionForm, Input, Select, Submit } from "@/components/forms";
import { articleFeedbackAction, articleWorkflowAction } from "@/app/actions/kb";

export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, db, tz } = await ctx();
  const d = await load(() => getArticle(db, actor, id));
  const { a } = d;
  const reviewers = await usersInRoles(db, ["support_lead", "super_admin"]);
  return (
    <>
      <PageHeader title={a.title} crumbs={[{ href: "/kb", label: "Knowledge base" }]} subtitle={a.summary}
        actions={<>{a.isSop && <Badge tone="violet">SOP</Badge>}{a.audience === "internal" ? <Badge tone="amber">Internal only</Badge> : <Badge tone="green">Customer-visible</Badge>}<StatusBadge status={a.status} />{d.canEdit && <LinkButton size="sm" variant="secondary" href={`/kb/${id}/edit`}>Edit</LinkButton>}</>} />
      {a.reviewComment && a.status === "draft" && <Notice tone="amber" title="Reviewer feedback">{a.reviewComment}</Notice>}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><Markdown text={a.body} />
          {a.status === "published" && (
            <ActionForm action={articleFeedbackAction.bind(null, id)} className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3" onSuccessRefresh={false}>
              <span className="text-sm text-slate-600">Was this helpful?</span><Submit size="sm" variant="secondary" name="helpful" value="yes">Yes</Submit><Submit size="sm" variant="secondary" name="helpful" value="no">No</Submit>
            </ActionForm>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Details"><KV items={[["Category", a.category], ["Product", d.product?.name ?? "All"], ["Tags", a.tags.join(", ")], ["Version", `v${a.version}`], ["Author", d.author], ["Owner", d.owner], ["Reviewer", d.reviewer], ["Updated", fmtDateTime(a.updatedAt, tz)], ["Published", fmtDateTime(a.publishedAt, tz)], ["Feedback", `👍 ${a.helpfulCount} · 👎 ${a.notHelpfulCount}`]]} /></Card>
          {(d.canSubmit || d.canReview || d.canArchive) && (
            <Card title="Review workflow">
              <p className="mb-2 text-xs text-slate-500">Draft → In Review → Published → Archived</p>
              {d.canSubmit && <ActionForm action={articleWorkflowAction.bind(null, id)} className="space-y-2"><input type="hidden" name="step" value="submit" /><Select name="reviewerId" label="Reviewer" placeholder="Any publisher" options={reviewers.map((r) => ({ value: r.id, label: r.name }))} /><Submit size="sm">Submit for review</Submit></ActionForm>}
              {d.canReview && <ActionForm action={articleWorkflowAction.bind(null, id)} className="space-y-2"><Input name="comment" label="Comment (required to return)" /><div className="flex gap-2"><Submit size="sm" name="step" value="publish">Publish</Submit><Submit size="sm" variant="secondary" name="step" value="return">Return to author</Submit></div></ActionForm>}
              {d.canArchive && <ActionForm action={articleWorkflowAction.bind(null, id)} className="mt-2"><Submit size="sm" variant="secondary" name="step" value="archive">Archive</Submit></ActionForm>}
            </Card>
          )}
          {d.linked.length > 0 && <Card title="Linked tickets"><ul className="space-y-1 text-sm">{d.linked.map((t) => <li key={t.id}><Link className="hover:underline" href={`/tickets/${t.id}`}>{ticketRef(t.number)} {t.subject}</Link></li>)}</ul></Card>}
        </div>
      </div>
    </>
  );
}
