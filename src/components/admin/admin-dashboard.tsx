"use client";

import { useMemo, useState, useTransition } from "react";
import { Copy, RotateCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminAccountRow, AdminKpis } from "@/lib/admin/load-dashboard";
import {
  addExtraCreditsAction,
  deleteAdminStoryAction,
  generateRecoveryLinkAction,
  listAdminUserStoriesAction,
  resetOnboardingAction,
  updateSubscriptionAction,
  type AdminStoryCostRow,
} from "@/lib/admin/actions";
import type { PixelsAdminBundle } from "@/lib/admin/pixels-actions";
import { AdminPixelsPanel } from "@/components/admin/admin-pixels-panel";
import { AdminPlansPanel } from "@/components/admin/admin-plans-panel";
import { AdminLearningPanel } from "@/components/admin/admin-learning-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PLAN_SOURCE_LABELS,
  type PlanSource,
} from "@/lib/billing/plan-source";
import type { PlanCatalogRow } from "@/lib/billing/plan-catalog-shared";
import { SUBSCRIPTION_PLANS } from "@/lib/billing/plans";
import { formatBrl } from "@/lib/billing/character-packs";
import type { AiLearningEntry } from "@/lib/learning/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function fmtDuration(sec: number): string {
  if (!sec) return "0m";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtMoney(n: number, currency: "USD" | "BRL"): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function AdminDashboard({
  kpis,
  accounts,
  loadError,
  pixelsBundle,
  planCatalog,
  learningEntries,
}: {
  kpis: AdminKpis;
  accounts: AdminAccountRow[];
  loadError?: string;
  pixelsBundle: PixelsAdminBundle;
  planCatalog: PlanCatalogRow[];
  learningEntries: AiLearningEntry[];
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [onboardingFilter, setOnboardingFilter] = useState<string>("all");
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [noStoriesOnly, setNoStoriesOnly] = useState(false);
  const [selected, setSelected] = useState<AdminAccountRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);
  const [planId, setPlanId] = useState("family");
  const [planSource, setPlanSource] = useState<PlanSource>("none");
  const [extraStoriesAdd, setExtraStoriesAdd] = useState(1);
  const [extraAvatarsAdd, setExtraAvatarsAdd] = useState(1);
  const [userStories, setUserStories] = useState<AdminStoryCostRow[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return accounts.filter((a) => {
      if (q && !(a.email || "").toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && a.subscriptionStatus !== statusFilter) {
        return false;
      }
      if (onboardingFilter === "ok" && !a.onboardingCompleted) return false;
      if (onboardingFilter === "pending" && a.onboardingCompleted) return false;
      if (inactiveOnly) {
        const t = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        if (t && t >= cutoff30) return false;
      }
      if (noStoriesOnly && a.storiesCount > 0) return false;
      return true;
    });
  }, [
    accounts,
    query,
    statusFilter,
    onboardingFilter,
    inactiveOnly,
    noStoriesOnly,
  ]);

  function openDrawer(row: AdminAccountRow) {
    setSelected(row);
    setPlanId(row.subscriptionPlanId || "");
    setPlanSource(row.planSource || "none");
    setExtraStoriesAdd(1);
    setExtraAvatarsAdd(1);
    setMessage(null);
    setError(null);
    setRecoveryLink(null);
    setUserStories([]);
    setStoriesLoading(true);
    void listAdminUserStoriesAction({ userId: row.id }).then((res) => {
      setStoriesLoading(false);
      if (res.stories) setUserStories(res.stories);
      if (res.error) setError(res.error);
    });
  }

  function run(action: () => Promise<{ error?: string; success?: boolean; message?: string; recoveryLink?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      if (result.message) setMessage(result.message);
      if (result.recoveryLink) setRecoveryLink(result.recoveryLink);
      if (result.success && !result.recoveryLink) {
        // soft refresh
        window.location.reload();
      }
    });
  }

  const kpiCards = [
    { label: "Contas (pais)", value: kpis.totalAccounts },
    { label: "Ativas 7d", value: kpis.active7d },
    { label: "Dormindo 30d+", value: kpis.dormant30d },
    { label: "Histórias 7d / 30d", value: `${kpis.stories7d} / ${kpis.stories30d}` },
    { label: "Sem história", value: `${kpis.parentsWithoutStoriesPct}%` },
    { label: "Sessão média 7d", value: fmtDuration(kpis.avgSessionSeconds7d) },
    { label: "Onboarding pendente", value: kpis.incompleteOnboarding },
    {
      label: "Filhos / avatares",
      value: `${kpis.totalChildren} / ${kpis.totalCharacters}`,
    },
    {
      label: "Gasto mês (USD)",
      value: fmtMoney(kpis.monthSpendUsd, "USD"),
    },
    {
      label: "Gasto mês (BRL)",
      value: fmtMoney(kpis.monthSpendBrl, "BRL"),
    },
    {
      label: "Tokens no mês",
      value: fmtTokens(kpis.monthTokens),
    },
  ];

  return (
    <div className="space-y-6">
      <Tabs defaultValue="users" className="space-y-6">
        <TabsList>
          <TabsTrigger value="users">Usuários</TabsTrigger>
          <TabsTrigger value="pixels">Pixels</TabsTrigger>
          <TabsTrigger value="plans">Planos</TabsTrigger>
          <TabsTrigger value="learning">Aprendizado</TabsTrigger>
        </TabsList>

        <TabsContent value="pixels" className="space-y-6">
          <AdminPixelsPanel initial={pixelsBundle} />
        </TabsContent>

        <TabsContent value="plans" className="space-y-6">
          <AdminPlansPanel initialPlans={planCatalog} />
        </TabsContent>

        <TabsContent value="learning" className="space-y-6">
          <AdminLearningPanel initialEntries={learningEntries} />
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-border/70 bg-background/80 px-3 py-3"
          >
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {k.label}
            </p>
            <p className="font-heading text-xl font-semibold">{k.value}</p>
          </div>
        ))}
      </div>

      {kpis.monthSpendUsd >= 15 ? (
        <p
          className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          Atenção: gasto de IA do mês já em{" "}
          {fmtMoney(kpis.monthSpendUsd, "USD")} (
          {fmtMoney(kpis.monthSpendBrl, "BRL")}). Revise contas com alto uso.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {Object.entries(kpis.byStatus).map(([st, n]) => (
          <Badge key={st} variant="secondary">
            {st}: {n}
          </Badge>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="q">Buscar email</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              id="q"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="eduardo@"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <select
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="active">active</option>
            <option value="trialing">trialing</option>
            <option value="none">none</option>
            <option value="past_due">past_due</option>
            <option value="canceled">canceled</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>Onboarding</Label>
          <select
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={onboardingFilter}
            onChange={(e) => setOnboardingFilter(e.target.value)}
          >
            <option value="all">Todos</option>
            <option value="ok">Completo</option>
            <option value="pending">Pendente</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inactiveOnly}
            onChange={(e) => setInactiveOnly(e.target.checked)}
          />
          Inativos 30d+
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={noStoriesOnly}
            onChange={(e) => setNoStoriesOnly(e.target.checked)}
          />
          Sem histórias
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Plano</th>
              <th className="px-3 py-2">Filhos</th>
              <th className="px-3 py-2">Chars</th>
              <th className="px-3 py-2">Hist.</th>
              <th className="px-3 py-2">Tokens</th>
              <th className="px-3 py-2">USD</th>
              <th className="px-3 py-2">BRL</th>
              <th className="px-3 py-2">Ativo</th>
              <th className="px-3 py-2">História</th>
              <th className="px-3 py-2">Onb.</th>
              <th className="px-3 py-2">Sessão 7d</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-border/50 hover:bg-muted/30"
                onClick={() => openDrawer(row)}
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{row.email}</div>
                  <div className="text-xs text-muted-foreground">{row.role}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {PLAN_SOURCE_LABELS[row.planSource] || "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.subscriptionStatus || "none"}
                  </div>
                </td>
                <td className="px-3 py-2">
                  {row.subscriptionPlanId || "—"}
                  <div className="text-xs text-muted-foreground">
                    {row.storiesUsedMonth}/{row.storyLimitEffective} hist.
                  </div>
                </td>
                <td className="px-3 py-2">{row.childrenCount}</td>
                <td className="px-3 py-2">{row.charactersCount}</td>
                <td className="px-3 py-2">{row.storiesCount}</td>
                <td className="px-3 py-2 text-xs">{fmtTokens(row.usageTokens)}</td>
                <td
                  className={`px-3 py-2 text-xs ${row.usageUsd >= 5 ? "font-semibold text-amber-800" : ""}`}
                >
                  {fmtMoney(row.usageUsd, "USD")}
                  {row.usageUsd >= 5 ? " ⚠" : ""}
                </td>
                <td className="px-3 py-2 text-xs">
                  {fmtMoney(row.usageBrl, "BRL")}
                </td>
                <td className="px-3 py-2 text-xs">{fmtDate(row.lastActiveAt)}</td>
                <td className="px-3 py-2 text-xs">{fmtDate(row.lastStoryAt)}</td>
                <td className="px-3 py-2">
                  {row.onboardingCompleted ? (
                    <Badge variant="secondary">ok</Badge>
                  ) : (
                    <Badge>pendente</Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {fmtDuration(row.sessionSeconds7d)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Nenhuma conta com esses filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.email}</DialogTitle>
            <DialogDescription>
              Último login Auth: {fmtDate(selected?.lastSignInAt ?? null)} · ID{" "}
              {selected?.id.slice(0, 8)}…
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="space-y-5">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Tipo e plano</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Tipo</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
                      value={planSource}
                      onChange={(e) =>
                        setPlanSource(e.target.value as PlanSource)
                      }
                    >
                      <option value="none">Sem plano</option>
                      <option value="paid_live">Pago</option>
                      <option value="paid_test">Teste</option>
                      <option value="gift">Presente</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label>Plano</Label>
                    <select
                      className="h-9 w-full rounded-lg border border-border bg-background px-2 text-sm"
                      value={planId}
                      onChange={(e) => setPlanId(e.target.value)}
                    >
                      <option value="">Sem plano</option>
                      {SUBSCRIPTION_PLANS.map((p) => (
                        <option key={p.planId} value={p.planId}>
                          {formatBrl(p.priceBrl)} · {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Presente = Admin (sem cobrança). Pago/Teste = Stripe live/test.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        updateSubscriptionAction({
                          userId: selected.id,
                          subscriptionPlanId: planId,
                          subscriptionStatus:
                            planSource === "none" || !planId
                              ? "none"
                              : "active",
                          planSource,
                        }),
                      )
                    }
                  >
                    Salvar tipo/plano
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !planId}
                    onClick={() =>
                      run(() =>
                        updateSubscriptionAction({
                          userId: selected.id,
                          subscriptionPlanId: planId || "family",
                          subscriptionStatus: "active",
                          planSource: "gift",
                        }),
                      )
                    }
                  >
                    Habilitar Presente
                  </Button>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Cotas</h3>
                <ul className="space-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
                  <li>
                    Avatares: direito {selected.avatarAllowance} (2 base +{" "}
                    {selected.extraCharactersAvailable} extras) · usados{" "}
                    {selected.charactersCount}
                  </li>
                  <li>
                    Histórias: direito {selected.storyLimitEffective} (plano{" "}
                    {selected.storyPlanLimit} + extras{" "}
                    {selected.extraStoriesAvailable}) · usadas no mês{" "}
                    {selected.storiesUsedMonth}
                  </li>
                  <li>
                    Próxima renovação:{" "}
                    {new Date(selected.storiesRenewsAt).toLocaleDateString(
                      "pt-BR",
                      { dateStyle: "medium" },
                    )}
                  </li>
                </ul>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>+ histórias</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={extraStoriesAdd}
                      onChange={(e) =>
                        setExtraStoriesAdd(Number(e.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>+ avatares</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={extraAvatarsAdd}
                      onChange={(e) =>
                        setExtraAvatarsAdd(Number(e.target.value))
                      }
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      addExtraCreditsAction({
                        userId: selected.id,
                        stories: extraStoriesAdd,
                        avatars: extraAvatarsAdd,
                      }),
                    )
                  }
                >
                  Creditar
                </Button>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Recuperar senha</h3>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !selected.email}
                  onClick={() =>
                    run(() =>
                      generateRecoveryLinkAction({
                        userId: selected.id,
                        email: selected.email || "",
                      }),
                    )
                  }
                >
                  Gerar link
                </Button>
                {recoveryLink ? (
                  <div className="space-y-1 rounded-lg bg-muted p-2 text-xs break-all">
                    <p>{recoveryLink}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void navigator.clipboard.writeText(recoveryLink)}
                    >
                      <Copy className="size-3.5" />
                      Copiar
                    </Button>
                  </div>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Reiniciar onboarding</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending || selected.role === "admin"}
                    onClick={() =>
                      run(() =>
                        resetOnboardingAction({
                          userId: selected.id,
                          mode: "full",
                        }),
                      )
                    }
                  >
                    <RotateCcw className="size-3.5" />
                    Do zero
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || selected.role === "admin"}
                    onClick={() =>
                      run(() =>
                        resetOnboardingAction({
                          userId: selected.id,
                          mode: "reuse",
                        }),
                      )
                    }
                  >
                    Reutilizar materiais
                  </Button>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Histórias ({userStories.length})
                </h3>
                {storiesLoading ? (
                  <p className="text-xs text-muted-foreground">Carregando…</p>
                ) : userStories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma história nesta conta.
                  </p>
                ) : (
                  <ul className="max-h-56 space-y-2 overflow-y-auto">
                    {userStories.map((st) => (
                      <li
                        key={st.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-border/60 px-2 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{st.title}</p>
                          <p className="text-muted-foreground">
                            {fmtDate(st.createdAt)} · {st.pages || "?"} atos
                          </p>
                          <p className="text-muted-foreground">
                            Custo ≈ {fmtMoney(st.estimatedUsd, "USD")} /{" "}
                            {fmtMoney(st.estimatedBrl, "BRL")}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={pending}
                          onClick={() =>
                            run(async () => {
                              const res = await deleteAdminStoryAction({
                                userId: selected.id,
                                storyId: st.id,
                              });
                              if (!res.error) {
                                setUserStories((prev) =>
                                  prev.filter((x) => x.id !== st.id),
                                );
                              }
                              return res;
                            })
                          }
                        >
                          <Trash2 className="size-3.5" />
                          Apagar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Custos de IA</h3>
                <p className="text-xs text-muted-foreground">
                  Total: {fmtTokens(selected.usageTokens)} ·{" "}
                  {fmtMoney(selected.usageUsd, "USD")} ·{" "}
                  {fmtMoney(selected.usageBrl, "BRL")}
                </p>
                {selected.usageByCategory.length > 0 ? (
                  <ul className="space-y-1 text-xs">
                    {selected.usageByCategory.map((c) => (
                      <li
                        key={c.category}
                        className="flex justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1"
                      >
                        <span>
                          {c.category} · {c.events} evt ·{" "}
                          {fmtTokens(c.tokens)}
                        </span>
                        <span>
                          {fmtMoney(c.usd, "USD")} / {fmtMoney(c.brl, "BRL")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sem eventos ainda (só a partir deste deploy).
                  </p>
                )}
                {selected.recentUsage.length > 0 ? (
                  <details className="rounded-lg border border-border/60 p-2">
                    <summary className="cursor-pointer text-xs font-medium">
                      Últimos eventos ({selected.recentUsage.length})
                    </summary>
                    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[11px]">
                      {selected.recentUsage.map((ev) => (
                        <li
                          key={ev.id}
                          className="border-b border-border/40 py-1 last:border-0"
                        >
                          <div className="font-medium">
                            {fmtDate(ev.createdAt)} · {ev.category}
                          </div>
                          <div className="text-muted-foreground">
                            {ev.provider || "—"} · {ev.model || "—"} ·{" "}
                            {ev.operation || "—"} · {fmtTokens(ev.totalTokens)} ·{" "}
                            {fmtMoney(ev.estimatedUsd, "USD")} ·{" "}
                            {fmtMoney(ev.estimatedBrl, "BRL")}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>

              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              {message ? (
                <p className="text-sm text-emerald-700">{message}</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
