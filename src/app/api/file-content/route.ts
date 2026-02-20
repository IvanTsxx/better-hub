import { NextRequest, NextResponse } from "next/server";
import { getFileContent } from "@/lib/github";
import { highlightFullFile } from "@/lib/shiki";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const path = searchParams.get("path");
  const ref = searchParams.get("ref") || undefined;
  const highlight = searchParams.get("highlight") === "true";

  if (!owner || !repo || !path) {
    return NextResponse.json(
      { error: "Missing required parameters: owner, repo, path" },
      { status: 400 }
    );
  }

  const data = await getFileContent(owner, repo, path, ref);
  if (!data) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const content = (data as any).content as string;
  const sha = (data as any).sha as string | undefined;

  if (highlight) {
    try {
      const tokens = await highlightFullFile(content, path);
      return NextResponse.json({ content, tokens, sha });
    } catch {
      // Fall back to content without tokens
      return NextResponse.json({ content, sha });
    }
  }

  return NextResponse.json({ content, sha });
}
