"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { analyzeBookLearning } from "@/lib/learning/analyze-book";
import { analyzeFeedbackLearning } from "@/lib/learning/analyze-feedback";
import {
  mapLearningRow,
  type AiLearningEntry,
  type LearningEntryType,
} from "@/lib/learning/types";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_PDF_BYTES = 25 * 1024 * 1024;

async function adminDb() {
  const gate = await requireAdmin();
  if ("error" in gate) return { error: gate.error } as const;
  const admin = createAdminClient();
  if (!admin) return { error: "Admin indisponível." } as const;
  return { admin, user: gate.user } as const;
}

export async function listLearningEntriesAction(input?: {
  type?: LearningEntryType | "all";
  query?: string;
}): Promise<{ entries: AiLearningEntry[]; error?: string }> {
  const ctx = await adminDb();
  if ("error" in ctx) return { entries: [], error: ctx.error };

  let q = ctx.admin
    .from("ai_learning_entries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (input?.type === "book" || input?.type === "feedback") {
    q = q.eq("type", input.type);
  }

  const { data, error } = await q;
  if (error) return { entries: [], error: error.message };

  const needle = (input?.query || "").trim().toLowerCase();
  let entries = (data ?? []).map((row) =>
    mapLearningRow(row as Record<string, unknown>),
  );
  if (needle) {
    entries = entries.filter((e) => {
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
      return hay.includes(needle);
    });
  }
  return { entries };
}

export async function uploadLearningBookAction(
  formData: FormData,
): Promise<{ error?: string; success?: boolean; entryId?: string }> {
  const ctx = await adminDb();
  if ("error" in ctx) return { error: ctx.error };

  const file = formData.get("file");
  const titleRaw = formData.get("title");
  if (!(file instanceof File)) {
    return { error: "Selecione um PDF." };
  }
  const name = file.name || "livro.pdf";
  if (!name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return { error: "Envie um arquivo PDF." };
  }
  if (file.size <= 0 || file.size > MAX_PDF_BYTES) {
    return { error: "PDF deve ter até 25 MB." };
  }

  const title =
    String(titleRaw || "")
      .trim()
      .slice(0, 200) || name.replace(/\.pdf$/i, "");

  const { data: inserted, error: insertErr } = await ctx.admin
    .from("ai_learning_entries")
    .insert({
      type: "book",
      title,
      added_by_user_id: ctx.user.id,
      added_by_email: ctx.user.email || "",
      status: "pending",
      source_filename: name.slice(0, 240),
    })
    .select("id")
    .single();

  if (insertErr || !inserted?.id) {
    return { error: insertErr?.message || "Não foi possível criar o registro." };
  }

  const entryId = inserted.id as string;
  const storagePath = `books/${entryId}.pdf`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await ctx.admin.storage
    .from("learning")
    .upload(storagePath, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (upErr) {
    await ctx.admin.from("ai_learning_entries").delete().eq("id", entryId);
    return { error: upErr.message || "Falha no upload do PDF." };
  }

  await ctx.admin
    .from("ai_learning_entries")
    .update({ storage_path: storagePath })
    .eq("id", entryId);

  after(async () => {
    try {
      await analyzeBookLearning(entryId);
    } catch (err) {
      console.error("[learning] analyzeBookLearning failed", entryId, err);
    }
  });

  revalidatePath("/app/admin");
  return { success: true, entryId };
}

export async function getLearningBookSignedUrlAction(
  entryId: string,
): Promise<{ url?: string; error?: string }> {
  const ctx = await adminDb();
  if ("error" in ctx) return { error: ctx.error };

  const { data: row } = await ctx.admin
    .from("ai_learning_entries")
    .select("storage_path, type")
    .eq("id", entryId)
    .maybeSingle();

  if (!row || row.type !== "book" || !row.storage_path) {
    return { error: "PDF não encontrado." };
  }

  const { data, error } = await ctx.admin.storage
    .from("learning")
    .createSignedUrl(row.storage_path as string, 60 * 30);

  if (error || !data?.signedUrl) {
    return { error: error?.message || "Não foi possível abrir o PDF." };
  }
  return { url: data.signedUrl };
}

export async function retryLearningEntryAction(
  entryId: string,
): Promise<{ error?: string; success?: boolean }> {
  const ctx = await adminDb();
  if ("error" in ctx) return { error: ctx.error };

  const { data: row } = await ctx.admin
    .from("ai_learning_entries")
    .select("id, type")
    .eq("id", entryId)
    .maybeSingle();
  if (!row) return { error: "Registro não encontrado." };

  await ctx.admin
    .from("ai_learning_entries")
    .update({ status: "pending", error_message: null })
    .eq("id", entryId);

  if (row.type === "book") {
    after(async () => {
      try {
        await analyzeBookLearning(entryId);
      } catch (err) {
        console.error("[learning] retry book failed", entryId, err);
      }
    });
  } else {
    after(async () => {
      try {
        await analyzeFeedbackLearning(entryId);
      } catch (err) {
        console.error("[learning] retry feedback failed", entryId, err);
      }
    });
  }

  revalidatePath("/app/admin");
  return { success: true };
}
