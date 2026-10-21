#!/usr/bin/env node
/**
 * Sincroniza vars de .env.local → projeto Vercel (contatoeuzim / euzim).
 * Uso (não interativo):
 *   VERCEL_TOKEN=… node scripts/sync-vercel-env-from-local.mjs
 * Opcional: VERCEL_TEAM_ID=team_… VERCEL_PROJECT=euzim
 *
 * Não imprime valores de secrets.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TEAM_ID =
  process.env.VERCEL_TEAM_ID?.trim() || "team_HMoEZAeuL8x77W740ul8lR4n";
const PROJECT_NAME = process.env.VERCEL_PROJECT?.trim() || "euzim";
const TOKEN = process.env.VERCEL_TOKEN?.trim() || "";

const KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_JWKS_URL",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  // APP_ENV: sempre forçado para "production" abaixo (não ler do .env.local)
];

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

async function api(pathname, init = {}) {
  const url = new URL(`https://api.vercel.com${pathname}`);
  url.searchParams.set("teamId", TEAM_ID);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${pathname}: ${body.error?.message || text.slice(0, 200)}`);
  }
  return body;
}

async function upsertEnv(projectId, key, value) {
  const list = await api(`/v9/projects/${projectId}/env`);
  const existing = (list.envs || []).filter((e) => e.key === key);
  for (const e of existing) {
    await api(`/v9/projects/${projectId}/env/${e.id}`, { method: "DELETE" });
  }
  await api(`/v9/projects/${projectId}/env`, {
    method: "POST",
    body: JSON.stringify({
      key,
      value,
      type: key.startsWith("NEXT_PUBLIC_") ? "plain" : "encrypted",
      target: ["production", "preview", "development"],
    }),
  });
}

async function main() {
  if (!TOKEN) {
    console.error("VERCEL_TOKEN ausente. Exporte e rode de novo (sem login device).");
    process.exit(2);
  }
  const local = {
    ...parseEnvFile(path.join(ROOT, ".env")),
    ...parseEnvFile(path.join(ROOT, ".env.local")),
  };
  // Produção = live Stripe (não test)
  if (local.STRIPE_SECRET_KEY?.startsWith("sk_live_")) {
    /* ok */
  } else if (local.STRIPE_SECRET_KEY) {
    console.warn("Aviso: STRIPE_SECRET_KEY local não é sk_live_.");
  }

  const projects = await api(`/v9/projects?limit=50`);
  const project = (projects.projects || []).find((p) => p.name === PROJECT_NAME);
  if (!project) {
    console.error(`Projeto "${PROJECT_NAME}" não encontrado no team ${TEAM_ID}.`);
    process.exit(3);
  }
  console.log("project", project.name, project.id);

  let ok = 0;
  for (const key of KEYS) {
    const value = local[key];
    if (!value) {
      console.log("skip", key, "(vazio no .env.local)");
      continue;
    }
    await upsertEnv(project.id, key, value);
    console.log("set", key);
    ok += 1;
  }

  // APP_ENV production na Vercel
  await upsertEnv(project.id, "APP_ENV", "production");
  console.log("set APP_ENV=production");
  ok += 1;

  console.log(`OK ${ok} vars. Dispare redeploy (git push vazio ou Deployments → Redeploy).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
