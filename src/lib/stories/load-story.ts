import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readMockStories } from "@/lib/stories/mock-store";
import {
  isMissingStoryColumnError,
} from "@/lib/stories/persist-helpers";
import {
  buildQuizFromPages,
  normalizeQuizQuestions,
  type QuizQuestion,
} from "@/lib/stories/quiz";
// Nota: lista resiliente a schema sem `visibility` (SQL social pendente no Euzim).

export type StoryDetail = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  pages: { pageIndex: number; text: string; imageUrl: string; altText: string }[];
  source: "supabase" | "mock";
  shareToken?: string | null;
  questions: QuizQuestion[];
};

type StoryListRow = {
  id: string;
  title: string;
  cover_image_url: string | null;
  created_at: string;
  visibility?: string | null;
  is_public?: boolean | null;
  status?: string | null;
  view_count?: number | null;
  like_count?: number | null;
  generation_meta?: Record<string, unknown> | null;
};

function mapVisibility(
  row: StoryListRow,
): "private" | "friends" | "public" {
  if (
    row.visibility === "private" ||
    row.visibility === "friends" ||
    row.visibility === "public"
  ) {
    return row.visibility;
  }
  return row.is_public ? "public" : "private";
}

export async function loadStoryForParent(
  storyId: string,
  parentId: string,
): Promise<StoryDetail | null> {
  const admin = createAdminClient();
  const userClient = await createClient();
  const db = admin ?? userClient;

  if (db) {
    try {
      const { data: story, error } = await db
        .from("stories")
        .select(
          "id, title, cover_image_url, text_content, questions_data, parent_id, share_token",
        )
        .eq("id", storyId)
        .maybeSingle();

      if (!error && story && story.parent_id === parentId) {
        const { data: images } = await db
          .from("story_images")
          .select("page_index, image_url, alt_text")
          .eq("story_id", storyId)
          .order("page_index", { ascending: true });

        const textPages =
          (
            story.text_content as {
              pages?: { index: number; text: string; title?: string }[];
            } | null
          )?.pages ?? [];

        const pageCount = Math.max(
          textPages.length,
          images?.length ?? 0,
          1,
        );

        const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
          const text =
            textPages.find((p) => p.index === pageIndex)?.text ??
            textPages[pageIndex]?.text ??
            "";
          const image = images?.find((i) => i.page_index === pageIndex);
          return {
            pageIndex,
            text,
            imageUrl: image?.image_url ?? story.cover_image_url ?? "",
            altText: image?.alt_text ?? `Página ${pageIndex + 1}`,
          };
        });

        const saved = normalizeQuizQuestions(story.questions_data);
        const questions =
          saved.length > 0
            ? saved
            : buildQuizFromPages(story.title, pages);

        return {
          id: story.id,
          title: story.title,
          coverImageUrl: story.cover_image_url,
          pages,
          source: "supabase",
          shareToken: story.share_token,
          questions,
        };
      }
    } catch {
      // fallback mock
    }
  }

  const mocks = await readMockStories();
  const mock = mocks.find((s) => s.id === storyId && s.parentId === parentId);
  if (!mock) return null;

  const saved = normalizeQuizQuestions(mock.questionsData);
  const questions =
    saved.length > 0
      ? saved
      : buildQuizFromPages(mock.title, mock.pages);

  return {
    id: mock.id,
    title: mock.title,
    coverImageUrl: mock.coverImageUrl,
    pages: mock.pages,
    source: "mock",
    shareToken: mock.id,
    questions,
  };
}

/**
 * Lista histórias do responsável.
 * Select resiliente: se `visibility` ainda não existir no projeto Euzim
 * (SQL social pendente), refaz sem a coluna em vez de cair no mock vazio.
 */
export async function listStoriesForParent(parentId: string): Promise<
  {
    id: string;
    title: string;
    coverImageUrl?: string | null;
    /** Última página (retrato wallpaper 1024×1536), se existir. */
    wallpaperImageUrl?: string | null;
    createdAt?: string;
    visibility?: "private" | "friends" | "public";
    viewCount?: number;
    likeCount?: number;
    hasCollaborators?: boolean;
  }[]
> {
  const admin = createAdminClient();
  const userClient = await createClient();
  const db = admin ?? userClient;

  if (db) {
    try {
      const fullSelect =
        "id, title, cover_image_url, created_at, visibility, is_public, status, view_count, like_count, generation_meta";
      const baseSelect = "id, title, cover_image_url, created_at, status";

      type ListQueryResult = {
        data: StoryListRow[] | null;
        error: { code?: string; message?: string; details?: string } | null;
      };

      let result: ListQueryResult = await db
        .from("stories")
        .select(fullSelect)
        .eq("parent_id", parentId)
        .order("created_at", { ascending: false })
        .limit(40);

      if (result.error && isMissingStoryColumnError(result.error)) {
        result = await db
          .from("stories")
          .select(baseSelect)
          .eq("parent_id", parentId)
          .order("created_at", { ascending: false })
          .limit(40);
      }

      // Último recurso: só colunas do schema base (pré-is_public social)
      if (result.error && isMissingStoryColumnError(result.error)) {
        result = await db
          .from("stories")
          .select("id, title, cover_image_url, created_at")
          .eq("parent_id", parentId)
          .order("created_at", { ascending: false })
          .limit(40);
      }

      if (!result.error && result.data) {
        const data = result.data;
        // Mostra prontas e em progresso; oculta só draft vazio sem título útil
        const visible = data.filter((s) => {
          if (!s.status) return true;
          return s.status !== "failed" && s.status !== "archived";
        });

        const ids = visible.map((s) => s.id);
        const wallpaperByStory = new Map<string, string>();
        if (ids.length > 0) {
          const { data: images } = await db
            .from("story_images")
            .select("story_id, page_index, image_url")
            .in("story_id", ids)
            .order("page_index", { ascending: false });
          for (const row of images ?? []) {
            if (!row.image_url || wallpaperByStory.has(row.story_id)) continue;
            wallpaperByStory.set(row.story_id, row.image_url);
          }
        }
        return visible.map((s) => {
          const meta = (s.generation_meta ?? {}) as {
            friendParentId?: string | null;
            collaboratorParentIds?: string[] | null;
          };
          const hasCollaborators = Boolean(
            (meta.friendParentId && meta.friendParentId !== parentId) ||
              (meta.collaboratorParentIds ?? []).some(
                (id) => id && id !== parentId,
              ),
          );
          return {
            id: s.id,
            title: s.title,
            coverImageUrl: s.cover_image_url,
            wallpaperImageUrl: wallpaperByStory.get(s.id) ?? s.cover_image_url,
            createdAt: s.created_at,
            visibility: mapVisibility(s),
            viewCount:
              typeof s.view_count === "number" ? s.view_count : 0,
            likeCount:
              typeof s.like_count === "number" ? s.like_count : 0,
            hasCollaborators,
          };
        });
      }

      if (result.error) {
        console.error(
          "[listStoriesForParent] supabase error",
          result.error.code,
          result.error.message,
        );
      }
    } catch (err) {
      console.error("[listStoriesForParent] unexpected", err);
    }
  }

  const mocks = await readMockStories();
  return mocks
    .filter((s) => s.parentId === parentId)
    .map((s) => {
      const last = [...s.pages].sort((a, b) => b.pageIndex - a.pageIndex)[0];
      return {
        id: s.id,
        title: s.title,
        coverImageUrl: s.coverImageUrl,
        wallpaperImageUrl: last?.imageUrl || s.coverImageUrl,
        createdAt: s.createdAt,
        visibility: "private" as const,
      };
    });
}
