import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type StripePriceMapFile = {
  generatedAt: string | null;
  source: "live";
  prices: Record<string, string>;
  products: Record<string, string>;
  liveToTestPrice: Record<string, string>;
  liveToTestProduct: Record<string, string>;
};

/**
 * Fora de `src/` — escrita no boot (instrumentation) NÃO dispara Turbopack/HMR.
 * Cópia legada em src/lib/billing/stripe-price-ids.test.json pode existir; esta é a canônica.
 */
export const STRIPE_TEST_PRICE_MAP_PATH = resolve(
  process.cwd(),
  "data/stripe-price-ids.test.json",
);

export function emptyStripePriceMap(): StripePriceMapFile {
  return {
    generatedAt: null,
    source: "live",
    prices: {},
    products: {},
    liveToTestPrice: {},
    liveToTestProduct: {},
  };
}

export function readStripeTestPriceMap(): StripePriceMapFile {
  try {
    const raw = readFileSync(STRIPE_TEST_PRICE_MAP_PATH, "utf8");
    return { ...emptyStripePriceMap(), ...JSON.parse(raw) } as StripePriceMapFile;
  } catch {
    return emptyStripePriceMap();
  }
}

function stableIds(map: StripePriceMapFile): string {
  return JSON.stringify({
    prices: map.prices,
    products: map.products,
    liveToTestPrice: map.liveToTestPrice,
    liveToTestProduct: map.liveToTestProduct,
  });
}

/** Só grava se IDs mudaram — evita HMR loop no boot (generatedAt sempre muda). */
export function writeStripeTestPriceMap(map: StripePriceMapFile): boolean {
  const prev = readStripeTestPriceMap();
  if (stableIds(prev) === stableIds(map)) {
    return false;
  }
  writeFileSync(
    STRIPE_TEST_PRICE_MAP_PATH,
    JSON.stringify(map, null, 2) + "\n",
    "utf8",
  );
  return true;
}
