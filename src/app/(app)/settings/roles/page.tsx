import { ctx, requirePerm } from "@/server/page";
import { listPermissions, rolesWithPermissions } from "@/server/services/admin";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Submit } from "@/components/forms";
import { setRolePermsAction } from "@/app/actions/admin";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const { actor, db } = await ctx();
  requirePerm(actor, "admin.roles");
  const roles = await rolesWithPermissions(db);
  const perms = await listPermissions(db);
  const cats = [...new Set(perms.map((p) => p.category))];
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Least privilege by default. Every check runs on the server; hiding a button is never the only control." />
      <div className="space-y-3">
        {roles.map((r) => (
          <Card key={r.id} title={`${r.name} (${r.permissions.length})`}>
            <p className="mb-2 text-sm text-slate-600">{r.description}</p>
            <Disclosure label="Edit permissions">
              <ActionForm action={setRolePermsAction.bind(null, r.id)} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2">{cats.map((c) => (
                  <fieldset key={c} className="rounded-lg border border-slate-200 p-2"><legend className="px-1 text-xs font-semibold uppercase text-slate-500">{c}</legend>
                    {perms.filter((p) => p.category === c).map((p) => <Checkbox key={p.key} name="perm" value={p.key} defaultChecked={r.permissions.includes(p.key)} label={<code className="text-xs">{p.key}</code>} hint={p.description} />)}
                  </fieldset>
                ))}</div>
                <Submit size="sm">Save {r.name}</Submit>
              </ActionForm>
            </Disclosure>
          </Card>
        ))}
      </div>
    </>
  );
}
