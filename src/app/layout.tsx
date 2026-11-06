import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Afrilinq CRM", template: "%s · Afrilinq CRM" }, description: "Customer operations platform for Afrilinq Technologies" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#002366" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-NG"><body className="antialiased">{children}</body></html>;
}
