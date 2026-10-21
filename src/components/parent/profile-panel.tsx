"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import {
  SubscriptionPanel,
  type BillingSnapshot,
} from "@/components/parent/subscription-panel";
import type { StoryPlan } from "@/lib/billing/plans";
import { updateProfileAction } from "@/lib/profile/actions";

export type ProfileSnapshot = {
  email: string;
  fullName: string;
  phone: string;
  cpf: string;
  storiesCount: number;
  charactersCount: number;
  friendsCount: number;
};

export function ProfilePanel({
  profile,
  billing,
  plans,
}: {
  profile: ProfileSnapshot;
  billing: BillingSnapshot;
  plans?: StoryPlan[];
}) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone);
  const [cpf, setCpf] = useState(profile.cpf);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function save() {
    setError(null);
    setOk(null);
    startTransition(async () => {
      const result = await updateProfileAction({ fullName, phone, cpf });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOk("Perfil atualizado.");
    });
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Histórias</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">
              {profile.storiesCount}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personagens</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold">
              {profile.charactersCount}
            </p>
          </CardContent>
        </Card>
        <Link href="/app/social" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Card className="h-full shadow-none transition hover:border-foreground/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Amigos</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-3xl font-semibold">
                {profile.friendsCount}
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Dados pessoais</CardTitle>
          <CardDescription>
            Preencha o que faltar. E-mail vem da conta e não muda aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" value={profile.email} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Nome</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11999998888"
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpf">CPF</Label>
            <Input
              id="cpf"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="00000000000"
              inputMode="numeric"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {ok ? <p className="text-sm text-emerald-700">{ok}</p> : null}
          <Button type="button" disabled={pending} onClick={save}>
            {pending ? "Salvando…" : "Salvar perfil"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Alterar senha</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <SubscriptionPanel billing={billing} plans={plans} />
    </div>
  );
}
