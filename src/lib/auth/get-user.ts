import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  mockSessionToUser,
  readMockOnboarding,
  readMockSession,
} from "@/lib/auth/mock-session";
import {
  fetchProfileViaRest,
  hasPixarAvatarViaRest,
  type ProfileGateRow,
} from "@/lib/auth/profile-rest";
import type { AuthUser } from "@/lib/auth/types";
import { isPixarGeneratedUrl } from "@/lib/onboarding/pixar-url";

async function withTimeout<T>(ms: number, work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Se a flag estiver stale, mas já há avatar Pixar — considera onboard concluído. */
async function inferOnboardingFromAvatars(userId: string): Promise<boolean> {
  const viaRest = await hasPixarAvatarViaRest(userId);
  if (viaRest) return true;

  const db = createAdminClient();
  if (!db) return false;

  const [childrenRes, charsRes] = await Promise.all([
    db.from("children").select("avatar_url").eq("parent_id", userId).limit(8),
    db.from("characters").select("avatar_url").eq("parent_id", userId).limit(8),
  ]);

  const urls = [
    ...(childrenRes.data ?? []).map((r) => r.avatar_url as string | null),
    ...(charsRes.data ?? []).map((r) => r.avatar_url as string | null),
  ];
  return urls.some((u) => isPixarGeneratedUrl(u));
}

async function getCurrentUserUncached(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured()) {
    const mock = await readMockSession();
    return mock ? mockSessionToUser(mock) : null;
  }

  const supabase = await createClient();
  if (!supabase) return null;

  let user: {
    id: string;
    email?: string | null;
    user_metadata?: { full_name?: string };
  } | null = null;

  try {
    // Sessão vem de cookies locais — 8s cobre DNS flaky sem mentir "sem user".
    user = await withTimeout(
      8000,
      supabase.auth.getSession().then((r) => r.data.session?.user ?? null),
    );
  } catch {
    user = null;
  }

  if (!user) {
    const mock = await readMockSession();
    return mock ? mockSessionToUser(mock) : null;
  }

  let profile: ProfileGateRow | null = await fetchProfileViaRest(user.id);

  if (!profile) {
    // Fallback supabase-js (mais lento no Mac; timeout generoso).
    const db = createAdminClient() ?? supabase;
    try {
      profile = await withTimeout(
        15_000,
        Promise.resolve(
          db
            .from("users")
            .select("role, full_name, onboarding_completed")
            .eq("id", user.id)
            .maybeSingle()
            .then((r) => r.data as ProfileGateRow | null),
        ),
      );
    } catch {
      profile = null;
    }
  }

  const role =
    (profile?.role as "parent" | "admin" | undefined) ?? "parent";

  // Admin: nunca exige onboarding no app.
  if (role === "admin") {
    return {
      id: user.id,
      email: user.email ?? "",
      role: "admin",
      fullName: profile?.full_name ?? user.user_metadata?.full_name ?? null,
      onboardingCompleted: true,
      isMock: false,
    };
  }

  let onboardingCompleted = Boolean(profile?.onboarding_completed);

  if (!onboardingCompleted) {
    try {
      const inferred = await inferOnboardingFromAvatars(user.id);
      if (inferred) {
        onboardingCompleted = true;
        const admin = createAdminClient();
        if (admin) {
          void admin
            .from("users")
            .update({
              onboarding_completed: true,
              onboarding_reset_mode: null,
            })
            .eq("id", user.id);
        }
      }
    } catch {
      /* mantém false */
    }
  }

  if (profile == null && !onboardingCompleted) {
    // Sem perfil e sem inferência — fallback mock local
    const onboarding = await readMockOnboarding();
    return {
      id: user.id,
      email: user.email ?? "",
      role: "parent",
      fullName: user.user_metadata?.full_name ?? null,
      onboardingCompleted: Boolean(
        onboarding?.completed ||
          (onboarding?.securityPin &&
            onboarding?.child &&
            (onboarding.childPhotos?.length || onboarding.photos?.length)),
      ),
      isMock: false,
    };
  }

  return {
    id: user.id,
    email: user.email ?? "",
    role,
    fullName: profile?.full_name ?? user.user_metadata?.full_name ?? null,
    onboardingCompleted,
    isMock: false,
  };
}

/** Deduplica getUser+profile no mesmo request (layout + page). */
export const getCurrentUser = cache(getCurrentUserUncached);
