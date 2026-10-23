import { modelForActivity } from "@/lib/ai/model-registry";
import { parseJsonLoose } from "@/lib/learning/parse-json";
import type { AiLessons } from "@/lib/learning/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { meteredChatCompletion } from "@/lib/usage/openai-meter";

async function mark(
  entryId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = createAdminClient();
  if (!db) return;
  await db.from("ai_learning_entries").update(patch).eq("id", entryId);
}

/**
 * Visão + texto da página + feedback do pai → aprendizado (sem regenerar imagem).
 */
export async function analyzeFeedbackLearning(
  entryId: string,
): Promise<void> {
  const db = createAdminClient();
  if (!db) return;

  const { data: row } = await db
    .from("ai_learning_entries")
    .select("*")
    .eq("id", entryId)
    .eq("type", "feedback")
    .maybeSingle();
  if (!row) return;

  await mark(entryId, { status: "processing", error_message: null });

  try {
    const pageText = String(row.page_text || "").slice(0, 900);
    const feedback = String(row.user_feedback || "").slice(0, 1200);
    const imageUrl = String(row.page_image_url || "");

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: [
          "O responsável não gostou desta página da história infantil.",
          `FEEDBACK:"""${feedback}"""`,
          `TEXTO DA PÁGINA:"""${pageText || "(sem texto)"}"""`,
          imageUrl
            ? "Analise a imagem anexa junto com o feedback."
            : "Não há imagem; use só texto + feedback.",
          "Extraia o que deu errado e regras para NÃO repetir no gerador.",
        ].join("\n"),
      },
    ];
    if (imageUrl && !imageUrl.startsWith("data:")) {
      userContent.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
    }

    const result = await meteredChatCompletion({
      userId: (row.added_by_user_id as string) || null,
      category: "other",
      operation: "learning_feedback_analyze",
      timeoutMs: 90_000,
      body: {
        model: modelForActivity("story_aux"),
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Você transforma feedback negativo de pais em aprendizado para um gerador de histórias infantis.
Return ONLY JSON:
{
  "observation": string (o que a IA enxergou: problema visual e/ou narrativo, PT-BR),
  "summary": string (1 frase PT-BR para lista admin),
  "storyRules": string (regras PT-BR para texto/cena — bullets),
  "imageRules": string (regras EN curtas para image prompts),
  "themes": string[] (temas relacionados, máx 5),
  "literaryPatterns": string[] (padrões a evitar ou corrigir, máx 6)
}`,
          },
          { role: "user", content: userContent },
        ],
      },
    });

    if (!result.ok || !result.content) {
      throw new Error(result.error || "Falha na análise do feedback.");
    }
    const parsed = parseJsonLoose(result.content);
    if (!parsed) throw new Error("JSON inválido na análise do feedback.");

    const aiLessons: AiLessons = {
      storyRules:
        typeof parsed.storyRules === "string"
          ? parsed.storyRules.trim().slice(0, 2000)
          : undefined,
      imageRules:
        typeof parsed.imageRules === "string"
          ? parsed.imageRules.trim().slice(0, 1500)
          : undefined,
      themes: Array.isArray(parsed.themes)
        ? parsed.themes
            .map((t) => String(t).trim())
            .filter(Boolean)
            .slice(0, 5)
        : undefined,
      literaryPatterns: Array.isArray(parsed.literaryPatterns)
        ? parsed.literaryPatterns
            .map((t) => String(t).trim())
            .filter(Boolean)
            .slice(0, 6)
        : undefined,
    };

    await mark(entryId, {
      status: "ready",
      ai_observation:
        typeof parsed.observation === "string"
          ? parsed.observation.trim().slice(0, 4000)
          : null,
      ai_summary:
        typeof parsed.summary === "string"
          ? parsed.summary.trim().slice(0, 400)
          : feedback.slice(0, 120),
      ai_lessons: aiLessons,
      error_message: null,
      processed_at: new Date().toISOString(),
    });
  } catch (err) {
    await mark(entryId, {
      status: "failed",
      error_message:
        err instanceof Error ? err.message.slice(0, 500) : "Falha na análise",
      processed_at: new Date().toISOString(),
    });
  }
}
