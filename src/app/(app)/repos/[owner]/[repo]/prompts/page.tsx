import { listPromptRequests } from "@/lib/prompt-request-store";
import { PromptList } from "@/components/prompt-request/prompt-list";

export default async function PromptsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const promptRequests = await listPromptRequests(owner, repo);

  return (
    <PromptList
      owner={owner}
      repo={repo}
      promptRequests={promptRequests}
    />
  );
}
