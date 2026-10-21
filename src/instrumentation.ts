/**
 * Boot hook — em :5050 (modo test) espelha catálogo Stripe live → test.
 * Não muta produtos live. Map grava em data/ (fora de src) para não HMR-loop.
 */
declare global {
  // eslint-disable-next-line no-var
  var __euzimStripeBootSynced: boolean | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__euzimStripeBootSynced) return;
  globalThis.__euzimStripeBootSynced = true;

  // DNS ipv4first vem de NODE_OPTIONS no npm run dev/start (AAAA supabase ETIMEOUT).

  const { isStripeTestMode } = await import("@/lib/stripe/config");
  if (!isStripeTestMode()) return;

  const { getStripeSecretKeyTest, getStripeSecretKeyLive } = await import(
    "@/lib/stripe/config"
  );
  if (!getStripeSecretKeyTest() || !getStripeSecretKeyLive()) {
    console.warn(
      "[euzim] Stripe sync boot skipped — missing STRIPE_SECRET_KEY_TEST or STRIPE_SECRET_KEY",
    );
    return;
  }

  try {
    const { syncStripeTestFromLive } = await import(
      "@/lib/stripe/sync-test-from-live"
    );
    const result = await syncStripeTestFromLive();
    if (result.ok) {
      console.info(
        `[euzim] Stripe test mirror ok — ${result.mapped} prices → ${result.mapPath}` +
          (result.wrote === false ? " (unchanged, skip write)" : ""),
      );
    } else {
      console.warn(`[euzim] Stripe test mirror failed: ${result.error}`);
    }
  } catch (err) {
    console.warn(
      "[euzim] Stripe test mirror error:",
      err instanceof Error ? err.message : err,
    );
  }
}
