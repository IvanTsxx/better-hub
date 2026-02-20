import { ShieldAlert } from "lucide-react";
import { getRepositoryAdvisory } from "@/lib/github";
import { renderMarkdownToHtml } from "@/components/shared/markdown-renderer";
import { AdvisoryDetail } from "@/components/security/advisory-detail";

export default async function AdvisoryDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string; ghsaId: string }>;
}) {
  const { owner, repo, ghsaId } = await params;

  const advisory = await getRepositoryAdvisory(owner, repo, ghsaId);

  if (!advisory) {
    return (
      <div className="py-16 text-center">
        <ShieldAlert className="w-6 h-6 text-muted-foreground/30 mx-auto mb-3" />
        <p className="text-xs text-muted-foreground font-mono">
          Advisory not found
        </p>
      </div>
    );
  }

  const descriptionHtml = advisory.description
    ? await renderMarkdownToHtml(advisory.description, {
        owner,
        repo,
        branch: "HEAD",
      })
    : null;

  return (
    <AdvisoryDetail
      advisory={advisory}
      owner={owner}
      repo={repo}
      descriptionHtml={descriptionHtml}
    />
  );
}
