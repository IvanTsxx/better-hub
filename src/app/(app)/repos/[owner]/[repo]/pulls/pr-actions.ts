"use server";

import { getOctokit, getGitHubToken, getAuthenticatedUser, invalidatePullRequestCache, getRepoBranches } from "@/lib/github";
import { revalidatePath } from "next/cache";

export async function fetchBranchNames(owner: string, repo: string) {
  try {
    const branches = await getRepoBranches(owner, repo);
    return (branches || []).map((b: any) => b.name as string);
  } catch {
    return [];
  }
}

export async function updatePRBaseBranch(
  owner: string,
  repo: string,
  pullNumber: number,
  base: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      base,
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    revalidatePath(`/repos/${owner}/${repo}/pulls`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to update base branch" };
  }
}

export async function renamePullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  title: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      title,
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    revalidatePath(`/repos/${owner}/${repo}/pulls`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to rename" };
  }
}

export type MergeMethod = "merge" | "squash" | "rebase";

export async function mergePullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  method: MergeMethod,
  commitTitle?: string,
  commitMessage?: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      merge_method: method,
      ...(commitTitle ? { commit_title: commitTitle } : {}),
      ...(commitMessage ? { commit_message: commitMessage } : {}),
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    revalidatePath(`/repos/${owner}/${repo}/pulls`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to merge" };
  }
}

export async function closePullRequest(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      state: "closed",
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    revalidatePath(`/repos/${owner}/${repo}/pulls`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to close" };
  }
}

export async function reopenPullRequest(
  owner: string,
  repo: string,
  pullNumber: number
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.pulls.update({
      owner,
      repo,
      pull_number: pullNumber,
      state: "open",
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    revalidatePath(`/repos/${owner}/${repo}/pulls`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to reopen" };
  }
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export async function submitPRReview(
  owner: string,
  repo: string,
  pullNumber: number,
  event: ReviewEvent,
  body?: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      event,
      ...(body ? { body } : {}),
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to submit review" };
  }
}

export async function addPRComment(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to add comment" };
  }
}

export async function addPRReviewComment(
  owner: string,
  repo: string,
  pullNumber: number,
  body: string,
  commitId: string,
  path: string,
  line: number,
  side: "LEFT" | "RIGHT",
  startLine?: number,
  startSide?: "LEFT" | "RIGHT"
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    const params: Record<string, any> = {
      owner,
      repo,
      pull_number: pullNumber,
      body,
      commit_id: commitId,
      path,
      line,
      side,
    };
    if (startLine !== undefined && startLine !== line) {
      params.start_line = startLine;
      params.start_side = startSide || side;
    }
    await octokit.pulls.createReviewComment(params as any);
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to add review comment" };
  }
}

export async function commitSuggestion(
  owner: string,
  repo: string,
  pullNumber: number,
  path: string,
  branch: string,
  startLine: number,
  endLine: number,
  suggestion: string,
  commitMessage?: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    const { data: fileData } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (Array.isArray(fileData) || fileData.type !== "file") {
      return { error: "Not a file" };
    }

    const content = Buffer.from(
      (fileData as any).content,
      "base64"
    ).toString("utf-8");
    const lines = content.split("\n");

    // Replace lines (1-indexed)
    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const suggestionLines = suggestion.length > 0 ? suggestion.split("\n") : [];
    const newContent = [...before, ...suggestionLines, ...after].join("\n");

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message:
        commitMessage ||
        `Apply suggestion to ${path} (lines ${startLine}-${endLine})`,
      content: Buffer.from(newContent).toString("base64"),
      sha: (fileData as any).sha,
      branch,
    });

    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to commit suggestion" };
  }
}

export async function commitFileEditOnPR(
  owner: string,
  repo: string,
  pullNumber: number,
  path: string,
  branch: string,
  content: string,
  sha: string,
  commitMessage: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    const { data } = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: commitMessage,
      content: Buffer.from(content).toString("base64"),
      sha,
      branch,
    });
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true, newSha: (data.content as any)?.sha };
  } catch (e: any) {
    return { error: e.message || "Failed to commit file edit" };
  }
}

export async function resolveReviewThread(
  threadId: string,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const token = await getGitHubToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `mutation($threadId: ID!) {
          resolveReviewThread(input: { threadId: $threadId }) {
            thread { id isResolved }
          }
        }`,
        variables: { threadId },
      }),
    });
    const json = await response.json();
    if (json.errors?.length) {
      return { error: json.errors[0].message };
    }
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to resolve thread" };
  }
}

export async function unresolveReviewThread(
  threadId: string,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const token = await getGitHubToken();
  if (!token) return { error: "Not authenticated" };

  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `mutation($threadId: ID!) {
          unresolveReviewThread(input: { threadId: $threadId }) {
            thread { id isResolved }
          }
        }`,
        variables: { threadId },
      }),
    });
    const json = await response.json();
    if (json.errors?.length) {
      return { error: json.errors[0].message };
    }
    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || "Failed to unresolve thread" };
  }
}

export async function commitMergeConflictResolution(
  owner: string,
  repo: string,
  pullNumber: number,
  headBranch: string,
  baseBranch: string,
  resolvedFiles: { path: string; content: string }[],
  commitMessage?: string
) {
  const octokit = await getOctokit();
  if (!octokit) return { error: "Not authenticated" };

  try {
    // 1. Get HEAD SHAs of both branches
    const [headRef, baseRef] = await Promise.all([
      octokit.git.getRef({ owner, repo, ref: `heads/${headBranch}` }),
      octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` }),
    ]);
    const headSha = headRef.data.object.sha;
    const baseSha = baseRef.data.object.sha;

    // 2. Get head commit's tree as base
    const { data: headCommit } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: headSha,
    });

    // 3. Create blobs for resolved files
    const treeEntries = await Promise.all(
      resolvedFiles.map(async (file) => {
        const { data: blob } = await octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        return {
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    // 4. Create new tree based on head's tree
    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: headCommit.tree.sha,
      tree: treeEntries,
    });

    // 5. Create merge commit with two parents: [headSha, baseSha]
    const message = commitMessage || `Merge branch '${baseBranch}' into ${headBranch}`;
    const user = await getAuthenticatedUser();
    const { data: mergeCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [headSha, baseSha],
      ...(user
        ? {
            author: {
              name: (user as any).name || (user as any).login || "User",
              email: (user as any).email || `${(user as any).login}@users.noreply.github.com`,
              date: new Date().toISOString(),
            },
          }
        : {}),
    });

    // 6. Update head branch ref to point to merge commit
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${headBranch}`,
      sha: mergeCommit.sha,
    });

    await invalidatePullRequestCache(owner, repo, pullNumber);
    revalidatePath(`/repos/${owner}/${repo}/pulls/${pullNumber}`);
    revalidatePath(`/repos/${owner}/${repo}/pulls`);
    return { success: true, mergeCommitSha: mergeCommit.sha };
  } catch (e: any) {
    return { error: e.message || "Failed to commit merge resolution" };
  }
}
