"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type ShareableStory = {
  id: string;
  title: string;
  coverImageUrl?: string | null;
  shareToken?: string | null;
};

export function ChooseStoryShareDialog({
  stories,
}: {
  stories: ShareableStory[];
}) {
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function storyUrl(story: ShareableStory): string {
    const token = story.shareToken || story.id;
    return `${window.location.origin}/story/${token}`;
  }

  async function copyText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  function copyStory(story: ShareableStory) {
    setError(null);
    startTransition(async () => {
      const url = storyUrl(story);
      if (await copyText(url)) setCopiedId(story.id);
      else setError("Não foi possível copiar o link.");
    });
  }

  function shareStory(story: ShareableStory) {
    setError(null);
    startTransition(async () => {
      const url = storyUrl(story);
      try {
        if (navigator.share) {
          await navigator.share({
            title: story.title,
            text: `Leia “${story.title}” no Euzim`,
            url,
          });
          return;
        }
      } catch {
        /* fall through */
      }
      if (await copyText(url)) setCopiedId(story.id);
      else setError("Não foi possível compartilhar.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="w-full gap-1.5">
          <Share2 className="size-3.5" />
          Escolher História
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Escolher História</DialogTitle>
          <DialogDescription>
            Copie ou compartilhe o link de uma história da sua biblioteca.
          </DialogDescription>
        </DialogHeader>
        {stories.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há histórias para compartilhar.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {stories.map((story) => (
              <li
                key={story.id}
                className="flex items-center gap-3 rounded-xl border border-border/70 p-2"
              >
                {story.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={story.coverImageUrl}
                    alt=""
                    className="size-12 rounded-md object-cover"
                  />
                ) : (
                  <div className="size-12 rounded-md bg-muted" />
                )}
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {story.title}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={pending}
                  onClick={() => copyStory(story)}
                >
                  {copiedId === story.id ? (
                    <Check className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {copiedId === story.id ? "Copiado" : "Copiar"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="gap-1"
                  disabled={pending}
                  onClick={() => shareStory(story)}
                >
                  <Share2 className="size-3.5" />
                  Enviar
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
