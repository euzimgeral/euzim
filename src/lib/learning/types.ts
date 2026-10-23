export type LearningEntryType = "book" | "feedback";

export type LearningEntryStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed";

export type AiLessons = {
  storyRules?: string;
  imageRules?: string;
  themes?: string[];
  literaryPatterns?: string[];
};

export type AiLearningEntry = {
  id: string;
  type: LearningEntryType;
  title: string;
  addedByUserId: string | null;
  addedByEmail: string;
  status: LearningEntryStatus;
  errorMessage: string | null;
  sourceFilename: string | null;
  storagePath: string | null;
  pageCount: number | null;
  sourceFeedbackId: string | null;
  storyId: string | null;
  pageIndex: number | null;
  pageImageUrl: string | null;
  pageText: string | null;
  userFeedback: string | null;
  aiObservation: string | null;
  aiSummary: string | null;
  aiLessons: AiLessons;
  createdAt: string;
  processedAt: string | null;
};

export function parseAiLessons(raw: unknown): AiLessons {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const themes = Array.isArray(o.themes)
    ? o.themes.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const literaryPatterns = Array.isArray(o.literaryPatterns)
    ? o.literaryPatterns.map((t) => String(t).trim()).filter(Boolean)
    : [];
  return {
    storyRules:
      typeof o.storyRules === "string" ? o.storyRules.trim() : undefined,
    imageRules:
      typeof o.imageRules === "string" ? o.imageRules.trim() : undefined,
    themes: themes.length ? themes : undefined,
    literaryPatterns: literaryPatterns.length ? literaryPatterns : undefined,
  };
}

export function mapLearningRow(
  row: Record<string, unknown>,
): AiLearningEntry {
  return {
    id: String(row.id),
    type: row.type === "feedback" ? "feedback" : "book",
    title: String(row.title || ""),
    addedByUserId:
      typeof row.added_by_user_id === "string" ? row.added_by_user_id : null,
    addedByEmail: String(row.added_by_email || ""),
    status: (["pending", "processing", "ready", "failed"] as const).includes(
      row.status as LearningEntryStatus,
    )
      ? (row.status as LearningEntryStatus)
      : "pending",
    errorMessage:
      typeof row.error_message === "string" ? row.error_message : null,
    sourceFilename:
      typeof row.source_filename === "string" ? row.source_filename : null,
    storagePath:
      typeof row.storage_path === "string" ? row.storage_path : null,
    pageCount:
      typeof row.page_count === "number" ? row.page_count : null,
    sourceFeedbackId:
      typeof row.source_feedback_id === "string"
        ? row.source_feedback_id
        : null,
    storyId: typeof row.story_id === "string" ? row.story_id : null,
    pageIndex:
      typeof row.page_index === "number" ? row.page_index : null,
    pageImageUrl:
      typeof row.page_image_url === "string" ? row.page_image_url : null,
    pageText: typeof row.page_text === "string" ? row.page_text : null,
    userFeedback:
      typeof row.user_feedback === "string" ? row.user_feedback : null,
    aiObservation:
      typeof row.ai_observation === "string" ? row.ai_observation : null,
    aiSummary: typeof row.ai_summary === "string" ? row.ai_summary : null,
    aiLessons: parseAiLessons(row.ai_lessons),
    createdAt: String(row.created_at || new Date().toISOString()),
    processedAt:
      typeof row.processed_at === "string" ? row.processed_at : null,
  };
}
