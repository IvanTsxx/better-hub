"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandMenu } from "@/components/command-menu";

interface AppNavbarProps {
  userImage: string | null;
  userName: string | null;
}

export function AppNavbar({ userImage, userName }: AppNavbarProps) {
  // Track active account avatar (overrides OAuth avatar if a PAT account is active)
  const [activeAvatar, setActiveAvatar] = useState<string | null>(null);
  const [activeLogin, setActiveLogin] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/github-accounts");
        if (res.ok && !cancelled) {
          const data = await res.json();
          const active = data.accounts?.find((a: any) => a.active);
          if (active) {
            setActiveAvatar(active.avatarUrl);
            setActiveLogin(active.login);
          } else {
            setActiveAvatar(null);
            setActiveLogin(null);
          }
        }
      } catch {
        // silent
      }
    })();

    // Re-fetch when account switches (listen for custom event)
    const handler = () => {
      fetch("/api/github-accounts")
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data || cancelled) return;
          const active = data.accounts?.find((a: any) => a.active);
          setActiveAvatar(active?.avatarUrl ?? null);
          setActiveLogin(active?.login ?? null);
        })
        .catch(() => {});
    };
    window.addEventListener("github-account-switched", handler);
    return () => { cancelled = true; window.removeEventListener("github-account-switched", handler); };
  }, []);

  const avatarSrc = activeAvatar || userImage;
  const displayName = activeLogin || userName;

  return (
    <header className="fixed top-0 h-10 flex w-full flex-col bg-background backdrop-blur-lg z-10">
      <nav className="top-0 flex h-full items-center justify-between border-border px-4 md:border-b">
        <div className="flex items-center gap-0" id="navbar-breadcrumb">
          <Link
            className="shrink-0 text-foreground transition-colors text-xs tracking-tight"
            href="/dashboard"
          >
            BETTER-HUB.
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <CommandMenu />
          {avatarSrc && (
            <button
              onClick={() => window.dispatchEvent(new Event("open-accounts-menu"))}
              className="relative shrink-0 cursor-pointer group"
              title={displayName ? `Signed in as ${displayName}` : "Switch account"}
            >
              <img
                src={avatarSrc}
                alt={displayName || "User avatar"}
                className="w-6 h-6 rounded-full border border-border/60 dark:border-white/8 group-hover:border-foreground/20 transition-colors"
              />
              {activeAvatar && (
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 border border-background" title="Using PAT account" />
              )}
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
