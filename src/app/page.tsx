"use client";

import { signIn, useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Logo } from "@/components/ui/logo";
import { HalftoneBackground } from "@/components/ui/halftone-background";
import { AgentIcon } from "@/components/ui/agent-icon";

function KeyboardIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm4 2v.01m4-.01v.01m4-.01v.01m4-.01v.01M6 14v.01M18 14v.01M10 14l4 .01" /></svg>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12.748 3.572c.059-.503-.532-.777-.835-.388L4.111 13.197c-.258.33-.038.832.364.832h6.988c.285 0 .506.267.47.57l-.68 5.83c-.06.502.53.776.834.387l7.802-10.013c.258-.33.038-.832-.364-.832h-6.988c-.285 0-.506-.267-.47-.57z" /></svg>
  );
}


function GithubIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489c.5.092.682-.217.682-.482c0-.237-.008-.866-.013-1.7c-2.782.603-3.369-1.342-3.369-1.342c-.454-1.155-1.11-1.462-1.11-1.462c-.908-.62.069-.608.069-.608c1.003.07 1.531 1.03 1.531 1.03c.892 1.529 2.341 1.087 2.91.832c.092-.647.35-1.088.636-1.338c-2.22-.253-4.555-1.11-4.555-4.943c0-1.091.39-1.984 1.029-2.683c-.103-.253-.446-1.27.098-2.647c0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025c.546 1.377.203 2.394.1 2.647c.64.699 1.028 1.592 1.028 2.683c0 3.842-2.339 4.687-4.566 4.935c.359.309.678.919.678 1.852c0 1.336-.012 2.415-.012 2.743c0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10" /></svg>
  );
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={className}><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 12h14m-7-7l7 7l-7 7" /></svg>
  );
}

export default function LoginPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    setTheme("light");
  }, [setTheme]);

  useEffect(() => {
    if (session) {
      router.push("/dashboard");
    }
  }, [session, router]);

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-4 h-4 border-2 border-foreground/20 border-t-foreground/60 rounded-full animate-spin" />
      </div>
    );
  }

  if (session) return null;

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left — Shader hero */}
      <div
        className="hidden lg:flex flex-1 relative overflow-hidden"
        style={{ background: "var(--shader-bg)" }}
      >
        <HalftoneBackground />

        {/* Branding overlay */}
        <div className="relative z-10 flex flex-col justify-end p-10 w-full h-full gap-8">
          <div className="absolute top-10 left-10">
            <Logo className="h-3.5 text-foreground/60" />
          </div>

          <div className="max-w-md">
            <h1 className="text-4xl font-medium tracking-tight text-foreground leading-[1.15]">
              Reimagining code
              <br />
              collaboration.
            </h1>
            <svg
              viewBox="0 0 320 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="w-72 mt-2"
            >
              <path
                d="M2 16 C100 13, 200 8, 318 2"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                className="text-foreground/25"
              />
              <path
                d="M2 18 C80 15, 180 9, 318 4"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                className="text-foreground/25"
              />
            </svg>
            <p className="text-foreground/55 text-sm leading-relaxed mt-4 max-w-sm">
              A better place to collaborate on code — for humans
              and agents.
            </p>

            <div className="flex items-center gap-6 mt-8">
              <div className="flex items-center gap-2 text-foreground/50">
                <KeyboardIcon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">Keyboard-first</span>
              </div>
              <div className="flex items-center gap-2 text-foreground/50">
                <ZapIcon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">Instant</span>
              </div>
              <div className="flex items-center gap-2 text-foreground/50">
                <AgentIcon className="w-4 h-4" />
                <span className="text-[11px] font-mono">Agentic</span>
              </div>
            </div>
          </div>

          {/* Dashboard preview — fanned cards */}
          <div className="relative w-full max-w-2xl h-72 xl:h-80">
            {/* Back card (dash2) — rotated and offset to the left */}
            <div className="absolute inset-0 -rotate-2 -translate-x-6 -translate-y-2 origin-bottom-right">
              <div className="rounded-lg border border-foreground/6 overflow-hidden shadow-xl shadow-black/10 opacity-70">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/dash2.png"
                  alt="Repository view"
                  className="w-full h-auto block dark:hidden"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/dash2-light.png"
                  alt="Repository view"
                  className="w-full h-auto hidden dark:block"
                />
              </div>
            </div>

            {/* Front card — slight counter-rotation */}
            <div className="absolute inset-0 rotate-1 origin-bottom-right z-10">
              <div className="rounded-lg border border-foreground/8 overflow-hidden shadow-2xl shadow-black/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/dash1.png"
                  alt="Dashboard preview"
                  className="w-full h-auto block dark:hidden"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/dash1-light.png"
                  alt="Dashboard preview"
                  className="w-full h-auto hidden dark:block"
                />
              </div>
            </div>

            {/* Fade-out gradient — short, only at the very bottom */}
            <div className="absolute inset-x-0 -bottom-10 h-1/3 pointer-events-none z-20" style={{ background: "linear-gradient(to top, var(--shader-bg) 0%, transparent 100%)" }} />
          </div>
        </div>
      </div>

      {/* Right — Login */}
      <div
        className="flex-1 flex items-center justify-center p-8 lg:max-w-xl"
        style={{ borderLeft: "1px solid var(--hero-border)" }}
      >
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-12">
            <Logo className="h-3.5 text-foreground/60" />
          </div>

          <div className="mb-5">
            <h2 className="text-lg font-medium tracking-tight text-foreground lg:text-xl">
              Sign in to continue
            </h2>
            <p className="text-foreground/55 text-sm mt-1">
              Connect your GitHub account to get started.
            </p>
          </div>

          <button
            onClick={() =>
              signIn.social({
                provider: "github",
                callbackURL: "/dashboard",
              })
            }
            className="w-full flex items-center justify-center gap-3 bg-foreground text-background font-medium py-3 px-6 rounded-md text-sm hover:bg-foreground/90 transition-colors cursor-pointer"
          >
            <GithubIcon className="w-4 h-4" />
            Continue with GitHub
            <ArrowRightIcon className="w-3.5 h-3.5 ml-auto" />
          </button>

          <p className="text-[11px] text-foreground/50 mt-2">
            We&apos;ll request read access to your repos, PRs &amp;
            notifications.
          </p>
        </div>
      </div>
    </div>
  );
}
