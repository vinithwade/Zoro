import { z } from "zod";
import { ACTION_TYPES } from "@/lib/actions/registry";

// Zod validator for the AI output — used for runtime validation after the model
// responds. The JSON Schema below is what OpenAI enforces during generation
// (strict structured outputs). Two representations, one contract.

export const EngineeringSessionOutput = z.object({
  summary: z.string(),
  health: z.enum(["green", "yellow", "red"]),
  blockers: z.array(
    z.object({
      title: z.string(),
      severity: z.enum(["low", "medium", "high"]),
      explanation: z.string(),
      eventIds: z.array(z.string()),
    }),
  ),
  decisionsNeeded: z.array(
    z.object({
      question: z.string(),
      context: z.string(),
      eventIds: z.array(z.string()),
    }),
  ),
  recommendations: z.array(
    z.object({
      text: z.string(),
      eventIds: z.array(z.string()),
    }),
  ),
  suggestedActions: z.array(
    z.object({
      actionType: z.enum(ACTION_TYPES),
      title: z.string(),
      reasoning: z.string(),
      payload: z.object({
        repo: z.string(),
        issueOrPrNumber: z.number().nullable(),
        issueTitle: z.string().nullable(),
        body: z.string(),
      }),
      sourceEventIds: z.array(z.string()),
    }),
  ),
});

export type EngineeringSessionOutputType = z.infer<
  typeof EngineeringSessionOutput
>;

// JSON Schema handed to OpenAI. strict mode requires every property listed in
// `required` and additionalProperties:false everywhere.
export const ENGINEERING_SESSION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "health",
    "blockers",
    "decisionsNeeded",
    "recommendations",
    "suggestedActions",
  ],
  properties: {
    summary: { type: "string" },
    health: { type: "string", enum: ["green", "yellow", "red"] },
    blockers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "severity", "explanation", "eventIds"],
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          explanation: { type: "string" },
          eventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    decisionsNeeded: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "context", "eventIds"],
        properties: {
          question: { type: "string" },
          context: { type: "string" },
          eventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "eventIds"],
        properties: {
          text: { type: "string" },
          eventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
    suggestedActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["actionType", "title", "reasoning", "payload", "sourceEventIds"],
        properties: {
          actionType: { type: "string", enum: [...ACTION_TYPES] },
          title: { type: "string" },
          reasoning: { type: "string" },
          payload: {
            type: "object",
            additionalProperties: false,
            required: ["repo", "issueOrPrNumber", "issueTitle", "body"],
            properties: {
              repo: { type: "string" },
              issueOrPrNumber: { type: ["integer", "null"] },
              issueTitle: { type: ["string", "null"] },
              body: { type: "string" },
            },
          },
          sourceEventIds: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
