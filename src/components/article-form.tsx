import type { knowledgeArticles } from "@/db/schema";
import { KB_CATEGORIES } from "@/server/services/kb";
import { Checkbox, Grid, Input, Select, Submit, Textarea } from "./forms";

export function ArticleFields({ a, products }: { a?: typeof knowledgeArticles.$inferSelect; products: { id: string; name: string }[] }) {
  return (
    <div className="space-y-3">
      <Input name="title" label="Title" defaultValue={a?.title} required />
      <Input name="summary" label="Summary" defaultValue={a?.summary ?? ""} />
      <Grid cols={3}>
        <Select name="category" label="Category" defaultValue={a?.category ?? ""} required placeholder="Choose…" options={KB_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <Select name="audience" label="Audience" defaultValue={a?.audience ?? "internal"} options={[{ value: "internal", label: "Internal only (runbooks, SOPs)" }, { value: "customer", label: "Customer-visible" }]} />
        <Select name="productId" label="Product" defaultValue={a?.productId ?? ""} placeholder="All products" options={products.map((p) => ({ value: p.id, label: p.name }))} />
      </Grid>
      <Input name="tags" label="Tags (comma-separated)" defaultValue={a?.tags.join(", ") ?? ""} />
      <Textarea name="body" label="Body" defaultValue={a?.body ?? ""} rows={14} required hint="Supports ## headings, - bullets, 1. numbered lists, **bold** and [links](https://…). HTML is not rendered." />
      <Checkbox name="isSop" label="Standard operating procedure / playbook" defaultChecked={a?.isSop} />
      <Submit>{a ? "Save article" : "Save draft"}</Submit>
    </div>
  );
}
