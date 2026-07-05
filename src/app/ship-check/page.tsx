"use client";

import { useState } from "react";
import { Rocket, ArrowUp, Loader2, AlertTriangle, ListChecks, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Report = {
  verdict: "ready" | "at_risk" | "not_ready";
  headline: string;
  areas: { name: string; status: "green" | "yellow" | "red"; summary: string; blockers: string[] }[];
  recommendedNextSteps: string[];
  earliestDate: string;
};

const VERDICT: Record<string, { label: string; variant: "green" | "yellow" | "red" }> = {
  ready: { label: "Ready to ship", variant: "green" },
  at_risk: { label: "At risk", variant: "yellow" },
  not_ready: { label: "Not ready", variant: "red" },
};

const DOT: Record<string, string> = { green: "bg-green", yellow: "bg-yellow", red: "bg-red" };

const EXAMPLES = [
  "Can we ship the current work this week?",
  "Are we ready to launch a new feature?",
  "Can we cut a release today?",
];

export default function ShipCheckPage() {
  const [input, setInput] = useState("");
  const [what, setWhat] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(q: string) {
    const t = q.trim();
    if (!t || loading) return;
    setWhat(t);
    setInput("");
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/ship-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ what: t }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.reason ?? "Check failed");
      setReport(data.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  const verdict = report ? VERDICT[report.verdict] : null;

  return (
    <div>
      <PageHeader
        title="Ship Check"
        subtitle="Ask if you're ready to ship — Zoro reasons across engineering, comms, and revenue."
      />
      <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 focus-within:border-border-strong"
        >
          <Rocket className="h-4 w-4 shrink-0 text-faint" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What do you want to ship? (e.g. the new onboarding flow this week)"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-[#6872d9] disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </form>

        {!report && !loading && !error ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => run(ex)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Assessing readiness across departments…
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>
        ) : null}

        {report && verdict ? (
          <div className="space-y-4">
            <Card className={cn(report.verdict === "not_ready" && "border-red/40", report.verdict === "ready" && "border-green/40")}>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center gap-2">
                  <Badge variant={verdict.variant}>{verdict.label}</Badge>
                  <span className="text-xs text-faint">re: “{what}”</span>
                </div>
                <p className="text-sm leading-relaxed">{report.headline}</p>
                {report.earliestDate ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-muted">
                    <CalendarDays className="h-3.5 w-3.5 text-faint" />
                    Earliest realistic: <span className="text-foreground">{report.earliestDate}</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>By area</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.areas.map((a, i) => (
                  <div key={i} className="rounded-md bg-white/[0.02] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", DOT[a.status] ?? "bg-faint")} />
                      <span className="text-[13px] font-medium">{a.name}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{a.summary}</p>
                    {a.blockers.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {a.blockers.map((b, j) => (
                          <li key={j} className="flex items-start gap-1.5 text-xs text-muted">
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>

            {report.recommendedNextSteps.length > 0 ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-accent" />
                    <CardTitle>Recommended next steps</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-2">
                    {report.recommendedNextSteps.map((s, i) => (
                      <li key={i} className="flex gap-2 text-[13px]">
                        <span className="text-faint">{i + 1}.</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
