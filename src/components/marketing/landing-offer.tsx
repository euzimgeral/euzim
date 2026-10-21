import Link from "next/link";
import { BookOpen, Check, FileText, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPlanCatalog } from "@/lib/billing/plan-catalog";
import type { PlanCatalogRow } from "@/lib/billing/plan-catalog-shared";
import { subscriptionPlansFromCatalog } from "@/lib/billing/plans-from-catalog";
import type { StoryPlan } from "@/lib/billing/plans";
import { signupPathForPlan } from "@/lib/billing/selected-plan";
import { cn } from "@/lib/utils";

function buildCards(rows: PlanCatalogRow[]) {
  const plans = subscriptionPlansFromCatalog(rows);
  const byKey = new Map(rows.map((r) => [r.planKey, r]));

  const meta: Array<{
    planId: string;
    badge: string;
    favorite: boolean;
    cta: string;
  }> = [
    {
      planId: "starter",
      badge: "Para Aventureiros",
      favorite: false,
      cta: "Quero começar a criar",
    },
    {
      planId: "family",
      badge: "Para Realizadores",
      favorite: true,
      cta: "Quero criar novos hábitos",
    },
    {
      planId: "plus",
      badge: "Para Exploradores Plus",
      favorite: false,
      cta: "Quero o máximo de histórias",
    },
  ];

  return meta
    .map((m) => {
      const plan = plans.find((p) => p.planId === m.planId);
      const row = byKey.get(m.planId as PlanCatalogRow["planKey"]);
      if (!plan || !row) return null;
      const description =
        row.description.trim() ||
        `${plan.includedCharacters} avatares e ${plan.storiesPerMonth} histórias por mês.`;
      const highlights = [
        {
          icon: Users,
          text:
            m.planId === "starter"
              ? `${plan.includedCharacters} personagens (avatares)`
              : `${plan.includedCharacters} avatares`,
        },
        {
          icon: BookOpen,
          text:
            m.planId === "starter"
              ? `${plan.storiesPerMonth} histórias novas todo mês`
              : `${plan.storiesPerMonth} histórias por mês`,
        },
        {
          icon: Sparkles,
          text: "Geração com IA inclusa",
        },
        {
          icon: FileText,
          text: description,
        },
      ];
      return {
        plan,
        badge: m.badge,
        favorite: m.favorite,
        cta: m.cta,
        description,
        highlights,
      };
    })
    .filter(Boolean) as Array<{
    plan: StoryPlan;
    badge: string;
    favorite: boolean;
    cta: string;
    description: string;
    highlights: Array<{ icon: typeof Users; text: string }>;
  }>;
}

export async function LandingOffer() {
  const rows = await getPlanCatalog();
  const cards = buildCards(rows);

  return (
    <section
      id="oferta"
      aria-labelledby="offer-heading"
      className="landing-offer relative z-10 overflow-hidden px-5 py-16 sm:px-8 sm:py-20 md:px-12 md:py-24"
    >
      <div aria-hidden className="landing-offer-glow" />

      <div className="relative mx-auto max-w-6xl">
        <div className="mx-auto mb-10 max-w-2xl text-center sm:mb-14">
          <h2 id="offer-heading" className="landing-offer-title">
            Sua criança merece ser protagonista
          </h2>
          <p className="landing-offer-lede">
            Comece agora a criar as histórias que vão mudar os hábitos da sua
            criança em poucos passos.
          </p>
        </div>

        <div className="landing-offer-grid">
          {cards.map(({ plan, badge, favorite, cta, highlights }) => (
            <article
              key={plan.planId}
              className={cn(
                "landing-offer-card",
                `is-${plan.planId}`,
                favorite && "is-favorite",
              )}
            >
              {favorite ? (
                <span className="landing-offer-favorite">Favorito</span>
              ) : null}

              <p className="landing-offer-kicker">{badge}</p>

              <div className="landing-offer-price-row">
                <p className="landing-offer-price">
                  <span className="landing-offer-currency">R$</span>
                  <span className="landing-offer-amount">
                    {plan.priceBrl.toFixed(2).replace(".", ",")}
                  </span>
                  <span className="landing-offer-period">/mês</span>
                </p>
              </div>

              <ul className="landing-offer-list">
                {highlights.map(({ icon: Icon, text }) => (
                  <li key={text}>
                    <span className="landing-offer-check" aria-hidden>
                      <Icon className="size-3.5" strokeWidth={2.4} />
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ul>

              <Button
                asChild
                size="lg"
                className="landing-offer-cta landing-cta-btn mt-auto h-auto min-h-12 w-full gap-2 rounded-2xl border-0 px-5 py-3.5 font-story-body text-[0.95rem] font-semibold"
              >
                <Link
                  href={signupPathForPlan(
                    plan.planId as "starter" | "family" | "plus",
                  )}
                >
                  <Check className="size-4" aria-hidden />
                  {cta}
                </Link>
              </Button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
