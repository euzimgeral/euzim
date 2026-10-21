"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  Camera,
  Check,
  Heart,
  Lock,
  PawPrint,
  ToyBrick,
  UserRound,
} from "lucide-react";
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
import {
  PhotoSlotGrid,
  type SlotPhotos,
} from "@/components/onboarding/photo-slot-grid";
import {
  AvatarStudyDialog,
  type AvatarStudySubject,
} from "@/components/onboarding/avatar-study-dialog";
import {
  saveChildAvatarProfileAction,
  saveFriendProfileAction,
  saveSubjectPhotosAction,
} from "@/lib/onboarding/actions";
import {
  REQUIRED_CHILD_PHOTO_COUNT,
  REQUIRED_FRIEND_PHOTO_COUNT,
} from "@/lib/onboarding/photo-slots";
import {
  GENDER_LABELS,
  ageYearsFromBirthDate,
  type ChildGender,
} from "@/lib/onboarding/child-profile";
import { isPixarGeneratedUrl } from "@/lib/onboarding/pixar-url";
import { MagicalLoading } from "@/components/ui/magical-loading";
import { trackBrowserEvent } from "@/lib/tracking/client-browser";
import type { OnboardingState } from "@/lib/auth/types";
import {
  SUBSCRIPTION_PLANS,
  type StoryPlan,
} from "@/lib/billing/plans";
import {
  parseSelectedPlanId,
  type SelectedPlanId,
} from "@/lib/billing/selected-plan";
import { formatBrl } from "@/lib/billing/character-packs";
import { startPlanCheckoutAction } from "@/lib/stripe/checkout-actions";
import { goToCheckout } from "@/lib/stripe/go-checkout";

const PREFERRED_PLAN_KEY = "euzim_preferred_plan";

type Step =
  | "child"
  | "child-photos"
  | "friend"
  | "friend-photos"
  | "choose-plan"
  | "generating"
  | "preview"
  | "pin";

/** Fluxo completo (Plano/Magia/Pronto/PIN fora da tab bar). */
const FLOW_STEPS: Step[] = [
  "child",
  "child-photos",
  "friend",
  "friend-photos",
  "choose-plan",
  "generating",
  "preview",
  "pin",
];

/** Abas visíveis: só Sobre, Criança, Amigo, Fotos. */
const TAB_STEPS: { id: Step; label: string }[] = [
  { id: "child", label: "Sobre" },
  { id: "child-photos", label: "Criança" },
  { id: "friend", label: "Amigo" },
  { id: "friend-photos", label: "Fotos" },
];

const STEP_IDS = new Set(FLOW_STEPS);

type AvatarBundle = {
  childAvatarUrl: string;
  friendAvatarUrl: string;
  childFaceSheetUrl: string | null;
  childBodySheetUrl: string | null;
  friendSheetUrl: string | null;
  engine: string | null;
};

function photosToMap(
  photos: OnboardingState["childPhotos"] | undefined,
): SlotPhotos {
  const map: SlotPhotos = {};
  for (const p of photos ?? []) {
    if (p.slotId) map[p.slotId] = p;
  }
  return map;
}

function resolveInitialStep(
  initialState: OnboardingState | null,
  isReuse: boolean,
  resumeAfterPay = false,
): Step {
  // Stripe success: fotos intactas → gera avatar
  if (resumeAfterPay) return "generating";
  const saved = initialState?.wizardStep;
  // "welcome" legado → começa em Avatar do filho
  if (saved === "welcome") return "child";
  if (saved && STEP_IDS.has(saved as Step) && saved !== "generating") {
    return saved as Step;
  }
  if (
    isReuse &&
    initialState?.childAvatarUrl &&
    initialState?.friendAvatarUrl
  ) {
    return "preview";
  }
  if (initialState?.childAvatarUrl && initialState?.friendAvatarUrl) {
    return "preview";
  }
  if (initialState?.friend?.displayName) return "friend-photos";
  if (
    (initialState?.childPhotos?.length ?? 0) >= REQUIRED_CHILD_PHOTO_COUNT ||
    (initialState?.photos?.length ?? 0) >= REQUIRED_CHILD_PHOTO_COUNT
  ) {
    return "friend";
  }
  if (initialState?.child?.displayName) return "child-photos";
  if (isReuse && initialState?.child?.displayName) return "child";
  return "child";
}

export function OnboardingWizard({
  initialState,
  mockMode,
  resetMode = null,
  resumeAfterPay = false,
  preferredPlan = null,
  catalogPlans = SUBSCRIPTION_PLANS,
}: {
  initialState: OnboardingState | null;
  mockMode: boolean;
  resetMode?: "full" | "reuse" | null;
  /** Após Stripe: retoma em generating com fotos salvas. */
  resumeAfterPay?: boolean;
  /** Plano pré-escolhido na oferta da landing → checkout direto. */
  preferredPlan?: SelectedPlanId | null;
  /** Catálogo vivo (Admin Planos); fallback = defaults sync. */
  catalogPlans?: StoryPlan[];
}) {
  const isReuse = resetMode === "reuse";
  const [step, setStep] = useState<Step>(() =>
    resolveInitialStep(initialState, isReuse, resumeAfterPay),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const autoCheckoutRef = useRef(false);
  const [lockedPlan, setLockedPlan] = useState<SelectedPlanId | null>(
    preferredPlan,
  );

  useEffect(() => {
    if (preferredPlan) {
      setLockedPlan(preferredPlan);
      try {
        window.sessionStorage.setItem(PREFERRED_PLAN_KEY, preferredPlan);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const stored = parseSelectedPlanId(
        window.sessionStorage.getItem(PREFERRED_PLAN_KEY),
      );
      if (stored) setLockedPlan(stored);
    } catch {
      /* ignore */
    }
  }, [preferredPlan]);
  const [childPhotos, setChildPhotos] = useState<SlotPhotos>(() =>
    photosToMap(initialState?.childPhotos ?? initialState?.photos),
  );
  const [friendPhotos, setFriendPhotos] = useState<SlotPhotos>(() =>
    photosToMap(initialState?.friendPhotos),
  );
  const [childName, setChildName] = useState(
    initialState?.child?.displayName ?? "",
  );
  const [birthDate, setBirthDate] = useState(
    initialState?.child?.birthDate ?? "",
  );
  const [gender, setGender] = useState<ChildGender>(() => {
    const g = initialState?.child?.gender;
    return g === "girl" || g === "boy" ? g : "boy";
  });
  const [avatarRedoUsed, setAvatarRedoUsed] = useState(
    Boolean(initialState?.avatarRedoUsed),
  );
  const [versionPick, setVersionPick] = useState<{
    a: AvatarBundle;
    b: AvatarBundle;
  } | null>(null);
  const [pickChild, setPickChild] = useState<"a" | "b">("b");
  const [pickFriend, setPickFriend] = useState<"a" | "b">("b");
  const derivedAge = birthDate ? ageYearsFromBirthDate(birthDate) : null;
  const [friendName, setFriendName] = useState(
    initialState?.friend?.displayName ?? "",
  );
  const [friendKind, setFriendKind] = useState<"pet" | "toy">(
    initialState?.friend?.kind ?? "pet",
  );
  const [friendGender, setFriendGender] = useState(() => {
    const g = initialState?.friend?.gender ?? "";
    return g === "male" || g === "female" ? g : "";
  });
  const [hasFather, setHasFather] = useState(
    Boolean(initialState?.child?.hasFather),
  );
  const [fatherName, setFatherName] = useState(
    initialState?.child?.fatherName ?? "",
  );
  const [fatherBirthDate, setFatherBirthDate] = useState(
    initialState?.child?.fatherBirthDate ?? "",
  );
  const [hasMother, setHasMother] = useState(
    Boolean(initialState?.child?.hasMother),
  );
  const [motherName, setMotherName] = useState(
    initialState?.child?.motherName ?? "",
  );
  const [motherBirthDate, setMotherBirthDate] = useState(
    initialState?.child?.motherBirthDate ?? "",
  );
  const [childAvatarUrl, setChildAvatarUrl] = useState<string | null>(
    initialState?.childAvatarUrl ?? null,
  );
  const [friendAvatarUrl, setFriendAvatarUrl] = useState<string | null>(
    initialState?.friendAvatarUrl ?? null,
  );
  const [childFaceSheetUrl, setChildFaceSheetUrl] = useState<string | null>(
    initialState?.childFaceSheetUrl ?? null,
  );
  const [childBodySheetUrl, setChildBodySheetUrl] = useState<string | null>(
    initialState?.childBodySheetUrl ?? null,
  );
  const [friendSheetUrl, setFriendSheetUrl] = useState<string | null>(
    initialState?.friendSheetUrl ?? null,
  );
  const [engine, setEngine] = useState<string | null>(null);
  const [studySubject, setStudySubject] = useState<AvatarStudySubject | null>(
    null,
  );

  const tabIndex = TAB_STEPS.findIndex((s) => s.id === step);
  const tabsComplete = tabIndex < 0;

  const childFilled = useMemo(
    () => Object.keys(childPhotos).length,
    [childPhotos],
  );
  const friendFilled = useMemo(
    () => Object.keys(friendPhotos).length,
    [friendPhotos],
  );

  function go(next: Step) {
    setError(null);
    setStep(next);
    // API leve  -  evita Server Action / Set-Cookie >4KB que falhava no console
    void fetch("/api/onboarding/wizard-step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: next }),
    }).catch(() => {
      /* progresso local já atualizado */
    });
  }

  async function runPixarGeneration(): Promise<AvatarBundle | false> {
    const res = await fetch("/api/onboarding/generate-avatars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    let gen: {
      error?: string;
      childAvatarUrl?: string;
      friendAvatarUrl?: string;
      childFaceSheetUrl?: string;
      childBodySheetUrl?: string;
      friendSheetUrl?: string;
      engine?: string;
    } = {};
    try {
      gen = (await res.json()) as typeof gen;
    } catch {
      setError(`Falha na geração (${res.status}).`);
      return false;
    }
    if (!res.ok || gen.error) {
      setError(gen.error || `Falha na geração (${res.status}).`);
      return false;
    }
    if (
      !isPixarGeneratedUrl(gen.childAvatarUrl) ||
      !isPixarGeneratedUrl(gen.friendAvatarUrl)
    ) {
      setError(
        "A IA não devolveu avatares Pixar. Confira a chave de IA (OpenRouter) e tente Refazer.",
      );
      return false;
    }
    setChildAvatarUrl(gen.childAvatarUrl ?? null);
    setFriendAvatarUrl(gen.friendAvatarUrl ?? null);
    setChildFaceSheetUrl(gen.childFaceSheetUrl ?? null);
    setChildBodySheetUrl(gen.childBodySheetUrl ?? null);
    setFriendSheetUrl(gen.friendSheetUrl ?? null);
    setEngine(gen.engine ?? null);
    return {
      childAvatarUrl: gen.childAvatarUrl!,
      friendAvatarUrl: gen.friendAvatarUrl!,
      childFaceSheetUrl: gen.childFaceSheetUrl ?? null,
      childBodySheetUrl: gen.childBodySheetUrl ?? null,
      friendSheetUrl: gen.friendSheetUrl ?? null,
      engine: gen.engine ?? null,
    } satisfies AvatarBundle;
  }

  function snapshotCurrentAvatars(): AvatarBundle | null {
    if (
      !isPixarGeneratedUrl(childAvatarUrl) ||
      !isPixarGeneratedUrl(friendAvatarUrl)
    ) {
      return null;
    }
    return {
      childAvatarUrl: childAvatarUrl!,
      friendAvatarUrl: friendAvatarUrl!,
      childFaceSheetUrl,
      childBodySheetUrl,
      friendSheetUrl,
      engine,
    };
  }

  function applyAvatarBundle(bundle: AvatarBundle) {
    setChildAvatarUrl(bundle.childAvatarUrl);
    setFriendAvatarUrl(bundle.friendAvatarUrl);
    setChildFaceSheetUrl(bundle.childFaceSheetUrl);
    setChildBodySheetUrl(bundle.childBodySheetUrl);
    setFriendSheetUrl(bundle.friendSheetUrl);
    setEngine(bundle.engine);
  }

  async function confirmVersionPicks() {
    if (!versionPick) return;
    const child =
      pickChild === "a" ? versionPick.a : versionPick.b;
    const friend =
      pickFriend === "a" ? versionPick.a : versionPick.b;
    const chosen: AvatarBundle = {
      childAvatarUrl: child.childAvatarUrl,
      friendAvatarUrl: friend.friendAvatarUrl,
      childFaceSheetUrl: child.childFaceSheetUrl,
      childBodySheetUrl: child.childBodySheetUrl,
      friendSheetUrl: friend.friendSheetUrl,
      engine: friend.engine || child.engine,
    };
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/onboarding/confirm-avatars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...chosen,
          markRedoUsed: true,
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok || body.error) {
        setError(body.error || `Falha ao salvar escolha (${res.status}).`);
        return;
      }
      applyAvatarBundle(chosen);
      setVersionPick(null);
      setAvatarRedoUsed(true);
    });
  }

  function startRefazerBoth() {
    if (avatarRedoUsed || versionPick || pending) return;
    const previous = snapshotCurrentAvatars();
    if (!previous) {
      setError("Gere os avatares antes de refazer.");
      return;
    }
    setError(null);
    startTransition(async () => {
      go("generating");
      const next = await runPixarGeneration();
      if (!next) {
        applyAvatarBundle(previous);
        setStep("preview");
        return;
      }
      setPickChild("b");
      setPickFriend("b");
      setVersionPick({ a: previous, b: next });
      go("preview");
    });
  }

  // Se o preview abriu com foto crua (build antigo / reuse), gera Pixar na hora
  const autoGenRef = useRef(false);
  useEffect(() => {
    if (step !== "preview") return;
    if (autoGenRef.current) return;
    const needsPixar =
      !isPixarGeneratedUrl(childAvatarUrl) ||
      !isPixarGeneratedUrl(friendAvatarUrl);
    if (!needsPixar) return;
    autoGenRef.current = true;
    setError(null);
    startTransition(async () => {
      go("generating");
      const ok = await runPixarGeneration();
      if (!ok) {
        setStep("preview");
        return;
      }
      go("preview");
    });
  }, [step, childAvatarUrl, friendAvatarUrl]);

  function submitPin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const pin = String(new FormData(form).get("pin") ?? "").trim();
    const confirmPin = String(new FormData(form).get("confirmPin") ?? "").trim();
    startTransition(async () => {
      try {
        const registrationEventId = crypto.randomUUID();
        await trackBrowserEvent({
          event: "CompleteRegistration",
          eventId: registrationEventId,
          mirrorServer: false,
          commerce: { product: "Onboarding Euzim" },
        });
        const res = await fetch("/api/onboarding/complete-pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin, confirmPin, registrationEventId }),
        });
        const body = (await res.json()) as {
          error?: string;
          redirectTo?: string;
        };
        if (!res.ok || body.error) {
          setError(body.error || `Falha ao salvar PIN (${res.status}).`);
          return;
        }
        // Navegação dura: evita soft nav voltar ao Pronto com cookie stale
        window.location.assign(body.redirectTo || "/app/parent");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Falha de rede ao salvar PIN.",
        );
      }
    });
  }

  function openChildStudy() {
    const sheets: AvatarStudySubject["sheets"] = [];
    if (childFaceSheetUrl) {
      sheets.push({ label: "Rosto - turnaround", url: childFaceSheetUrl });
    }
    if (childBodySheetUrl) {
      sheets.push({ label: "Corpo - turnaround", url: childBodySheetUrl });
    }
    setStudySubject({
      name: childName || "Criança",
      kindLabel: "Avatar da criança",
      heroUrl: childAvatarUrl,
      sheets,
    });
  }

  function openFriendStudy() {
    const sheets: AvatarStudySubject["sheets"] = [];
    if (friendSheetUrl) {
      sheets.push({
        label: "Personagem - turnaround",
        url: friendSheetUrl,
      });
    }
    setStudySubject({
      name: friendName || "Amigo",
      kindLabel:
        friendKind === "pet" ? "Pet da criança" : "Brinquedo da criança",
      heroUrl: friendAvatarUrl,
      sheets,
    });
  }

  function submitChild(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveChildAvatarProfileAction({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setChildName(String(formData.get("displayName") ?? ""));
      setBirthDate(String(formData.get("birthDate") ?? ""));
      const g = String(formData.get("gender") ?? "");
      if (g === "boy" || g === "girl" || g === "other") setGender(g);
      setHasFather(String(formData.get("hasFather") ?? "") === "on");
      setFatherName(String(formData.get("fatherName") ?? ""));
      setFatherBirthDate(String(formData.get("fatherBirthDate") ?? ""));
      setHasMother(String(formData.get("hasMother") ?? "") === "on");
      setMotherName(String(formData.get("motherName") ?? ""));
      setMotherBirthDate(String(formData.get("motherBirthDate") ?? ""));
      go("child-photos");
    });
  }

  function persistChildPhotos() {
    setError(null);
    if (!isReuse && childFilled < REQUIRED_CHILD_PHOTO_COUNT) {
      setError(
        `Preencha todos os ${REQUIRED_CHILD_PHOTO_COUNT} slots da criança (${REQUIRED_CHILD_PHOTO_COUNT - childFilled} faltando).`,
      );
      return;
    }
    startTransition(async () => {
      if (childFilled > 0) {
        const result = await saveSubjectPhotosAction({
          subject: "child",
          photos: Object.values(childPhotos),
          allowPartial: isReuse,
        });
        if (result.error && !isReuse) {
          setError(result.error);
          return;
        }
      }
      go("friend");
    });
  }

  function submitFriend(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveFriendProfileAction({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setFriendName(String(formData.get("displayName") ?? ""));
      setFriendKind(
        String(formData.get("kind") ?? "pet") === "toy" ? "toy" : "pet",
      );
      setFriendGender(String(formData.get("gender") ?? ""));
      go("friend-photos");
    });
  }

  function beginPixarAfterPlan() {
    setError(null);
    startTransition(async () => {
      go("generating");
      try {
        const ok = await runPixarGeneration();
        if (!ok) {
          setStep("choose-plan");
          return;
        }
        go("preview");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Falha de rede ao gerar avatares.",
        );
        setStep("choose-plan");
      }
    });
  }

  function choosePlan(planId: SelectedPlanId) {
    setError(null);
    startTransition(async () => {
      const result = await startPlanCheckoutAction(planId, {
        resumeOnboarding: true,
      });
      if (result.error) {
        setError(result.error);
        autoCheckoutRef.current = false;
        return;
      }
      if (goToCheckout(result)) return;
      setError("Checkout sem sessão Stripe.");
      autoCheckoutRef.current = false;
    });
  }

  function persistFriendPhotos() {
    setError(null);
    if (!isReuse && friendFilled < REQUIRED_FRIEND_PHOTO_COUNT) {
      setError(
        `Preencha as ${REQUIRED_FRIEND_PHOTO_COUNT} fotos de corpo do amigo (${REQUIRED_FRIEND_PHOTO_COUNT - friendFilled} faltando).`,
      );
      return;
    }
    startTransition(async () => {
      if (friendFilled > 0) {
        const result = await saveSubjectPhotosAction({
          subject: "friend",
          photos: Object.values(friendPhotos),
          allowPartial: isReuse,
        });
        if (result.error && !isReuse) {
          setError(result.error);
          return;
        }
      }
      // Paywall antes do avatar IA: fotos já persistidas
      go("choose-plan");
    });
  }

  // Oferta da landing: pula a escolha e abre o Stripe do plano já selecionado
  useEffect(() => {
    if (step !== "choose-plan") return;
    if (!lockedPlan) return;
    if (resumeAfterPay) return;
    if (autoCheckoutRef.current) return;
    autoCheckoutRef.current = true;
    choosePlan(lockedPlan);
  }, [step, lockedPlan, resumeAfterPay]);

  // Após pagamento: limpa intenção de plano e gera Pixar
  const resumeGenRef = useRef(false);
  useEffect(() => {
    if (!resumeAfterPay) return;
    setLockedPlan(null);
    try {
      window.sessionStorage.removeItem(PREFERRED_PLAN_KEY);
    } catch {
      /* ignore */
    }
    if (step !== "generating") return;
    if (resumeGenRef.current) return;
    resumeGenRef.current = true;
    startTransition(async () => {
      const ok = await runPixarGeneration();
      if (!ok) {
        setStep("choose-plan");
        return;
      }
      go("preview");
    });
  }, [resumeAfterPay, step]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-10">
      <header className="space-y-2 text-center sm:text-left">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          {isReuse
            ? "Revisar experiência do avatar"
            : "Vamos começar criando o Avatar"}
        </h1>
        {mockMode ? (
          <p className="text-xs text-amber-800">
            Modo local: uploads podem ficar só no dispositivo se o Storage
            falhar.
          </p>
        ) : null}
      </header>

      <ol className="flex gap-1 overflow-x-auto pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {TAB_STEPS.map((s, i) => {
          const current = !tabsComplete && i === tabIndex;
          const done = tabsComplete || i < tabIndex;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => go(s.id)}
                aria-current={current ? "step" : undefined}
                className={`rounded-md px-2 py-1.5 transition-colors ${
                  current
                    ? "bg-foreground text-background"
                    : done
                      ? "bg-emerald-600/15 text-emerald-800 hover:bg-emerald-600/25"
                      : "bg-muted/60 hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === "child" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="size-4" />
              Informações da Criança
            </CardTitle>
            <CardDescription>
              Preencha as informações abaixo
            </CardDescription>
          </CardHeader>
          <form action={submitChild}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Nome</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  required
                  maxLength={80}
                  defaultValue={childName}
                  placeholder="Luiza"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthDate">Data de nascimento</Label>
                <Input
                  id="birthDate"
                  name="birthDate"
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                />
                {derivedAge != null ? (
                  <p className="text-xs text-muted-foreground">
                    Idade: {derivedAge} ano{derivedAge === 1 ? "" : "s"}
                  </p>
                ) : null}
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Gênero</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(GENDER_LABELS) as Array<keyof typeof GENDER_LABELS>).map(
                    (key) => (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center justify-center rounded-xl border px-3 py-3 text-sm font-medium ${
                        gender === key
                          ? "border-foreground bg-foreground text-background"
                          : "border-border/70"
                      }`}
                    >
                      <input
                        type="radio"
                        name="gender"
                        value={key}
                        className="sr-only"
                        checked={gender === key}
                        onChange={() => setGender(key)}
                        required
                      />
                      {GENDER_LABELS[key]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="space-y-3 rounded-xl border border-border/70 p-3">
                <p className="text-sm font-medium">Família</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="hasFather"
                        checked={hasFather}
                        onChange={(e) => setHasFather(e.target.checked)}
                      />
                      Tem pai?
                    </label>
                    {hasFather ? (
                      <>
                        <Input
                          name="fatherName"
                          placeholder="Nome do pai"
                          value={fatherName}
                          onChange={(e) => setFatherName(e.target.value)}
                        />
                        <Input
                          name="fatherBirthDate"
                          type="date"
                          value={fatherBirthDate}
                          onChange={(e) => setFatherBirthDate(e.target.value)}
                        />
                      </>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="hasMother"
                        checked={hasMother}
                        onChange={(e) => setHasMother(e.target.checked)}
                      />
                      Tem mãe?
                    </label>
                    {hasMother ? (
                      <>
                        <Input
                          name="motherName"
                          placeholder="Nome da mãe"
                          value={motherName}
                          onChange={(e) => setMotherName(e.target.value)}
                        />
                        <Input
                          name="motherBirthDate"
                          type="date"
                          value={motherBirthDate}
                          onChange={(e) => setMotherBirthDate(e.target.value)}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={pending} className="flex-1">
                  {pending ? "Salvando…" : "Ir para as fotos"}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      ) : null}

      {step === "child-photos" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" />
              Fotos da Criança
            </CardTitle>
            <CardDescription>
              Envie 6 fotos de rosto e 6 fotos de corpo inteiro conforme a
              plataforma orienta
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <PhotoSlotGrid
              subject="child"
              value={childPhotos}
              onChange={setChildPhotos}
              gender={gender}
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => go("child")}
              >
                Voltar
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={
                  pending ||
                  (!isReuse && childFilled < REQUIRED_CHILD_PHOTO_COUNT)
                }
                onClick={persistChildPhotos}
              >
                {pending
                  ? "Salvando…"
                  : !isReuse && childFilled < REQUIRED_CHILD_PHOTO_COUNT
                    ? `Faltam ${REQUIRED_CHILD_PHOTO_COUNT - childFilled}`
                    : "Continuar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "friend" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="size-4" />
              Melhor amigo
            </CardTitle>
            <CardDescription>
              Adicione informações dos pets ou dos brinquedos da criança
            </CardDescription>
          </CardHeader>
          <form action={submitFriend}>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 ${
                    friendKind === "pet"
                      ? "border-foreground"
                      : "border-border/70"
                  }`}
                >
                  <input
                    type="radio"
                    name="kind"
                    value="pet"
                    className="sr-only"
                    checked={friendKind === "pet"}
                    onChange={() => setFriendKind("pet")}
                  />
                  <PawPrint className="size-5" />
                  <span className="text-sm font-medium">Pet</span>
                </label>
                <label
                  className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border p-4 ${
                    friendKind === "toy"
                      ? "border-foreground"
                      : "border-border/70"
                  }`}
                >
                  <input
                    type="radio"
                    name="kind"
                    value="toy"
                    className="sr-only"
                    checked={friendKind === "toy"}
                    onChange={() => setFriendKind("toy")}
                  />
                  <ToyBrick className="size-5" />
                  <span className="text-sm font-medium">Brinquedo</span>
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="friendName">Nome</Label>
                <Input
                  id="friendName"
                  name="displayName"
                  required
                  maxLength={80}
                  defaultValue={friendName}
                  placeholder={friendKind === "pet" ? "Thor" : "Ursinho"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="friendGender">Gênero</Label>
                <select
                  id="friendGender"
                  name="gender"
                  required
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={friendGender}
                  onChange={(e) => setFriendGender(e.target.value)}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  <option value="male">Masculino</option>
                  <option value="female">Feminino</option>
                </select>
              </div>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => go("child-photos")}
                >
                  Voltar
                </Button>
                <Button type="submit" disabled={pending} className="flex-1">
                  {pending ? "Salvando…" : "Fotos do amigo"}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      ) : null}

      {step === "friend-photos" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="size-4" />
              Fotos do Amigo
            </CardTitle>
            <CardDescription>
              Adicione fotos de corpo inteiro do pet ou brinquedo favorito da
              criança
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <PhotoSlotGrid
              subject="friend"
              value={friendPhotos}
              onChange={setFriendPhotos}
              gender={gender}
            />
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => go("friend")}
              >
                Voltar
              </Button>
              <Button
                type="button"
                className="flex-1"
                disabled={
                  pending ||
                  (!isReuse && friendFilled < REQUIRED_FRIEND_PHOTO_COUNT)
                }
                onClick={persistFriendPhotos}
              >
                {pending
                  ? "Salvando…"
                  : !isReuse && friendFilled < REQUIRED_FRIEND_PHOTO_COUNT
                    ? `Faltam ${REQUIRED_FRIEND_PHOTO_COUNT - friendFilled}`
                    : "Continuar"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "choose-plan" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>
              {lockedPlan
                ? "Abrindo o pagamento do seu plano"
                : "Escolha seu plano"}
            </CardTitle>
            <CardDescription>
              {lockedPlan
                ? `Suas fotos já estão salvas. Vamos direto para o checkout de ${
                    catalogPlans.find((p) => p.planId === lockedPlan)
                      ?.name ?? lockedPlan
                  }.`
                : "Suas fotos já estão salvas. Assine para liberar a geração dos avatares Pixar."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {lockedPlan && !error ? (
              <MagicalLoading
                messages={[
                  "Preparando o pagamento…",
                  "Atrelando o plano à sua conta…",
                  "Quase lá  -  Stripe a caminho…",
                ]}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {catalogPlans.map((plan) => (
                  <button
                    key={plan.planId}
                    type="button"
                    disabled={pending}
                    onClick={() => choosePlan(plan.planId as SelectedPlanId)}
                    className="flex h-full flex-col rounded-2xl border border-border/70 p-5 text-left transition hover:border-foreground/30 hover:bg-muted/40 disabled:opacity-60"
                  >
                    <p className="font-heading text-lg font-semibold">
                      {plan.name}
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight">
                      {formatBrl(plan.priceBrl)}
                      <span className="text-sm font-normal text-muted-foreground">
                        /mês
                      </span>
                    </p>
                    <ul className="mt-4 flex-1 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                      <li>2 avatares Pixar (criança + amigo)</li>
                      <li>{plan.storiesPerMonth} histórias por mês</li>
                      <li>
                        {plan.planId === "plus"
                          ? "Máximo de histórias por mês"
                          : plan.planId === "family"
                            ? "Ritmo semanal confortável"
                            : "Estúdio mágico e controle parental"}
                      </li>
                    </ul>
                    <span className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background">
                      Assinar
                    </span>
                  </button>
                ))}
              </div>
            )}
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => go("friend-photos")}
              >
                Voltar
              </Button>
              {mockMode ? (
                <Button
                  type="button"
                  className="flex-1"
                  disabled={pending}
                  onClick={beginPixarAfterPlan}
                >
                  Continuar (demo)
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "generating" ? (
        <Card className="shadow-none">
          <CardContent className="py-8">
            <MagicalLoading
              messages={[
                "Contador Sábio despertando a magia…",
                "Pintando o avatar da criança…",
                "Criando folhas de personagem…",
                "Desenhando o amigo Pixar…",
              ]}
            />
          </CardContent>
        </Card>
      ) : null}

      {step === "preview" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check className="size-5 text-emerald-600" />
              Seus avatares
            </CardTitle>
            <CardDescription>
              {versionPick
                ? "Refazer gerou novas versões. Escolha qual ficar da criança e qual ficar do amigo."
                : "Toque no avatar para ver o estudo em várias poses"}
              {!versionPick && engine ? ` · ${engine}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {versionPick ? (
              <div className="space-y-6">
                <div className="space-y-3">
                  <p className="text-sm font-semibold">
                    Criança ({childName || "avatar"})
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["a", "b"] as const).map((key) => {
                      const bundle = versionPick[key];
                      const selected = pickChild === key;
                      return (
                        <button
                          key={`child-${key}`}
                          type="button"
                          onClick={() => setPickChild(key)}
                          className={`space-y-2 rounded-2xl border p-2 text-left transition ${
                            selected
                              ? "border-foreground ring-2 ring-foreground/20"
                              : "border-border/70"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={bundle.childAvatarUrl}
                            alt={`Versão ${key.toUpperCase()}`}
                            className="aspect-square w-full rounded-xl object-cover"
                          />
                          <span className="block text-center text-xs font-medium">
                            Versão {key.toUpperCase()}
                            {selected ? " (escolhida)" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-semibold">
                    Amigo ({friendName || "amigo"})
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {(["a", "b"] as const).map((key) => {
                      const bundle = versionPick[key];
                      const selected = pickFriend === key;
                      return (
                        <button
                          key={`friend-${key}`}
                          type="button"
                          onClick={() => setPickFriend(key)}
                          className={`space-y-2 rounded-2xl border p-2 text-left transition ${
                            selected
                              ? "border-foreground ring-2 ring-foreground/20"
                              : "border-border/70"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={bundle.friendAvatarUrl}
                            alt={`Versão ${key.toUpperCase()}`}
                            className="aspect-square w-full rounded-xl object-cover"
                          />
                          <span className="block text-center text-xs font-medium">
                            Versão {key.toUpperCase()}
                            {selected ? " (escolhida)" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-md flex-col gap-5">
                <button
                  type="button"
                  onClick={openChildStudy}
                  className="group space-y-2 text-left transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-amber-50 to-sky-50 shadow-sm ring-offset-2 group-hover:ring-2 group-hover:ring-amber-400/50">
                    {childAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={childAvatarUrl}
                        alt={childName}
                        className="aspect-square w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <span className="block text-center text-sm font-medium">
                    {childName}
                  </span>
                  <span className="block text-center text-xs text-muted-foreground">
                    Ver poses / estudo
                  </span>
                </button>
                <button
                  type="button"
                  onClick={openFriendStudy}
                  className="group space-y-2 text-left transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-rose-50 to-violet-50 shadow-sm ring-offset-2 group-hover:ring-2 group-hover:ring-rose-400/50">
                    {friendAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={friendAvatarUrl}
                        alt={friendName}
                        className="aspect-square w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <span className="block text-center text-sm font-medium">
                    {friendName}{" "}
                    <span className="text-muted-foreground">
                      ({friendKind === "pet" ? "pet" : "brinquedo"})
                    </span>
                  </span>
                  <span className="block text-center text-xs text-muted-foreground">
                    Ver poses / estudo
                  </span>
                </button>
              </div>
            )}

            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                className="sm:flex-1"
                disabled={Boolean(versionPick)}
                onClick={() => go("friend-photos")}
              >
                Voltar
              </Button>
              {versionPick ? (
                <Button
                  type="button"
                  className="w-full sm:flex-[2]"
                  size="lg"
                  disabled={pending}
                  onClick={confirmVersionPicks}
                >
                  {pending ? "Salvando…" : "Confirmar versões"}
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    className="sm:flex-1"
                    disabled={pending || avatarRedoUsed}
                    onClick={startRefazerBoth}
                  >
                    {pending
                      ? "Refazendo…"
                      : avatarRedoUsed
                        ? "Refazer já usado"
                        : "Refazer"}
                  </Button>
                  <Button
                    className="w-full sm:flex-[2]"
                    size="lg"
                    onClick={() => go("pin")}
                  >
                    Definir PIN e abrir painel
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "pin" ? (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="size-4" />
              PIN dos pais
            </CardTitle>
            <CardDescription>
              O PIN de segurança será usado para criar histórias e aceitar
              amizades, mais controle e segurança para os seus filhos
            </CardDescription>
          </CardHeader>
          <form onSubmit={submitPin}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pin">PIN (4 a 6 dígitos)</Label>
                <Input
                  id="pin"
                  name="pin"
                  inputMode="numeric"
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPin">Confirmar PIN</Label>
                <Input
                  id="confirmPin"
                  name="confirmPin"
                  inputMode="numeric"
                  pattern="[0-9]{4,6}"
                  maxLength={6}
                  required
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => go("preview")}
                >
                  Voltar
                </Button>
                <Button type="submit" disabled={pending} className="flex-1">
                  {pending ? "Abrindo painel…" : "Salvar PIN e entrar"}
                </Button>
              </div>
            </CardContent>
          </form>
        </Card>
      ) : null}

      <AvatarStudyDialog
        open={studySubject !== null}
        onOpenChange={(open) => {
          if (!open) setStudySubject(null);
        }}
        subject={studySubject}
      />
    </div>
  );
}
