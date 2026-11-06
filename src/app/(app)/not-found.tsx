import Link from "next/link";
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink-950">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">This record doesn’t exist or you don’t have permission to see it. Access is granted by role — ask an administrator if you need it.</p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-brand-700 underline">Back to dashboard</Link>
    </div>
  );
}
