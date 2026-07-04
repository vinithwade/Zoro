import { PrismaClient } from "@/generated/prisma";

// Prisma singleton — avoids exhausting connections under Next.js hot reload.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// The single-workspace helper for slice 1. Everything is scoped to one
// auto-created "default" workspace; the schema is already multi-tenant-ready.
const DEFAULT_WORKSPACE_NAME = "default";

export async function getDefaultWorkspace() {
  const existing = await db.workspace.findFirst({
    where: { name: DEFAULT_WORKSPACE_NAME },
  });
  if (existing) return existing;
  return db.workspace.create({ data: { name: DEFAULT_WORKSPACE_NAME } });
}
