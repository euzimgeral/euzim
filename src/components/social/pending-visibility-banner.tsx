"use client";

import { useState, useTransition } from "react";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  respondVisibilityRequestAction,
  type PendingVisibilityRequest,
} from "@/lib/social/visibility-collab";

const VIS_LABEL: Record<string, string> = {
  friends: "Para amigos",
  public: "Público",
  private: "Privado",
};

export function PendingVisibilityBanner({
  requests,
}: {
  requests: PendingVisibilityRequest[];
}) {
  const [items, setItems] = useState(requests);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (items.length === 0) return null;

  function run(id: string, decision: "approved" | "rejected") {
    setError(null);
    startTransition(async () => {
      const result = await respondVisibilityRequestAction(id, decision);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((prev) => prev.filter((r) => r.id !== id));
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border border-sky-200/80 bg-sky-50/60 p-4">
      <div>
        <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
          <Eye className="size-4" />
          Pedidos de visibilidade
        </h2>
        <p className="text-sm text-muted-foreground">
          Histórias em colaboração pedem sua aprovação para sair do Privado.
        </p>
      </div>
      <ul className="space-y-3">
        {items.map((req) => (
          <li
            key={req.id}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{req.storyTitle}</p>
              <p className="text-xs text-muted-foreground">
                {req.requesterName} quer{" "}
                {VIS_LABEL[req.toVisibility] ?? req.toVisibility}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                className="gap-1"
                onClick={() => run(req.id, "approved")}
              >
                <Check className="size-3.5" />
                Aprovar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                className="gap-1"
                onClick={() => run(req.id, "rejected")}
              >
                <X className="size-3.5" />
                Recusar
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
