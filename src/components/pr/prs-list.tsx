"use client";

import {
  useState,
  useMemo,
  useRef,
  useCallback,
  useTransition,
} from "react";
import Link from "next/link";
import Image from "next/image";
import {
  GitPullRequest,
  GitPullRequestClosed,
  GitMerge,
  MessageSquare,
  Clock,
  GitBranch,
  FileCode2,
  X,
} from "lucide-react";
import type { CheckStatus } from "@/lib/github";
import { CheckStatusBadge } from "@/components/pr/check-status-badge";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/time-ago";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import {
  ListSearchInput,
  SortCycleButton,
  FiltersButton,
  ClearFiltersButton,
  InfiniteScrollSentinel,
  LoadingOverlay,
} from "@/components/shared/list-controls";
import { LabelBadge } from "@/components/shared/label-badge";

interface PRUser {
  login: string;
  avatar_url: string;
}

interface PR {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  updated_at: string;
  created_at: string;
  comments: number;
  review_comments: number;
  user: PRUser | null;
  labels: Array<{ name?: string; color?: string }>;
  merged_at: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
  requested_reviewers: PRUser[];
  assignees: PRUser[];
  additions: number;
  deletions: number;
  changed_files: number;
  checkStatus?: CheckStatus;
}

type SortType = "updated" | "newest" | "oldest" | "comments";
type DraftFilter = "all" | "ready" | "draft";
type ReviewFilter = "all" | "has_reviewers" | "no_reviewers";
type AssigneeFilter = "all" | "assigned" | "unassigned";

const sortLabels: Record<SortType, string> = {
  updated: "Updated",
  newest: "Newest",
  oldest: "Oldest",
  comments: "Comments",
};

const sortCycle: SortType[] = ["updated", "newest", "oldest", "comments"];

export function PRsList({
  owner,
  repo,
  openPRs,
  closedPRs,
  openCount,
  closedCount,
  onAuthorFilter,
}: {
  owner: string;
  repo: string;
  openPRs: PR[];
  closedPRs: PR[];
  openCount: number;
  closedCount: number;
  onAuthorFilter?: (
    owner: string,
    repo: string,
    author: string
  ) => Promise<{ open: PR[]; closed: PR[] }>;
}) {
  type TabState = "open" | "merged" | "closed";
  const [state, setState] = useState<TabState>("open");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortType>("updated");
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [authorSearch, setAuthorSearch] = useState("");
  const [authorDropdownOpen, setAuthorDropdownOpen] = useState(false);
  const authorRef = useRef<HTMLDivElement>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [authorPRs, setAuthorPRs] = useState<{
    open: PR[];
    closed: PR[];
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showFilters, setShowFilters] = useState(false);
  const [draftFilter, setDraftFilter] = useState<DraftFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>("all");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  const allPRs = useMemo(() => [...openPRs, ...closedPRs], [openPRs, closedPRs]);

  const authors = useMemo(() => {
    const seen = new Map<string, PRUser>();
    for (const pr of allPRs) {
      if (pr.user && !seen.has(pr.user.login)) {
        seen.set(pr.user.login, pr.user);
      }
    }
    return [...seen.values()];
  }, [allPRs]);

  const filteredAuthors = useMemo(() => {
    if (!authorSearch) return authors.slice(0, 8);
    const q = authorSearch.toLowerCase();
    return authors.filter((a) => a.login.toLowerCase().includes(q)).slice(0, 8);
  }, [authors, authorSearch]);

  const selectedAuthorData = useMemo(
    () => authors.find((a) => a.login === selectedAuthor) ?? null,
    [authors, selectedAuthor]
  );

  // Close dropdown on outside click
  useClickOutside(authorRef, useCallback(() => setAuthorDropdownOpen(false), []));

  const labels = useMemo(() => {
    const seen = new Map<string, { name: string; color: string }>();
    for (const pr of allPRs) {
      for (const label of pr.labels) {
        if (label.name && !seen.has(label.name)) {
          seen.set(label.name, { name: label.name, color: label.color || "888" });
        }
      }
    }
    return [...seen.values()].slice(0, 10);
  }, [allPRs]);

  const baseBranches = useMemo(() => {
    const seen = new Set<string>();
    for (const pr of allPRs) {
      if (pr.base?.ref) seen.add(pr.base.ref);
    }
    return [...seen].slice(0, 8);
  }, [allPRs]);

  const activeFilterCount =
    (draftFilter !== "all" ? 1 : 0) +
    (reviewFilter !== "all" ? 1 : 0) +
    (assigneeFilter !== "all" ? 1 : 0) +
    (selectedBranch ? 1 : 0) +
    (selectedAuthor ? 1 : 0) +
    (selectedLabel ? 1 : 0);

  const clearAllFilters = () => {
    setSearch("");
    setSelectedAuthor(null);
    setAuthorSearch("");
    setAuthorPRs(null);
    setSelectedLabel(null);
    setDraftFilter("all");
    setReviewFilter("all");
    setAssigneeFilter("all");
    setSelectedBranch(null);
  };

  const currentOpenPRs = authorPRs ? authorPRs.open : openPRs;
  const currentClosedPRs = authorPRs ? authorPRs.closed : closedPRs;

  const mergedPRs = useMemo(
    () => currentClosedPRs.filter((pr) => !!pr.merged_at),
    [currentClosedPRs]
  );
  const closedUnmergedPRs = useMemo(
    () => currentClosedPRs.filter((pr) => !pr.merged_at),
    [currentClosedPRs]
  );

  const basePRs =
    state === "open"
      ? currentOpenPRs
      : state === "merged"
        ? mergedPRs
        : closedUnmergedPRs;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return basePRs
      .filter((pr) => {
        if (q) {
          const matchesSearch =
            pr.title.toLowerCase().includes(q) ||
            pr.user?.login.toLowerCase().includes(q) ||
            (pr.head?.ref?.toLowerCase().includes(q) ?? false) ||
            (pr.base?.ref?.toLowerCase().includes(q) ?? false) ||
            pr.labels.some((l) => l.name?.toLowerCase().includes(q));
          if (!matchesSearch) return false;
        }
        // Skip client-side author filter when we have server-fetched author PRs
        if (!authorPRs && selectedAuthor && pr.user?.login !== selectedAuthor)
          return false;
        if (selectedLabel && !pr.labels.some((l) => l.name === selectedLabel))
          return false;
        if (draftFilter === "ready" && pr.draft) return false;
        if (draftFilter === "draft" && !pr.draft) return false;
        if (reviewFilter === "has_reviewers" && (pr.requested_reviewers?.length ?? 0) === 0)
          return false;
        if (reviewFilter === "no_reviewers" && (pr.requested_reviewers?.length ?? 0) > 0)
          return false;
        if (assigneeFilter === "assigned" && (pr.assignees?.length ?? 0) === 0) return false;
        if (assigneeFilter === "unassigned" && (pr.assignees?.length ?? 0) > 0) return false;
        if (selectedBranch && pr.base?.ref !== selectedBranch) return false;
        return true;
      })
      .sort((a, b) => {
        switch (sort) {
          case "newest":
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          case "oldest":
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          case "comments":
            return ((b.comments ?? 0) + (b.review_comments ?? 0)) - ((a.comments ?? 0) + (a.review_comments ?? 0));
          default:
            return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }
      });
  }, [basePRs, search, sort, selectedAuthor, selectedLabel, draftFilter, reviewFilter, assigneeFilter, selectedBranch, authorPRs]);

  const { visible, hasMore, loadMore, sentinelRef } = useInfiniteScroll(
    filtered,
    [state, search, sort, selectedAuthor, selectedLabel, draftFilter, reviewFilter, assigneeFilter, selectedBranch]
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="sticky top-0 z-10 bg-background pb-3 pt-4 before:content-[''] before:absolute before:left-0 before:right-0 before:bottom-full before:h-8 before:bg-background">
        {/* Row 1: Search + Open/Closed + Sort */}
        <div className="flex items-center gap-2 mb-3">
          <ListSearchInput
            placeholder="Search pull requests..."
            value={search}
            onChange={setSearch}
          />

          <SortCycleButton
            sort={sort}
            cycle={sortCycle}
            labels={sortLabels}
            onSort={setSort}
          />

          <FiltersButton
            open={showFilters}
            activeCount={activeFilterCount}
            onToggle={() => setShowFilters((v) => !v)}
          />

          <ClearFiltersButton show={activeFilterCount > 0} onClear={clearAllFilters} />
        </div>

        {/* Advanced filters panel */}
        {showFilters && (
          <div className="border border-border p-3 mb-3 space-y-3">
            {/* Draft status */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 w-16 shrink-0">
                Status
              </span>
              <div className="flex items-center border border-border divide-x divide-border">
                {(
                  [
                    ["all", "All"],
                    ["ready", "Ready"],
                    ["draft", "Draft"],
                  ] as [DraftFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setDraftFilter(value)}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer",
                      draftFilter === value
                        ? "bg-muted/50 dark:bg-white/4 text-foreground"
                        : "text-muted-foreground hover:text-foreground/60 hover:bg-muted/60 dark:hover:bg-white/3"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Review status */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 w-16 shrink-0">
                Review
              </span>
              <div className="flex items-center border border-border divide-x divide-border">
                {(
                  [
                    ["all", "All"],
                    ["has_reviewers", "Requested"],
                    ["no_reviewers", "None"],
                  ] as [ReviewFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setReviewFilter(value)}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer",
                      reviewFilter === value
                        ? "bg-muted/50 dark:bg-white/4 text-foreground"
                        : "text-muted-foreground hover:text-foreground/60 hover:bg-muted/60 dark:hover:bg-white/3"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Assignee status */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 w-16 shrink-0">
                Assign
              </span>
              <div className="flex items-center border border-border divide-x divide-border">
                {(
                  [
                    ["all", "All"],
                    ["assigned", "Assigned"],
                    ["unassigned", "Unassigned"],
                  ] as [AssigneeFilter, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setAssigneeFilter(value)}
                    className={cn(
                      "px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider transition-colors cursor-pointer",
                      assigneeFilter === value
                        ? "bg-muted/50 dark:bg-white/4 text-foreground"
                        : "text-muted-foreground hover:text-foreground/60 hover:bg-muted/60 dark:hover:bg-white/3"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Author */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 w-16 shrink-0">
                Author
              </span>
              <div ref={authorRef} className="relative">
                {selectedAuthor && selectedAuthorData ? (
                  <button
                    onClick={() => {
                      setSelectedAuthor(null);
                      setAuthorSearch("");
                      setAuthorPRs(null);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono border border-foreground/30 bg-muted/50 dark:bg-white/4 text-foreground transition-colors cursor-pointer"
                  >
                    <Image
                      src={selectedAuthorData.avatar_url}
                      alt={selectedAuthorData.login}
                      width={14}
                      height={14}
                      className="rounded-full"
                    />
                    {selectedAuthorData.login}
                    <X className="w-2.5 h-2.5 text-muted-foreground" />
                  </button>
                ) : (
                  <div>
                    <input
                      type="text"
                      placeholder="Search authors..."
                      value={authorSearch}
                      onChange={(e) => {
                        setAuthorSearch(e.target.value);
                        setAuthorDropdownOpen(true);
                      }}
                      onFocus={() => setAuthorDropdownOpen(true)}
                      className="w-48 bg-transparent border border-border px-2 py-1 text-[10px] font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/20 transition-colors"
                    />
                    {authorDropdownOpen && filteredAuthors.length > 0 && (
                      <div className="absolute z-20 top-full left-0 mt-1 w-56 border border-border bg-background shadow-lg max-h-48 overflow-y-auto">
                        {filteredAuthors.map((author) => (
                          <button
                            key={author.login}
                            onClick={() => {
                              setSelectedAuthor(author.login);
                              setAuthorSearch("");
                              setAuthorDropdownOpen(false);
                              if (onAuthorFilter) {
                                startTransition(async () => {
                                  const result = await onAuthorFilter(
                                    owner,
                                    repo,
                                    author.login
                                  );
                                  setAuthorPRs(result as { open: PR[]; closed: PR[] });
                                });
                              }
                            }}
                            className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[11px] font-mono text-muted-foreground hover:bg-muted/60 dark:hover:bg-white/3 hover:text-foreground transition-colors cursor-pointer"
                          >
                            <Image
                              src={author.avatar_url}
                              alt={author.login}
                              width={16}
                              height={16}
                              className="rounded-full"
                            />
                            {author.login}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Base branch */}
            {baseBranches.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 w-16 shrink-0">
                  Base
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {baseBranches.map((branch) => (
                    <button
                      key={branch}
                      onClick={() =>
                        setSelectedBranch((b) =>
                          b === branch ? null : branch
                        )
                      }
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 text-[10px] border rounded-full transition-colors cursor-pointer font-mono",
                        selectedBranch === branch
                          ? "border-foreground/30 bg-muted/50 dark:bg-white/4 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/60 dark:hover:bg-white/3"
                      )}
                    >
                      <GitBranch className="w-2.5 h-2.5" />
                      {branch}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Labels */}
            {labels.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/50 w-16 shrink-0">
                  Label
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {labels.map((label) => (
                    <button
                      key={label.name}
                      onClick={() =>
                        setSelectedLabel((l) =>
                          l === label.name ? null : label.name
                        )
                      }
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 text-[10px] border rounded-full transition-colors cursor-pointer font-mono",
                        selectedLabel === label.name
                          ? "border-foreground/30 bg-muted/50 dark:bg-white/4 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted/60 dark:hover:bg-white/3"
                      )}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: `#${label.color}` }}
                      />
                      {label.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Row 2: State tabs */}
        <div className="flex items-center border-b border-border/40">
          {([
            { key: "open" as TabState, label: "Open", icon: <GitPullRequest className="w-3 h-3" />, count: authorPRs ? currentOpenPRs.length : openCount },
            { key: "merged" as TabState, label: "Merged", icon: <GitMerge className="w-3 h-3" />, count: mergedPRs.length },
            { key: "closed" as TabState, label: "Closed", icon: <GitPullRequestClosed className="w-3 h-3" />, count: closedUnmergedPRs.length },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setState(tab.key)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-[12px] transition-colors cursor-pointer",
                state === tab.key
                  ? "text-foreground"
                  : "text-muted-foreground/50 hover:text-foreground/70"
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className={cn(
                "text-[10px] tabular-nums font-mono",
                state === tab.key ? "text-foreground/50" : "text-muted-foreground/30"
              )}>
                {tab.count}
              </span>
              {state === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* PR List */}
      <div className="relative flex-1 min-h-0 overflow-y-auto divide-y divide-border">
          <LoadingOverlay show={isPending} />
          {visible.map((pr) => {
            const isMerged = !!pr.merged_at;
            const totalComments = (pr.comments ?? 0) + (pr.review_comments ?? 0);

            return (
              <Link
                key={pr.id}
                href={`/${owner}/${repo}/pulls/${pr.number}`}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-muted/50 dark:hover:bg-white/[0.02] transition-colors"
              >
                {isMerged ? (
                  <GitMerge className="w-3.5 h-3.5 shrink-0 mt-0.5 text-alert-important" />
                ) : pr.state === "closed" ? (
                  <GitPullRequestClosed className="w-3.5 h-3.5 shrink-0 mt-0.5 text-destructive" />
                ) : (
                  <GitPullRequest
                    className={cn(
                      "w-3.5 h-3.5 shrink-0 mt-0.5",
                      pr.draft ? "text-muted-foreground/70" : "text-success"
                    )}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm truncate group-hover:text-foreground transition-colors">
                      {pr.title}
                    </span>
                    {pr.draft && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-muted-foreground/10 text-muted-foreground/70 shrink-0">
                        Draft
                      </span>
                    )}
                    {pr.labels
                      .filter((l) => l.name)
                      .slice(0, 3)
                      .map((label) => (
                        <LabelBadge key={label.name} label={label} />
                      ))}
                    {(pr.requested_reviewers?.length ?? 0) > 0 && (
                      <span className="flex items-center ml-auto shrink-0 -space-x-1.5">
                        {(pr.requested_reviewers ?? []).slice(0, 3).map((r) => (
                          <Image
                            key={r.login}
                            src={r.avatar_url}
                            alt={r.login}
                            width={16}
                            height={16}
                            className="rounded-full border border-border"
                            title={`Review requested: ${r.login}`}
                          />
                        ))}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    {pr.user && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/60">
                        <Image
                          src={pr.user.avatar_url}
                          alt={pr.user.login}
                          width={14}
                          height={14}
                          className="rounded-full"
                        />
                        <span className="font-mono text-[10px]">
                          {pr.user.login}
                        </span>
                      </span>
                    )}
                    {pr.base?.ref && pr.head?.ref && (
                      <span className="flex items-center gap-1 font-mono text-muted-foreground/40 text-[10px]">
                        <GitBranch className="w-2.5 h-2.5" />
                        {pr.base.ref}
                        <span className="mx-0.5">&larr;</span>
                        {pr.head.ref}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    {pr.checkStatus && (
                      <CheckStatusBadge checkStatus={pr.checkStatus} owner={owner} repo={repo} />
                    )}
                    <span className="text-[11px] font-mono text-muted-foreground/70">
                      #{pr.number}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
                      <Clock className="w-3 h-3" />
                      <TimeAgo date={pr.created_at} />
                    </span>
                    {totalComments > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground/50">
                        <MessageSquare className="w-3 h-3" />
                        {totalComments}
                      </span>
                    )}
                    <span className="font-mono text-success text-[10px]">
                      +{pr.additions ?? 0}
                    </span>
                    <span className="font-mono text-destructive text-[10px]">
                      -{pr.deletions ?? 0}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-muted-foreground/40 text-[10px]">
                      <FileCode2 className="w-2.5 h-2.5" />
                      {pr.changed_files ?? 0} file{(pr.changed_files ?? 0) !== 1 ? "s" : ""}
                    </span>

                    {(pr.assignees?.length ?? 0) > 0 && (
                      <span className="flex items-center ml-auto shrink-0 -space-x-1.5">
                        {(pr.assignees ?? []).slice(0, 3).map((a) => (
                          <Image
                            key={a.login}
                            src={a.avatar_url}
                            alt={a.login}
                            width={16}
                            height={16}
                            className="rounded-full border border-border"
                            title={`Assignee: ${a.login}`}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}

          <InfiniteScrollSentinel
            sentinelRef={sentinelRef}
            hasMore={hasMore}
            loadMore={loadMore}
            remaining={filtered.length - visible.length}
          />

          {filtered.length === 0 && (
            <div className="py-16 text-center">
              <GitPullRequest className="w-6 h-6 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-xs text-muted-foreground font-mono">
                {search || activeFilterCount > 0
                  ? "No pull requests match your filters"
                  : state === "merged"
                    ? "No merged pull requests"
                    : `No ${state} pull requests`}
              </p>
            </div>
          )}
        </div>
    </div>
  );
}
