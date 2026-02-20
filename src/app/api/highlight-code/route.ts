import { NextRequest, NextResponse } from "next/server";
import { highlightFullFile } from "@/lib/shiki";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, filename } = body as { code?: string; filename?: string };

    if (typeof code !== "string" || !filename) {
      return NextResponse.json(
        { error: "Missing required fields: code, filename" },
        { status: 400 }
      );
    }

    const tokens = await highlightFullFile(code, filename);
    return NextResponse.json({ tokens });
  } catch {
    return NextResponse.json(
      { error: "Failed to highlight code" },
      { status: 500 }
    );
  }
}
