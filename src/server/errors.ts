export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    public code: "forbidden" | "validation" | "not_found" | "conflict" | "rate_limited" | "stale",
    message: string,
    public fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}

export const forbidden = (msg = "You do not have permission to do that.") => new AppError("forbidden", msg);
export const notFound = (what = "Record") => new AppError("not_found", `${what} not found or you do not have access to it.`);
export const invalid = (msg: string, fieldErrors?: FieldErrors) => new AppError("validation", msg, fieldErrors);
export const conflict = (msg: string) => new AppError("conflict", msg);
