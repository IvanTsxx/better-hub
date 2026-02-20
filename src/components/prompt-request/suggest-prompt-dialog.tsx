"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  X,
  AlertCircle,
  CornerDownLeft,
  Pencil,
  Eye,
  Bold,
  Italic,
  Code,
  Link,
  List,
  ListOrdered,
  Heading2,
  Quote,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { createPromptRequestAction } from "@/app/(app)/repos/[owner]/[repo]/prompts/actions";

interface SuggestPromptDialogProps {
  owner: string;
  repo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SuggestPromptDialog({
  owner,
  repo,
  open,
  onOpenChange,
}: SuggestPromptDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [bodyTab, setBodyTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleClose = () => {
    onOpenChange(false);
  };

  const reset = () => {
    setTitle("");
    setBody("");
    setError(null);
    setBodyTab("write");
  };

  const insertMarkdown = (before: string, after: string = "", placeholder = "") => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = body.slice(start, end);
    const text = selected || placeholder;
    const newBody = body.slice(0, start) + before + text + after + body.slice(end);
    setBody(newBody);
    requestAnimationFrame(() => {
      ta.focus();
      const cursorStart = start + before.length;
      const cursorEnd = cursorStart + text.length;
      ta.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  const toolbarItems = [
    { icon: <Heading2 className="w-3.5 h-3.5" />, action: () => insertMarkdown("## ", "", "heading"), title: "Heading" },
    { icon: <Bold className="w-3.5 h-3.5" />, action: () => insertMarkdown("**", "**", "bold"), title: "Bold" },
    { icon: <Italic className="w-3.5 h-3.5" />, action: () => insertMarkdown("_", "_", "italic"), title: "Italic" },
    { divider: true },
    { icon: <Code className="w-3.5 h-3.5" />, action: () => insertMarkdown("`", "`", "code"), title: "Code" },
    { icon: <Link className="w-3.5 h-3.5" />, action: () => insertMarkdown("[", "](url)", "text"), title: "Link" },
    { divider: true },
    { icon: <Quote className="w-3.5 h-3.5" />, action: () => insertMarkdown("> ", "", "quote"), title: "Quote" },
    { icon: <List className="w-3.5 h-3.5" />, action: () => insertMarkdown("- ", "", "item"), title: "Bullet list" },
    { icon: <ListOrdered className="w-3.5 h-3.5" />, action: () => insertMarkdown("1. ", "", "item"), title: "Numbered list" },
  ] as const;

  const handleSubmit = () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!body.trim()) {
      setError("Describe the change you want");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const pr = await createPromptRequestAction(
          owner,
          repo,
          title.trim(),
          body.trim(),
        );
        reset();
        onOpenChange(false);
        router.push(`/${owner}/${repo}/prompts/${pr.id}`);
      } catch {
        setError("Failed to create prompt request");
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          handleClose();
        }
      }}
    >
      <DialogContent
        className="sm:max-w-xl p-0 gap-0 overflow-hidden flex flex-col sm:h-[min(70vh,560px)]"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b border-border/50 dark:border-white/6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-sm font-medium">
                Suggest a prompt
              </DialogTitle>
              <DialogDescription className="text-[11px] text-muted-foreground/50 font-mono">
                {owner}/{repo} &middot; Draft &mdash; won&apos;t run until a maintainer accepts
              </DialogDescription>
            </div>
            <button
              onClick={handleClose}
              className="text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer p-1 rounded-md hover:bg-muted/50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0">
          {/* Title input */}
          <div className="px-4 pt-3 pb-0 shrink-0">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should change?"
              autoFocus
              className="w-full bg-transparent text-base font-medium placeholder:text-muted-foreground/30 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  textareaRef.current?.focus();
                }
              }}
            />
            <div className="h-px bg-border/40 dark:bg-white/6 mt-2" />
          </div>

          {/* Body editor */}
          <div className="flex-1 min-h-0 flex flex-col px-4 pt-2 pb-0">
            <div className="flex items-center gap-0 mb-1.5 shrink-0">
              <button
                onClick={() => setBodyTab("write")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors cursor-pointer",
                  bodyTab === "write"
                    ? "text-foreground bg-muted/60 dark:bg-white/5 font-medium"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                <Pencil className="w-3 h-3" />
                Write
              </button>
              <button
                onClick={() => setBodyTab("preview")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors cursor-pointer",
                  bodyTab === "preview"
                    ? "text-foreground bg-muted/60 dark:bg-white/5 font-medium"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                )}
              >
                <Eye className="w-3 h-3" />
                Preview
              </button>
            </div>

            <div className="flex-1 min-h-0 rounded-lg border border-border/50 dark:border-white/6 overflow-hidden bg-muted/15 dark:bg-white/[0.01] focus-within:border-foreground/15 transition-colors flex flex-col">
              {bodyTab === "write" && (
                <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/30 dark:border-white/5 shrink-0">
                  {toolbarItems.map((item, i) =>
                    "divider" in item ? (
                      <div key={i} className="w-px h-4 bg-border/40 dark:bg-white/6 mx-1" />
                    ) : (
                      <button
                        key={i}
                        type="button"
                        onClick={item.action}
                        title={item.title}
                        className="p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/60 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        {item.icon}
                      </button>
                    )
                  )}
                </div>
              )}
              {bodyTab === "write" ? (
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Describe the change in detail... What files, what behavior, what the end result should look like. (Markdown supported)"
                  className="w-full flex-1 min-h-0 bg-transparent px-3 py-2.5 text-[13px] leading-relaxed placeholder:text-muted-foreground/25 focus:outline-none resize-none font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                />
              ) : (
                <div className="h-full overflow-y-auto px-3 py-2.5">
                  {body.trim() ? (
                    <div className="ghmd text-[13px]">
                      <ReactMarkdown>{body}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-[13px] text-muted-foreground/25 italic">
                      Nothing to preview
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-border/40 dark:border-white/5 shrink-0">
            {error && (
              <div className="flex items-center gap-2 mb-2 text-[11px] text-destructive">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {error}
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/25">
                This creates a draft &mdash; no AI runs until accepted
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleClose}
                  className="px-3 py-1.5 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isPending || !title.trim()}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium rounded-md transition-all cursor-pointer",
                    title.trim()
                      ? "bg-foreground text-background hover:bg-foreground/90"
                      : "bg-muted dark:bg-white/5 text-muted-foreground/30 cursor-not-allowed",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CornerDownLeft className="w-3 h-3 opacity-50" />
                  )}
                  Suggest
                </button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
