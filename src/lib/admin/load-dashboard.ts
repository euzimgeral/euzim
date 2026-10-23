import {
  BASE_INCLUDED_AVATARS,
  normalizePlanSource,
  type PlanSource,
} from "@/lib/billing/plan-source";
import { resolveSubscriptionPlan } from "@/lib/billing/plans";
import { getSupabaseEnv, hasSecretKey } from "@/lib/supabase/config";
import { resolveRenewalIso } from "@/lib/stories/usage";

export type AdminKpis = {
  totalAccounts: number;
  active7d: number;
  dormant30d: number;
  byStatus: Record<string, number>;
  stories7d: number;
  stories30d: number;
  parentsWithoutStoriesPct: number;
  avgSessionSeconds7d: number;
  incompleteOnboarding: number;
  totalChildren: number;
  totalCharacters: number;
  monthSpendUsd: number;
  monthSpendBrl: number;
  monthTokens: number;
};

export type UsageCategoryBreakdown = {
  category: string;
  events: number;
  tokens: number;
  usd: number;
  brl: number;
};

export type UsageEventRow = {
  id: string;
  category: string;
  provider: string | null;
  model: string | null;
  operation: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedUsd: number;
  estimatedBrl: number;
  createdAt: string;
};

export type AdminAccountRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  role: string;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  planSource: PlanSource;
  complimentaryUntil: string | null;
  onboardingCompleted: boolean;
  onboardingResetMode: string | null;
  lastActiveAt: string | null;
  lastStoryAt: string | null;
  adminNotes: string | null;
  childrenCount: number;
  charactersCount: number;
  storiesCount: number;
  storiesUsedMonth: number;
  storyPlanLimit: number;
  extraStoriesAvailable: number;
  storyLimitEffective: number;
  avatarAllowance: number;
  extraCharactersAvailable: number;
  storiesRenewsAt: string;
  sessionSeconds7d: number;
  lastSignInAt: string | null;
  usageTokens: number;
  usageUsd: number;
  usageBrl: number;
  usageByCategory: UsageCategoryBreakdown[];
  recentUsage: UsageEventRow[];
};

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  subscription_status: string | null;
  subscription_plan_id: string | null;
  plan_source: string | null;
  complimentary_until: string | null;
  onboarding_completed: boolean | null;
  onboarding_reset_mode: string | null;
  last_active_at: string | null;
  last_story_at: string | null;
  admin_notes: string | null;
  created_at: string;
  extra_stories_available: number | null;
  extra_characters_available: number | null;
  stripe_current_period_end: string | null;
};

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function monthStartIso(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function emptyKpis(): AdminKpis {
  return {
    totalAccounts: 0,
    active7d: 0,
    dormant30d: 0,
    byStatus: {},
    stories7d: 0,
    stories30d: 0,
    parentsWithoutStoriesPct: 0,
    avgSessionSeconds7d: 0,
    incompleteOnboarding: 0,
    totalChildren: 0,
    totalCharacters: 0,
    monthSpendUsd: 0,
    monthSpendBrl: 0,
    monthTokens: 0,
  };
}

/** REST + secret — mais estável que supabase-js no Mac (evita 20–70s). */
async function restGetOnce<T>(
  pathAndQuery: string,
  timeoutMs: number,
): Promise<T[]> {
  const { url, secretKey } = getSupabaseEnv();
  if (!url || !secretKey) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      headers: {
        apikey: secretKey,
        Authorization: `Bearer ${secretKey}`,
        Accept: "application/json",
        Prefer: "count=none",
      },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return [];
    return (await res.json()) as T[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function restGet<T>(
  pathAndQuery: string,
  timeoutMs = 18_000,
): Promise<T[]> {
  const first = await restGetOnce<T>(pathAndQuery, timeoutMs);
  if (first.length > 0) return first;
  // 1 retry — ConnectTimeout undici na 1ª conexão quente do process.
  await new Promise((r) => setTimeout(r, 350));
  return restGetOnce<T>(pathAndQuery, timeoutMs);
}

type DashboardPayload = {
  kpis: AdminKpis;
  accounts: AdminAccountRow[];
  error?: string;
};

let dashboardCache: { at: number; data: DashboardPayload } | null = null;
const DASHBOARD_CACHE_MS = 45_000;

/** Concorrência 2 — rajada de 5+ HTTPS neste Mac gera ConnectTimeout undici. */
async function restGetPair<A, B>(
  a: Promise<A[]>,
  b: Promise<B[]>,
): Promise<[A[], B[]]> {
  return Promise.all([a, b]);
}

/**
 * Dashboard Admin — sem auth.admin.listUsers (GoTrue lento neste Mac).
 * usage_events só do mês corrente (cap 800).
 */
export async function loadAdminDashboard(): Promise<DashboardPayload> {
  if (!hasSecretKey()) {
    return {
      kpis: emptyKpis(),
      accounts: [],
      error: "Admin indisponível (chave de serviço).",
    };
  }

  if (
    dashboardCache &&
    Date.now() - dashboardCache.at < DASHBOARD_CACHE_MS &&
    dashboardCache.data.accounts.length > 0
  ) {
    return dashboardCache.data;
  }

  const monthStart = monthStartIso();
  const weekIso = daysAgo(7).toISOString();

  const usersSelect = [
    "id",
    "email",
    "full_name",
    "role",
    "subscription_status",
    "subscription_plan_id",
    "plan_source",
    "complimentary_until",
    "onboarding_completed",
    "onboarding_reset_mode",
    "last_active_at",
    "last_story_at",
    "admin_notes",
    "created_at",
    "extra_stories_available",
    "extra_characters_available",
    "stripe_current_period_end",
  ].join(",");

  // Contas primeiro (obrigatório). Demais em pares — evita saturar undici.
  const users = await restGet<UserRow>(
    `users?select=${usersSelect}&order=created_at.desc`,
    20_000,
  );

  if (users.length === 0) {
    return {
      kpis: emptyKpis(),
      accounts: [],
      error: "Não foi possível carregar contas agora. Tente atualizar.",
    };
  }

  const [children, characters] = await restGetPair(
    restGet<{ id: string; parent_id: string }>(
      "children?select=id,parent_id",
      18_000,
    ),
    restGet<{ id: string; parent_id: string }>(
      "characters?select=id,parent_id",
      18_000,
    ),
  );

  const [stories, sessions] = await restGetPair(
    restGet<{ id: string; parent_id: string; created_at: string }>(
      "stories?select=id,parent_id,created_at",
      18_000,
    ),
    restGet<{
      user_id: string;
      duration_seconds: number | null;
      last_seen_at: string;
    }>(
      `analytics_sessions?select=user_id,duration_seconds,last_seen_at&last_seen_at=gte.${encodeURIComponent(weekIso)}`,
      18_000,
    ),
  );

  const usageEvents = await restGet<{
    id: string;
    user_id: string;
    category: string;
    provider: string | null;
    model: string | null;
    operation: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
    estimated_usd: number | null;
    estimated_brl: number | null;
    created_at: string;
  }>(
    `usage_events?select=id,user_id,category,provider,model,operation,prompt_tokens,completion_tokens,total_tokens,estimated_usd,estimated_brl,created_at&created_at=gte.${encodeURIComponent(monthStart)}&order=created_at.desc&limit=800`,
    18_000,
  );

  const rows = users;
  const parentRows = rows.filter((u) => u.role === "parent");

  const childCount = new Map<string, number>();
  for (const c of children) {
    childCount.set(c.parent_id, (childCount.get(c.parent_id) ?? 0) + 1);
  }
  const charCount = new Map<string, number>();
  for (const c of characters) {
    charCount.set(c.parent_id, (charCount.get(c.parent_id) ?? 0) + 1);
  }

  const storyCount = new Map<string, number>();
  const storyMonthCount = new Map<string, number>();
  const story7 = daysAgo(7).getTime();
  const story30 = daysAgo(30).getTime();
  const monthStartMs = new Date(monthStart).getTime();
  let stories7d = 0;
  let stories30d = 0;
  for (const s of stories) {
    storyCount.set(s.parent_id, (storyCount.get(s.parent_id) ?? 0) + 1);
    const t = new Date(s.created_at).getTime();
    if (t >= story7) stories7d += 1;
    if (t >= story30) stories30d += 1;
    if (t >= monthStartMs) {
      storyMonthCount.set(
        s.parent_id,
        (storyMonthCount.get(s.parent_id) ?? 0) + 1,
      );
    }
  }

  const sessionSec = new Map<string, number>();
  let sessionSum = 0;
  let sessionUsers = 0;
  for (const s of sessions) {
    const sec = s.duration_seconds ?? 0;
    sessionSec.set(s.user_id, (sessionSec.get(s.user_id) ?? 0) + sec);
  }
  for (const [, sec] of sessionSec) {
    sessionSum += sec;
    sessionUsers += 1;
  }

  type UsageAgg = {
    tokens: number;
    usd: number;
    brl: number;
    byCategory: Map<string, UsageCategoryBreakdown>;
    recent: UsageEventRow[];
  };
  const usageByUser = new Map<string, UsageAgg>();
  let monthSpendUsd = 0;
  let monthSpendBrl = 0;
  let monthTokens = 0;

  for (const ev of usageEvents) {
    const usd = Number(ev.estimated_usd) || 0;
    const brl = Number(ev.estimated_brl) || 0;
    const tokens = Number(ev.total_tokens) || 0;
    monthSpendUsd += usd;
    monthSpendBrl += brl;
    monthTokens += tokens;

    let agg = usageByUser.get(ev.user_id);
    if (!agg) {
      agg = {
        tokens: 0,
        usd: 0,
        brl: 0,
        byCategory: new Map(),
        recent: [],
      };
      usageByUser.set(ev.user_id, agg);
    }
    agg.tokens += tokens;
    agg.usd += usd;
    agg.brl += brl;

    const cat = String(ev.category);
    const prev = agg.byCategory.get(cat) ?? {
      category: cat,
      events: 0,
      tokens: 0,
      usd: 0,
      brl: 0,
    };
    prev.events += 1;
    prev.tokens += tokens;
    prev.usd += usd;
    prev.brl += brl;
    agg.byCategory.set(cat, prev);

    if (agg.recent.length < 12) {
      agg.recent.push({
        id: ev.id,
        category: cat,
        provider: ev.provider ?? null,
        model: ev.model,
        operation: ev.operation,
        promptTokens: Number(ev.prompt_tokens) || 0,
        completionTokens: Number(ev.completion_tokens) || 0,
        totalTokens: tokens,
        estimatedUsd: usd,
        estimatedBrl: brl,
        createdAt: ev.created_at,
      });
    }
  }

  const active7d = parentRows.filter((u) => {
    const t = u.last_active_at ? new Date(u.last_active_at).getTime() : 0;
    return t >= story7;
  }).length;
  const dormant30d = parentRows.filter((u) => {
    const t = u.last_active_at ? new Date(u.last_active_at).getTime() : 0;
    return !t || t < daysAgo(30).getTime();
  }).length;

  const byStatus: Record<string, number> = {};
  for (const u of parentRows) {
    const st = u.subscription_status || "none";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
  }

  const withoutStories = parentRows.filter(
    (u) => (storyCount.get(u.id) ?? 0) === 0,
  ).length;
  const parentsWithoutStoriesPct =
    parentRows.length === 0
      ? 0
      : Math.round((withoutStories / parentRows.length) * 100);

  const accounts: AdminAccountRow[] = rows.map((u) => {
    const usage = usageByUser.get(u.id);
    const plan = resolveSubscriptionPlan(u.subscription_plan_id || "");
    const storyPlanLimit = plan?.storiesPerMonth ?? 0;
    const extraStories =
      typeof u.extra_stories_available === "number"
        ? Math.max(0, u.extra_stories_available)
        : 0;
    const extraAvatars =
      typeof u.extra_characters_available === "number"
        ? Math.max(0, u.extra_characters_available)
        : 0;
    const hasPlan = Boolean(u.subscription_plan_id);
    const avatarBase = hasPlan ? BASE_INCLUDED_AVATARS : 0;
    return {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      role: u.role,
      subscriptionStatus: u.subscription_status,
      subscriptionPlanId: u.subscription_plan_id,
      planSource: normalizePlanSource(u.plan_source),
      complimentaryUntil: u.complimentary_until,
      onboardingCompleted: Boolean(u.onboarding_completed),
      onboardingResetMode: u.onboarding_reset_mode,
      lastActiveAt: u.last_active_at,
      lastStoryAt: u.last_story_at,
      adminNotes: u.admin_notes,
      childrenCount: childCount.get(u.id) ?? 0,
      charactersCount: charCount.get(u.id) ?? 0,
      storiesCount: storyCount.get(u.id) ?? 0,
      storiesUsedMonth: storyMonthCount.get(u.id) ?? 0,
      storyPlanLimit,
      extraStoriesAvailable: extraStories,
      storyLimitEffective: storyPlanLimit + extraStories,
      avatarAllowance: avatarBase + extraAvatars,
      extraCharactersAvailable: extraAvatars,
      storiesRenewsAt: resolveRenewalIso(u.stripe_current_period_end ?? null),
      sessionSeconds7d: sessionSec.get(u.id) ?? 0,
      // Sem GoTrue listUsers (era o gargalo 20–70s neste Mac).
      lastSignInAt: u.last_active_at,
      usageTokens: usage?.tokens ?? 0,
      usageUsd: usage?.usd ?? 0,
      usageBrl: usage?.brl ?? 0,
      usageByCategory: usage
        ? Array.from(usage.byCategory.values()).sort((a, b) =>
            a.category.localeCompare(b.category),
          )
        : [],
      recentUsage: usage?.recent ?? [],
    };
  });

  const data: DashboardPayload = {
    kpis: {
      totalAccounts: parentRows.length,
      active7d,
      dormant30d,
      byStatus,
      stories7d,
      stories30d,
      parentsWithoutStoriesPct,
      avgSessionSeconds7d:
        sessionUsers === 0 ? 0 : Math.round(sessionSum / sessionUsers),
      incompleteOnboarding: parentRows.filter((u) => !u.onboarding_completed)
        .length,
      totalChildren: children.length,
      totalCharacters: characters.length,
      monthSpendUsd,
      monthSpendBrl,
      monthTokens,
    },
    accounts,
  };
  dashboardCache = { at: Date.now(), data };
  return data;
}
