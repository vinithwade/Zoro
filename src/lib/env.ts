import "server-only";
import { z } from "zod";

// Server-side environment validation. Fails fast at startup if misconfigured.
// NOTE: the OpenAI API key and GitHub PAT are NOT here — they are entered by
// the user in /connect and stored encrypted in the database.
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_ENCRYPTION_KEY: z
    .string()
    .min(1, "APP_ENCRYPTION_KEY is required — generate with: openssl rand -base64 32"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
});
