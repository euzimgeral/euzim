"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { friendlySocialDbError } from "@/lib/social/db-errors";
import type { StoryVisibility } from "@/lib/social/types";

export type PendingVisibilityRequest = {
  id: string;
  storyId: string;
  storyTitle: string;
  requesterName: string;
  toVisibility: StoryVisibility;
  createdAt: string;
};

type Db = NonNullable<
  ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof createClient>>
>;

async function dbClient(): Promise<Db | null> {
  return createAdminClient() ?? (await createClient());
}

/** Colaboradores da história (outras contas no cast). */
export async function listStoryCollaboratorIds(
  db: Db,
  storyId: string,
  ownerId: string,
): Promise<string[]> {
  const { data } = await db
    .from("stories")
    .select("generation_meta, parent_id")
    .eq("id", storyId)
    .maybeSingle();

  if (!data || data.parent_id !== ownerId) return [];

  const meta = (data.generation_meta ?? {}) as {
    friendParentId?: string | null;
    collaboratorParentIds?: string[] | null;
  };

  const ids = new Set<string>();
  if (meta.friendParentId && meta.friendParentId !== ownerId) {
    ids.add(meta.friendParentId);
  }
  for (const id of meta.collaboratorParentIds ?? []) {
    if (id && id !== ownerId) ids.add(id);
  }
  return [...ids];
}

export async function listPendingVisibilityApprovalsForUser(
  userId: string,
): Promise<PendingVisibilityRequest[]> {
  const db = await dbClient();
  if (!db) return [];

  const { data: approvals, error } = await db
    .from("story_visibility_approvals")
    .select("request_id")
    .eq("collaborator_id", userId)
    .is("decision", null);

  if (error || !approvals?.length) return [];

  const requestIds = approvals.map((a) => a.request_id);
  const { data: requests } = await db
    .from("story_visibility_requests")
    .select("id, story_id, requester_id, to_visibility, created_at, status")
    .in("id", requestIds)
    .eq("status", "pending");

  if (!requests?.length) return [];

  const storyIds = [...new Set(requests.map((r) => r.story_id))];
  const requesterIds = [...new Set(requests.map((r) => r.requester_id))];

  const [{ data: stories }, { data: users }] = await Promise.all([
    db.from("stories").select("id, title").in("id", storyIds),
    db
      .from("users")
      .select("id, full_name, display_name, email")
      .in("id", requesterIds),
  ]);

  const storyMap = new Map((stories ?? []).map((s) => [s.id, s.title]));
  const userMap = new Map(
    (users ?? []).map((u) => [
      u.id,
      u.full_name || u.display_name || u.email || "Amigo",
    ]),
  );

  return requests.map((r) => ({
    id: r.id,
    storyId: r.story_id,
    storyTitle: storyMap.get(r.story_id) ?? "História",
    requesterName: userMap.get(r.requester_id) ?? "Amigo",
    toVisibility: r.to_visibility as StoryVisibility,
    createdAt: r.created_at,
  }));
}

export async function respondVisibilityRequestAction(
  requestId: string,
  decision: "approved" | "rejected",
): Promise<{ error?: string; success?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Não autenticado." };

  const db = await dbClient();
  if (!db) return { error: "Banco indisponível." };

  const { data: approval, error: aErr } = await db
    .from("story_visibility_approvals")
    .select("id, request_id, collaborator_id, decision")
    .eq("request_id", requestId)
    .eq("collaborator_id", user.id)
    .maybeSingle();

  if (aErr) return { error: friendlySocialDbError(aErr.message) };
  if (!approval) return { error: "Pedido não encontrado." };
  if (approval.decision) return { error: "Você já respondeu este pedido." };

  const { error: updErr } = await db
    .from("story_visibility_approvals")
    .update({ decision, decided_at: new Date().toISOString() })
    .eq("id", approval.id);

  if (updErr) return { error: friendlySocialDbError(updErr.message) };

  const { data: request } = await db
    .from("story_visibility_requests")
    .select("id, story_id, to_visibility, status, requester_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!request || request.status !== "pending") {
    revalidatePath("/app/parent");
    return { success: true };
  }

  if (decision === "rejected") {
    await db
      .from("story_visibility_requests")
      .update({
        status: "rejected",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    revalidatePath("/app/parent");
    revalidatePath(`/app/parent/stories/${request.story_id}`);
    return { success: true };
  }

  const { data: allApprovals } = await db
    .from("story_visibility_approvals")
    .select("decision")
    .eq("request_id", requestId);

  const pendingLeft = (allApprovals ?? []).some((a) => !a.decision);
  const anyRejected = (allApprovals ?? []).some((a) => a.decision === "rejected");

  if (anyRejected || pendingLeft) {
    revalidatePath("/app/parent");
    return { success: true };
  }

  // Todos aprovaram
  const visibility = request.to_visibility as StoryVisibility;
  await db
    .from("stories")
    .update({
      visibility,
      is_public: visibility === "public",
    })
    .eq("id", request.story_id);

  await db
    .from("story_visibility_requests")
    .update({
      status: "approved",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  revalidatePath("/app/parent");
  revalidatePath(`/app/parent/stories/${request.story_id}`);
  revalidatePath("/app/social");
  return { success: true };
}
