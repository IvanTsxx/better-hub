import { Octokit } from "@octokit/rest";
import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./auth";
import {
  claimDueGithubSyncJobs,
  deleteGithubCacheByPrefix,
  enqueueGithubSyncJob,
  getGithubCacheEntry,
  markGithubSyncJobFailed,
  markGithubSyncJobSucceeded,
  touchGithubCacheEntrySyncedAt,
  upsertGithubCacheEntry,
} from "./github-sync-store";

export type RepoPermissions = {
  admin: boolean;
  push: boolean;
  pull: boolean;
  maintain: boolean;
  triage: boolean;
};

export function extractRepoPermissions(repoData: any): RepoPermissions {
  const p = repoData?.permissions;
  return {
    admin: !!p?.admin,
    push: !!p?.push,
    pull: !!p?.pull,
    maintain: !!p?.maintain,
    triage: !!p?.triage,
  };
}

type RepoSort = "updated" | "pushed" | "full_name";
type OrgRepoSort = "created" | "updated" | "pushed" | "full_name";
type OrgRepoType = "all" | "public" | "private" | "forks" | "sources" | "member";

interface GitHubAuthContext {
  userId: string;
  token: string;
  octokit: Octokit;
  forceRefresh: boolean;
}

type GitDataSyncJobType =
  | "user_repos"
  | "repo"
  | "repo_contents"
  | "repo_tree"
  | "repo_branches"
  | "repo_tags"
  | "file_content"
  | "repo_readme"
  | "authenticated_user"
  | "user_orgs"
  | "org"
  | "org_repos"
  | "notifications"
  | "search_issues"
  | "user_events"
  | "starred_repos"
  | "contributions"
  | "trending_repos"
  | "repo_issues"
  | "repo_pull_requests"
  | "issue"
  | "issue_comments"
  | "pull_request"
  | "pull_request_files"
  | "pull_request_comments"
  | "pull_request_reviews"
  | "pull_request_commits"
  | "repo_contributors"
  | "user_profile"
  | "user_public_repos"
  | "user_public_orgs"
  | "repo_workflows"
  | "repo_workflow_runs"
  | "repo_nav_counts"
  | "org_members"
  | "person_repo_activity"
  | "pr_bundle";

interface GitDataSyncJobPayload {
  owner?: string;
  repo?: string;
  sort?: RepoSort;
  perPage?: number;
  path?: string;
  ref?: string;
  treeSha?: string;
  recursive?: boolean;
  username?: string;
  orgName?: string;
  orgSort?: OrgRepoSort;
  orgType?: OrgRepoType;
  state?: "open" | "closed" | "all";
  query?: string;
  issueNumber?: number;
  pullNumber?: number;
  language?: string;
  since?: "daily" | "weekly" | "monthly";
  openIssuesAndPrs?: number;
}

interface LocalFirstGitReadOptions<T> {
  authCtx: GitHubAuthContext | null;
  cacheKey: string;
  cacheType: string;
  ttlMs: number;
  fallback: T;
  jobType: GitDataSyncJobType;
  jobPayload: GitDataSyncJobPayload;
  fetchRemote: (octokit: Octokit) => Promise<T>;
}

const CACHE_TTL_MS = {
  userRepos: readEnvMs("GITHUB_SYNC_TTL_USER_REPOS_MS", 60_000),
  repo: readEnvMs("GITHUB_SYNC_TTL_REPO_MS", 60_000),
  repoContents: readEnvMs("GITHUB_SYNC_TTL_CONTENTS_MS", 120_000),
  repoTree: readEnvMs("GITHUB_SYNC_TTL_TREE_MS", 300_000),
  repoBranches: readEnvMs("GITHUB_SYNC_TTL_BRANCHES_MS", 180_000),
  repoTags: readEnvMs("GITHUB_SYNC_TTL_TAGS_MS", 300_000),
  fileContent: readEnvMs("GITHUB_SYNC_TTL_FILE_MS", 120_000),
  repoReadme: readEnvMs("GITHUB_SYNC_TTL_README_MS", 600_000),
  authenticatedUser: 300_000,
  userOrgs: 300_000,
  org: 300_000,
  orgRepos: 120_000,
  notifications: 30_000,
  searchIssues: 60_000,
  userEvents: 60_000,
  starredRepos: 300_000,
  contributions: 600_000,
  trendingRepos: 600_000,
  repoIssues: 60_000,
  repoPullRequests: 60_000,
  issue: 60_000,
  issueComments: 60_000,
  pullRequest: 60_000,
  pullRequestFiles: 120_000,
  pullRequestComments: 60_000,
  pullRequestReviews: 60_000,
  pullRequestCommits: 120_000,
  repoContributors: 300_000,
  userProfile: 300_000,
  userPublicRepos: 120_000,
  userPublicOrgs: 300_000,
  repoWorkflows: 300_000,
  repoWorkflowRuns: 60_000,
  repoNavCounts: 60_000,
  orgMembers: 300_000,
  personRepoActivity: 120_000,
  prBundle: 60_000,
};

const globalForGithubSync = globalThis as typeof globalThis & {
  __githubSyncDrainingUsers?: Set<string>;
};

if (!globalForGithubSync.__githubSyncDrainingUsers) {
  globalForGithubSync.__githubSyncDrainingUsers = new Set<string>();
}

const githubSyncDrainingUsers = globalForGithubSync.__githubSyncDrainingUsers;

// --- Rate Limit Error ---

export class GitHubRateLimitError extends Error {
  readonly resetAt: number; // unix timestamp (seconds)
  readonly limit: number;
  readonly used: number;

  constructor(resetAt: number, limit: number, used: number) {
    super("GitHub API rate limit exceeded");
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
    this.limit = limit;
    this.used = used;
  }
}

function isRateLimitError(error: unknown): { resetAt: number; limit: number; used: number } | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: number }).status;
  if (status !== 403 && status !== 429) return null;

  const message = (error as { message?: string }).message ?? "";
  if (!message.toLowerCase().includes("rate limit")) return null;

  const response = (error as { response?: { headers?: Record<string, string> } }).response;
  const headers = response?.headers;

  const resetAt = Number(headers?.["x-ratelimit-reset"] ?? 0);
  const limit = Number(headers?.["x-ratelimit-limit"] ?? 5000);
  const remaining = Number(headers?.["x-ratelimit-remaining"] ?? 0);

  return { resetAt: resetAt || Math.floor(Date.now() / 1000) + 3600, limit, used: limit - remaining };
}

function readEnvMs(name: string, fallbackMs: number): number {
  const raw = process.env[name];
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function normalizeRef(ref?: string): string {
  const value = ref?.trim();
  return value ? value : "";
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function normalizeRepoKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function keyPart(value: string): string {
  return encodeURIComponent(value === "" ? "~" : value);
}

function buildUserReposCacheKey(sort: RepoSort, perPage: number): string {
  return `user_repos:${sort}:${perPage}`;
}

function buildRepoCacheKey(owner: string, repo: string): string {
  return `repo:${normalizeRepoKey(owner, repo)}`;
}

function buildRepoContentsCacheKey(
  owner: string,
  repo: string,
  path: string,
  ref?: string
): string {
  return `repo_contents:${normalizeRepoKey(owner, repo)}:${keyPart(
    normalizeRef(ref)
  )}:${keyPart(normalizePath(path))}`;
}

function buildRepoTreeCacheKey(
  owner: string,
  repo: string,
  treeSha: string,
  recursive: boolean
): string {
  return `repo_tree:${normalizeRepoKey(owner, repo)}:${keyPart(
    treeSha
  )}:${recursive ? "1" : "0"}`;
}

function buildRepoBranchesCacheKey(owner: string, repo: string): string {
  return `repo_branches:${normalizeRepoKey(owner, repo)}`;
}

function buildRepoTagsCacheKey(owner: string, repo: string): string {
  return `repo_tags:${normalizeRepoKey(owner, repo)}`;
}

function buildFileContentCacheKey(
  owner: string,
  repo: string,
  path: string,
  ref?: string
): string {
  return `file_content:${normalizeRepoKey(owner, repo)}:${keyPart(
    normalizeRef(ref)
  )}:${keyPart(normalizePath(path))}`;
}

function buildRepoReadmeCacheKey(owner: string, repo: string, ref?: string): string {
  return `repo_readme:${normalizeRepoKey(owner, repo)}:${keyPart(
    normalizeRef(ref)
  )}`;
}

function buildAuthenticatedUserCacheKey(): string {
  return "authenticated_user";
}

function buildUserOrgsCacheKey(perPage: number): string {
  return `user_orgs:${perPage}`;
}

function buildOrgCacheKey(org: string): string {
  return `org:${org.toLowerCase()}`;
}

function buildOrgReposCacheKey(org: string, sort: OrgRepoSort, type: OrgRepoType, perPage: number): string {
  return `org_repos:${org.toLowerCase()}:${sort}:${type}:${perPage}`;
}

function buildNotificationsCacheKey(perPage: number): string {
  return `notifications:${perPage}`;
}

function buildSearchIssuesCacheKey(query: string, perPage: number): string {
  return `search_issues:${keyPart(query)}:${perPage}`;
}

function buildUserEventsCacheKey(username: string, perPage: number): string {
  return `user_events:${username.toLowerCase()}:${perPage}`;
}

function buildStarredReposCacheKey(perPage: number): string {
  return `starred_repos:${perPage}`;
}

function buildContributionsCacheKey(username: string): string {
  return `contributions:${username.toLowerCase()}`;
}

function buildTrendingReposCacheKey(since: string, perPage: number, language?: string): string {
  return `trending_repos:${since}:${perPage}:${keyPart(language ?? "")}`;
}

function buildRepoIssuesCacheKey(owner: string, repo: string, state: string): string {
  return `repo_issues:${normalizeRepoKey(owner, repo)}:${state}`;
}

function buildRepoPullRequestsCacheKey(owner: string, repo: string, state: string): string {
  return `repo_pull_requests:${normalizeRepoKey(owner, repo)}:${state}`;
}

function buildIssueCacheKey(owner: string, repo: string, issueNumber: number): string {
  return `issue:${normalizeRepoKey(owner, repo)}:${issueNumber}`;
}

function buildIssueCommentsCacheKey(owner: string, repo: string, issueNumber: number): string {
  return `issue_comments:${normalizeRepoKey(owner, repo)}:${issueNumber}`;
}

function buildPullRequestCacheKey(owner: string, repo: string, pullNumber: number): string {
  return `pull_request:${normalizeRepoKey(owner, repo)}:${pullNumber}`;
}

function buildPullRequestFilesCacheKey(owner: string, repo: string, pullNumber: number): string {
  return `pull_request_files:${normalizeRepoKey(owner, repo)}:${pullNumber}`;
}

function buildPullRequestCommentsCacheKey(owner: string, repo: string, pullNumber: number): string {
  return `pull_request_comments:${normalizeRepoKey(owner, repo)}:${pullNumber}`;
}

function buildPullRequestReviewsCacheKey(owner: string, repo: string, pullNumber: number): string {
  return `pull_request_reviews:${normalizeRepoKey(owner, repo)}:${pullNumber}`;
}

function buildPullRequestCommitsCacheKey(owner: string, repo: string, pullNumber: number): string {
  return `pull_request_commits:${normalizeRepoKey(owner, repo)}:${pullNumber}`;
}

function buildRepoContributorsCacheKey(owner: string, repo: string, perPage: number): string {
  return `repo_contributors:${normalizeRepoKey(owner, repo)}:${perPage}`;
}

function buildUserProfileCacheKey(username: string): string {
  return `user_profile:${username.toLowerCase()}`;
}

function buildUserPublicReposCacheKey(username: string, perPage: number): string {
  return `user_public_repos:${username.toLowerCase()}:${perPage}`;
}

function buildUserPublicOrgsCacheKey(username: string): string {
  return `user_public_orgs:${username.toLowerCase()}`;
}

function buildRepoWorkflowsCacheKey(owner: string, repo: string): string {
  return `repo_workflows:${normalizeRepoKey(owner, repo)}`;
}

function buildRepoWorkflowRunsCacheKey(owner: string, repo: string, perPage: number): string {
  return `repo_workflow_runs:${normalizeRepoKey(owner, repo)}:${perPage}`;
}

function buildRepoNavCountsCacheKey(owner: string, repo: string): string {
  return `repo_nav_counts:${normalizeRepoKey(owner, repo)}`;
}

function buildOrgMembersCacheKey(org: string, perPage: number): string {
  return `org_members:${org.toLowerCase()}:${perPage}`;
}

function buildPersonRepoActivityCacheKey(owner: string, repo: string, username: string): string {
  return `person_repo_activity:${normalizeRepoKey(owner, repo)}:${username.toLowerCase()}`;
}

function buildPRBundleCacheKey(owner: string, repo: string, pullNumber: number): string {
  return `pr_bundle:${normalizeRepoKey(owner, repo)}:${pullNumber}`;
}

const getGitHubAuthContext = cache(async (): Promise<GitHubAuthContext | null> => {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({
    headers: reqHeaders,
  });
  if (!session) return null;

  const ctx = await auth.$context;
  const accounts = await ctx.internalAdapter.findAccounts(session.user.id);
  const githubAccount = accounts.find(
    (account: { providerId: string }) => account.providerId === "github"
  );

  const oauthToken = githubAccount?.accessToken;
  if (!oauthToken) return null;

  const { getActiveGitHubAccount } = await import("./github-accounts-store");
  const activeAccount = await getActiveGitHubAccount(session.user.id);

  const { getUserSettings } = await import("./user-settings-store");
  const settings = await getUserSettings(session.user.id);
  const token = activeAccount?.pat || settings.githubPat || oauthToken;

  const cacheControl = reqHeaders.get("cache-control") ?? "";
  const pragma = reqHeaders.get("pragma") ?? "";
  const forceRefresh =
    cacheControl.includes("no-cache") ||
    cacheControl.includes("max-age=0") ||
    pragma.includes("no-cache");

  return {
    userId: session.user.id,
    token,
    octokit: new Octokit({ auth: token }),
    forceRefresh,
  };
});

function isStale(syncedAt: string, ttlMs: number): boolean {
  const parsed = Date.parse(syncedAt);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed >= ttlMs;
}

function getSyncErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return "Unknown sync error";
}

async function fetchUserReposFromGitHub(
  octokit: Octokit,
  sort: RepoSort,
  perPage: number
) {
  const { data } = await octokit.repos.listForAuthenticatedUser({
    sort,
    per_page: perPage,
    affiliation: "owner,collaborator,organization_member",
  });
  return data;
}

async function fetchRepoFromGitHub(octokit: Octokit, owner: string, repo: string) {
  const { data } = await octokit.repos.get({ owner, repo });
  return data;
}

async function fetchRepoContentsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ...(ref ? { ref } : {}),
  });
  return data;
}

async function fetchRepoTreeFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  treeSha: string,
  recursive?: boolean
) {
  const { data } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    ...(recursive ? { recursive: "1" } : {}),
  });
  return data;
}

async function fetchRepoBranchesFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string
) {
  const branches: Awaited<ReturnType<typeof octokit.repos.listBranches>>["data"] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
      page,
    });
    branches.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return branches;
}

async function fetchRepoTagsFromGitHub(octokit: Octokit, owner: string, repo: string) {
  const { data } = await octokit.repos.listTags({
    owner,
    repo,
    per_page: 100,
  });
  return data;
}

async function fetchFileContentFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    if (Array.isArray(data) || data.type !== "file") return null;

    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { ...data, content };
  } catch {
    return null;
  }
}

async function fetchRepoReadmeFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref?: string
) {
  try {
    const { data } = await octokit.repos.getReadme({
      owner,
      repo,
      ...(ref ? { ref } : {}),
    });
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    return { ...data, content };
  } catch {
    return null;
  }
}

async function fetchAuthenticatedUserFromGitHub(octokit: Octokit) {
  const { data } = await octokit.users.getAuthenticated();
  return data;
}

async function fetchUserOrgsFromGitHub(octokit: Octokit, perPage: number) {
  const { data } = await octokit.orgs.listForAuthenticatedUser({ per_page: perPage });
  return data;
}

async function fetchOrgFromGitHub(octokit: Octokit, org: string) {
  const { data } = await octokit.orgs.get({ org });
  return data;
}

async function fetchOrgReposFromGitHub(
  octokit: Octokit,
  org: string,
  sort: OrgRepoSort,
  type: OrgRepoType,
  perPage: number
) {
  const { data } = await octokit.repos.listForOrg({ org, per_page: perPage, sort, type });
  return data;
}

async function fetchNotificationsFromGitHub(octokit: Octokit, perPage: number) {
  const { data } = await octokit.activity.listNotificationsForAuthenticatedUser({
    per_page: perPage,
    all: false,
  });
  return data;
}

async function fetchSearchIssuesFromGitHub(octokit: Octokit, query: string, perPage: number) {
  const { data } = await octokit.search.issuesAndPullRequests({
    q: query,
    per_page: perPage,
    sort: "updated",
    order: "desc",
  });
  return data;
}

async function fetchUserEventsFromGitHub(octokit: Octokit, username: string, perPage: number) {
  const { data } = await octokit.activity.listEventsForAuthenticatedUser({
    username,
    per_page: perPage,
  });
  return data;
}

async function fetchContributionsFromGitHub(token: string, username: string) {
  const query = `
    query($username: String!) {
      user(login: $username) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                color
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { username } }),
  });

  if (!response.ok) return null;
  const json = await response.json();
  return json.data?.user?.contributionsCollection?.contributionCalendar ?? null;
}

async function fetchStarredReposFromGitHub(octokit: Octokit, perPage: number) {
  const { data } = await octokit.activity.listReposStarredByAuthenticatedUser({
    per_page: perPage,
    sort: "updated",
  });
  return data;
}

async function fetchTrendingReposFromGitHub(
  octokit: Octokit,
  since: "daily" | "weekly" | "monthly",
  perPage: number,
  language?: string
) {
  const dateMap = { daily: 1, weekly: 7, monthly: 30 };
  const daysAgo = dateMap[since];
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const dateStr = date.toISOString().split("T")[0];

  const q = language
    ? `stars:>5 created:>${dateStr} language:${language}`
    : `stars:>5 created:>${dateStr}`;

  const { data } = await octokit.search.repos({
    q,
    sort: "stars",
    order: "desc",
    per_page: perPage,
  });

  return data.items;
}

async function fetchRepoIssuesFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all"
) {
  const { data } = await octokit.issues.listForRepo({
    owner,
    repo,
    state,
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  return data.filter((issue) => !issue.pull_request);
}

async function fetchRepoPullRequestsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  state: "open" | "closed" | "all"
) {
  const { data } = await octokit.pulls.list({
    owner,
    repo,
    state,
    per_page: 50,
    sort: "updated",
    direction: "desc",
  });
  return data;
}

async function fetchIssueFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
) {
  const { data } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });
  return data;
}

async function fetchIssueCommentsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
) {
  const { data } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  return data;
}

async function fetchPullRequestFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
  return data;
}

async function fetchPullRequestFilesFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const { data } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return data;
}

async function fetchPullRequestCommentsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const [issueComments, reviewComments] = await Promise.all([
    octokit.issues
      .listComments({ owner, repo, issue_number: pullNumber, per_page: 100 })
      .then((r) => r.data),
    octokit.pulls
      .listReviewComments({ owner, repo, pull_number: pullNumber, per_page: 100 })
      .then((r) => r.data),
  ]);
  return { issueComments, reviewComments };
}

async function fetchPullRequestReviewsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const { data } = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return data;
}

async function fetchPullRequestCommitsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const { data } = await octokit.pulls.listCommits({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
  return data;
}

async function fetchRepoContributorsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  perPage: number
) {
  try {
    const response = await octokit.repos.listContributors({ owner, repo, per_page: perPage });
    const list = response.data.map((c: any) => ({
      login: c.login as string,
      avatar_url: c.avatar_url as string,
      contributions: c.contributions as number,
      html_url: c.html_url as string,
    }));

    let totalCount = list.length;
    const linkHeader = response.headers.link;
    if (linkHeader) {
      const lastMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
      if (lastMatch) {
        totalCount = (parseInt(lastMatch[1], 10) - 1) * perPage + perPage;
      }
    }

    return { list, totalCount };
  } catch {
    return { list: [], totalCount: 0 };
  }
}

async function fetchUserProfileFromGitHub(octokit: Octokit, username: string) {
  // Try direct user lookup first
  try {
    const { data } = await octokit.users.getByUsername({ username });
    return data;
  } catch {
    // continue to fallbacks
  }

  // Try as a bot account (e.g. "copilot" → "copilot[bot]")
  if (!username.endsWith("[bot]")) {
    try {
      const { data } = await octokit.users.getByUsername({
        username: `${username.toLowerCase()}[bot]`,
      });
      return data;
    } catch {
      // continue
    }
  }

  // Try resolving as a GitHub App
  try {
    const { data: app } = await octokit.request("GET /apps/{app_slug}", {
      app_slug: username.toLowerCase(),
    } as any);
    return {
      login: (app as any).slug ?? username,
      name: (app as any).name ?? username,
      avatar_url: (app as any).owner?.avatar_url ?? "",
      html_url: (app as any).html_url ?? `https://github.com/apps/${username.toLowerCase()}`,
      bio: (app as any).description ?? null,
      blog: (app as any).external_url ?? null,
      location: null,
      company: null,
      twitter_username: null,
      public_repos: 0,
      followers: 0,
      following: 0,
      created_at: (app as any).created_at ?? new Date().toISOString(),
      type: "Bot",
    } as any;
  } catch {
    // all lookups failed
  }

  return null;
}

async function fetchUserPublicReposFromGitHub(octokit: Octokit, username: string, perPage: number) {
  const { data } = await octokit.repos.listForUser({ username, sort: "updated", per_page: perPage });
  return data;
}

async function fetchUserPublicOrgsFromGitHub(octokit: Octokit, username: string) {
  const { data } = await octokit.orgs.listForUser({ username, per_page: 100 });
  return data;
}

async function fetchRepoWorkflowsFromGitHub(octokit: Octokit, owner: string, repo: string) {
  const { data } = await octokit.actions.listRepoWorkflows({ owner, repo, per_page: 100 });
  return data.workflows;
}

async function fetchRepoWorkflowRunsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  perPage: number
) {
  const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, per_page: perPage });
  return data.workflow_runs;
}

async function fetchOrgMembersFromGitHub(octokit: Octokit, org: string, perPage: number) {
  const { data } = await octokit.orgs.listMembers({ org, per_page: perPage });
  return data;
}

async function fetchRepoNavCountsFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  openIssuesAndPrs: number
) {
  const [prSearch, runsResult] = await Promise.all([
    octokit.search
      .issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:open is:pr`,
        per_page: 1,
      })
      .catch(() => ({ data: { total_count: 0 } })),
    octokit.actions
      .listWorkflowRunsForRepo({
        owner,
        repo,
        status: "in_progress" as any,
        per_page: 1,
      })
      .catch(() => ({ data: { total_count: 0 } })),
  ]);

  const openPrs = prSearch.data.total_count;
  return {
    openPrs,
    openIssues: Math.max(0, openIssuesAndPrs - openPrs),
    activeRuns: runsResult.data.total_count,
  };
}

/** Conditional GET against the GitHub API — returns {notModified:true} on 304 without throwing. */
async function ghConditionalGet(
  token: string,
  path: string,
  etag: string | null
): Promise<{ notModified: true; data?: undefined; etag?: undefined } | { notModified: false; data: any; etag: string | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (etag) headers["If-None-Match"] = etag;
  const resp = await fetch(`https://api.github.com${path}`, { headers, cache: "no-store" });
  if (resp.status === 304) return { notModified: true };
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GitHub API ${resp.status}: ${path} – ${body.slice(0, 200)}`);
  }
  const data = await resp.json();
  return { notModified: false, data, etag: resp.headers.get("etag") };
}

async function processGitDataSyncJob(
  authCtx: GitHubAuthContext,
  jobType: GitDataSyncJobType,
  payload: GitDataSyncJobPayload
) {
  // Jobs that don't require owner/repo
  switch (jobType) {
    case "user_repos": {
      const sort = payload.sort ?? "updated";
      const perPage = payload.perPage ?? 30;
      const data = await fetchUserReposFromGitHub(authCtx.octokit, sort, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildUserReposCacheKey(sort, perPage), "user_repos", data);
      return;
    }
    case "authenticated_user": {
      const auKey = buildAuthenticatedUserCacheKey();
      const auCached = await getGithubCacheEntry(authCtx.userId, auKey);
      try {
        const resp = await authCtx.octokit.users.getAuthenticated({
          headers: auCached?.etag ? { "If-None-Match": auCached.etag } : {},
        } as any);
        await upsertGithubCacheEntry(authCtx.userId, auKey, "authenticated_user", resp.data, resp.headers?.etag ?? null);
      } catch (e: any) {
        if (e.status === 304) { await touchGithubCacheEntrySyncedAt(authCtx.userId, auKey); return; }
        throw e;
      }
      return;
    }
    case "user_orgs": {
      const perPage = payload.perPage ?? 50;
      const data = await fetchUserOrgsFromGitHub(authCtx.octokit, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildUserOrgsCacheKey(perPage), "user_orgs", data);
      return;
    }
    case "org": {
      if (!payload.orgName) return;
      const data = await fetchOrgFromGitHub(authCtx.octokit, payload.orgName);
      await upsertGithubCacheEntry(authCtx.userId, buildOrgCacheKey(payload.orgName), "org", data);
      return;
    }
    case "org_repos": {
      if (!payload.orgName) return;
      const sort = payload.orgSort ?? "updated";
      const type = payload.orgType ?? "all";
      const perPage = payload.perPage ?? 100;
      const data = await fetchOrgReposFromGitHub(authCtx.octokit, payload.orgName, sort, type, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildOrgReposCacheKey(payload.orgName, sort, type, perPage), "org_repos", data);
      return;
    }
    case "notifications": {
      const perPage = payload.perPage ?? 20;
      const data = await fetchNotificationsFromGitHub(authCtx.octokit, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildNotificationsCacheKey(perPage), "notifications", data);
      return;
    }
    case "search_issues": {
      if (!payload.query) return;
      const perPage = payload.perPage ?? 20;
      const data = await fetchSearchIssuesFromGitHub(authCtx.octokit, payload.query, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildSearchIssuesCacheKey(payload.query, perPage), "search_issues", data);
      return;
    }
    case "user_events": {
      if (!payload.username) return;
      const perPage = payload.perPage ?? 30;
      const data = await fetchUserEventsFromGitHub(authCtx.octokit, payload.username, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildUserEventsCacheKey(payload.username, perPage), "user_events", data);
      return;
    }
    case "starred_repos": {
      const perPage = payload.perPage ?? 10;
      const data = await fetchStarredReposFromGitHub(authCtx.octokit, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildStarredReposCacheKey(perPage), "starred_repos", data);
      return;
    }
    case "contributions": {
      if (!payload.username) return;
      const data = await fetchContributionsFromGitHub(authCtx.token, payload.username);
      await upsertGithubCacheEntry(authCtx.userId, buildContributionsCacheKey(payload.username), "contributions", data);
      return;
    }
    case "trending_repos": {
      const since = payload.since ?? "weekly";
      const perPage = payload.perPage ?? 10;
      const data = await fetchTrendingReposFromGitHub(authCtx.octokit, since, perPage, payload.language);
      await upsertGithubCacheEntry(authCtx.userId, buildTrendingReposCacheKey(since, perPage, payload.language), "trending_repos", data);
      return;
    }
    case "org_members": {
      if (!payload.orgName) return;
      const perPage = payload.perPage ?? 100;
      const data = await fetchOrgMembersFromGitHub(authCtx.octokit, payload.orgName, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildOrgMembersCacheKey(payload.orgName, perPage), "org_members", data);
      return;
    }
    case "user_profile": {
      if (!payload.username) return;
      const upKey = buildUserProfileCacheKey(payload.username);
      const upCached = await getGithubCacheEntry(authCtx.userId, upKey);
      try {
        const resp = await authCtx.octokit.users.getByUsername({
          username: payload.username,
          headers: upCached?.etag ? { "If-None-Match": upCached.etag } : {},
        } as any);
        await upsertGithubCacheEntry(authCtx.userId, upKey, "user_profile", resp.data, resp.headers?.etag ?? null);
      } catch (e: any) {
        if (e.status === 304) { await touchGithubCacheEntrySyncedAt(authCtx.userId, upKey); return; }
        throw e;
      }
      return;
    }
    case "user_public_repos": {
      if (!payload.username) return;
      const perPage = payload.perPage ?? 30;
      const data = await fetchUserPublicReposFromGitHub(authCtx.octokit, payload.username, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildUserPublicReposCacheKey(payload.username, perPage), "user_public_repos", data);
      return;
    }
    case "user_public_orgs": {
      if (!payload.username) return;
      const data = await fetchUserPublicOrgsFromGitHub(authCtx.octokit, payload.username);
      await upsertGithubCacheEntry(authCtx.userId, buildUserPublicOrgsCacheKey(payload.username), "user_public_orgs", data);
      return;
    }
  }

  // Jobs that require owner/repo
  if (!payload.owner || !payload.repo) return;

  const owner = payload.owner;
  const repo = payload.repo;

  switch (jobType) {
    case "repo": {
      const repoKey = buildRepoCacheKey(owner, repo);
      const repoCached = await getGithubCacheEntry(authCtx.userId, repoKey);
      const repoRes = await ghConditionalGet(authCtx.token, `/repos/${owner}/${repo}`, repoCached?.etag ?? null);
      if (repoRes.notModified) { await touchGithubCacheEntrySyncedAt(authCtx.userId, repoKey); }
      else { await upsertGithubCacheEntry(authCtx.userId, repoKey, "repo", repoRes.data, repoRes.etag); }
      return;
    }
    case "repo_contents": {
      const path = payload.path ?? "";
      const ref = normalizeRef(payload.ref);
      const data = await fetchRepoContentsFromGitHub(authCtx.octokit, owner, repo, path, ref || undefined);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoContentsCacheKey(owner, repo, path, ref), "repo_contents", data);
      return;
    }
    case "repo_tree": {
      if (!payload.treeSha) return;
      const recursive = payload.recursive === true;
      const data = await fetchRepoTreeFromGitHub(authCtx.octokit, owner, repo, payload.treeSha, recursive);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoTreeCacheKey(owner, repo, payload.treeSha, recursive), "repo_tree", data);
      return;
    }
    case "repo_branches": {
      const data = await fetchRepoBranchesFromGitHub(authCtx.octokit, owner, repo);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoBranchesCacheKey(owner, repo), "repo_branches", data);
      return;
    }
    case "repo_tags": {
      const data = await fetchRepoTagsFromGitHub(authCtx.octokit, owner, repo);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoTagsCacheKey(owner, repo), "repo_tags", data);
      return;
    }
    case "file_content": {
      const path = payload.path ?? "";
      const ref = normalizeRef(payload.ref);
      const data = await fetchFileContentFromGitHub(authCtx.octokit, owner, repo, path, ref || undefined);
      await upsertGithubCacheEntry(authCtx.userId, buildFileContentCacheKey(owner, repo, path, ref), "file_content", data);
      return;
    }
    case "repo_readme": {
      const ref = normalizeRef(payload.ref);
      const rdKey = buildRepoReadmeCacheKey(owner, repo, ref);
      const rdCached = await getGithubCacheEntry(authCtx.userId, rdKey);
      const rdPath = `/repos/${owner}/${repo}/readme${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`;
      try {
        const rdRes = await ghConditionalGet(authCtx.token, rdPath, rdCached?.etag ?? null);
        if (rdRes.notModified) { await touchGithubCacheEntrySyncedAt(authCtx.userId, rdKey); }
        else {
          const content = Buffer.from(rdRes.data.content, "base64").toString("utf-8");
          await upsertGithubCacheEntry(authCtx.userId, rdKey, "repo_readme", { ...rdRes.data, content }, rdRes.etag);
        }
      } catch (e: any) {
        // 404 = no readme
        if (e.message?.includes("404")) { await upsertGithubCacheEntry(authCtx.userId, rdKey, "repo_readme", null); return; }
        throw e;
      }
      return;
    }
    case "repo_issues": {
      const state = payload.state ?? "open";
      const data = await fetchRepoIssuesFromGitHub(authCtx.octokit, owner, repo, state);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoIssuesCacheKey(owner, repo, state), "repo_issues", data);
      return;
    }
    case "repo_pull_requests": {
      const state = payload.state ?? "open";
      const data = await fetchRepoPullRequestsFromGitHub(authCtx.octokit, owner, repo, state);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoPullRequestsCacheKey(owner, repo, state), "repo_pull_requests", data);
      return;
    }
    case "issue": {
      if (!payload.issueNumber) return;
      const isKey = buildIssueCacheKey(owner, repo, payload.issueNumber);
      const isCached = await getGithubCacheEntry(authCtx.userId, isKey);
      const isRes = await ghConditionalGet(authCtx.token, `/repos/${owner}/${repo}/issues/${payload.issueNumber}`, isCached?.etag ?? null);
      if (isRes.notModified) { await touchGithubCacheEntrySyncedAt(authCtx.userId, isKey); }
      else { await upsertGithubCacheEntry(authCtx.userId, isKey, "issue", isRes.data, isRes.etag); }
      return;
    }
    case "issue_comments": {
      if (!payload.issueNumber) return;
      const data = await fetchIssueCommentsFromGitHub(authCtx.octokit, owner, repo, payload.issueNumber);
      await upsertGithubCacheEntry(authCtx.userId, buildIssueCommentsCacheKey(owner, repo, payload.issueNumber), "issue_comments", data);
      return;
    }
    case "pull_request": {
      if (!payload.pullNumber) return;
      const prKey = buildPullRequestCacheKey(owner, repo, payload.pullNumber);
      const prCached = await getGithubCacheEntry(authCtx.userId, prKey);
      const prRes = await ghConditionalGet(authCtx.token, `/repos/${owner}/${repo}/pulls/${payload.pullNumber}`, prCached?.etag ?? null);
      if (prRes.notModified) { await touchGithubCacheEntrySyncedAt(authCtx.userId, prKey); }
      else { await upsertGithubCacheEntry(authCtx.userId, prKey, "pull_request", prRes.data, prRes.etag); }
      return;
    }
    case "pull_request_files": {
      if (!payload.pullNumber) return;
      const data = await fetchPullRequestFilesFromGitHub(authCtx.octokit, owner, repo, payload.pullNumber);
      await upsertGithubCacheEntry(authCtx.userId, buildPullRequestFilesCacheKey(owner, repo, payload.pullNumber), "pull_request_files", data);
      return;
    }
    case "pull_request_comments": {
      if (!payload.pullNumber) return;
      const data = await fetchPullRequestCommentsFromGitHub(authCtx.octokit, owner, repo, payload.pullNumber);
      await upsertGithubCacheEntry(authCtx.userId, buildPullRequestCommentsCacheKey(owner, repo, payload.pullNumber), "pull_request_comments", data);
      return;
    }
    case "pull_request_reviews": {
      if (!payload.pullNumber) return;
      const data = await fetchPullRequestReviewsFromGitHub(authCtx.octokit, owner, repo, payload.pullNumber);
      await upsertGithubCacheEntry(authCtx.userId, buildPullRequestReviewsCacheKey(owner, repo, payload.pullNumber), "pull_request_reviews", data);
      return;
    }
    case "pull_request_commits": {
      if (!payload.pullNumber) return;
      const data = await fetchPullRequestCommitsFromGitHub(authCtx.octokit, owner, repo, payload.pullNumber);
      await upsertGithubCacheEntry(authCtx.userId, buildPullRequestCommitsCacheKey(owner, repo, payload.pullNumber), "pull_request_commits", data);
      return;
    }
    case "repo_contributors": {
      const perPage = payload.perPage ?? 20;
      const data = await fetchRepoContributorsFromGitHub(authCtx.octokit, owner, repo, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoContributorsCacheKey(owner, repo, perPage), "repo_contributors", data);
      return;
    }
    case "repo_workflows": {
      const data = await fetchRepoWorkflowsFromGitHub(authCtx.octokit, owner, repo);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoWorkflowsCacheKey(owner, repo), "repo_workflows", data);
      return;
    }
    case "repo_workflow_runs": {
      const perPage = payload.perPage ?? 50;
      const data = await fetchRepoWorkflowRunsFromGitHub(authCtx.octokit, owner, repo, perPage);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoWorkflowRunsCacheKey(owner, repo, perPage), "repo_workflow_runs", data);
      return;
    }
    case "repo_nav_counts": {
      const openIssuesAndPrs = payload.openIssuesAndPrs ?? 0;
      const data = await fetchRepoNavCountsFromGitHub(authCtx.octokit, owner, repo, openIssuesAndPrs);
      await upsertGithubCacheEntry(authCtx.userId, buildRepoNavCountsCacheKey(owner, repo), "repo_nav_counts", data);
      return;
    }
    case "pr_bundle": {
      if (!payload.pullNumber) return;
      const data = await fetchPRBundleFromGitHub(authCtx.token, owner, repo, payload.pullNumber);
      if (data) {
        await upsertGithubCacheEntry(authCtx.userId, buildPRBundleCacheKey(owner, repo, payload.pullNumber), "pr_bundle", data);
      }
      return;
    }
    default:
      return;
  }
}

async function drainGitDataSyncQueue(authCtx: GitHubAuthContext, limit = 4) {
  const jobs = await claimDueGithubSyncJobs<GitDataSyncJobPayload>(authCtx.userId, limit);
  if (jobs.length === 0) return 0;

  for (const job of jobs) {
    try {
      await processGitDataSyncJob(
        authCtx,
        job.jobType as GitDataSyncJobType,
        job.payload
      );
      await markGithubSyncJobSucceeded(job.id);
    } catch (error) {
      await markGithubSyncJobFailed(job.id, job.attempts, getSyncErrorMessage(error));
    }
  }

  return jobs.length;
}

function triggerGitDataSyncDrain(authCtx: GitHubAuthContext) {
  if (githubSyncDrainingUsers.has(authCtx.userId)) return;

  githubSyncDrainingUsers.add(authCtx.userId);
  void (async () => {
    try {
      for (let round = 0; round < 3; round++) {
        const processed = await drainGitDataSyncQueue(authCtx, 4);
        if (processed === 0) break;
      }
    } finally {
      githubSyncDrainingUsers.delete(authCtx.userId);
    }
  })();
}

async function enqueueGitDataSync(
  authCtx: GitHubAuthContext,
  jobType: GitDataSyncJobType,
  cacheKey: string,
  payload: GitDataSyncJobPayload
) {
  await enqueueGithubSyncJob(authCtx.userId, `${jobType}:${cacheKey}`, jobType, payload);
  triggerGitDataSyncDrain(authCtx);
}

async function readLocalFirstGitData<T>({
  authCtx,
  cacheKey,
  cacheType,
  ttlMs,
  fallback,
  jobType,
  jobPayload,
  fetchRemote,
}: LocalFirstGitReadOptions<T>): Promise<T> {
  if (!authCtx) return fallback;

  if (authCtx.forceRefresh) {
    try {
      const data = await fetchRemote(authCtx.octokit);
      await upsertGithubCacheEntry(authCtx.userId, cacheKey, cacheType, data);
      return data;
    } catch {
      // Fall through to cached data on error
    }
  }

  const cached = await getGithubCacheEntry<T>(authCtx.userId, cacheKey);
  if (cached) {
    if (isStale(cached.syncedAt, ttlMs)) {
      await enqueueGitDataSync(authCtx, jobType, cacheKey, jobPayload);
    }
    return cached.data;
  }

  try {
    const data = await fetchRemote(authCtx.octokit);
    await upsertGithubCacheEntry(authCtx.userId, cacheKey, cacheType, data);
    return data;
  } catch (error) {
    const rl = isRateLimitError(error);
    if (rl) throw new GitHubRateLimitError(rl.resetAt, rl.limit, rl.used);
    await enqueueGitDataSync(authCtx, jobType, cacheKey, jobPayload);
    return fallback;
  }
}

export async function getGitHubToken(): Promise<string | null> {
  const authCtx = await getGitHubAuthContext();
  return authCtx?.token ?? null;
}

export async function getOctokit(): Promise<Octokit | null> {
  const authCtx = await getGitHubAuthContext();
  return authCtx?.octokit ?? null;
}

export async function getAuthenticatedUser() {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildAuthenticatedUserCacheKey(),
    cacheType: "authenticated_user",
    ttlMs: CACHE_TTL_MS.authenticatedUser,
    fallback: null,
    jobType: "authenticated_user",
    jobPayload: {},
    fetchRemote: (octokit) => fetchAuthenticatedUserFromGitHub(octokit),
  });
}

export async function getUserRepos(
  sort: RepoSort = "updated",
  perPage = 30
) {
  const authCtx = await getGitHubAuthContext();
  const cacheKey = buildUserReposCacheKey(sort, perPage);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "user_repos",
    ttlMs: CACHE_TTL_MS.userRepos,
    fallback: [],
    jobType: "user_repos",
    jobPayload: { sort, perPage },
    fetchRemote: (octokit) => fetchUserReposFromGitHub(octokit, sort, perPage),
  });
}

export async function getUserOrgs(perPage = 50) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildUserOrgsCacheKey(perPage),
    cacheType: "user_orgs",
    ttlMs: CACHE_TTL_MS.userOrgs,
    fallback: [],
    jobType: "user_orgs",
    jobPayload: { perPage },
    fetchRemote: (octokit) => fetchUserOrgsFromGitHub(octokit, perPage),
  });
}

export async function getOrgRepos(
  org: string,
  {
    perPage = 100,
    sort = "updated",
    type = "all",
  }: {
    perPage?: number;
    sort?: OrgRepoSort;
    type?: OrgRepoType;
  } = {}
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildOrgReposCacheKey(org, sort, type, perPage),
    cacheType: "org_repos",
    ttlMs: CACHE_TTL_MS.orgRepos,
    fallback: [],
    jobType: "org_repos",
    jobPayload: { orgName: org, orgSort: sort, orgType: type, perPage },
    fetchRemote: (octokit) => fetchOrgReposFromGitHub(octokit, org, sort, type, perPage),
  });
}

export async function getOrg(org: string) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildOrgCacheKey(org),
    cacheType: "org",
    ttlMs: CACHE_TTL_MS.org,
    fallback: null,
    jobType: "org",
    jobPayload: { orgName: org },
    fetchRemote: (octokit) => fetchOrgFromGitHub(octokit, org),
  });
}

export async function getNotifications(perPage = 20) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildNotificationsCacheKey(perPage),
    cacheType: "notifications",
    ttlMs: CACHE_TTL_MS.notifications,
    fallback: [],
    jobType: "notifications",
    jobPayload: { perPage },
    fetchRemote: (octokit) => fetchNotificationsFromGitHub(octokit, perPage),
  });
}

export async function searchIssues(query: string, perPage = 20) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildSearchIssuesCacheKey(query, perPage),
    cacheType: "search_issues",
    ttlMs: CACHE_TTL_MS.searchIssues,
    fallback: { items: [], total_count: 0, incomplete_results: false },
    jobType: "search_issues",
    jobPayload: { query, perPage },
    fetchRemote: (octokit) => fetchSearchIssuesFromGitHub(octokit, query, perPage),
  });
}

export async function getUserEvents(username: string, perPage = 30) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildUserEventsCacheKey(username, perPage),
    cacheType: "user_events",
    ttlMs: CACHE_TTL_MS.userEvents,
    fallback: [],
    jobType: "user_events",
    jobPayload: { username, perPage },
    fetchRemote: (octokit) => fetchUserEventsFromGitHub(octokit, username, perPage),
  });
}

export async function getContributionData(username: string) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildContributionsCacheKey(username),
    cacheType: "contributions",
    ttlMs: CACHE_TTL_MS.contributions,
    fallback: null,
    jobType: "contributions",
    jobPayload: { username },
    fetchRemote: async () => {
      if (!authCtx) return null;
      return fetchContributionsFromGitHub(authCtx.token, username);
    },
  });
}

export async function getStarredRepos(perPage = 10) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildStarredReposCacheKey(perPage),
    cacheType: "starred_repos",
    ttlMs: CACHE_TTL_MS.starredRepos,
    fallback: [],
    jobType: "starred_repos",
    jobPayload: { perPage },
    fetchRemote: (octokit) => fetchStarredReposFromGitHub(octokit, perPage),
  });
}

export async function getTrendingRepos(
  language?: string,
  since: "daily" | "weekly" | "monthly" = "weekly",
  perPage = 10
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildTrendingReposCacheKey(since, perPage, language),
    cacheType: "trending_repos",
    ttlMs: CACHE_TTL_MS.trendingRepos,
    fallback: [],
    jobType: "trending_repos",
    jobPayload: { since, perPage, language },
    fetchRemote: (octokit) => fetchTrendingReposFromGitHub(octokit, since, perPage, language),
  });
}

export async function getRepo(owner: string, repo: string) {
  const authCtx = await getGitHubAuthContext();
  const cacheKey = buildRepoCacheKey(owner, repo);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "repo",
    ttlMs: CACHE_TTL_MS.repo,
    fallback: null,
    jobType: "repo",
    jobPayload: { owner, repo },
    fetchRemote: (octokit) => fetchRepoFromGitHub(octokit, owner, repo),
  });
}

export async function checkIsStarred(owner: string, repo: string): Promise<boolean> {
  const token = await getGitHubToken();
  if (!token) return false;
  try {
    const res = await fetch(`https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

export async function getRepoContents(
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  const authCtx = await getGitHubAuthContext();
  const normalizedRef = normalizeRef(ref);
  const cacheKey = buildRepoContentsCacheKey(owner, repo, path, normalizedRef);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "repo_contents",
    ttlMs: CACHE_TTL_MS.repoContents,
    fallback: null,
    jobType: "repo_contents",
    jobPayload: { owner, repo, path, ref: normalizedRef },
    fetchRemote: (octokit) =>
      fetchRepoContentsFromGitHub(
        octokit,
        owner,
        repo,
        path,
        normalizedRef || undefined
      ),
  });
}

export async function getRepoTree(
  owner: string,
  repo: string,
  treeSha: string,
  recursive?: boolean
) {
  const authCtx = await getGitHubAuthContext();
  const recursiveFlag = recursive === true;
  const cacheKey = buildRepoTreeCacheKey(owner, repo, treeSha, recursiveFlag);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "repo_tree",
    ttlMs: CACHE_TTL_MS.repoTree,
    fallback: null,
    jobType: "repo_tree",
    jobPayload: { owner, repo, treeSha, recursive: recursiveFlag },
    fetchRemote: (octokit) =>
      fetchRepoTreeFromGitHub(octokit, owner, repo, treeSha, recursiveFlag),
  });
}

export async function getRepoBranches(owner: string, repo: string) {
  const authCtx = await getGitHubAuthContext();
  const cacheKey = buildRepoBranchesCacheKey(owner, repo);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "repo_branches",
    ttlMs: CACHE_TTL_MS.repoBranches,
    fallback: [],
    jobType: "repo_branches",
    jobPayload: { owner, repo },
    fetchRemote: (octokit) => fetchRepoBranchesFromGitHub(octokit, owner, repo),
  });
}

export async function getRepoTags(owner: string, repo: string) {
  const authCtx = await getGitHubAuthContext();
  const cacheKey = buildRepoTagsCacheKey(owner, repo);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "repo_tags",
    ttlMs: CACHE_TTL_MS.repoTags,
    fallback: [],
    jobType: "repo_tags",
    jobPayload: { owner, repo },
    fetchRemote: (octokit) => fetchRepoTagsFromGitHub(octokit, owner, repo),
  });
}

export async function getFileContent(
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  const authCtx = await getGitHubAuthContext();
  const normalizedRef = normalizeRef(ref);
  const cacheKey = buildFileContentCacheKey(owner, repo, path, normalizedRef);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "file_content",
    ttlMs: CACHE_TTL_MS.fileContent,
    fallback: null,
    jobType: "file_content",
    jobPayload: { owner, repo, path, ref: normalizedRef },
    fetchRemote: (octokit) =>
      fetchFileContentFromGitHub(
        octokit,
        owner,
        repo,
        path,
        normalizedRef || undefined
      ),
  });
}

export async function getRepoReadme(
  owner: string,
  repo: string,
  ref?: string
) {
  const authCtx = await getGitHubAuthContext();
  const normalizedRef = normalizeRef(ref);
  const cacheKey = buildRepoReadmeCacheKey(owner, repo, normalizedRef);

  return readLocalFirstGitData({
    authCtx,
    cacheKey,
    cacheType: "repo_readme",
    ttlMs: CACHE_TTL_MS.repoReadme,
    fallback: null,
    jobType: "repo_readme",
    jobPayload: { owner, repo, ref: normalizedRef },
    fetchRemote: (octokit) =>
      fetchRepoReadmeFromGitHub(octokit, owner, repo, normalizedRef || undefined),
  });
}

export async function getPullRequest(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPullRequestCacheKey(owner, repo, pullNumber),
    cacheType: "pull_request",
    ttlMs: CACHE_TTL_MS.pullRequest,
    fallback: null,
    jobType: "pull_request",
    jobPayload: { owner, repo, pullNumber },
    fetchRemote: (octokit) => fetchPullRequestFromGitHub(octokit, owner, repo, pullNumber),
  });
}

export async function getPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPullRequestFilesCacheKey(owner, repo, pullNumber),
    cacheType: "pull_request_files",
    ttlMs: CACHE_TTL_MS.pullRequestFiles,
    fallback: [],
    jobType: "pull_request_files",
    jobPayload: { owner, repo, pullNumber },
    fetchRemote: (octokit) => fetchPullRequestFilesFromGitHub(octokit, owner, repo, pullNumber),
  });
}

export async function getPullRequestComments(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPullRequestCommentsCacheKey(owner, repo, pullNumber),
    cacheType: "pull_request_comments",
    ttlMs: CACHE_TTL_MS.pullRequestComments,
    fallback: { issueComments: [], reviewComments: [] },
    jobType: "pull_request_comments",
    jobPayload: { owner, repo, pullNumber },
    fetchRemote: (octokit) => fetchPullRequestCommentsFromGitHub(octokit, owner, repo, pullNumber),
  });
}

export async function getPullRequestReviews(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPullRequestReviewsCacheKey(owner, repo, pullNumber),
    cacheType: "pull_request_reviews",
    ttlMs: CACHE_TTL_MS.pullRequestReviews,
    fallback: [],
    jobType: "pull_request_reviews",
    jobPayload: { owner, repo, pullNumber },
    fetchRemote: (octokit) => fetchPullRequestReviewsFromGitHub(octokit, owner, repo, pullNumber),
  });
}

export async function getPullRequestCommits(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPullRequestCommitsCacheKey(owner, repo, pullNumber),
    cacheType: "pull_request_commits",
    ttlMs: CACHE_TTL_MS.pullRequestCommits,
    fallback: [],
    jobType: "pull_request_commits",
    jobPayload: { owner, repo, pullNumber },
    fetchRemote: (octokit) => fetchPullRequestCommitsFromGitHub(octokit, owner, repo, pullNumber),
  });
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  diffSide: string;
  resolvedBy: { login: string } | null;
  comments: {
    id: string;
    databaseId: number;
    body: string;
    createdAt: string;
    author: { login: string; avatarUrl: string } | null;
    reviewState: string | null;
  }[];
}

export async function getPullRequestReviewThreads(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ReviewThread[]> {
  const token = await getGitHubToken();
  if (!token) return [];

  const query = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              isOutdated
              path
              line
              startLine
              diffSide
              resolvedBy {
                login
              }
              comments(first: 30) {
                nodes {
                  id
                  databaseId
                  body
                  createdAt
                  author {
                    login
                    avatarUrl
                  }
                  pullRequestReview {
                    state
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { owner, repo, number: pullNumber },
      }),
    });

    if (!response.ok) return [];
    const json = await response.json();
    const nodes =
      json.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];

    return nodes.map((thread: any) => ({
      id: thread.id,
      isResolved: thread.isResolved ?? false,
      isOutdated: thread.isOutdated ?? false,
      path: thread.path ?? "",
      line: thread.line ?? null,
      startLine: thread.startLine ?? null,
      diffSide: thread.diffSide ?? "RIGHT",
      resolvedBy: thread.resolvedBy
        ? { login: thread.resolvedBy.login }
        : null,
      comments: (thread.comments?.nodes ?? []).map((c: any) => ({
        id: c.id,
        databaseId: c.databaseId,
        body: c.body ?? "",
        createdAt: c.createdAt ?? "",
        author: c.author
          ? { login: c.author.login, avatarUrl: c.author.avatarUrl }
          : null,
        reviewState: c.pullRequestReview?.state ?? null,
      })),
    }));
  } catch {
    return [];
  }
}

// --- PR Bundle (GraphQL) ---

export interface PRBundleData {
  pr: {
    number: number;
    title: string;
    body: string | null;
    state: string;
    draft: boolean;
    created_at: string;
    merged_at: string | null;
    mergeable: boolean | null;
    additions: number;
    deletions: number;
    changed_files: number;
    user: { login: string; avatar_url: string; type?: string } | null;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    labels: { name: string; color: string | null; description: string | null }[];
    reactions: any;
  };
  issueComments: {
    id: number;
    body: string;
    created_at: string;
    user: { login: string; avatar_url: string; type?: string } | null;
    author_association: string;
    reactions: any;
  }[];
  reviewComments: {
    id: number;
    body: string;
    path: string;
    line: number | null;
    created_at: string;
    user: { login: string; avatar_url: string; type?: string } | null;
    pull_request_review_id: number;
  }[];
  reviews: {
    id: number;
    body: string | null;
    state: string;
    created_at: string;
    submitted_at: string | null;
    user: { login: string; avatar_url: string; type?: string } | null;
  }[];
  reviewThreads: ReviewThread[];
  commits: {
    sha: string;
    commit: { message: string; author: { name: string; date: string } | null; committer: { name: string; date: string } | null };
    author: { login: string; avatar_url: string } | null;
  }[];
}

const PR_BUNDLE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        number
        title
        body
        state
        isDraft
        createdAt
        mergedAt
        mergeable
        additions
        deletions
        changedFiles
        author { __typename login avatarUrl }
        headRefName
        headRefOid
        baseRefName
        baseRefOid
        labels(first: 20) {
          nodes { name color description }
        }
        reactions(first: 1) { totalCount }
        reactionGroups {
          content
          reactors { totalCount }
        }
        comments(first: 100) {
          nodes {
            databaseId
            body
            createdAt
            author { __typename login avatarUrl }
            authorAssociation
            reactionGroups {
              content
              reactors { totalCount }
            }
          }
        }
        reviews(first: 100) {
          nodes {
            databaseId
            body
            state
            createdAt
            submittedAt
            author { __typename login avatarUrl }
            comments(first: 50) {
              nodes {
                databaseId
                body
                path
                line
                originalLine
                createdAt
                author { __typename login avatarUrl }
              }
            }
          }
        }
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            startLine
            diffSide
            resolvedBy { login }
            comments(first: 30) {
              nodes {
                id
                databaseId
                body
                createdAt
                author { __typename login avatarUrl }
                pullRequestReview { state }
              }
            }
          }
        }
        commits(first: 100) {
          nodes {
            commit {
              oid
              message
              author { name date }
              committer { name date }
            }
            resourcePath
          }
        }
      }
    }
  }
`;

function mapReactionGroups(groups: any[] | undefined): any {
  if (!groups) return undefined;
  const map: Record<string, number> = {};
  let total = 0;
  for (const g of groups) {
    const count = g.reactors?.totalCount ?? 0;
    if (count > 0) {
      const key = (g.content as string).toLowerCase()
        .replace("thumbs_up", "+1")
        .replace("thumbs_down", "-1");
      map[key] = count;
      total += count;
    }
  }
  return { ...map, total_count: total };
}

function transformGraphQLPRBundle(node: any): PRBundleData {
  const stateMap: Record<string, string> = { OPEN: "open", CLOSED: "closed", MERGED: "closed" };
  const mergeableMap: Record<string, boolean | null> = { MERGEABLE: true, CONFLICTING: false, UNKNOWN: null };

  const pr = {
    number: node.number,
    title: node.title,
    body: node.body,
    state: stateMap[node.state] ?? "open",
    draft: node.isDraft ?? false,
    created_at: node.createdAt,
    merged_at: node.mergedAt ?? null,
    mergeable: mergeableMap[node.mergeable] ?? null,
    additions: node.additions ?? 0,
    deletions: node.deletions ?? 0,
    changed_files: node.changedFiles ?? 0,
    user: node.author ? { login: node.author.login, avatar_url: node.author.avatarUrl, type: node.author.__typename } : null,
    head: { ref: node.headRefName, sha: node.headRefOid },
    base: { ref: node.baseRefName, sha: node.baseRefOid },
    labels: (node.labels?.nodes ?? []).map((l: any) => ({
      name: l.name,
      color: l.color ?? null,
      description: l.description ?? null,
    })),
    reactions: mapReactionGroups(node.reactionGroups),
  };

  const issueComments = (node.comments?.nodes ?? []).map((c: any) => ({
    id: c.databaseId,
    body: c.body ?? "",
    created_at: c.createdAt,
    user: c.author ? { login: c.author.login, avatar_url: c.author.avatarUrl, type: c.author.__typename } : null,
    author_association: c.authorAssociation ?? "NONE",
    reactions: mapReactionGroups(c.reactionGroups),
  }));

  const reviewComments: PRBundleData["reviewComments"] = [];
  const reviews = (node.reviews?.nodes ?? []).map((r: any) => {
    const reviewId = r.databaseId;
    for (const rc of r.comments?.nodes ?? []) {
      reviewComments.push({
        id: rc.databaseId,
        body: rc.body ?? "",
        path: rc.path ?? "",
        line: rc.line ?? rc.originalLine ?? null,
        created_at: rc.createdAt,
        user: rc.author ? { login: rc.author.login, avatar_url: rc.author.avatarUrl, type: rc.author.__typename } : null,
        pull_request_review_id: reviewId,
      });
    }
    return {
      id: reviewId,
      body: r.body || null,
      state: r.state,
      created_at: r.createdAt,
      submitted_at: r.submittedAt ?? null,
      user: r.author ? { login: r.author.login, avatar_url: r.author.avatarUrl, type: r.author.__typename } : null,
    };
  });

  const reviewThreads: ReviewThread[] = (node.reviewThreads?.nodes ?? []).map((thread: any) => ({
    id: thread.id,
    isResolved: thread.isResolved ?? false,
    isOutdated: thread.isOutdated ?? false,
    path: thread.path ?? "",
    line: thread.line ?? null,
    startLine: thread.startLine ?? null,
    diffSide: thread.diffSide ?? "RIGHT",
    resolvedBy: thread.resolvedBy ? { login: thread.resolvedBy.login } : null,
    comments: (thread.comments?.nodes ?? []).map((c: any) => ({
      id: c.id,
      databaseId: c.databaseId,
      body: c.body ?? "",
      createdAt: c.createdAt ?? "",
      author: c.author ? { login: c.author.login, avatarUrl: c.author.avatarUrl } : null,
      reviewState: c.pullRequestReview?.state ?? null,
    })),
  }));

  const commits = (node.commits?.nodes ?? []).map((n: any) => {
    const c = n.commit;
    return {
      sha: c.oid,
      commit: {
        message: c.message,
        author: c.author ? { name: c.author.name, date: c.author.date } : null,
        committer: c.committer ? { name: c.committer.name, date: c.committer.date } : null,
      },
      author: null, // GraphQL commits don't include the GitHub user association directly
    };
  });

  return { pr, issueComments, reviewComments, reviews, reviewThreads, commits };
}

async function fetchPRBundleFromGitHub(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PRBundleData | null> {
  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: PR_BUNDLE_QUERY,
        variables: { owner, repo, number: pullNumber },
      }),
    });

    if (!response.ok) return null;
    const json = await response.json();
    const prNode = json.data?.repository?.pullRequest;
    if (!prNode) return null;

    return transformGraphQLPRBundle(prNode);
  } catch {
    return null;
  }
}

export async function getPullRequestBundle(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<PRBundleData | null> {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPRBundleCacheKey(owner, repo, pullNumber),
    cacheType: "pr_bundle",
    ttlMs: CACHE_TTL_MS.prBundle,
    fallback: null,
    jobType: "pr_bundle",
    jobPayload: { owner, repo, pullNumber },
    fetchRemote: () => fetchPRBundleFromGitHub(authCtx!.token, owner, repo, pullNumber),
  });
}

export async function getIssue(
  owner: string,
  repo: string,
  issueNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildIssueCacheKey(owner, repo, issueNumber),
    cacheType: "issue",
    ttlMs: CACHE_TTL_MS.issue,
    fallback: null,
    jobType: "issue",
    jobPayload: { owner, repo, issueNumber },
    fetchRemote: (octokit) => fetchIssueFromGitHub(octokit, owner, repo, issueNumber),
  });
}

export async function getIssueComments(
  owner: string,
  repo: string,
  issueNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildIssueCommentsCacheKey(owner, repo, issueNumber),
    cacheType: "issue_comments",
    ttlMs: CACHE_TTL_MS.issueComments,
    fallback: [],
    jobType: "issue_comments",
    jobPayload: { owner, repo, issueNumber },
    fetchRemote: (octokit) => fetchIssueCommentsFromGitHub(octokit, owner, repo, issueNumber),
  });
}

export interface LinkedPullRequest {
  number: number;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  user: { login: string; avatar_url: string } | null;
  html_url: string;
  repoOwner: string;
  repoName: string;
}

export async function getLinkedPullRequests(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<LinkedPullRequest[]> {
  const octokit = await getOctokit();
  if (!octokit) return [];

  try {
    const events = await octokit.paginate(
      octokit.issues.listEventsForTimeline as any,
      { owner, repo, issue_number: issueNumber, per_page: 100 }
    );

    const seen = new Set<string>();
    const linkedPRs: LinkedPullRequest[] = [];

    for (const event of events as any[]) {
      if (event.event !== "cross-referenced") continue;
      const source = event.source?.issue;
      if (!source?.pull_request) continue;

      const prRepoFullName = source.repository?.full_name as string | undefined;
      const prKey = prRepoFullName
        ? `${prRepoFullName}#${source.number}`
        : `${source.number}`;
      if (seen.has(prKey)) continue;
      seen.add(prKey);

      const [prOwner, prName] = prRepoFullName
        ? prRepoFullName.split("/")
        : [owner, repo];

      linkedPRs.push({
        number: source.number,
        title: source.title,
        state: source.state,
        merged: !!source.pull_request.merged_at,
        user: source.user
          ? { login: source.user.login, avatar_url: source.user.avatar_url }
          : null,
        html_url: source.html_url,
        repoOwner: prOwner,
        repoName: prName,
      });
    }

    return linkedPRs;
  } catch {
    return [];
  }
}

export async function getRepoIssues(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open"
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildRepoIssuesCacheKey(owner, repo, state),
    cacheType: "repo_issues",
    ttlMs: CACHE_TTL_MS.repoIssues,
    fallback: [],
    jobType: "repo_issues",
    jobPayload: { owner, repo, state },
    fetchRemote: (octokit) => fetchRepoIssuesFromGitHub(octokit, owner, repo, state),
  });
}

export async function invalidateRepoPullRequestsCache(
  owner: string,
  repo: string
) {
  const authCtx = await getGitHubAuthContext();
  if (!authCtx) return;
  const prefix = `repo_pull_requests:${normalizeRepoKey(owner, repo)}`;
  await deleteGithubCacheByPrefix(authCtx.userId, prefix);
}

export async function invalidatePullRequestCache(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  if (!authCtx) return;
  // Invalidate the PR detail + list caches
  const key = normalizeRepoKey(owner, repo);
  await deleteGithubCacheByPrefix(authCtx.userId, `pr_bundle:${key}:${pullNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `pull_request:${key}:${pullNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `pull_request_comments:${key}:${pullNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `pull_request_reviews:${key}:${pullNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `pull_request_commits:${key}:${pullNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `pull_request_files:${key}:${pullNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `repo_pull_requests:${key}`);
}

export async function invalidateFileContentCache(
  owner: string,
  repo: string,
  path: string,
  ref?: string
) {
  const authCtx = await getGitHubAuthContext();
  if (!authCtx) return;
  const key = buildFileContentCacheKey(owner, repo, path, ref);
  await deleteGithubCacheByPrefix(authCtx.userId, key);
}

export async function invalidateRepoIssuesCache(
  owner: string,
  repo: string
) {
  const authCtx = await getGitHubAuthContext();
  if (!authCtx) return;
  const prefix = `repo_issues:${normalizeRepoKey(owner, repo)}`;
  await deleteGithubCacheByPrefix(authCtx.userId, prefix);
}

export async function invalidateIssueCache(
  owner: string,
  repo: string,
  issueNumber: number
) {
  const authCtx = await getGitHubAuthContext();
  if (!authCtx) return;
  const key = normalizeRepoKey(owner, repo);
  await deleteGithubCacheByPrefix(authCtx.userId, `issue:${key}:${issueNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `issue_comments:${key}:${issueNumber}`);
  await deleteGithubCacheByPrefix(authCtx.userId, `repo_issues:${key}`);
}

export async function getRepoPullRequests(
  owner: string,
  repo: string,
  state: "open" | "closed" | "all" = "open"
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildRepoPullRequestsCacheKey(owner, repo, state),
    cacheType: "repo_pull_requests",
    ttlMs: CACHE_TTL_MS.repoPullRequests,
    fallback: [],
    jobType: "repo_pull_requests",
    jobPayload: { owner, repo, state },
    fetchRemote: (octokit) => fetchRepoPullRequestsFromGitHub(octokit, owner, repo, state),
  });
}

export async function enrichPRsWithStats(
  owner: string,
  repo: string,
  prs: { number: number }[]
) {
  const octokit = await getOctokit();
  if (!octokit) return new Map<number, { additions: number; deletions: number; changed_files: number }>();

  const results = await Promise.all(
    prs.map((pr) =>
      octokit.pulls.get({ owner, repo, pull_number: pr.number }).then(
        (r) => ({
          number: pr.number,
          additions: r.data.additions,
          deletions: r.data.deletions,
          changed_files: r.data.changed_files,
        }),
        () => null
      )
    )
  );

  const map = new Map<number, { additions: number; deletions: number; changed_files: number }>();
  for (const result of results) {
    if (result) {
      map.set(result.number, {
        additions: result.additions,
        deletions: result.deletions,
        changed_files: result.changed_files,
      });
    }
  }
  return map;
}

export interface CheckRun {
  name: string;
  state: "success" | "failure" | "pending" | "error" | "neutral" | "skipped";
  url: string | null;
  runId: number | null;
}

export interface CheckStatus {
  state: "pending" | "success" | "failure" | "error";
  total: number;
  success: number;
  failure: number;
  pending: number;
  checks: CheckRun[];
}

function normalizeCheckConclusion(
  status: string,
  conclusion: string | null
): CheckRun["state"] {
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") return "failure";
    if (conclusion === "skipped") return "skipped";
    if (conclusion === "neutral") return "neutral";
    if (conclusion === "action_required" || conclusion === "stale") return "pending";
    return "failure";
  }
  return "pending";
}

async function fetchCheckStatusForRef(
  octokit: Awaited<ReturnType<typeof getOctokit>>,
  owner: string,
  repo: string,
  ref: string
): Promise<CheckStatus | null> {
  if (!octokit) return null;

  let commitStatuses: Awaited<ReturnType<typeof octokit.repos.getCombinedStatusForRef>> | null = null;
  let checkRuns: Awaited<ReturnType<typeof octokit.checks.listForRef>> | null = null;

  try {
    commitStatuses = await octokit.repos.getCombinedStatusForRef({ owner, repo, ref });
  } catch {
    // Token may lack repo status permissions
  }

  try {
    checkRuns = await octokit.checks.listForRef({ owner, repo, ref, per_page: 100 });
  } catch {
    // Token may lack checks permission (403 for some repos)
  }

  const checks: CheckRun[] = [];

  if (commitStatuses?.data.statuses) {
    for (const s of commitStatuses.data.statuses) {
      checks.push({
        name: s.context,
        state: s.state === "success" ? "success" : s.state === "pending" ? "pending" : "failure",
        url: s.target_url || null,
        runId: null,
      });
    }
  }

  if (checkRuns?.data.check_runs) {
    for (const cr of checkRuns.data.check_runs) {
      const runIdMatch = cr.html_url?.match(/\/actions\/runs\/(\d+)/);
      checks.push({
        name: cr.name,
        state: normalizeCheckConclusion(cr.status, cr.conclusion),
        url: cr.html_url || (cr.details_url as string | null) || null,
        runId: runIdMatch ? Number(runIdMatch[1]) : null,
      });
    }
  }

  if (checks.length === 0) return null;

  const success = checks.filter((c) => c.state === "success" || c.state === "neutral" || c.state === "skipped").length;
  const failure = checks.filter((c) => c.state === "failure" || c.state === "error").length;
  const pending = checks.filter((c) => c.state === "pending").length;

  const state: CheckStatus["state"] =
    failure > 0 ? "failure" : pending > 0 ? "pending" : "success";

  return { state, total: checks.length, success, failure, pending, checks };
}

export async function enrichPRsWithCheckStatus(
  owner: string,
  repo: string,
  prs: { number: number; head: { sha: string } }[]
): Promise<Map<number, CheckStatus>> {
  const octokit = await getOctokit();
  if (!octokit) return new Map();

  const results = await Promise.allSettled(
    prs.map((pr) =>
      fetchCheckStatusForRef(octokit, owner, repo, pr.head.sha).then((cs) => ({
        number: pr.number,
        checkStatus: cs,
      }))
    )
  );

  const map = new Map<number, CheckStatus>();
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.checkStatus) {
      map.set(result.value.number, result.value.checkStatus);
    }
  }
  return map;
}

export { fetchCheckStatusForRef };

export type SecurityFeatureStatus =
  | "enabled"
  | "disabled"
  | "not_set"
  | "unknown";

export interface RepoSecurityFeatures {
  advancedSecurity: SecurityFeatureStatus;
  dependabotAlerts: SecurityFeatureStatus;
  dependabotSecurityUpdates: SecurityFeatureStatus;
  codeScanning: SecurityFeatureStatus;
  secretScanning: SecurityFeatureStatus;
  secretScanningPushProtection: SecurityFeatureStatus;
  privateVulnerabilityReporting: SecurityFeatureStatus;
}

export interface DependabotAlertSummary {
  number: number;
  state: string;
  severity: string | null;
  packageName: string | null;
  ecosystem: string | null;
  summary: string;
  createdAt: string;
  htmlUrl: string;
}

export interface CodeScanningAlertSummary {
  number: number;
  state: string;
  severity: string | null;
  ruleId: string | null;
  ruleDescription: string | null;
  toolName: string | null;
  path: string | null;
  createdAt: string;
  htmlUrl: string;
}

export interface SecretScanningAlertSummary {
  number: number;
  state: string;
  secretType: string | null;
  secretTypeDisplayName: string | null;
  resolution: string | null;
  createdAt: string;
  htmlUrl: string;
}

export interface SecurityReportSummary {
  ghsaId: string;
  cveId: string | null;
  state: string;
  severity: string | null;
  summary: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  htmlUrl: string;
  acceptedPrivateReport: boolean;
}

export interface RepoSecurityAlertsResult<T> {
  alerts: T[];
  error: string | null;
}

export interface RepoSecurityTabData {
  features: RepoSecurityFeatures | null;
  featuresError: string | null;
  reports: RepoSecurityAlertsResult<SecurityReportSummary>;
  dependabot: RepoSecurityAlertsResult<DependabotAlertSummary>;
  secretScanning: RepoSecurityAlertsResult<SecretScanningAlertSummary>;
  permissions: RepoPermissions;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSecurityStatus(status: unknown): SecurityFeatureStatus {
  if (status === "enabled" || status === "disabled" || status === "not_set") {
    return status;
  }
  return "unknown";
}

function readFeatureStatus(
  settings: Record<string, unknown> | null,
  key: string
): SecurityFeatureStatus {
  if (!settings) return "unknown";
  const setting = asRecord(settings[key]);
  return normalizeSecurityStatus(setting?.status);
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : null;
}

function getErrorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "Unknown error";
  }
  const value = (error as { message?: unknown }).message;
  return typeof value === "string" && value.trim()
    ? value
    : "Unknown error";
}

function formatSecurityError(feature: string, error: unknown): string {
  const status = getErrorStatus(error);
  if (status === 403) {
    return `${feature}: permission denied. Reconnect GitHub with the security_events scope.`;
  }
  if (status === 404) {
    return `${feature}: not available for this repository or your access level.`;
  }
  return `${feature}: ${getErrorMessage(error)}`;
}

function mapDependabotAlert(alert: unknown): DependabotAlertSummary {
  const row = asRecord(alert);
  const vulnerability = asRecord(row?.security_vulnerability);
  const dependency = asRecord(row?.dependency);
  const packageInfo =
    asRecord(dependency?.package) ?? asRecord(vulnerability?.package);
  const advisory = asRecord(row?.security_advisory);

  return {
    number: asNumber(row?.number) ?? 0,
    state: asString(row?.state) ?? "unknown",
    severity: asString(vulnerability?.severity),
    packageName: asString(packageInfo?.name),
    ecosystem: asString(packageInfo?.ecosystem),
    summary: asString(advisory?.summary) ?? "No summary available",
    createdAt: asString(row?.created_at) ?? "",
    htmlUrl: asString(row?.html_url) ?? "",
  };
}

function mapCodeScanningAlert(alert: unknown): CodeScanningAlertSummary {
  const row = asRecord(alert);
  const rule = asRecord(row?.rule);
  const tool = asRecord(row?.tool);
  const instance = asRecord(row?.most_recent_instance);
  const location = asRecord(instance?.location);

  return {
    number: asNumber(row?.number) ?? 0,
    state: asString(row?.state) ?? "unknown",
    severity:
      asString(rule?.severity) ?? asString(rule?.security_severity_level),
    ruleId: asString(rule?.id),
    ruleDescription: asString(rule?.description) ?? asString(rule?.name),
    toolName: asString(tool?.name),
    path: asString(location?.path),
    createdAt: asString(row?.created_at) ?? "",
    htmlUrl: asString(row?.html_url) ?? "",
  };
}

function mapSecretScanningAlert(alert: unknown): SecretScanningAlertSummary {
  const row = asRecord(alert);

  return {
    number: asNumber(row?.number) ?? 0,
    state: asString(row?.state) ?? "unknown",
    secretType: asString(row?.secret_type),
    secretTypeDisplayName: asString(row?.secret_type_display_name),
    resolution: asString(row?.resolution),
    createdAt: asString(row?.created_at) ?? "",
    htmlUrl: asString(row?.html_url) ?? "",
  };
}

function mapSecurityReport(report: unknown): SecurityReportSummary {
  const row = asRecord(report);
  const submission = asRecord(row?.submission);

  return {
    ghsaId: asString(row?.ghsa_id) ?? "",
    cveId: asString(row?.cve_id),
    state: asString(row?.state) ?? "unknown",
    severity: asString(row?.severity),
    summary: asString(row?.summary) ?? "No summary available",
    createdAt: asString(row?.created_at) ?? "",
    updatedAt: asString(row?.updated_at) ?? "",
    publishedAt: asString(row?.published_at),
    closedAt: asString(row?.closed_at),
    htmlUrl: asString(row?.html_url) ?? "",
    acceptedPrivateReport: submission?.accepted === true,
  };
}

function extractRepoSecurityFeatures(repoData: unknown): RepoSecurityFeatures | null {
  const repo = asRecord(repoData);
  const settings = asRecord(repo?.security_and_analysis);
  if (!settings) return null;

  return {
    advancedSecurity: readFeatureStatus(settings, "advanced_security"),
    dependabotAlerts: readFeatureStatus(settings, "dependabot_alerts"),
    dependabotSecurityUpdates: readFeatureStatus(
      settings,
      "dependabot_security_updates"
    ),
    codeScanning: readFeatureStatus(settings, "code_scanning"),
    secretScanning: readFeatureStatus(settings, "secret_scanning"),
    secretScanningPushProtection: readFeatureStatus(
      settings,
      "secret_scanning_push_protection"
    ),
    privateVulnerabilityReporting: readFeatureStatus(
      settings,
      "private_vulnerability_reporting"
    ),
  };
}

export async function getRepoSecurityTabData(
  owner: string,
  repo: string,
  perPage = 20
): Promise<RepoSecurityTabData | null> {
  const octokit = await getOctokit();
  if (!octokit) return null;

  const [repoResult, reports, dependabot, secretScanning] =
    await Promise.all([
      octokit.repos
        .get({ owner, repo })
        .then((result) => ({
          data: result.data,
          error: null as string | null,
        }))
        .catch((error: unknown) => ({
          data: null,
          error: formatSecurityError("Security settings", error),
        })),
      octokit.securityAdvisories
        .listRepositoryAdvisories({
          owner,
          repo,
          per_page: perPage,
          sort: "updated",
          direction: "desc",
        })
        .then((result) => ({
          alerts: result.data.map((advisory) => mapSecurityReport(advisory)),
          error: null as string | null,
        }))
        .catch((error: unknown) => ({
          alerts: [] as SecurityReportSummary[],
          error: formatSecurityError("Security reports", error),
        })),
      octokit.dependabot
        .listAlertsForRepo({ owner, repo, per_page: perPage, state: "open" })
        .then((result) => ({
          alerts: result.data.map((alert) => mapDependabotAlert(alert)),
          error: null as string | null,
        }))
        .catch((error: unknown) => ({
          alerts: [] as DependabotAlertSummary[],
          error: formatSecurityError("Dependabot alerts", error),
        })),
      octokit.secretScanning
        .listAlertsForRepo({ owner, repo, per_page: perPage, state: "open" })
        .then((result) => ({
          alerts: result.data.map((alert) => mapSecretScanningAlert(alert)),
          error: null as string | null,
        }))
        .catch((error: unknown) => ({
          alerts: [] as SecretScanningAlertSummary[],
          error: formatSecurityError("Secret scanning alerts", error),
        })),
    ]);

  return {
    features: extractRepoSecurityFeatures(repoResult.data),
    featuresError: repoResult.error,
    reports,
    dependabot,
    secretScanning,
    permissions: extractRepoPermissions(repoResult.data),
  };
}

export interface SecurityAdvisoryDetail {
  ghsaId: string;
  cveId: string | null;
  state: string;
  severity: string | null;
  cvss: { score: number; vectorString: string } | null;
  cwes: { cweId: string; name: string }[];
  summary: string;
  description: string | null;
  vulnerabilities: {
    packageName: string | null;
    ecosystem: string | null;
    vulnerableVersionRange: string | null;
    patchedVersions: string | null;
  }[];
  credits: { login: string; avatarUrl: string; type: string }[];
  author: { login: string; avatarUrl: string } | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  htmlUrl: string;
}

function mapAdvisoryDetail(data: unknown): SecurityAdvisoryDetail {
  const row = asRecord(data);
  const cvss = asRecord(row?.cvss);
  const cwes = Array.isArray(row?.cwes)
    ? (row.cwes as unknown[]).map((c) => {
        const cwe = asRecord(c);
        return {
          cweId: asString(cwe?.cwe_id) ?? "",
          name: asString(cwe?.name) ?? "",
        };
      })
    : [];
  const vulnerabilities = Array.isArray(row?.vulnerabilities)
    ? (row.vulnerabilities as unknown[]).map((v) => {
        const vuln = asRecord(v);
        const pkg = asRecord(vuln?.package);
        const firstPatched = asRecord(vuln?.first_patched_version);
        return {
          packageName: asString(pkg?.name),
          ecosystem: asString(pkg?.ecosystem),
          vulnerableVersionRange: asString(vuln?.vulnerable_version_range),
          patchedVersions: asString(firstPatched?.identifier),
        };
      })
    : [];
  const credits = Array.isArray(row?.credits)
    ? (row.credits as unknown[]).map((c) => {
        const credit = asRecord(c);
        const user = asRecord(credit?.user);
        return {
          login: asString(user?.login) ?? "",
          avatarUrl: asString(user?.avatar_url) ?? "",
          type: asString(credit?.type) ?? "",
        };
      })
    : [];
  const authorRaw = asRecord(row?.author);

  const cvssScore = asNumber(cvss?.score);
  const cvssVector = asString(cvss?.vector_string);

  return {
    ghsaId: asString(row?.ghsa_id) ?? "",
    cveId: asString(row?.cve_id),
    state: asString(row?.state) ?? "unknown",
    severity: asString(row?.severity),
    cvss:
      cvssScore !== null && cvssVector
        ? { score: cvssScore, vectorString: cvssVector }
        : null,
    cwes,
    summary: asString(row?.summary) ?? "No summary available",
    description: asString(row?.description),
    vulnerabilities,
    credits,
    author: authorRaw
      ? {
          login: asString(authorRaw.login) ?? "",
          avatarUrl: asString(authorRaw.avatar_url) ?? "",
        }
      : null,
    createdAt: asString(row?.created_at) ?? "",
    updatedAt: asString(row?.updated_at) ?? "",
    publishedAt: asString(row?.published_at),
    closedAt: asString(row?.closed_at),
    htmlUrl: asString(row?.html_url) ?? "",
  };
}

export async function getRepositoryAdvisory(
  owner: string,
  repo: string,
  ghsaId: string
): Promise<SecurityAdvisoryDetail | null> {
  const octokit = await getOctokit();
  if (!octokit) return null;

  try {
    const { data } = await (octokit.securityAdvisories as any).getRepositoryAdvisory({
      owner,
      repo,
      ghsa_id: ghsaId,
    });
    return mapAdvisoryDetail(data);
  } catch {
    return null;
  }
}

export async function searchGitHubRepos(
  query: string,
  language?: string,
  sort: "stars" | "updated" | "best-match" = "best-match",
  perPage = 20
) {
  const octokit = await getOctokit();
  if (!octokit) return { items: [], total_count: 0 };

  const q = language ? `${query} language:${language}` : query;

  const { data } = await octokit.search.repos({
    q,
    sort: sort === "best-match" ? undefined : sort,
    order: "desc",
    per_page: perPage,
  });

  return { items: data.items, total_count: data.total_count };
}

export async function getRepoNavCounts(
  owner: string,
  repo: string,
  openIssuesAndPrs: number
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildRepoNavCountsCacheKey(owner, repo),
    cacheType: "repo_nav_counts",
    ttlMs: CACHE_TTL_MS.repoNavCounts,
    fallback: { openPrs: 0, openIssues: 0, activeRuns: 0 },
    jobType: "repo_nav_counts",
    jobPayload: { owner, repo, openIssuesAndPrs },
    fetchRemote: (octokit) => fetchRepoNavCountsFromGitHub(octokit, owner, repo, openIssuesAndPrs),
  });
}

export async function getRepoWorkflows(owner: string, repo: string) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildRepoWorkflowsCacheKey(owner, repo),
    cacheType: "repo_workflows",
    ttlMs: CACHE_TTL_MS.repoWorkflows,
    fallback: [],
    jobType: "repo_workflows",
    jobPayload: { owner, repo },
    fetchRemote: (octokit) => fetchRepoWorkflowsFromGitHub(octokit, owner, repo),
  });
}

export async function getRepoWorkflowRuns(
  owner: string,
  repo: string,
  perPage = 50
) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildRepoWorkflowRunsCacheKey(owner, repo, perPage),
    cacheType: "repo_workflow_runs",
    ttlMs: CACHE_TTL_MS.repoWorkflowRuns,
    fallback: [],
    jobType: "repo_workflow_runs",
    jobPayload: { owner, repo, perPage },
    fetchRemote: (octokit) => fetchRepoWorkflowRunsFromGitHub(octokit, owner, repo, perPage),
  });
}

export async function getWorkflowRun(
  owner: string,
  repo: string,
  runId: number
) {
  const octokit = await getOctokit();
  if (!octokit) return null;
  const { data } = await octokit.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId,
  });
  return data;
}

export async function getWorkflowRunJobs(
  owner: string,
  repo: string,
  runId: number
) {
  const octokit = await getOctokit();
  if (!octokit) return [];
  const { data } = await octokit.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: runId,
    per_page: 100,
  });
  return data.jobs;
}

export async function getRepoContributors(
  owner: string,
  repo: string,
  perPage = 20
): Promise<{ list: { login: string; avatar_url: string; contributions: number; html_url: string }[]; totalCount: number }> {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildRepoContributorsCacheKey(owner, repo, perPage),
    cacheType: "repo_contributors",
    ttlMs: CACHE_TTL_MS.repoContributors,
    fallback: { list: [], totalCount: 0 },
    jobType: "repo_contributors",
    jobPayload: { owner, repo, perPage },
    fetchRemote: (octokit) => fetchRepoContributorsFromGitHub(octokit, owner, repo, perPage),
  });
}

export async function getUser(username: string) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildUserProfileCacheKey(username),
    cacheType: "user_profile",
    ttlMs: CACHE_TTL_MS.userProfile,
    fallback: null,
    jobType: "user_profile",
    jobPayload: { username },
    fetchRemote: (octokit) => fetchUserProfileFromGitHub(octokit, username),
  });
}

export async function getUserPublicRepos(username: string, perPage = 30) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildUserPublicReposCacheKey(username, perPage),
    cacheType: "user_public_repos",
    ttlMs: CACHE_TTL_MS.userPublicRepos,
    fallback: [],
    jobType: "user_public_repos",
    jobPayload: { username, perPage },
    fetchRemote: (octokit) => fetchUserPublicReposFromGitHub(octokit, username, perPage),
  });
}

export async function getUserPublicOrgs(username: string) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildUserPublicOrgsCacheKey(username),
    cacheType: "user_public_orgs",
    ttlMs: CACHE_TTL_MS.userPublicOrgs,
    fallback: [],
    jobType: "user_public_orgs",
    jobPayload: { username },
    fetchRemote: (octokit) => fetchUserPublicOrgsFromGitHub(octokit, username),
  });
}

export async function getOrgMembers(org: string, perPage = 100) {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildOrgMembersCacheKey(org, perPage),
    cacheType: "org_members",
    ttlMs: CACHE_TTL_MS.orgMembers,
    fallback: [],
    jobType: "org_members",
    jobPayload: { orgName: org, perPage },
    fetchRemote: (octokit) => fetchOrgMembersFromGitHub(octokit, org, perPage),
  });
}

export interface ContributorWeek {
  w: number; // unix timestamp (start of week)
  a: number; // additions
  d: number; // deletions
  c: number; // commits
}

export interface ContributorStats {
  login: string;
  total: number;
  weeks: ContributorWeek[];
}

export async function getRepoContributorStats(
  owner: string,
  repo: string
): Promise<ContributorStats[]> {
  const octokit = await getOctokit();
  if (!octokit) return [];

  try {
    // GitHub may return 202 while computing stats - retry once
    let response = await octokit.repos.getContributorsStats({ owner, repo });
    if (response.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      response = await octokit.repos.getContributorsStats({ owner, repo });
    }
    if (!Array.isArray(response.data)) return [];
    return (response.data as any[]).map((entry: any) => ({
      login: entry.author?.login ?? "",
      total: entry.total ?? 0,
      weeks: (entry.weeks ?? []).map((w: any) => ({
        w: w.w,
        a: w.a,
        d: w.d,
        c: w.c,
      })),
    }));
  } catch {
    return [];
  }
}

export interface CommitActivityWeek {
  total: number;
  week: number;
  days: number[];
}

export async function getCommitActivity(
  owner: string,
  repo: string
): Promise<CommitActivityWeek[]> {
  const octokit = await getOctokit();
  if (!octokit) return [];

  try {
    let response = await (octokit.repos as any).getCommitActivityStats({ owner, repo });
    if (response.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      response = await (octokit.repos as any).getCommitActivityStats({ owner, repo });
    }
    if (!Array.isArray(response.data)) return [];
    return (response.data as any[]).map((w: any) => ({
      total: w.total ?? 0,
      week: w.week ?? 0,
      days: w.days ?? [],
    }));
  } catch {
    return [];
  }
}

export interface CodeFrequencyWeek {
  week: number;
  additions: number;
  deletions: number;
}

export async function getCodeFrequency(
  owner: string,
  repo: string
): Promise<CodeFrequencyWeek[]> {
  const octokit = await getOctokit();
  if (!octokit) return [];

  try {
    let response = await (octokit.repos as any).getCodeFrequencyStats({ owner, repo });
    if (response.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      response = await (octokit.repos as any).getCodeFrequencyStats({ owner, repo });
    }
    if (!Array.isArray(response.data)) return [];
    return (response.data as any[]).map((entry: any) => ({
      week: entry[0] ?? 0,
      additions: entry[1] ?? 0,
      deletions: Math.abs(entry[2] ?? 0),
    }));
  } catch {
    return [];
  }
}

export interface WeeklyParticipation {
  all: number[];
  owner: number[];
}

export async function getWeeklyParticipation(
  owner: string,
  repo: string
): Promise<WeeklyParticipation | null> {
  const octokit = await getOctokit();
  if (!octokit) return null;

  try {
    let response = await (octokit.repos as any).getParticipationStats({ owner, repo });
    if (response.status === 202) {
      await new Promise((r) => setTimeout(r, 2000));
      response = await (octokit.repos as any).getParticipationStats({ owner, repo });
    }
    if (!response.data?.all) return null;
    return {
      all: response.data.all ?? [],
      owner: response.data.owner ?? [],
    };
  } catch {
    return null;
  }
}

export async function getLanguages(
  owner: string,
  repo: string
): Promise<Record<string, number>> {
  const octokit = await getOctokit();
  if (!octokit) return {};

  try {
    const response = await octokit.repos.listLanguages({ owner, repo });
    return (response.data as any) ?? {};
  } catch {
    return {};
  }
}

export async function getRepoEvents(
  owner: string,
  repo: string,
  perPage = 30
) {
  const octokit = await getOctokit();
  if (!octokit) return [];

  try {
    const { data } = await octokit.activity.listRepoEvents({
      owner,
      repo,
      per_page: perPage,
    });
    return data;
  } catch {
    return [];
  }
}

export interface PersonRepoActivity {
  commits: { sha: string; message: string; date: string }[];
  prs: { number: number; title: string; state: string; created_at: string }[];
  issues: { number: number; title: string; state: string; created_at: string }[];
  reviews: { pr_number: number; pr_title: string; submitted_at: string }[];
}

async function fetchPersonRepoActivityFromGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<PersonRepoActivity> {
  const [commitsResult, prsResult, issuesResult, reviewsResult] = await Promise.allSettled([
    octokit.repos
      .listCommits({ owner, repo, author: username, per_page: 30 })
      .then((r) =>
        r.data.map((c: any) => ({
          sha: c.sha,
          message: c.commit.message.split("\n")[0],
          date: c.commit.author?.date ?? c.commit.committer?.date ?? "",
        }))
      ),
    octokit.search
      .issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:pr author:${username}`,
        per_page: 30,
        sort: "created",
        order: "desc",
      })
      .then((r) =>
        r.data.items.map((item: any) => ({
          number: item.number,
          title: item.title,
          state: item.pull_request?.merged_at ? "merged" : item.state,
          created_at: item.created_at,
        }))
      ),
    octokit.search
      .issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:issue author:${username}`,
        per_page: 30,
        sort: "created",
        order: "desc",
      })
      .then((r) =>
        r.data.items.map((item: any) => ({
          number: item.number,
          title: item.title,
          state: item.state,
          created_at: item.created_at,
        }))
      ),
    octokit.search
      .issuesAndPullRequests({
        q: `repo:${owner}/${repo} is:pr reviewed-by:${username}`,
        per_page: 30,
        sort: "created",
        order: "desc",
      })
      .then((r) =>
        r.data.items.map((item: any) => ({
          pr_number: item.number,
          pr_title: item.title,
          submitted_at: item.updated_at,
        }))
      ),
  ]);

  return {
    commits: commitsResult.status === "fulfilled" ? commitsResult.value : [],
    prs: prsResult.status === "fulfilled" ? prsResult.value : [],
    issues: issuesResult.status === "fulfilled" ? issuesResult.value : [],
    reviews: reviewsResult.status === "fulfilled" ? reviewsResult.value : [],
  };
}

export async function getPersonRepoActivity(
  owner: string,
  repo: string,
  username: string
): Promise<PersonRepoActivity> {
  const authCtx = await getGitHubAuthContext();
  return readLocalFirstGitData({
    authCtx,
    cacheKey: buildPersonRepoActivityCacheKey(owner, repo, username),
    cacheType: "person_repo_activity",
    ttlMs: CACHE_TTL_MS.personRepoActivity,
    fallback: { commits: [], prs: [], issues: [], reviews: [] },
    jobType: "person_repo_activity",
    jobPayload: { owner, repo, username },
    fetchRemote: (octokit) => fetchPersonRepoActivityFromGitHub(octokit, owner, repo, username),
  });
}

export async function getRepoCommits(
  owner: string,
  repo: string,
  sha?: string,
  page = 1,
  perPage = 30,
  since?: string,
  until?: string
) {
  const octokit = await getOctokit();
  if (!octokit) return [];
  const { data } = await octokit.repos.listCommits({
    owner,
    repo,
    sha,
    per_page: perPage,
    page,
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
  });
  return data;
}

export async function getCommit(owner: string, repo: string, ref: string) {
  const octokit = await getOctokit();
  if (!octokit) return null;
  const { data } = await octokit.repos.getCommit({ owner, repo, ref });
  return data;
}
