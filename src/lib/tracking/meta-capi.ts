import {
  hashEmail,
  hashNamePart,
  hashPhone,
  normalizeEmail,
  sha256Hex,
  splitName,
} from "@/lib/tracking/hash";
import type { TrackingEventInput, TrackingPixelRow } from "@/lib/tracking/types";

const META_API_VERSION = "v21.0";

function metaEventName(event: TrackingEventInput["event"]): string {
  return event;
}

export async function sendMetaCapi(
  pixels: TrackingPixelRow[],
  input: TrackingEventInput,
): Promise<{ ok: boolean; results: Array<{ pixelId: string; ok: boolean; error?: string }> }> {
  const meta = pixels.filter(
    (p) =>
      p.kind === "meta" &&
      p.is_active &&
      p.pixel_id &&
      p.capi_access_token,
  );

  if (!meta.length) return { ok: true, results: [] };

  const { firstName, lastName, fullName } = splitName(
    input.user?.fullName ||
      [input.user?.firstName, input.user?.lastName].filter(Boolean).join(" "),
  );
  const email = normalizeEmail(input.user?.email);
  const em = hashEmail(email);
  const ph = hashPhone(input.user?.phone);
  const fn = hashNamePart(firstName || input.user?.firstName);
  const ln = hashNamePart(lastName || input.user?.lastName);

  const userData: Record<string, unknown> = {};
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;
  if (input.attribution?.fbp) userData.fbp = input.attribution.fbp;
  if (input.attribution?.fbc) userData.fbc = input.attribution.fbc;
  if (input.user?.userId) {
    userData.external_id = [sha256Hex(String(input.user.userId).trim())];
  }

  const customData: Record<string, unknown> = {
    ...(input.commerce?.planId
      ? { content_ids: [input.commerce.planId] }
      : {}),
    ...(input.commerce?.product
      ? { content_name: input.commerce.product }
      : {}),
  };
  if (input.commerce?.value != null) {
    customData.value = input.commerce.value;
    customData.currency = (input.commerce.currency || "BRL").toUpperCase();
  }
  if (input.commerce?.contents?.length) {
    customData.contents = input.commerce.contents;
    customData.content_type = "product";
  }
  // Funil: evento + landing
  customData.funnel_event = input.event;
  if (fullName) customData.customer_name = fullName;

  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = input.eventId || crypto.randomUUID();

  const results: Array<{ pixelId: string; ok: boolean; error?: string }> = [];

  await Promise.all(
    meta.map(async (pixel) => {
      const pixelId = pixel.pixel_id as string;
      const token = pixel.capi_access_token as string;
      const body = {
        data: [
          {
            event_name: metaEventName(input.event),
            event_time: eventTime,
            event_id: eventId,
            event_source_url: input.eventSourceUrl || undefined,
            action_source: "website",
            user_data: userData,
            custom_data:
              Object.keys(customData).length > 0 ? customData : undefined,
          },
        ],
      };

      try {
        const url = `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          results.push({
            pixelId,
            ok: false,
            error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
          });
          return;
        }
        results.push({ pixelId, ok: true });
      } catch (err) {
        results.push({
          pixelId,
          ok: false,
          error: err instanceof Error ? err.message : "CAPI failed",
        });
      }
    }),
  );

  return { ok: results.every((r) => r.ok), results };
}
