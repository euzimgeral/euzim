/**
 * Catálogo estático + helpers sync — seguro para Client Components.
 * Para DB vivo: importar getPlanCatalog / loadSubscriptionPlans dos módulos server.
 */
import {
  CHARACTER_PACKS,
  EXTRA_AVATAR_UNIT_BRL,
  MONTHLY_STORY_LIMIT,
  priceForAvatarCount,
} from "@/lib/billing/character-packs";
import { DEFAULT_PLAN_CATALOG } from "@/lib/billing/plan-catalog-shared";
import {
  extraStoryPlansFromCatalog,
  subscriptionPlansFromCatalog,
  type StoryPlan,
} from "@/lib/billing/plans-from-catalog";

export type { StoryPlan };

const defaultSubs = subscriptionPlansFromCatalog(DEFAULT_PLAN_CATALOG);
const defaultExtras = extraStoryPlansFromCatalog(DEFAULT_PLAN_CATALOG);

/** Fallbacks sync (client / imports estáticos). Preferir loadSubscriptionPlans no server. */
export const STARTER_SUBSCRIPTION: StoryPlan = defaultSubs[0]!;
export const FAMILY_SUBSCRIPTION: StoryPlan = defaultSubs[1]!;
export const PLUS_SUBSCRIPTION: StoryPlan = defaultSubs[2]!;

export const EXTRA_STORY_STARTER: StoryPlan = defaultExtras.starter!;
export const EXTRA_STORY_FAMILY: StoryPlan = defaultExtras.family!;
export const EXTRA_STORY_PLUS: StoryPlan = defaultExtras.plus!;

/** @deprecated alias do extra Plus — mantido para compat. */
export const EXTRA_STORY_PRODUCT: StoryPlan = {
  ...EXTRA_STORY_PLUS,
  id: "extra-story",
  planId: "extra_story",
  stripePriceKey: "extra_story",
};

export const SUBSCRIPTION_PLANS: StoryPlan[] = [
  STARTER_SUBSCRIPTION,
  FAMILY_SUBSCRIPTION,
  PLUS_SUBSCRIPTION,
];

export const EXTRA_STORY_BY_PLAN: Record<string, StoryPlan> = {
  starter: EXTRA_STORY_STARTER,
  family: EXTRA_STORY_FAMILY,
  plus: EXTRA_STORY_PLUS,
};

export const STORY_PLANS: StoryPlan[] = [
  ...SUBSCRIPTION_PLANS,
  EXTRA_STORY_STARTER,
  EXTRA_STORY_FAMILY,
  EXTRA_STORY_PLUS,
  EXTRA_STORY_PRODUCT,
];

export type CheckoutKind =
  | "subscription"
  | "character_pack"
  | "extra_story"
  | "custom_avatars";

export type CheckoutTarget =
  | { kind: "subscription"; planId?: string }
  | { kind: "character_pack"; packId: string }
  | { kind: "extra_story" }
  | { kind: "custom_avatars"; count: number };

export function resolveStoryPlan(planId: string): StoryPlan | null {
  return STORY_PLANS.find((p) => p.planId === planId || p.id === planId) ?? null;
}

export function resolveSubscriptionPlan(planId: string): StoryPlan | null {
  return (
    SUBSCRIPTION_PLANS.find((p) => p.planId === planId || p.id === planId) ??
    null
  );
}

/** Extra one-shot pelo plano de assinatura ativo (fallback: Plus / legado). */
export function extraStoryForPlan(planId: string | null | undefined): StoryPlan {
  if (planId && EXTRA_STORY_BY_PLAN[planId]) {
    return EXTRA_STORY_BY_PLAN[planId];
  }
  return EXTRA_STORY_PLUS;
}

export function resolveCharacterPack(packId: string) {
  return CHARACTER_PACKS.find((p) => p.id === packId) ?? null;
}

export function packPriceCents(packId: string): number | null {
  const pack = resolveCharacterPack(packId);
  if (!pack) return null;
  return Math.round(pack.priceBrl * 100);
}

export function customAvatarPriceCents(count: number): number | null {
  const brl = priceForAvatarCount(count);
  if (brl == null) return null;
  return Math.round(brl * 100);
}

export {
  CHARACTER_PACKS,
  EXTRA_AVATAR_UNIT_BRL,
  MONTHLY_STORY_LIMIT,
  priceForAvatarCount,
};
