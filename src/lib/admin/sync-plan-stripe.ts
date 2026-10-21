import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";
import type {
  PlanCatalogKey,
  PlanCatalogRow,
} from "@/lib/billing/plan-catalog-shared";
import {
  STRIPE_PRICE_IDS,
  STRIPE_PRODUCT_IDS,
} from "@/lib/billing/stripe-price-ids";
import {
  readStripeTestPriceMap,
  writeStripeTestPriceMap,
  type StripePriceMapFile,
} from "@/lib/billing/stripe-price-map";

export type PlanStripeSyncResult = {
  planKey: PlanCatalogKey;
  livePriceId: string;
  liveProductId: string;
  testPriceId: string | null;
  testProductId: string | null;
  livePriceCreated: boolean;
  testPriceCreated: boolean;
};

type EnsureSpec = {
  key: string;
  name: string;
  description: string;
  unit_amount: number;
  recurring?: { interval: "month" };
  metadata: Record<string, string>;
  existingProductId?: string | null;
  existingPriceId?: string | null;
};

function liveStripe(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key.startsWith("sk_live_") && !key.startsWith("rk_live_")) return null;
  return new Stripe(key);
}

function testStripe(): Stripe | null {
  const key = (process.env.STRIPE_SECRET_KEY_TEST || "").trim();
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) return null;
  return new Stripe(key);
}

async function findProductByKey(stripe: Stripe, key: string) {
  const listed = await stripe.products.list({ limit: 100, active: true });
  return (
    listed.data.find(
      (p) =>
        p.metadata?.euzim_key === key ||
        p.metadata?.plan_id === key ||
        p.metadata?.pack_id === key,
    ) ?? null
  );
}

function priceMatches(
  price: Stripe.Price,
  spec: EnsureSpec,
  productId: string,
): boolean {
  if (!price.active) return false;
  if (String(price.product) !== productId) return false;
  if (price.unit_amount !== spec.unit_amount) return false;
  if (price.currency !== "brl") return false;
  const wantRecurring = Boolean(spec.recurring);
  const hasRecurring = Boolean(price.recurring);
  if (wantRecurring !== hasRecurring) return false;
  if (
    wantRecurring &&
    price.recurring?.interval !== spec.recurring?.interval
  ) {
    return false;
  }
  return true;
}

async function ensureProduct(stripe: Stripe, spec: EnsureSpec) {
  let product: Stripe.Product | null = null;
  if (spec.existingProductId) {
    try {
      product = await stripe.products.retrieve(spec.existingProductId);
    } catch {
      product = null;
    }
  }
  if (!product) product = await findProductByKey(stripe, spec.key);

  if (!product) {
    return stripe.products.create({
      name: spec.name,
      description: spec.description,
      metadata: spec.metadata,
    });
  }

  return stripe.products.update(product.id, {
    name: spec.name,
    description: spec.description,
    metadata: { ...(product.metadata || {}), ...spec.metadata },
    active: true,
  });
}

async function ensurePrice(
  stripe: Stripe,
  spec: EnsureSpec,
  product: Stripe.Product,
): Promise<{ price: Stripe.Price; created: boolean }> {
  let price: Stripe.Price | null = null;
  let created = false;

  if (spec.existingPriceId) {
    try {
      price = await stripe.prices.retrieve(spec.existingPriceId);
    } catch {
      price = null;
    }
  }

  if (price && !priceMatches(price, spec, product.id)) {
    await stripe.prices.update(price.id, { active: false });
    price = null;
  }

  if (!price) {
    const listed = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 20,
    });
    price =
      listed.data.find((p) => priceMatches(p, spec, product.id)) ?? null;
  }

  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: spec.unit_amount,
      currency: "brl",
      ...(spec.recurring ? { recurring: spec.recurring } : {}),
      lookup_key: `euzim_${spec.key}`,
      transfer_lookup_key: true,
      metadata: spec.metadata,
    });
    created = true;
  } else {
    price = await stripe.prices.update(price.id, {
      metadata: { ...(price.metadata || {}), ...spec.metadata },
    });
  }

  return { price, created };
}

function planSpecs(row: PlanCatalogRow): EnsureSpec[] {
  return [
    {
      key: row.planKey,
      name: `Euzim — ${row.name}`,
      description: `${row.storiesPerMonth} histórias por mês · R$ ${(row.priceCents / 100).toFixed(2).replace(".", ",")}`,
      unit_amount: row.priceCents,
      recurring: { interval: "month" },
      metadata: {
        app: "estudio-magico",
        euzim_key: row.planKey,
        plan_id: row.planKey,
        stories_per_month: String(row.storiesPerMonth),
        included_characters: String(row.avatarsIncluded),
      },
      existingProductId: row.stripeProductIdLive,
      existingPriceId: row.stripePriceIdLive,
    },
    {
      key: `extra_story_${row.planKey}`,
      name: `Euzim — História adicional (${row.name})`,
      description: `1 história extra · R$ ${(row.extraStoryCents / 100).toFixed(2).replace(".", ",")}`,
      unit_amount: row.extraStoryCents,
      metadata: {
        app: "estudio-magico",
        euzim_key: `extra_story_${row.planKey}`,
        plan_id: `extra_story_${row.planKey}`,
        stories: "1",
        for_plan: row.planKey,
      },
      existingProductId:
        STRIPE_PRODUCT_IDS[
          `extra_story_${row.planKey}` as keyof typeof STRIPE_PRODUCT_IDS
        ] ?? null,
      existingPriceId:
        STRIPE_PRICE_IDS[
          `extra_story_${row.planKey}` as keyof typeof STRIPE_PRICE_IDS
        ] ?? null,
    },
  ];
}

function rewriteLivePriceIdsFile(updates: {
  prices: Record<string, string>;
  products: Record<string, string>;
}) {
  const path = resolve(process.cwd(), "src/lib/billing/stripe-price-ids.ts");
  let raw = readFileSync(path, "utf8");

  for (const [key, id] of Object.entries(updates.prices)) {
    const re = new RegExp(
      `(${key.includes("-") ? `"${key}"` : key}\\s*:\\s*")[^"]+(")`,
    );
    // STRIPE_PRICE_IDS block only — replace first occurrence in prices section
    const priceBlock = raw.match(
      /export const STRIPE_PRICE_IDS = \{[\s\S]*?\} as const;/,
    )?.[0];
    if (priceBlock) {
      const next = priceBlock.replace(re, `$1${id}$2`);
      raw = raw.replace(priceBlock, next);
    }
  }

  for (const [key, id] of Object.entries(updates.products)) {
    const re = new RegExp(
      `(${key.includes("-") ? `"${key}"` : key}\\s*:\\s*")[^"]+(")`,
    );
    const productBlock = raw.match(
      /export const STRIPE_PRODUCT_IDS = \{[\s\S]*?\} as const;/,
    )?.[0];
    if (productBlock) {
      const next = productBlock.replace(re, `$1${id}$2`);
      raw = raw.replace(productBlock, next);
    }
  }

  writeFileSync(path, raw, "utf8");
}

/**
 * Garante Products/Prices live+test para os planos do catálogo.
 * Cria novo Price se unit_amount mudou (grandfathering).
 */
export async function syncPlansToStripe(
  rows: PlanCatalogRow[],
): Promise<{
  results: PlanStripeSyncResult[];
  error?: string;
}> {
  const live = liveStripe();
  if (!live) {
    return {
      results: [],
      error: "STRIPE_SECRET_KEY live ausente/inválida.",
    };
  }
  const test = testStripe();

  const results: PlanStripeSyncResult[] = [];
  const priceUpdates: Record<string, string> = {};
  const productUpdates: Record<string, string> = {};
  const testMap: StripePriceMapFile = {
    ...readStripeTestPriceMap(),
    generatedAt: new Date().toISOString(),
    source: "live",
  };

  for (const row of rows) {
    const specs = planSpecs(row);
    let livePriceId = row.stripePriceIdLive || "";
    let liveProductId = row.stripeProductIdLive || "";
    let testPriceId = row.stripePriceIdTest;
    let testProductId = row.stripeProductIdTest;
    let livePriceCreated = false;
    let testPriceCreated = false;

    for (const spec of specs) {
      const product = await ensureProduct(live, {
        ...spec,
        existingProductId:
          spec.key === row.planKey
            ? row.stripeProductIdLive
            : spec.existingProductId,
        existingPriceId:
          spec.key === row.planKey
            ? row.stripePriceIdLive
            : spec.existingPriceId,
      });
      const { price, created } = await ensurePrice(live, spec, product);
      priceUpdates[spec.key] = price.id;
      productUpdates[spec.key] = product.id;

      if (spec.key === row.planKey) {
        livePriceId = price.id;
        liveProductId = product.id;
        livePriceCreated = created;
      }

      if (test) {
        const testSpec: EnsureSpec = {
          ...spec,
          existingProductId: testMap.products[spec.key] || null,
          existingPriceId: testMap.prices[spec.key] || null,
        };
        const testProduct = await ensureProduct(test, testSpec);
        const ensured = await ensurePrice(test, testSpec, testProduct);
        testMap.prices[spec.key] = ensured.price.id;
        testMap.products[spec.key] = testProduct.id;
        testMap.liveToTestPrice[price.id] = ensured.price.id;
        testMap.liveToTestProduct[product.id] = testProduct.id;
        if (spec.key === row.planKey) {
          testPriceId = ensured.price.id;
          testProductId = testProduct.id;
          testPriceCreated = ensured.created;
        }
      }
    }

    // Avatar unit price (shared) — keep existing; only mirror amount if family extra changed
    results.push({
      planKey: row.planKey,
      livePriceId,
      liveProductId,
      testPriceId,
      testProductId,
      livePriceCreated,
      testPriceCreated,
    });
  }

  // Plus extra_story legado = same as extra_story_plus
  if (priceUpdates.extra_story_plus) {
    priceUpdates.extra_story = priceUpdates.extra_story_plus;
  }
  if (productUpdates.extra_story_plus) {
    productUpdates.extra_story = productUpdates.extra_story_plus;
  }

  rewriteLivePriceIdsFile({ prices: priceUpdates, products: productUpdates });
  if (test) {
    writeStripeTestPriceMap(testMap);
  }

  return { results };
}
