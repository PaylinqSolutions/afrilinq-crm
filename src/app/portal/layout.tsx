import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <BackButton home="/portal/help" upOneLevel={false} />
          <img src="/brand/afrilinq-logo.png" alt="Afrilinq Technologies" className="h-10 w-auto" />
          <span className="border-l border-slate-200 pl-2 text-sm font-semibold text-brand-600">Support</span>
          <a href="/portal/help" className="ml-auto text-sm text-brand-700 underline">Help centre</a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
  );
}
