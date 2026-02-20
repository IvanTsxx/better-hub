import { getRepoWorkflows, getRepoWorkflowRuns } from "@/lib/github";
import { ActionsList } from "@/components/actions/actions-list";

export default async function ActionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { owner, repo } = await params;
  const sp = await searchParams;

  const [workflows, runs] = await Promise.all([
    getRepoWorkflows(owner, repo),
    getRepoWorkflowRuns(owner, repo),
  ]);

  const runsArray = (runs as any) ?? [];

  return (
    <ActionsList
      owner={owner}
      repo={repo}
      workflows={workflows as any}
      runs={runsArray}
      initialTotalCount={runsArray.length}
      initialWorkflow={sp.workflow}
    />
  );
}
