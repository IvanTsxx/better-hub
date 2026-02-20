"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Command } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGlobalChatOptional } from "@/components/shared/global-chat-provider";

interface OnboardingOverlayProps {
  userName: string;
  userAvatar: string;
  bio: string;
  company: string;
  location: string;
  publicRepos: number;
  followers: number;
  createdAt: string;
}

const TOTAL_STEPS = 2; // 0: intro slides, 1: ⌘K interactive
const STORAGE_KEY = "onboarding-completed";

const GHOST_WELCOME_PROMPT = `I just started using Better Hub — give me a quick, friendly welcome and overview! I'd love to know:
- What you (Ghost) can help me with (reviewing code, navigating repos, PRs, issues, etc.)
- The three key shortcuts: ⌘K for the Command Center (navigate everything), ⌘I to toggle you (Ghost), and ⌘/ to search repos
- What Prompt Requests are (AI-powered code change suggestions you can make directly on repos)
Keep it concise and conversational. Suggest 2-3 things I should try first.`;

/* ─── Intro narrative slides ─── */

interface IntroSlide {
  tag: string;
  headline: string;
  body: string;
  accent?: string;
}

const INTRO_SLIDES: IntroSlide[] = [
  {
    tag: "Starting point",
    headline: "The workflow works. The tooling can be better.",
    body: "PRs, issues, code review, branches — none of that needs reinventing. But the interface we use every day has room to grow. Small frictions add up across hundreds of interactions.",
    accent: "Same fundamentals. Fewer rough edges.",
  },
  {
    tag: "The details",
    headline: "Better starts with the small things.",
    body: "Keyboard-first navigation so you never lose flow. An AI assistant that reads your actual code and context — not a generic chatbot on the side. A UI that stays out of the way during long sessions.",
    accent: "No big rewrites. Just a better feel for the work you already do.",
  },
  {
    tag: "What's next",
    headline: "Shaped by how you work.",
    body: "Prompt Requests for suggesting code changes directly on repos. Smarter context as you move between PRs, issues, and code. And whatever comes next — driven by real usage, not a roadmap written in a vacuum.",
    accent: "This is early. Your workflow tells us what to build next.",
  },
];

/* ─── Animated counter ─── */

function AnimatedCounter({ target, delay = 0 }: { target: number; delay?: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (target <= 0) return;
    const duration = 1400;
    const timeout = setTimeout(() => {
      const start = performance.now();
      const animate = (now: number) => {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setCount(Math.floor(eased * target));
        if (progress < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }, delay);
    return () => clearTimeout(timeout);
  }, [target, delay]);

  return <>{count.toLocaleString()}</>;
}

/* ─── Main component ─── */

export function OnboardingOverlay({
  userName,
  userAvatar,
  bio,
  publicRepos,
  followers,
  createdAt,
}: OnboardingOverlayProps) {
  const [step, setStep] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const globalChat = useGlobalChatOptional();
  const ghostOpenedRef = useRef(false);

  // Intro sub-slide state: -1 = welcome, 0..2 = narrative, 3 = CTA
  const [introPhase, setIntroPhase] = useState(-1);

  // ⌘K interactive step
  const [cmdkPressed, setCmdkPressed] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const force = params.has("onboarding");
      if (force) localStorage.removeItem(STORAGE_KEY);
      if (!force && localStorage.getItem(STORAGE_KEY) === "true") return;
      const t = setTimeout(() => setVisible(true), 400);
      return () => clearTimeout(t);
    }
  }, []);

  // Open Ghost panel, send welcome prompt, and dismiss overlay
  const openGhostAndComplete = useCallback(() => {
    if (globalChat && !ghostOpenedRef.current) {
      ghostOpenedRef.current = true;
      globalChat.toggleChat();
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("ghost-auto-send", { detail: { message: GHOST_WELCOME_PROMPT } })
        );
      }, 1000);
    }
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      localStorage.setItem(STORAGE_KEY, "true");
    }, 500);
  }, [globalChat]);

  // ⌘K detection: wait for command menu to open then close
  useEffect(() => {
    if (!cmdkPressed) return;
    let appeared = false;
    const check = setInterval(() => {
      const isOpen = !!document.querySelector('[data-state="open"][aria-label="Command Menu"]');
      if (isOpen) {
        appeared = true;
      } else if (appeared) {
        clearInterval(check);
        // Command menu closed → open Ghost and finish
        setTransitioning(true);
        setTimeout(() => {
          setCmdkPressed(false);
          setTransitioning(false);
          openGhostAndComplete();
        }, 300);
      }
    }, 150);
    return () => clearInterval(check);
  }, [cmdkPressed, openGhostAndComplete]);

  const complete = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      localStorage.setItem(STORAGE_KEY, "true");
    }, 500);
  }, []);

  const goNext = useCallback(() => {
    if (step >= TOTAL_STEPS - 1) {
      // Last step (⌘K) → open Ghost and complete
      openGhostAndComplete();
      return;
    }
    setTransitioning(true);
    setTimeout(() => {
      setStep((s) => s + 1);
      setTransitioning(false);
    }, 250);
  }, [step, openGhostAndComplete]);

  const skip = useCallback(() => {
    complete();
  }, [complete]);

  // Intro sub-slide advance
  const advanceIntro = useCallback(() => {
    setIntroPhase((p) => {
      if (p < INTRO_SLIDES.length) return p + 1;
      return p;
    });
  }, []);

  // Keyboard nav
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      // During ⌘K exploration, don't intercept anything
      if (cmdkPressed) return;

      // ⌘K detection for step 1
      if (step === 1 && (e.metaKey || e.ctrlKey) && e.key === "k") {
        setCmdkPressed(true);
        return; // Let command menu handle it
      }

      if (e.key === "Escape") {
        e.preventDefault();
        skip();
        return;
      }
      if (e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        // In intro step, advance sub-slides first
        if (step === 0 && introPhase < INTRO_SLIDES.length) {
          advanceIntro();
        } else {
          goNext();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, goNext, skip, step, introPhase, advanceIntro, cmdkPressed]);

  if (!mounted || !visible) return null;

  const firstName = userName.split(" ")[0] || userName;
  const githubYears = createdAt ? Math.max(0, new Date().getFullYear() - new Date(createdAt).getFullYear()) : 0;
  const profileStats = [
    publicRepos > 0 ? { value: publicRepos, label: "repos" } : null,
    followers > 0 ? { value: followers, label: "followers" } : null,
    githubYears >= 2 ? { value: githubYears, label: "years" } : null,
  ].filter((s): s is { value: number; label: string } => s !== null);

  // Currently active intro slide (if in narrative phase)
  const activeSlide = introPhase >= 0 && introPhase < INTRO_SLIDES.length ? INTRO_SLIDES[introPhase] : null;
  const showCTA = introPhase >= INTRO_SLIDES.length;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[60] transition-all duration-500",
        exiting && "opacity-0 scale-[1.02] pointer-events-none",
        transitioning && "opacity-0",
        cmdkPressed && "opacity-0 pointer-events-none"
      )}
    >
      {/* ─── Step 0: Cinematic Intro ─── */}
      {step === 0 && (
        <div className="absolute inset-0 bg-black overflow-hidden">
          {/* ── Gradient orbs (slow-drifting color depth) ── */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div
              className="absolute rounded-full blur-[140px]"
              style={{
                width: 700, height: 700,
                background: "radial-gradient(circle, rgba(99,102,241,0.35), transparent 70%)",
                top: "-10%", left: "-15%",
                animation: "onboarding-orb-float-1 28s ease-in-out infinite",
                opacity: 0.045,
              }}
            />
            <div
              className="absolute rounded-full blur-[120px]"
              style={{
                width: 550, height: 550,
                background: "radial-gradient(circle, rgba(168,85,247,0.3), transparent 70%)",
                bottom: "-5%", right: "-10%",
                animation: "onboarding-orb-float-2 34s ease-in-out infinite",
                opacity: 0.035,
              }}
            />
            <div
              className="absolute rounded-full blur-[100px]"
              style={{
                width: 400, height: 400,
                background: "radial-gradient(circle, rgba(236,72,153,0.2), transparent 70%)",
                top: "40%", left: "50%",
                animation: "onboarding-orb-float-3 22s ease-in-out infinite",
                opacity: 0.03,
              }}
            />
          </div>

          {/* ── Full-bleed background video ── */}
          <video
            autoPlay
            muted
            loop
            playsInline
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-[1.2s] ease-in-out",
              introPhase === -1 ? "opacity-[0.12]" : activeSlide ? "opacity-[0.06]" : "opacity-[0.14]"
            )}
          >
            <source src="/intro.mp4" type="video/mp4" />
          </video>

          {/* ── Halftone dot pattern ── */}
          <div
            className={cn(
              "absolute inset-0 pointer-events-none transition-opacity duration-[1.5s]",
              introPhase === -1 ? "opacity-[0.35]" : activeSlide ? "opacity-[0.55]" : "opacity-[0.25]"
            )}
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px), radial-gradient(circle, rgba(255,255,255,0.035) 0.5px, transparent 0.5px)",
              backgroundSize: "24px 24px, 12px 12px",
              backgroundPosition: "0 0, 6px 6px",
            }}
          />

          {/* ── Concentric pulse rings (from center) ── */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {[0, 1.5, 3, 4.5].map((delay, i) => (
              <div
                key={i}
                className="absolute rounded-full border border-white/[0.025]"
                style={{
                  width: 300,
                  height: 300,
                  animation: `onboarding-ring-expand 6s ease-out ${delay}s infinite`,
                }}
              />
            ))}
          </div>

          {/* ── Film grain overlay ── */}
          <div
            className="absolute pointer-events-none opacity-[0.025]"
            style={{
              inset: "-50%",
              width: "200%",
              height: "200%",
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              animation: "onboarding-grain 8s steps(10) infinite",
            }}
          />

          {/* ── Gradient overlays to fade video + halftone edges ── */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/40 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,black_75%)] pointer-events-none" />

          {/* Centered content */}
          <div className="relative z-10 flex items-center justify-center w-full h-full px-6 sm:px-10">
            <div className="w-full max-w-lg text-center">
              {/* ── Phase -1: Welcome ── */}
              {introPhase === -1 && (
                <div key="welcome">
                  {userAvatar && (
                    <div className="relative mb-7 ob-scale-in inline-block">
                      <div className="absolute -inset-2 rounded-full border border-white/[0.06]" />
                      <div className="absolute -inset-5 rounded-full border border-white/[0.03]" />
                      <img src={userAvatar} alt={userName} className="w-16 h-16 rounded-full" />
                    </div>
                  )}

                  <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-white/25 mb-3 ob-fade-up">
                    Welcome{firstName ? `, ${firstName}` : ""}
                  </p>

                  <h1 className="text-4xl sm:text-5xl font-semibold text-white tracking-tight leading-[1.1] ob-fade-up-d1">
                    Better Hub
                  </h1>

                  <div className="flex justify-center my-5 ob-fade-in-d1">
                    <div className="h-px w-full max-w-[200px] bg-gradient-to-r from-transparent via-white/20 to-transparent ob-line-draw" />
                  </div>

                  {profileStats.length > 0 && (
                    <div className="flex items-center justify-center ob-fade-up-d2">
                      {profileStats.map((stat, i) => (
                        <div
                          key={stat.label}
                          className={cn(
                            "text-center px-5",
                            i > 0 && "border-l border-white/[0.06]"
                          )}
                        >
                          <div className="text-2xl font-light text-white/80 font-mono tabular-nums">
                            <AnimatedCounter target={stat.value} delay={500 + i * 150} />
                          </div>
                          <div className="text-[9px] uppercase tracking-[0.25em] text-white/20 mt-0.5">
                            {stat.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {bio ? (
                    <p className="text-[12px] text-white/25 leading-relaxed max-w-xs mx-auto mt-4 ob-fade-up-d3">
                      {bio}
                    </p>
                  ) : !profileStats.length ? (
                    <p className="text-[13px] text-white/30 leading-relaxed font-mono ob-fade-up-d2 max-w-sm mx-auto">
                      Welcome to your new home for code.
                    </p>
                  ) : null}

                  <button
                    onClick={advanceIntro}
                    className="group mt-8 inline-flex items-center gap-3 px-6 py-2.5 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-all duration-300 cursor-pointer ob-fade-up-d4"
                  >
                    What&apos;s different
                    <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </button>

                  <div className="mt-3 ob-fade-up-d5">
                    <button
                      onClick={goNext}
                      className="text-[11px] text-white/20 hover:text-white/40 transition-colors cursor-pointer px-3 py-2"
                    >
                      Skip intro
                    </button>
                  </div>
                </div>
              )}

              {/* ── Phase 0-2: Narrative slides ── */}
              {activeSlide && (
                <div key={`slide-${introPhase}`}>
                  <p className="text-[9px] font-mono uppercase tracking-[0.35em] text-white/20 mb-5 ob-fade-up">
                    {activeSlide.tag}
                  </p>

                  <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-[1.15] mb-5 ob-fade-up-d1">
                    {activeSlide.headline}
                  </h2>

                  <p className="text-[13px] text-white/40 leading-relaxed ob-fade-up-d2 max-w-md mx-auto">
                    {activeSlide.body}
                  </p>

                  {activeSlide.accent && (
                    <p className="text-[12px] text-white/60 mt-5 leading-relaxed font-mono ob-fade-up-d3 max-w-sm mx-auto">
                      {activeSlide.accent}
                    </p>
                  )}

                  <div className="mt-8 flex items-center justify-center gap-4 ob-fade-up-d4">
                    <button
                      onClick={advanceIntro}
                      className="group inline-flex items-center gap-2 text-[12px] text-white/60 hover:text-white transition-colors cursor-pointer"
                    >
                      {introPhase < INTRO_SLIDES.length - 1 ? "Continue" : "Get started"}
                      <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </button>
                    <button
                      onClick={goNext}
                      className="text-[10px] text-white/15 hover:text-white/40 transition-colors cursor-pointer"
                    >
                      Skip
                    </button>
                  </div>

                  {/* Slide progress */}
                  <div className="flex items-center justify-center gap-1.5 mt-6 ob-fade-in-d2">
                    {INTRO_SLIDES.map((_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-0.5 rounded-full transition-all duration-500",
                          i === introPhase
                            ? "w-6 bg-white/50"
                            : i < introPhase
                            ? "w-3 bg-white/20"
                            : "w-3 bg-white/[0.06]"
                        )}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* ── Phase 3: CTA ── */}
              {showCTA && (
                <div key="cta">
                  <p className="text-[9px] font-mono uppercase tracking-[0.35em] text-white/20 mb-5 ob-fade-up">
                    Let&apos;s go
                  </p>

                  <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight leading-[1.1] ob-fade-up-d1">
                    This is Better Hub.
                  </h2>

                  <div className="flex justify-center my-5 ob-fade-in-d1">
                    <div className="h-px w-full max-w-[200px] bg-gradient-to-r from-transparent via-white/20 to-transparent ob-line-draw" />
                  </div>

                  <div className="space-y-3 mt-5 text-left max-w-sm mx-auto">
                    {[
                      { label: "Keyboard-first", desc: "Every action, one keystroke away." },
                      { label: "AI-native", desc: "Ghost understands your code, not just your questions." },
                      { label: "Context-aware", desc: "The interface follows what you're working on." },
                      { label: "Built for long sessions", desc: "Designed to feel good at hour three, not just minute one." },
                    ].map((item, i) => (
                      <div key={item.label} className={cn("flex gap-3 items-start", `ob-fade-up-d${i + 1}`)}>
                        <div className="mt-1.5 w-1 h-1 rounded-full bg-white/30 shrink-0" />
                        <p className="text-[12px] text-white/35 leading-relaxed">
                          <span className="text-white/70 font-medium">{item.label}.</span>{" "}
                          {item.desc}
                        </p>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={goNext}
                    className="group mt-8 inline-flex items-center gap-3 px-7 py-3 rounded-full bg-white text-black text-sm font-medium hover:bg-white/90 transition-all duration-300 cursor-pointer ob-fade-up-d5"
                  >
                    Get started
                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Step 1: ⌘K Interactive ─── */}
      {step === 1 && !cmdkPressed && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center">
          <div className="max-w-sm px-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center mx-auto mb-5 ob-scale-in">
              <Command className="w-5 h-5 text-white/50" />
            </div>

            <p className="text-[9px] font-mono uppercase tracking-[0.35em] text-white/20 mb-4 ob-fade-up">
              Command Center
            </p>

            <h2 className="text-2xl font-semibold text-white tracking-tight mb-3 ob-fade-up-d1">
              Everything starts here.
            </h2>

            <p className="text-[13px] text-white/40 leading-relaxed mb-8 ob-fade-up-d2">
              Search repos, switch themes, navigate anywhere.
              <br />
              One shortcut to rule them all.
            </p>

            <div className="flex items-center justify-center gap-1.5 mb-3 ob-fade-up-d3">
              <kbd className="inline-flex items-center gap-1.5 px-5 py-3 rounded-xl border border-white/10 bg-white/[0.04] font-mono text-lg text-white/70">
                <span>&#x2318;</span>K
              </kbd>
            </div>

            <p className="text-[11px] text-white/25 mb-8 ob-fade-up-d4">
              Press <span className="text-white/50 font-medium">&#x2318;K</span> to try it
            </p>

            <button
              onClick={goNext}
              className="text-[11px] text-white/15 hover:text-white/40 transition-colors cursor-pointer ob-fade-up-d5"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
