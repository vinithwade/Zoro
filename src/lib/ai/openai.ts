import "server-only";
import OpenAI from "openai";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

// Load the workspace's stored (encrypted) OpenAI key and build a client.
export async function getOpenAIClient(
  workspaceId: string,
): Promise<OpenAI | null> {
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "openai" } },
  });
  if (!integration) return null;
  return new OpenAI({ apiKey: decrypt(integration.encryptedToken) });
}

export type StructuredResult<T> = {
  data: T;
  promptTokens: number;
  completionTokens: number;
  model: string;
};

// Call the model with strict JSON-schema structured output. The model is
// guaranteed to return schema-valid JSON; we still parse defensively.
export async function generateStructured<T>(
  client: OpenAI,
  opts: {
    system: string;
    user: string;
    schemaName: string;
    jsonSchema: Record<string, unknown>;
  },
): Promise<StructuredResult<T>> {
  const model = env.OPENAI_MODEL;
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: opts.schemaName,
        strict: true,
        schema: opts.jsonSchema,
      },
    },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response");

  return {
    data: JSON.parse(content) as T,
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
    model,
  };
}
