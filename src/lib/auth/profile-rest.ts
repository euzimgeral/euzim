import { getSupabaseEnv } from "@/lib/supabase/config";
import { isPixarGeneratedUrl } from "@/lib/onboarding/pixar-url";

export type ProfileGateRow = {
  role?: string | null;
  full_name?: string | null;
  onboarding_completed?: boolean | null;
};

/** REST + secret key — bem mais rápido/estável que supabase-js admin no Mac. */
export async function fetchProfileViaRest(
  userId: string,
  timeoutMs = 4_000,
): Promise<ProfileGateRow | null> {
  const { url, secretKey } = getSupabaseEnv();
  if (!url || !secretKey) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${url}/rest/v1/users?select=role,full_name,onboarding_completed&id=eq.${encodeURIComponent(userId)}`,
      {
        headers: {
          apikey: secretKey,
          Authorization: `Bearer ${secretKey}`,
          Accept: "application/json",
        },
        signal: ctrl.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as ProfileGateRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function hasPixarAvatarViaRest(
  userId: string,
  timeoutMs = 4_000,
): Promise<boolean> {
  const { url, secretKey } = getSupabaseEnv();
  if (!url || !secretKey) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
    };
    const [childrenRes, charsRes] = await Promise.all([
      fetch(
        `${url}/rest/v1/children?select=avatar_url&parent_id=eq.${encodeURIComponent(userId)}&limit=8`,
        { headers, signal: ctrl.signal, cache: "no-store" },
      ),
      fetch(
        `${url}/rest/v1/characters?select=avatar_url&parent_id=eq.${encodeURIComponent(userId)}&limit=8`,
        { headers, signal: ctrl.signal, cache: "no-store" },
      ),
    ]);
    const children = childrenRes.ok
      ? ((await childrenRes.json()) as { avatar_url?: string | null }[])
      : [];
    const chars = charsRes.ok
      ? ((await charsRes.json()) as { avatar_url?: string | null }[])
      : [];
    return [...children, ...chars].some((r) =>
      isPixarGeneratedUrl(r.avatar_url ?? null),
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
