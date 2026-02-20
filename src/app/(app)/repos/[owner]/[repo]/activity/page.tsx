import { getRepo, getRepoEvents, getCommitActivity } from "@/lib/github";
import { RepoActivityView } from "@/components/repo/repo-activity-view";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;

  const repoData = await getRepo(owner, repo);
  if (!repoData) return null;

  const [events, commitActivity] = await Promise.all([
    getRepoEvents(owner, repo, 100),
    getCommitActivity(owner, repo),
  ]);

  return (
    <RepoActivityView
      owner={owner}
      repo={repo}
      events={events as any}
      commitActivity={commitActivity}
    />
  );
}
