/**
 * Tipos + defaults do catálogo — seguro para Client Components.
 * NÃO importar supabase/server, fs ou next/headers aqui.
 */

export type PlanCatalogKey = "starter" | "family" | "plus";

export type PlanCatalogRow = {
  planKey: PlanCatalogKey;
  name: string;
  priceCents: number;
  priceBrl: number;
  storiesPerMonth: number;
  avatarsIncluded: number;
  extraStoryCents: number;
  extraAvatarCents: number;
  giftPointsFirst: number;
  giftPointsRecur: number;
  stripePriceIdLive: string | null;
  stripePriceIdTest: string | null;
  stripeProductIdLive: string | null;
  stripeProductIdTest: string | null;
  description: string;
  sortOrder: number;
};

/** Fallbacks = catálogo histórico (pré-Admin Planos). IDs live em string literal. */
export const DEFAULT_PLAN_CATALOG: PlanCatalogRow[] = [
  {
    planKey: "starter",
    name: "Para Aventureiros",
    priceCents: 2490,
    priceBrl: 24.9,
    storiesPerMonth: 2,
    avatarsIncluded: 2,
    extraStoryCents: 1190,
    extraAvatarCents: 990,
    giftPointsFirst: 2,
    giftPointsRecur: 2,
    stripePriceIdLive: "price_1URZD42RGWYUXReL1LuaJkHI",
    stripePriceIdTest: null,
    stripeProductIdLive: "prod_VSUBri2FlAVcly",
    stripeProductIdTest: null,
    description:
      "2 personagens e 2 histórias por mês para começar a aventura.",
    sortOrder: 1,
  },
  {
    planKey: "family",
    name: "Para Realizadores",
    priceCents: 4990,
    priceBrl: 49.9,
    storiesPerMonth: 5,
    avatarsIncluded: 2,
    extraStoryCents: 990,
    extraAvatarCents: 990,
    giftPointsFirst: 4,
    giftPointsRecur: 4,
    stripePriceIdLive: "price_1URZD42RGWYUXReLwWbPWFkf",
    stripePriceIdTest: null,
    stripeProductIdLive: "prod_VSUBYLdM2LhWTn",
    stripeProductIdTest: null,
    description:
      "2 avatares e 5 histórias por mês para criar com regularidade.",
    sortOrder: 2,
  },
  {
    planKey: "plus",
    name: "Para Exploradores Plus",
    priceCents: 7990,
    priceBrl: 79.9,
    storiesPerMonth: 10,
    avatarsIncluded: 2,
    extraStoryCents: 790,
    extraAvatarCents: 990,
    giftPointsFirst: 4,
    giftPointsRecur: 4,
    stripePriceIdLive: "price_1USgrd2RGWYUXReLZ2xl5DpA",
    stripePriceIdTest: null,
    stripeProductIdLive: "prod_VTe94QxabUnvqm",
    stripeProductIdTest: null,
    description: "2 avatares e 10 histórias por mês para criar sem freio.",
    sortOrder: 3,
  },
];

const POINTS_STORY = 1;
const POINTS_AVATAR = 2;

export function storyPointsCost(stories: number): number {
  return Math.max(0, Math.floor(stories)) * POINTS_STORY;
}

export function avatarPointsCost(avatars: number): number {
  return Math.max(0, Math.floor(avatars)) * POINTS_AVATAR;
}

export function isPlanCatalogKey(value: string): value is PlanCatalogKey {
  return value === "starter" || value === "family" || value === "plus";
}

export function formatCentsBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Menor preço mensal do catálogo (hero CTA / landing). */
export function cheapestPlanFromCatalog(
  rows: PlanCatalogRow[],
): PlanCatalogRow {
  if (!rows.length) return DEFAULT_PLAN_CATALOG[0]!;
  return rows.reduce((best, row) =>
    row.priceCents < best.priceCents ? row : best,
  );
}
