import { NextRequest, NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";
import { threeWayMerge, type ConflictFileData } from "@/lib/three-way-merge";

const MAX_FILES = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const base = searchParams.get("base");
  const head = searchParams.get("head");

  if (!owner || !repo || !base || !head) {
    return NextResponse.json(
      { error: "Missing required parameters: owner, repo, base, head" },
      { status: 400 }
    );
  }

  const octokit = await getOctokit();
  if (!octokit) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // 1. Compare commits to get merge base + file list
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    const mergeBaseSha = comparison.merge_base_commit.sha;
    const diffFiles = (comparison.files || []).slice(0, MAX_FILES);

    if (diffFiles.length === 0) {
      return NextResponse.json({
        mergeBaseSha,
        baseBranch: base,
        headBranch: head,
        files: [],
      });
    }

    // 2. For each file, fetch 3 versions in parallel: ancestor, base tip, head tip
    const files: ConflictFileData[] = await Promise.all(
      diffFiles.map(async (file) => {
        const filePath = file.filename;

        const fetchContent = async (ref: string): Promise<string | null> => {
          try {
            const { data } = await octokit.repos.getContent({
              owner,
              repo,
              path: filePath,
              ref,
            });
            if (Array.isArray(data) || data.type !== "file") return null;
            return Buffer.from((data as any).content, "base64").toString("utf-8");
          } catch {
            return null; // File doesn't exist at this ref (new/deleted)
          }
        };

        const [ancestorContent, baseContent, headContent] = await Promise.all([
          fetchContent(mergeBaseSha),
          fetchContent(base),
          fetchContent(head),
        ]);

        // Handle new/deleted files
        if (ancestorContent === null && baseContent === null && headContent !== null) {
          // New file only on head side
          return { path: filePath, hunks: [{ type: "clean" as const, resolvedLines: headContent.split("\n") }], hasConflicts: false, autoResolved: true };
        }
        if (ancestorContent === null && headContent === null && baseContent !== null) {
          // New file only on base side
          return { path: filePath, hunks: [{ type: "clean" as const, resolvedLines: baseContent.split("\n") }], hasConflicts: false, autoResolved: true };
        }
        if (baseContent === null && headContent === null) {
          // Both deleted — no conflict
          return { path: filePath, hunks: [], hasConflicts: false, autoResolved: true };
        }

        const ancestor = (ancestorContent ?? "").split("\n");
        const baseLines = (baseContent ?? "").split("\n");
        const headLines = (headContent ?? "").split("\n");

        // If only one side changed from ancestor, auto-resolve
        const baseChanged = baseContent !== ancestorContent;
        const headChanged = headContent !== ancestorContent;

        if (baseChanged && !headChanged) {
          return { path: filePath, hunks: [{ type: "clean" as const, resolvedLines: baseLines }], hasConflicts: false, autoResolved: true };
        }
        if (headChanged && !baseChanged) {
          return { path: filePath, hunks: [{ type: "clean" as const, resolvedLines: headLines }], hasConflicts: false, autoResolved: true };
        }
        if (!baseChanged && !headChanged) {
          return { path: filePath, hunks: [{ type: "clean" as const, resolvedLines: ancestor }], hasConflicts: false, autoResolved: true };
        }

        // Both sides changed — run 3-way merge
        const result = threeWayMerge(ancestor, baseLines, headLines);
        return {
          path: filePath,
          hunks: result.hunks,
          hasConflicts: result.hasConflicts,
          autoResolved: !result.hasConflicts,
        };
      })
    );

    return NextResponse.json({
      mergeBaseSha,
      baseBranch: base,
      headBranch: head,
      files,
    });
  } catch (e: any) {
    console.error("[merge-conflicts] error:", e);
    return NextResponse.json(
      { error: e.message || "Failed to compute merge conflicts" },
      { status: 500 }
    );
  }
}
