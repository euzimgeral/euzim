import { createAdminClient } from "@/lib/supabase/admin";
import { buildWebhookPayload } from "@/lib/tracking/webhook-payload";
import type {
  TrackingEventInput,
  TrackingWebhookRow,
} from "@/lib/tracking/types";

async function postWithRetry(
  url: string,
  body: unknown,
  secret: string | null,
  attempts = 3,
): Promise<{ ok: boolean; status: number; error?: string }> {
  let lastStatus = 0;
  let lastError = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (secret) headers["X-Webhook-Secret"] = secret;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        // Evita bloquear signup/onboard (await CAPI) se o destino do webhook travar.
        signal: AbortSignal.timeout(4000),
      });
      lastStatus = res.status;
      if (res.ok) return { ok: true, status: res.status };
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "fetch failed";
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  return { ok: false, status: lastStatus, error: lastError };
}

async function logWebhookFailure(input: {
  webhookId: string;
  eventKey: string;
  statusCode: number;
  ok: boolean;
  error?: string;
  payload: unknown;
}) {
  const admin = createAdminClient();
  if (!admin) return;
  try {
    await admin.from("tracking_webhook_logs").insert({
      webhook_id: input.webhookId,
      event_key: input.eventKey,
      status_code: input.statusCode || null,
      ok: input.ok,
      error: input.error || null,
      payload: input.payload,
    });
  } catch {
    /* ignore log failures */
  }
}

export async function dispatchOutboundWebhooks(
  webhooks: TrackingWebhookRow[],
  input: TrackingEventInput,
): Promise<void> {
  const payload = buildWebhookPayload(input);
  const targets = webhooks.filter(
    (w) =>
      w.is_active &&
      w.url &&
      (w.events.includes(input.event) ||
        (input.event === "PageView" && w.events.includes("PageView"))),
  );

  await Promise.all(
    targets.map(async (wh) => {
      const result = await postWithRetry(wh.url, payload, wh.secret, 3);
      if (!result.ok) {
        await logWebhookFailure({
          webhookId: wh.id,
          eventKey: input.event,
          statusCode: result.status,
          ok: false,
          error: result.error,
          payload,
        });
      }
    }),
  );
}
