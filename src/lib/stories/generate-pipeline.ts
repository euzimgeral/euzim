import type { GeneratedPage, GeneratedStory } from "@/lib/stories/generate-mock";
import { generateMockStory } from "@/lib/stories/generate-mock";
import type { StoryCast } from "@/lib/stories/story-cast";
import {
  applyBibleToChapters,
  buildSceneContinuityBible,
} from "@/lib/stories/scene-continuity-bible";
import {
  findMatchingTemplate,
  personalizeSkeleton,
  saveStoryTemplate,
} from "@/lib/stories/story-templates";
import {
  LANGUAGE_LEVELS,
  MAX_STORY_PAGES,
  MIN_STORY_PAGES,
  PREFERRED_STORY_PAGES,
  STORYTELLER_SKILL,
  STORY_AUX_MODEL,
  STORY_TEXT_MODEL,
  TARGET_WORDS_PER_PAGE,
  languageLevelGuidance,
  storyTypeGuidance,
  type LanguageLevel,
  type StoryType,
  type WordVolume,
  WORD_VOLUME_TARGETS,
} from "@/lib/stories/storyteller-skill";
import { meteredChatCompletion } from "@/lib/usage/openai-meter";
import { loadLearningMemory } from "@/lib/learning/load-memory";
import { realignChaptersToPageText } from "@/lib/stories/align-page-prompts";
import { directPageImagePrompts } from "@/lib/stories/page-director";
import { enforceCompanionSpeciesInText } from "@/lib/stories/story-cast";

export type StoryEngine =
  | "openai-storyteller-v1"
  | "openai-storyteller-template"
  | "openai-gpt-4o-mini"
  | "mock-v1";

export type StoryChapter = {
  index: number;
  title: string;
  text: string;
  imagePrompt: string;
};

export type PipelineStory = {
  title: string;
  moral: string;
  pages: StoryChapter[];
  fullText: string;
  reviewNotes: string;
  templateId?: string | null;
  fromTemplate?: boolean;
};

export type PipelineOptions = {
  userId?: string | null;
  storyType?: StoryType;
  wordTarget?: number;
  wordVolume?: WordVolume;
  languageLevel?: LanguageLevel;
  christianValues?: boolean;
  clarifyAnswers?: Record<string, string>;
  castNames?: string[];
  protagonistName?: string;
  /** Ambiente livre opcional pedido pelos pais (ex.: "parquinho de areia"). */
  settingPreference?: string;
  /** Regras agregadas de feedback negativo (aprendizado). */
  feedbackStoryRules?: string;
};

type ChatJsonResult = {
  data: Record<string, unknown> | null;
  error?: string;
};


/** Extrai JSON de respostas que vêm com fences ```json ou texto extra (ex.: Claude). */
function parseModelJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    /* continue */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim()) as Record<string, unknown>;
    } catch {
      /* continue */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
    } catch {
      /* continue */
    }
  }
  return null;
}

async function chatJsonOnce(input: {
  userId?: string | null;
  operation: string;
  model: string;
  category?: "story_text" | "other";
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<ChatJsonResult> {
  const result = await meteredChatCompletion({
    userId: input.userId,
    category: input.category ?? "story_text",
    operation: input.operation,
    body: {
      model: input.model,
      temperature: input.temperature ?? 0.75,
      max_tokens: input.maxTokens ?? 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
    },
    timeoutMs: input.timeoutMs ?? 180_000,
  });

  if (!result.ok || !result.content) {
    return {
      data: null,
      error: result.error || `IA sem conteúdo (${result.status})`,
    };
  }
  const finishReason = (
    result.json.choices as { finish_reason?: string }[] | undefined
  )?.[0]?.finish_reason;
  const parsed = parseModelJson(result.content);
  if (parsed) {
    return { data: parsed };
  }
  console.warn(
    `[pipeline] JSON parse fail ${input.operation}`,
    `finish=${finishReason ?? "?"} len=${result.content.length}`,
    result.content.slice(0, 160).replace(/\s+/g, " "),
  );
  const truncated = finishReason === "length" || finishReason === "max_tokens";
  return {
    data: null,
    error: truncated
      ? `JSON truncado em ${input.operation} (finish=${finishReason})`
      : `JSON inválido/truncado em ${input.operation}`,
  };
}

/** Uma tentativa + retry em falha transitória (rede, JSON truncado, 5xx). */
async function chatJson(input: {
  userId?: string | null;
  operation: string;
  model: string;
  category?: "story_text" | "other";
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<ChatJsonResult> {
  const first = await chatJsonOnce(input);
  if (first.data) return first;
  const retryable =
    !first.error?.includes("OPENROUTER_API_KEY") &&
    !first.error?.includes("OPENAI_API_KEY") &&
    !first.error?.includes("HTTP 401") &&
    !first.error?.includes("HTTP 403");
  if (!retryable) return first;
  console.warn(`[pipeline] retry ${input.operation}:`, first.error);
  return chatJsonOnce(input);
}

function aiKeyPresent(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
}

function mockFallbackMessage(reason: string): string {
  if (!aiKeyPresent()) {
    return "Não consegui gerar com a IA agora. Confira OPENROUTER_API_KEY no .env e tente de novo.";
  }
  return `A IA não concluiu a narrativa (${reason}). Tente de novo em instantes.`;
}

function friendGenderBrief(cast: StoryCast): string {
  const name = cast.friendName;
  const kind =
    cast.friendKind === "toy"
      ? "companheiro de brinquedo/pelúcia (seguir avatar)"
      : "pet companheiro (seguir avatar)";
  const lock = cast.companionVisualLock || "";
  if (cast.friendGender === "female") {
    return [
      `Co-protagonista: ${name} (${kind}, GÊNERO FEMININO).`,
      `Concordância OBRIGATÓRIA: "a ${name}", "ela", "sua amiga ${name}" — NUNCA "o ${name}" / "ele".`,
      `PROIBIDO escrever "coelhinho/coelho/ursinho" para "${name}" se o avatar não for isso.`,
      `No texto use o nome "${name}" e a espécie/forma do avatar (nunca invente outro bicho).`,
      lock,
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (cast.friendGender === "male") {
    return [
      `Co-protagonista: ${name} (${kind}, GÊNERO MASCULINO).`,
      `Concordância OBRIGATÓRIA: "o ${name}", "ele".`,
      `NÃO invente espécie diferente do avatar. Traits/SPECIES LOCK vencem a prosa.`,
      lock,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [`Co-protagonista: ${name} (${kind}). Prefira o nome próprio.`, lock]
    .filter(Boolean)
    .join(" ");
}

function coPlayBrief(cast: StoryCast, opts?: PipelineOptions): string {
  const members = cast.coPlayMembers ?? [];
  if (members.length === 0) return "";
  const lines = members.map((m) => {
    const meta = [m.kind, m.traitsSummary].filter(Boolean).join("; ");
    const tag = m.source === "friend" ? "amigo da outra família" : "da família";
    return `- ${m.name} (${tag}${meta ? `: ${meta}` : ""})`;
  });
  const names =
    opts?.castNames && opts.castNames.length > 0
      ? opts.castNames.join(", ")
      : members.map((m) => m.name).join(", ");
  return [
    `HISTÓRIA COM AMIGOS — elenco obrigatório (${members.length}): ${names}.`,
    ...lines,
    `REGRA DE INTERAÇÃO: TODOS os personagens listados devem aparecer com presença clara, agir e interagir uns com os outros ao longo da história (diálogos, brincadeiras, ajuda mútua).`,
    `Não deixe ninguém do elenco só como figurante; cada um precisa de pelo menos um momento ativo com outro personagem.`,
  ].join("\n");
}

function castBrief(cast: StoryCast, opts?: PipelineOptions): string {
  const age =
    cast.childAgeYears != null ? `${cast.childAgeYears} anos` : "idade infantil";
  const protagonist =
    opts?.protagonistName?.trim() || cast.childName;
  const castLine =
    opts?.castNames && opts.castNames.length > 0
      ? `Elenco selecionado: ${opts.castNames.join(", ")}.`
      : "";
  const coPlay = coPlayBrief(cast, opts);
  if (coPlay) {
    return [
      `Criança protagonista: ${protagonist} (${age}${cast.childGender ? `, ${cast.childGender}` : ""}).`,
      coPlay,
      cast.friendName
        ? `Companheiro clássico da casa (se estiver no elenco): ${cast.friendName}.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Criança protagonista: ${protagonist} (${age}${cast.childGender ? `, ${cast.childGender}` : ""}).`,
    friendGenderBrief(cast),
    castLine,
    `Os dois precisam estar juntos na essência de quase todas as cenas.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function volumeBrief(opts?: PipelineOptions): {
  min: number;
  max: number;
  target: number;
} {
  const target =
    opts?.wordTarget ??
    (opts?.wordVolume
      ? WORD_VOLUME_TARGETS[opts.wordVolume].words
      : 1200);
  const min = Math.max(400, Math.round(target * 0.85));
  const max = Math.round(target * 1.2);
  return { min, max, target };
}

function typeBrief(opts?: PipelineOptions): string {
  if (!opts?.storyType) return "";
  return `Tipo de história: ${opts.storyType}. ${storyTypeGuidance(opts.storyType)}`;
}

function languageBrief(opts?: PipelineOptions): string {
  const level = opts?.languageLevel;
  if (!level || !(LANGUAGE_LEVELS as readonly string[]).includes(level)) {
    return "";
  }
  return `languageLevel: ${level}. ${languageLevelGuidance(level)}`;
}

function christianBrief(opts?: PipelineOptions): string {
  if (!opts?.christianValues) return "christianValues: false";
  return [
    "christianValues: true — OBRIGATÓRIO no enredo (não só na moral).",
    "Em pelo menos 2–3 momentos concretos, mostre valores cristãos tradicionais VIVIDOS:",
    "amor ao próximo / cuidado; perdão ou paciência; gratidão (pode haver um 'obrigada, Deus' infantil da criança); honestidade; esperança; cuidado com a família.",
    "A moral emerge da cena. PROIBIDO: citação de versículos, livros da Bíblia, sermão, linguagem de culto,",
    "teologia da prosperidade, escatologia, predestinação, milagre sensacionalista como solução fácil.",
  ].join(" ");
}

function clarifyBrief(opts?: PipelineOptions): string {
  if (!opts?.clarifyAnswers || Object.keys(opts.clarifyAnswers).length === 0) {
    return "";
  }
  return [
    "Respostas de esclarecimento dos pais:",
    ...Object.entries(opts.clarifyAnswers).map(
      ([q, a]) => `- ${q}: ${a}`,
    ),
  ].join("\n");
}

function settingBrief(opts?: PipelineOptions): string {
  const s = opts?.settingPreference?.trim();
  if (!s) {
    return "settingPreference: (nenhum) — escolha o melhor ambiente para o tema e MANTENHA-O coerente (escala estável).";
  }
  return [
    `settingPreference OBRIGATÓRIO: "${s}".`,
    "Toda a história (texto + image_prompts) deve ocorrer nesse ambiente (ou transição explícita e breve).",
    "Mantenha escala e identidade do lugar estáveis entre os atos.",
  ].join(" ");
}

function feedbackBrief(opts?: PipelineOptions): string {
  const raw = opts?.feedbackStoryRules?.trim();
  if (!raw) return "";
  return raw.slice(0, 1800);
}

type OutlineResult =
  | { ok: true; title: string; moral: string; beats: string[] }
  | { ok: false; error: string };

/** Outline estrutural barato (mini). */
async function outlineStory(
  cast: StoryCast,
  theme: string,
  opts?: PipelineOptions,
): Promise<OutlineResult> {
  const { data: parsed, error } = await chatJson({
    userId: opts?.userId,
    model: STORY_AUX_MODEL,
    operation: "outline_story",
    temperature: 0.6,
    maxTokens: 2048,
    system: `${STORYTELLER_SKILL}

Você faz só o OUTLINE (esqueleto), não a prosa final.
Responda SOMENTE JSON:
{
  "title": string,
  "moral": string,
  "beats": string[] (6 a 10 batidas: lugar + conflito + emoção, 1 frase cada)
}`,
    user: `${castBrief(cast, opts)}

${typeBrief(opts)}
${languageBrief(opts)}
${christianBrief(opts)}
${clarifyBrief(opts)}
${settingBrief(opts)}
${feedbackBrief(opts)}

Tema: """${theme}"""

Outline agora — prefira ~${PREFERRED_STORY_PAGES} batidas (range ${MIN_STORY_PAGES}–${MAX_STORY_PAGES}).`,
    timeoutMs: 90_000,
  });
  if (!parsed) {
    return { ok: false, error: error || "outline vazio" };
  }
  const title = String(parsed.title ?? "").trim();
  const moral = String(parsed.moral ?? "").trim();
  const beats = Array.isArray(parsed.beats)
    ? parsed.beats.map((b) => String(b).trim()).filter(Boolean)
    : [];
  if (!title || beats.length < 5) {
    return {
      ok: false,
      error: `outline incompleto (beats=${beats.length})`,
    };
  }
  return { ok: true, title, moral, beats };
}

type ExpandResult =
  | { ok: true; title: string; moral: string; fullText: string }
  | { ok: false; error: string };

/** Expansão narrativa final (modelo forte) — qualidade preservada. */
async function expandNarrative(
  cast: StoryCast,
  theme: string,
  outline: { title: string; moral: string; beats: string[] },
  opts?: PipelineOptions,
): Promise<ExpandResult> {
  const vol = volumeBrief(opts);
  const { data: parsed, error } = await chatJson({
    userId: opts?.userId,
    model: STORY_TEXT_MODEL,
    operation: "expand_story",
    temperature: 0.85,
    // História longa em JSON — sem max_tokens alto a resposta corta e o parse falha.
    maxTokens: 16_384,
    system: `${STORYTELLER_SKILL}

Expanda o outline numa história COMPLETA, oral e cinematográfica.
Responda SOMENTE JSON:
{
  "title": string,
  "moral": string,
  "full_text": string (OBRIGATÓRIO ${vol.min}–${vol.max} palavras)
}`,
    user: `${castBrief(cast, opts)}

${typeBrief(opts)}
${languageBrief(opts)}
${christianBrief(opts)}
${clarifyBrief(opts)}
${settingBrief(opts)}
${feedbackBrief(opts)}

Tema: """${theme}"""
Título outline: ${outline.title}
Moral: ${outline.moral}
Batidas:
${outline.beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}

Escreva a prosa final completa (~${vol.target} palavras).
Não invente detalhes visuais que contradigam o avatar da criança.`,
  });
  if (!parsed) {
    return { ok: false, error: error || "expand vazio" };
  }
  const title = String(parsed.title ?? outline.title).trim();
  const moral = String(parsed.moral ?? outline.moral).trim();
  const fullText = String(
    parsed.full_text ?? parsed.fullText ?? "",
  ).trim();
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  // Aceita ~55% do mínimo pedido — modelos às vezes entregam um pouco abaixo do alvo.
  const minWords = Math.max(400, Math.round(vol.min * 0.55));
  if (!title || wordCount < minWords) {
    return {
      ok: false,
      error: `expand curto (${wordCount} palavras, mín ${minWords})`,
    };
  }
  return { ok: true, title, moral, fullText };
}

/** Revisão leve (mini) — só ajusta se necessário. */
async function lightReview(
  cast: StoryCast,
  theme: string,
  draft: { title: string; moral: string; fullText: string },
  opts?: PipelineOptions,
): Promise<{
  title: string;
  moral: string;
  fullText: string;
  reviewNotes: string;
}> {
  const { data: parsed } = await chatJson({
    userId: opts?.userId,
    model: STORY_AUX_MODEL,
    operation: "light_review",
    temperature: 0.35,
    maxTokens: 16_384,
    system: `${STORYTELLER_SKILL}

EDITOR LEVE: corrija só problemas graves (protagonistas, segurança parental,
adequação etária). Se estiver boa, devolva o texto quase igual.
Responda SOMENTE JSON:
{
  "title": string,
  "moral": string,
  "full_text": string,
  "review_notes": string
}`,
    user: `${castBrief(cast, opts)}
Tema: """${theme}"""
Título: ${draft.title}
Moral: ${draft.moral}
TEXTO:
"""
${draft.fullText}
"""`,
    timeoutMs: 120_000,
  });
  if (!parsed) {
    return { ...draft, reviewNotes: "revisão leve pulada" };
  }
  const fullText = String(parsed.full_text ?? parsed.fullText ?? "").trim();
  if (fullText.split(/\s+/).filter(Boolean).length < 400) {
    return { ...draft, reviewNotes: "revisão leve descartada — texto curto" };
  }
  return {
    title: String(parsed.title ?? draft.title).trim(),
    moral: String(parsed.moral ?? draft.moral).trim(),
    fullText,
    reviewNotes: String(parsed.review_notes ?? "revisão leve").trim(),
  };
}

/** Split em atos (mini). */
async function splitIntoChapters(
  cast: StoryCast,
  reviewed: {
    title: string;
    moral: string;
    fullText: string;
    reviewNotes: string;
  },
  opts?: PipelineOptions,
): Promise<StoryChapter[] | null> {
  const { data: parsed } = await chatJson({
    userId: opts?.userId,
    model: STORY_AUX_MODEL,
    operation: "split_chapters",
    temperature: 0.4,
    maxTokens: 12_288,
    system: `${STORYTELLER_SKILL}

Divida a história FINAL em ${MIN_STORY_PAGES} a ${MAX_STORY_PAGES} ATOS/páginas
(alvo preferido: ${PREFERRED_STORY_PAGES} atos — um beat = uma imagem).
Cada ato: ~${TARGET_WORDS_PER_PAGE} palavras (±40), com começo/meio/fim de cena,
diálogos quando couber, e um image_prompt em INGLÊS para ilustração Walt Disney/Pixar 3D.

Regras do image_prompt (CRÍTICO):
- ALINHAMENTO TEXTO↔IMAGEM (máxima prioridade): o image_prompt deve ilustrar
  APENAS o que o texto DESTE ato descreve (lugar, pessoas presentes, ação, roupa).
  PROIBIDO antecipar o dia seguinte, trazer personagens que o texto não menciona
  neste ato, ou mudar o cenário (ex.: texto em casa → imagem no parque).
- Cada ato tem batida visual ÚNICA: lugar, pose, framing/câmera e emoção diferentes.
- Atribua a cada ato um ângulo distinto (wide / medium two-shot / over-shoulder /
  close-up emotion / low-angle / high-angle / side-profile / seated conversation).
- NUNCA repita o mesmo close-up da criança abraçando o amigo.
- Ato 1 = emoção do INÍCIO da história (ex.: medo à distância), NÃO o clímax.
- Citar visualmente a criança "${opts?.protagonistName || cast.childName}" e o amigo "${cast.friendName}" (${cast.friendKind}) quando o texto do ato os incluir.
- ${cast.companionVisualLock || `Amigo "${cast.friendName}": seguir avatar — nunca coelho/urso genérico.`}
- No image_prompt, descreva a ROUPA coerente com o beat (pijama na cama, chapéu/casaco no parque, outra roupa em visitas) — NÃO a blusa fixa do avatar sheet.
- NPCs: aparência ÚNICA e FIXA (nunca clone da protagonista). Cite 2–3 traços no image_prompt de TODOS os atos em que o NPC aparece — os MESMOS traços sempre.
- Ambiente: âncora estável entre atos; transições só se o texto mudar de lugar.
- Escola: pátio/banco/quadra — NÃO invente caixa de areia/castelo de areia na escola.
- Roupa: no mesmo dia escolar, a MESMA outfit em todos os atos escolares (uniforme estável).
- Cada image_prompt deve ser visualmente ÚNICO (câmera/pose/props) — nunca reaproveitar o frame de outro ato.
- Se a cena for pública/com desconhecido: incluir pai/mãe/cuidador presente na imagem.
- Pais/irmãos SEM avatar na plataforma: body-only (de costas / rosto oculto) — nunca inventar rosto.
- Estilo: "Walt Disney / Pixar 3D animated still, cinematic soft lighting, wholesome"
- Explicit: "do not repeat previous framing; match THIS page text exactly; clothing matches scene not avatar sheet"
- Sem texto na imagem, sem watermark, family-friendly.

Responda SOMENTE JSON:
{
  "pages": [
    {
      "index": 0,
      "title": string,
      "text": string (português),
      "image_prompt": string (inglês)
    }
  ]
}
Use entre ${MIN_STORY_PAGES} e ${MAX_STORY_PAGES} itens, índices 0..n-1.`,
    user: `Título: ${reviewed.title}
Moral: ${reviewed.moral}

HISTÓRIA FINAL:
"""
${reviewed.fullText}
"""

${settingBrief(opts)}
${feedbackBrief(opts)}

Elenco/companion:
${cast.companionVisualLock || ""}

Fracione agora. Cada image_prompt = cena LITERAL do texto daquele ato; NPCs travados; ambiente/escala estáveis; companion = avatar.`,
    timeoutMs: 120_000,
  });
  if (!parsed) return null;
  const pagesRaw = Array.isArray(parsed.pages) ? parsed.pages : [];
  const chapters: StoryChapter[] = [];
  for (const row of pagesRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const text = String(r.text ?? "").trim();
    const imagePrompt = String(r.image_prompt ?? "").trim();
    const title = String(r.title ?? "").trim() || `Parte ${chapters.length + 1}`;
    if (text.length < 80) continue;
    chapters.push({
      index: chapters.length,
      title,
      text,
      imagePrompt:
        imagePrompt ||
        `Walt Disney / Pixar 3D animated still of child ${cast.childName} with ${cast.friendKind} ${cast.friendName}, unique beat ${chapters.length + 1}, wholesome cinematic lighting, do not repeat previous framing, no text`,
    });
  }
  if (chapters.length < MIN_STORY_PAGES) return null;
  return reinforceTextImageAlignment(
    chapters.slice(0, MAX_STORY_PAGES),
    cast,
  );
}

/** Reforça: image_prompt espelha o texto da página + companion lock. */
function reinforceTextImageAlignment(
  chapters: StoryChapter[],
  cast: StoryCast,
): StoryChapter[] {
  return chapters.map((c, i) => {
    const excerpt = c.text.replace(/\s+/g, " ").trim().slice(0, 420);
    const aligned = [
      `LITERAL PAGE ${i + 1} ILLUSTRATION — show ONLY what this page text describes:`,
      excerpt,
      `---`,
      c.imagePrompt,
      cast.companionVisualLock ||
        `Companion "${cast.friendName}" must match avatar reference exactly.`,
      `FORBIDDEN: foreshadow later pages; wrong location; people/props absent from this page text; generic rabbit replacing ${cast.friendName}.`,
      `NPC appearance must stay locked across pages; environment scale stays stable.`,
    ]
      .filter(Boolean)
      .join(" ");
    return { ...c, imagePrompt: aligned };
  });
}

export type GeneratePipelineResult = {
  story: GeneratedStory;
  pipeline: PipelineStory;
  engine: StoryEngine;
  /** Motivo quando engine === mock-v1 (mensagem amigável). */
  error?: string;
};

/**
 * Align + Continuity Bible + diretor de página (também no path de template).
 */
async function polishChaptersForImages(input: {
  cast: StoryCast;
  title: string;
  chapters: StoryChapter[];
  opts?: PipelineOptions;
  settingPreference?: string;
}): Promise<StoryChapter[]> {
  let chapters = input.chapters.map((c) => ({
    ...c,
    text: enforceCompanionSpeciesInText(c.text, input.cast),
  }));

  try {
    chapters = await realignChaptersToPageText({
      userId: input.opts?.userId,
      cast: input.cast,
      chapters,
    });
  } catch {
    /* mantém */
  }

  const bible = await buildSceneContinuityBible({
    userId: input.opts?.userId,
    cast: input.cast,
    title: input.title,
    chapters,
    settingPreference: input.settingPreference ?? input.opts?.settingPreference,
  });
  chapters = applyBibleToChapters(chapters, bible);

  try {
    chapters = await directPageImagePrompts({
      userId: input.opts?.userId,
      cast: input.cast,
      title: input.title,
      chapters,
    });
  } catch {
    /* mantém bible prompts */
  }

  return chapters.map((c) => ({
    ...c,
    text: enforceCompanionSpeciesInText(c.text, input.cast),
  }));
}

/**
 * Pipeline custo-otimizado:
 * template hit → personaliza + align/bible/diretor; senão outline → expand → review → split → polish.
 */
export async function generateStoryPipeline(input: {
  cast: StoryCast;
  theme: string;
  options?: PipelineOptions;
}): Promise<GeneratePipelineResult> {
  const theme = input.theme.trim();
  const cast = input.cast;
  const baseOpts = input.options;
  const lessons = await loadLearningMemory({
    theme,
    userId: baseOpts?.userId,
  });
  const opts: PipelineOptions | undefined = {
    ...baseOpts,
    feedbackStoryRules:
      baseOpts?.feedbackStoryRules?.trim() || lessons.storyRules || undefined,
  };
  const childName = opts?.protagonistName?.trim() || cast.childName;
  const friendName = cast.friendName;

  // 1) Cache de template — NÃO pula align + bible + diretor
  const matched = await findMatchingTemplate({
    theme,
    userId: opts?.userId,
  });
  if (matched && matched.score >= 0.45) {
    const personalized = personalizeSkeleton(
      matched.skeleton,
      childName,
      friendName,
      matched.title,
    );
    let chapters: StoryChapter[] = personalized.pages.map((p) => ({
      index: p.index,
      title: p.title,
      text: p.text,
      imagePrompt:
        p.imagePrompt ||
        `Walt Disney / Pixar 3D still of ${childName} and ${friendName}, beat ${p.index + 1}, unique framing, no text`,
    }));
    if (chapters.length >= MIN_STORY_PAGES) {
      chapters = await polishChaptersForImages({
        cast,
        title: personalized.title,
        chapters: chapters.slice(0, MAX_STORY_PAGES),
        opts,
        settingPreference: opts?.settingPreference,
      });
      return packResult(
        {
          title: personalized.title,
          moral: personalized.moral,
          fullText: personalized.fullText,
          reviewNotes: `template cache hit (score ${matched.score.toFixed(2)}) + align/bible/director`,
          templateId: matched.id,
          fromTemplate: true,
        },
        chapters,
        "openai-storyteller-template",
      );
    }
  }

  // 2) Outline (mini) → expand (forte) → light review (mini) → split (mini)
  const outline = await outlineStory(cast, theme, opts);
  if (!outline.ok) {
    return {
      story: generateMockStory({
        childName: cast.childName,
        friendName: cast.friendName,
        theme,
      }),
      pipeline: {
        title: `${cast.childName} e ${theme}`,
        moral: "",
        pages: [],
        fullText: "",
        reviewNotes: `fallback mock: ${outline.error}`,
      },
      engine: "mock-v1",
      error: mockFallbackMessage(outline.error),
    };
  }

  const expanded = await expandNarrative(cast, theme, outline, opts);
  if (!expanded.ok) {
    return {
      story: generateMockStory({
        childName: cast.childName,
        friendName: cast.friendName,
        theme,
      }),
      pipeline: {
        title: outline.title,
        moral: outline.moral,
        pages: [],
        fullText: "",
        reviewNotes: `expand failed: ${expanded.error}`,
      },
      engine: "mock-v1",
      error: mockFallbackMessage(expanded.error),
    };
  }

  const reviewed = await lightReview(cast, theme, expanded, opts);

  const chapters = await splitIntoChapters(cast, reviewed, opts);
  let finalChapters =
    chapters ??
    (() => {
      const words = reviewed.fullText.split(/\s+/);
      const chunks = PREFERRED_STORY_PAGES;
      const size = Math.ceil(words.length / chunks);
      return Array.from({ length: chunks }, (_, i) => {
        const text = words.slice(i * size, (i + 1) * size).join(" ");
        return {
          index: i,
          title: `Parte ${i + 1}`,
          text,
          imagePrompt: `Walt Disney / Pixar 3D animated still of ${cast.childName} and ${cast.friendName}, unique scene ${i + 1} of ${chunks}, distinct framing, wholesome, do not repeat previous framing, no text`,
        } satisfies StoryChapter;
      });
    })();

  finalChapters = await polishChaptersForImages({
    cast,
    title: reviewed.title,
    chapters: finalChapters,
    opts,
    settingPreference: opts?.settingPreference,
  });

  // 3) Salvar template anonimizado (inédito)
  let templateId: string | null = null;
  if (opts?.userId) {
    templateId = await saveStoryTemplate({
      userId: opts.userId,
      theme,
      title: reviewed.title,
      moral: reviewed.moral,
      fullText: reviewed.fullText,
      pages: finalChapters,
      childName,
      friendName,
      storyType: opts.storyType,
    });
  }

  return packResult(
    {
      ...reviewed,
      templateId,
      fromTemplate: false,
    },
    finalChapters,
    "openai-storyteller-v1",
  );
}

function packResult(
  reviewed: {
    title: string;
    moral: string;
    fullText: string;
    reviewNotes: string;
    templateId?: string | null;
    fromTemplate?: boolean;
  },
  chapters: StoryChapter[],
  engine: StoryEngine,
): GeneratePipelineResult {
  const pages: GeneratedPage[] = chapters.map((c) => ({
    pageIndex: c.index,
    text: c.text,
    imageUrl: "",
    altText: `${c.title} — ${reviewed.title}`,
    chapterTitle: c.title,
    imagePrompt: c.imagePrompt,
  }));

  return {
    story: {
      title: reviewed.title,
      pages,
      coverImageUrl: "",
      textContent: {
        moral: reviewed.moral,
        reviewNotes: reviewed.reviewNotes,
        fullText: reviewed.fullText,
        templateId: reviewed.templateId ?? null,
        fromTemplate: Boolean(reviewed.fromTemplate),
        pages: pages.map((p) => ({
          index: p.pageIndex,
          title: p.chapterTitle,
          text: p.text,
          image_prompt: p.imagePrompt,
        })),
      },
    },
    pipeline: {
      title: reviewed.title,
      moral: reviewed.moral,
      pages: chapters,
      fullText: reviewed.fullText,
      reviewNotes: reviewed.reviewNotes,
      templateId: reviewed.templateId ?? null,
      fromTemplate: Boolean(reviewed.fromTemplate),
    },
    engine,
  };
}
