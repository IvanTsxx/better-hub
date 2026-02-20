import { prisma } from "./db";

export interface GitHubAccount {
  id: string;
  userId: string;
  login: string;
  avatarUrl: string;
  label: string;
  pat: string;
  active: boolean;
  createdAt: string;
}

function toAccount(row: {
  id: string;
  userId: string;
  login: string;
  avatarUrl: string;
  label: string;
  pat: string;
  active: boolean;
  createdAt: string;
}): GitHubAccount {
  return {
    id: row.id,
    userId: row.userId,
    login: row.login,
    avatarUrl: row.avatarUrl,
    label: row.label,
    pat: row.pat,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function getGitHubAccounts(
  userId: string
): Promise<GitHubAccount[]> {
  const rows = await prisma.gitHubAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toAccount);
}

export async function getActiveGitHubAccount(
  userId: string
): Promise<GitHubAccount | null> {
  const row = await prisma.gitHubAccount.findFirst({
    where: { userId, active: true },
  });
  return row ? toAccount(row) : null;
}

export async function addGitHubAccount(
  userId: string,
  data: { login: string; avatarUrl: string; label: string; pat: string }
): Promise<GitHubAccount> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await prisma.gitHubAccount.updateMany({
    where: { userId },
    data: { active: false },
  });

  const created = await prisma.gitHubAccount.create({
    data: {
      id,
      userId,
      login: data.login,
      avatarUrl: data.avatarUrl,
      label: data.label,
      pat: data.pat,
      active: true,
      createdAt: now,
    },
  });

  return toAccount(created);
}

export async function switchGitHubAccount(
  userId: string,
  accountId: string | null
): Promise<void> {
  await prisma.gitHubAccount.updateMany({
    where: { userId },
    data: { active: false },
  });

  if (accountId) {
    await prisma.gitHubAccount.updateMany({
      where: { id: accountId, userId },
      data: { active: true },
    });
  }
}

export async function removeGitHubAccount(
  userId: string,
  accountId: string
): Promise<void> {
  await prisma.gitHubAccount.deleteMany({
    where: { id: accountId, userId },
  });
}
