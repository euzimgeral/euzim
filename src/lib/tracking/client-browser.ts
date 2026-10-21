import type {
  AttributionSnapshot,
  PublicTrackingConfig,
  TrackingEventKey,
  TrackingCommerce,
  TrackingUserPii,
} from "@/lib/tracking/types";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __euzimTrackingConfig?: PublicTrackingConfig;
    __euzimTrackingReady?: boolean;
  }
}

const ATTR_STORAGE_KEY = "euzim_attr_v1";

export function readClientAttribution(): AttributionSnapshot {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ATTR_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as AttributionSnapshot;
  } catch {
    return {};
  }
}

export function writeClientAttribution(snap: AttributionSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const prev = readClientAttribution();
    const merged = { ...prev, ...snap };
    localStorage.setItem(ATTR_STORAGE_KEY, JSON.stringify(merged));
    // Cookie 90d para o servidor
    const maxAge = 90 * 24 * 60 * 60;
    document.cookie = `euzim_attr=${encodeURIComponent(JSON.stringify(merged))}; path=/; max-age=${maxAge}; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

export function captureAttributionFromLocation(): AttributionSnapshot {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const snap: AttributionSnapshot = {
    landing_path: window.location.pathname,
    landing_query: window.location.search || undefined,
    referrer: document.referrer || undefined,
  };
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ] as const) {
    const v = params.get(key);
    if (v) snap[key] = v;
  }
  if (snap.fbclid) {
    snap.fbc = `fb.1.${Date.now()}.${snap.fbclid}`;
  }
  // fbp cookie do Meta
  const fbpMatch = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
  if (fbpMatch?.[1]) snap.fbp = decodeURIComponent(fbpMatch[1]);
  const fbcMatch = document.cookie.match(/(?:^|;\s*)_fbc=([^;]+)/);
  if (fbcMatch?.[1]) snap.fbc = decodeURIComponent(fbcMatch[1]);

  writeClientAttribution(snap);
  return { ...readClientAttribution(), ...snap };
}

function ensureGtag(): void {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
  }
}

export function initBrowserPixels(config: PublicTrackingConfig): void {
  if (typeof window === "undefined") return;
  window.__euzimTrackingConfig = config;
  ensureGtag();

  // Meta Pixel base
  if (config.metaPixelIds.length && !window.fbq) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n: any = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    };
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [] as unknown[];
    window.fbq = n;
    window._fbq = n;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
  }
  for (const id of config.metaPixelIds) {
    window.fbq?.("init", id);
  }

  // gtag loader
  if (
    (config.ga4Ids.length || config.googleAds.length) &&
    !document.getElementById("euzim-gtag")
  ) {
    const firstId =
      config.ga4Ids[0] ||
      (config.googleAds[0] ? config.googleAds[0].awId : null);
    if (firstId) {
      const s = document.createElement("script");
      s.id = "euzim-gtag";
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(firstId)}`;
      document.head.appendChild(s);
      window.gtag?.("js", new Date());
    }
  }
  for (const id of config.ga4Ids) {
    window.gtag?.("config", id, { send_page_view: false });
  }
  for (const ads of config.googleAds) {
    window.gtag?.("config", ads.awId);
  }

  // Custom tags (admin-only HTML)
  for (const tag of config.tags) {
    if (!tag.html?.trim()) continue;
    const marker = `euzim-tag-${tag.id}`;
    if (document.getElementById(marker)) continue;
    const wrap = document.createElement("div");
    wrap.id = marker;
    wrap.style.display = "none";
    // Inject via range to execute scripts
    const range = document.createRange();
    range.selectNode(document.head);
    const frag = range.createContextualFragment(tag.html);
    document.head.appendChild(frag);
  }

  window.__euzimTrackingReady = true;
}

function ga4Name(event: TrackingEventKey): string {
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

function adsLabelKey(event: TrackingEventKey): string | null {
  switch (event) {
    case "Lead":
      return "Lead";
    case "InitiateCheckout":
      return "InitiateCheckout";
    case "AddPaymentInfo":
      return "AddPaymentInfo";
    case "Purchase":
      return "Purchase";
    case "CompleteRegistration":
      return "CompleteRegistration";
    case "PageView":
    case "ViewContent":
      return null;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export type BrowserTrackOptions = {
  event: TrackingEventKey;
  eventId?: string;
  user?: TrackingUserPii;
  commerce?: TrackingCommerce;
  /** também POST /api/tracking/event */
  mirrorServer?: boolean;
};

export async function trackBrowserEvent(
  opts: BrowserTrackOptions,
): Promise<string> {
  const eventId = opts.eventId || crypto.randomUUID();
  const config = window.__euzimTrackingConfig;
  const attribution = readClientAttribution();
  const url = typeof window !== "undefined" ? window.location.href : undefined;

  // Meta browser (+ Advanced Matching quando houver PII)
  if (window.fbq && config?.metaPixelIds.length) {
    const am: Record<string, string> = {};
    if (opts.user?.email) am.em = opts.user.email.trim().toLowerCase();
    if (opts.user?.phone) {
      const ph = opts.user.phone.replace(/\D/g, "");
      if (ph) am.ph = ph;
    }
    if (opts.user?.fullName) {
      const parts = opts.user.fullName.trim().split(/\s+/);
      if (parts[0]) am.fn = parts[0].toLowerCase();
      if (parts.length > 1) am.ln = parts.slice(1).join(" ").toLowerCase();
    }
    if (opts.user?.firstName) am.fn = opts.user.firstName.trim().toLowerCase();
    if (opts.user?.lastName) am.ln = opts.user.lastName.trim().toLowerCase();
    if (opts.user?.userId) am.external_id = String(opts.user.userId);
    if (Object.keys(am).length) {
      for (const id of config.metaPixelIds) {
        window.fbq("init", id, am);
      }
    }

    const payload: Record<string, unknown> = {
      funnel_event: opts.event,
    };
    if (opts.commerce?.value != null) {
      payload.value = opts.commerce.value;
      payload.currency = (opts.commerce.currency || "BRL").toUpperCase();
    }
    if (opts.commerce?.contents) payload.contents = opts.commerce.contents;
    if (opts.commerce?.planId) payload.content_ids = [opts.commerce.planId];
    if (opts.commerce?.product) payload.content_name = opts.commerce.product;
    window.fbq("track", opts.event, payload, { eventID: eventId });
  }

  // GA4
  if (window.gtag && config?.ga4Ids.length) {
    const params: Record<string, unknown> = {
      event_id: eventId,
    };
    if (opts.user?.userId) params.user_id = opts.user.userId;
    if (opts.commerce?.value != null) {
      params.value = opts.commerce.value;
      params.currency = (opts.commerce.currency || "BRL").toUpperCase();
    }
    window.gtag("event", ga4Name(opts.event), params);
  }

  // Google Ads conversion labels
  const labelKey = adsLabelKey(opts.event);
  if (window.gtag && labelKey && config?.googleAds.length) {
    for (const ads of config.googleAds) {
      const label = ads.labels[labelKey];
      if (!label) continue;
      const sendTo = `${ads.awId}/${label}`;
      const conv: Record<string, unknown> = {
        send_to: sendTo,
        event_id: eventId,
      };
      if (opts.commerce?.value != null) {
        conv.value = opts.commerce.value;
        conv.currency = (opts.commerce.currency || "BRL").toUpperCase();
      }
      // Enhanced Conversions (unhashed email/phone - gtag hashes)
      if (opts.user?.email || opts.user?.phone) {
        conv.user_data = {
          email: opts.user.email || undefined,
          phone_number: opts.user.phone || undefined,
        };
      }
      window.gtag("event", "conversion", conv);
    }
  }

  if (opts.mirrorServer !== false) {
    try {
      await fetch("/api/tracking/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: opts.event,
          eventId,
          eventSourceUrl: url,
          attribution,
          user: opts.user,
          commerce: opts.commerce,
          serverOnly: true,
        }),
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
  }

  return eventId;
}
