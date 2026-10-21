"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Sparkles,
  UserPlus,
  Camera,
  PawPrint,
  Wand2,
  BookOpen,
} from "lucide-react";
import { InlineBrand } from "@/components/brand/inline-brand";
import { cn } from "@/lib/utils";

const SERENA_PHOTOS = [
  "/demo/roadmap/serena/photo-1.jpg",
  "/demo/roadmap/serena/photo-2.jpg",
  "/demo/roadmap/serena/photo-3.jpg",
  "/demo/roadmap/serena/photo-4.jpg",
] as const;

const BINGO_PHOTOS = [
  "/demo/roadmap/bingo/photo-1.jpg",
  "/demo/roadmap/bingo/photo-2.jpg",
  "/demo/roadmap/bingo/photo-3.jpg",
  "/demo/roadmap/bingo/photo-4.jpg",
] as const;

const THEME_FULL = "Vencer o medo de agulha";
const NAME_FULL = "Seu nome";
const EMAIL_FULL = "seuemail@gmail.com";
const PASS_LEN = 8;

const AI_MESSAGES = [
  "Contador Sábio escrevendo…",
  "Tecendo diálogos mágicos…",
  "Pintando cenas Pixar…",
  "Polindo a moral com carinho…",
  "Quase pronto…",
] as const;

type SignupPhase =
  | "cta"
  | "cta-press"
  | "form"
  | "typing-name"
  | "typing-email"
  | "typing-pass"
  | "ready"
  | "submit-press"
  | "done";

function PhotoGrid({
  photos,
  label,
}: {
  photos: readonly string[];
  label: string;
}) {
  return (
    <div className="landing-roadmap-photos" aria-label={label}>
      {photos.map((src, i) => (
        <figure
          key={src}
          className="landing-roadmap-photo"
          style={{ animationDelay: `${i * 120}ms` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`${label} ${i + 1}`} draggable={false} />
          <span className="landing-roadmap-photo-check" aria-hidden>
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        </figure>
      ))}
    </div>
  );
}

function SignupMock({ entryPriceLabel }: { entryPriceLabel: string }) {
  const priceLabel = entryPriceLabel;
  const [phase, setPhase] = useState<SignupPhase>("cta");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const id = window.setTimeout(() => resolve(), ms);
        timers.push(id);
      });

    const typeText = async (
      full: string,
      setter: (v: string) => void,
      speed = 48,
    ) => {
      for (let i = 1; i <= full.length; i++) {
        if (cancelled) return;
        setter(full.slice(0, i));
        await wait(speed);
      }
    };

    const run = async () => {
      while (!cancelled) {
        setPhase("cta");
        setName("");
        setEmail("");
        setPass(0);
        await wait(900);

        setPhase("cta-press");
        await wait(420);

        setPhase("form");
        await wait(500);

        setPhase("typing-name");
        await typeText(NAME_FULL, setName, 55);
        if (cancelled) return;

        setPhase("typing-email");
        await typeText(EMAIL_FULL, setEmail, 42);
        if (cancelled) return;

        setPhase("typing-pass");
        for (let i = 1; i <= PASS_LEN; i++) {
          if (cancelled) return;
          setPass(i);
          await wait(70);
        }

        setPhase("ready");
        await wait(450);

        setPhase("submit-press");
        await wait(480);

        setPhase("done");
        await wait(900);
      }
    };

    void run();
    return () => {
      cancelled = true;
      for (const id of timers) window.clearTimeout(id);
    };
  }, []);

  const showForm = phase !== "cta" && phase !== "cta-press";
  const ctaPressed = phase === "cta-press";
  const submitPressed = phase === "submit-press" || phase === "done";
  const activeField =
    phase === "typing-name"
      ? "name"
      : phase === "typing-email"
        ? "email"
        : phase === "typing-pass"
          ? "pass"
          : null;

  return (
    <div className="landing-roadmap-signup-stage" aria-hidden>
      <div
        className={cn(
          "landing-roadmap-signup-cta-hero",
          ctaPressed && "is-pressed",
          showForm && "is-exit",
        )}
      >
        <span className="landing-cta-star" aria-hidden />
        Começar a criar a história - {priceLabel}
        <span
          className={cn(
            "landing-roadmap-pointer",
            (phase === "cta" || phase === "cta-press") && "is-visible",
            ctaPressed && "is-tap",
          )}
        />
      </div>

      <div
        className={cn(
          "landing-roadmap-signup",
          showForm && "is-visible",
          phase === "done" && "is-success",
        )}
      >
        <div className="landing-roadmap-signup-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/euzim-logo-color.png"
            alt=""
            className="h-8 w-auto object-contain"
          />
          <p className="font-story-body text-xs text-[var(--euzim-ink-soft)]">
            Crie sua conta em segundos
          </p>
        </div>
        <div className="space-y-2.5">
          <div
            className={cn(
              "landing-roadmap-field",
              activeField === "name" && "is-active",
            )}
          >
            <span>Nome</span>
            <strong>
              {name}
              {activeField === "name" ? (
                <span className="landing-roadmap-caret" />
              ) : null}
            </strong>
          </div>
          <div
            className={cn(
              "landing-roadmap-field",
              activeField === "email" && "is-active",
            )}
          >
            <span>E-mail</span>
            <strong>
              {email}
              {activeField === "email" ? (
                <span className="landing-roadmap-caret" />
              ) : null}
            </strong>
          </div>
          <div
            className={cn(
              "landing-roadmap-field",
              activeField === "pass" && "is-active",
            )}
          >
            <span>Senha</span>
            <strong>
              {"•".repeat(pass)}
              {activeField === "pass" ? (
                <span className="landing-roadmap-caret" />
              ) : null}
            </strong>
          </div>
        </div>
        <div
          className={cn(
            "landing-roadmap-signup-cta",
            submitPressed && "is-pressed",
          )}
        >
          Criar conta
          <span
            className={cn(
              "landing-roadmap-pointer is-on-submit",
              (phase === "ready" ||
                phase === "submit-press" ||
                phase === "done") &&
                "is-visible",
              submitPressed && "is-tap",
            )}
          />
        </div>
      </div>
    </div>
  );
}

function ThemeTypingMock() {
  const [typed, setTyped] = useState("");
  const [chipPulse, setChipPulse] = useState(false);

  useEffect(() => {
    let i = 0;
    let typeId = 0;
    let pauseId = 0;
    let cancelled = false;

    const startTyping = () => {
      if (cancelled) return;
      setChipPulse(false);
      setTyped("");
      i = 0;
      typeId = window.setInterval(() => {
        if (cancelled) return;
        i += 1;
        setTyped(THEME_FULL.slice(0, i));
        if (i >= THEME_FULL.length) {
          window.clearInterval(typeId);
          setChipPulse(true);
          pauseId = window.setTimeout(startTyping, 2200);
        }
      }, 55);
    };

    startTyping();
    return () => {
      cancelled = true;
      window.clearInterval(typeId);
      window.clearTimeout(pauseId);
    };
  }, []);

  return (
    <div className="landing-roadmap-theme">
      <div className="landing-roadmap-avatars" aria-hidden>
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo/roadmap/avatars/serena.jpg" alt="" />
          <figcaption>Serena</figcaption>
        </figure>
        <span className="landing-roadmap-avatars-plus">+</span>
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/demo/roadmap/avatars/bingo.jpg" alt="" />
          <figcaption>Bingo</figcaption>
        </figure>
      </div>

      <div className="landing-roadmap-theme-card">
        <div className="landing-roadmap-theme-title">
          <Wand2 className="size-4 text-[var(--euzim-violet)]" />
          <span className="font-heading font-semibold">Nova História</span>
        </div>
        <label className="landing-roadmap-theme-label">Tema</label>
        <div className="landing-roadmap-theme-input" aria-live="polite">
          <span>{typed}</span>
          <span className="landing-roadmap-caret" aria-hidden />
        </div>
        <div className="landing-roadmap-chips">
          {[
            "Vencer o medo de agulha",
            "Vencer o medo de escuro",
            "Aprendendo a dividir",
          ].map((chip) => (
            <span
              key={chip}
              className={cn(
                "landing-roadmap-chip",
                chipPulse && chip === THEME_FULL && "is-active",
              )}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AiWorkingMock() {
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setMsg((m) => (m + 1) % AI_MESSAGES.length);
    }, 2400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="landing-roadmap-ai">
      <div className="landing-roadmap-ai-orbit" aria-hidden>
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="landing-roadmap-ai-core">
        <Sparkles className="size-7 animate-spin [animation-duration:3.2s]" />
      </div>
      <p className="font-heading text-sm font-semibold text-amber-950 sm:text-base">
        {AI_MESSAGES[msg]}
      </p>
      <div className="landing-roadmap-ai-frames" aria-hidden>
        <div className="landing-roadmap-ai-frame is-a" />
        <div className="landing-roadmap-ai-frame is-b" />
        <div className="landing-roadmap-ai-frame is-c" />
      </div>
      <p className="text-xs text-amber-900/70">
        A Euzim escreve, ilustra e monta o livro completo por você.
      </p>
    </div>
  );
}

function BookCoversMock() {
  return (
    <div className="landing-roadmap-covers">
      <figure className="landing-roadmap-cover is-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/demo/roadmap/covers/agulha.jpg"
          alt="Capa Serena e o Medo da Agulha"
        />
        <figcaption>
          Serena e o Medo
          <br />
          da Agulha
        </figcaption>
      </figure>
      <figure className="landing-roadmap-cover is-right">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/demo/roadmap/covers/compaixao.jpg"
          alt="Capa Serena e a Luz da Compaixão"
        />
        <figcaption>
          Serena e a Luz
          <br />
          da Compaixão
        </figcaption>
      </figure>
    </div>
  );
}

const STEPS: {
  n: number;
  title: string;
  Icon: typeof UserPlus;
  visual: "signup" | "serena" | "bingo" | "theme" | "ai" | "covers";
}[] = [
  {
    n: 1,
    title: "Faça o seu cadastro na Euzim",
    Icon: UserPlus,
    visual: "signup",
  },
  {
    n: 2,
    title: "Envie fotos da sua criança para criar o avatar",
    Icon: Camera,
    visual: "serena",
  },
  {
    n: 3,
    title: "Envie fotos do pet ou do brinquedo favorito da sua criança",
    Icon: PawPrint,
    visual: "bingo",
  },
  {
    n: 4,
    title: "Com o avatar gerado, dê um tema para a sua história",
    Icon: Wand2,
    visual: "theme",
  },
  {
    n: 5,
    title: "Aguarde a Euzim gerar a história",
    Icon: Sparkles,
    visual: "ai",
  },
  {
    n: 6,
    title: "Curta a leitura com a sua criança",
    Icon: BookOpen,
    visual: "covers",
  },
];

function StepVisual({
  kind,
  entryPriceLabel,
}: {
  kind: (typeof STEPS)[number]["visual"];
  entryPriceLabel: string;
}) {
  switch (kind) {
    case "signup":
      return <SignupMock entryPriceLabel={entryPriceLabel} />;
    case "serena":
      return <PhotoGrid photos={SERENA_PHOTOS} label="Fotos da Serena" />;
    case "bingo":
      return <PhotoGrid photos={BINGO_PHOTOS} label="Fotos do Bingo" />;
    case "theme":
      return <ThemeTypingMock />;
    case "ai":
      return <AiWorkingMock />;
    case "covers":
      return <BookCoversMock />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function LandingRoadmap({
  entryPriceLabel,
}: {
  entryPriceLabel: string;
}) {
  return (
    <section
      id="como-funciona"
      aria-labelledby="roadmap-heading"
      className="landing-roadmap relative z-10 px-5 py-16 sm:px-8 sm:py-20 md:px-12 md:py-24"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-14">
          <h2
            id="roadmap-heading"
            className="font-story-display text-2xl uppercase leading-[1.15] text-[var(--euzim-ink)] sm:text-3xl md:text-[2.15rem]"
          >
            É assim que você cria a história da sua criança na <InlineBrand />
          </h2>
          <p className="font-story-body mt-4 text-base leading-relaxed text-[var(--euzim-ink-soft)] sm:text-[1.08rem]">
            Em apenas 6 passos rápidos, você gera a primeira história que a sua
            criança vai protagonizar.
          </p>
        </div>

        <ol className="landing-roadmap-list">
          {STEPS.map((step, idx) => {
            const Icon = step.Icon;
            const reverse = idx % 2 === 1;
            return (
              <li
                key={step.n}
                className={cn("landing-roadmap-step", reverse && "is-reverse")}
              >
                <div className="landing-roadmap-rail" aria-hidden>
                  <span className="landing-roadmap-dot">{step.n}</span>
                  {idx < STEPS.length - 1 ? (
                    <span className="landing-roadmap-line" />
                  ) : null}
                </div>

                <div className="landing-roadmap-copy">
                  <p className="landing-roadmap-kicker">
                    <Icon className="size-3.5" />
                    Passo {step.n}
                  </p>
                  <h3 className="font-story-display text-xl uppercase leading-snug text-[var(--euzim-ink)] sm:text-[1.35rem]">
                    {step.title.includes("euzim") ? (
                      <>
                        Faça o seu cadastro na <InlineBrand />
                      </>
                    ) : step.title.includes("Euzim") ? (
                      <>
                        Aguarde a <InlineBrand /> gerar a história
                      </>
                    ) : (
                      step.title
                    )}
                  </h3>
                </div>

                <div className="landing-roadmap-visual">
                  <StepVisual
                    kind={step.visual}
                    entryPriceLabel={entryPriceLabel}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
