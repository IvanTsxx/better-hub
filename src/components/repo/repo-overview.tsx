"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { cn, formatNumber } from "@/lib/utils";
import type { CommitActivityWeek } from "@/lib/github";
import { GitPullRequest, CircleDot, Star, GitFork, Eye, MessageSquare } from "lucide-react";

// --- Language colors (shared with InsightsView) ---
const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  PHP: "#4F5D95",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  Dart: "#00B4AB",
  Shell: "#89e051",
  HTML: "#e34c26",
  CSS: "#563d7c",
  SCSS: "#c6538c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
};

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

// --- Shared UI primitives ---
function Section({ title, subtitle, actions, stickyHeader, children, className }: { title: string; subtitle?: string; actions?: React.ReactNode; stickyHeader?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("p-4 flex flex-col lg:min-h-0", className)}>
      <div className="flex items-baseline gap-2 mb-4 shrink-0">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {subtitle && <span className="text-[10px] font-mono text-muted-foreground/50 bg-muted/60 px-1.5 py-0.5 rounded">{subtitle}</span>}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {stickyHeader && <div className="shrink-0">{stickyHeader}</div>}
      <div className="flex-1 min-h-0 lg:overflow-y-auto">
        {children}
      </div>
    </div>
  );
}


function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-24 text-xs font-mono text-muted-foreground/40">
      {message}
    </div>
  );
}


// --- PR / Issue list item ---
function ListItem({
  number,
  title,
  user,
  createdAt,
  href,
  type,
}: {
  number: number;
  title: string;
  user: { login: string; avatar_url: string } | null;
  createdAt: string;
  href: string;
  type: "pr" | "issue";
}) {
  const Icon = type === "pr" ? GitPullRequest : CircleDot;
  return (
    <Link href={href} className="flex items-start gap-2.5 py-2 group hover:bg-muted/40 -mx-2 px-2 rounded-md transition-colors">
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-success" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground/80 truncate group-hover:text-foreground transition-colors">
          <span className="font-mono text-muted-foreground/60 mr-1.5">#{number}</span>
          {title}
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/50 mt-0.5 flex items-center gap-1">
          {user?.avatar_url && (
            <Image
              src={user.avatar_url}
              alt={user.login}
              width={14}
              height={14}
              className="rounded-full shrink-0"
            />
          )}
          {user?.login ?? "unknown"} &middot; {new Date(createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </p>
      </div>
    </Link>
  );
}

// --- Sortable PR / Issue list ---
type SortKey = "newest" | "oldest" | "comments";

function SortableList({
  title,
  totalCount,
  items,
  type,
  base,
  viewAllHref,
}: {
  title: string;
  totalCount: number;
  items: (PRItem | IssueItem)[];
  type: "pr" | "issue";
  base: string;
  viewAllHref: string;
}) {
  const [sort, setSort] = useState<SortKey>("newest");

  const sorted = [...items].sort((a, b) => {
    if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (sort === "comments") return (b.comments ?? 0) - (a.comments ?? 0);
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const nextSort = () => {
    const order: SortKey[] = ["newest", "oldest", "comments"];
    setSort(order[(order.indexOf(sort) + 1) % order.length]);
  };
  const sortLabel = sort === "newest" ? "Newest" : sort === "oldest" ? "Oldest" : "Discussed";

  return (
    <Section
      title={title}
      actions={
        items.length > 1 ? (
          <button
            onClick={nextSort}
            className="text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer"
          >
            {sortLabel} &darr;
          </button>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <EmptyState message={type === "pr" ? "No open pull requests" : "No open issues"} />
      ) : (
        <div className="space-y-0.5">
          {sorted.slice(0, 10).map((item) => (
            <ListItem
              key={item.number}
              number={item.number}
              title={item.title}
              user={item.user}
              createdAt={item.created_at}
              href={`${base}/${type === "pr" ? "pulls" : "issues"}/${item.number}`}
              type={type}
            />
          ))}
          {totalCount > 10 && (
            <Link href={viewAllHref} className="block text-[10px] font-mono text-muted-foreground/60 hover:text-foreground/60 mt-2 transition-colors">
              View all {totalCount} &rarr;
            </Link>
          )}
        </div>
      )}
    </Section>
  );
}

// --- Activity event helpers ---
function getEventDescription(event: RepoEvent): { verb: string; detail: string; href: string | null } {
  const p = event.payload;
  const repoName = event.repo?.name;
  const base = repoName ? `/${repoName}` : "";

  switch (event.type) {
    case "PushEvent": {
      const branch = p?.ref?.replace("refs/heads/", "") ?? "";
      const commitCount = p?.commits?.length ?? 0;
      const firstCommit = p?.commits?.[0];
      const firstMsg = firstCommit?.message?.split("\n")[0] ?? "";
      const commitHref = commitCount === 1 && firstCommit?.sha && base
        ? `${base}/commits/${firstCommit.sha.slice(0, 7)}`
        : base ? `${base}/commits` : null;
      return {
        verb: `pushed ${commitCount} commit${commitCount !== 1 ? "s" : ""} to ${branch}`,
        detail: firstMsg,
        href: commitHref,
      };
    }
    case "PullRequestEvent": {
      const pr = p?.pull_request;
      return {
        verb: `${p?.action ?? "opened"} PR #${pr?.number ?? ""}`,
        detail: pr?.title ?? "",
        href: pr?.number && base ? `${base}/pulls/${pr.number}` : null,
      };
    }
    case "IssuesEvent": {
      const issue = p?.issue;
      return {
        verb: `${p?.action ?? "opened"} issue #${issue?.number ?? ""}`,
        detail: issue?.title ?? "",
        href: issue?.number && base ? `${base}/issues/${issue.number}` : null,
      };
    }
    case "IssueCommentEvent": {
      const issue = p?.issue;
      return {
        verb: `commented on #${issue?.number ?? ""}`,
        detail: issue?.title ?? "",
        href: issue?.number && base ? `${base}/issues/${issue.number}` : null,
      };
    }
    case "PullRequestReviewEvent": {
      const pr = p?.pull_request;
      return {
        verb: `reviewed PR #${pr?.number ?? ""}`,
        detail: pr?.title ?? "",
        href: pr?.number && base ? `${base}/pulls/${pr.number}` : null,
      };
    }
    case "PullRequestReviewCommentEvent": {
      const pr = p?.pull_request;
      return {
        verb: `commented on PR #${pr?.number ?? ""}`,
        detail: pr?.title ?? "",
        href: pr?.number && base ? `${base}/pulls/${pr.number}` : null,
      };
    }
    case "CreateEvent":
      return {
        verb: `created ${p?.ref_type ?? "branch"} ${p?.ref ?? ""}`,
        detail: "",
        href: p?.ref_type === "branch" && p?.ref && base ? `${base}/tree/${p.ref}` : null,
      };
    case "DeleteEvent":
      return {
        verb: `deleted ${p?.ref_type ?? "branch"} ${p?.ref ?? ""}`,
        detail: "",
        href: null,
      };
    case "ForkEvent":
      return {
        verb: "forked the repository",
        detail: p?.forkee?.full_name ?? "",
        href: p?.forkee?.full_name ? `/${p.forkee.full_name}` : null,
      };
    case "WatchEvent":
      return { verb: "starred the repository", detail: "", href: null };
    case "ReleaseEvent":
      return {
        verb: `${p?.action ?? "published"} release ${p?.release?.tag_name ?? ""}`,
        detail: p?.release?.name ?? "",
        href: null,
      };
    default:
      return { verb: event.type.replace("Event", "").toLowerCase(), detail: "", href: null };
  }
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// --- Filter out noise (stars, forks, watches) — only keep meaningful dev activity ---
const SIGNIFICANT_EVENT_TYPES = new Set([
  "PushEvent",
  "PullRequestEvent",
  "IssuesEvent",
  "IssueCommentEvent",
  "PullRequestReviewEvent",
  "PullRequestReviewCommentEvent",
  "CreateEvent",
  "DeleteEvent",
  "ReleaseEvent",
]);

function filterSignificantEvents(events: RepoEvent[]): RepoEvent[] {
  return events.filter((e) => SIGNIFICANT_EVENT_TYPES.has(e.type));
}

// --- Activity feed item ---
function ActivityItem({ event }: { event: RepoEvent }) {
  const router = useRouter();
  const { verb, detail, href } = getEventDescription(event);

  const content = (
    <div
      className={cn("flex items-start gap-2 py-1.5 -mx-2 px-2 rounded-md transition-colors hover:bg-muted/40 group", href && "cursor-pointer")}
      onClick={href ? () => router.push(href) : undefined}
    >
      {event.actor?.avatar_url ? (
        <Link href={`/users/${event.actor.login}`} onClick={(e) => e.stopPropagation()}>
          <Image
            src={event.actor.avatar_url}
            alt={event.actor.login}
            width={16}
            height={16}
            className="rounded-full mt-0.5 shrink-0 hover:ring-2 hover:ring-foreground/20 transition-shadow"
          />
        </Link>
      ) : (
        <div className="w-4 h-4 rounded-full bg-muted mt-0.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground/70 leading-relaxed">
          <Link
            href={`/users/${event.actor?.login}`}
            className="font-mono text-foreground/80 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {event.actor?.login}
          </Link>
          {(event as any).org?.login && (
            <>
              {" "}
              <span className="text-muted-foreground/40">@</span>
              <Link
                href={`/orgs/${(event as any).org.login}`}
                className="text-muted-foreground/50 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {(event as any).org.login}
              </Link>
            </>
          )}
          {" "}
          <span className="text-muted-foreground/60">{verb}</span>
        </p>
        {detail && (
          <p className="text-[10px] font-mono text-muted-foreground/50 truncate mt-0.5">{detail}</p>
        )}
      </div>
      <span className="text-[9px] font-mono text-muted-foreground/40 shrink-0 mt-0.5">
        {timeAgo(event.created_at)}
      </span>
    </div>
  );

  return content;
}

// --- Commit activity graph (weekly, last 16 weeks) ---
function CommitActivityGraph({ data }: { data: CommitActivityWeek[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const weeks = data.slice(-16);
  if (weeks.length === 0) return null;

  const maxVal = Math.max(...weeks.map((w) => w.total), 1);
  const total = weeks.reduce((s, w) => s + w.total, 0);
  const chartHeight = 36;

  return (
    <div className="mb-3 pb-3 border-b border-border/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider">Commits &middot; 16 weeks</span>
        <span className="text-[9px] font-mono text-muted-foreground/50">{formatNumber(total)} total</span>
      </div>
      <div className="flex items-end gap-[3px]" style={{ height: chartHeight }}>
        {weeks.map((week, i) => {
          const isLatest = i === weeks.length - 1;
          const weekDate = new Date(week.week * 1000);
          return (
            <div
              key={i}
              className="flex-1 relative"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className={cn(
                  "w-full rounded-t-[2px] rounded-b-[1px] transition-colors",
                  week.total === 0
                    ? "bg-muted/40"
                    : hovered === i
                      ? "bg-success/90"
                      : isLatest
                        ? "bg-success/70"
                        : "bg-success/50"
                )}
                style={{ height: week.total === 0 ? 2 : Math.max(3, (week.total / maxVal) * chartHeight) }}
              />
              {hovered === i && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 whitespace-nowrap px-2 py-1 text-[9px] font-mono bg-card text-foreground rounded-md shadow-lg border border-border/60">
                  <span className="text-foreground/80">
                    {weekDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span className="text-foreground ml-1.5">
                    {week.total} commit{week.total !== 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Activity feed with filter ---
const ACTIVITY_COUNT = 15;

function ActivityFeed({ repoEvents, myRepoEvents, commitActivity, base }: { repoEvents: RepoEvent[]; myRepoEvents?: RepoEvent[]; commitActivity?: CommitActivityWeek[]; base: string }) {
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const rawEvents = filter === "mine" && myRepoEvents ? myRepoEvents : repoEvents;
  const events = filterSignificantEvents(rawEvents);
  const hasMyEvents = myRepoEvents && filterSignificantEvents(myRepoEvents).length > 0;
  const visibleEvents = events.slice(0, ACTIVITY_COUNT);

  return (
    <Section
      title="Recent Activity"
      subtitle={`${events.length}`}
      className="flex flex-col"
      stickyHeader={commitActivity && commitActivity.length > 0 ? <CommitActivityGraph data={commitActivity} /> : undefined}
      actions={
        hasMyEvents ? (
          <div className="flex items-center gap-0.5 text-[10px] font-mono">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "px-2 py-0.5 rounded-l-md transition-colors cursor-pointer",
                filter === "all"
                  ? "bg-muted/80 text-foreground"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              )}
            >
              All
            </button>
            <button
              onClick={() => setFilter("mine")}
              className={cn(
                "px-2 py-0.5 rounded-r-md transition-colors cursor-pointer",
                filter === "mine"
                  ? "bg-muted/80 text-foreground"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              )}
            >
              Mine
            </button>
          </div>
        ) : undefined
      }
    >
      {events.length === 0 ? (
        <EmptyState message={filter === "mine" ? "No activity from you" : "No recent activity"} />
      ) : (
        <>
          <div className="space-y-0.5 flex-1">
            {visibleEvents.map((event, i) => (
              <ActivityItem key={i} event={event} />
            ))}
          </div>
          {events.length > ACTIVITY_COUNT && (
            <Link
              href={`${base}/activity`}
              className="block text-[10px] font-mono text-muted-foreground/60 hover:text-foreground/60 mt-3 pt-2 border-t border-border/20 transition-colors text-center shrink-0"
            >
              View all activity &rarr;
            </Link>
          )}
        </>
      )}
    </Section>
  );
}

// --- Language breakdown ---
function LanguageBreakdown({ languages }: { languages: Record<string, number> }) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <EmptyState message="No language data" />;

  const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const top6 = entries.slice(0, 6);
  const otherBytes = entries.slice(6).reduce((sum, [, bytes]) => sum + bytes, 0);
  const display = otherBytes > 0 ? [...top6, ["Other", otherBytes] as [string, number]] : top6;

  return (
    <>
      <div className="flex h-2.5 rounded-sm overflow-hidden mb-3">
        {display.map(([lang, bytes]) => (
          <div
            key={lang}
            className="h-full"
            style={{
              width: `${(bytes / totalBytes) * 100}%`,
              backgroundColor: LANG_COLORS[lang] ?? "#6b7280",
            }}
          />
        ))}
      </div>
      <div className="space-y-1">
        {display.map(([lang, bytes]) => {
          const pct = ((bytes / totalBytes) * 100).toFixed(1);
          return (
            <div key={lang} className="flex items-center gap-2 text-xs">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: LANG_COLORS[lang] ?? "#6b7280" }}
              />
              <span className="font-mono text-foreground/80">{lang}</span>
              <span className="font-mono text-muted-foreground/60 ml-auto tabular-nums">{pct}%</span>
              <span className="font-mono text-muted-foreground/40 tabular-nums w-14 text-right">{formatBytes(bytes)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// --- Types ---
interface RepoEvent {
  type: string;
  actor: { login: string; avatar_url: string } | null;
  created_at: string;
  repo?: { name: string };
  payload?: {
    action?: string;
    ref?: string;
    ref_type?: string;
    commits?: { sha: string; message: string }[];
    pull_request?: { number: number; title: string };
    issue?: { number: number; title: string };
    comment?: { body: string };
    forkee?: { full_name: string };
    release?: { tag_name: string; name: string };
  };
}

interface PRItem {
  number: number;
  title: string;
  user: { login: string; avatar_url: string } | null;
  created_at: string;
  pull_request?: unknown;
  comments: number;
  draft?: boolean;
}

interface IssueItem {
  number: number;
  title: string;
  user: { login: string; avatar_url: string } | null;
  created_at: string;
  pull_request?: unknown;
  comments: number;
  reactions?: { total_count: number };
  labels?: Array<{ name?: string; color?: string }>;
}

interface ContributorItem {
  login: string;
  avatar_url: string;
  contributions: number;
  html_url: string;
}

// --- Highlighted Activity Ticker ---
interface HotItem {
  type: "pr" | "issue";
  number: number;
  title: string;
  user: { login: string; avatar_url: string } | null;
  comments: number;
  score: number;
  href: string;
}

function computeHotItems(prs: PRItem[], issues: IssueItem[], base: string): HotItem[] {
  const fromPRs: HotItem[] = prs.map((pr) => ({
    type: "pr" as const,
    number: pr.number,
    title: pr.title,
    user: pr.user,
    comments: pr.comments ?? 0,
    score: (pr.comments ?? 0) * 2,
    href: `${base}/pulls/${pr.number}`,
  }));
  const fromIssues: HotItem[] = issues
    .filter((i) => !i.pull_request)
    .map((issue) => ({
      type: "issue" as const,
      number: issue.number,
      title: issue.title,
      user: issue.user,
      comments: issue.comments ?? 0,
      score: (issue.comments ?? 0) * 2 + (issue.reactions?.total_count ?? 0),
      href: `${base}/issues/${issue.number}`,
    }));
  return [...fromPRs, ...fromIssues]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function TickerCard({ item }: { item: HotItem }) {
  const Icon = item.type === "pr" ? GitPullRequest : CircleDot;
  return (
    <Link
      href={item.href}
      className="w-full shrink-0 flex items-start gap-3 px-4 py-3 group hover:bg-muted/30 transition-colors"
    >
      <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-success" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground/80 truncate group-hover:text-foreground transition-colors">
          <span className="font-mono text-muted-foreground/60 mr-1.5">#{item.number}</span>
          {item.title}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {item.user?.avatar_url && (
            <Image
              src={item.user.avatar_url}
              alt={item.user.login}
              width={14}
              height={14}
              className="rounded-full shrink-0"
            />
          )}
          <span className="text-[10px] font-mono text-muted-foreground/50 truncate">
            {item.user?.login ?? "unknown"}
          </span>
          {item.comments > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground/50 ml-auto shrink-0">
              <MessageSquare className="w-3 h-3" />
              {item.comments}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function HighlightedActivityTicker({ items }: { items: HotItem[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { isVisibleRef.current = entry.isIntersecting; },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (items.length <= 1) return;
    // Respect prefers-reduced-motion
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const id = setInterval(() => {
      if (!isPaused && isVisibleRef.current) {
        setActiveIndex((prev) => (prev + 1) % items.length);
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isPaused, items.length]);

  return (
    <div
      ref={containerRef}
      className="border border-dashed border-border/60 rounded-lg overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h3 className="text-sm font-medium text-foreground">Highlighted Activity</h3>
        {items.length > 1 && (
          <div className="flex items-center gap-1">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all cursor-pointer",
                  i === activeIndex
                    ? "w-4 bg-foreground/50"
                    : "w-1.5 bg-foreground/15 hover:bg-foreground/25"
                )}
              />
            ))}
          </div>
        )}
      </div>
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${activeIndex * 100}%)` }}
        >
          {items.map((item) => (
            <TickerCard key={`${item.type}-${item.number}`} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

export interface RepoOverviewProps {
  owner: string;
  repo: string;
  repoData: any;
  isMaintainer: boolean;
  openPRs: PRItem[];
  openIssues: IssueItem[];
  openPRCount?: number;
  openIssueCount?: number;
  // Maintainer-only
  commitActivity?: CommitActivityWeek[];
  repoEvents?: RepoEvent[];
  myRepoEvents?: RepoEvent[];
  // Non-maintainer-only
  readmeSlot?: React.ReactNode;
  contributors?: ContributorItem[];
  languages?: Record<string, number>;
}

export function RepoOverview({
  owner,
  repo,
  repoData,
  isMaintainer,
  openPRs,
  openIssues,
  openPRCount,
  openIssueCount,
  commitActivity,
  repoEvents,
  myRepoEvents,
  readmeSlot,
  contributors,
  languages,
}: RepoOverviewProps) {
  const base = `/${owner}/${repo}`;

  const infoRow = (repoData.description || (repoData as any).topics?.length > 0) ? (
    <div className="rounded-lg bg-muted/20 p-4">
      {repoData.description && (
        <p className="text-sm text-foreground/80 mb-3">{repoData.description}</p>
      )}
      {(repoData as any).topics?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(repoData as any).topics.map((topic: string) => (
            <span
              key={topic}
              className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground/70"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const hotItems = isMaintainer ? computeHotItems(openPRs, openIssues, base) : [];

  const statsRow = (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {[
        { icon: Star, label: "Stars", value: formatNumber(repoData.stargazers_count ?? 0) },
        { icon: GitFork, label: "Forks", value: formatNumber(repoData.forks_count ?? 0) },
        { icon: Eye, label: "Watchers", value: formatNumber(repoData.subscribers_count ?? repoData.watchers_count ?? 0) },
        { icon: GitPullRequest, label: "Open PRs", value: formatNumber(openPRCount ?? openPRs.length) },
        { icon: CircleDot, label: "Open Issues", value: formatNumber(openIssueCount ?? openIssues.length) },
      ].map((stat) => (
        <div key={stat.label} className="flex flex-col gap-1 px-3 py-2.5 rounded-lg bg-muted/25">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
            <stat.icon className="w-3 h-3" />
            {stat.label}
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground/80">{stat.value}</span>
        </div>
      ))}
    </div>
  );

  if (isMaintainer) {
    return (
      <div className="flex flex-col gap-4 lg:flex-1 lg:min-h-0 pb-4">
        <div className="shrink-0 flex flex-col gap-4">
          {statsRow}
          {hotItems.length > 0 && <HighlightedActivityTicker items={hotItems} />}
        </div>

        <div className={cn("grid grid-cols-1 gap-4 lg:flex-1 lg:min-h-0 lg:grid-rows-1", openIssues.length > 0 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>
          {/* Recent activity */}
          <ActivityFeed repoEvents={repoEvents ?? []} myRepoEvents={myRepoEvents} commitActivity={commitActivity} base={base} />

          {/* Recent open PRs */}
          <SortableList
            title="Open PRs"
            totalCount={openPRCount ?? openPRs.length}
            items={openPRs}
            type="pr"
            base={base}
            viewAllHref={`${base}/pulls`}
          />

          {/* Recent open issues */}
          {openIssues.length > 0 && (
            <SortableList
              title="Open Issues"
              totalCount={openIssueCount ?? openIssues.length}
              items={openIssues}
              type="issue"
              base={base}
              viewAllHref={`${base}/issues`}
            />
          )}
        </div>
      </div>
    );
  }

  // Non-maintainer view
  return (
    <div className="space-y-4 pb-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { icon: Star, label: "Stars", value: formatNumber(repoData.stargazers_count ?? 0) },
          { icon: GitFork, label: "Forks", value: formatNumber(repoData.forks_count ?? 0) },
          { icon: Eye, label: "Watchers", value: formatNumber(repoData.subscribers_count ?? repoData.watchers_count ?? 0) },
          { icon: CircleDot, label: "Open Issues", value: formatNumber(openIssues.length) },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1 px-3 py-2.5 rounded-lg bg-muted/25">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
              <stat.icon className="w-3 h-3" />
              {stat.label}
            </span>
            <span className="text-sm font-medium tabular-nums text-foreground/80">{stat.value}</span>
          </div>
        ))}
      </div>

      {/* README */}
      {readmeSlot && (
        <div className="rounded-lg bg-muted/20 overflow-hidden">
          <div className="px-4 py-2 border-b border-border/20">
            <span className="text-[11px] font-mono text-muted-foreground/60">
              README.md
            </span>
          </div>
          <div className="px-6 py-5">
            {readmeSlot}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contributors */}
        <Section title="Top Contributors" subtitle={contributors ? `${contributors.length}` : undefined}>
          {!contributors || contributors.length === 0 ? (
            <EmptyState message="No contributor data" />
          ) : (
            <div className="space-y-1.5">
              {contributors.slice(0, 10).map((c) => (
                <div key={c.login} className="flex items-center gap-2.5 py-1">
                  <Image
                    src={c.avatar_url}
                    alt={c.login}
                    width={20}
                    height={20}
                    className="rounded-full"
                  />
                  <span className="text-xs font-mono text-foreground/80 truncate flex-1">{c.login}</span>
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60">
                    {formatNumber(c.contributions)} commits
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Languages */}
        <Section title="Languages" subtitle={languages ? formatBytes(Object.values(languages).reduce((s, v) => s + v, 0)) : undefined}>
          {!languages || Object.keys(languages).length === 0 ? (
            <EmptyState message="No language data" />
          ) : (
            <LanguageBreakdown languages={languages} />
          )}
        </Section>
      </div>
    </div>
  );
}
