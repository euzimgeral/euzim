"use client";

import { useEffect, useState, useTransition } from "react";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMyReferralPointsAction,
  redeemReferralPointsAction,
} from "@/lib/referral/actions";

export function RedeemPointsPanel() {
  const [points, setPoints] = useState<number | null>(null);
  const [stories, setStories] = useState(0);
  const [avatars, setAvatars] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMyReferralPointsAction().then((res) => {
      if (cancelled) return;
      if (typeof res.points === "number") setPoints(res.points);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cost = stories * 1 + avatars * 2;

  function redeem() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await redeemReferralPointsAction({ stories, avatars });
      if (res.error) {
        setError(res.error);
        if (typeof res.balance === "number") setPoints(res.balance);
        return;
      }
      setMessage("Presente creditado na sua conta!");
      if (typeof res.balance === "number") setPoints(res.balance);
      setStories(0);
      setAvatars(0);
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border/60 p-4">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
        <Gift className="size-4" />
        Seus pontos de indicação
      </h2>
      <p className="text-sm text-muted-foreground">
        Saldo:{" "}
        <span className="font-medium text-foreground">
          {points == null ? "…" : `${points} ponto(s)`}
        </span>
        . 1 ponto = 1 história · 2 pontos = 1 avatar.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="redeem-stories">Histórias (1 pt cada)</Label>
          <Input
            id="redeem-stories"
            type="number"
            min={0}
            step={1}
            value={stories}
            onChange={(e) => setStories(Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="redeem-avatars">Avatares (2 pts cada)</Label>
          <Input
            id="redeem-avatars"
            type="number"
            min={0}
            step={1}
            value={avatars}
            onChange={(e) => setAvatars(Number(e.target.value) || 0)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || cost <= 0 || (points != null && cost > points)}
          onClick={redeem}
        >
          Resgatar ({cost} pts)
        </Button>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {message ? (
          <p className="text-xs text-emerald-800">{message}</p>
        ) : null}
      </div>
    </section>
  );
}
