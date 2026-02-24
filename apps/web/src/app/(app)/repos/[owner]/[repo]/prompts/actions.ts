"use server";

import { revalidatePath } from "next/cache";
import {
	createPromptRequest,
	updatePromptRequestStatus,
	deletePromptRequest,
	getPromptRequest,
	setPromptRequestGhostTabId,
	createPromptRequestComment,
	deletePromptRequestComment,
	getPromptRequestComment,
} from "@/lib/prompt-request-store";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function createPromptRequestAction(
	owner: string,
	repo: string,
	title: string,
	body: string,
) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) throw new Error("Unauthorized");

	const pr = await createPromptRequest(session.user.id, owner, repo, title, body);
	revalidatePath(`/repos/${owner}/${repo}/prompts`);
	return pr;
}

export async function acceptPromptRequest(id: string) {
	const pr = await getPromptRequest(id);
	if (!pr) throw new Error("Prompt request not found");
	if (pr.status !== "open") throw new Error("Prompt request is not open");

	await updatePromptRequestStatus(id, "processing");
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts`);
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts/${id}`);

	// Fire-and-forget: kick off the background processor.
	// Forward the user's cookies so the route handler can authenticate.
	const reqHeaders = await headers();
	const cookie = reqHeaders.get("cookie") ?? "";
	const origin = reqHeaders.get("origin") || reqHeaders.get("x-forwarded-host") || "http://localhost:3000";
	const baseUrl = origin.startsWith("http") ? origin : `https://${origin}`;
	fetch(`${baseUrl}/api/ai/prompt-process`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			cookie,
		},
		body: JSON.stringify({ promptRequestId: id }),
	}).catch(() => {
		// If the trigger fails, the prompt stays in "processing" state.
		// The user can reset it from the UI.
	});
}

export async function rejectPromptRequest(id: string) {
	const pr = await getPromptRequest(id);
	if (!pr) throw new Error("Prompt request not found");

	await updatePromptRequestStatus(id, "rejected");
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts`);
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts/${id}`);
}

export async function resetPromptRequest(id: string) {
	const pr = await getPromptRequest(id);
	if (!pr) throw new Error("Prompt request not found");
	if (pr.status !== "processing") throw new Error("Prompt request is not processing");

	await updatePromptRequestStatus(id, "open");
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts`);
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts/${id}`);
}

export async function linkGhostTab(promptRequestId: string, ghostTabId: string) {
	await setPromptRequestGhostTabId(promptRequestId, ghostTabId);
}

export async function deletePromptRequestAction(id: string) {
	const pr = await getPromptRequest(id);
	if (!pr) throw new Error("Prompt request not found");

	await deletePromptRequest(id);
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts`);
}

export async function addPromptComment(promptRequestId: string, body: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) throw new Error("Unauthorized");

	const pr = await getPromptRequest(promptRequestId);
	if (!pr) throw new Error("Prompt request not found");

	const comment = await createPromptRequestComment(
		promptRequestId,
		session.user.id,
		session.user.name,
		session.user.image ?? "",
		body,
	);

	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts/${promptRequestId}`);
	return comment;
}

export async function deletePromptComment(commentId: string, promptRequestId: string) {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user?.id) throw new Error("Unauthorized");

	const comment = await getPromptRequestComment(commentId);
	if (!comment) throw new Error("Comment not found");
	if (comment.userId !== session.user.id)
		throw new Error("Not authorized to delete this comment");

	const pr = await getPromptRequest(promptRequestId);
	if (!pr) throw new Error("Prompt request not found");

	await deletePromptRequestComment(commentId);
	revalidatePath(`/repos/${pr.owner}/${pr.repo}/prompts/${promptRequestId}`);
}
