import Image from "next/image";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import { InlineBrand } from "@/components/brand/inline-brand";
import { LandingStoryBook } from "@/components/marketing/landing-story-book";
import { LandingCast } from "@/components/marketing/landing-cast";
import { LandingAntiWoke } from "@/components/marketing/landing-anti-woke";
import { LandingRoadmap } from "@/components/marketing/landing-roadmap";
import { LandingOffer } from "@/components/marketing/landing-offer";
import { LandingFaq } from "@/components/marketing/landing-faq";
import { LandingFinalCta } from "@/components/marketing/landing-final-cta";
import { LandingFooter } from "@/components/marketing/landing-footer";
import {
  IconBuildValues,
  IconGoodHabits,
  IconOvercomeFears,
} from "@/components/marketing/purpose-icons";
import { Button } from "@/components/ui/button";
import { getPlanCatalog } from "@/lib/billing/plan-catalog";
import {
  cheapestPlanFromCatalog,
  formatCentsBrl,
} from "@/lib/billing/plan-catalog-shared";
import type { ComponentType, ReactNode } from "react";

const PURPOSES: {
  title: string;
  body: ReactNode;
  Icon: ComponentType;
}[] = [
  {
    title: "Vencer medos",
    body: (
      <>
        Escuro, agulha, primeira noite longe de casa… Nas histórias do{" "}
        <InlineBrand />, a criança se vê superando o que a assusta, com coragem
        e carinho.
      </>
    ),
    Icon: IconOvercomeFears,
  },
  {
    title: "Criar bons hábitos",
    body: "Troque a ansiedade dos jogos e dos vídeos curtos pela leitura que treina foco, calma e imaginação, um hábito que cresce com ela.",
    Icon: IconGoodHabits,
  },
  {
    title: "Construir valores",
    body: "Aventuras leves que ensinam os caminhos da família: respeito, generosidade e coragem. Sem sermão, só história boa de viver juntos.",
    Icon: IconBuildValues,
  },
];

export async function LandingHome({
  mockMode = false,
}: {
  mockMode?: boolean;
}) {
  const catalog = await getPlanCatalog();
  const cheapest = cheapestPlanFromCatalog(catalog);
  const priceLabel = formatCentsBrl(cheapest.priceCents);

  return (
    <div className="landing-root relative flex min-h-full flex-1 flex-col">
      <header className="landing-header relative z-20 flex items-center justify-between px-5 py-4 sm:px-8 md:px-12">
        <BrandLogo size="header" priority />
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="font-story-body text-[0.9rem] text-[var(--euzim-ink)] hover:bg-[var(--euzim-violet-soft)]"
        >
          <Link href="/login">Login</Link>
        </Button>
      </header>

      <section
        aria-label="Apresentação Euzim"
        className="landing-hero relative z-10 flex min-h-[calc(100svh-4.5rem)] flex-col overflow-hidden md:min-h-[calc(100svh-5rem)]"
      >
        <div
          aria-hidden
          className="landing-hero-atmosphere pointer-events-none absolute inset-0"
        />

        <div className="landing-hero-grid relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-5 px-5 pb-10 pt-2 sm:gap-6 sm:px-8 md:gap-8 md:px-12 md:pb-16 lg:gap-10">
          <div className="landing-hero-stack">
            <h1 className="landing-hero-title font-story-display max-w-[24ch] text-[1.85rem] leading-[1.05] text-[var(--euzim-ink)] uppercase sm:text-4xl md:text-[2.7rem] lg:text-[3.05rem]">
              Crie histórias onde a sua criança é a protagonista
            </h1>

            <div className="landing-hero-aside flex w-full flex-col items-start gap-5 md:gap-5">
              <div className="landing-hero-copy font-story-body max-w-md space-y-3 text-[0.98rem] leading-relaxed text-[var(--euzim-ink-soft)] sm:text-base md:max-w-lg md:text-[1.05rem]">
                <p>
                  Se o celular prende a atenção com jogos e vídeos sem fim, o{" "}
                  <InlineBrand /> constrói o{" "}
                  <span className="font-semibold text-[var(--euzim-ink)]">
                    hábito da leitura
                  </span>{" "}
                  com histórias em que{" "}
                  <span className="font-semibold text-[var(--euzim-ink)]">
                    ela é a protagonista
                  </span>
                  .
                </p>
                <p className="landing-hero-reassure">
                  E não se preocupe: você não precisa criar nenhuma história.{" "}
                  <mark className="landing-mark">nós fazemos tudo por você</mark>
                  .
                </p>
              </div>

              <div className="landing-hero-cta flex flex-col items-start gap-2.5 pt-1">
                <Button
                  asChild
                  size="lg"
                  className="landing-cta-btn h-auto min-h-12 gap-2 rounded-2xl border-0 px-5 py-3.5 font-story-body text-[0.95rem] font-semibold sm:text-base"
                >
                  <Link href="/signup">
                    <span className="landing-cta-star" aria-hidden />
                    Começar a criar histórias · {priceLabel}
                  </Link>
                </Button>
                <p className="landing-trust font-story-body text-[0.78rem] tracking-wide text-[var(--euzim-ink-soft)] sm:text-[0.82rem]">
                  Compra segura · Stripe · Acesso imediato
                </p>
              </div>

              {mockMode ? (
                <p className="font-story-body text-sm text-amber-800/90">
                  Modo demo: configure `.env.local` para login real.
                </p>
              ) : null}
            </div>
          </div>

          <div className="landing-hero-visual relative mx-auto w-full max-w-lg md:mx-0 md:max-w-none">
            <Image
              src="/brand/euzim-hero-book-breakout.png"
              alt="Crianças, um cachorro e um gato saltando de um livro mágico, como se saíssem da história"
              width={1131}
              height={809}
              priority
              className="landing-hero-image h-auto w-full bg-transparent object-contain object-bottom"
              sizes="(max-width: 768px) 92vw, 48vw"
            />
          </div>
        </div>

        <div
          aria-hidden
          className="landing-hero-wave pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-10 sm:h-14"
        />
      </section>

      <section
        id="proposito"
        aria-label="Benefícios do Euzim"
        className="landing-purpose relative z-10 px-5 py-14 sm:px-8 sm:py-16 md:px-12 md:py-20"
      >
        <div className="mx-auto max-w-5xl">
          <ul className="mt-0 grid list-none gap-10 p-0 md:grid-cols-3 md:gap-8 lg:gap-12">
            {PURPOSES.map(({ title, body, Icon }) => (
              <li key={title} className="landing-purpose-item flex flex-col gap-3">
                <Icon />
                <h3 className="font-story-display text-xl uppercase text-[var(--euzim-ink)]">
                  {title}
                </h3>
                <p className="font-story-body text-[0.98rem] leading-relaxed text-[var(--euzim-ink-soft)]">
                  {body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <LandingStoryBook />

      <LandingRoadmap entryPriceLabel={priceLabel} />

      <LandingOffer />

      <LandingAntiWoke />

      <LandingCast />

      <LandingFaq />

      <LandingFinalCta />

      <LandingFooter />
    </div>
  );
}
