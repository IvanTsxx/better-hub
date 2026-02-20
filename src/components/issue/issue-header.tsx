import Link from "next/link";
import Image from "next/image";
import { CircleDot, CheckCircle2, GitPullRequest, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/time-ago";
import { CopyLinkButton } from "@/components/shared/copy-link-button";
import type { LinkedPullRequest } from "@/lib/github";

interface IssueHeaderProps {
  title: string;
  number: number;
  state: string;
  author: { login: string; avatar_url: string } | null;
  createdAt: string;
  commentsCount: number;
  labels: Array<{ name?: string; color?: string }>;
  owner: string;
  repo: string;
  linkedPRs?: LinkedPullRequest[];
}

export function IssueHeader({
  title,
  number,
  state,
  author,
  createdAt,
  commentsCount,
  labels,
  owner,
  repo,
  linkedPRs,
}: IssueHeaderProps) {
  const isOpen = state === "open";

  return (
    <div className="mb-6">
      <h1 className="text-base font-medium tracking-tight mb-2">
        {title}{" "}
        <span className="text-muted-foreground/50 font-normal">#{number}</span>
      </h1>
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono",
            isOpen
              ? "text-success"
              : "text-alert-important"
          )}
        >
          {isOpen ? (
            <CircleDot className="w-3 h-3" />
          ) : (
            <CheckCircle2 className="w-3 h-3" />
          )}
          {isOpen ? "Open" : "Closed"}
        </span>
        {author && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link
              href={`/users/${author.login}`}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <Image
                src={author.avatar_url}
                alt={author.login}
                width={16}
                height={16}
                className="rounded-full"
              />
              <span className="font-mono">{author.login}</span>
            </Link>
            <span className="text-muted-foreground/50">
              opened <TimeAgo date={createdAt} />
            </span>
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/50 font-mono">
          {commentsCount} comment{commentsCount !== 1 ? "s" : ""}
        </span>
        <CopyLinkButton owner={owner} repo={repo} number={number} type="issues" />
        {labels
          .filter((l) => l.name)
          .map((label) => (
            <span
              key={label.name}
              className="text-[9px] font-mono px-2 py-0.5 border rounded-full"
              style={{
                borderColor: `#${label.color || "888"}30`,
                color: `#${label.color || "888"}`,
              }}
            >
              {label.name}
            </span>
          ))}
      </div>
      {linkedPRs && linkedPRs.length > 0 && (() => {
        const localPRs = linkedPRs.filter(
          (pr) => pr.repoOwner === owner && pr.repoName === repo
        );
        const upstreamPRs = linkedPRs.filter(
          (pr) => pr.repoOwner !== owner || pr.repoName !== repo
        );
        return (
          <div className="flex flex-col gap-1.5 mt-2">
            {localPRs.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {localPRs.map((pr) => (
                  <Link
                    key={pr.number}
                    href={`/${owner}/${repo}/pulls/${pr.number}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded-sm transition-colors hover:bg-muted/50",
                      pr.merged
                        ? "text-purple-400"
                        : pr.state === "open"
                          ? "text-success"
                          : "text-alert-important"
                    )}
                  >
                    <GitPullRequest className="w-3 h-3" />
                    <span>#{pr.number}</span>
                    <span className="text-muted-foreground/70 max-w-[200px] truncate">{pr.title}</span>
                    <span
                      className={cn(
                        "text-[9px] px-1 py-px rounded-sm",
                        pr.merged
                          ? "bg-purple-400/10 text-purple-400"
                          : pr.state === "open"
                            ? "bg-success/10 text-success"
                            : "bg-alert-important/10 text-alert-important"
                      )}
                    >
                      {pr.merged ? "merged" : pr.state}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {upstreamPRs.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {upstreamPRs.map((pr) => (
                  <Link
                    key={`${pr.repoOwner}/${pr.repoName}#${pr.number}`}
                    href={`/${pr.repoOwner}/${pr.repoName}/pulls/${pr.number}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded-sm transition-colors hover:bg-muted/50",
                      pr.merged
                        ? "text-purple-400/70"
                        : pr.state === "open"
                          ? "text-success/70"
                          : "text-alert-important/70"
                    )}
                  >
                    <ExternalLink className="w-3 h-3 shrink-0" />
                    <span className="text-muted-foreground/50">{pr.repoOwner}/{pr.repoName}</span>
                    <span>#{pr.number}</span>
                    <span className="text-muted-foreground/50 max-w-[160px] truncate">{pr.title}</span>
                    <span
                      className={cn(
                        "text-[9px] px-1 py-px rounded-sm",
                        pr.merged
                          ? "bg-purple-400/10 text-purple-400/70"
                          : pr.state === "open"
                            ? "bg-success/10 text-success/70"
                            : "bg-alert-important/10 text-alert-important/70"
                      )}
                    >
                      {pr.merged ? "merged" : pr.state}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
