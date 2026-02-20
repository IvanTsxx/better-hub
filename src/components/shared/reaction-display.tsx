"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  getReactionUsers,
  type ReactionUser,
} from "@/app/(app)/repos/[owner]/[repo]/reaction-actions";

export interface Reactions {
  "+1"?: number;
  "-1"?: number;
  laugh?: number;
  hooray?: number;
  confused?: number;
  heart?: number;
  rocket?: number;
  eyes?: number;
  total_count?: number;
  [key: string]: unknown;
}

const REACTION_EMOJI: [string, string][] = [
  ["+1", "\uD83D\uDC4D"],
  ["-1", "\uD83D\uDC4E"],
  ["laugh", "\uD83D\uDE04"],
  ["hooray", "\uD83C\uDF89"],
  ["confused", "\uD83D\uDE15"],
  ["heart", "\u2764\uFE0F"],
  ["rocket", "\uD83D\uDE80"],
  ["eyes", "\uD83D\uDC40"],
];

const EMOJI_MAP = Object.fromEntries(REACTION_EMOJI);

interface ReactionDisplayProps {
  reactions: Reactions;
  owner?: string;
  repo?: string;
  contentType?: "issue" | "issueComment";
  contentId?: number;
  className?: string;
}

// Portal-based tooltip that escapes overflow:hidden
function Tooltip({
  anchorRef,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.top + window.scrollY - 4,
      left: rect.left + rect.width / 2 + window.scrollX,
    });
  }, [anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
    >
      {children}
    </div>,
    document.body
  );
}

// Context menu for right-click "see all reactions"
function ReactionsContextMenu({
  x,
  y,
  entries,
  reactionUsers,
  onClose,
}: {
  x: number;
  y: number;
  entries: { key: string; emoji: string; count: number }[];
  reactionUsers: ReactionUser[] | null;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [onClose]);

  // Clamp position to viewport
  const style: React.CSSProperties = {
    top: Math.min(y, window.innerHeight - 300),
    left: Math.min(x, window.innerWidth - 240),
  };

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] w-56 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
      style={style}
    >
      <div className="px-3 py-2 border-b border-border">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Reactions
        </span>
      </div>
      {entries.map((r) => {
        const users = reactionUsers
          ? reactionUsers.filter((u) => u.content === r.key)
          : [];
        return (
          <div key={r.key} className="px-3 py-1.5 border-b border-border/50 last:border-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm">{r.emoji}</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {r.count}
              </span>
            </div>
            {users.length > 0 ? (
              <div className="space-y-1">
                {users.map((u) => (
                  <Link
                    key={u.login}
                    href={`/users/${u.login}`}
                    onClick={onClose}
                    className="flex items-center gap-1.5 hover:bg-muted/50 -mx-1 px-1 py-0.5 rounded transition-colors"
                  >
                    {u.avatar_url ? (
                      <Image
                        src={u.avatar_url}
                        alt={u.login}
                        width={14}
                        height={14}
                        className="rounded-full shrink-0"
                      />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full bg-muted-foreground shrink-0" />
                    )}
                    <span className="text-[11px] font-mono text-foreground/80 truncate">
                      {u.login}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <span className="text-[10px] text-muted-foreground/50">Loading...</span>
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
}

export function ReactionDisplay({
  reactions,
  owner,
  repo,
  contentType,
  contentId,
  className,
}: ReactionDisplayProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [reactionUsers, setReactionUsers] = useState<ReactionUser[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoveredRef = useRef<HTMLSpanElement | null>(null);

  const canFetch = !!(owner && repo && contentType && contentId);

  // Pre-fetch reaction users on mount
  useEffect(() => {
    if (!canFetch) return;
    let cancelled = false;
    getReactionUsers(owner!, repo!, contentType!, contentId!).then((res) => {
      if (!cancelled) setReactionUsers(res.users);
    });
    return () => {
      cancelled = true;
    };
  }, [canFetch, owner, repo, contentType, contentId]);

  const handleMouseEnter = (key: string, el: HTMLSpanElement) => {
    hoverTimeout.current = setTimeout(() => {
      hoveredRef.current = el;
      setHoveredKey(key);
    }, 300);
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeout.current);
    setHoveredKey(null);
    hoveredRef.current = null;
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const entries = REACTION_EMOJI.map(([key, emoji]) => ({
    key,
    emoji,
    count: (typeof reactions[key] === "number" ? reactions[key] : 0) as number,
  })).filter((r) => r.count > 0);

  if (entries.length === 0) return null;

  const getUsersForReaction = (key: string): ReactionUser[] => {
    if (!reactionUsers) return [];
    return reactionUsers.filter((u) => u.content === key);
  };

  return (
    <>
      <div
        className={cn("flex items-center gap-1 flex-wrap", className)}
        onContextMenu={handleContextMenu}
      >
        {entries.map((r) => {
          const isHovered = hoveredKey === r.key;
          const users = getUsersForReaction(r.key);
          // Show up to 3 avatars
          const displayAvatars = users.slice(0, 3);

          return (
            <span
              key={r.key}
              className="relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-border bg-muted/40 dark:bg-white/[0.03] text-[11px] cursor-default select-none"
              onMouseEnter={(e) => handleMouseEnter(r.key, e.currentTarget)}
              onMouseLeave={handleMouseLeave}
            >
              <span>{r.emoji}</span>

              {/* Small user avatars */}
              {displayAvatars.length > 0 && (
                <span className="inline-flex -space-x-1">
                  {displayAvatars.map((u) => (
                    u.avatar_url ? (
                      <Image
                        key={u.login}
                        src={u.avatar_url}
                        alt={u.login}
                        width={12}
                        height={12}
                        className="rounded-full ring-1 ring-background shrink-0"
                      />
                    ) : (
                      <span
                        key={u.login}
                        className="w-3 h-3 rounded-full bg-muted-foreground ring-1 ring-background shrink-0"
                      />
                    )
                  ))}
                </span>
              )}

              <span className="font-mono text-muted-foreground/70 text-[10px]">
                {r.count}
              </span>

              {/* Portal tooltip */}
              {isHovered && (
                <Tooltip anchorRef={hoveredRef}>
                  <div className="bg-card text-foreground text-[10px] font-mono px-2 py-1 rounded shadow-lg border border-border whitespace-nowrap max-w-[220px]">
                    {users.length > 0 ? (
                      <span className="truncate block">
                        {users.slice(0, 10).map((u) => u.login).join(", ")}
                        {users.length > 10 && ` +${users.length - 10}`}
                      </span>
                    ) : (
                      <span>
                        {r.emoji} {r.count} reaction{r.count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </Tooltip>
              )}
            </span>
          );
        })}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <ReactionsContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entries={entries}
          reactionUsers={reactionUsers}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
}
