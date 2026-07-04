import { PrismaClient } from "../src/generated/prisma";

const db = new PrismaClient();

async function main() {
  const existing = await db.workspace.findFirst({ where: { name: "default" } });
  if (existing) {
    console.log(`✓ default workspace already exists (${existing.id})`);
    return;
  }
  const ws = await db.workspace.create({ data: { name: "default" } });
  console.log(`✓ created default workspace (${ws.id})`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
