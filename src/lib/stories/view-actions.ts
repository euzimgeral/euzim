"use server";

import { getCurrentUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Registra visualização única por usuário (ou session_key anônimo). */
export async function recordStoryViewAction(
  storyId: string,
  sessionKey?: string | null,
): Promise<{ error?: string; recorded?: boolean }> {
  if (!storyId) return { error: "História inválida." };

  const user = await getCurrentUser();
  const db = createAdminClient() ?? (await createClient());
  if (!db) return { error: "Banco indisponível." };

  const viewerId = user?.id ?? null;
  const key =
    !viewerId && sessionKey && sessionKey.trim()
      ? sessionKey.trim().slice(0, 120)
      : null;

  if (!viewerId && !key) {
    return { recorded: false };
  }

  const row: {
    story_id: string;
    viewer_id: string | null;
    session_key: string | null;
  } = viewerId
    ? { story_id: storyId, viewer_id: viewerId, session_key: null }
    : { story_id: storyId, viewer_id: null, session_key: key };

  const { error } = await db.from("story_views").insert(row);
  if (error) {
    // unique violation = já contou
    if (error.code === "23505") return { recorded: false };
    // tabela ainda não migrada
    if (
      error.message?.includes("story_views") ||
      error.code === "42P01" ||
      error.code === "PGRST205"
    ) {
      return { recorded: false };
    }
    return { error: error.message };
  }
  return { recorded: true };
}
