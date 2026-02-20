import { Octokit } from "@octokit/rest";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import {
  getGitHubAccounts,
  addGitHubAccount,
  removeGitHubAccount,
  switchGitHubAccount,
} from "@/lib/github-accounts-store";

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) return null;
  return session;
}

function maskPat(pat: string): string {
  if (pat.length <= 8) return "****";
  return pat.slice(0, 4) + "****" + pat.slice(-4);
}

export async function GET() {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const accounts = await getGitHubAccounts(session.user.id);

  // Get OAuth login info
  const ctx = await auth.$context;
  const betterAuthAccounts = await ctx.internalAdapter.findAccounts(session.user.id);
  const githubAccount = betterAuthAccounts.find(
    (a: { providerId: string }) => a.providerId === "github"
  );

  // Check if any extra account is active
  const hasActiveExtra = accounts.some((a) => a.active);

  return Response.json({
    accounts: accounts.map((a) => ({
      ...a,
      pat: maskPat(a.pat),
    })),
    oauthLogin: session.user.name ?? "Unknown",
    oauthAvatar: session.user.image ?? "",
    oauthActive: !hasActiveExtra,
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { pat, label } = body;

  if (!pat || typeof pat !== "string") {
    return Response.json({ error: "No token provided" }, { status: 400 });
  }

  // Validate PAT by calling GitHub API
  try {
    const octokit = new Octokit({ auth: pat });
    const { data: user } = await octokit.users.getAuthenticated();

    const account = await addGitHubAccount(session.user.id, {
      login: user.login,
      avatarUrl: user.avatar_url,
      label: label || user.login,
      pat,
    });

    return Response.json({
      account: { ...account, pat: maskPat(account.pat) },
    });
  } catch (e: any) {
    return Response.json(
      { error: e.status === 401 ? "Invalid token" : (e.message ?? "Validation failed") },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { accountId } = body;

  if (!accountId || typeof accountId !== "string") {
    return Response.json({ error: "No accountId provided" }, { status: 400 });
  }

  await removeGitHubAccount(session.user.id, accountId);
  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { accountId } = body; // null = switch to OAuth default

  if (accountId !== null && typeof accountId !== "string") {
    return Response.json({ error: "Invalid accountId" }, { status: 400 });
  }

  await switchGitHubAccount(session.user.id, accountId);
  return Response.json({ ok: true });
}
