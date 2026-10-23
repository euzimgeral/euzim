"use client";

import { useMemo, useState, useTransition } from "react";
import { BookOpen, MessageSquareWarning, RefreshCw, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getLearningBookSignedUrlAction,
  listLearningEntriesAction,
  retryLearningEntryAction,
  uploadLearningBookAction,
} from "@/lib/admin/learning-actions";
import type {
  AiLearningEntry,
  LearningEntryStatus,
  LearningEntryType,
} from "@/lib/learning/types";

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function statusLabel(s: LearningEntryStatus): string {
  switch (s) {
    case "pending":
      return "Pendente";
    case "processing":
      return "Processando";
    case "ready":
      return "Pronto";
    case "failed":
      return "Falhou";
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

function statusVariant(
  s: LearningEntryStatus,
): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "ready":
      return "secondary";
    case "failed":
      return "destructive";
    case "processing":
      return "default";
    case "pending":
      return "outline";
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

export function AdminLearningPanel({
  initialEntries,
}: {
  initialEntries: AiLearningEntry[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | LearningEntryType>("all");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AiLearningEntry | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (!q) return true;
      const hay = [
        e.title,
        e.addedByEmail,
        e.sourceFilename,
        e.aiSummary,
        e.userFeedback,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query, typeFilter]);

  function refreshList() {
    startTransition(async () => {
      const res = await listLearningEntriesAction({
        type: typeFilter,
        query,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setEntries(res.entries);
    });
  }

  function onUpload() {
    if (!file) {
      setError("Selecione um PDF.");
      return;
    }
    setError(null);
    setMessage(null);
    const fd = new FormData();
    fd.set("file", file);
    if (title.trim()) fd.set("title", title.trim());
    startTransition(async () => {
      const res = await uploadLearningBookAction(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Livro enviado. A IA está analisando…");
      setFile(null);
      setTitle("");
      const list = await listLearningEntriesAction();
      if (list.entries) setEntries(list.entries);
    });
  }

  function openEntry(entry: AiLearningEntry) {
    setSelected(entry);
    setPdfUrl(null);
    if (entry.type === "book" && entry.storagePath) {
      startTransition(async () => {
        const res = await getLearningBookSignedUrlAction(entry.id);
        if (res.url) setPdfUrl(res.url);
      });
    }
  }

  function onRetry(entryId: string) {
    startTransition(async () => {
      const res = await retryLearningEntryAction(entryId);
      if (res.error) {
        setError(res.error);
        return;
      }
      setMessage("Reprocessamento iniciado.");
      refreshList();
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border/70 p-4">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Enviar livro (PDF)</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          A IA lê o PDF página a página e guarda padrões literários para o
          gerador de histórias.
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="learn-title">Título (opcional)</Label>
            <Input
              id="learn-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Nome do livro"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="learn-file">Arquivo PDF</Label>
            <Input
              id="learn-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            type="button"
            disabled={pending || !file}
            onClick={onUpload}
            className="gap-1.5"
          >
            <Upload className="size-3.5" />
            Enviar
          </Button>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-border/70 p-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label htmlFor="learn-q">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              id="learn-q"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Título, arquivo, email, resumo…"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <select
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "all" | LearningEntryType)
            }
          >
            <option value="all">Todos</option>
            <option value="book">Livros</option>
            <option value="feedback">Feedbacks</option>
          </select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={refreshList}
          className="gap-1.5"
        >
          <RefreshCw className="size-3.5" />
          Atualizar
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? (
        <p className="text-sm text-emerald-700" role="status">
          {message}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border/70">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Data</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Título</th>
              <th className="px-3 py-2">Quem adicionou</th>
              <th className="px-3 py-2">IA</th>
              <th className="px-3 py-2">Resumo</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-border/50 hover:bg-muted/30"
                onClick={() => openEntry(row)}
              >
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {fmtDate(row.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1 text-xs">
                    {row.type === "book" ? (
                      <BookOpen className="size-3.5" />
                    ) : (
                      <MessageSquareWarning className="size-3.5" />
                    )}
                    {row.type === "book" ? "Livro" : "Feedback"}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">{row.title || "—"}</td>
                <td className="px-3 py-2 text-xs">{row.addedByEmail || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={statusVariant(row.status)}>
                    {statusLabel(row.status)}
                  </Badge>
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-xs text-muted-foreground">
                  {row.aiSummary || row.userFeedback || row.sourceFilename || "—"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Nenhum aprendizado com esses filtros.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setPdfUrl(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected?.title || "Detalhe"}</DialogTitle>
            <DialogDescription>
              {selected?.type === "book" ? "Livro" : "Feedback"} ·{" "}
              {fmtDate(selected?.createdAt ?? null)} ·{" "}
              {selected?.addedByEmail || "—"}
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={statusVariant(selected.status)}>
                  {statusLabel(selected.status)}
                </Badge>
                {selected.status === "failed" ||
                selected.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => onRetry(selected.id)}
                  >
                    Reprocessar
                  </Button>
                ) : null}
              </div>

              {selected.errorMessage ? (
                <p className="text-sm text-destructive">{selected.errorMessage}</p>
              ) : null}

              {selected.type === "feedback" ? (
                <>
                  {selected.pageImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selected.pageImageUrl}
                      alt="Página avaliada"
                      className="max-h-56 w-full rounded-lg object-contain bg-muted"
                    />
                  ) : null}
                  <section className="space-y-1">
                    <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                      Feedback do responsável
                    </h3>
                    <p>{selected.userFeedback || "—"}</p>
                  </section>
                  {selected.pageText ? (
                    <section className="space-y-1">
                      <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                        Texto da página
                      </h3>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                        {selected.pageText}
                      </p>
                    </section>
                  ) : null}
                </>
              ) : (
                <section className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Arquivo: {selected.sourceFilename || "—"}
                    {selected.pageCount != null
                      ? ` · ${selected.pageCount} págs.`
                      : ""}
                  </p>
                  {pdfUrl ? (
                    <a
                      href={pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium underline"
                    >
                      Abrir PDF
                    </a>
                  ) : selected.storagePath ? (
                    <p className="text-xs text-muted-foreground">
                      Preparando link do PDF…
                    </p>
                  ) : null}
                </section>
              )}

              {selected.aiSummary ? (
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Resumo da IA
                  </h3>
                  <p>{selected.aiSummary}</p>
                </section>
              ) : null}

              {selected.aiObservation ? (
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Observação
                  </h3>
                  <p className="whitespace-pre-wrap text-xs">
                    {selected.aiObservation}
                  </p>
                </section>
              ) : null}

              {selected.aiLessons.storyRules ||
              selected.aiLessons.imageRules ||
              selected.aiLessons.themes?.length ||
              selected.aiLessons.literaryPatterns?.length ? (
                <section className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    Lições para o gerador
                  </h3>
                  {selected.aiLessons.themes?.length ? (
                    <p className="text-xs">
                      Temas: {selected.aiLessons.themes.join(", ")}
                    </p>
                  ) : null}
                  {selected.aiLessons.literaryPatterns?.length ? (
                    <p className="text-xs">
                      Padrões:{" "}
                      {selected.aiLessons.literaryPatterns.join("; ")}
                    </p>
                  ) : null}
                  {selected.aiLessons.storyRules ? (
                    <pre className="whitespace-pre-wrap text-xs">
                      {selected.aiLessons.storyRules}
                    </pre>
                  ) : null}
                  {selected.aiLessons.imageRules ? (
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {selected.aiLessons.imageRules}
                    </pre>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
