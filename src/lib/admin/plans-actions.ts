"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { syncPlansToStripe } from "@/lib/admin/sync-plan-stripe";
import {
  getPlanCatalog,
  invalidatePlanCatalogCache,
} from "@/lib/billing/plan-catalog";
import {
  isPlanCatalogKey,
  type PlanCatalogKey,
  type PlanCatalogRow,
} from "@/lib/billing/plan-catalog-shared";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlanCatalogDraft = {
  planKey: PlanCatalogKey;
  name: string;
  description: string;
  priceBrl: number;
  storiesPerMonth: number;
  avatarsIncluded: number;
  extraStoryBrl: number;
  extraAvatarBrl: number;
  giftPointsFirst: number;
  giftPointsRecur: number;
};

function toCents(brl: number): number | null {
  if (!Number.isFinite(brl) || brl <= 0) return null;
  return Math.round(brl * 100);
}

function validateDraft(d: PlanCatalogDraft): string | null {
  if (!isPlanCatalogKey(d.planKey)) return "Plano inválido.";
  if (!d.name.trim()) return `Nome obrigatório (${d.planKey}).`;
  if (!d.description.trim()) {
    return `Descrição obrigatória (${d.planKey}).`;
  }
  if (d.description.trim().length > 400) {
    return `Descrição muito longa (${d.planKey}, máx. 400).`;
  }
  if (toCents(d.priceBrl) == null) return `Preço inválido (${d.planKey}).`;
  if (!Number.isInteger(d.storiesPerMonth) || d.storiesPerMonth < 1) {
    return `Histórias/mês inválidas (${d.planKey}).`;
  }
  if (!Number.isInteger(d.avatarsIncluded) || d.avatarsIncluded < 0) {
    return `Avatares inválidos (${d.planKey}).`;
  }
  if (toCents(d.extraStoryBrl) == null) {
    return `Preço história extra inválido (${d.planKey}).`;
  }
  if (toCents(d.extraAvatarBrl) == null) {
    return `Preço avatar extra inválido (${d.planKey}).`;
  }
  if (!Number.isInteger(d.giftPointsFirst) || d.giftPointsFirst < 0) {
    return `Pontos 1º mês inválidos (${d.planKey}).`;
  }
  if (!Number.isInteger(d.giftPointsRecur) || d.giftPointsRecur < 0) {
    return `Pontos recorrência inválidos (${d.planKey}).`;
  }
  return null;
}

export async function loadPlanCatalogAction(): Promise<{
  plans?: PlanCatalogRow[];
  error?: string;
}> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };
  const plans = await getPlanCatalog({ force: true });
  return { plans };
}

export async function savePlanCatalogAction(
  drafts: PlanCatalogDraft[],
): Promise<{
  error?: string;
  success?: boolean;
  message?: string;
  plans?: PlanCatalogRow[];
}> {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error };

  if (!Array.isArray(drafts) || drafts.length !== 3) {
    return { error: "Envie os 3 planos (starter, family, plus)." };
  }

  const keys = new Set(drafts.map((d) => d.planKey));
  if (
    !keys.has("starter") ||
    !keys.has("family") ||
    !keys.has("plus") ||
    keys.size !== 3
  ) {
    return { error: "Keys devem ser starter, family e plus." };
  }

  for (const d of drafts) {
    const err = validateDraft(d);
    if (err) return { error: err };
  }

  const admin = createAdminClient();
  if (!admin) return { error: "Admin indisponível." };

  const existing = await getPlanCatalog({ force: true });
  const byKey = new Map(existing.map((r) => [r.planKey, r]));

  const nextRows: PlanCatalogRow[] = drafts.map((d) => {
    const prev = byKey.get(d.planKey)!;
    return {
      ...prev,
      planKey: d.planKey,
      name: d.name.trim().slice(0, 120),
      priceCents: toCents(d.priceBrl)!,
      priceBrl: toCents(d.priceBrl)! / 100,
      storiesPerMonth: d.storiesPerMonth,
      avatarsIncluded: d.avatarsIncluded,
      extraStoryCents: toCents(d.extraStoryBrl)!,
      extraAvatarCents: toCents(d.extraAvatarBrl)!,
      giftPointsFirst: d.giftPointsFirst,
      giftPointsRecur: d.giftPointsRecur,
      description: d.description.trim().slice(0, 400),
    };
  });

  for (const row of nextRows) {
    const { error } = await admin.from("plan_catalog").upsert(
      {
        plan_key: row.planKey,
        name: row.name,
        price_cents: row.priceCents,
        stories_per_month: row.storiesPerMonth,
        avatars_included: row.avatarsIncluded,
        extra_story_cents: row.extraStoryCents,
        extra_avatar_cents: row.extraAvatarCents,
        gift_points_first: row.giftPointsFirst,
        gift_points_recur: row.giftPointsRecur,
        description: row.description,
        sort_order: row.sortOrder,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "plan_key" },
    );
    if (error) return { error: error.message };
  }

  // Sync Stripe live+test (grandfathering via novo Price se valor mudou)
  const sync = await syncPlansToStripe(nextRows);
  if (sync.error) {
    return {
      error: `Catálogo salvo, mas Stripe falhou: ${sync.error}`,
    };
  }

  for (const r of sync.results) {
    const { error } = await admin
      .from("plan_catalog")
      .update({
        stripe_price_id_live: r.livePriceId,
        stripe_product_id_live: r.liveProductId,
        stripe_price_id_test: r.testPriceId,
        stripe_product_id_test: r.testProductId,
        updated_at: new Date().toISOString(),
      })
      .eq("plan_key", r.planKey);
    if (error) return { error: error.message };
  }

  // Alinha subscription_limits com cota do catálogo
  for (const row of nextRows) {
    await admin.from("subscription_limits").upsert(
      {
        plan_id: row.planKey,
        plan_name: row.name,
        max_stories_per_month: row.storiesPerMonth,
        max_characters: row.avatarsIncluded,
        is_active: true,
      },
      { onConflict: "plan_id" },
    );
  }

  invalidatePlanCatalogCache();
  const plans = await getPlanCatalog({ force: true });

  const created = sync.results.filter(
    (r) => r.livePriceCreated || r.testPriceCreated,
  ).length;

  revalidatePath("/app/admin");
  revalidatePath("/");
  revalidatePath("/app/parent");
  revalidatePath("/app/parent/billing");
  revalidatePath("/onboarding");

  return {
    success: true,
    plans,
    message:
      created > 0
        ? `Planos salvos. ${created} preço(s) Stripe novo(s) (assinantes antigos mantêm o Price anterior).`
        : "Planos salvos e sincronizados com Stripe live+test.",
  };
}
