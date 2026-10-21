import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getStripeWebhookSecret,
  getStripeMode,
  isStripeSecretValid,
  isStripeWebhookConfigured,
  describeStripeKeyIssue,
  stripeModeLabel,
} from "@/lib/stripe/config";
import { getStripe } from "@/lib/stripe/client";
import {
  fulfillCharacterPack,
  fulfillExtraStory,
  fulfillSubscription,
} from "@/lib/stripe/fulfillment";
import { subscriptionPeriodEndIso } from "@/lib/stripe/subscription-period";
import { grantReferralRewardOnFirstSubscription } from "@/lib/referral/rewards";
import { creditReferralPointsOnRenewal } from "@/lib/referral/points";
import { fireTrackingEvent } from "@/lib/tracking/dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  customAvatarPriceCents,
  extraStoryForPlan,
  resolveCharacterPack,
  resolveStoryPlan,
} from "@/lib/billing/plans";

async function trackPurchaseFromSession(session: Stripe.Checkout.Session) {
  if (session.payment_status && session.payment_status !== "paid") return;

  const userId =
    session.metadata?.supabase_user_id || session.client_reference_id || null;
  if (!userId) return;

  const kind = session.metadata?.kind;
  let product = "Euzim";
  let planId = session.metadata?.plan_id || null;
  let value =
    typeof session.amount_total === "number"
      ? session.amount_total / 100
      : null;

  if (kind === "subscription" || session.mode === "subscription") {
    const plan = resolveStoryPlan(planId || "family");
    if (plan) {
      product = plan.name;
      planId = plan.planId;
      value = value ?? plan.priceBrl;
    }
  } else if (kind === "extra_story") {
    const extra = resolveStoryPlan(planId || "") ||
      extraStoryForPlan(session.metadata?.for_plan);
    product = extra.name;
    planId = extra.planId;
    value = value ?? extra.priceBrl;
  } else if (kind === "character_pack") {
    const pack = resolveCharacterPack(session.metadata?.pack_id || "");
    if (pack) {
      product = pack.name;
      planId = pack.id;
      value = value ?? pack.priceBrl;
    }
  } else if (kind === "custom_avatars") {
    const count = Number.parseInt(session.metadata?.characters || "0", 10);
    product = `${count} avatares`;
    planId = `custom_${count}`;
    const cents = customAvatarPriceCents(count);
    value = value ?? (cents != null ? cents / 100 : null);
  }

  let email =
    session.customer_details?.email ||
    session.customer_email ||
    null;
  let fullName = session.customer_details?.name || null;
  let phone = session.customer_details?.phone || null;

  const admin = createAdminClient();
  if (admin) {
    const { data } = await admin
      .from("users")
      .select("email, full_name, phone")
      .eq("id", userId)
      .maybeSingle();
    if (data) {
      email = email || data.email;
      fullName = fullName || data.full_name;
      phone = phone || data.phone;
    }
  }

  fireTrackingEvent({
    event: "Purchase",
    eventId: `purchase_${session.id}`,
    user: { userId, email, fullName, phone },
    commerce: {
      product,
      planId,
      value,
      currency: (session.currency || "brl").toUpperCase(),
      stripeSessionId: session.id,
      contents: planId
        ? [{ id: planId, quantity: 1, item_price: value ?? undefined }]
        : undefined,
    },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId =
    session.metadata?.supabase_user_id || session.client_reference_id || null;
  if (!userId) return { skipped: true, reason: "missing user id" };

  const kind = session.metadata?.kind;
  if (kind === "subscription" || session.mode === "subscription") {
    const planId = session.metadata?.plan_id || "family";
    let stripeSubscriptionId: string | null = null;
    let stripeCurrentPeriodEnd: string | null = null;
    const subRef = session.subscription;
    const subId =
      typeof subRef === "string" ? subRef : subRef?.id ?? null;
    if (subId) {
      stripeSubscriptionId = subId;
      try {
        const stripe = getStripe();
        if (stripe) {
          const sub = await stripe.subscriptions.retrieve(subId);
          stripeCurrentPeriodEnd = subscriptionPeriodEndIso(sub);
        }
      } catch {
        /* best-effort */
      }
    }
    const result = await fulfillSubscription(userId, planId, {
      stripeSubscriptionId,
      stripeCurrentPeriodEnd,
    });
    // Só 1ª assinatura (idempotente via referral_rewarded_at / unique referee)
    const referral = result.ok
      ? await grantReferralRewardOnFirstSubscription({
          refereeId: userId,
          planId,
        })
      : { ok: false, skipped: true };
    if (result.ok) await trackPurchaseFromSession(session);
    return { ...result, referral };
  }
  if (kind === "extra_story") {
    const result = await fulfillExtraStory(userId);
    if (result.ok) await trackPurchaseFromSession(session);
    return result;
  }
  if (kind === "custom_avatars") {
    const count = Number.parseInt(session.metadata?.characters || "0", 10);
    if (!count) return { ok: false, error: "characters ausente" };
    const result = await fulfillCharacterPack(userId, "custom", count);
    if (result.ok) await trackPurchaseFromSession(session);
    return result;
  }
  if (kind === "character_pack") {
    const packId = session.metadata?.pack_id;
    if (!packId) return { ok: false, error: "pack_id ausente" };
    const result = await fulfillCharacterPack(userId, packId);
    if (result.ok) await trackPurchaseFromSession(session);
    return result;
  }
  return { skipped: true, reason: "unknown kind" };
}

/**
 * Renovação (subscription_cycle): credita gift_points_recur ao indicador.
 * Ignora subscription_create (já coberto no checkout / first).
 */
async function handleInvoicePaidReferral(invoice: Stripe.Invoice) {
  const reason = invoice.billing_reason;
  if (reason !== "subscription_cycle") {
    return { skipped: true, reason: reason || "not_cycle" };
  }

  const parentSub = invoice.parent?.subscription_details?.subscription;
  const subId =
    typeof parentSub === "string"
      ? parentSub
      : parentSub && typeof parentSub === "object" && "id" in parentSub
        ? String((parentSub as { id: string }).id)
        : null;
  if (!subId || !invoice.id) {
    return { skipped: true, reason: "missing subscription/invoice" };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin indisponível." };

  const { data: profile } = await admin
    .from("users")
    .select("id, subscription_plan_id, referred_by")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();

  if (!profile?.id || !profile.referred_by) {
    return { skipped: true, reason: "no referrer" };
  }

  const planId =
    (typeof profile.subscription_plan_id === "string" &&
      profile.subscription_plan_id) ||
    "family";

  return creditReferralPointsOnRenewal({
    refereeId: profile.id,
    planId,
    invoiceId: invoice.id,
  });
}

export async function POST(request: Request) {
  if (!isStripeSecretValid()) {
    return NextResponse.json(
      {
        error: "Stripe secret inválida",
        detail: describeStripeKeyIssue(),
        ready: false,
      },
      { status: 503 },
    );
  }

  if (!isStripeWebhookConfigured()) {
    return NextResponse.json(
      {
        error:
          getStripeMode() === "test"
            ? "STRIPE_WEBHOOK_SECRET_TEST ausente ou inválido (whsec_…)"
            : "STRIPE_WEBHOOK_SECRET ausente ou inválido (whsec_…)",
        ready: false,
        mode: getStripeMode(),
        hint:
          getStripeMode() === "test"
            ? "Local: stripe listen --forward-to localhost:5050/api/stripe/webhook e cole whsec_ em STRIPE_WEBHOOK_SECRET_TEST. Ver docs/stripe-listen-local.md"
            : "Configure o endpoint /api/stripe/webhook no Dashboard Stripe e cole o signing secret.",
      },
      { status: 503 },
    );
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe client null" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getStripeWebhookSecret(),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const result = await handleCheckoutCompleted(session);
        return NextResponse.json({ received: true, result });
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const referral = await handleInvoicePaidReferral(invoice);
        return NextResponse.json({ received: true, referral });
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // Status sync leve — expandível
        return NextResponse.json({ received: true, noted: event.type });
      }
      default:
        return NextResponse.json({ received: true, ignored: event.type });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "handler error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/stripe/webhook",
    mode: getStripeMode(),
    label: stripeModeLabel(),
    secretConfigured: isStripeWebhookConfigured(),
    stripeSecretValid: isStripeSecretValid(),
    keyIssue: describeStripeKeyIssue(),
  });
}
