"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  GitBranch,
  Sparkles,
  Hash,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Repo = { fullName: string; private: boolean };

export default function ConnectPage() {
  return (
    <div>
      <PageHeader
        title="Connect Tools"
        subtitle="Connect the tools Zoro should watch."
      />
      <div className="mx-auto max-w-2xl space-y-6 p-8">
        <GithubCard />
        <SlackCard />
        <OpenAICard />
      </div>
    </div>
  );
}

function GithubCard() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState<{
    login?: string;
    repos?: string[];
    lastSyncedAt?: string | null;
  } | null>(null);

  useEffect(() => {
    fetch("/api/integrations/github")
      .then((r) => r.json())
      .then((d) => {
        if (d.connected) setConnected(d);
      })
      .catch(() => {});
  }, []);

  async function verify() {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/github/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLogin(data.login);
      setRepos(data.repos);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, repos: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/sessions/engineering");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          <CardTitle className="text-base">GitHub</CardTitle>
        </div>
        {connected ? (
          <Badge variant="green">
            <CheckCircle2 className="h-3 w-3" /> Connected as @{connected.login}
          </Badge>
        ) : (
          <Badge>Not connected</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <p className="text-sm text-muted">
            Watching {connected.repos?.length ?? 0} repositor
            {connected.repos?.length === 1 ? "y" : "ies"}. Paste a new token
            below to reconnect or change repositories.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Create a fine-grained Personal Access Token with{" "}
            <span className="text-foreground">
              Contents: Read, Issues: R/W, Pull requests: R/W, Checks: Read
            </span>{" "}
            for the repos you want Zoro to watch, then paste it here.
          </p>
        )}

        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={verify}
            disabled={token.length < 10 || verifying}
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
          </Button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {login && repos.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Verified as{" "}
              <span className="text-foreground">@{login}</span>. Select
              repositories to watch:
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {repos.map((r) => (
                <label
                  key={r.fullName}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-2",
                    selected.has(r.fullName) && "bg-surface-2",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.fullName)}
                    onChange={() => toggle(r.fullName)}
                    className="accent-accent"
                  />
                  <span className="flex-1">{r.fullName}</span>
                  {r.private ? <Badge variant="outline">private</Badge> : null}
                </label>
              ))}
            </div>
            <Button
              onClick={save}
              disabled={selected.size === 0 || saving}
              className="w-full"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connecting &
                  syncing…
                </>
              ) : (
                `Connect & sync ${selected.size || ""} repo${selected.size === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type Channel = { id: string; name: string; isMember: boolean; isPrivate: boolean };

function SlackCard() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState<{ teamName?: string; channels?: { name: string }[] } | null>(null);

  useEffect(() => {
    fetch("/api/integrations/slack")
      .then((r) => r.json())
      .then((d) => {
        if (d.connected) setConnected(d);
      })
      .catch(() => {});
  }, []);

  async function verify() {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/slack/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTeam(data.teamName);
      setChannels(data.channels);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const chosen = channels.filter((c) => selected.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
      const res = await fetch("/api/integrations/slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, channels: chosen }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/sessions/communication");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5" />
          <CardTitle className="text-base">Slack</CardTitle>
        </div>
        {connected ? (
          <Badge variant="green">
            <CheckCircle2 className="h-3 w-3" /> {connected.teamName}
          </Badge>
        ) : (
          <Badge>Not connected</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">
          Create a Slack app, add a <span className="text-foreground">Bot token</span> with{" "}
          <span className="text-foreground">channels:read, channels:history, groups:history, chat:write, users:read</span>,
          install it, then <span className="text-foreground">/invite</span> the bot to the channels you want Zoro to watch.
        </p>

        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="xoxb-…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button variant="secondary" onClick={verify} disabled={token.length < 10 || verifying}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
          </Button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {team && channels.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">
              Connected to <span className="text-foreground">{team}</span>. Pick channels
              (the bot must be a member — those are listed first):
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {channels.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex items-center gap-2 rounded px-2 py-1.5 text-sm",
                    c.isMember ? "cursor-pointer hover:bg-surface-2" : "opacity-40",
                    selected.has(c.id) && "bg-surface-2",
                  )}
                >
                  <input
                    type="checkbox"
                    disabled={!c.isMember}
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="accent-accent"
                  />
                  <Hash className="h-3.5 w-3.5 text-faint" />
                  <span className="flex-1">{c.name}</span>
                  {c.isPrivate ? <Badge variant="outline">private</Badge> : null}
                  {!c.isMember ? <span className="text-xs text-faint">invite bot</span> : null}
                </label>
              ))}
            </div>
            <Button onClick={save} disabled={selected.size === 0 || saving} className="w-full">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connecting & syncing…
                </>
              ) : (
                `Connect & sync ${selected.size || ""} channel${selected.size === 1 ? "" : "s"}`
              )}
            </Button>
          </div>
        ) : connected ? (
          <p className="text-sm text-muted">
            Watching {connected.channels?.length ?? 0} channel
            {connected.channels?.length === 1 ? "" : "s"}. Paste a token above to change.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OpenAICard() {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch("/api/integrations/openai")
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConnected(true);
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save key");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <CardTitle className="text-base">OpenAI</CardTitle>
        </div>
        {connected ? (
          <Badge variant="green">
            <CheckCircle2 className="h-3 w-3" /> Key saved
          </Badge>
        ) : (
          <Badge>Not connected</Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">
          Powers the AI engineering summaries and blocker detection. Your key is
          encrypted at rest and never leaves this machine except to call OpenAI.
        </p>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="sk-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Button onClick={save} disabled={key.length < 10 || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save key"}
          </Button>
        </div>
        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
