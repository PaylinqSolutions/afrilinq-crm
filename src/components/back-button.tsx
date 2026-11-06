"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

const KEY = "afq.nav.inApp";

/** Where "Back" goes when there is no earlier in-app page (opened from a link or a new tab): one level up. */
export function parentOf(path: string, home: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return home;
  const up = `/${parts.slice(0, -1).join("/")}`;
  // These folders only group detail pages; their list lives on the Training page.
  return NO_LIST_PAGE.has(up) ? `/${parts[0]}` : up;
}
const NO_LIST_PAGE = new Set(["/training/sessions", "/training/programs", "/training/participants"]);

/** Returns to the previous page in the app; falls back to the parent page so it never leaves the platform. */
export function BackButton({ home = "/", upOneLevel = true }: { home?: string; upOneLevel?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const landing = useRef(path);
  useEffect(() => {
    // Only a move to a different page counts as in-app history (safe when effects run twice in development).
    if (path !== landing.current) try { sessionStorage.setItem(KEY, "1"); } catch {}
  }, [path]);
  if (path === home) return null;
  const back = () => {
    let inApp = false;
    try { inApp = sessionStorage.getItem(KEY) === "1"; } catch {}
    if (inApp && window.history.length > 1) router.back();
    else router.push(upOneLevel ? parentOf(path, home) : home);
  };
  return (
    <button type="button" onClick={back} title="Back to the previous page (Alt+←)" aria-label="Back to the previous page"
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
      <ArrowLeft className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Back</span>
    </button>
  );
}
