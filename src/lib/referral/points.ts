import { getPlanCatalogRow } from "@/lib/billing/plan-catalog";
import {
  avatarPointsCost,
  storyPointsCost,
} from "@/lib/billing/plan-catalog-shared";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Credita pontos de indicação (idempotente por source_key).
 */
export async function creditReferralPoints(input: {
  referrerId: string;
  delta: number;
  reason: "gift_first" | "gift_recur" | "manual" | "adjust" | "redeem";
  sourceKey: string;
  planId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<{ ok: boolean; credited?: boolean; error?: string }> {
  if (input.delta === 0) return { ok: true, credited: false };
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin indisponível." };

  const { error: ledgerError } = await admin.from("referral_points_ledger").insert({
    user_id: input.referrerId,
    delta: input.delta,
    reason: input.reason,
    source_key: input.sourceKey,
    plan_id: input.planId ?? null,
    meta: input.meta ?? {},
  });

  if (ledgerError) {
    if (ledgerError.message.toLowerCase().includes("unique")) {
      return { ok: true, credited: false };
    }
    return { ok: false, error: ledgerError.message };
  }

  const { data: profile } = await admin
    .from("users")
    .select("referral_points")
    .eq("id", input.referrerId)
    .maybeSingle();

  const prev =
    typeof profile?.referral_points === "number" ? profile.referral_points : 0;

  const { error: updateError } = await admin
    .from("users")
    .update({ referral_points: Math.max(0, prev + input.delta) })
    .eq("id", input.referrerId);

  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, credited: true };
}

/**
 * 1ª assinatura do indicado → gift_points_first do plano comprado.
 */
export async function creditReferralPointsOnFirstSubscription(input: {
  refereeId: string;
  planId: string;
}): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin indisponível." };

  const catalog = await getPlanCatalogRow(input.planId);
  const points = catalog?.giftPointsFirst ?? 0;
  if (points <= 0) return { ok: true, created: false };

  const { data: referee } = await admin
    .from("users")
    .select("id, referred_by, referral_rewarded_at, full_name, email")
    .eq("id", input.refereeId)
    .maybeSingle();

  if (!referee) return { ok: false, error: "Indicado não encontrado." };
  if (!referee.referred_by) return { ok: true, created: false };
  if (referee.referral_rewarded_at) return { ok: true, created: false };

  const referrerId = referee.referred_by as string;
  const credit = await creditReferralPoints({
    referrerId,
    delta: points,
    reason: "gift_first",
    sourceKey: `first:${input.refereeId}`,
    planId: input.planId,
    meta: { referee_id: input.refereeId },
  });

  if (!credit.ok) return { ok: false, error: credit.error };

  await admin
    .from("users")
    .update({ referral_rewarded_at: new Date().toISOString() })
    .eq("id", input.refereeId)
    .is("referral_rewarded_at", null);

  if (credit.credited) {
    const refereeLabel =
      (typeof referee.full_name === "string" && referee.full_name.trim()) ||
      (typeof referee.email === "string" ? referee.email.split("@")[0] : null) ||
      "alguém";

    await admin.from("notifications").insert({
      user_id: referrerId,
      kind: "referral_gift_pending",
      title: "Você ganhou pontos de presente!",
      body: `${refereeLabel} assinou pelo seu link. Você recebeu ${points} ponto(s). Resgate em Presentes.`,
      href: "/app/parent/gifts",
      payload: { referee_id: input.refereeId, points },
    });
  }

  return { ok: true, created: Boolean(credit.credited) };
}

/**
 * Renovação do indicado → gift_points_recur (idempotente por invoice id).
 */
export async function creditReferralPointsOnRenewal(input: {
  refereeId: string;
  planId: string;
  invoiceId: string;
}): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin indisponível." };

  const catalog = await getPlanCatalogRow(input.planId);
  const points = catalog?.giftPointsRecur ?? 0;
  if (points <= 0) return { ok: true, created: false };

  const { data: referee } = await admin
    .from("users")
    .select("id, referred_by, full_name, email")
    .eq("id", input.refereeId)
    .maybeSingle();

  if (!referee?.referred_by) return { ok: true, created: false };

  const referrerId = referee.referred_by as string;
  const credit = await creditReferralPoints({
    referrerId,
    delta: points,
    reason: "gift_recur",
    sourceKey: `recur:${input.invoiceId}`,
    planId: input.planId,
    meta: { referee_id: input.refereeId, invoice_id: input.invoiceId },
  });

  if (!credit.ok) return { ok: false, error: credit.error };

  if (credit.credited) {
    await admin.from("notifications").insert({
      user_id: referrerId,
      kind: "referral_gift_pending",
      title: "Pontos de indicação (renovação)",
      body: `Um indicado renovou. Você ganhou ${points} ponto(s).`,
      href: "/app/parent/gifts",
      payload: {
        referee_id: input.refereeId,
        points,
        invoice_id: input.invoiceId,
      },
    });
  }

  return { ok: true, created: Boolean(credit.credited) };
}

export async function getReferralPointsBalance(
  userId: string,
): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const { data } = await admin
    .from("users")
    .select("referral_points")
    .eq("id", userId)
    .maybeSingle();
  return typeof data?.referral_points === "number" ? data.referral_points : 0;
}

/**
 * Resgate: 1pt = 1 história; 2pt = 1 avatar.
 */
export async function redeemReferralPoints(input: {
  userId: string;
  stories: number;
  avatars: number;
}): Promise<{ ok: boolean; error?: string; balance?: number }> {
  const stories = Math.max(0, Math.floor(input.stories));
  const avatars = Math.max(0, Math.floor(input.avatars));
  if (stories === 0 && avatars === 0) {
    return { ok: false, error: "Escolha ao menos 1 história ou 1 avatar." };
  }

  const cost = storyPointsCost(stories) + avatarPointsCost(avatars);
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin indisponível." };

  const { data: profile } = await admin
    .from("users")
    .select(
      "referral_points, extra_stories_available, extra_characters_available",
    )
    .eq("id", input.userId)
    .maybeSingle();

  const balance =
    typeof profile?.referral_points === "number" ? profile.referral_points : 0;
  if (balance < cost) {
    return {
      ok: false,
      error: `Saldo insuficiente (${balance} pts; precisa de ${cost}).`,
      balance,
    };
  }

  const sourceKey = `redeem:${Date.now()}:${stories}s:${avatars}a`;
  const { error: ledgerError } = await admin.from("referral_points_ledger").insert({
    user_id: input.userId,
    delta: -cost,
    reason: "redeem",
    source_key: sourceKey,
    meta: { stories, avatars },
  });
  if (ledgerError) return { ok: false, error: ledgerError.message };

  const prevStories =
    typeof profile?.extra_stories_available === "number"
      ? profile.extra_stories_available
      : 0;
  const prevAvatars =
    typeof profile?.extra_characters_available === "number"
      ? profile.extra_characters_available
      : 0;

  const { error: updateError } = await admin
    .from("users")
    .update({
      referral_points: balance - cost,
      extra_stories_available: prevStories + stories,
      extra_characters_available: prevAvatars + avatars,
    })
    .eq("id", input.userId);

  if (updateError) return { ok: false, error: updateError.message };
  return { ok: true, balance: balance - cost };
}
