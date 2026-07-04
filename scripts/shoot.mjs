import { chromium } from "playwright";

const OUT = process.env.SHOT_DIR ?? "/tmp/zoro-shots";
const BASE = "http://localhost:3000";

const pages = [
  { path: "/", name: "dashboard" },
  { path: "/sessions/engineering", name: "engineering" },
  { path: "/approvals", name: "approvals" },
  { path: "/audit", name: "audit" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await ctx.newPage();

for (const p of pages) {
  await page.goto(BASE + p.path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200); // let client queries settle
  await page.screenshot({ path: `${OUT}/${p.name}.png` });
  console.log("shot", p.name);
}

// command palette on the dashboard
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.keyboard.press("Meta+k");
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/command-bar.png` });
console.log("shot command-bar");

await browser.close();
console.log("done");
