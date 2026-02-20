import { getRepoCommits, getRepo, getRepoBranches } from "@/lib/github";
import { CommitsList } from "@/components/repo/commits-list";

export default async function CommitsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const [repoData, commits, branches] = await Promise.all([
    getRepo(owner, repo),
    getRepoCommits(owner, repo),
    getRepoBranches(owner, repo),
  ]);
  if (!repoData) return null;
  return (
    <CommitsList
      owner={owner}
      repo={repo}
      commits={commits as any}
      defaultBranch={repoData.default_branch}
      branches={(branches as any) ?? []}
    />
  );
}
