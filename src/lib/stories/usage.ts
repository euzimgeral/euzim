import { cookies } from "next/headers";
import { MONTHLY_STORY_LIMIT } from "@/lib/billing/character-packs";
import {
  FAMILY_SUBSCRIPTION,
  resolveSubscriptionPlan,
} from "@/lib/billing/plans";
import { resolveSubscriptionPlanAsync } from "@/lib/billing/plans-catalog-load";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/auth/get-user";

const MOCK_USAGE_COOKIE = "em_mock_story_usage";

export type StoryUsage = {
  used: number;
  limit: number;
  source: "mock" | "supabase" | "fallback";
  planId?: string;
  /** Cota do plano (sem extras). */
  planLimit?: number;
  /** Créditos avulsos (`extra_stories_available`). */
  extraStories?: number;
  /** ISO da próxima renovação de cota mensal. */
  renewsAt?: string;
};

/** Fim do mês calendário (UTC local do servidor) — alinhado ao count de usage. */
export function calendarMonthRenewalIso(from: Date = new Date()): string {
  const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

/**
 * Preferir `stripe_current_period_end` se estiver no futuro; senão mês calendário.
 */
export function resolveRenewalIso(
  stripePeriodEnd?: string | null,
  from: Date = new Date(),
): string {
  if (stripePeriodEnd) {
    const t = new Date(stripePeriodEnd).getTime();
    if (Number.isFinite(t) && t > from.getTime()) {
      return new Date(t).toISOString();
    }
  }
  return calendarMonthRenewalIso(from);
}

async function resolveMonthlyLimit(planId?: string | null): Promise<number> {
  const planKey = planId || FAMILY_SUBSCRIPTION.planId;
  const catalog =
    (await resolveSubscriptionPlanAsync(planKey)) ||
    resolveSubscriptionPlan(planKey);
  const catalogLimit = catalog?.storiesPerMonth;

  const db = createAdminClient() ?? (await createClient());
  if (!db) return catalogLimit ?? MONTHLY_STORY_LIMIT;

  const id = planId || FAMILY_SUBSCRIPTION.planId;
  const { data } = await db
    .from("subscription_limits")
    .select("max_stories_per_month, plan_id")
    .eq("plan_id", id)
    .eq("is_active", true)
    .maybeSingle();

  // Catálogo (2/5/10) vence linha stale no DB quando diverge.
  if (
    catalogLimit != null &&
    data?.max_stories_per_month != null &&
    data.max_stories_per_month !== catalogLimit
  ) {
    return catalogLimit;
  }
  if (data?.max_stories_per_month != null) {
    return data.max_stories_per_month;
  }
  if (catalogLimit != null) return catalogLimit;

  const { data: free } = await db
    .from("subscription_limits")
    .select("max_stories_per_month")
    .eq("plan_id", "free")
    .maybeSingle();

  return free?.max_stories_per_month ?? MONTHLY_STORY_LIMIT;
}

export async function getStoryUsage(): Promise<StoryUsage> {
  const user = await getCurrentUser();

  if (isSupabaseConfigured() && user) {
    try {
      const db = createAdminClient() ?? (await createClient());
      if (db) {
        let planId: string | null = "family";
        const { data: profile } = await db
          .from("users")
          .select(
            "subscription_plan_id, extra_stories_available, stripe_current_period_end",
          )
          .eq("id", user.id)
          .maybeSingle();
        planId = profile?.subscription_plan_id ?? "family";

        const planLimit = await resolveMonthlyLimit(planId);
        const extraStories =
          typeof profile?.extra_stories_available === "number"
            ? Math.max(0, profile.extra_stories_available)
            : 0;
        const limit = planLimit + extraStories;
        const renewsAt = resolveRenewalIso(
          profile?.stripe_current_period_end ?? null,
        );

        const start = new Date();
        start.setDate(1);
        start.setHours(0, 0, 0, 0);

        const { count, error } = await db
          .from("stories")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", user.id)
          .gte("created_at", start.toISOString());

        if (!error && typeof count === "number") {
          return {
            used: count,
            limit,
            planLimit,
            extraStories,
            renewsAt,
            source: "supabase",
            planId: planId ?? undefined,
          };
        }
      }
    } catch {
      // fallback
    }
  }

  const store = await cookies();
  const raw = store.get(MOCK_USAGE_COOKIE)?.value;
  const used = raw ? Number.parseInt(raw, 10) : 0;
  return {
    used: Number.isFinite(used) ? used : 0,
    limit: MONTHLY_STORY_LIMIT,
    source: user?.isMock ? "mock" : "fallback",
  };
}
