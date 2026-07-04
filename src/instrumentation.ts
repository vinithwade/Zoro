// Next.js runs register() once when the server process boots.
// We start the in-process poller here (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}
