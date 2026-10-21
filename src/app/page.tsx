import { Suspense } from "react";
import { connection } from "next/server";
import { BrandLogo } from "@/components/brand/brand-logo";
import { LandingHome } from "@/components/marketing/landing-home";
import { HasAccountGate } from "@/components/referral/has-account-gate";
import { getCurrentUser } from "@/lib/auth/get-user";
import { resolveAppHomePath } from "@/lib/auth/routing";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { redirect } from "next/navigation";

function HomeFallback() {
  return (
    <div className="landing-root relative flex min-h-full flex-1 flex-col">
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8 md:px-12">
        <BrandLogo size="header" priority />
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16 text-sm text-muted-foreground">
        Carregando…
      </main>
    </div>
  );
}

async function HomeInner({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; channel?: string }>;
}) {
  // cacheComponents: connection() + Suspense permite searchParams/cookies em runtime
  await connection();
  const params = await searchParams;
  const mockMode = !isSupabaseConfigured();
  const hasRef = Boolean(params.ref && params.ref.trim());

  // Landing anônima NÃO chama Auth — getSession flaky (AuthRetryableFetchError)
  // prendia Suspense ~8s, estourava dehydrate e o HMR ficava em loop ([HMR] connected).
  if (!hasRef) {
    return <LandingHome mockMode={mockMode} />;
  }

  const user = await getCurrentUser();

  if (user) {
    redirect(resolveAppHomePath(user));
  }

  return (
    <div className="landing-root relative flex min-h-full flex-1 flex-col">
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8 md:px-12">
        <BrandLogo size="header" priority />
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        <HasAccountGate nextPath="/onboarding" />
      </main>
    </div>
  );
}

export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; channel?: string }>;
}) {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeInner searchParams={searchParams} />
    </Suspense>
  );
}
