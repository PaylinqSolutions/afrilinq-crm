import type { z } from "zod";
import { invalid } from "./errors";

export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = String(issue.path[0] ?? "form");
    fieldErrors[k] ??= issue.message;
  }
  throw invalid("Please correct the highlighted fields.", fieldErrors);
}
