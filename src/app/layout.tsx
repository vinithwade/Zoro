import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Sidebar } from "@/components/sidebar";
import { CommandBar } from "@/components/command-bar";
import { db, getDefaultWorkspace } from "@/lib/db";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zoro — Startup Command Center",
  description: "Event, context, and approval layer over your startup's tools.",
};

// Every page reads live per-request data (DB, integrations) — never prerender.
export const dynamic = "force-dynamic";

async function getPendingApprovalCount(): Promise<number> {
  try {
    const ws = await getDefaultWorkspace();
    return db.proposedAction.count({
      where: { workspaceId: ws.id, status: "pending" },
    });
  } catch {
    // DB not ready yet — don't crash the shell.
    return 0;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pendingApprovals = await getPendingApprovalCount();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full" suppressHydrationWarning>
        <Providers>
          <div className="flex h-screen">
            <Sidebar pendingApprovals={pendingApprovals} />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
          <CommandBar />
        </Providers>
      </body>
    </html>
  );
}
