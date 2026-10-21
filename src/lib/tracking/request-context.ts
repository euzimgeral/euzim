import { headers } from "next/headers";

/** Contexto de request para CAPI (IP, UA, URL). */
export async function trackingRequestContext(fallbackPath = "/"): Promise<{
  clientIp: string | null;
  userAgent: string | null;
  eventSourceUrl: string | undefined;
}> {
  try {
    const h = await headers();
    const xf = h.get("x-forwarded-for");
    const clientIp =
      xf?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      h.get("cf-connecting-ip") ||
      null;
    const userAgent = h.get("user-agent");
    const referer = h.get("referer");
    const host = h.get("x-forwarded-host") || h.get("host");
    const proto = h.get("x-forwarded-proto") || "http";
    const eventSourceUrl =
      referer ||
      (host ? `${proto}://${host}${fallbackPath}` : undefined);
    return { clientIp, userAgent, eventSourceUrl };
  } catch {
    return {
      clientIp: null,
      userAgent: null,
      eventSourceUrl: undefined,
    };
  }
}
