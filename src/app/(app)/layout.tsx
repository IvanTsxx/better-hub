import { Suspense } from "react";
import { headers } from "next/headers";
import { AppNavbar } from "@/components/layout/navbar";
import { GlobalChatProvider } from "@/components/shared/global-chat-provider";
import { GlobalChatPanel } from "@/components/shared/global-chat-panel";
import { auth } from "@/lib/auth";
import { type GhostTabState } from "@/lib/chat-store";
import { ColorThemeProvider } from "@/components/theme/theme-provider";
import { CodeThemeProvider } from "@/components/theme/code-theme-provider";
import { GitHubLinkInterceptor } from "@/components/shared/github-link-interceptor";
import { OnboardingOverlay } from "@/components/onboarding/onboarding-overlay";
import { getAuthenticatedUser } from "@/lib/github";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Fresh tab state every refresh — history is shown as a list in the panel
  const freshTabId = crypto.randomUUID();
  const initialTabState: GhostTabState = {
    tabs: [{ id: freshTabId, label: "New chat" }],
    activeTabId: freshTabId,
    counter: 1,
  };

  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch {}

  // Fetch GitHub profile for onboarding (cached by local-first system)
  const ghUser = await getAuthenticatedUser().catch(() => null);

  return (
    <GlobalChatProvider initialTabState={initialTabState}>
      <ColorThemeProvider>
      <CodeThemeProvider>
      <GitHubLinkInterceptor>
        <div className="flex flex-col h-dvh overflow-y-auto lg:overflow-hidden">
          <AppNavbar userImage={session?.user?.image || null} userName={session?.user?.name || null} />
          <div className="mt-10 lg:h-[calc(100dvh-var(--spacing)*10)] flex flex-col px-4 pt-2 lg:overflow-auto">
            {children}
          </div>
          <Suspense>
            <GlobalChatPanel />
          </Suspense>
        </div>
        <OnboardingOverlay
          userName={ghUser?.name || ghUser?.login || ""}
          userAvatar={session?.user?.image || ""}
          bio={ghUser?.bio || ""}
          company={(ghUser as any)?.company || ""}
          location={(ghUser as any)?.location || ""}
          publicRepos={(ghUser as any)?.public_repos ?? 0}
          followers={(ghUser as any)?.followers ?? 0}
          createdAt={(ghUser as any)?.created_at || ""}
        />
      </GitHubLinkInterceptor>
      </CodeThemeProvider>
      </ColorThemeProvider>
    </GlobalChatProvider>
  );
}
