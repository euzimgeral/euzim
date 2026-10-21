"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/get-user";
import { ensureReferralCode } from "@/lib/referral/codes";
import {
  claimReferralReward,
  listPendingRewardsForUser,
  type ReferralRewardRow,
} from "@/lib/referral/rewards";
import type { GiftOptionId } from "@/lib/referral/constants";
import {
  getReferralPointsBalance,
  redeemReferralPoints,
} from "@/lib/referral/points";

async function absoluteOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "https";
    if (host) return `${proto}://${host}`;
  } catch {
    /* ignore */
  }
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    process.env.SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:5050"
  );
}

export async function getMyReferralShareUrlAction(): Promise<{
  error?: string;
  code?: string;
  path?: string;
  url?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  const code = await ensureReferralCode(user.id);
  if (!code) {
    return {
      error:
        "Não foi possível gerar seu código. Confira se a migration de Presentes foi aplicada no projeto Euzim.",
    };
  }
  const path = `/r/${code}`;
  const origin = await absoluteOrigin();
  return { code, path, url: `${origin}${path}` };
}

export async function listMyPendingGiftsAction(): Promise<{
  error?: string;
  rewards?: ReferralRewardRow[];
}> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  const rewards = await listPendingRewardsForUser(user.id);
  return { rewards };
}

export async function claimGiftAction(
  rewardId: string,
  optionId: GiftOptionId,
): Promise<{ error?: string; success?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  const result = await claimReferralReward({
    referrerId: user.id,
    rewardId,
    optionId,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/app/parent");
  revalidatePath("/app/parent/gifts");
  revalidatePath("/app/parent/settings");
  return { success: true };
}

export async function getMyReferralPointsAction(): Promise<{
  error?: string;
  points?: number;
}> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  const points = await getReferralPointsBalance(user.id);
  return { points };
}

export async function redeemReferralPointsAction(input: {
  stories: number;
  avatars: number;
}): Promise<{ error?: string; success?: boolean; balance?: number }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Faça login." };
  const result = await redeemReferralPoints({
    userId: user.id,
    stories: input.stories,
    avatars: input.avatars,
  });
  if (!result.ok) return { error: result.error, balance: result.balance };
  revalidatePath("/app/parent");
  revalidatePath("/app/parent/gifts");
  revalidatePath("/app/parent/settings");
  return { success: true, balance: result.balance };
}
