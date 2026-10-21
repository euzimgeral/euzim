"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { friendlySocialDbError } from "@/lib/social/db-errors";
import { listStoryCollaboratorIds } from "@/lib/social/visibility-collab";
import type { StoryVisibility } from "@/lib/social/types";

function needsCollabApproval(
  current: StoryVisibility,
  next: StoryVisibility,
): boolean {
  return current === "private" && (next === "friends" || next === "public");
}

export async function updateStoryVisibilityAction(
  storyId: string,
  visibility: StoryVisibility,
): Promise<{
  error?: string;
  success?: boolean;
  pendingApproval?: boolean;
  message?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { error: "Não autenticado." };

  if (
    visibility !== "private" &&
    visibility !== "friends" &&
    visibility !== "public"
  ) {
    return { error: "Visibilidade inválida." };
  }

  const db = createAdminClient() ?? (await createClient());
  if (!db) return { error: "Banco indisponível." };

  const { data: story, error: loadError } = await db
    .from("stories")
    .select("id, parent_id, visibility, is_public, generation_meta")
    .eq("id", storyId)
    .maybeSingle();

  if (loadError) return { error: friendlySocialDbError(loadError.message) };
  if (!story || story.parent_id !== user.id) {
    return { error: "História não encontrada." };
  }

  const current: StoryVisibility =
    story.visibility === "friends" || story.visibility === "public"
      ? story.visibility
      : story.is_public
        ? "public"
        : "private";

  if (current === visibility) return { success: true };

  const collaborators = await listStoryCollaboratorIds(db, storyId, user.id);

  if (collaborators.length > 0 && needsCollabApproval(current, visibility)) {
    // Cancela pedidos pendentes anteriores
    const { data: pending } = await db
      .from("story_visibility_requests")
      .select("id")
      .eq("story_id", storyId)
      .eq("status", "pending");

    if (pending?.length) {
      await db
        .from("story_visibility_requests")
        .update({
          status: "cancelled",
          resolved_at: new Date().toISOString(),
        })
        .in(
          "id",
          pending.map((p) => p.id),
        );
    }

    const { data: request, error: reqErr } = await db
      .from("story_visibility_requests")
      .insert({
        story_id: storyId,
        requester_id: user.id,
        from_visibility: current,
        to_visibility: visibility,
        status: "pending",
      })
      .select("id")
      .single();

    if (reqErr || !request) {
      return {
        error: friendlySocialDbError(
          reqErr?.message ?? "Falha ao criar pedido de visibilidade.",
        ),
      };
    }

    const { error: apprErr } = await db
      .from("story_visibility_approvals")
      .insert(
        collaborators.map((collaborator_id) => ({
          request_id: request.id,
          collaborator_id,
          decision: null,
        })),
      );

    if (apprErr) {
      return { error: friendlySocialDbError(apprErr.message) };
    }

    revalidatePath("/app/parent");
    return {
      success: true,
      pendingApproval: true,
      message:
        "Aguardando aprovação de todos os colaboradores para mudar a visibilidade.",
    };
  }

  const { error } = await db
    .from("stories")
    .update({
      visibility,
      is_public: visibility === "public",
    })
    .eq("id", storyId)
    .eq("parent_id", user.id);

  if (error) return { error: friendlySocialDbError(error.message) };

  revalidatePath("/app/parent");
  revalidatePath(`/app/parent/stories/${storyId}`);
  revalidatePath("/app/social");
  return { success: true };
}
