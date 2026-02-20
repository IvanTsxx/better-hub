import Link from "next/link";
import { getRepo, getRepoTree, getRepoNavCounts, getRepoBranches, getRepoTags, getRepoContributors, getUserOrgs, getRepoCommits, checkIsStarred } from "@/lib/github";
import { buildFileTree } from "@/lib/file-tree";
import { RepoSidebar } from "@/components/repo/repo-sidebar";
import { RepoNav } from "@/components/repo/repo-nav";
import { CodeContentWrapper } from "@/components/repo/code-content-wrapper";
import { RepoLayoutWrapper } from "@/components/repo/repo-layout-wrapper";
import { ChatPageActivator } from "@/components/shared/chat-page-activator";
import { countPromptRequests } from "@/lib/prompt-request-store";

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo: repoName } = await params;
  const repoData = await getRepo(owner, repoName);
  const isOrgRepo = repoData?.owner?.type === "Organization";

  const [treeResult, navCounts, branches, tags, contributorsData, userOrgs, latestCommits, isStarred] = await Promise.all([
    repoData
      ? getRepoTree(owner, repoName, repoData.default_branch, true)
      : Promise.resolve(null),
    repoData
      ? getRepoNavCounts(owner, repoName, repoData.open_issues_count)
      : Promise.resolve({ openPrs: 0, openIssues: 0, activeRuns: 0 }),
    repoData ? getRepoBranches(owner, repoName) : Promise.resolve([]),
    repoData ? getRepoTags(owner, repoName) : Promise.resolve([]),
    repoData ? getRepoContributors(owner, repoName, 12) : Promise.resolve({ list: [], totalCount: 0 }),
    isOrgRepo ? getUserOrgs() : Promise.resolve([]),
    repoData ? getRepoCommits(owner, repoName, repoData.default_branch, 1, 1) : Promise.resolve([]),
    repoData ? checkIsStarred(owner, repoName) : Promise.resolve(false),
  ]);

  const latestCommit = latestCommits[0] ?? null;

  const showPeopleTab = isOrgRepo && (userOrgs as any[]).some(
    (org: any) => org.login?.toLowerCase() === owner.toLowerCase()
  );

  const promptRequestsCount = await countPromptRequests(owner, repoName, "open");

  if (!repoData) {
    return (
      <div className="py-16 text-center">
        <p className="text-xs text-muted-foreground font-mono">
          Repository not found
        </p>
      </div>
    );
  }

  return (
    <div className="-mx-4 flex-1 min-h-0 flex flex-col">
      <RepoLayoutWrapper
        owner={owner}
        repo={repoName}
        avatarUrl={repoData.owner.avatar_url}
        sidebar={
          <RepoSidebar
            owner={owner}
            repoName={repoName}
            ownerType={repoData.owner.type}
            avatarUrl={repoData.owner.avatar_url}
            description={repoData.description}
            stars={repoData.stargazers_count}
            forks={repoData.forks_count}
            watchers={repoData.watchers_count}
            openIssuesCount={navCounts.openIssues}
            isPrivate={repoData.private}
            defaultBranch={repoData.default_branch}
            language={repoData.language}
            license={repoData.license as any}
            pushedAt={repoData.pushed_at ?? ""}
            size={repoData.size ?? 0}
            htmlUrl={repoData.html_url}
            homepage={repoData.homepage ?? null}
            topics={(repoData as any).topics ?? []}
            archived={repoData.archived}
            fork={repoData.fork}
            parent={(repoData as any).parent ? { fullName: (repoData as any).parent.full_name, owner: (repoData as any).parent.owner.login, name: (repoData as any).parent.name } : null}
            contributors={contributorsData.list}
            contributorsTotalCount={contributorsData.totalCount}
            isStarred={isStarred}
            branches={branches}
            latestCommit={latestCommit ? {
              sha: (latestCommit as any).sha,
              message: (latestCommit as any).commit?.message ?? "",
              date: (latestCommit as any).commit?.author?.date ?? (latestCommit as any).commit?.committer?.date ?? "",
              author: (latestCommit as any).author ? {
                login: (latestCommit as any).author.login,
                avatarUrl: (latestCommit as any).author.avatar_url,
              } : (latestCommit as any).commit?.author?.name ? {
                login: (latestCommit as any).commit.author.name,
                avatarUrl: "",
              } : null,
            } : null}
          />
        }
      >
        <div className="shrink-0 pl-4" style={{ paddingRight: 'var(--repo-pr, 1rem)' }}>
          <RepoNav
            owner={owner}
            repo={repoName}
            openIssuesCount={navCounts.openIssues}
            openPrsCount={navCounts.openPrs}
            activeRunsCount={navCounts.activeRuns}
            promptRequestsCount={promptRequestsCount}
            showPeopleTab={showPeopleTab}
          />
        </div>
        <CodeContentWrapper
          owner={owner}
          repo={repoName}
          defaultBranch={repoData.default_branch}
          tree={treeResult?.truncated ? null : treeResult?.tree ? buildFileTree(treeResult.tree as any) : null}
          branches={branches}
          tags={tags}
        >
          {children}
        </CodeContentWrapper>
      </RepoLayoutWrapper>
      <ChatPageActivator
        config={{
          chatType: "general",
          contextKey: `${owner}/${repoName}`,
          contextBody: {},
          repoFileSearch: { owner, repo: repoName, ref: repoData.default_branch },
        }}
      />
    </div>
  );
}
