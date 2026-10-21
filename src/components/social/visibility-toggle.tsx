"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Globe2, Lock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateStoryVisibilityAction } from "@/lib/social/visibility-actions";
import type { StoryVisibility } from "@/lib/social/types";

const OPTIONS: {
  value: StoryVisibility;
  label: string;
  Icon: typeof Lock;
}[] = [
  { value: "private", label: "Privado", Icon: Lock },
  { value: "friends", label: "Para amigos", Icon: Users },
  { value: "public", label: "Público", Icon: Globe2 },
];

function iconFor(value: StoryVisibility) {
  return OPTIONS.find((o) => o.value === value)?.Icon ?? Lock;
}

export function VisibilityToggle({
  storyId,
  initial,
  iconOnly = false,
  hasCollaborators = false,
}: {
  storyId: string;
  initial: StoryVisibility;
  /** Só o ícone atual + submenu (biblioteca Criação). */
  iconOnly?: boolean;
  hasCollaborators?: boolean;
}) {
  const [value, setValue] = useState<StoryVisibility>(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const CurrentIcon = iconFor(value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function apply(next: StoryVisibility) {
    if (next === value) {
      setOpen(false);
      return;
    }
    const prev = value;
    setError(null);
    setInfo(null);
    setOpen(false);
    startTransition(async () => {
      const result = await updateStoryVisibilityAction(storyId, next);
      if (result.error) {
        setValue(prev);
        setError(result.error);
        return;
      }
      if (result.pendingApproval) {
        setValue(prev);
        setInfo(
          result.message ??
            "Aguardando aprovação dos colaboradores.",
        );
        return;
      }
      setValue(next);
    });
  }

  const hint =
    hasCollaborators && value === "private"
      ? "Em colaboração: Amigos/Público exigem aprovação de todos."
      : null;

  if (iconOnly) {
    return (
      <div className="relative" ref={rootRef}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="size-8 p-0"
          disabled={pending}
          aria-label="Visibilidade da história"
          aria-expanded={open}
          title={hint ?? undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <CurrentIcon className="size-3.5" />
        </Button>
        {open ? (
          <div className="absolute bottom-full right-0 z-20 mb-2 w-44 overflow-hidden rounded-xl border border-border/70 bg-background py-1 shadow-lg">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={pending}
                onClick={() => apply(opt.value)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 ${
                  value === opt.value ? "font-medium text-foreground" : "text-muted-foreground"
                }`}
              >
                <opt.Icon className="size-3.5 shrink-0" />
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="absolute left-0 top-full z-10 mt-1 w-52 text-[10px] leading-snug text-destructive">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="absolute left-0 top-full z-10 mt-1 w-52 text-[10px] leading-snug text-amber-800">
            {info}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={value === opt.value ? "default" : "outline"}
            disabled={pending}
            className="gap-1.5"
            onClick={() => apply(opt.value)}
          >
            <opt.Icon className="size-3.5" />
            {opt.label}
          </Button>
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {info ? <p className="text-xs text-amber-800">{info}</p> : null}
    </div>
  );
}
