"use server";

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  EXTRA_STORY_PLUS,
  FAMILY_SUBSCRIPTION,
  customAvatarPriceCents,
  packPriceCents,
  resolveCharacterPack,
  resolveStoryPlan,
  resolveSubscriptionPlan,
  type StoryPlan,
} from "@/lib/billing/plans";
import {
  extraStoryForPlanAsync,
  resolveSubscriptionPlanAsync,
} from "@/lib/billing/plans-catalog-load";
import {
  resolveStripePriceId,
  type StripePriceKey,
} from "@/lib/billing/stripe-price-ids";
import { formatBrl, priceForAvatarCount } from "@/lib/billing/character-packs";
import {
  describeStripeKeyIssue,
  isStripeCheckoutReady,
  isStripeSecretValid,
  stripeMissingKeys,
} from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";
import { ensureStripeCustomer } from "@/lib/stripe/customers";
import { mockFulfillCheckout } from "@/lib/stripe/fulfillment";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CheckoutActionResult = {
  error?: string;
  url?: string;
  /** Stripe Embedded Checkout */
  clientSecret?: string;
  sessionId?: string;
  planId?: string;
  kind?: string;
  mock?: boolean;
  missingKeys?: string[];
  keyIssue?: string | null;
  gated?: boolean;
};

async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "http";
  if (host) return `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:5050";
}

function gateSecret(): CheckoutActionResult | null {
  if (isStripeCheckoutReady()) return null;
  const missing = stripeMissingKeys();
  const keyIssue = describeStripeKeyIssue();
  return {
    error:
      keyIssue ||
      "Checkout bloqueado: configure STRIPE_SECRET_KEY e NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.",
    missingKeys: missing,
    keyIssue,
    gated: true,
  };
}

function planPriceId(plan: StoryPlan): string | null {
  if (plan.kind === "extra_story") {
    const key = (plan.stripePriceKey || plan.planId) as StripePriceKey;
    return resolveStripePriceId(key);
  }
  if (plan.planId === "starter") return resolveStripePriceId("starter");
  if (plan.planId === "family") return resolveStripePriceId("family");
  if (plan.planId === "plus") return resolveStripePriceId("plus");
  return null;
}

async function readUserSubscriptionPlanId(
  userId: string,
): Promise<string | null> {
  const db = createAdminClient() ?? (await createClient());
  if (!db) return null;
  const { data } = await db
    .from("users")
    .select("subscription_plan_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.subscription_plan_id ?? null;
}

export type SubscriptionCheckoutOptions = {
  /** Retoma onboarding após Stripe (fotos já salvas). */
  resumeOnboarding?: boolean;
};

async function createSubscriptionCheckout(
  plan: StoryPlan,
  options: SubscriptionCheckoutOptions = {},
): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login para assinar." };

  const gated = gateSecret();
  if (gated) return gated;

  const stripe = getStripe();
  if (!stripe) return { error: "Cliente Stripe indisponível." };

  const { customerId, error: customerError } = await ensureStripeCustomer({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
  });
  if (!customerId) {
    return { error: customerError || "Não foi possível criar customer Stripe." };
  }

  const origin = await appOrigin();
  const priceId = planPriceId(plan);
  const resume = Boolean(options.resumeOnboarding);

  try {
    const returnUrl = `${origin}/app/parent/billing/success?session_id={CHECKOUT_SESSION_ID}&kind=subscription&plan_id=${plan.planId}${resume ? "&resume_onboarding=1&wizard_step=generating" : ""}`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ui_mode: "embedded",
      customer: customerId,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        kind: "subscription",
        plan_id: plan.planId,
        ...(resume
          ? { resume_onboarding: "1", wizard_step: "generating" }
          : {}),
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan_id: plan.planId,
        },
      },
      line_items: [
        priceId
          ? { quantity: 1, price: priceId }
          : {
              quantity: 1,
              price_data: {
                currency: "brl",
                unit_amount: plan.priceCents,
                recurring: { interval: "month" },
                product_data: {
                  name: plan.name,
                  description: plan.description,
                },
              },
            },
      ],
      return_url: returnUrl,
      locale: "pt-BR",
    });

    if (!session.client_secret) {
      return { error: "Checkout embutido sem client_secret." };
    }
    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
      planId: plan.planId,
      kind: "subscription",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha no Checkout.";
    return { error: message, missingKeys: stripeMissingKeys() };
  }
}

/** @deprecated use startPlanCheckoutAction('family') */
export async function startSubscriptionCheckoutAction(): Promise<CheckoutActionResult> {
  return createSubscriptionCheckout(FAMILY_SUBSCRIPTION);
}

export async function startPlanCheckoutAction(
  planId: string,
  options: SubscriptionCheckoutOptions = {},
): Promise<CheckoutActionResult> {
  const live = await resolveSubscriptionPlanAsync(planId);
  const plan = live ?? resolveStoryPlan(planId);
  if (!plan) return { error: "Plano inválido." };
  if (plan.kind === "extra_story") {
    return startExtraStoryCheckoutAction();
  }
  if (!resolveSubscriptionPlan(plan.planId) && !live) {
    return { error: "Plano de assinatura inválido." };
  }
  return createSubscriptionCheckout(plan, options);
}

export async function startExtraStoryCheckoutAction(): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };

  const activePlanId = await readUserSubscriptionPlanId(user.id);
  const plan = await extraStoryForPlanAsync(activePlanId);
  const priceKey = (plan.stripePriceKey || plan.planId) as StripePriceKey;

  const gated = gateSecret();
  if (gated) {
    return {
      ...gated,
      error: `${gated.error} Produto: ${plan.name} (${formatBrl(plan.priceBrl)}).`,
    };
  }

  const stripe = getStripe();
  if (!stripe) return { error: "Cliente Stripe indisponível." };

  const { customerId, error: customerError } = await ensureStripeCustomer({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
  });
  if (!customerId) {
    return { error: customerError || "Não foi possível criar customer Stripe." };
  }

  const origin = await appOrigin();
  const priceId = resolveStripePriceId(priceKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      customer: customerId,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        kind: "extra_story",
        plan_id: plan.planId,
        for_plan: plan.forPlanId || activePlanId || EXTRA_STORY_PLUS.forPlanId || "plus",
        stories: "1",
        price_brl: String(plan.priceBrl),
      },
      line_items: [{ quantity: 1, price: priceId }],
      return_url: `${origin}/app/parent/billing/success?session_id={CHECKOUT_SESSION_ID}&kind=extra_story`,
      locale: "pt-BR",
    });
    if (!session.client_secret) {
      return { error: "Checkout embutido sem client_secret." };
    }
    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
      planId: plan.planId,
      kind: "extra_story",
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Falha no Checkout.",
    };
  }
}

export async function startCharacterPackCheckoutAction(
  packId: string,
): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login para comprar personagens." };

  const pack = resolveCharacterPack(packId);
  const cents = packPriceCents(packId);
  if (!pack || cents == null) return { error: "Pacote inválido." };

  const gated = gateSecret();
  if (gated) {
    return {
      ...gated,
      error: `${gated.error} Pacote ${pack.name} (${formatBrl(pack.priceBrl)}).`,
    };
  }

  const stripe = getStripe();
  if (!stripe) return { error: "Cliente Stripe indisponível." };

  const { customerId, error: customerError } = await ensureStripeCustomer({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
  });
  if (!customerId) {
    return { error: customerError || "Não foi possível criar customer Stripe." };
  }

  const origin = await appOrigin();
  const priceKey = pack.id as StripePriceKey;
  const priceId = resolveStripePriceId(priceKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      customer: customerId,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        kind: "character_pack",
        pack_id: pack.id,
        characters: String(pack.characters),
      },
      line_items: priceId
        ? [{ quantity: 1, price: priceId }]
        : [
            {
              quantity: 1,
              price_data: {
                currency: "brl",
                unit_amount: cents,
                product_data: {
                  name: `Euzim - ${pack.name}`,
                  description: pack.description,
                },
              },
            },
          ],
      return_url: `${origin}/app/parent/billing/success?session_id={CHECKOUT_SESSION_ID}&kind=character_pack&pack_id=${pack.id}`,
      locale: "pt-BR",
    });

    if (!session.client_secret) {
      return { error: "Checkout embutido sem client_secret." };
    }
    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
      planId: pack.id,
      kind: "character_pack",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha no Checkout.";
    return { error: message, missingKeys: stripeMissingKeys() };
  }
}

/** Compra custom 6–15 avatares a R$ 9,90 cada (price unitário × quantity). */
export async function startCustomAvatarsCheckoutAction(
  count: number,
): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };

  const brl = priceForAvatarCount(count);
  const cents = customAvatarPriceCents(count);
  if (brl == null || cents == null || count < 6) {
    return { error: "Quantidade inválida para preço unitário (use 6–15)." };
  }

  const gated = gateSecret();
  if (gated) {
    return {
      ...gated,
      error: `${gated.error} ${count} avatares · ${formatBrl(brl)}.`,
    };
  }

  const stripe = getStripe();
  if (!stripe) return { error: "Cliente Stripe indisponível." };

  const { customerId, error: customerError } = await ensureStripeCustomer({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
  });
  if (!customerId) {
    return { error: customerError || "Customer Stripe falhou." };
  }

  const origin = await appOrigin();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      customer: customerId,
      client_reference_id: user.id,
      metadata: {
        supabase_user_id: user.id,
        kind: "custom_avatars",
        characters: String(count),
      },
      line_items: [
        {
          quantity: count,
          price: resolveStripePriceId("avatar_unit"),
        },
      ],
      return_url: `${origin}/app/parent/billing/success?session_id={CHECKOUT_SESSION_ID}&kind=custom_avatars&count=${count}`,
      locale: "pt-BR",
    });
    if (!session.client_secret) {
      return { error: "Checkout embutido sem client_secret." };
    }
    return {
      clientSecret: session.client_secret,
      sessionId: session.id,
      planId: `custom_${count}`,
      kind: "custom_avatars",
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Falha no Checkout.",
    };
  }
}

/** Abre o Stripe Customer Portal (cancelar / gerenciar assinatura). */
export async function startBillingPortalAction(): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login para gerenciar a assinatura." };

  const gated = gateSecret();
  if (gated) return gated;

  const stripe = getStripe();
  if (!stripe) return { error: "Cliente Stripe indisponível." };

  const { customerId, error: customerError } = await ensureStripeCustomer({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
  });
  if (!customerId) {
    return { error: customerError || "Customer Stripe não encontrado." };
  }

  const origin = await appOrigin();

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/app/parent/settings`,
    });
    if (!session.url) return { error: "Portal Stripe sem URL." };
    return { url: session.url };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Falha ao abrir o portal Stripe.";
    return { error: message };
  }
}

export async function mockActivateSubscriptionAction(
  planId: string = FAMILY_SUBSCRIPTION.planId,
): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  if (isStripeSecretValid()) {
    return {
      error:
        "Checkout real está ativo — use Assinar (Stripe). Simulação desligada.",
    };
  }
  const result = await mockFulfillCheckout({
    userId: user.id,
    kind: "subscription",
    planId,
  });
  if (!result.ok) return { error: result.error };
  return { mock: true };
}

export async function mockActivatePackAction(
  packId: string,
): Promise<CheckoutActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  if (isStripeSecretValid()) {
    return {
      error: "Checkout real está ativo — use Comprar com Stripe.",
    };
  }
  const result = await mockFulfillCheckout({
    userId: user.id,
    kind: "character_pack",
    packId,
  });
  if (!result.ok) return { error: result.error };
  return { mock: true };
}
