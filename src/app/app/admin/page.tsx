import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { AppShell } from "@/components/app/app-shell";
import { AdminDashboardLoader } from "@/components/admin/admin-dashboard-loader";
import { getCurrentUser } from "@/lib/auth/get-user";
import { hasAuthTokenCookie } from "@/lib/auth/session-from-cookies";
import { knownAccountForEmail } from "@/lib/auth/known-accounts";
import type { AuthUser } from "@/lib/auth/types";

/**
 * Shell RSC rápido (cookie/known-account); dados no client.
 * Suspense local p/ connection() sob cacheComponents (sem nested no layout).
 */
async function AdminPageInner() {
  await connection();
  let user = await getCurrentUser();

  if (!user && (await hasAuthTokenCookie())) {
    // Cookie existe mas parse falhou — placeholder mínimo p/ não bounce.
    // Loader/actions usam requireAdmin com cookie real.
    const fallback: AuthUser = {
      id: "session-pending",
      email: "",
      role: "admin",
      fullName: null,
      onboardingCompleted: true,
      isMock: false,
    };
    user = fallback;
  }

  if (!user) redirect("/login");
  if (user.role !== "admin") {
    const known = knownAccountForEmail(user.email);
    if (known?.role !== "admin") redirect("/app/parent");
  }

  return (
    <AppShell user={user} title="">
      <AdminDashboardLoader />
    </AppShell>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<AppPageFallback label="Abrindo admin…" />}>
      <AdminPageInner />
    </Suspense>
  );
}
