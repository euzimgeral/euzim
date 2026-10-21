"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandLogo } from "@/components/brand/brand-logo";
import {
  signInAction,
  signUpAction,
  type AuthActionResult,
} from "@/lib/auth/actions";
import { trackBrowserEvent } from "@/lib/tracking/client-browser";

type Mode = "login" | "signup";

const initial: AuthActionResult = {};

export function AuthForm({
  mode,
  mockMode,
  nextPath,
}: {
  mode: Mode;
  mockMode: boolean;
  /** Após auth, redireciona para este path (ex. convite / onboarding). */
  nextPath?: string | null;
}) {
  const action = mode === "login" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(
    async (prev: AuthActionResult, formData: FormData) => {
      if (mode === "signup") {
        const email = String(formData.get("email") ?? "")
          .trim()
          .toLowerCase();
        const fullName = String(formData.get("fullName") ?? "").trim();
        const phoneRaw = String(formData.get("phone") ?? "").trim();
        const phoneDigits = phoneRaw.replace(/\D/g, "");
        const phone =
          phoneDigits && phoneDigits.length >= 8 && phoneDigits.length <= 20
            ? phoneDigits
            : null;
        const eventId = crypto.randomUUID();
        formData.set("leadEventId", eventId);
        // Browser primeiro; CAPI no server com o mesmo event_id (dedupe Meta).
        await trackBrowserEvent({
          event: "Lead",
          eventId,
          mirrorServer: false,
          user: {
            email: email || null,
            fullName: fullName || null,
            phone,
          },
          commerce: { product: "Cadastro Euzim" },
        });
      }
      return action(prev, formData);
    },
    initial,
  );
  const safeNext =
    nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
      ? nextPath
      : null;
  const altHref = (base: string) =>
    safeNext ? `${base}?next=${encodeURIComponent(safeNext)}` : base;

  return (
    <Card className="w-full max-w-md border-border/60 shadow-none">
      <CardHeader className="space-y-4">
        <BrandLogo size="auth" href="/" priority className="mx-auto sm:mx-0" />
        <div className="space-y-1.5">
          <CardTitle className="font-heading text-2xl">
            {mode === "login" ? "Entrar" : "Criar conta"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Acesse o Euzim com seu e-mail."
              : "Comece a personalizar histórias para sua criança."}
          </CardDescription>
        </div>
      </CardHeader>
      <form action={formAction}>
        {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
        <CardContent className="space-y-4">
          {mockMode ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Modo demo ativo — conta em nuvem não configurada. Sessão
              fica em cookies locais.
            </p>
          ) : null}
          {mode === "signup" ? (
            <div className="space-y-2">
              <Label htmlFor="fullName">Seu nome</Label>
              <Input
                id="fullName"
                name="fullName"
                autoComplete="name"
                placeholder="Maria Silva"
              />
            </div>
          ) : null}
          {mode === "signup" ? (
            <div className="space-y-2">
              <Label htmlFor="phone">
                Telefone{" "}
                <span className="font-normal text-muted-foreground">
                  (opcional)
                </span>
              </Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="11999998888"
              />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@email.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
            />
          </div>
          {state.error ? (
            <p className="text-sm text-destructive" role="alert">
              {/fetch failed/i.test(state.error)
                ? "Não foi possível conectar ao servidor de login (rede/Supabase). Aguarde alguns segundos e tente de novo."
                : state.error}
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" disabled={pending} size="lg">
            {pending
              ? "Aguarde…"
              : mode === "login"
                ? "Entrar"
                : "Criar conta"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                Não tem conta?{" "}
                <Link
                  href={altHref("/signup")}
                  className="text-foreground underline"
                >
                  Cadastre-se
                </Link>
              </>
            ) : (
              <>
                Já tem conta?{" "}
                <Link
                  href={altHref("/login")}
                  className="text-foreground underline"
                >
                  Entrar
                </Link>
              </>
            )}
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
