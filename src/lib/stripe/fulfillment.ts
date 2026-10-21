import { createAdminClient } from "@/lib/supabase/admin";
import {
  FAMILY_SUBSCRIPTION,
  resolveCharacterPack,
  resolveStoryPlan,
} from "@/lib/billing/plans";
import { resolveSubscriptionPlanAsync } from "@/lib/billing/plans-catalog-load";
import {
  planSourceFromStripeMode,
  type PlanSource,
} from "@/lib/billing/plan-source";
import { getStripeMode } from "@/lib/stripe/config";

export type FulfillmentResult = {
  ok: boolean;
  error?: string;
  mock?: boolean;
};

export type FulfillSubscriptionOptions = {
  /** Override; default deriva do modo Stripe do processo. */
  planSource?: PlanSource;
  stripeSubscriptionId?: string | null;
  stripeCurrentPeriodEnd?: string | null;
};

/** Ativa assinatura (starter/family/plus) no perfil Supabase. */
export async function fulfillSubscription(
  userId: string,
  planId: string = FAMILY_SUBSCRIPTION.planId,
  options: FulfillSubscriptionOptions = {},
): Promise<FulfillmentResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin Supabase indisponível." };

  const plan =
    (await resolveSubscriptionPlanAsync(planId)) ??
    resolveStoryPlan(planId) ??
    FAMILY_SUBSCRIPTION;
  const maxChildren =
    plan.planId === "starter" ? 2 : plan.planId === "plus" ? 6 : 4;
  const planSource =
    options.planSource ?? planSourceFromStripeMode(getStripeMode());

  const patch: Record<string, unknown> = {
    subscription_status: "active",
    subscription_plan_id: plan.planId,
    plan_source: planSource,
  };
  if (options.stripeSubscriptionId != null) {
    patch.stripe_subscription_id = options.stripeSubscriptionId || null;
  }
  if (options.stripeCurrentPeriodEnd != null) {
    patch.stripe_current_period_end = options.stripeCurrentPeriodEnd || null;
  }

  const { error } = await admin.from("users").update(patch).eq("id", userId);

  if (error) return { ok: false, error: error.message };

  await admin.from("subscription_limits").upsert(
    {
      plan_id: plan.planId,
      plan_name: plan.name,
      max_children: maxChildren,
      max_stories_per_month: plan.storiesPerMonth,
      max_characters: plan.includedCharacters,
      max_images_per_story: 8,
      features: { share: true, lora: true, stripe: true },
      is_active: true,
    },
    { onConflict: "plan_id" },
  );

  return { ok: true };
}

/** Credita 1 história extra (one-shot) — bump em extra_stories_available se existir. */
export async function fulfillExtraStory(userId: string): Promise<FulfillmentResult> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin Supabase indisponível." };

  const { data: current } = await admin
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (!current) return { ok: false, error: "Usuário não encontrado." };

  const prev =
    typeof (current as { extra_stories_available?: number }).extra_stories_available ===
    "number"
      ? (current as { extra_stories_available: number }).extra_stories_available
      : 0;

  const { error } = await admin
    .from("users")
    .update({
      extra_stories_available: prev + 1,
    } as Record<string, unknown>)
    .eq("id", userId);

  if (error) {
    // Coluna pode não existir — registra em features de um row auxiliar
    if (error.message.includes("extra_stories_available")) {
      await admin.from("subscription_limits").upsert(
        {
          plan_id: `extra_stories:${userId}`,
          plan_name: `Extra stories ${userId.slice(0, 8)}`,
          max_children: 1,
          max_stories_per_month: 1,
          max_characters: 0,
          max_images_per_story: 8,
          features: {
            user_id: userId,
            extra_stories_available: prev + 1,
          },
          is_active: true,
        },
        { onConflict: "plan_id" },
      );
      return { ok: true, mock: true };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function fulfillCharacterPack(
  userId: string,
  packId: string,
  charactersOverride?: number,
): Promise<FulfillmentResult> {
  const pack = resolveCharacterPack(packId);
  const add = charactersOverride ?? pack?.characters;
  if (add == null || add <= 0) return { ok: false, error: "Pacote inválido." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin Supabase indisponível." };

  const { data: profile } = await admin
    .from("users")
    .select("id, subscription_plan_id")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) return { ok: false, error: "Usuário não encontrado." };

  const { data: current } = await admin
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  const prev =
    typeof (current as { extra_characters_available?: number } | null)
      ?.extra_characters_available === "number"
      ? (current as { extra_characters_available: number }).extra_characters_available
      : 0;

  const next = prev + add;

  const { error } = await admin
    .from("users")
    .update({
      extra_characters_available: next,
      subscription_plan_id:
        profile.subscription_plan_id || FAMILY_SUBSCRIPTION.planId,
    } as Record<string, unknown>)
    .eq("id", userId);

  if (error) {
    if (error.message.includes("extra_characters_available")) {
      await admin.from("subscription_limits").upsert(
        {
          plan_id: `extras:${userId}`,
          plan_name: `Extras ${userId.slice(0, 8)}`,
          max_children: 1,
          max_stories_per_month: FAMILY_SUBSCRIPTION.storiesPerMonth,
          max_characters: FAMILY_SUBSCRIPTION.includedCharacters + next,
          max_images_per_story: 8,
          features: {
            user_id: userId,
            extra_characters_available: next,
            last_pack_id: packId,
          },
          is_active: true,
        },
        { onConflict: "plan_id" },
      );
      return { ok: true, mock: true };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

export async function mockFulfillCheckout(input: {
  userId: string;
  kind: "subscription" | "character_pack" | "extra_story" | "custom_avatars";
  packId?: string;
  planId?: string;
  characters?: number;
}): Promise<FulfillmentResult> {
  if (input.kind === "subscription") {
    const result = await fulfillSubscription(
      input.userId,
      input.planId || FAMILY_SUBSCRIPTION.planId,
    );
    return { ...result, mock: true };
  }
  if (input.kind === "extra_story") {
    const result = await fulfillExtraStory(input.userId);
    return { ...result, mock: true };
  }
  if (input.kind === "custom_avatars") {
    const result = await fulfillCharacterPack(
      input.userId,
      "custom",
      input.characters ?? 1,
    );
    return { ...result, mock: true };
  }
  if (!input.packId) return { ok: false, error: "packId obrigatório." };
  const result = await fulfillCharacterPack(input.userId, input.packId);
  return { ...result, mock: true };
}
