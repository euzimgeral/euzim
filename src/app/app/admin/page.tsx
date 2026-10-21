import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { AppShell } from "@/components/app/app-shell";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { getCurrentUser } from "@/lib/auth/get-user";
import { loadAdminDashboard } from "@/lib/admin/load-dashboard";
import { loadPixelsAdminAction } from "@/lib/admin/pixels-actions";
import { getPlanCatalog } from "@/lib/billing/plan-catalog";

async function AdminPageInner() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") redirect("/app/parent");

  const [{ kpis, accounts, error }, pixelsBundle, planCatalog] =
    await Promise.all([
      loadAdminDashboard(),
      loadPixelsAdminAction(),
      getPlanCatalog({ force: true }),
    ]);

  return (
    <AppShell user={user} title="">
      <AdminDashboard
        kpis={kpis}
        accounts={accounts}
        loadError={error}
        pixelsBundle={pixelsBundle}
        planCatalog={planCatalog}
      />
    </AppShell>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<AppPageFallback label="Carregando admin…" />}>
      <AdminPageInner />
    </Suspense>
  );
}
