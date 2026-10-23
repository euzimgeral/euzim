import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  loadFeedbackLessons,
  type FeedbackLessons,
} from "@/lib/stories/page-feedback";
import { parseAiLessons } from "@/lib/learning/types";

const CHAR_CAP = 2000;

function themeTokens(theme: string | null | undefined): string[] {
  return String(theme || "")
    .toLowerCase()
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function themesOverlap(
  entryThemes: string[] | undefined,
  requestTheme: string | null | undefined,
): boolean {
  const themes = (entryThemes || []).map((t) => t.toLowerCase());
  if (themes.length === 0) return true;
  const tokens = themeTokens(requestTheme);
  if (tokens.length === 0) return true;
  const hay = String(requestTheme || "").toLowerCase();
  return themes.some(
    (th) => tokens.some((tok) => th.includes(tok) || tok.includes(th)) || hay.includes(th),
  );
}

function pushCapped(parts: string[], next: string, cap: number): void {
  const joined = parts.join("\n");
  if (joined.length >= cap) return;
  const room = cap - joined.length - (joined ? 1 : 0);
  if (room <= 0) return;
  const slice = next.trim().slice(0, room);
  if (slice) parts.push(slice);
}

/**
 * Memória unificada: entries ready (feedbacks + livros) + comentários brutos legados.
 * Cap ~2k chars por canal (texto / imagem).
 */
export async function loadLearningMemory(opts?: {
  theme?: string | null;
  userId?: string | null;
}): Promise<FeedbackLessons> {
  const empty: FeedbackLessons = {
    imageRules: "",
    storyRules: "",
    sampleCount: 0,
  };
  const db = createAdminClient() ?? (await createClient());
  if (!db) return empty;

  const storyParts: string[] = [];
  const imageParts: string[] = [];
  let sampleCount = 0;

  try {
    const { data: rows } = await db
      .from("ai_learning_entries")
      .select(
        "id, type, added_by_user_id, ai_summary, ai_lessons, created_at",
      )
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(80);

    type Row = NonNullable<typeof rows>[number];
    const feedbackMine: Row[] = [];
    const feedbackGlobal: Row[] = [];
    const books: Row[] = [];

    for (const row of rows ?? []) {
      if (row.type === "book") {
        const lessons = parseAiLessons(row.ai_lessons);
        if (themesOverlap(lessons.themes, opts?.theme)) books.push(row);
      } else if (row.type === "feedback") {
        if (opts?.userId && row.added_by_user_id === opts.userId) {
          feedbackMine.push(row);
        } else {
          feedbackGlobal.push(row);
        }
      }
    }

    const ordered = [
      ...feedbackMine.slice(0, 12),
      ...feedbackGlobal.slice(0, 16),
      ...books.slice(0, 10),
    ];

    for (const row of ordered) {
      const lessons = parseAiLessons(row.ai_lessons);
      const label =
        row.type === "book"
          ? "LIVRO"
          : opts?.userId && row.added_by_user_id === opts.userId
            ? "SEU FEEDBACK"
            : "FEEDBACK";
      if (lessons.storyRules) {
        pushCapped(storyParts, `[${label}] ${lessons.storyRules}`, CHAR_CAP);
      }
      if (lessons.imageRules) {
        pushCapped(imageParts, `[${label}] ${lessons.imageRules}`, CHAR_CAP);
      } else if (row.type === "feedback" && row.ai_summary) {
        pushCapped(imageParts, `[${label}] ${String(row.ai_summary)}`, CHAR_CAP);
      }
      if (lessons.literaryPatterns?.length) {
        pushCapped(
          storyParts,
          `Padrões: ${lessons.literaryPatterns.slice(0, 6).join("; ")}`,
          CHAR_CAP,
        );
      }
      sampleCount += 1;
    }
  } catch {
    /* fall through to legacy */
  }

  const legacy = await loadFeedbackLessons(opts?.userId);
  if (legacy.storyRules) {
    pushCapped(storyParts, legacy.storyRules, CHAR_CAP);
    sampleCount += legacy.sampleCount;
  }
  if (legacy.imageRules) {
    pushCapped(imageParts, legacy.imageRules, CHAR_CAP);
  }

  if (storyParts.length === 0 && imageParts.length === 0) {
    return legacy.sampleCount ? legacy : empty;
  }

  const storyBody = storyParts.join("\n").slice(0, CHAR_CAP);
  const imageBody = imageParts.join("\n").slice(0, CHAR_CAP);

  return {
    sampleCount: sampleCount || legacy.sampleCount,
    storyRules: storyBody
      ? [
          "Aprendizados (livros + feedbacks) — aplique na narrativa e nos image prompts:",
          storyBody,
        ].join("\n")
      : legacy.storyRules,
    imageRules: imageBody
      ? [
          "LEARNED MEMORY (books + parent feedback) — avoid repeating these issues:",
          imageBody,
          "Keep story beat, wardrobe locks, and character identity.",
        ].join("\n")
      : legacy.imageRules,
  };
}
