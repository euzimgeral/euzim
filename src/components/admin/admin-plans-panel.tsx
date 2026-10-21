"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  savePlanCatalogAction,
  type PlanCatalogDraft,
} from "@/lib/admin/plans-actions";
import {
  formatCentsBrl,
  type PlanCatalogRow,
} from "@/lib/billing/plan-catalog-shared";

function draftFromRow(row: PlanCatalogRow): PlanCatalogDraft {
  return {
    planKey: row.planKey,
    name: row.name,
    description: row.description,
    priceBrl: row.priceBrl,
    storiesPerMonth: row.storiesPerMonth,
    avatarsIncluded: row.avatarsIncluded,
    extraStoryBrl: row.extraStoryCents / 100,
    extraAvatarBrl: row.extraAvatarCents / 100,
    giftPointsFirst: row.giftPointsFirst,
    giftPointsRecur: row.giftPointsRecur,
  };
}

export function AdminPlansPanel({
  initialPlans,
}: {
  initialPlans: PlanCatalogRow[];
}) {
  const [drafts, setDrafts] = useState<PlanCatalogDraft[]>(
    () => initialPlans.map(draftFromRow),
  );
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(planKey: string, partial: Partial<PlanCatalogDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.planKey === planKey ? { ...d, ...partial } : d)),
    );
  }

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await savePlanCatalogAction(drafts);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.plans) {
        setDrafts(res.plans.map(draftFromRow));
      }
      setMessage(res.message || "Planos salvos.");
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">
            Planos
          </h2>
          <p className="text-sm text-muted-foreground">
            Edite os 3 planos e salve para sincronizar app, landing e Stripe
            live+test. Assinantes atuais mantêm o preço antigo.
          </p>
        </div>
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? "Salvando…" : "Salvar planos"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {drafts.map((d) => (
          <article
            key={d.planKey}
            className="space-y-3 rounded-xl border border-border/70 bg-background/80 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {d.planKey}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCentsBrl(Math.round(d.priceBrl * 100))}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={d.name}
                onChange={(e) => patch(d.planKey, { name: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descrição (landing)</Label>
              <textarea
                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={d.description}
                maxLength={400}
                onChange={(e) =>
                  patch(d.planKey, { description: e.target.value })
                }
                placeholder="Texto destacado no card da landing"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Preço (R$)</Label>
                <Input
                  type="number"
                  min={1}
                  step={0.01}
                  value={d.priceBrl}
                  onChange={(e) =>
                    patch(d.planKey, { priceBrl: Number(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Histórias / mês</Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={d.storiesPerMonth}
                  onChange={(e) =>
                    patch(d.planKey, {
                      storiesPerMonth: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Avatares</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={d.avatarsIncluded}
                  onChange={(e) =>
                    patch(d.planKey, {
                      avatarsIncluded: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>História extra (R$)</Label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={d.extraStoryBrl}
                  onChange={(e) =>
                    patch(d.planKey, {
                      extraStoryBrl: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Avatar extra (R$)</Label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={d.extraAvatarBrl}
                  onChange={(e) =>
                    patch(d.planKey, {
                      extraAvatarBrl: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Pontos 1º mês</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={d.giftPointsFirst}
                  onChange={(e) =>
                    patch(d.planKey, {
                      giftPointsFirst: Number(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Pontos recorrência</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={d.giftPointsRecur}
                  onChange={(e) =>
                    patch(d.planKey, {
                      giftPointsRecur: Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              1 ponto = 1 história presente · 2 pontos = 1 avatar presente
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
