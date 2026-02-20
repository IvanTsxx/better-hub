import { NextRequest, NextResponse } from "next/server";
import { getOctokit } from "@/lib/github";

interface LogLine {
  timestamp: string | null;
  content: string;
  annotation: "error" | "warning" | "debug" | "notice" | null;
}

interface StepLog {
  stepNumber: number;
  stepName: string;
  lines: LogLine[];
}

function parseLogText(raw: string): StepLog[] {
  const steps: StepLog[] = [];
  let current: StepLog | null = null;
  let stepCounter = 0;

  for (const line of raw.split("\n")) {
    // Detect step boundaries via ##[group] markers
    // Format: "2024-01-01T00:00:00.0000000Z ##[group]Step Name"
    const groupMatch = line.match(
      /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+##\[group\](.*)/
    );
    if (groupMatch) {
      stepCounter++;
      current = {
        stepNumber: stepCounter,
        stepName: groupMatch[2].trim(),
        lines: [],
      };
      steps.push(current);
      continue;
    }

    // End of step group
    if (line.includes("##[endgroup]")) {
      continue;
    }

    if (!current) {
      // Lines before any group — create an implicit step
      if (line.trim()) {
        stepCounter++;
        current = {
          stepNumber: stepCounter,
          stepName: "Setup",
          lines: [],
        };
        steps.push(current);
      } else {
        continue;
      }
    }

    // Parse timestamp and content
    const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.*)/);
    const timestamp = tsMatch ? tsMatch[1] : null;
    let content = tsMatch ? tsMatch[2] : line;

    // Detect annotations
    let annotation: LogLine["annotation"] = null;
    const annoMatch = content.match(/^##\[(error|warning|debug|notice)\](.*)/);
    if (annoMatch) {
      annotation = annoMatch[1] as LogLine["annotation"];
      content = annoMatch[2];
    }

    current.lines.push({ timestamp, content, annotation });
  }

  return steps;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const owner = searchParams.get("owner");
  const repo = searchParams.get("repo");
  const jobId = searchParams.get("job_id");

  if (!owner || !repo || !jobId) {
    return NextResponse.json(
      { error: "Missing owner, repo, or job_id" },
      { status: 400 }
    );
  }

  const octokit = await getOctokit();
  if (!octokit) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { data } = await (octokit.actions.downloadJobLogsForWorkflowRun as any)({
      owner,
      repo,
      job_id: Number(jobId),
    });

    // data is the raw log text (string)
    const steps = parseLogText(typeof data === "string" ? data : String(data));

    return NextResponse.json({ steps });
  } catch (err: any) {
    if (err.status === 410) {
      return NextResponse.json(
        { error: "Logs are no longer available" },
        { status: 410 }
      );
    }
    if (err.status === 404) {
      return NextResponse.json(
        { error: "Job not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
