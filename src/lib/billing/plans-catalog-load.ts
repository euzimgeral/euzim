/**
 * Loaders async do catálogo — SERVER ONLY (usa getPlanCatalog → supabase/server).
 */
import { getPlanCatalog } from "@/lib/billing/plan-catalog";
import { DEFAULT_PLAN_CATALOG } from "@/lib/billing/plan-catalog-shared";
import {
  extraStoryFromRow,
  extraStoryPlansFromCatalog,
  subscriptionPlansFromCatalog,
  type StoryPlan,
} from "@/lib/billing/plans-from-catalog";

export async function loadSubscriptionPlans(): Promise<StoryPlan[]> {
  const rows = await getPlanCatalog();
  return subscriptionPlansFromCatalog(rows);
}

export async function loadExtraStoryByPlan(): Promise<
  Record<string, StoryPlan>
> {
  const rows = await getPlanCatalog();
  return extraStoryPlansFromCatalog(rows);
}

export async function resolveSubscriptionPlanAsync(
  planId: string,
): Promise<StoryPlan | null> {
  const plans = await loadSubscriptionPlans();
  return plans.find((p) => p.planId === planId || p.id === planId) ?? null;
}

export async function extraStoryForPlanAsync(
  planId: string | null | undefined,
): Promise<StoryPlan> {
  const map = await loadExtraStoryByPlan();
  if (planId && map[planId]) return map[planId];
  return map.plus ?? extraStoryFromRow(DEFAULT_PLAN_CATALOG[2]!);
}

/** Preço unitário de avatar extra (usa family como referência; fallback 9,90). */
export async function extraAvatarUnitBrl(): Promise<number> {
  const rows = await getPlanCatalog();
  const row = rows.find((r) => r.planKey === "family") ?? rows[0];
  return row ? row.extraAvatarCents / 100 : 9.9;
}
