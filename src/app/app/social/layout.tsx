import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { getCurrentUser } from "@/lib/auth/get-user";
import { needsOnboarding } from "@/lib/auth/routing";

/** Onboarding gate na área social (layout /app fica cookie-only). */
async function SocialAreaGate({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (needsOnboarding(user)) redirect("/onboarding");
  return <>{children}</>;
}

export default function SocialAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppPageFallback />}>
      <SocialAreaGate>{children}</SocialAreaGate>
    </Suspense>
  );
}
