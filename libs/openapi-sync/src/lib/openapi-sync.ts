import { Injectable } from '@angular/core';

export interface OperationShape {
  operationId: string;
  method: string;
  path: string;
  /** Flattened DTO field → type map, for diffing. */
  fields: Record<string, string>;
}

export interface SpecSnapshot {
  /** ISO timestamp the snapshot was taken. */
  fetchedAt: string;
  operations: Record<string, OperationShape>;
}

export interface DtoFieldChange {
  field: string;
  from: string;
  to: string;
}
export interface DtoDiff {
  added: string[];
  removed: string[];
  changed: DtoFieldChange[];
}

/**
 * Polls the backend's OpenAPI spec and diffs it against the last snapshot.
 * "Contract Ready" is *detected* here, never typed by hand — this is what
 * keeps the board from going stale (planning doc §1). Runs server-side in a
 * Supabase Edge Function; this client mirrors the contract for the UI.
 */
@Injectable({ providedIn: 'root' })
export class OpenApiSyncService {
  /** The integration-environment spec, not prod (open question §9.2). */
  specUrl = '/functions/v1/openapi-worker';

  async pollSpec(): Promise<SpecSnapshot> {
    return { fetchedAt: new Date().toISOString(), operations: {} };
  }

  /** A mapped operation appearing for the first time → ContractReady (TC-07). */
  detectContractReady(operationId: string, snap: SpecSnapshot): boolean {
    return operationId in snap.operations;
  }

  /** Field-level DTO diff that drives the "Contract Changed" flag (TC-09/10). */
  diffOperation(prev: OperationShape | undefined, next: OperationShape | undefined): DtoDiff {
    const diff: DtoDiff = { added: [], removed: [], changed: [] };
    const prevF = prev?.fields ?? {};
    const nextF = next?.fields ?? {};
    for (const f of Object.keys(nextF)) {
      if (!(f in prevF)) diff.added.push(f);
      else if (prevF[f] !== nextF[f]) diff.changed.push({ field: f, from: prevF[f], to: nextF[f] });
    }
    for (const f of Object.keys(prevF)) {
      if (!(f in nextF)) diff.removed.push(f);
    }
    return diff;
  }
}
