import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ctx } from "@/server/page";
import { notifications } from "@/db/schema";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionForm, Submit } from "@/components/forms";
import { markNotificationsReadAction } from "@/app/actions/crm";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const { actor, db, tz } = await ctx();
  const rows = await db.select().from(notifications).where(eq(notifications.userId, actor.id)).orderBy(desc(notifications.createdAt)).limit(200);
  const unread = rows.filter((r) => !r.readAt).length;
  return (
    <>
      <PageHeader title="Notifications" subtitle={`${unread} unread. In-app notifications are always on; email/SMS/WhatsApp delivery needs a configured provider.`}
        actions={unread > 0 ? <ActionForm action={markNotificationsReadAction}><Submit variant="secondary">Mark all as read</Submit></ActionForm> : undefined} />
      <Card pad={false}>
        {rows.length === 0 ? <div className="p-4"><EmptyState title="No notifications yet" /></div> : (
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => (
              <li key={n.id} className={`flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center ${n.readAt ? "" : "bg-brand-50/50"}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">{!n.readAt && <Badge tone="brand">New</Badge>}<Badge>{n.kind}</Badge>
                    {n.link ? <Link href={n.link} className="text-sm font-medium text-slate-900 hover:underline">{n.title}</Link> : <span className="text-sm font-medium">{n.title}</span>}</div>
                  {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
                  <p className="text-xs text-slate-500">{fmtDateTime(n.createdAt, tz)}</p>
                </div>
                {!n.readAt && <ActionForm action={markNotificationsReadAction}><input type="hidden" name="id" value={n.id} /><Submit size="sm" variant="ghost">Mark read</Submit></ActionForm>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
