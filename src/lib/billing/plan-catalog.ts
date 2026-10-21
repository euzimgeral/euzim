/**
 * Fetch do catálogo no DB — SERVER ONLY.
 * Client Components devem importar de plan-catalog-shared.ts.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  STRIPE_PRICE_IDS,
  STRIPE_PRODUCT_IDS,
} from "@/lib/billing/stripe-price-ids";
import { readStripeTestPriceMap } from "@/lib/billing/stripe-price-map";
import {
  DEFAULT_PLAN_CATALOG,
  isPlanCatalogKey,
  type PlanCatalogKey,
  type PlanCatalogRow,
} from "@/lib/billing/plan-catalog-shared";

export type {
  PlanCatalogKey,
  PlanCatalogRow,
} from "@/lib/billing/plan-catalog-shared";
export {
  DEFAULT_PLAN_CATALOG,
  avatarPointsCost,
  formatCentsBrl,
  isPlanCatalogKey,
  storyPointsCost,
} from "@/lib/billing/plan-catalog-shared";

function rowFromDb(raw: Record<string, unknown>): PlanCatalogRow | null {
  const key = String(raw.plan_key || "");
  if (!isPlanCatalogKey(key)) return null;
  const priceCents = Number(raw.price_cents);
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null;
  const testMap = readStripeTestPriceMap();
  return {
    planKey: key,
    name: String(raw.name || ""),
    priceCents,
    priceBrl: Math.round(priceCents) / 100,
    storiesPerMonth: Number(raw.stories_per_month) || 0,
    avatarsIncluded: Number(raw.avatars_included) || 0,
    extraStoryCents: Number(raw.extra_story_cents) || 0,
    extraAvatarCents: Number(raw.extra_avatar_cents) || 0,
    giftPointsFirst: Number(raw.gift_points_first) || 0,
    giftPointsRecur: Number(raw.gift_points_recur) || 0,
    stripePriceIdLive:
      (typeof raw.stripe_price_id_live === "string" &&
        raw.stripe_price_id_live) ||
      STRIPE_PRICE_IDS[key] ||
      null,
    stripePriceIdTest:
      (typeof raw.stripe_price_id_test === "string" &&
        raw.stripe_price_id_test) ||
      testMap.prices[key] ||
      null,
    stripeProductIdLive:
      (typeof raw.stripe_product_id_live === "string" &&
        raw.stripe_product_id_live) ||
      STRIPE_PRODUCT_IDS[key] ||
      null,
    stripeProductIdTest:
      (typeof raw.stripe_product_id_test === "string" &&
        raw.stripe_product_id_test) ||
      testMap.products[key] ||
      null,
    description: String(raw.description || ""),
    sortOrder: Number(raw.sort_order) || 0,
  };
}

let cache: { at: number; rows: PlanCatalogRow[] } | null = null;
const CACHE_MS = 15_000;

export function invalidatePlanCatalogCache() {
  cache = null;
}

/** Só Server Components / server actions / route handlers. */
export async function getPlanCatalog(options?: {
  force?: boolean;
}): Promise<PlanCatalogRow[]> {
  if (!options?.force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.rows;
  }

  const db = createAdminClient() ?? (await createClient());
  if (!db) {
    cache = { at: Date.now(), rows: DEFAULT_PLAN_CATALOG };
    return DEFAULT_PLAN_CATALOG;
  }

  const { data, error } = await db
    .from("plan_catalog")
    .select(
      "plan_key, name, price_cents, stories_per_month, avatars_included, extra_story_cents, extra_avatar_cents, gift_points_first, gift_points_recur, stripe_price_id_live, stripe_price_id_test, stripe_product_id_live, stripe_product_id_test, description, sort_order",
    )
    .order("sort_order", { ascending: true });

  if (error || !data?.length) {
    cache = { at: Date.now(), rows: DEFAULT_PLAN_CATALOG };
    return DEFAULT_PLAN_CATALOG;
  }

  const byKey = new Map<PlanCatalogKey, PlanCatalogRow>();
  for (const def of DEFAULT_PLAN_CATALOG) byKey.set(def.planKey, def);
  for (const raw of data) {
    const row = rowFromDb(raw as Record<string, unknown>);
    if (row) byKey.set(row.planKey, row);
  }

  const rows = DEFAULT_PLAN_CATALOG.map(
    (d) => byKey.get(d.planKey) ?? d,
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  cache = { at: Date.now(), rows };
  return rows;
}

export async function getPlanCatalogRow(
  planKey: string,
): Promise<PlanCatalogRow | null> {
  if (!isPlanCatalogKey(planKey)) return null;
  const rows = await getPlanCatalog();
  return rows.find((r) => r.planKey === planKey) ?? null;
}
