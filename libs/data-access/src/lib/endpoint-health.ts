// Pure endpoint smoke-test classification — the browser/test-side mirror of the
// truth table in supabase/functions/_shared/endpoint-probe.ts. The board uses
// `health` to render the per-endpoint badge; the worker/proxy compute it server
// side. Keep both copies of `classifyProbe` in sync (edge functions can't import
// from this Nx lib, hence the deliberate duplication).

/** Last-known smoke-test state of a single mapped endpoint. */
export type EndpointHealth = 'ok' | 'failed' | 'unchecked';

/** Does the OpenAPI path template carry a `{param}` placeholder? */
export function hasPathParams(path: string): boolean {
  return /\{[^}]+\}/.test(path);
}

/**
 * Classify one probe outcome. `status === null` means the request never
 * completed (DNS / connection / timeout) → always a failure.
 *
 *   network error / timeout  -> failed (host unreachable)
 *   5xx                      -> failed (real server error)
 *   404 (no path params)     -> failed (route not implemented)
 *   404 (with path params)   -> ok     (likely "resource not found", not a missing route)
 *   405                      -> failed (method not implemented)
 *   2xx/400/401/403/409/422  -> ok     (route exists and responds)
 *   anything else            -> ok     (reachable; don't fabricate a failure)
 */
export function classifyProbe(status: number | null, pathHasParams: boolean): EndpointHealth {
  if (status === null) return 'failed';
  if (status >= 500) return 'failed';
  if (status === 405) return 'failed';
  if (status === 404) return pathHasParams ? 'ok' : 'failed';
  return 'ok';
}

/**
 * Resolve the live API base URL from the spec's `servers[0].url`, relative to the
 * origin of the spec URL when the server entry is a relative path (e.g. "/api").
 * Returns null when no usable base URL can be determined.
 */
export function resolveBaseUrl(spec: { servers?: Array<{ url?: string }> }, specUrl: string): string | null {
  const raw = spec.servers?.[0]?.url?.trim();
  if (!raw) return null;
  try {
    return new URL(raw, specUrl).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
