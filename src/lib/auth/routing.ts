import type { AuthUser } from "@/lib/auth/types";

/** Admin nunca passa pelo onboarding. */
export function needsOnboarding(user: Pick<AuthUser, "role" | "onboardingCompleted">): boolean {
  if (user.role === "admin") return false;
  return !user.onboardingCompleted;
}

/** Destino padrão após login / ao abrir app autenticado. */
export function resolveAppHomePath(
  user: Pick<AuthUser, "role" | "onboardingCompleted">,
): string {
  if (user.role === "admin") return "/app/admin";
  // Parent onboardado entra na Leitura (kids); Criação fica no nav.
  if (user.onboardingCompleted) return "/app/kids";
  return "/onboarding";
}

/**
 * Honra `next` só se for path interno seguro e compatível com o estado do user.
 * Admin / já onboardado não podem ser mandados para /onboarding.
 */
export function resolvePostAuthPath(
  user: Pick<AuthUser, "role" | "onboardingCompleted">,
  nextRaw: string | null | undefined,
): string {
  const home = resolveAppHomePath(user);
  const next = (nextRaw || "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return home;

  if (user.role === "admin") {
    if (next.startsWith("/onboarding")) return "/app/admin";
    if (next.startsWith("/app")) return next;
    return "/app/admin";
  }

  if (user.onboardingCompleted) {
    if (next.startsWith("/onboarding")) return "/app/kids";
    if (next.startsWith("/app")) return next;
    return "/app/kids";
  }

  // Ainda precisa onboardar: só permite next=/onboarding (com query)
  if (next.startsWith("/onboarding")) return next;
  return "/onboarding";
}
