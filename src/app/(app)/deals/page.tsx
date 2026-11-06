import { and, eq } from "drizzle-orm";
import { ctx, requirePerm } from "@/server/page";
import { can } from "@/server/actor";
import { getStages } from "@/server/services/sales";
import { workspaceDeals } from "@/server/services/deals-workspace";
import { usersInRoles } from "@/server/services/admin";
import { products, savedViews } from "@/db/schema";
import { LOSS_REASONS } from "@/lib/rules/sales";
import { todayIn } from "@/lib/format";
import { DealsWorkspace, type WDeal } from "@/components/deals/workspace";

export const metadata = { title: "Deals" };

export default async function DealsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; layout?: string; owner?: string; preview?: string }> }) {
  const { actor, db, tz, settings } = await ctx();
  requirePerm(actor, "deals.view_all", "deals.view_own");
  const sp = await searchParams;
  const [rows, stages, owners, ps, views] = await Promise.all([
    workspaceDeals(db, actor), getStages(db), usersInRoles(db, ["sales_executive", "sales_manager", "super_admin"]),
    db.select({ id: products.id, name: products.name }).from(products).where(eq(products.active, true)),
    db.select({ id: savedViews.id, name: savedViews.name, query: savedViews.query }).from(savedViews).where(and(eq(savedViews.userId, actor.id), eq(savedViews.entity, "deals-board"))),
  ]);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const deals: WDeal[] = rows.map((r) => ({
    id: r.id, name: r.name, amount: r.amount, currency: r.currency, stageId: r.stageId, ownerId: r.ownerId, ownerName: r.ownerName, companyId: r.companyId,
    companyName: r.companyName, segment: r.segment, expectedCloseDate: r.expectedCloseDate, closedAt: iso(r.closedAt), createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(), lastActivityAt: iso(r.lastActivityAt), stageEnteredAt: r.stageEnteredAt.toISOString(), billingFrequency: r.billingFrequency,
    nextStep: r.nextStep, nextStepDue: r.nextStepDue, discountStatus: r.discountStatus, probabilityOverride: r.probabilityOverride, forecastCategory: r.forecastCategory,
    primaryContactId: r.primaryContactId, contactName: r.contactName, contactPhone: r.contactPhone, contactEmail: r.contactEmail, productIds: r.productIds, nextActivityAt: r.nextActivityAt,
  }));
  // Owners list includes anyone who currently owns a visible deal, so filters never hide data.
  const userMap = new Map(owners.map((u) => [u.id, u.name]));
  for (const d of deals) if (!userMap.has(d.ownerId)) userMap.set(d.ownerId, d.ownerName);
  return (
    <DealsWorkspace deals={deals} views={views} products={ps} initial={sp}
      stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, isWon: s.isWon, isLost: s.isLost, staleAfterDays: s.staleAfterDays }))}
      users={[...userMap].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))}
      ctx={{
        me: { id: actor.id, name: actor.name }, today: todayIn(tz), currency: settings.currency, lossReasons: LOSS_REASONS,
        perms: { edit: can(actor, "deals.edit"), reassign: can(actor, "deals.reassign"), delete: can(actor, "data.delete"), export: can(actor, "data.export"), log: can(actor, "activities.log"), pipelines: can(actor, "admin.pipelines"), ticket: can(actor, "tickets.create") },
      }} />
  );
}
