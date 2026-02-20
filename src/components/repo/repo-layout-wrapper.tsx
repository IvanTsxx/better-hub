"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { PanelLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface RepoLayoutWrapperProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  owner: string;
  repo: string;
  avatarUrl?: string;
}

const DEFAULT_WIDTH = 260;
const SNAP_THRESHOLD = 120;

export function RepoLayoutWrapper({ sidebar, children, owner, repo, avatarUrl }: RepoLayoutWrapperProps) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const lastOpenWidthRef = useRef(DEFAULT_WIDTH);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const isDraggingRef = useRef(false);

  const collapsed = sidebarWidth === 0;

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: sidebarWidth || lastOpenWidthRef.current };
    isDraggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const raw = dragRef.current.startWidth + delta;
      if (raw < SNAP_THRESHOLD) {
        setSidebarWidth(0);
      } else {
        const clamped = Math.max(180, Math.min(DEFAULT_WIDTH, raw));
        setSidebarWidth(clamped);
        lastOpenWidthRef.current = clamped;
      }
    };
    const onUp = () => {
      dragRef.current = null;
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [sidebarWidth]);

  const handleExpand = useCallback(() => {
    setSidebarWidth(lastOpenWidthRef.current || DEFAULT_WIDTH);
  }, []);

  const handleCollapse = useCallback(() => {
    if (sidebarWidth > 0) lastOpenWidthRef.current = sidebarWidth;
    setSidebarWidth(0);
  }, [sidebarWidth]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Repo header — always visible */}
      <div className={cn("shrink-0 flex items-center pb-1", collapsed ? "pl-4 pr-2" : "px-4")}>
        <div className="flex items-center gap-1 text-sm font-mono">
          <Link
            href={`/orgs/${owner}`}
            className="text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            {owner}
          </Link>
          <span className="text-muted-foreground/30">/</span>
          <Link
            href={`/${owner}/${repo}`}
            className="font-medium text-foreground hover:text-foreground/80 transition-colors"
          >
            {repo}
          </Link>
        </div>
      </div>

    <div className="flex flex-col lg:flex-row flex-1 min-h-0">
      {/* Sidebar */}
      <div
        className="hidden lg:flex shrink-0 overflow-hidden min-h-0"
        style={{ width: sidebarWidth }}
      >
        {!collapsed && (
          <div className="overflow-y-auto min-h-0" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
            {sidebar}
          </div>
        )}
      </div>

      {/* Resize handle + collapse/expand */}
      {collapsed ? (
        /* Invisible hover zone at left edge — reveals expand button on hover */
        <div className="hidden lg:flex shrink-0 w-2 group/expand items-center justify-center">
          <button
            type="button"
            onClick={handleExpand}
            className="p-1 rounded-md text-muted-foreground/0 group-hover/expand:text-muted-foreground/60 hover:!text-foreground hover:bg-muted/60 transition-all duration-150 cursor-pointer"
            title="Show sidebar"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="hidden lg:flex shrink-0 flex-col items-center">
          <div
            onMouseDown={handleDragStart}
            className="flex-1 w-1 cursor-col-resize flex items-center justify-center hover:bg-foreground/10 active:bg-foreground/15 transition-colors group/resize"
          >
            <div className="w-[2px] h-8 rounded-full bg-border group-hover/resize:bg-foreground/20 group-active/resize:bg-foreground/30 transition-colors" />
          </div>
          <button
            type="button"
            onClick={handleCollapse}
            className="flex items-center justify-center w-5 h-5 shrink-0 mb-1 rounded text-muted-foreground/0 hover:text-muted-foreground hover:bg-muted/50 cursor-pointer transition-all duration-150"
            title="Hide sidebar"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main content */}
      <div
        className="flex-1 min-w-0 flex flex-col min-h-0"
        style={{ '--repo-pr': collapsed ? '0.5rem' : '1rem' } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
    </div>
  );
}
