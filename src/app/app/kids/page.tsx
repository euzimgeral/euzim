import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { AppShell } from "@/components/app/app-shell";
import { PinGuardButton } from "@/components/kids/pin-guard";
import { getCurrentUser } from "@/lib/auth/get-user";
import { readMockOnboarding } from "@/lib/auth/mock-session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { listStoriesForParent } from "@/lib/stories/load-story";

async function KidsPageInner() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;

  const childName =
    !isSupabaseConfigured() || user.isMock
      ? (await readMockOnboarding())?.child?.displayName
      : null;

  const stories = await listStoriesForParent(user.id);

  return (
    <AppShell user={user} title="Leitura" kidsMode>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight md:text-4xl">
              Olá{childName ? `, ${childName}` : ""}!
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Escolha uma história para ler.
            </p>
          </div>
          <PinGuardButton
            label="Criação"
            href="/app/parent"
            skipPin={user.role === "admin"}
          />
        </div>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-heading text-xl font-semibold">
            <BookOpen className="size-5 text-amber-700" />
            Suas histórias
          </h2>
          {stories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há histórias. Peça aos pais para criar uma no painel.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {stories.map((story) => (
                <li key={story.id}>
                  <Link
                    href={`/app/kids/read/${story.id}`}
                    className="flex gap-3 rounded-2xl border border-border/60 bg-[radial-gradient(ellipse_at_top,_oklch(0.97_0.03_85),_transparent_70%)] p-3 transition hover:border-foreground/30"
                  >
                    {story.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={story.coverImageUrl}
                        alt=""
                        className="size-20 rounded-xl object-cover"
                      />
                    ) : (
                      <div className="flex size-20 items-center justify-center rounded-xl bg-muted">
                        <BookOpen className="size-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 self-center">
                      <p className="truncate font-heading text-lg font-semibold">
                        {story.title}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Tocar para ler →
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export default function KidsPage() {
  return (
    <Suspense fallback={<AppPageFallback label="Carregando Leitura…" />}>
      <KidsPageInner />
    </Suspense>
  );
}
