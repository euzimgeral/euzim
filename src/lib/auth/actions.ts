"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  clearMockSession,
  createMockUserId,
  readMockOnboarding,
  readMockSession,
  writeMockOnboarding,
  writeMockSession,
} from "@/lib/auth/mock-session";
import type { OnboardingPhotoDraft } from "@/lib/auth/types";
import {
  fetchProfileViaRest,
  hasPixarAvatarViaRest,
} from "@/lib/auth/profile-rest";
import { knownAccountForEmail } from "@/lib/auth/known-accounts";
import { resolvePostAuthPath } from "@/lib/auth/routing";
import { finishAvatarOnboardingAction } from "@/lib/onboarding/actions";
import { isPixarGeneratedUrl } from "@/lib/onboarding/pixar-url";
import { applyReferralAttribution } from "@/lib/referral/attribution";
import { ensureReferralCode } from "@/lib/referral/codes";
import { dispatchTrackingEvent } from "@/lib/tracking/dispatch";

export type AuthActionResult = {
  error?: string;
  success?: boolean;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Mensagem amigável para falhas de rede / undici "fetch failed". */
function mapAuthNetworkError(err: unknown, fallback?: string): string {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : fallback || "Erro de autenticação.";
  if (
    /fetch failed|failed to fetch|networkerror|econnreset|etimedout|enotfound|socket|aborted|timeout/i.test(
      msg,
    )
  ) {
    return "Não foi possível conectar ao servidor de login (rede/Supabase). Aguarde alguns segundos e tente de novo.";
  }
  return msg || fallback || "Erro de autenticação.";
}

async function signInWithPasswordRetry(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  email: string,
  password: string,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (!result.error) return result;
      lastError = result.error;
      if (
        !/fetch failed|failed to fetch|network|timeout|econnreset/i.test(
          result.error.message,
        )
      ) {
        return result;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return {
    data: { user: null, session: null },
    error: {
      message: mapAuthNetworkError(lastError, "Falha ao entrar."),
    },
  };
}

export async function signUpAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const phoneRaw = String(formData.get("phone") ?? "").trim();
  const phoneDigits = phoneRaw.replace(/\D/g, "");
  const phone =
    phoneDigits && phoneDigits.length >= 8 && phoneDigits.length <= 20
      ? phoneDigits
      : null;

  if (!email || !password || password.length < 6) {
    return { error: "Informe e-mail e senha (mín. 6 caracteres)." };
  }

  const leadEventId = String(formData.get("leadEventId") ?? "").trim() || undefined;

  if (!isSupabaseConfigured()) {
    const mockId = createMockUserId();
    await writeMockSession({
      id: mockId,
      email,
      role: "parent",
      fullName: fullName || undefined,
      onboardingCompleted: false,
    });
    await writeMockOnboarding({
      securityPin: "",
      child: null,
      childPhotos: [],
      friend: null,
      friendPhotos: [],
      completed: false,
    });
    // Await antes do redirect — fire-and-forget era abortado e Lead sumia.
    await dispatchTrackingEvent({
      event: "Lead",
      eventId: leadEventId,
      user: { email, fullName, phone, userId: mockId },
      commerce: { product: "Cadastro Euzim" },
    }).catch(() => ({ eventId: leadEventId || "", ok: false }));
    const nextMock = String(formData.get("next") ?? "").trim();
    redirect(nextMock.startsWith("/") ? nextMock : "/onboarding");
  }

  const admin = createAdminClient();
  const supabase = await createClient();
  if (!admin || !supabase) return { error: "Supabase indisponível." };

  // Cria conta já confirmada (sem e-mail de verificação) e abre sessão
  // imediatamente — cadastro → onboard fluído, sem login extra.
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName || undefined,
        phone: phone || undefined,
      },
    });

  if (createError) {
    const msg = createError.message.toLowerCase();
    if (
      msg.includes("already") ||
      msg.includes("registered") ||
      msg.includes("exists")
    ) {
      return {
        error: "Este e-mail já tem conta. Entre com sua senha.",
      };
    }
    return { error: createError.message };
  }

  try {
    const signed = await signInWithPasswordRetry(supabase, email, password);
    if (signed.error) {
      return {
        error:
          "Conta criada, mas não foi possível iniciar a sessão. Tente entrar.",
      };
    }
  } catch {
    return {
      error:
        "Conta criada, mas não foi possível iniciar a sessão. Tente entrar.",
    };
  }

  const newUserId = created.user?.id;
  if (newUserId) {
    if (phone || fullName) {
      await admin
        .from("users")
        .update({
          ...(fullName ? { full_name: fullName, display_name: fullName } : {}),
          ...(phone ? { phone } : {}),
        })
        .eq("id", newUserId);
    }
    await ensureReferralCode(newUserId);
    await applyReferralAttribution(newUserId);
    // Await CAPI/webhooks antes do redirect (mesmo event_id do browser).
    await dispatchTrackingEvent({
      event: "Lead",
      eventId: leadEventId,
      user: {
        email,
        fullName,
        phone,
        userId: newUserId,
      },
      commerce: { product: "Cadastro Euzim" },
    }).catch(() => ({ eventId: leadEventId || "", ok: false }));
  }

  const next = String(formData.get("next") ?? "").trim();
  redirect(next.startsWith("/") ? next : "/onboarding");
}

export async function signInAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Informe e-mail e senha." };
  }

  if (!isSupabaseConfigured()) {
    const known = knownAccountForEmail(email);
    const existing = await readMockSession();
    if (existing && existing.email === email) {
      const role =
        known?.role ||
        (existing.role === "admin" ? "admin" : "parent");
      const onboardingCompleted =
        known?.onboardingCompleted ??
        (Boolean(existing.onboardingCompleted) || role === "admin");
      redirect(
        resolvePostAuthPath(
          { role, onboardingCompleted },
          String(formData.get("next") ?? ""),
        ),
      );
    }

    const role =
      known?.role || (email.includes("admin") ? "admin" : "parent");
    const onboardingCompleted =
      known?.onboardingCompleted ?? role === "admin";
    await writeMockSession({
      id: createMockUserId(),
      email,
      role,
      onboardingCompleted,
    });
    redirect(
      resolvePostAuthPath(
        { role, onboardingCompleted },
        String(formData.get("next") ?? ""),
      ),
    );
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Supabase indisponível." };

  let signInData: {
    user: { id: string } | null;
    session: unknown;
  };
  try {
    const result = await signInWithPasswordRetry(supabase, email, password);
    if (result.error) {
      return { error: mapAuthNetworkError(result.error.message) };
    }
    signInData = result.data;
  } catch (err) {
    return { error: mapAuthNetworkError(err) };
  }

  const user = signInData.user;
  if (user) {
    // Referral não bloqueia o redirect do login (evita timeout / fetch failed).
    void Promise.all([
      ensureReferralCode(user.id),
      applyReferralAttribution(user.id),
    ]).catch(() => {});

    let profile: {
      onboarding_completed?: boolean | null;
      role?: string | null;
    } | null = await fetchProfileViaRest(user.id);

    if (!profile) {
      const db = createAdminClient() ?? supabase;
      try {
        const profileRes = await db
          .from("users")
          .select("onboarding_completed, role")
          .eq("id", user.id)
          .maybeSingle();
        profile = profileRes.data;
      } catch {
        /* segue com destino padrão */
      }
    }

    const known = knownAccountForEmail(email);
    const role =
      (profile?.role as "admin" | "parent" | undefined) ||
      known?.role ||
      "parent";
    let onboardingCompleted = Boolean(profile?.onboarding_completed);
    if (role === "admin") onboardingCompleted = true;
    if (!onboardingCompleted && known?.onboardingCompleted) {
      onboardingCompleted = true;
    }

    if (!onboardingCompleted && role !== "admin") {
      try {
        if (await hasPixarAvatarViaRest(user.id)) {
          onboardingCompleted = true;
          const db = createAdminClient() ?? supabase;
          void db
            .from("users")
            .update({
              onboarding_completed: true,
              onboarding_reset_mode: null,
            })
            .eq("id", user.id);
        } else {
          const db = createAdminClient() ?? supabase;
          const { data: children } = await db
            .from("children")
            .select("avatar_url")
            .eq("parent_id", user.id)
            .limit(8);
          if (
            children?.some((c) =>
              isPixarGeneratedUrl(c.avatar_url as string | null),
            )
          ) {
            onboardingCompleted = true;
            void db
              .from("users")
              .update({
                onboarding_completed: true,
                onboarding_reset_mode: null,
              })
              .eq("id", user.id);
          }
        }
      } catch {
        /* ignore */
      }
    }

    redirect(
      resolvePostAuthPath(
        { role, onboardingCompleted },
        String(formData.get("next") ?? ""),
      ),
    );
  }

  redirect("/app/parent");
}

export async function signOutAction() {
  if (!isSupabaseConfigured()) {
    await clearMockSession();
    redirect("/login");
  }

  const supabase = await createClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}

export async function saveSecurityPinAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const pin = String(formData.get("pin") ?? "").trim();
  const confirm = String(formData.get("confirmPin") ?? "").trim();

  if (!/^\d{4,6}$/.test(pin)) {
    return { error: "O PIN deve ter 4 a 6 dígitos numéricos." };
  }
  if (pin !== confirm) {
    return { error: "Os PINs não coincidem." };
  }

  if (!isSupabaseConfigured()) {
    const session = await readMockSession();
    if (!session) return { error: "Sessão expirada. Faça login novamente." };

    const current = (await readMockOnboarding()) ?? {
      securityPin: "",
      child: null,
      childPhotos: [],
      friend: null,
      friendPhotos: [],
      completed: false,
    };
    await writeMockOnboarding({ ...current, securityPin: pin });
    return { success: true };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Supabase indisponível." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase
    .from("users")
    .update({ security_pin: pin })
    .eq("id", user.id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function saveChildProfileAction(
  _prev: AuthActionResult,
  formData: FormData,
): Promise<AuthActionResult> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const birthDate = String(formData.get("birthDate") ?? "").trim() || undefined;

  if (!displayName || displayName.length > 80) {
    return { error: "Informe o nome da criança (até 80 caracteres)." };
  }

  if (!isSupabaseConfigured()) {
    const session = await readMockSession();
    if (!session) return { error: "Sessão expirada. Faça login novamente." };

    const current = (await readMockOnboarding()) ?? {
      securityPin: "",
      child: null,
      childPhotos: [],
      friend: null,
      friendPhotos: [],
      completed: false,
    };
    await writeMockOnboarding({
      ...current,
      child: {
        displayName,
        birthDate: birthDate || "2018-01-01",
        gender: "other",
      },
    });
    return { success: true };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Supabase indisponível." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase.from("children").insert({
    parent_id: user.id,
    display_name: displayName,
    birth_date: birthDate || null,
  });

  if (error) return { error: error.message };
  return { success: true };
}

export async function savePhotosMockAction(
  photos: OnboardingPhotoDraft[],
): Promise<AuthActionResult> {
  if (photos.length < 1) {
    return { error: "Adicione pelo menos uma foto para o avatar." };
  }

  if (!isSupabaseConfigured()) {
    const session = await readMockSession();
    if (!session) return { error: "Sessão expirada. Faça login novamente." };

    const current = (await readMockOnboarding()) ?? {
      securityPin: "",
      child: null,
      childPhotos: [],
      friend: null,
      friendPhotos: [],
      completed: false,
    };
    // Não persistir data URLs em cookies (limite de tamanho) — só metadados.
    const lightPhotos = photos.map(({ id, name, storagePath, slotId }) => ({
      id,
      slotId: slotId || id,
      name,
      storagePath,
      previewUrl: "",
    }));
    await writeMockOnboarding({
      ...current,
      childPhotos: lightPhotos,
      photos: lightPhotos,
    });
    return { success: true };
  }

  // Com Supabase real, o upload iria para Storage; aqui só persiste paths mock no perfil.
  const supabase = await createClient();
  if (!supabase) return { error: "Supabase indisponível." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { data: children } = await supabase
    .from("children")
    .select("id")
    .eq("parent_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const childId = children?.[0]?.id;
  if (!childId) return { error: "Crie o perfil da criança antes das fotos." };

  await supabase
    .from("children")
    .update({
      avatar_url: photos[0]?.previewUrl ?? null,
      avatar_model_id: `lora-pending:${childId}`,
      preferences: {
        lora_training: "simulated",
        photo_paths: photos.map((p) => p.storagePath),
      },
    })
    .eq("id", childId);

  return { success: true };
}

/** @deprecated Use finishAvatarOnboardingAction — mantido para compat. */
export async function completeOnboardingAction(): Promise<AuthActionResult> {
  const result = await finishAvatarOnboardingAction();
  if (result.error) return { error: result.error };
  return { success: true };
}
