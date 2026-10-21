import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "@/lib/supabase/config";

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
 * Renova sessão no proxy com teto duro.
 * Se Auth estiver lento/quebrado (IPv6/DNS), não bloqueia a navegação.
 */
export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  if (!isSupabaseConfigured()) {
    return { response, user: null as { id: string } | null };
  }

  const cookieUser = hasSupabaseAuthCookie(request)
    ? ({ id: "cookie-session" } as { id: string })
    : null;

  // Sem cookie: não bate no GoTrue (landing/públicas já skipam; /app redireciona).
  if (!cookieUser) {
    return { response, user: null };
  }

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const sessionPromise = supabase.auth
    .getSession()
    .then(({ data }) => data.session?.user ?? null)
    .catch(() => null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const raced = await Promise.race([
    sessionPromise,
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), 800);
    }),
  ]);
  if (timer) clearTimeout(timer);

  if (raced === "timeout" || raced == null) {
    // Não espera Auth: cookie basta para liberar /app; página revalida depois.
    return { response, user: cookieUser };
  }

  return { response, user: raced };
}
