import { z } from "zod";

// The ALLOWLIST of actions Zoro can ever take. Anything not here is rejected
// before it can be proposed, approved, or executed. Risk is STATIC per type —
// deterministic and explainable beats an AI risk classifier. Slice 1 has no
// dangerous actions (no merge / close / deploy).

export const ACTION_TYPES = [
  "github.comment_issue",
  "github.comment_pr",
  "github.create_issue",
  "slack.post_message",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

// Validated payload shapes for each action.
const commentPayload = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be owner/name"),
  number: z.number().int().positive(),
  body: z.string().min(1).max(65000),
});

const createIssuePayload = z.object({
  repo: z.string().regex(/^[^/]+\/[^/]+$/, "repo must be owner/name"),
  title: z.string().min(1).max(256),
  body: z.string().max(65000),
});

const slackMessagePayload = z.object({
  channel: z.string().min(1), // channel name (without #) or id
  text: z.string().min(1).max(3000),
});

export const ACTION_REGISTRY: Record<
  ActionType,
  {
    label: string;
    risk: "low" | "medium";
    payloadSchema: z.ZodTypeAny;
  }
> = {
  "github.comment_issue": {
    label: "Comment on issue",
    risk: "low",
    payloadSchema: commentPayload,
  },
  "github.comment_pr": {
    label: "Comment on pull request",
    risk: "low",
    payloadSchema: commentPayload,
  },
  "github.create_issue": {
    label: "Create issue",
    risk: "medium",
    payloadSchema: createIssuePayload,
  },
  "slack.post_message": {
    label: "Post to Slack",
    risk: "medium",
    payloadSchema: slackMessagePayload,
  },
};

export function isActionType(v: string): v is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(v);
}

// The loose payload shape the AI emits (one shape for all action types).
export type AiActionPayload = {
  repo: string;
  issueOrPrNumber: number | null;
  issueTitle: string | null;
  body: string;
};

// Map the AI's generic payload into the strict registry payload for a given
// action type, then validate it. Returns null if it doesn't validate.
export function buildActionPayload(
  actionType: ActionType,
  ai: AiActionPayload,
): Record<string, unknown> | null {
  let candidate: Record<string, unknown>;
  if (actionType === "github.create_issue") {
    candidate = { repo: ai.repo, title: ai.issueTitle ?? "", body: ai.body };
  } else {
    candidate = { repo: ai.repo, number: ai.issueOrPrNumber ?? 0, body: ai.body };
  }
  const result = ACTION_REGISTRY[actionType].payloadSchema.safeParse(candidate);
  return result.success ? (result.data as Record<string, unknown>) : null;
}
