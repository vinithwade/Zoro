import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyGithubToken } from "@/lib/github/client";

const bodySchema = z.object({ token: z.string().min(10) });

// Validate a PAT without saving it — powers the "Test connection" step.
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A GitHub token is required." }, { status: 400 });
  }
  try {
    const info = await verifyGithubToken(parsed.data.token);
    return NextResponse.json(info);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not verify token";
    return NextResponse.json(
      { error: `GitHub rejected the token: ${message}` },
      { status: 400 },
    );
  }
}
