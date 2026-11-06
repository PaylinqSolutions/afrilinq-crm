import Link from "next/link";
export default function Forbidden() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink-950">You don’t have access to this area</h1>
      <p className="mt-2 text-sm text-slate-600">Access is granted by role and checked on the server. Ask an administrator if your role should include it.</p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700 underline">Back to dashboard</Link>
    </div>
  );
}
