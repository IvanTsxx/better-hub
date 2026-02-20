import Image from "next/image";
import Link from "next/link";

interface Assignee {
  login: string;
  avatar_url: string;
}

interface IssueSidebarProps {
  assignees?: Assignee[];
  milestone?: string | null;
}

export function IssueSidebar({
  assignees,
  milestone,
}: IssueSidebarProps) {
  return (
    <>
      {/* Assignees */}
      {assignees && assignees.length > 0 && (
        <div>
          <h3 className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">
            Assignees
          </h3>
          <div className="space-y-1.5">
            {assignees.map((a) => (
              <Link
                key={a.login}
                href={`/users/${a.login}`}
                className="flex items-center gap-2 text-xs text-foreground/70 hover:text-foreground transition-colors"
              >
                <Image
                  src={a.avatar_url}
                  alt={a.login}
                  width={18}
                  height={18}
                  className="rounded-full"
                />
                <span className="font-mono truncate">{a.login}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Milestone */}
      {milestone && (
        <div>
          <h3 className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">
            Milestone
          </h3>
          <span className="text-xs text-foreground/70 font-mono">{milestone}</span>
        </div>
      )}
    </>
  );
}
