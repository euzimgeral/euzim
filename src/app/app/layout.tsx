import { Suspense } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { SessionHeartbeat } from "@/components/app/session-heartbeat";
import { MOCK_SESSION_COOKIE } from "@/lib/auth/constants";
import { knownAccountForEmail } from "@/lib/auth/known-accounts";
import { needsOnboarding } from "@/lib/auth/routing";
import {
  hasAuthTokenCookie,
  readUserFromAuthCookies,
} from "@/lib/auth/session-from-cookies";

/**
 * Gate só com cookies (zero REST/GoTrue).
 * getCurrentUser+REST no Suspense do layout travava o stream →
 * "Suspense could not finish" → client render → hard refresh → loop.
 * Perfil/role completo fica nas pages (admin já tem loader client).
 */
async function AppAreaGate({ children }: { children: React.ReactNode }) {
  await connection();

  const hasAuthCookie = await hasAuthTokenCookie();
  if (!hasAuthCookie) {
    const store = await cookies();
    if (!store.get(MOCK_SESSION_COOKIE)?.value) {
      redirect("/login");
    }
  }

  // Contas canônicas: onboarding sem rede. Demais: page resolve.
  const cookieUser = await readUserFromAuthCookies();
  const known = knownAccountForEmail(cookieUser?.email);
  if (
    known &&
    needsOnboarding({
      role: known.role,
      onboardingCompleted: known.onboardingCompleted,
    })
  ) {
    redirect("/onboarding");
  }

  return (
    <>
      <SessionHeartbeat />
      {children}
    </>
  );
}

export default function AppAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppPageFallback />}>
      <AppAreaGate>{children}</AppAreaGate>
    </Suspense>
  );
}
