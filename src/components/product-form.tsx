import type { products } from "@/db/schema";
import { PRODUCT_CATEGORIES } from "@/server/services/products";
import { Grid, Input, Select, Submit, Textarea } from "./forms";

export function ProductFields({ p, users, currencies }: { p?: typeof products.$inferSelect; users: { id: string; name: string }[]; currencies: string[] }) {
  return (
    <div className="space-y-4">
      <Grid cols={3}>
        <Input name="code" label="Product code" defaultValue={p?.code} required placeholder="AFQ-PAY" hint="Short unique code, shown on deals and quotes." />
        <Input name="name" label="Name" defaultValue={p?.name} required className="sm:col-span-2" />
        <Select name="kind" label="Type" defaultValue={p?.kind ?? "product"} options={[{ value: "product", label: "Product (software / licence)" }, { value: "service", label: "Service (implementation, training…)" }]} />
        <Select name="category" label="Category" defaultValue={p?.category ?? ""} placeholder="—" options={PRODUCT_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <Select name="managerId" label="Product manager" defaultValue={p?.managerId ?? ""} placeholder="—" options={users.map((u) => ({ value: u.id, label: u.name }))} hint="Go-to person staff ask about this product." />
        <Input name="listPrice" label="List price" inputMode="decimal" defaultValue={p?.listPrice ?? ""} hint="Default unit price when added to a deal." />
        <Select name="currency" label="Currency" defaultValue={p?.currency ?? currencies[0]} options={currencies.map((c) => ({ value: c, label: c }))} />
        <Select name="billingFrequency" label="Billing" defaultValue={p?.billingFrequency ?? ""} placeholder="—" options={["One-off", "Monthly", "Quarterly", "Annually", "Multi-year"].map((b) => ({ value: b, label: b }))} />
        <Input name="unit" label="Unit" defaultValue={p?.unit ?? ""} placeholder="per company / year" />
      </Grid>
      <Textarea name="description" label="Description" defaultValue={p?.description ?? ""} rows={4} hint="What it does, who it's for, key selling points. Staff see this on deals." />
      <Submit>{p ? "Save product" : "Add product"}</Submit>
    </div>
  );
}
