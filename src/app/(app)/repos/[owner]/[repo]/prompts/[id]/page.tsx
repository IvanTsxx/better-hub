import { getPromptRequest } from "@/lib/prompt-request-store";
import { PromptDetail } from "@/components/prompt-request/prompt-detail";
import { notFound } from "next/navigation";

export default async function PromptDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; id: string }>;
}) {
  const { owner, repo, id } = await params;
  const promptRequest = await getPromptRequest(id);

  if (!promptRequest) {
    notFound();
  }

  return (
    <PromptDetail
      owner={owner}
      repo={repo}
      promptRequest={promptRequest}
    />
  );
}
