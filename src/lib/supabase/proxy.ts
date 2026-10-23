import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/** Cookie de sessão Supabase presente (sem rede). */
export function hasSupabaseAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some(
      (c) =>
        c.name.includes("auth-token") &&
        c.value.length > 20 &&
        !c.name.includes("code-verifier"),
    );
}

/**
 * Proxy só olha cookie — zero chamada GoTrue.
 * getSession/refresh no middleware competia com RSC e gerava
 * AuthRetryableFetchError + soft-nav `TypeError: fetch failed`.
 * Páginas revalidam via getCurrentUser (cookie-first + timeouts).
 */
export async function updateSupabaseSession(request: NextRequest) {
  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  if (!isSupabaseConfigured()) {
    return { response, user: null as { id: string } | null };
  }

  const user = hasSupabaseAuthCookie(request)
    ? ({ id: "cookie-session" } as { id: string })
    : null;

  return { response, user };
}
