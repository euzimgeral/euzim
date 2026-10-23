"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { saveStoryPageFeedbackAction } from "@/lib/stories/page-feedback-actions";
import type { PageFeedbackRating } from "@/lib/stories/page-feedback";
import { withAlpha } from "@/lib/stories/palette";

export type PageFeedbackState = {
  rating: PageFeedbackRating | null;
  comment: string | null;
};

type PaletteBits = {
  paper: string;
  soft: string;
  text: string;
  textMuted: string;
  accent: string;
  deep: string;
  paperEdge: string;
};

export function PageFeedbackBar({
  storyId,
  pageIndex,
  imageUrl,
  initial,
  palette,
  /** Compacto: pergunta + votos à esquerda; `toolbarEnd` à direita (nav). */
  compact = false,
  toolbarEnd,
}: {
  storyId: string;
  pageIndex: number;
  imageUrl: string;
  initial?: PageFeedbackState | null;
  palette: PaletteBits;
  compact?: boolean;
  /** Conteúdo à direita na mesma linha (Anterior / página / Próxima). */
  toolbarEnd?: ReactNode;
}) {
  const [rating, setRating] = useState<PageFeedbackRating | null>(
    initial?.rating ?? null,
  );
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [showDislikeForm, setShowDislikeForm] = useState(
    initial?.rating === "dislike",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRating(initial?.rating ?? null);
    setComment(initial?.comment ?? "");
    setShowDislikeForm(initial?.rating === "dislike");
    setStatus(null);
  }, [pageIndex, initial?.rating, initial?.comment]);

  function onLike() {
    setShowDislikeForm(false);
    setStatus(null);
    startTransition(async () => {
      const res = await saveStoryPageFeedbackAction({
        storyId,
        pageIndex,
        rating: "like",
        imageUrl,
      });
      if (!res.ok) {
        setStatus(res.error || "Não foi possível salvar.");
        return;
      }
      setRating("like");
      setComment("");
      setStatus("Obrigado! Vamos gerar parecido com isso.");
    });
  }

  function onDislikeOpen() {
    setShowDislikeForm(true);
    setStatus(null);
    if (rating !== "dislike") setRating(null);
  }

  function onSaveDislike() {
    startTransition(async () => {
      const res = await saveStoryPageFeedbackAction({
        storyId,
        pageIndex,
        rating: "dislike",
        comment,
        imageUrl,
      });
      if (!res.ok) {
        setStatus(res.error || "Não foi possível salvar.");
        return;
      }
      setRating("dislike");
      setShowDislikeForm(false);
      setStatus("Feedback salvo. Vamos usar isso para melhorar as próximas histórias.");
    });
  }

  const voteButtons = (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="font-story-body h-8 gap-1 border-0 px-2.5 shadow-sm"
        style={{
          background:
            rating === "like" ? withAlpha(palette.accent, 0.28) : palette.soft,
          color: palette.text,
          outline:
            rating === "like"
              ? `2px solid ${palette.accent}`
              : "2px solid transparent",
        }}
        onClick={onLike}
        aria-pressed={rating === "like"}
        aria-label="Gostei"
      >
        <ThumbsUp className="size-3.5" />
        <span className="hidden sm:inline">Gostei</span>
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        className="font-story-body h-8 gap-1 border-0 px-2.5 shadow-sm"
        style={{
          background:
            rating === "dislike" || showDislikeForm
              ? withAlpha(palette.deep, 0.12)
              : palette.soft,
          color: palette.text,
          outline:
            rating === "dislike" || showDislikeForm
              ? `2px solid ${withAlpha(palette.deep, 0.45)}`
              : "2px solid transparent",
        }}
        onClick={onDislikeOpen}
        aria-pressed={rating === "dislike"}
        aria-label="Não gostei"
      >
        <ThumbsDown className="size-3.5" />
        <span className="hidden sm:inline">Não gostei</span>
      </Button>
    </>
  );

  const dislikePanel =
    showDislikeForm || status ? (
      <div className="space-y-2">
        {showDislikeForm ? (
          <div
            className="space-y-2 rounded-xl px-3 py-3"
            style={{
              background: withAlpha(palette.soft, 0.9),
              border: `1px solid ${withAlpha(palette.paperEdge, 0.35)}`,
            }}
          >
            <label
              className="font-story-body block text-xs font-semibold"
              style={{ color: palette.text }}
              htmlFor={`page-feedback-${pageIndex}`}
            >
              O que não ficou bom nesta imagem?
            </label>
            <textarea
              id={`page-feedback-${pageIndex}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={1200}
              disabled={pending}
              placeholder="Ex.: braço estranho, personagem errado, cenário diferente do texto…"
              className="font-story-body w-full resize-y rounded-lg px-3 py-2 text-sm outline-none"
              style={{
                background: palette.paper,
                color: palette.text,
                border: `1px solid ${withAlpha(palette.paperEdge, 0.4)}`,
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={pending || comment.trim().length < 3}
                className="font-story-body border-0 shadow-md"
                style={{ background: palette.deep, color: palette.paper }}
                onClick={onSaveDislike}
              >
                Salvar feedback
              </Button>
            </div>
          </div>
        ) : null}
        {status ? (
          <p
            role="status"
            className="font-story-body text-xs font-medium"
            style={{ color: palette.textMuted }}
          >
            {status}
          </p>
        ) : null}
      </div>
    ) : null;

  if (compact) {
    return (
      <div className="mt-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <p
              className="font-story-body shrink-0 text-[0.7rem] font-semibold leading-tight sm:text-xs"
              style={{ color: palette.textMuted }}
            >
              Gostou desta página?
            </p>
            {voteButtons}
          </div>
          {toolbarEnd ? (
            <div className="flex shrink-0 items-center gap-2">{toolbarEnd}</div>
          ) : null}
        </div>
        {dislikePanel}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <p
          className="font-story-body w-full text-center text-xs font-semibold"
          style={{ color: palette.textMuted }}
        >
          Gostou desta página?
        </p>
        {voteButtons}
      </div>
      {dislikePanel}
    </div>
  );
}
