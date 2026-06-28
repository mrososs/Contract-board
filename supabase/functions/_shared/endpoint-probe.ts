// Shared endpoint smoke-test ("safe probe") used by the openapi-worker (the
// automatic Contract Ready gate) and azure-proxy (the on-demand "Test endpoints"
// button). Both run on Deno Edge runtime.
//
// Safety contract (decided with the product owner): we NEVER send a meaningful
// request body to a mutating endpoint. Parameter-free GETs are called for real;
// everything else (POST/PUT/PATCH/DELETE, or any path with {params}) is only
// checked for reachability via OPTIONS, falling back to the real method with NO
// body. So a probe can only ever read — it can't create, update, or delete data.
//
// The pure classification logic is mirrored in libs/data-access/endpoint-health.ts
// (which the frontend uses to render badges, and which carries the unit tests).
// Keep the two `classifyProbe` truth tables in sync. Edge functions can't import
// from the Nx libs, hence the small duplication.

export type Health = 'ok' | 'failed' | 'unchecked';

export interface ProbeOp {
  operationId: string;
  /** Upper-case HTTP method, e.g. "GET". */
  method: string;
  /** OpenAPI path template, e.g. "/uc-12/bookings/{id}". */
  path: string;
}

export interface ProbeResult {
  operationId: string;
  endpoint: string; // "GET /uc-12/bookings"
  status: number | null; // null = the request never completed (network/timeout)
  health: Health;
  error?: string;
}

const PER_PROBE_TIMEOUT_MS = 8000;

/** Does the path carry a `{param}` placeholder? */
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
export function classifyProbe(
  status: number | null,
  _method: string,
  pathHasParams: boolean,
): Health {
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
export function resolveBaseUrl(spec: Record<string, unknown>, specUrl: string): string | null {
  const servers = spec['servers'] as Array<{ url?: string }> | undefined;
  const raw = servers?.[0]?.url?.trim();
  if (!raw) return null;
  try {
    // Absolute URL → use as-is; relative → resolve against the spec's origin.
    return new URL(raw, specUrl).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Substitute a safe placeholder for every `{param}` so the URL is callable. */
function fillPath(path: string): string {
  return path.replace(/\{[^}]+\}/g, '1');
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${fillPath(path)}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe one endpoint. Parameter-free GET → real GET. Everything else → OPTIONS
 * reachability, falling back to the real method (no body) only if OPTIONS itself
 * is not implemented (404/405 on OPTIONS).
 */
export async function probeEndpoint(
  baseUrl: string,
  op: ProbeOp,
  authHeader: Record<string, string>,
): Promise<ProbeResult> {
  const endpoint = `${op.method} ${op.path}`;
  const url = joinUrl(baseUrl, op.path);
  const pathHasParams = hasPathParams(op.path);
  const headers = { Accept: 'application/json', ...authHeader };

  try {
    let status: number;
    if (op.method === 'GET' && !pathHasParams) {
      status = (await fetchWithTimeout(url, { method: 'GET', headers })).status;
    } else {
      // Reachability first — never mutates.
      const opt = await fetchWithTimeout(url, { method: 'OPTIONS', headers });
      if (opt.status === 404 || opt.status === 405) {
        // OPTIONS unsupported — fall back to the real method WITHOUT a body.
        status = (await fetchWithTimeout(url, { method: op.method, headers })).status;
      } else {
        status = opt.status;
      }
    }
    return { operationId: op.operationId, endpoint, status, health: classifyProbe(status, op.method, pathHasParams) };
  } catch (e) {
    return {
      operationId: op.operationId,
      endpoint,
      status: null,
      health: 'failed',
      error: (e as Error).message,
    };
  }
}

/** Probe a list of endpoints (a task's required set). */
export async function probeTask(
  baseUrl: string,
  ops: ProbeOp[],
  authHeader: Record<string, string>,
): Promise<ProbeResult[]> {
  return await Promise.all(ops.map((op) => probeEndpoint(baseUrl, op, authHeader)));
}

/** A concise "POST /x → 500" summary of the failing endpoints, for block_note. */
export function summarizeFailures(results: ProbeResult[]): string {
  return results
    .filter((r) => r.health === 'failed')
    .map((r) => `${r.endpoint} → ${r.status ?? 'unreachable'}`)
    .join('; ');
}
