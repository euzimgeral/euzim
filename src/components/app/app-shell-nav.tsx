"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Baby,
  Gift,
  Heart,
  Menu,
  Shield,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import { PinGuardButton } from "@/components/kids/pin-guard";
import { signOutAction } from "@/lib/auth/actions";
import type { AuthUser } from "@/lib/auth/types";
import { PLATFORM_BUILD } from "@/lib/platform-build";

type NavLink = {
  href: string;
  label: string;
  icon: typeof Heart;
};

export function AppShellNav({
  user,
  title,
  kidsMode = false,
}: {
  user: AuthUser;
  title: string;
  kidsMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isAdmin = user.role === "admin";

  const links: NavLink[] = [
    { href: "/app/social", label: "Social", icon: Heart },
    { href: "/app/parent", label: "Criação", icon: Users },
    { href: "/app/kids", label: "Leitura", icon: Baby },
    { href: "/app/parent/gifts", label: "Presentes", icon: Gift },
    ...(isAdmin
      ? [{ href: "/app/admin", label: "Administrador", icon: Shield }]
      : []),
    {
      href: isAdmin ? "/app/admin/settings" : "/app/parent/settings",
      label: "Perfil",
      icon: UserRound,
    },
  ];

  const kidsLinks: NavLink[] = [
    { href: "/app/social?mode=kids", label: "Social", icon: Heart },
    { href: "/app/kids", label: "Leitura", icon: Baby },
  ];

  const navLinks = kidsMode ? kidsLinks : links;

  return (
    <>
      <header className="relative z-40 border-b border-border/70 px-4 py-3 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandLogo
              size="header"
              href={kidsMode ? "/app/kids" : "/app/parent"}
            />
            {title.trim() ? (
              <span className="hidden truncate text-sm text-muted-foreground lg:inline">
                / {title}
              </span>
            ) : null}
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {kidsMode ? (
              <>
                {kidsLinks.map(({ href, label, icon: Icon }) => (
                  <Button key={href} asChild variant="ghost" size="sm">
                    <Link href={href} className="gap-1.5">
                      <Icon className="size-3.5" />
                      {label}
                    </Link>
                  </Button>
                ))}
                <PinGuardButton
                  label="Criação"
                  href="/app/parent"
                  skipPin={isAdmin}
                />
              </>
            ) : (
              links.map(({ href, label, icon: Icon }) => (
                <Button key={href} asChild variant="ghost" size="sm">
                  <Link href={href} className="gap-1.5">
                    <Icon className="size-3.5" />
                    {label}
                  </Link>
                </Button>
              ))
            )}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {!kidsMode ? (
              <>
                <span className="max-w-[180px] truncate text-xs text-muted-foreground lg:max-w-[240px]">
                  {user.email}
                  {user.isMock ? " · mock" : ""}
                </span>
                <form action={signOutAction}>
                  <Button type="submit" variant="outline" size="sm">
                    Sair
                  </Button>
                </form>
              </>
            ) : null}
            <span
              className="font-mono text-[10px] font-semibold text-emerald-800"
              title="Versão da plataforma"
            >
              {PLATFORM_BUILD}
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-[min(20rem,88vw)] flex-col border-l border-border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <BrandLogo size="compact" href={kidsMode ? "/app/kids" : "/app/parent"} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={() => setOpen(false)}
              >
                <X className="size-5" />
              </Button>
            </div>
            <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {!kidsMode ? (
                <p className="mb-2 truncate px-2 text-xs text-muted-foreground">
                  {user.email}
                  {user.isMock ? " · mock" : ""}
                  {isAdmin ? " · admin" : ""}
                </p>
              ) : null}
              {navLinks.map(({ href, label, icon: Icon }) => (
                <Button
                  key={href}
                  asChild
                  variant="ghost"
                  className="justify-start gap-2"
                  onClick={() => setOpen(false)}
                >
                  <Link href={href}>
                    <Icon className="size-4" />
                    {label}
                  </Link>
                </Button>
              ))}
              {kidsMode ? (
                <div className="mt-2 px-1" onClick={() => setOpen(false)}>
                  <PinGuardButton
                    label="Criação"
                    href="/app/parent"
                    skipPin={isAdmin}
                  />
                </div>
              ) : (
                <form action={signOutAction} className="mt-2">
                  <Button type="submit" variant="outline" className="w-full">
                    Sair
                  </Button>
                </form>
              )}
              <p className="mt-auto px-2 pt-6 font-mono text-[10px] font-semibold text-emerald-800">
                Versão {PLATFORM_BUILD}
              </p>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
