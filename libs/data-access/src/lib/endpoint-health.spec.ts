import { describe, expect, it } from 'vitest';
import { classifyProbe, hasPathParams, resolveBaseUrl } from './endpoint-health';

describe('classifyProbe — the live endpoint smoke-test gate', () => {
  it('passes a healthy 2xx response', () => {
    expect(classifyProbe(200, false)).toBe('ok');
    expect(classifyProbe(201, false)).toBe('ok');
  });

  it('fails on any 5xx — a real server error', () => {
    expect(classifyProbe(500, false)).toBe('failed');
    expect(classifyProbe(503, true)).toBe('failed');
  });

  it('fails a 404 on a parameter-free path (route not implemented)', () => {
    expect(classifyProbe(404, false)).toBe('failed');
  });

  it('tolerates a 404 on a parameterized path (likely "resource not found")', () => {
    expect(classifyProbe(404, true)).toBe('ok');
  });

  it('fails a 405 — the method is not implemented', () => {
    expect(classifyProbe(405, false)).toBe('failed');
    expect(classifyProbe(405, true)).toBe('failed');
  });

  it('treats auth / validation responses as reachable (route exists)', () => {
    expect(classifyProbe(400, false)).toBe('ok');
    expect(classifyProbe(401, false)).toBe('ok');
    expect(classifyProbe(403, false)).toBe('ok');
    expect(classifyProbe(409, false)).toBe('ok');
    expect(classifyProbe(422, false)).toBe('ok');
  });

  it('fails when the request never completed (null status = network/timeout)', () => {
    expect(classifyProbe(null, false)).toBe('failed');
    expect(classifyProbe(null, true)).toBe('failed');
  });
});

describe('hasPathParams', () => {
  it('detects a {param} placeholder', () => {
    expect(hasPathParams('/uc-12/bookings/{id}')).toBe(true);
    expect(hasPathParams('/uc-12/bookings')).toBe(false);
  });
});

describe('resolveBaseUrl', () => {
  it('uses an absolute server URL as-is (trailing slash trimmed)', () => {
    expect(resolveBaseUrl({ servers: [{ url: 'https://api.example.com/' }] }, 'https://specs.example.com/openapi.json')).toBe(
      'https://api.example.com',
    );
  });

  it('resolves a relative server URL against the spec origin', () => {
    expect(resolveBaseUrl({ servers: [{ url: '/api/v1' }] }, 'https://app.example.com/docs/openapi.json')).toBe(
      'https://app.example.com/api/v1',
    );
  });

  it('returns null when the spec declares no servers', () => {
    expect(resolveBaseUrl({}, 'https://specs.example.com/openapi.json')).toBeNull();
    expect(resolveBaseUrl({ servers: [] }, 'https://specs.example.com/openapi.json')).toBeNull();
    expect(resolveBaseUrl({ servers: [{}] }, 'https://specs.example.com/openapi.json')).toBeNull();
  });
});
