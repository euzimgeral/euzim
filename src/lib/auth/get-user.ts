import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  mockSessionToUser,
  readMockOnboarding,
  readMockSession,
} from "@/lib/auth/mock-session";
import { knownAccountForEmail } from "@/lib/auth/known-accounts";
import {
  fetchProfileViaRest,
  hasPixarAvatarViaRest,
  type ProfileGateRow,
} from "@/lib/auth/profile-rest";
import { readUserFromAuthCookies } from "@/lib/auth/session-from-cookies";
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
  const viaRest = await hasPixarAvatarViaRest(userId, 4000);
  if (viaRest) return true;

  const db = createAdminClient();
  if (!db) return false;

  try {
    const raced = await withTimeout(
      4000,
      Promise.all([
        db.from("children").select("avatar_url").eq("parent_id", userId).limit(8),
        db
          .from("characters")
          .select("avatar_url")
          .eq("parent_id", userId)
          .limit(8),
      ]).then(([childrenRes, charsRes]) => {
        const urls = [
          ...(childrenRes.data ?? []).map((r) => r.avatar_url as string | null),
          ...(charsRes.data ?? []).map((r) => r.avatar_url as string | null),
        ];
        return urls.some((u) => isPixarGeneratedUrl(u));
      }),
    );
    return Boolean(raced);
  } catch {
    return false;
  }
}

async function getCurrentUserUncached(): Promise<AuthUser | null> {
  try {
    if (!isSupabaseConfigured()) {
      const mock = await readMockSession();
      return mock ? mockSessionToUser(mock) : null;
    }

    // Cookie local (sem rede). Não chama getSession — aviso insecure + refresh
    // GoTrue engolia a :5050 e derrubava RSC (_rsc fetch failed).
    const user = await readUserFromAuthCookies();

    if (!user) {
      const mock = await readMockSession();
      return mock ? mockSessionToUser(mock) : null;
    }

    // Contas canônicas: resposta imediata (sem REST). Evita Suspense 4–20s no /app.
    const knownFast = knownAccountForEmail(user.email);
    if (knownFast) {
      return {
        id: user.id,
        email: user.email ?? "",
        role: knownFast.role,
        fullName: user.user_metadata?.full_name ?? null,
        onboardingCompleted: knownFast.onboardingCompleted,
        isMock: false,
      };
    }

    let profile: ProfileGateRow | null = await fetchProfileViaRest(
      user.id,
      1_500,
    );

    if (!profile) {
      const supabase = await createClient();
      const db = createAdminClient() ?? supabase;
      if (db) {
        try {
          profile = await withTimeout(
            1_500,
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
    }

    const role =
      (profile?.role as "parent" | "admin" | undefined) || "parent";

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
  } catch {
    // Nunca deixar TypeError: fetch failed / AuthRetryable subir para a UI.
    try {
      const mock = await readMockSession();
      return mock ? mockSessionToUser(mock) : null;
    } catch {
      return null;
    }
  }
}

/** Deduplica getUser+profile no mesmo request (layout + page). */
export const getCurrentUser = cache(getCurrentUserUncached);
