import { Suspense } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Gift, Link2 } from "lucide-react";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { AppShell } from "@/components/app/app-shell";
import { ChooseStoryShareDialog } from "@/components/parent/choose-story-share-dialog";
import { PendingGiftsBanner } from "@/components/referral/pending-gifts-banner";
import { RedeemPointsPanel } from "@/components/referral/redeem-points-panel";
import { ShareAppButton } from "@/components/referral/share-app-button";
import { getCurrentUser } from "@/lib/auth/get-user";
import { ensureReferralCode } from "@/lib/referral/codes";
import { listStoriesForParent } from "@/lib/stories/load-story";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function absoluteOrigin(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";
    if (host) return `${proto}://${host}`;
  } catch {
    /* ignore */
  }
  return "http://localhost:5050";
}

async function GiftsInner() {
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const code = await ensureReferralCode(user.id);
  const origin = await absoluteOrigin();
  const shareUrl = code ? `${origin}/r/${code}` : null;

  const stories = await listStoriesForParent(user.id);
  const db = createAdminClient() ?? (await createClient());
  const shareTokens = new Map<string, string>();
  if (db && stories.length > 0) {
    const { data } = await db
      .from("stories")
      .select("id, share_token")
      .in(
        "id",
        stories.map((s) => s.id),
      );
    for (const row of data ?? []) {
      if (row.share_token) shareTokens.set(row.id, row.share_token);
    }
  }

  const shareable = stories.map((s) => ({
    id: s.id,
    title: s.title,
    coverImageUrl: s.coverImageUrl,
    shareToken: shareTokens.get(s.id) ?? null,
  }));

  return (
    <AppShell user={user} title="Presentes">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Ganhe avatares e histórias
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Quando alguém assina pelo seu link, você ganha pontos: 1 ponto = 1
            história presente e 2 pontos = 1 avatar presente.
          </p>
        </div>

        <RedeemPointsPanel />
        <PendingGiftsBanner />

        <section className="space-y-3 rounded-2xl border border-border/60 p-4">
          <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
            <Link2 className="size-4" />
            Copie o seu link
          </h2>
          <ShareAppButton initialCode={code} initialUrl={shareUrl} />
          {!code ? (
            <p className="text-xs text-amber-800">
              Se o código não aparecer, aplique no SQL Editor do projeto Euzim
              o arquivo{" "}
              <code className="rounded bg-muted px-1">
                supabase/migrations/20261017_referral_gifts.sql
              </code>
              .
            </p>
          ) : null}
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="space-y-3 rounded-2xl border border-border/60 p-4">
            <h2 className="font-heading text-base font-semibold">
              Compartilhe o link com outros pais
            </h2>
            <p className="text-sm text-muted-foreground">
              Envie seu link de indicação por WhatsApp, e-mail ou redes.
            </p>
            <ShareAppButton
              initialCode={code}
              initialUrl={shareUrl}
              compact
            />
          </section>

          <section className="space-y-3 rounded-2xl border border-border/60 p-4">
            <h2 className="font-heading text-base font-semibold">
              Ou compartilhe suas histórias
            </h2>
            <p className="text-sm text-muted-foreground">
              Escolha uma história e envie o link de leitura.
            </p>
            <ChooseStoryShareDialog stories={shareable} />
          </section>
        </div>

        <footer className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          <p className="flex items-start gap-2">
            <Gift className="mt-0.5 size-4 shrink-0 text-amber-700" />
            <span>
              Ao assinar pelo seu link ou por uma história compartilhada, você
              ganha pontos conforme o plano (1º mês e nas renovações). Resgate
              como histórias (1 pt) ou avatares (2 pts).
            </span>
          </p>
        </footer>
      </div>
    </AppShell>
  );
}

export default function GiftsPage() {
  return (
    <Suspense fallback={<AppPageFallback label="Carregando presentes…" />}>
      <GiftsInner />
    </Suspense>
  );
}
