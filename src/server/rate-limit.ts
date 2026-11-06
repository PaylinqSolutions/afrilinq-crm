const buckets = new Map<string, { count: number; reset: number }>();

/** Fixed-window in-memory limiter. Per-instance only; put a shared limiter (e.g. at the edge) in front for multi-instance deployments. */
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  b.count++;
  if (buckets.size > 10000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return b.count <= limit;
}
