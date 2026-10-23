"use client";

import {
  useEffect,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Share2 } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { QuizTherapy } from "@/components/kids/quiz-therapy";
import {
  PageFeedbackBar,
  type PageFeedbackState,
} from "@/components/kids/page-feedback-bar";
import { useImagePalette } from "@/hooks/use-image-palette";
import {
  paletteBackgroundStyle,
  withAlpha,
} from "@/lib/stories/palette";
import type { QuizQuestion } from "@/lib/stories/quiz";
import { shareStoryLink } from "@/lib/stories/share";
import { getMyReferralShareUrlAction } from "@/lib/referral/actions";
import { PageTurnStage } from "@/components/stories/page-turn-stage";
import { usePageTurn } from "@/hooks/use-page-turn";

type Page = {
  pageIndex: number;
  text: string;
  imageUrl: string;
  altText: string;
};

export function StoryFlipbook({
  storyId,
  title,
  pages: initialPages,
  questions,
  initialQuizScore,
  shareToken,
  readingMode: _readingMode = true,
  showTitle = true,
  backHref,
  backLabel = "Voltar para a biblioteca",
  showShare = false,
  showWallpaper: _showWallpaper = false,
  enablePageFeedback = false,
  initialPageFeedback = [],
}: {
  storyId: string;
  title: string;
  pages: Page[];
  questions: QuizQuestion[];
  initialQuizScore?: number | null;
  shareToken?: string | null;
  readingMode?: boolean;
  showTitle?: boolean;
  /** Link único de saída do modo imersivo. */
  backHref?: string | null;
  backLabel?: string;
  showShare?: boolean;
  /** Deprecated: wallpaper sai pela biblioteca — mantido só por compat. */
  showWallpaper?: boolean;
  /** Joinha / não gostei + regenerar imagem (dono da história). */
  enablePageFeedback?: boolean;
  initialPageFeedback?: { pageIndex: number; rating: "like" | "dislike"; comment: string | null }[];
}) {
  const [index, setIndex] = useState(0);
  const [pages, setPages] = useState(initialPages);
  const [shareState, setShareState] = useState<"idle" | "copied" | "shared">(
    "idle",
  );
  const textScrollRef = useRef<HTMLDivElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    setPages(initialPages);
  }, [initialPages]);

  const quizIndex = pages.length;
  const hasQuiz = questions.length > 0;
  const maxIndex = hasQuiz ? quizIndex : Math.max(0, pages.length - 1);
  const isQuiz = hasQuiz && index >= quizIndex;
  const page = !isQuiz ? pages[index] : null;
  const palette = useImagePalette(page?.imageUrl || pages[0]?.imageUrl);
  const showStoryTitle = showTitle && !isQuiz && index === 0;

  const { turn, goNext, goPrev } = usePageTurn({
    index,
    setIndex,
    max: maxIndex,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  useEffect(() => {
    textScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [index]);

  function onTouchStart(e: TouchEvent) {
    const t = e.changedTouches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }

  function onTouchEnd(e: TouchEvent) {
    if (touchStartX.current == null || touchStartY.current == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  async function onShare() {
    if (!shareToken) return;
    let referralCode: string | null = null;
    try {
      const ref = await getMyReferralShareUrlAction();
      referralCode = ref.code ?? null;
    } catch {
      // share sem ref se falhar
    }
    const result = await shareStoryLink({ title, shareToken, referralCode });
    if (result === "copied" || result === "shared") {
      setShareState(result === "copied" ? "copied" : "shared");
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  }

  const atLastStoryPage = !isQuiz && index >= pages.length - 1;
  const nextDisabled =
    turn !== "idle" || isQuiz || (!hasQuiz && atLastStoryPage);
  const prevDisabled = turn !== "idle" || index === 0;
  const feedbackByPage = new Map<number, PageFeedbackState>(
    initialPageFeedback.map((f) => [
      f.pageIndex,
      { rating: f.rating, comment: f.comment },
    ]),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={paletteBackgroundStyle(palette)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-45"
        style={{
          backgroundImage: `
            radial-gradient(circle at 18% 12%, ${palette.glow}, transparent 42%),
            radial-gradient(circle at 88% 78%, ${withAlpha(palette.accent, 0.22)}, transparent 38%)
          `,
        }}
        aria-hidden
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* Topo: logo + botão de saída na mesma linha */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 pb-2 pt-3 md:px-5">
          <BrandLogo
            variant="color"
            size="compact"
            href={null}
            className="drop-shadow-[0_1px_8px_rgba(255,255,255,0.55)]"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {backHref ? (
              <Button
                asChild
                variant="secondary"
                size="sm"
                className="font-story-body gap-1.5 border-0 shadow-sm"
                style={{ background: palette.paper, color: palette.text }}
              >
                <Link href={backHref}>
                  <ArrowLeft className="size-3.5" />
                  {backLabel}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>

        {!isQuiz && page ? (
          <PageTurnStage
            turn={turn}
            className="relative z-10 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col"
          >
            {/* Imagem fixa — título só na 1ª página, como extensão da arte */}
            <figure className="w-full shrink-0 px-3 md:px-5">
              <div
                className="relative overflow-hidden rounded-t-[1.35rem] shadow-lg md:rounded-t-[1.6rem]"
                style={{
                  boxShadow: `0 12px 32px ${withAlpha(palette.deep, 0.28)}`,
                }}
              >
                {page.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={page.imageUrl}
                    src={page.imageUrl}
                    alt={page.altText}
                    crossOrigin="anonymous"
                    className="aspect-[16/10] max-h-[40vh] w-full object-cover sm:max-h-[44vh]"
                  />
                ) : (
                  <div
                    className="aspect-[16/10] max-h-[40vh] w-full sm:max-h-[44vh]"
                    style={{ background: palette.soft }}
                  />
                )}

                {showStoryTitle ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4 pt-16 text-center"
                    style={{
                      background: `linear-gradient(to top, ${withAlpha(palette.deep, 0.88)} 0%, ${withAlpha(palette.deep, 0.45)} 55%, transparent 100%)`,
                    }}
                  >
                    <h1
                      className="font-story-display text-[1.4rem] font-semibold leading-tight tracking-tight md:text-2xl"
                      style={{
                        color: palette.paper,
                        textShadow: `0 2px 12px ${withAlpha(palette.deep, 0.65)}`,
                      }}
                    >
                      {title}
                    </h1>
                  </div>
                ) : null}
              </div>
              <div
                className="h-1.5 w-full"
                style={{
                  background: `linear-gradient(90deg, ${withAlpha(palette.accent, 0.35)}, ${palette.soft}, ${withAlpha(palette.accent, 0.35)})`,
                }}
                aria-hidden
              />
            </figure>

            <div
              ref={textScrollRef}
              className="min-h-0 w-full flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 pb-4 md:px-5"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <div
                key={`text-${index}`}
                className="rounded-b-[1.35rem] px-5 pb-6 pt-5 md:rounded-b-[1.6rem] md:px-8 md:pb-8"
                style={{
                  backgroundColor: palette.paper,
                  color: palette.text,
                  boxShadow: `
                    0 18px 40px ${withAlpha(palette.deep, 0.22)},
                    inset 0 1px 0 rgba(255,255,255,0.55)
                  `,
                }}
              >
                <div
                  className="mb-4 flex items-center justify-center gap-2"
                  aria-hidden
                >
                  <span
                    className="h-px w-8"
                    style={{ background: withAlpha(palette.paperEdge, 0.33) }}
                  />
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: palette.accent }}
                  />
                  <span
                    className="h-px w-8"
                    style={{ background: withAlpha(palette.paperEdge, 0.33) }}
                  />
                </div>

                <p className="font-story-body whitespace-pre-wrap text-[1.125rem] font-semibold leading-[1.75] md:text-[1.28rem] md:leading-[1.8]">
                  {page.text}
                </p>

                {(() => {
                  const navControls = (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-story-body h-8 gap-1 border-0 px-2.5 shadow-sm"
                        style={{
                          background: palette.soft,
                          color: palette.text,
                        }}
                        disabled={prevDisabled}
                        onClick={goPrev}
                      >
                        <ChevronLeft className="size-4" />
                        <span className="hidden sm:inline">Anterior</span>
                      </Button>
                      <p
                        className="font-story-body min-w-[3.25rem] text-center text-xs font-bold tracking-[0.14em] uppercase"
                        style={{ color: palette.textMuted }}
                      >
                        {index + 1} / {pages.length}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="font-story-body h-8 gap-1 border-0 px-2.5 shadow-md"
                        style={{
                          background: palette.deep,
                          color: palette.paper,
                        }}
                        onClick={goNext}
                        disabled={nextDisabled && !hasQuiz}
                      >
                        <span className="hidden sm:inline">
                          {atLastStoryPage && hasQuiz ? "Quiz" : "Próxima"}
                        </span>
                        <ChevronRight className="size-4" />
                      </Button>
                    </>
                  );

                  if (enablePageFeedback) {
                    return (
                      <PageFeedbackBar
                        compact
                        storyId={storyId}
                        pageIndex={page.pageIndex}
                        imageUrl={page.imageUrl}
                        initial={feedbackByPage.get(page.pageIndex) ?? null}
                        palette={palette}
                        toolbarEnd={navControls}
                      />
                    );
                  }

                  return (
                    <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                      {navControls}
                    </div>
                  );
                })()}
              </div>
            </div>
          </PageTurnStage>
        ) : (
          <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-y-auto px-3 pb-6 md:px-5">
            <div
              className="storybook-page-enter rounded-[1.35rem] p-3 md:rounded-[1.6rem] md:p-4"
              style={{
                background: palette.paper,
                boxShadow: `0 22px 48px ${withAlpha(palette.deep, 0.25)}`,
              }}
            >
              <QuizTherapy
                storyId={storyId}
                title={title}
                questions={questions}
                initialScore={initialQuizScore}
              />
              <div className="mt-4 flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="font-story-body border-0"
                  style={{ background: palette.soft, color: palette.text }}
                  onClick={() => setIndex(pages.length - 1)}
                >
                  Rever história
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showShare && shareToken ? (
        <button
          type="button"
          aria-label="Compartilhar história"
          onClick={() => void onShare()}
          className="fixed bottom-5 right-5 z-50 flex size-12 items-center justify-center rounded-full shadow-lg transition hover:scale-105 active:scale-95"
          style={{
            background: palette.paper,
            color: palette.deep,
            border: `2px solid ${withAlpha(palette.paperEdge, 0.27)}`,
          }}
        >
          {shareState === "idle" ? (
            <Share2 className="size-5" />
          ) : (
            <Check className="size-5" style={{ color: palette.accent }} />
          )}
        </button>
      ) : null}

      {shareState !== "idle" ? (
        <p
          role="status"
          className="font-story-body fixed bottom-20 right-5 z-50 rounded-full px-3 py-1 text-xs font-semibold shadow"
          style={{ background: palette.paper, color: palette.text }}
        >
          {shareState === "copied" ? "Link copiado" : "Compartilhado"}
        </p>
      ) : null}
    </div>
  );
}
