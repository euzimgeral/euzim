import { extractText, getDocumentProxy } from "unpdf";
import { modelForActivity } from "@/lib/ai/model-registry";
import { parseJsonLoose } from "@/lib/learning/parse-json";
import type { AiLessons } from "@/lib/learning/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { meteredChatCompletion } from "@/lib/usage/openai-meter";

const CHUNK_CHARS = 12_000;
const MAX_PAGES_IN_PROMPT = 40;

function chunkPages(pages: string[]): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (let i = 0; i < pages.length; i++) {
    const block = `\n--- Página ${i + 1} ---\n${pages[i] || "(vazia)"}`;
    if (buf.length + block.length > CHUNK_CHARS && buf) {
      chunks.push(buf);
      buf = block;
    } else {
      buf += block;
    }
  }
  if (buf.trim()) chunks.push(buf);
  return chunks.length ? chunks : ["(sem texto extraível)"];
}

async function mark(
  entryId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = createAdminClient();
  if (!db) return;
  await db.from("ai_learning_entries").update(patch).eq("id", entryId);
}

/**
 * Extrai texto do PDF (página a página) e gera aprendizado literário via Gemini Flash.
 */
export async function analyzeBookLearning(entryId: string): Promise<void> {
  const db = createAdminClient();
  if (!db) return;

  const { data: row } = await db
    .from("ai_learning_entries")
    .select("*")
    .eq("id", entryId)
    .eq("type", "book")
    .maybeSingle();
  if (!row?.storage_path) {
    await mark(entryId, {
      status: "failed",
      error_message: "Arquivo do livro não encontrado.",
      processed_at: new Date().toISOString(),
    });
    return;
  }

  await mark(entryId, {
    status: "processing",
    error_message: null,
  });

  try {
    const { data: file, error: dlErr } = await db.storage
      .from("learning")
      .download(row.storage_path as string);
    if (dlErr || !file) {
      throw new Error(dlErr?.message || "Falha ao baixar o PDF.");
    }

    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocumentProxy(buffer);
    const extracted = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(extracted.text)
      ? extracted.text.map((t) => String(t || "").trim())
      : [String(extracted.text || "")];
    const pageCount =
      typeof extracted.totalPages === "number"
        ? extracted.totalPages
        : pages.length;

    const limited = pages.slice(0, MAX_PAGES_IN_PROMPT);
    const chunks = chunkPages(limited);
    const partials: AiLessons[] = [];
    const observations: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const result = await meteredChatCompletion({
        userId: (row.added_by_user_id as string) || null,
        category: "other",
        operation: "learning_book_analyze",
        timeoutMs: 120_000,
        body: {
          model: modelForActivity("story_aux"),
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Você é um analista literário de livros infantis para treinar um gerador de histórias.
Analise o trecho (páginas do livro) e devolva SOMENTE JSON:
{
  "observation": string (o que entendeu: enredo, tom, personagens, ritmo),
  "summary": string (resumo curto em PT-BR, 1-2 frases),
  "storyRules": string (regras em PT-BR para o gerador de TEXTO copiar padrões — bullets),
  "imageRules": string (regras em inglês curto para composição visual infantil),
  "themes": string[] (temas em PT-BR, máx 8),
  "literaryPatterns": string[] (padrões: refrão, moral implícita, diálogo curto, etc., máx 10)
}
Foque em padrões reutilizáveis, não em spoilers longos.`,
            },
            {
              role: "user",
              content: [
                `Livro: "${row.title || row.source_filename || "sem título"}"`,
                `Parte ${i + 1}/${chunks.length} (até ${pageCount} páginas).`,
                "Analise esse livro por completo neste trecho, página por página; entenda conteúdo, tópicos e padrões; armazene na memória.",
                chunks[i],
              ].join("\n\n"),
            },
          ],
        },
      });

      if (!result.ok || !result.content) {
        throw new Error(result.error || `Falha IA no chunk ${i + 1}`);
      }
      const parsed = parseJsonLoose(result.content);
      if (!parsed) throw new Error(`JSON inválido no chunk ${i + 1}`);
      if (typeof parsed.observation === "string") {
        observations.push(parsed.observation.trim());
      }
      partials.push({
        storyRules:
          typeof parsed.storyRules === "string"
            ? parsed.storyRules.trim()
            : undefined,
        imageRules:
          typeof parsed.imageRules === "string"
            ? parsed.imageRules.trim()
            : undefined,
        themes: Array.isArray(parsed.themes)
          ? parsed.themes.map((t) => String(t).trim()).filter(Boolean)
          : undefined,
        literaryPatterns: Array.isArray(parsed.literaryPatterns)
          ? parsed.literaryPatterns.map((t) => String(t).trim()).filter(Boolean)
          : undefined,
      });
      if (!partials[partials.length - 1].storyRules && parsed.summary) {
        /* keep summary for merge */
      }
      if (typeof parsed.summary === "string" && parsed.summary.trim()) {
        observations.push(`RESUMO:${parsed.summary.trim()}`);
      }
    }

    const themes = [
      ...new Set(partials.flatMap((p) => p.themes || [])),
    ].slice(0, 12);
    const literaryPatterns = [
      ...new Set(partials.flatMap((p) => p.literaryPatterns || [])),
    ].slice(0, 16);
    const storyRules = partials
      .map((p) => p.storyRules)
      .filter(Boolean)
      .join("\n")
      .slice(0, 3500);
    const imageRules = partials
      .map((p) => p.imageRules)
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000);

    const summaryFromObs = observations
      .filter((o) => o.startsWith("RESUMO:"))
      .map((o) => o.slice(7))
      .join(" ");
    const aiSummary = (
      summaryFromObs ||
      observations[0] ||
      `Aprendizado do livro (${pageCount} págs.)`
    ).slice(0, 500);
    const aiObservation = observations
      .filter((o) => !o.startsWith("RESUMO:"))
      .join("\n\n")
      .slice(0, 6000);

    const aiLessons: AiLessons = {
      storyRules: storyRules || undefined,
      imageRules: imageRules || undefined,
      themes: themes.length ? themes : undefined,
      literaryPatterns: literaryPatterns.length
        ? literaryPatterns
        : undefined,
    };

    await mark(entryId, {
      status: "ready",
      page_count: pageCount,
      ai_observation: aiObservation || null,
      ai_summary: aiSummary,
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
