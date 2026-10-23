"use client";

import { useEffect, useState, useTransition } from "react";
import { AdminDashboard } from "@/components/admin/admin-dashboard";
import {
  loadAdminDashboardBundleAction,
  type AdminDashboardBundle,
} from "@/lib/admin/dashboard-actions";

const EMPTY: AdminDashboardBundle = {
  kpis: {
    totalAccounts: 0,
    active7d: 0,
    dormant30d: 0,
    byStatus: {},
    stories7d: 0,
    stories30d: 0,
    parentsWithoutStoriesPct: 0,
    avgSessionSeconds7d: 0,
    incompleteOnboarding: 0,
    totalChildren: 0,
    totalCharacters: 0,
    monthSpendUsd: 0,
    monthSpendBrl: 0,
    monthTokens: 0,
  },
  accounts: [],
  pixelsBundle: { pixels: [], tags: [], webhooks: [] },
  planCatalog: [],
  learningEntries: [],
};

/**
 * Carrega o painel via Server Action no client.
 * Mantém o RSC do /app/admin curto (só shell) — evita
 * "Suspense boundary could not finish" → refresh loop.
 */
export function AdminDashboardLoader() {
  const [bundle, setBundle] = useState<AdminDashboardBundle | null>(null);
  const [pending, startTransition] = useTransition();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const data = await loadAdminDashboardBundleAction();
        if (!cancelled) setBundle(data);
      } catch (err) {
        if (!cancelled) {
          setBootError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar o painel.",
          );
          setBundle(EMPTY);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bundle) {
    return (
      <div className="flex min-h-[40vh] flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        {pending || !bootError
          ? "Carregando dados do admin…"
          : bootError}
      </div>
    );
  }

  return (
    <AdminDashboard
      kpis={bundle.kpis}
      accounts={bundle.accounts}
      loadError={bundle.loadError || bootError || undefined}
      pixelsBundle={bundle.pixelsBundle}
      planCatalog={bundle.planCatalog}
      learningEntries={bundle.learningEntries}
    />
  );
}
