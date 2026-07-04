import "server-only";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

// Thin Slack Web API client (no SDK) — bot token auth.

const API = "https://slack.com/api";

export type SlackConfig = {
  teamId: string;
  teamName: string;
  botUserId: string;
  url: string; // workspace URL, e.g. https://acme.slack.com/
  channels: { id: string; name: string }[];
};

async function slackApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T & { ok: boolean; error?: string }> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) body.set(k, String(v));
  }
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  return res.json();
}

export async function getSlackClient(workspaceId: string): Promise<{
  token: string;
  config: SlackConfig;
  call: typeof slackApi;
} | null> {
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "slack" } },
  });
  if (!integration) return null;
  const token = decrypt(integration.encryptedToken);
  return {
    token,
    config: integration.config as SlackConfig,
    call: slackApi,
  };
}

export type SlackChannel = { id: string; name: string; isMember: boolean; isPrivate: boolean };

// Validate a bot token and return workspace info + channels.
export async function verifySlackToken(token: string): Promise<{
  teamId: string;
  teamName: string;
  botUserId: string;
  url: string;
  channels: SlackChannel[];
}> {
  const auth = await slackApi<{ team: string; team_id: string; user_id: string; url: string }>(
    token,
    "auth.test",
  );
  if (!auth.ok) throw new Error(auth.error ?? "auth.test failed");

  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  do {
    const res = await slackApi<{
      channels: { id: string; name: string; is_member: boolean; is_private: boolean }[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: 200,
      cursor,
    });
    if (!res.ok) throw new Error(res.error ?? "conversations.list failed");
    for (const c of res.channels ?? []) {
      channels.push({ id: c.id, name: c.name, isMember: c.is_member, isPrivate: c.is_private });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return {
    teamId: auth.team_id,
    teamName: auth.team,
    botUserId: auth.user_id,
    url: auth.url,
    channels: channels.sort((a, b) => Number(b.isMember) - Number(a.isMember)),
  };
}

// Build a display-name lookup for user ids (cached per sync).
export async function fetchUserMap(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const res = await slackApi<{
      members: { id: string; name: string; profile?: { display_name?: string; real_name?: string } }[];
      response_metadata?: { next_cursor?: string };
    }>(token, "users.list", { limit: 200, cursor });
    if (!res.ok) break;
    for (const m of res.members ?? []) {
      map.set(m.id, m.profile?.display_name || m.profile?.real_name || m.name);
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return map;
}

export type SlackMessage = {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
};

export async function fetchChannelHistory(
  token: string,
  channelId: string,
  oldest: number,
): Promise<SlackMessage[]> {
  const res = await slackApi<{ messages: SlackMessage[] }>(token, "conversations.history", {
    channel: channelId,
    oldest: oldest.toFixed(6),
    limit: 100,
  });
  if (!res.ok) throw new Error(res.error ?? "conversations.history failed");
  return res.messages ?? [];
}

export async function postSlackMessage(
  token: string,
  channel: string,
  text: string,
): Promise<{ ts: string; channel: string; permalink?: string }> {
  const res = await slackApi<{ ts: string; channel: string }>(token, "chat.postMessage", {
    channel,
    text,
  });
  if (!res.ok) throw new Error(res.error ?? "chat.postMessage failed");
  return { ts: res.ts, channel: res.channel };
}
