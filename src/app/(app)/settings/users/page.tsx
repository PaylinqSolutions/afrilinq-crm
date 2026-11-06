import { ctx, requirePerm } from "@/server/page";
import { listInvitations, listTeams, listUsersWithRoles, rolesWithPermissions } from "@/server/services/admin";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { ActionForm, Checkbox, Disclosure, Grid, Input, Select, Submit } from "@/components/forms";
import { createTeamAction, inviteAction, revokeInviteAction, setUserRolesAction } from "@/app/actions/admin";

export const metadata = { title: "Users & teams" };

export default async function UsersPage() {
  const { actor, db, tz } = await ctx();
  requirePerm(actor, "admin.users");
  const users = await listUsersWithRoles(db);
  const roles = await rolesWithPermissions(db);
  const teams = await listTeams(db);
  const invites = await listInvitations(db);
  return (
    <>
      <PageHeader title="Users & teams" subtitle="Team members join by invitation. Role changes are enforced server-side and audit-logged." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Invite a team member">
          <ActionForm action={inviteAction} resetOnSuccess className="space-y-2">
            <Grid><Input name="name" label="Full name" required /><Input name="email" label="Work email" type="email" required />
              <Select name="roleId" label="Role" required placeholder="Choose…" options={roles.map((r) => ({ value: r.id, label: r.name }))} /><Select name="teamId" label="Team" placeholder="—" options={teams.map((t) => ({ value: t.id, label: t.name }))} /></Grid>
            <Submit size="sm">Create invitation</Submit>
          </ActionForm>
          {invites.length > 0 && <ul className="mt-3 space-y-1 text-sm">{invites.map(({ i, role }) => <li key={i.id} className="flex flex-wrap items-center gap-2">{i.email} <Badge>{role}</Badge><span className="text-xs text-slate-500">expires {fmtDateTime(i.expiresAt, tz)}</span><ActionForm action={revokeInviteAction.bind(null, i.id)}><Submit size="sm" variant="ghost">Revoke</Submit></ActionForm></li>)}</ul>}
        </Card>
        <Card title="Teams">
          <ul className="mb-3 flex flex-wrap gap-1">{teams.map((t) => <li key={t.id}><Badge>{t.name} · {t.kind}</Badge></li>)}</ul>
          <ActionForm action={createTeamAction} resetOnSuccess className="flex flex-wrap items-end gap-2"><Input name="name" label="New team" /><Select name="kind" label="Kind" options={["sales", "onboarding", "training", "support", "engineering", "finance", "management"].map((k) => ({ value: k, label: k }))} /><Submit size="sm" variant="secondary">Add</Submit></ActionForm>
        </Card>
      </div>
      <Card title={`Users (${users.length})`} pad={false} className="mt-4">
        <Table head={["User", "Team", "Roles", "Last sign-in", ""]}>
          {users.map((u) => (
            <tr key={u.id}>
              <Td><p className="font-medium">{u.name}{!u.active && <Badge tone="gray">Inactive</Badge>}</p><p className="text-xs text-slate-500">{u.email} · {u.title}</p></Td>
              <Td>{u.team ?? "—"}</Td><Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.roleId} tone="brand">{r.name}</Badge>)}</div></Td>
              <Td className="text-xs">{fmtDateTime(u.lastLoginAt, tz)}</Td>
              <Td><Disclosure label="Edit" variant="ghost">
                <ActionForm action={setUserRolesAction.bind(null, u.id)} className="w-72 space-y-2">
                  <fieldset><legend className="text-xs font-semibold text-slate-600">Roles</legend>{roles.map((r) => <Checkbox key={r.id} name="roleIds" value={r.id} label={r.name} defaultChecked={u.roles.some((x) => x.roleId === r.id)} />)}</fieldset>
                  <Select name="teamId" label="Team" defaultValue={u.teamId ?? ""} placeholder="—" options={teams.map((t) => ({ value: t.id, label: t.name }))} />
                  <Select name="managerId" label="Manager" defaultValue={u.managerId ?? ""} placeholder="—" options={users.filter((x) => x.id !== u.id).map((x) => ({ value: x.id, label: x.name }))} />
                  <Input name="title" label="Title" defaultValue={u.title ?? ""} />
                  <Checkbox name="active" label="Active" defaultChecked={u.active} />
                  <Submit size="sm">Save</Submit>
                </ActionForm>
              </Disclosure></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
