"use server";

import { requireAdmin } from "@/lib/admin/require-admin";
import {
  loadAdminDashboard,
  type AdminAccountRow,
  type AdminKpis,
} from "@/lib/admin/load-dashboard";
import { listLearningEntriesAction } from "@/lib/admin/learning-actions";
import { loadPixelsAdminAction } from "@/lib/admin/pixels-actions";
import type { PixelsAdminBundle } from "@/lib/admin/pixels-actions";
import { getPlanCatalog } from "@/lib/billing/plan-catalog";
import type { PlanCatalogRow } from "@/lib/billing/plan-catalog-shared";
import type { AiLearningEntry } from "@/lib/learning/types";

export type AdminDashboardBundle = {
  kpis: AdminKpis;
  accounts: AdminAccountRow[];
  loadError?: string;
  pixelsBundle: PixelsAdminBundle;
  planCatalog: PlanCatalogRow[];
  learningEntries: AiLearningEntry[];
};

/** Bundle Admin no client — evita Suspense RSC longo (dehydrate → refresh loop). */
export async function loadAdminDashboardBundleAction(): Promise<AdminDashboardBundle> {
  const gate = await requireAdmin();
  if ("error" in gate) {
    return {
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
      loadError: gate.error,
      pixelsBundle: { pixels: [], tags: [], webhooks: [] },
      planCatalog: [],
      learningEntries: [],
    };
  }

  try {
    const [dash, pixelsBundle, planCatalog, learning] = await Promise.all([
      loadAdminDashboard(),
      loadPixelsAdminAction(),
      getPlanCatalog({ force: false }),
      listLearningEntriesAction(),
    ]);
    return {
      kpis: dash.kpis,
      accounts: dash.accounts,
      loadError: dash.error,
      pixelsBundle,
      planCatalog,
      learningEntries: learning.entries,
    };
  } catch (err) {
    return {
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
      loadError:
        err instanceof Error
          ? err.message
          : "Falha ao carregar o painel. Tente atualizar.",
      pixelsBundle: { pixels: [], tags: [], webhooks: [] },
      planCatalog: [],
      learningEntries: [],
    };
  }
}
