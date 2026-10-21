/**
 * Transformações sync catálogo → StoryPlan (client-safe).
 * Loaders async ficam em plans-catalog-load.ts (server).
 */
import {
  DEFAULT_PLAN_CATALOG,
  type PlanCatalogRow,
} from "@/lib/billing/plan-catalog-shared";

export type StoryPlan = {
  id: string;
  planId: string;
  name: string;
  priceBrl: number;
  priceCents: number;
  interval: "month" | "one_time";
  storiesPerMonth: number;
  includedCharacters: number;
  description: string;
  kind: "subscription" | "extra_story";
  /** Price key Stripe (quando distinto de planId). */
  stripePriceKey?: string;
  /** Plano de assinatura ao qual o extra se aplica. */
  forPlanId?: string;
};

function subscriptionFromRow(row: PlanCatalogRow): StoryPlan {
  return {
    id: `${row.planKey}-monthly`,
    planId: row.planKey,
    name: row.name,
    priceBrl: row.priceBrl,
    priceCents: row.priceCents,
    interval: "month",
    storiesPerMonth: row.storiesPerMonth,
    includedCharacters: row.avatarsIncluded,
    description: row.description,
    kind: "subscription",
  };
}

function extraStoryFromRow(row: PlanCatalogRow): StoryPlan {
  return {
    id: `extra-story-${row.planKey}`,
    planId: `extra_story_${row.planKey}`,
    name: "História adicional",
    priceBrl: row.extraStoryCents / 100,
    priceCents: row.extraStoryCents,
    interval: "one_time",
    storiesPerMonth: 1,
    includedCharacters: 0,
    description: `1 história extra (assinantes ${row.name}).`,
    kind: "extra_story",
    stripePriceKey: `extra_story_${row.planKey}`,
    forPlanId: row.planKey,
  };
}

/** Monta planos de assinatura a partir do catálogo (sync, com defaults). */
export function subscriptionPlansFromCatalog(
  rows: PlanCatalogRow[] = DEFAULT_PLAN_CATALOG,
): StoryPlan[] {
  return rows.map(subscriptionFromRow);
}

export function extraStoryPlansFromCatalog(
  rows: PlanCatalogRow[] = DEFAULT_PLAN_CATALOG,
): Record<string, StoryPlan> {
  const out: Record<string, StoryPlan> = {};
  for (const row of rows) {
    out[row.planKey] = extraStoryFromRow(row);
  }
  return out;
}

export { extraStoryFromRow };
