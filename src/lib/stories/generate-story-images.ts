import sharp from "sharp";
import type { GeneratedPage } from "@/lib/stories/generate-mock";
import type { StoryCast } from "@/lib/stories/story-cast";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  differenceHash,
  isNearDuplicate,
  shotForPage,
} from "@/lib/stories/image-hash";
import {
  hashPrompt,
  normalizePromptForHash,
} from "@/lib/stories/prompt-hash";
import { modelForActivity } from "@/lib/ai/model-registry";
import { imageViaOpenRouter } from "@/lib/ai/openrouter-client";
import {
  estimateImageUsd,
  recordImageUsage,
} from "@/lib/usage/openai-meter";
import {
  imageSizeForStoryPage,
  isWallpaperStoryPage,
  STORY_SAFE_FRAME_HINT,
  type StoryImageSize,
} from "@/lib/stories/image-formats";
import { feedbackBoostFromComment } from "@/lib/stories/page-feedback";
import { loadLearningMemory } from "@/lib/learning/load-memory";
import { ensureCompanionVisualTraits } from "@/lib/stories/companion-traits";
import { visionCheckStoryPage } from "@/lib/stories/vision-page-check";
import { speciesLockPromptLine } from "@/lib/stories/story-cast";

const IMAGE_MODEL = modelForActivity("story_image");
/** Qualidade intermediária = custo↓ sem matar fidelidade dos avatares. */
const IMAGE_QUALITY =
  (process.env.OPENROUTER_IMAGE_QUALITY?.trim() as "low" | "medium" | "high") ||
  (process.env.OPENAI_IMAGE_QUALITY?.trim() as "low" | "medium" | "high") ||
  "low";
const REF_EDGE = 768;
/** Cap de custo: no máximo 2 retries de unicidade (+ 1 last resort). */
const MAX_UNIQUENESS_RETRIES = 2;

function apiKeyPresent(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
}

async function fetchBuf(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 100 ? buf : null;
  } catch {
    return null;
  }
}

async function prepareJpeg(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({
      width: REF_EDGE,
      height: REF_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
}

async function loadRefs(cast: StoryCast): Promise<Buffer[]> {
  const coPlayUrls = (cast.coPlayMembers ?? [])
    .map((m) => m.avatarUrl)
    .filter((u): u is string => Boolean(u));
  const urls = [
    cast.childHeroUrl,
    ...coPlayUrls,
    cast.friendHeroUrl,
    cast.childFaceSheetUrl,
    cast.friendSheetUrl,
    cast.childBodySheetUrl,
  ].filter((u): u is string => Boolean(u));

  const out: Buffer[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const raw = await fetchBuf(url);
    if (!raw) continue;
    try {
      out.push(await prepareJpeg(raw));
    } catch {
      /* skip */
    }
    if (out.length >= 6) break;
  }
  return out;
}

async function callImageEdit(
  prompt: string,
  images: Buffer[],
  userId?: string | null,
  pageIndex?: number,
  size: StoryImageSize = "1536x1024",
): Promise<Buffer> {
  if (!apiKeyPresent()) throw new Error("OPENROUTER_API_KEY ausente.");

  const result = await imageViaOpenRouter({
    model: IMAGE_MODEL,
    prompt,
    referenceImages: images,
    size,
    quality: IMAGE_QUALITY,
  });
  if (!result.ok || !result.buffer) {
    throw new Error(result.error || "IA images/edits falhou.");
  }

  const qualityMul =
    IMAGE_QUALITY === "low" ? 0.65 : IMAGE_QUALITY === "high" ? 1.5 : 1;
  await recordImageUsage({
    userId,
    category: "story_image",
    model: IMAGE_MODEL,
    operation:
      size === "1024x1536" ? "story_wallpaper_image" : "story_page_image",
    estimatedUsd: estimateImageUsd(IMAGE_MODEL, 1) * qualityMul,
    nativeCostUsd: result.nativeCostUsd,
    meta: {
      pageIndex: pageIndex ?? null,
      quality: IMAGE_QUALITY,
      size,
    },
  });
  return result.buffer;
}

async function uploadStoryJpeg(input: {
  userId: string;
  storyKey: string;
  pageIndex: number;
  jpeg: Buffer;
  attempt?: number;
}): Promise<string> {
  if (!isSupabaseConfigured()) {
    return `data:image/jpeg;base64,${input.jpeg.toString("base64")}`;
  }
  const db = createAdminClient() ?? (await createClient());
  if (!db) {
    return `data:image/jpeg;base64,${input.jpeg.toString("base64")}`;
  }
  const suffix = input.attempt && input.attempt > 0 ? `-r${input.attempt}` : "";
  const path = `${input.userId}/stories/${input.storyKey}/page-${input.pageIndex}${suffix}.jpg`;
  const { error } = await db.storage.from("avatars").upload(path, input.jpeg, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) {
    return `data:image/jpeg;base64,${input.jpeg.toString("base64")}`;
  }
  return db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

function familyFaceRule(cast: StoryCast): string {
  if (cast.hasFamilyMemberAvatars) {
    return `Parents or siblings may show faces ONLY if matching an uploaded family avatar reference; otherwise body-only.`;
  }
  return [
    `CRITICAL face privacy: any parent, mother, father, caregiver, sibling, brother, or sister`,
    `MUST be shown body-only — from behind, over-the-shoulder, cropped at shoulders, or face fully turned away / obscured.`,
    `Never invent identifiable faces for family adults or siblings.`,
    `Strangers in the background may be soft-focus without clear facial detail.`,
  ].join(" ");
}

function scenePrompt(
  cast: StoryCast,
  page: GeneratedPage,
  storyTitle: string,
  pageIndex: number,
  totalPages: number,
  previousSummaries: string[],
  retryBoost = 0,
  extras?: {
    learnedRules?: string;
    dislikeFix?: string;
    pageSalt?: string;
  },
): string {
  const base =
    page.imagePrompt?.trim() ||
    `Scene from the children's story "${storyTitle}"`;
  const shot = shotForPage(pageIndex + retryBoost);
  const avoid =
    previousSummaries.length > 0
      ? `Do NOT reuse these previous framings: ${previousSummaries.join(" | ")}.`
      : "";
  const uniqueness =
    retryBoost > 0
      ? `REGENERATION ${retryBoost}: previous result looked too similar — change LOCATION details, CAMERA ANGLE, POSE, and FOREGROUND OBJECTS dramatically while keeping the same story beat.`
      : "";

  // Continuity + wardrobe já vêm embutidos em page.imagePrompt (Scene Continuity Bible).
  const continuityHint = page.imagePrompt?.includes("CONTINUITY BEAT")
    ? "Obey CONTINUITY BEAT / WARDROBE OUTFIT / PROP LOCKS / MUST SHOW / MUST NOT SHOW from the prompt above."
    : "";
  const wardrobeHint = page.imagePrompt?.includes("WARDROBE OUTFIT")
    ? [
        `WARDROBE RULE: dress "${cast.childName}" EXACTLY in the WARDROBE OUTFIT specified for THIS act.`,
        `Reference images are for FACE, HAIR, BODY SHAPE and Pixar identity ONLY — do NOT copy the default shirt/clothes from the turnaround sheet.`,
        `If continuity says keep/same outfit, do NOT invent a different dress or shirt color.`,
        `School-day acts (patio/recess/classroom): keep the SAME school outfit across pages — never swap floral dress ↔ pink tee ↔ other casual mid-day.`,
      ].join(" ")
    : [
        `WARDROBE RULE: clothing must match this story beat/scene, not the default outfit on the avatar reference sheet.`,
        `Use references only for face, hair, and body identity.`,
      ].join(" ");

  return [
    base,
    continuityHint,
    wardrobeHint,
    extras?.learnedRules || "",
    extras?.dislikeFix || "",
    extras?.pageSalt
      ? `PAGE UNIQUE ID: ${extras.pageSalt} — this frame must be visually unique to this page.`
      : "",
    `Mandatory camera: ${shot}.`,
    `This is beat ${pageIndex + 1} of ${totalPages} — unique composition required. NEVER reuse a previous page's framing or composition.`,
    avoid,
    uniqueness,
    `Walt Disney / Pixar quality 3D animated cinematic still.`,
    cast.coPlayMembers && cast.coPlayMembers.length > 0
      ? `Feature THESE exact characters from the reference images interacting together: ${cast.coPlayMembers.map((m) => `"${m.name}"`).join(", ")}. Show clear presence and interaction among them.`
      : `Feature THIS exact child character "${cast.childName}" and THIS exact ${cast.friendKind} companion "${cast.friendName}" from the reference images as the clear protagonists.`,
    `Preserve Pixar face, hair, skin tone, and body identity from the references with high fidelity.`,
    `Do NOT lock clothing to the reference sheet blouse — change outfit when the story context changes.`,
    `Do not invent avatar face/hair details that contradict the reference sheets.`,
    `ANTI-CLONE RULE (CRITICAL): any OTHER child/NPC in the frame MUST look clearly different from "${cast.childName}" — different hair color OR length/style, different clothes colors, different face shape. NEVER twin/clone the protagonist.`,
    `If NPC NOTES / LOCKED NPC APPEARANCE is in the prompt, obey it exactly across this beat.`,
    speciesLockPromptLine(cast),
    cast.companionVisualLock ||
      `COMPANION FIDELITY: "${cast.friendName}" must match the companion avatar reference (species, colors, shape) EXACTLY — never replace with a generic rabbit/bear/plush.`,
    `ENVIRONMENT SCALE: keep the same location scale as the story beat (e.g. a normal sandbox sandcastle stays child-sized — do not magically enlarge into a monumental fortress unless the text says so).`,
    `HARD UNIQUE FRAME: this still must NOT look like any previous page — change camera, pose, foreground props, and partial layout even if the location is the same park.`,
    [
      `ANATOMY LOCK (CRITICAL): every able-bodied human/child has EXACTLY 2 arms and 2 legs — never 3 arms, never duplicated limbs, never melted extra hands.`,
      `Joints must be physically plausible: elbows/shoulders connect correctly for the body orientation.`,
      `If the character is seen from the BACK, arms wrap naturally from the back view — NEVER bend an arm as if the torso were facing the camera while the head/back face away (no impossible over-the-shoulder hug anatomy).`,
      `Prefer clear, readable poses over twisted angles that break limbs.`,
      `EXCEPTION only if the character avatar is explicitly a child with disability / wheelchair / limb difference — then respect that avatar; otherwise assume typical anatomy.`,
    ].join(" "),
    familyFaceRule(cast),
    isWallpaperStoryPage(pageIndex, totalPages)
      ? [
          `Final beat / wallpaper page: rich closing scene when the text allows; outfit matches that closing context.`,
          `Output format is PORTRAIT mobile wallpaper (${STORY_SAFE_FRAME_HINT})`,
        ].join(" ")
      : `Output format is LANDSCAPE cinematic story still (1536x1024), composed for a 16:10 story reader frame — keep important action inside the frame, avoid awkward edge crops.`,
    `Soft cinematic lighting, wholesome family-friendly mood, rich storybook composition.`,
    `No text, no captions, no watermark, no logos, no photorealistic humans.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function promptUsedTag(promptHash: string, prompt: string): string {
  return `ph:${promptHash}|${prompt.slice(0, 240)}`;
}

/**
 * Gera 1 imagem Pixar por página (qualidade intermediária).
 * Sem cache entre páginas; dHash + máx. 2 retries. Vision QA NÃO roda aqui
 * (só em regenerate / Não gostei — ver regenerateStoryPageImage).
 */
export async function generateStoryPageImages(input: {
  userId: string;
  storyKey: string;
  storyTitle: string;
  cast: StoryCast;
  pages: GeneratedPage[];
  onProgress?: (done: number, total: number) => void;
}): Promise<GeneratedPage[]> {
  const refs = await loadRefs(input.cast);
  const out: GeneratedPage[] = [];
  const hashes: string[] = [];
  const framingNotes: string[] = [];
  const usedUrls = new Set<string>();
  const names = [input.cast.childName, input.cast.friendName];
  const lessons = await loadLearningMemory({
    theme: input.storyTitle,
    userId: input.userId,
  });

  for (let i = 0; i < input.pages.length; i++) {
    const page = input.pages[i];
    let imageUrl = page.imageUrl || "";
    let promptUsed = "";
    try {
      if (apiKeyPresent() && refs.length > 0) {
        const pageSalt = `${input.storyKey}-p${i}`;
        const promptExtras = {
          learnedRules: lessons.imageRules,
          pageSalt,
        };
        const size = imageSizeForStoryPage(i, input.pages.length);
        let jpeg: Buffer | null = null;
        let chosenHash = "";
        let usedPrompt = "";
        let uniqFix = "";

        for (let attempt = 0; attempt <= MAX_UNIQUENESS_RETRIES; attempt++) {
          const extras = {
            ...promptExtras,
            dislikeFix: uniqFix || undefined,
          };
          const prompt = scenePrompt(
            input.cast,
            page,
            input.storyTitle,
            i,
            input.pages.length,
            framingNotes,
            attempt,
            extras,
          );
          usedPrompt = prompt;
          const candidate = await callImageEdit(
            prompt,
            refs.slice(0, 4),
            input.userId,
            page.pageIndex,
            size,
          );
          const hash = await differenceHash(candidate);
          if (isNearDuplicate(hash, hashes)) {
            console.warn(
              `[story-images] near-duplicate rejected page=${i} attempt=${attempt}`,
            );
            uniqFix =
              "FORCE UNIQUE FRAME: previous attempt looked like an earlier page — change camera, pose, foreground props, and composition completely.";
            continue;
          }

          const tempUrl = await uploadStoryJpeg({
            userId: input.userId,
            storyKey: input.storyKey,
            pageIndex: page.pageIndex,
            jpeg: candidate,
            attempt: attempt + 100 + i * 10,
          });
          if (usedUrls.has(tempUrl)) {
            uniqFix =
              "Previous upload URL already used in this story — regenerate a brand-new unique still.";
            continue;
          }

          jpeg = candidate;
          chosenHash = hash;
          imageUrl = tempUrl;
          break;
        }

        if (!jpeg) {
          const prompt = scenePrompt(
            input.cast,
            page,
            input.storyTitle,
            i,
            input.pages.length,
            framingNotes,
            MAX_UNIQUENESS_RETRIES + 2,
            {
              ...promptExtras,
              dislikeFix:
                "LAST RESORT UNIQUE: brand-new camera and props; coherent anatomy; outfit from WARDROBE; match page text only.",
            },
          );
          usedPrompt = prompt;
          const candidate = await callImageEdit(
            prompt,
            refs.slice(0, 4),
            input.userId,
            page.pageIndex,
            size,
          );
          jpeg = candidate;
          chosenHash = await differenceHash(candidate);
          imageUrl = await uploadStoryJpeg({
            userId: input.userId,
            storyKey: input.storyKey,
            pageIndex: page.pageIndex,
            jpeg,
            attempt: Date.now() % 10_000,
          });
        }

        if (jpeg && imageUrl) {
          usedUrls.add(imageUrl);
          hashes.push(chosenHash);
          framingNotes.push(`beat${i + 1}:${shotForPage(i).slice(0, 48)}`);
          const finalHash = hashPrompt(
            normalizePromptForHash(usedPrompt, names),
          );
          promptUsed = promptUsedTag(finalHash, usedPrompt);
        }
      }
    } catch {
      // mantém vazio — UI ainda mostra o texto
    }
    out.push({
      ...page,
      imageUrl,
      imagePrompt: promptUsed
        ? `${promptUsed}${page.imagePrompt ? ` :: ${page.imagePrompt}` : ""}`
        : page.imagePrompt,
    });
    input.onProgress?.(i + 1, input.pages.length);
  }

  return out;
}

/**
 * Regenera uma única página com boost do feedback do usuário + aprendizados.
 */
export async function regenerateStoryPageImage(input: {
  userId: string;
  storyKey: string;
  storyTitle: string;
  cast: StoryCast;
  page: GeneratedPage;
  pageIndex: number;
  totalPages: number;
  dislikeComment?: string | null;
  avoidImageUrls?: string[];
}): Promise<{ imageUrl: string; promptUsed: string } | null> {
  if (!apiKeyPresent()) return null;
  let cast = input.cast;
  try {
    cast = await ensureCompanionVisualTraits({
      userId: input.userId,
      cast,
    });
  } catch {
    /* segue */
  }
  const refs = await loadRefs(cast);
  if (refs.length === 0) return null;

  const lessons = await loadLearningMemory({
    theme: input.storyTitle,
    userId: input.userId,
  });
  const names = [cast.childName, cast.friendName];
  const size = imageSizeForStoryPage(input.pageIndex, input.totalPages);
  const framingNotes = [
    `regen-page-${input.pageIndex + 1}:force-new-composition`,
  ];

  async function renderOnce(dislikeFix: string): Promise<{
    imageUrl: string;
    promptUsed: string;
  } | null> {
    const extras = {
      learnedRules: lessons.imageRules,
      dislikeFix,
    };
    const prompt = scenePrompt(
      cast,
      input.page,
      input.storyTitle,
      input.pageIndex,
      input.totalPages,
      framingNotes,
      3,
      extras,
    );
    const jpeg = await callImageEdit(
      prompt,
      refs.slice(0, 4),
      input.userId,
      input.page.pageIndex,
      size,
    );
    const imageUrl = await uploadStoryJpeg({
      userId: input.userId,
      storyKey: input.storyKey,
      pageIndex: input.page.pageIndex,
      jpeg,
      attempt: Date.now() % 10_000,
    });
    const finalHash = hashPrompt(normalizePromptForHash(prompt, names));
    return {
      imageUrl,
      promptUsed: promptUsedTag(finalHash, prompt),
    };
  }

  const firstFix = feedbackBoostFromComment(input.dislikeComment);
  let generated = await renderOnce(firstFix);
  if (!generated) return null;

  try {
    const check = await visionCheckStoryPage({
      userId: input.userId,
      pageText: input.page.text || "",
      imageUrl: generated.imageUrl,
      companionName: cast.friendName,
      companionLock: cast.companionVisualLock,
    });
    if (!check.ok) {
      const retryFix = [
        firstFix,
        "VISION RETRY — previous image failed page-text match:",
        check.fixHint || check.issues.join("; "),
        "Redraw to match the page text location, people, and action exactly.",
      ]
        .filter(Boolean)
        .join(" ");
      const retry = await renderOnce(retryFix);
      if (retry) generated = retry;
    }
  } catch {
    /* mantém primeira imagem */
  }

  return generated;
}
