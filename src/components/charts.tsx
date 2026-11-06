"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Single-series magnitude charts: one validated hue, recessive grid, rounded data-ends, hover tooltip.
const MARK = "#00908f"; // brand teal, one step brighter so it clears the chart chroma floor
const SYM: Record<string, string> = { NGN: "₦", USD: "$", GHS: "GH₵", KES: "KSh " };
export const compact = (n: number, currency?: string) => {
  const [d, u] = Math.abs(n) >= 1e9 ? [1e9, "B"] : Math.abs(n) >= 1e6 ? [1e6, "M"] : Math.abs(n) >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${currency ? SYM[currency] ?? `${currency} ` : ""}${(n / d).toFixed(1).replace(/\.0$/, "")}${u}`;
};

export function ColumnChart({ data, currency, label }: { data: { name: string; value: number }[]; currency?: string; label: string }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-slate-500">No data for this period.</p>;
  return (
    <div className="h-64 w-full" role="img" aria-label={`${label}: ${data.map((d) => `${d.name} ${compact(d.value, currency)}`).join("; ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap={6}>
          <CartesianGrid vertical={false} stroke="#e8ebef" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5b6673" }} tickLine={false} axisLine={{ stroke: "#cfd5dc" }} interval={0} angle={data.length > 5 ? -25 : 0} textAnchor={data.length > 5 ? "end" : "middle"} height={data.length > 5 ? 60 : 30} />
          <YAxis tick={{ fontSize: 11, fill: "#5b6673" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => compact(v, currency)} width={56} />
          <Tooltip cursor={{ fill: "#00908f14" }} formatter={(v) => [compact(Number(v), currency), label]} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
          <Bar dataKey="value" fill={MARK} radius={[4, 4, 0, 0]} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal bar list with direct value labels: readable on phones and needs no legend. */
export function BarList({ data, currency }: { data: { name: string; value: number; href?: string }[]; currency?: string }) {
  if (!data.length) return <p className="py-6 text-center text-sm text-slate-500">No data for this period.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.name} title={`${d.name}: ${compact(d.value, currency)}`}>
          <div className="mb-0.5 flex justify-between gap-2 text-xs"><span className="truncate text-slate-700">{d.href ? <a className="hover:underline" href={d.href}>{d.name}</a> : d.name}</span><span className="tabular-nums text-slate-900">{currency ? compact(d.value, currency) : d.value}</span></div>
          <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: MARK }} /></div>
        </li>
      ))}
    </ul>
  );
}
