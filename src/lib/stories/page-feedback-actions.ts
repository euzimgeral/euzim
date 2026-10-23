"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/get-user";
import { analyzeFeedbackLearning } from "@/lib/learning/analyze-feedback";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { regenerateStoryPageImage } from "@/lib/stories/generate-story-images";
import { loadStoryCast } from "@/lib/stories/story-cast";
import type { GeneratedPage } from "@/lib/stories/generate-mock";
import type { PageFeedbackRating } from "@/lib/stories/page-feedback";

export type SavePageFeedbackResult = {
  ok: boolean;
  error?: string;
  rating?: PageFeedbackRating;
  comment?: string | null;
};

export type RegeneratePageResult = {
  ok: boolean;
  error?: string;
  imageUrl?: string;
  rating?: PageFeedbackRating;
  comment?: string | null;
};

function sanitizeComment(raw: unknown): string | null {
  const t = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 1200);
  return t.length >= 3 ? t : null;
}

async function assertStoryOwner(storyId: string, userId: string) {
  const db = createAdminClient() ?? (await createClient());
  if (!db) return { db: null, story: null as null };
  const { data: story } = await db
    .from("stories")
    .select("id, title, parent_id, text_content, cover_image_url")
    .eq("id", storyId)
    .maybeSingle();
  if (!story || story.parent_id !== userId) {
    return { db, story: null };
  }
  return { db, story };
}

export async function saveStoryPageFeedbackAction(input: {
  storyId: string;
  pageIndex: number;
  rating: PageFeedbackRating;
  comment?: string | null;
  imageUrl?: string | null;
}): Promise<SavePageFeedbackResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Faça login para avaliar." };

  if (input.rating !== "like" && input.rating !== "dislike") {
    return { ok: false, error: "Avaliação inválida." };
  }
  if (
    !Number.isInteger(input.pageIndex) ||
    input.pageIndex < 0 ||
    input.pageIndex > 40
  ) {
    return { ok: false, error: "Página inválida." };
  }

  const comment =
    input.rating === "dislike" ? sanitizeComment(input.comment) : null;
  if (input.rating === "dislike" && input.comment?.trim() && !comment) {
    return {
      ok: false,
      error: "Descreva o problema com pelo menos 3 caracteres.",
    };
  }

  const { db, story } = await assertStoryOwner(input.storyId, user.id);
  if (!db || !story) {
    return { ok: false, error: "História não encontrada." };
  }

  const { data: imageRow } = await db
    .from("story_images")
    .select("image_url, prompt_used")
    .eq("story_id", input.storyId)
    .eq("page_index", input.pageIndex)
    .maybeSingle();

  const row = {
    story_id: input.storyId,
    parent_id: user.id,
    page_index: input.pageIndex,
    rating: input.rating,
    comment,
    image_url: input.imageUrl || imageRow?.image_url || null,
    prompt_snippet: String(imageRow?.prompt_used ?? "").slice(0, 500) || null,
    requested_regenerate: false,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await db
    .from("story_page_feedback")
    .upsert(row, { onConflict: "story_id,parent_id,page_index" })
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: "Não consegui salvar o feedback. Tente de novo em instantes.",
    };
  }

  if (input.rating === "dislike" && comment) {
    const pages =
      (
        story.text_content as {
          pages?: { index?: number; text?: string }[];
        } | null
      )?.pages ?? [];
    const pageText =
      pages.find((p) => p.index === input.pageIndex)?.text ||
      pages[input.pageIndex]?.text ||
      "";

    const imageUrl = row.image_url as string | null;
    const title = `Feedback pág. ${input.pageIndex + 1} — ${story.title || "história"}`;

    let entryId: string | null = null;
    if (saved?.id) {
      const { data: existing } = await db
        .from("ai_learning_entries")
        .select("id, status")
        .eq("source_feedback_id", saved.id)
        .maybeSingle();
      if (existing?.id) {
        entryId = existing.id as string;
        await db
          .from("ai_learning_entries")
          .update({
            title: title.slice(0, 240),
            page_image_url: imageUrl,
            page_text: String(pageText || "").slice(0, 2000) || null,
            user_feedback: comment,
            status: "pending",
            error_message: null,
            ai_observation: null,
            ai_summary: null,
            ai_lessons: {},
            processed_at: null,
          })
          .eq("id", entryId);
      }
    }

    if (!entryId) {
      const { data: learningRow } = await db
        .from("ai_learning_entries")
        .insert({
          type: "feedback",
          title: title.slice(0, 240),
          added_by_user_id: user.id,
          added_by_email: user.email || "",
          status: "pending",
          source_feedback_id: saved?.id ?? null,
          story_id: input.storyId,
          page_index: input.pageIndex,
          page_image_url: imageUrl,
          page_text: String(pageText || "").slice(0, 2000) || null,
          user_feedback: comment,
        })
        .select("id")
        .maybeSingle();
      entryId = (learningRow?.id as string) || null;
    }

    if (entryId) {
      const jobId = entryId;
      after(async () => {
        try {
          await analyzeFeedbackLearning(jobId);
        } catch (err) {
          console.error(
            "[learning] analyzeFeedbackLearning failed",
            jobId,
            err,
          );
        }
      });
    }
  }

  revalidatePath(`/app/kids/read/${input.storyId}`);
  revalidatePath(`/app/parent/stories/${input.storyId}`);

  return { ok: true, rating: input.rating, comment };
}

export async function regenerateStoryPageFromFeedbackAction(input: {
  storyId: string;
  pageIndex: number;
  comment: string;
}): Promise<RegeneratePageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Faça login para regenerar." };

  const comment = sanitizeComment(input.comment);
  if (!comment) {
    return {
      ok: false,
      error: "Antes de regenerar, diga o que não gostou na imagem.",
    };
  }
  if (
    !Number.isInteger(input.pageIndex) ||
    input.pageIndex < 0 ||
    input.pageIndex > 40
  ) {
    return { ok: false, error: "Página inválida." };
  }

  const { db, story } = await assertStoryOwner(input.storyId, user.id);
  if (!db || !story) {
    return { ok: false, error: "História não encontrada." };
  }

  const cast = await loadStoryCast(user.id);
  if (!cast) {
    return { ok: false, error: "Elenco da criança não encontrado." };
  }

  const textContent = story.text_content as {
    pages?: {
      index: number;
      title?: string;
      text?: string;
      image_prompt?: string;
    }[];
  } | null;
  const textPages = textContent?.pages ?? [];
  const textPage =
    textPages.find((p) => p.index === input.pageIndex) ??
    textPages[input.pageIndex];

  const { data: imageRow } = await db
    .from("story_images")
    .select("image_url, alt_text, prompt_used")
    .eq("story_id", input.storyId)
    .eq("page_index", input.pageIndex)
    .maybeSingle();

  const totalPages = Math.max(
    textPages.length,
    input.pageIndex + 1,
    1,
  );

  const page: GeneratedPage = {
    pageIndex: input.pageIndex,
    chapterTitle: textPage?.title || `Parte ${input.pageIndex + 1}`,
    text: textPage?.text || "",
    imagePrompt:
      textPage?.image_prompt ||
      imageRow?.prompt_used ||
      `Scene from "${story.title}" page ${input.pageIndex + 1}`,
    imageUrl: imageRow?.image_url || "",
    altText: imageRow?.alt_text || `Página ${input.pageIndex + 1}`,
  };

  let generated: { imageUrl: string; promptUsed: string } | null = null;
  try {
    generated = await regenerateStoryPageImage({
      userId: user.id,
      storyKey: input.storyId,
      storyTitle: story.title,
      cast,
      page,
      pageIndex: input.pageIndex,
      totalPages,
      dislikeComment: comment,
      avoidImageUrls: imageRow?.image_url ? [imageRow.image_url] : [],
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Falha ao regenerar a imagem. Tente de novo.",
    };
  }

  if (!generated?.imageUrl) {
    return {
      ok: false,
      error: "A IA não conseguiu gerar uma nova imagem agora.",
    };
  }

  const { error: upsertImageError } = await db.from("story_images").upsert(
    {
      story_id: input.storyId,
      parent_id: user.id,
      page_index: input.pageIndex,
      image_url: generated.imageUrl,
      alt_text: page.altText,
      prompt_used: generated.promptUsed,
    },
    { onConflict: "story_id,page_index" },
  );

  if (upsertImageError) {
    return {
      ok: false,
      error: "Imagem gerada, mas não consegui gravar no banco.",
    };
  }

  if (input.pageIndex === 0 || !story.cover_image_url) {
    await db
      .from("stories")
      .update({ cover_image_url: generated.imageUrl })
      .eq("id", input.storyId);
  }

  await db.from("story_page_feedback").upsert(
    {
      story_id: input.storyId,
      parent_id: user.id,
      page_index: input.pageIndex,
      rating: "dislike",
      comment,
      image_url: imageRow?.image_url || null,
      prompt_snippet: String(imageRow?.prompt_used ?? "").slice(0, 500) || null,
      requested_regenerate: true,
      regenerated_image_url: generated.imageUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "story_id,parent_id,page_index" },
  );

  revalidatePath(`/app/kids/read/${input.storyId}`);
  revalidatePath(`/app/parent/stories/${input.storyId}`);
  revalidatePath("/app/kids");
  revalidatePath("/app/parent");

  return {
    ok: true,
    imageUrl: generated.imageUrl,
    rating: "dislike",
    comment,
  };
}
