import { createAdminClient } from "@/lib/supabase/admin";
import {
  giftOptionsForPlan,
  type GiftOption,
  type GiftOptionId,
} from "@/lib/referral/constants";
import { creditReferralPointsOnFirstSubscription } from "@/lib/referral/points";

export type ReferralRewardRow = {
  id: string;
  referrer_id: string;
  referee_id: string;
  plan_id: string;
  status: "pending_choice" | "claimed" | "void";
  options: GiftOption[];
  chosen: GiftOption | null;
  created_at: string;
};

/**
 * Após 1ª assinatura paga do indicado: credita pontos ao indicador
 * (1pt=história / 2pt=avatar). Mantém claim legado para rewards pending.
 */
export async function grantReferralRewardOnFirstSubscription(input: {
  refereeId: string;
  planId: string;
}): Promise<{ ok: boolean; created?: boolean; error?: string }> {
  return creditReferralPointsOnFirstSubscription(input);
}

export async function listPendingRewardsForUser(
  referrerId: string,
): Promise<ReferralRewardRow[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const { data } = await admin
    .from("referral_rewards")
    .select("id, referrer_id, referee_id, plan_id, status, options, chosen, created_at")
    .eq("referrer_id", referrerId)
    .eq("status", "pending_choice")
    .order("created_at", { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    referrer_id: row.referrer_id as string,
    referee_id: row.referee_id as string,
    plan_id: row.plan_id as string,
    status: row.status as ReferralRewardRow["status"],
    options: Array.isArray(row.options) ? (row.options as GiftOption[]) : [],
    chosen: (row.chosen as GiftOption | null) ?? null,
    created_at: row.created_at as string,
  }));
}

export async function claimReferralReward(input: {
  referrerId: string;
  rewardId: string;
  optionId: GiftOptionId;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Admin indisponível." };

  const { data: reward } = await admin
    .from("referral_rewards")
    .select("id, referrer_id, plan_id, status, options")
    .eq("id", input.rewardId)
    .maybeSingle();

  if (!reward) return { ok: false, error: "Presente não encontrado." };
  if (reward.referrer_id !== input.referrerId) {
    return { ok: false, error: "Este presente não é seu." };
  }
  if (reward.status !== "pending_choice") {
    return { ok: false, error: "Este presente já foi escolhido." };
  }

  const options = Array.isArray(reward.options)
    ? (reward.options as GiftOption[])
    : giftOptionsForPlan(String(reward.plan_id));
  const chosen = options.find((o) => o.id === input.optionId);
  if (!chosen) return { ok: false, error: "Opção inválida." };

  const { data: profile } = await admin
    .from("users")
    .select("extra_stories_available, extra_characters_available")
    .eq("id", input.referrerId)
    .maybeSingle();

  const prevStories =
    typeof profile?.extra_stories_available === "number"
      ? profile.extra_stories_available
      : 0;
  const prevAvatars =
    typeof profile?.extra_characters_available === "number"
      ? profile.extra_characters_available
      : 0;

  const { error: creditError } = await admin
    .from("users")
    .update({
      extra_stories_available: prevStories + chosen.stories,
      extra_characters_available: prevAvatars + chosen.avatars,
    })
    .eq("id", input.referrerId);

  if (creditError) return { ok: false, error: creditError.message };

  const { error: claimError } = await admin
    .from("referral_rewards")
    .update({
      status: "claimed",
      chosen,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", input.rewardId)
    .eq("status", "pending_choice");

  if (claimError) return { ok: false, error: claimError.message };

  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", input.referrerId)
    .eq("kind", "referral_gift_pending")
    .is("read_at", null);

  return { ok: true };
}
