import "server-only";
import { Octokit } from "octokit";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export type GithubConfig = {
  owner: string; // the authenticated login (used as a default namespace)
  login: string;
  repos: string[]; // "owner/repo" full names selected for syncing
};

// Build an Octokit client from the stored (encrypted) PAT for a workspace.
export async function getGithubClient(workspaceId: string): Promise<{
  octokit: Octokit;
  config: GithubConfig;
} | null> {
  const integration = await db.integration.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "github" } },
  });
  if (!integration) return null;
  const token = decrypt(integration.encryptedToken);
  return {
    octokit: new Octokit({ auth: token }),
    config: integration.config as GithubConfig,
  };
}

// Validate a PAT and return the authenticated user + accessible repos.
export async function verifyGithubToken(token: string): Promise<{
  login: string;
  name: string | null;
  avatarUrl: string;
  repos: { fullName: string; private: boolean; updatedAt: string | null }[];
}> {
  const octokit = new Octokit({ auth: token });
  const { data: user } = await octokit.rest.users.getAuthenticated();

  // Fine-grained PATs expose exactly the repos they were granted.
  const repos = await octokit.paginate(
    octokit.rest.repos.listForAuthenticatedUser,
    { per_page: 100, sort: "updated" },
  );

  return {
    login: user.login,
    name: user.name ?? null,
    avatarUrl: user.avatar_url,
    repos: repos.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      updatedAt: r.updated_at ?? null,
    })),
  };
}
