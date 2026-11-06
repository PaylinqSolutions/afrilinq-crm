import { redirect } from "next/navigation";
import { getActor } from "@/server/session";
import { ActionForm, Input, Submit } from "@/components/forms";
import { loginAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getActor()) redirect("/");
  const { next } = await searchParams;
  const demo = process.env.NODE_ENV !== "production" && (process.env.AUTO_SEED ?? "true") !== "false";
  return (
    <div className="grid min-h-screen place-items-center bg-brand-900 px-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <img src="/brand/afrilinq-logo.png" alt="Afrilinq Technologies — empowering businesses through technology" className="mx-auto mb-5 w-64" />
          <h1 className="mb-4 text-lg font-semibold text-ink-950">Sign in</h1>
          <ActionForm action={loginAction} className="space-y-3" onSuccessRefresh={false}>
            <input type="hidden" name="next" value={next ?? "/"} />
            <Input name="email" label="Work email" type="email" autoComplete="email" required />
            <Input name="password" label="Password" type="password" autoComplete="current-password" required />
            <Submit className="w-full">Sign in</Submit>
          </ActionForm>
          <p className="mt-4 text-xs text-slate-500">New team members join through an invitation link from an administrator.</p>
        </div>
        {demo && (
          <div className="mt-4 rounded-xl border border-accent-500/40 bg-brand-800/70 p-4 text-xs text-brand-100">
            <p className="font-semibold text-white">Demo mode — fictional data</p>
            <p className="mt-1">Sign in as <code>owner@</code> (full access), or e.g. <code>admin@</code>, <code>cco@</code>, <code>sales.manager@</code>, <code>emeka@</code>, <code>onboarding@</code>, <code>trainer@</code>, <code>support@</code>, <code>support.lead@</code>, <code>engineering@</code> or <code>finance@afrilinq.demo</code>. The demo password is in the README.</p>
          </div>
        )}
      </div>
    </div>
  );
}
