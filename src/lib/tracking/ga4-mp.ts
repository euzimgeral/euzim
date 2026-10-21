import type { TrackingEventInput, TrackingPixelRow } from "@/lib/tracking/types";

/**
 * GA4 Measurement Protocol (server).
 * Requer GA4_API_SECRET no env (opcional). Sem secret, só browser gtag.
 */
function ga4EventName(event: TrackingEventInput["event"]): string {
  switch (event) {
    case "PageView":
      return "page_view";
    case "ViewContent":
      return "view_item";
    case "Lead":
      return "generate_lead";
    case "InitiateCheckout":
      return "begin_checkout";
    case "AddPaymentInfo":
      return "add_payment_info";
    case "Purchase":
      return "purchase";
    case "CompleteRegistration":
      return "sign_up";
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export async function sendGa4MeasurementProtocol(
  pixels: TrackingPixelRow[],
  input: TrackingEventInput,
): Promise<void> {
  const apiSecret = process.env.GA4_API_SECRET?.trim();
  if (!apiSecret) return;

  const ga4 = pixels.filter(
    (p) => p.kind === "ga4" && p.is_active && p.measurement_id,
  );
  if (!ga4.length) return;

  const clientId =
    input.attribution?.fbp ||
    input.user?.userId ||
    input.eventId ||
    crypto.randomUUID();

  const params: Record<string, unknown> = {};
  if (input.commerce?.value != null) {
    params.value = input.commerce.value;
    params.currency = (input.commerce.currency || "BRL").toUpperCase();
  }
  if (input.commerce?.planId) params.item_id = input.commerce.planId;
  if (input.commerce?.product) params.item_name = input.commerce.product;
  if (input.eventSourceUrl) params.page_location = input.eventSourceUrl;

  await Promise.all(
    ga4.map(async (pixel) => {
      const mid = pixel.measurement_id as string;
      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(apiSecret)}`;
      try {
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: String(clientId).slice(0, 64),
            user_id: input.user?.userId || undefined,
            events: [
              {
                name: ga4EventName(input.event),
                params: {
                  ...params,
                  engagement_time_msec: 1,
                },
              },
            ],
          }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {
        /* ignore MP failures */
      }
    }),
  );
}
