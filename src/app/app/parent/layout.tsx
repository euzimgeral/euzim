import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { getCurrentUser } from "@/lib/auth/get-user";
import { needsOnboarding } from "@/lib/auth/routing";

/** Onboarding gate só na área parent (layout /app fica cookie-only). */
async function ParentAreaGate({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (needsOnboarding(user)) redirect("/onboarding");
  return <>{children}</>;
}

export default function ParentAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppPageFallback />}>
      <ParentAreaGate>{children}</ParentAreaGate>
    </Suspense>
  );
}
