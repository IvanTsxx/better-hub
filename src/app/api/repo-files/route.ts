import { NextRequest, NextResponse } from "next/server";
import { getRepo, getRepoTree } from "@/lib/github";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Missing owner/repo" },
      { status: 400 }
    );
  }

  const repoData = await getRepo(owner, repo);
  if (!repoData) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const defaultBranch = (repoData as any).default_branch ?? "main";
  const tree = await getRepoTree(owner, repo, defaultBranch, true);

  const files = ((tree as any)?.tree ?? [])
    .filter(
      (item: any) => item.type === "blob" && item.path
    )
    .map((item: any) => item.path as string);

  return NextResponse.json({ files, defaultBranch });
}
