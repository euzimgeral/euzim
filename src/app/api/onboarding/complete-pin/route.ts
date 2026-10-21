import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/get-user";
import {
  writeMockOnboarding,
  writeMockSession,
  readMockSession,
} from "@/lib/auth/mock-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  isValidSecurityPin,
  normalizeSecurityPin,
} from "@/lib/onboarding/pin-format";
import { isPixarGeneratedUrl } from "@/lib/onboarding/pixar-url";
import { dispatchTrackingEvent } from "@/lib/tracking/dispatch";

export const maxDuration = 60;

/**
 * Salva PIN + completa onboarding numa única API (sem Server Action / Set-Cookie gordo).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Faça login." }, { status: 401 });
  }

  let pin = "";
  let confirm = "";
  let registrationEventId: string | undefined;
  try {
    const body = (await request.json()) as {
      pin?: string;
      confirmPin?: string;
      registrationEventId?: string;
    };
    pin = String(body.pin ?? "").trim();
    confirm = String(body.confirmPin ?? "").trim();
    const eid = String(body.registrationEventId ?? "").trim();
    registrationEventId = eid || undefined;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  if (!isValidSecurityPin(pin)) {
    return NextResponse.json(
      { error: "O PIN deve ter 4 a 6 dígitos." },
      { status: 400 },
    );
  }
  if (pin !== confirm) {
    return NextResponse.json(
      { error: "Os PINs não coincidem." },
      { status: 400 },
    );
  }

  if (!isSupabaseConfigured() || user.isMock) {
    try {
      await writeMockOnboarding({
        securityPin: pin,
        child: null,
        childPhotos: [],
        friend: null,
        friendPhotos: [],
        wizardStep: "pin",
        completed: true,
      });
      const session = await readMockSession();
      if (session) {
        await writeMockSession({ ...session, onboardingCompleted: true });
      }
    } catch {
      /* cookie opcional */
    }
    await dispatchTrackingEvent({
      event: "CompleteRegistration",
      eventId: registrationEventId,
      user: {
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      commerce: { product: "Onboarding Euzim" },
    }).catch(() => ({ eventId: registrationEventId || "", ok: false }));
    return NextResponse.json({ success: true, redirectTo: "/app/parent" });
  }

  const db = createAdminClient() ?? (await createClient());
  if (!db) {
    return NextResponse.json(
      { error: "Supabase indisponível." },
      { status: 503 },
    );
  }

  const { data: children } = await db
    .from("children")
    .select("id, avatar_url, preferences")
    .eq("parent_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  const child = children?.[0];
  if (!child) {
    return NextResponse.json(
      { error: "Complete o avatar da criança antes do PIN." },
      { status: 400 },
    );
  }

  const prefs =
    child.preferences && typeof child.preferences === "object"
      ? (child.preferences as Record<string, unknown>)
      : {};
  const pixar = prefs.pixar as
    | { child_hero?: string; friend_hero?: string }
    | undefined;

  const childOk =
    isPixarGeneratedUrl(pixar?.child_hero) ||
    isPixarGeneratedUrl(child.avatar_url);
  const friendOk = isPixarGeneratedUrl(pixar?.friend_hero);
  if (!childOk || !friendOk) {
    return NextResponse.json(
      {
        error:
          "Gere os avatares Pixar (passo Magia) antes de definir o PIN.",
      },
      { status: 400 },
    );
  }

  prefs.onboarding_wizard_step = "done";
  await db
    .from("children")
    .update({ preferences: prefs })
    .eq("id", child.id);

  // UPDATE (não upsert) — evita reescrever colunas e PIN vazio
  const { error } = await db
    .from("users")
    .update({
      security_pin: pin,
      onboarding_completed: true,
      onboarding_reset_mode: null,
    })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json(
      {
        error: error.message.includes("users_security_pin_format")
          ? "PIN inválido. Use só 4 a 6 dígitos numéricos."
          : error.message,
      },
      { status: 400 },
    );
  }

  // Confirma que gravou
  const { data: saved } = await db
    .from("users")
    .select("security_pin, onboarding_completed, onboarding_reset_mode")
    .eq("id", user.id)
    .maybeSingle();
  if (
    !normalizeSecurityPin(saved?.security_pin) ||
    !saved?.onboarding_completed
  ) {
    return NextResponse.json(
      { error: "Não foi possível confirmar o PIN. Tente de novo." },
      { status: 500 },
    );
  }

  // Cookie mínimo pós-sucesso (não pode sobrescrever com wizard "preview")
  try {
    await writeMockOnboarding({
      securityPin: pin,
      child: null,
      childPhotos: [],
      friend: null,
      friendPhotos: [],
      wizardStep: "done",
      completed: true,
    });
  } catch {
    /* cookie opcional */
  }

  let phone: string | null = null;
  let fullName: string | null = user.fullName ?? null;
  try {
    const { data: profile } = await db
      .from("users")
      .select("phone, full_name")
      .eq("id", user.id)
      .maybeSingle();
    phone = profile?.phone ?? null;
    fullName = profile?.full_name || user.fullName;
  } catch {
    /* segue com dados da sessão */
  }

  // Await CAPI antes da resposta (mesmo event_id do browser).
  await dispatchTrackingEvent({
    event: "CompleteRegistration",
    eventId: registrationEventId,
    user: {
      userId: user.id,
      email: user.email,
      fullName,
      phone,
    },
    commerce: { product: "Onboarding Euzim" },
  }).catch(() => ({ eventId: registrationEventId || "", ok: false }));

  return NextResponse.json({ success: true, redirectTo: "/app/parent" });
}
