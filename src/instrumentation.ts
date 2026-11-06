/** Runs SLA and automation sweeps in-process (set SWEEP_INTERVAL_SECONDS=0 and use /api/cron/sweep instead on serverless hosts). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const every = Number(process.env.SWEEP_INTERVAL_SECONDS ?? 60);
  if (!every) return;
  const g = globalThis as unknown as { __afqSweep?: NodeJS.Timeout };
  if (g.__afqSweep) return;
  g.__afqSweep = setInterval(async () => {
    try {
      const { getDb } = await import("./db");
      const { runAllSweeps } = await import("./server/services/sweep");
      await runAllSweeps(await getDb());
    } catch (e) { console.error("[sweep] failed:", (e as Error).message); }
  }, every * 1000);
}
