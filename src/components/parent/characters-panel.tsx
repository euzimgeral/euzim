"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  AvatarStudyDialog,
  type AvatarStudySubject,
} from "@/components/onboarding/avatar-study-dialog";
import {
  CHARACTER_PACKS,
  formatBrl,
  priceForAvatarCount,
} from "@/lib/billing/character-packs";
import {
  RELATIONSHIP_OPTIONS,
  type CharacterManageRow,
  type ChildFamilyMeta,
} from "@/lib/characters/types";
import {
  updateCharacterAction,
  updateChildFamilyAction,
} from "@/lib/characters/actions";
import {
  mockActivatePackAction,
  startCharacterPackCheckoutAction,
  startCustomAvatarsCheckoutAction,
} from "@/lib/stripe/checkout-actions";
import { goToCheckout } from "@/lib/stripe/go-checkout";
import type { BillingSnapshot } from "@/components/parent/subscription-panel";

export type { CharacterManageRow };

function isPetOrToyKind(
  kind?: string | null,
  relationship?: string | null,
): boolean {
  return (
    kind === "pet" ||
    kind === "toy" ||
    relationship === "pet" ||
    relationship === "toy"
  );
}

function isPetOrToyRow(c: CharacterManageRow | null): boolean {
  if (!c) return false;
  return isPetOrToyKind(c.kind, c.relationship);
}

export function CharactersPanel({
  characters,
  billing,
  childMeta,
}: {
  characters: CharacterManageRow[];
  billing: BillingSnapshot;
  childMeta?: ChildFamilyMeta | null;
}) {
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<CharacterManageRow | null>(null);
  const [avatarCount, setAvatarCount] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relFilter, setRelFilter] = useState("");
  const [studySubject, setStudySubject] = useState<AvatarStudySubject | null>(
    null,
  );
  const [studyOpen, setStudyOpen] = useState(false);

  const [form, setForm] = useState({
    name: "",
    relationship: "friend",
    relationshipOther: "",
    gender: "",
    birthDate: "",
    kind: "other",
  });

  const [familyForm, setFamilyForm] = useState({
    hasFather: false,
    fatherName: "",
    fatherBirthDate: "",
    hasMother: false,
    motherName: "",
    motherBirthDate: "",
  });

  const price = priceForAvatarCount(avatarCount);
  const filteredRels = useMemo(() => {
    const q = relFilter.trim().toLowerCase();
    if (!q) return RELATIONSHIP_OPTIONS;
    return RELATIONSHIP_OPTIONS.filter((r) =>
      r.label.toLowerCase().includes(q),
    );
  }, [relFilter]);

  const editingIsPrimary = Boolean(editing?.isPrimary);
  const editingIsPetOrToy = isPetOrToyRow(editing);
  const formIsPetOrToy = isPetOrToyKind(form.kind, form.relationship);
  /** Pet/brinquedo: sem data de nascimento (também se mudar o parentesco no form). */
  const showBirthField =
    editingIsPrimary || (!editingIsPetOrToy && !formIsPetOrToy);

  function openStudy(c: CharacterManageRow) {
    const petToy = isPetOrToyRow(c);
    setStudySubject({
      name: c.name,
      kindLabel: c.isPrimary
        ? "Criança principal"
        : petToy
          ? c.kind === "toy" || c.relationship === "toy"
            ? "Brinquedo"
            : "Pet"
          : "Personagem",
      heroUrl: c.avatarUrl ?? null,
      sheets: c.studySheets ?? [],
    });
    setStudyOpen(true);
  }

  function openEdit(c: CharacterManageRow) {
    setEditing(c);
    setForm({
      name: c.name,
      relationship: c.relationship || (c.isPrimary ? "child" : "friend"),
      relationshipOther: c.relationshipOther || "",
      gender: c.gender || (c.isPrimary ? childMeta?.gender || "" : ""),
      birthDate:
        c.birthDate || (c.isPrimary ? childMeta?.birthDate || "" : ""),
      kind: c.kind || (c.isPrimary ? "child" : "other"),
    });
    if (c.isPrimary && childMeta) {
      setFamilyForm({
        hasFather: childMeta.hasFather,
        fatherName: childMeta.fatherName ?? "",
        fatherBirthDate: childMeta.fatherBirthDate ?? "",
        hasMother: childMeta.hasMother,
        motherName: childMeta.motherName ?? "",
        motherBirthDate: childMeta.motherBirthDate ?? "",
      });
    }
    setEditOpen(true);
    setError(null);
    setMessage(null);
  }

  function saveEdit() {
    if (!editing) return;
    startTransition(async () => {
      const result = await updateCharacterAction({
        id: editing.id,
        name: form.name,
        relationship: editingIsPrimary
          ? "child"
          : editingIsPetOrToy
            ? form.kind === "toy" || form.relationship === "toy"
              ? "toy"
              : "pet"
            : form.relationship,
        relationshipOther:
          !editingIsPrimary &&
          !editingIsPetOrToy &&
          form.relationship === "other"
            ? form.relationshipOther
            : null,
        gender: form.gender || null,
        birthDate: showBirthField ? form.birthDate || null : null,
        kind: editingIsPrimary
          ? "child"
          : editingIsPetOrToy
            ? form.kind === "toy" || form.relationship === "toy"
              ? "toy"
              : "pet"
            : form.kind || null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }

      if (editingIsPrimary && childMeta?.id) {
        const family = await updateChildFamilyAction({
          childId: childMeta.id,
          hasFather: familyForm.hasFather,
          fatherName: familyForm.fatherName,
          fatherBirthDate: familyForm.fatherBirthDate,
          hasMother: familyForm.hasMother,
          motherName: familyForm.motherName,
          motherBirthDate: familyForm.motherBirthDate,
        });
        if (family.error) {
          setError(family.error);
          return;
        }
      }

      setEditOpen(false);
      setMessage("Informações atualizadas.");
      window.location.reload();
    });
  }

  function buyAvatars() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      if (avatarCount <= 5) {
        const pack = CHARACTER_PACKS.find((p) => p.characters === avatarCount);
        if (!pack) {
          setError("Quantidade inválida.");
          return;
        }
        const result = await startCharacterPackCheckoutAction(pack.id);
        if (goToCheckout(result)) return;
        if (result.error) setError(result.error);
        if (!billing.stripeReady) {
          setMessage(
            "Checkout real indisponível (falta STRIPE_SECRET_KEY). Use simular.",
          );
        }
        return;
      }
      const result = await startCustomAvatarsCheckoutAction(avatarCount);
      if (goToCheckout(result)) return;
      if (result.error) setError(result.error);
      if (!billing.stripeReady) {
        setMessage(
          "Checkout real indisponível (falta STRIPE_SECRET_KEY). Avatares 6+ = R$ 9,90 cada.",
        );
      }
    });
  }

  function simulate() {
    const pack =
      CHARACTER_PACKS.find((p) => p.characters === Math.min(avatarCount, 5)) ??
      CHARACTER_PACKS[0];
    startTransition(async () => {
      const result = await mockActivatePackAction(pack.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMessage(`Crédito simulado: +${pack.characters} personagem(ns).`);
      window.location.reload();
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <h2 className="font-heading text-xl font-semibold">
              Seus personagens
            </h2>
          </div>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Adicionar Personagem
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Extras disponíveis: {billing.extraCharacters ?? 0}
        </p>
        {characters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum personagem ainda. Crie no onboarding ou adicione abaixo.
          </p>
        ) : (
          <ul className="space-y-2">
            {characters.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openStudy(c)}
                    className="relative shrink-0 overflow-hidden rounded-xl ring-offset-background transition hover:ring-2 hover:ring-amber-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Ver poses de ${c.name}`}
                    title="Toque e veja o avatar"
                  >
                    {c.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatarUrl}
                        alt=""
                        className="size-12 object-cover"
                        draggable={false}
                      />
                    ) : (
                      <div className="flex size-12 items-center justify-center bg-muted">
                        <Sparkles className="size-4 text-muted-foreground" />
                      </div>
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      Toque e veja o avatar
                    </p>
                    <p className="truncate font-medium">{c.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {c.isPrimary ? <Badge>principal</Badge> : null}
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Editar ${c.name}`}
                    onClick={() => openEdit(c)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicione novos avatares</DialogTitle>
            <DialogDescription>
              Escolha quantos avatares deseja adicionar (1 a 15).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="avatar-count">Quantidade</Label>
              <Input
                id="avatar-count"
                type="number"
                min={1}
                max={15}
                value={avatarCount}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) {
                    setAvatarCount(Math.min(15, Math.max(1, n)));
                  }
                }}
              />
              <input
                type="range"
                min={1}
                max={15}
                value={avatarCount}
                onChange={(e) => setAvatarCount(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <p className="font-heading text-2xl font-semibold">
              {price != null ? formatBrl(price) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {avatarCount <= 5
                ? "Pacote padrão 1–5."
                : "6 ou mais: R$ 9,90 por avatar."}
            </p>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button disabled={pending} onClick={buyAvatars} className="w-full">
              {billing.stripeReady
                ? "Continuar para pagamento"
                : "Solicitar compra"}
            </Button>
            {!billing.stripeReady ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={simulate}
                className="w-full"
              >
                Simular crédito
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Informações</DialogTitle>
            <DialogDescription>
              {editingIsPrimary
                ? "Dados da criança e da família."
                : editingIsPetOrToy
                  ? "Nome e gênero do pet ou brinquedo."
                  : "Atualize nome, parentesco e dados do personagem."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="char-name">Nome</Label>
              <Input
                id="char-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </div>

            {!editingIsPrimary && !editingIsPetOrToy ? (
              <div className="space-y-1.5">
                <Label>Parentesco</Label>
                <Input
                  placeholder="Buscar…"
                  value={relFilter}
                  onChange={(e) => setRelFilter(e.target.value)}
                />
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.relationship}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      relationship: e.target.value,
                      kind:
                        e.target.value === "pet"
                          ? "pet"
                          : e.target.value === "toy"
                            ? "toy"
                            : e.target.value === "child"
                              ? "child"
                              : f.kind === "pet" || f.kind === "toy"
                                ? "adult"
                                : f.kind,
                    }))
                  }
                >
                  {filteredRels.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                {form.relationship === "other" ? (
                  <Input
                    placeholder="Descreva o parentesco"
                    value={form.relationshipOther}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        relationshipOther: e.target.value,
                      }))
                    }
                  />
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Gênero</Label>
              <select
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={form.gender}
                onChange={(e) =>
                  setForm((f) => ({ ...f, gender: e.target.value }))
                }
              >
                <option value="">—</option>
                {formIsPetOrToy || editingIsPetOrToy ? (
                  <>
                    <option value="male">Macho / masculino</option>
                    <option value="female">Fêmea / feminino</option>
                    <option value="other">Outro / não informar</option>
                  </>
                ) : (
                  <>
                    <option value="boy">Menino</option>
                    <option value="girl">Menina</option>
                    <option value="male">Masculino</option>
                    <option value="female">Feminino</option>
                    <option value="other">Outro / não informar</option>
                  </>
                )}
              </select>
            </div>

            {showBirthField ? (
              <div className="space-y-1.5">
                <Label htmlFor="char-birth">Nascimento</Label>
                <Input
                  id="char-birth"
                  type="date"
                  value={form.birthDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, birthDate: e.target.value }))
                  }
                />
              </div>
            ) : null}

            {editingIsPrimary ? (
              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <p className="text-sm font-medium">Família</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={familyForm.hasFather}
                        onChange={(e) =>
                          setFamilyForm((f) => ({
                            ...f,
                            hasFather: e.target.checked,
                          }))
                        }
                      />
                      Tem pai?
                    </label>
                    {familyForm.hasFather ? (
                      <>
                        <Input
                          placeholder="Nome do pai"
                          value={familyForm.fatherName}
                          onChange={(e) =>
                            setFamilyForm((f) => ({
                              ...f,
                              fatherName: e.target.value,
                            }))
                          }
                        />
                        <Input
                          type="date"
                          value={familyForm.fatherBirthDate || ""}
                          onChange={(e) =>
                            setFamilyForm((f) => ({
                              ...f,
                              fatherBirthDate: e.target.value,
                            }))
                          }
                        />
                      </>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={familyForm.hasMother}
                        onChange={(e) =>
                          setFamilyForm((f) => ({
                            ...f,
                            hasMother: e.target.checked,
                          }))
                        }
                      />
                      Tem mãe?
                    </label>
                    {familyForm.hasMother ? (
                      <>
                        <Input
                          placeholder="Nome da mãe"
                          value={familyForm.motherName}
                          onChange={(e) =>
                            setFamilyForm((f) => ({
                              ...f,
                              motherName: e.target.value,
                            }))
                          }
                        />
                        <Input
                          type="date"
                          value={familyForm.motherBirthDate || ""}
                          onChange={(e) =>
                            setFamilyForm((f) => ({
                              ...f,
                              motherBirthDate: e.target.value,
                            }))
                          }
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {!editingIsPrimary && !editingIsPetOrToy ? (
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, kind: e.target.value }))
                  }
                >
                  <option value="child">Criança</option>
                  <option value="adult">Adulto</option>
                  <option value="pet">Pet</option>
                  <option value="toy">Brinquedo</option>
                  <option value="other">Outro</option>
                </select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={pending} onClick={saveEdit}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}

      <AvatarStudyDialog
        open={studyOpen}
        onOpenChange={setStudyOpen}
        subject={studySubject}
      />
    </div>
  );
}
