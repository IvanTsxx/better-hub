const STORAGE_KEY = "better-github-pinned-repos";
const MAX_PINNED = 10;

export interface PinnedRepo {
	id: number;
	full_name: string;
	name: string;
	owner: { login: string; avatar_url: string };
	language: string | null;
	stargazers_count: number;
	private: boolean;
	pinnedAt: number;
}

export function getPinnedRepos(): PinnedRepo[] {
	if (typeof window === "undefined") return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		return JSON.parse(raw) as PinnedRepo[];
	} catch {
		return [];
	}
}

export function isPinnedRepo(fullName: string): boolean {
	const pinned = getPinnedRepos();
	return pinned.some((r) => r.full_name === fullName);
}

export function pinRepo(repo: Omit<PinnedRepo, "pinnedAt">): PinnedRepo[] {
	if (typeof window === "undefined") return [];
	try {
		const pinned = getPinnedRepos();
		if (pinned.some((r) => r.full_name === repo.full_name)) {
			return pinned;
		}
		const updated = [{ ...repo, pinnedAt: Date.now() }, ...pinned].slice(0, MAX_PINNED);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
		return updated;
	} catch {
		return getPinnedRepos();
	}
}

export function unpinRepo(fullName: string): PinnedRepo[] {
	if (typeof window === "undefined") return [];
	try {
		const pinned = getPinnedRepos();
		const updated = pinned.filter((r) => r.full_name !== fullName);
		localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
		return updated;
	} catch {
		return getPinnedRepos();
	}
}

export function togglePinRepo(repo: Omit<PinnedRepo, "pinnedAt">): PinnedRepo[] {
	if (isPinnedRepo(repo.full_name)) {
		return unpinRepo(repo.full_name);
	}
	return pinRepo(repo);
}
