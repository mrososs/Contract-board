import { inject, Injectable, InjectionToken } from '@angular/core';
import { createClient, FunctionsHttpError, SupabaseClient } from '@supabase/supabase-js';

/** Project URL + public anon key — safe to ship in the client bundle. */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export const SUPABASE_CONFIG = new InjectionToken<SupabaseConfig>('SUPABASE_CONFIG');

/**
 * Thin wrapper over the Supabase client. The browser never touches Azure or the
 * database directly — every privileged action is an op on the `azure-proxy`
 * Edge Function, which holds the PAT server-side and uses the service role for
 * DB writes (planning doc §5).
 */
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly config = inject(SUPABASE_CONFIG);
  readonly client: SupabaseClient = createClient(this.config.url, this.config.anonKey);

  /** Invoke an `azure-proxy` op; throws with the server's error message on failure. */
  async invoke<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.functions.invoke('azure-proxy', {
      body: { op, payload },
    });
    if (error) {
      let message = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const body = await error.context.json();
          if (body?.error) message = body.error;
        } catch {
          /* keep the generic message */
        }
      }
      throw new Error(message);
    }
    return data as T;
  }
}
