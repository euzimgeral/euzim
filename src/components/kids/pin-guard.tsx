"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { verifyParentPinAction } from "@/lib/auth/pin-actions";

export function PinGuardButton({
  label = "Criação",
  href = "/app/parent",
  skipPin = false,
}: {
  label?: string;
  href?: string;
  /** Admin troca Criação/Leitura/Social sem PIN. */
  skipPin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await verifyParentPinAction(pin);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setPin("");
      router.push(href);
    });
  }

  if (skipPin) {
    return (
      <Button asChild variant="outline" className="gap-2">
        <Link href={href}>
          <Lock className="size-4" />
          {label}
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Lock className="size-4" />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>PIN de segurança</DialogTitle>
            <DialogDescription>
              Digite o PIN dos pais para sair da área de Leitura.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="parent-pin">PIN</Label>
            <Input
              id="parent-pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,6}"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              autoFocus
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={pending || pin.length < 4}>
              {pending ? "Verificando…" : "Continuar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
