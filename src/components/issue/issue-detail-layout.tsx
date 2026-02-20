interface IssueDetailLayoutProps {
  header: React.ReactNode;
  description: React.ReactNode;
  panelHeader?: React.ReactNode;
  conversationPanel: React.ReactNode;
  commentForm?: React.ReactNode;
  sidebar?: React.ReactNode;
}

export function IssueDetailLayout({
  header,
  description,
  panelHeader,
  conversationPanel,
  commentForm,
  sidebar,
}: IssueDetailLayoutProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 pt-3">{header}</div>

      <div className="flex-1 min-h-0 flex gap-6">
        {/* Left: description + metadata */}
        <div className="flex-1 min-w-0 overflow-y-auto pb-8">
          <div className="max-w-3xl space-y-5">
            {description}
            {sidebar && (
              <div className="space-y-5 pt-2">
                {sidebar}
              </div>
            )}
          </div>

          {/* Mobile: conversation below description */}
          <div className="lg:hidden space-y-3 mt-6 pt-6 border-t border-border/40">
            {panelHeader}
            {conversationPanel}
            {commentForm && (
              <div className="pt-3">
                {commentForm}
              </div>
            )}
          </div>
        </div>

        {/* Right: conversation panel */}
        <div className="hidden lg:flex w-[380px] xl:w-[420px] shrink-0 flex-col min-h-0 border-l border-border/40 pl-6">
          {panelHeader && (
            <div className="shrink-0 pb-3">
              {panelHeader}
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-3">
            {conversationPanel}
          </div>
          {commentForm && (
            <div className="shrink-0 px-0 pb-3 pt-3">
              {commentForm}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
