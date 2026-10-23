import { cookies } from "next/headers";

export type CookieSessionUser = {
  id: string;
  email?: string | null;
  user_metadata?: { full_name?: string };
};

const BASE64_PREFIX = "base64-";

/** Mesma regra do @supabase/ssr hasSupabaseAuthCookie. */
export async function hasAuthTokenCookie(): Promise<boolean> {
  try {
    const store = await cookies();
    return store
      .getAll()
      .some(
        (c) =>
          c.name.includes("auth-token") &&
          c.value.length > 20 &&
          !c.name.includes("code-verifier"),
      );
  } catch {
    return false;
  }
}

function decodeCookiePayload(rawJoined: string): string | null {
  let raw = rawJoined.trim();
  if (!raw) return null;

  // Chunks às vezes vêm ainda percent-encoded.
  if (raw.includes("%")) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep */
    }
  }

  if (raw.startsWith(BASE64_PREFIX)) {
    try {
      const b64 = raw.slice(BASE64_PREFIX.length);
      return Buffer.from(
        b64.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
    } catch {
      return null;
    }
  }

  if (raw.startsWith("{")) return raw;

  try {
    const decoded = Buffer.from(
      raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    if (decoded.startsWith("{") || decoded.startsWith(BASE64_PREFIX)) {
      return decoded.startsWith(BASE64_PREFIX)
        ? decodeCookiePayload(decoded)
        : decoded;
    }
  } catch {
    /* keep */
  }
  return null;
}

function userFromSessionJson(raw: string): CookieSessionUser | null {
  try {
    const parsed = JSON.parse(raw) as {
      user?: CookieSessionUser;
      access_token?: string;
      currentSession?: { user?: CookieSessionUser };
    };
    const user = parsed.user || parsed.currentSession?.user || null;
    if (user?.id) return user;

    const token = parsed.access_token;
    if (typeof token === "string" && token.includes(".")) {
      const payload = token.split(".")[1];
      if (!payload) return null;
      const json = Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
      const claims = JSON.parse(json) as {
        sub?: string;
        email?: string;
        user_metadata?: { full_name?: string };
      };
      if (claims.sub) {
        return {
          id: claims.sub,
          email: claims.email ?? null,
          user_metadata: claims.user_metadata,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Lê o user da sessão nos cookies Supabase sem chamar GoTrue.
 * Compatível com cookie único, chunks `.0/.1` e prefixo `base64-`.
 */
export async function readUserFromAuthCookies(): Promise<CookieSessionUser | null> {
  try {
    const store = await cookies();
    const all = store.getAll();

    const bases = new Set<string>();
    for (const c of all) {
      if (
        !c.name.includes("auth-token") ||
        c.name.includes("code-verifier") ||
        !c.value
      ) {
        continue;
      }
      bases.add(c.name.replace(/\.\d+$/, ""));
    }

    for (const base of bases) {
      // Igual combineChunks do @supabase/ssr: base inteiro OU .0+.1+…
      const whole = all.find((c) => c.name === base)?.value;
      let joined = whole || "";
      if (!joined) {
        const parts: string[] = [];
        for (let i = 0; ; i++) {
          const chunk = all.find((c) => c.name === `${base}.${i}`)?.value;
          if (!chunk) break;
          parts.push(chunk);
        }
        joined = parts.join("");
      }
      if (!joined) continue;

      const decoded = decodeCookiePayload(joined);
      if (!decoded) continue;
      const user = userFromSessionJson(decoded);
      if (user) return user;
    }
    return null;
  } catch {
    return null;
  }
}
