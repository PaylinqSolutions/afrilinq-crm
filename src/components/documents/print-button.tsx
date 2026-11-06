"use client";

import { Download, Printer } from "lucide-react";

/** Opens the browser's print dialog; choose “Save as PDF” to download. */
export function PrintButton({ label = "Download PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
      {label.includes("PDF") ? <Download className="h-4 w-4" aria-hidden /> : <Printer className="h-4 w-4" aria-hidden />}{label}
    </button>
  );
}
