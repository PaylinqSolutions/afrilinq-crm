import { getDb } from "@/db";
import { findInvitation } from "@/server/auth-core";
import { ActionForm, Input, Submit } from "@/components/forms";
import { acceptInviteAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvitation(await getDb(), token);
  return (
    <div className="grid min-h-screen place-items-center bg-brand-900 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <img src="/brand/afrilinq-logo.png" alt="Afrilinq Technologies" className="mx-auto mb-5 w-56" />
        <h1 className="text-lg font-semibold text-ink-950">Join Afrilinq CRM</h1>
        {!inv ? (
          <p className="mt-3 text-sm text-slate-600">This invitation is invalid, expired or already used. Ask your administrator to send a new one.</p>
        ) : (
          <>
            <p className="mb-4 mt-1 text-sm text-slate-600">Set a password for <strong>{inv.email}</strong>.</p>
            <ActionForm action={acceptInviteAction.bind(null, token)} className="space-y-3" onSuccessRefresh={false}>
              <Input name="name" label="Full name" defaultValue={inv.name} required />
              <Input name="password" label="Password" type="password" autoComplete="new-password" required hint="At least 10 characters with letters and a number." />
              <Input name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
              <Submit className="w-full">Create account</Submit>
            </ActionForm>
          </>
        )}
      </div>
    </div>
  );
}
