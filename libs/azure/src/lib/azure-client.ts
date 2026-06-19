import { Injectable } from '@angular/core';

/** A work item as returned by the Azure DevOps REST API (subset we use). */
export interface WorkItem {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  iterationPath: string;
}

export interface SprintRef {
  project: string;
  iterationPath: string;
}

/** Identity resolved from a PAT via the connectionData/profile endpoint. */
export interface AzureIdentity {
  id: string;
  displayName: string;
  uniqueName: string;
}

/**
 * Talks to Azure DevOps **through the Supabase Edge Function proxy** — never
 * the browser directly (Azure REST blocks CORS, and the token must stay
 * server-side). See planning doc §5 "Network reality".
 *
 * NOTE: the live implementation now lives in the deployed `azure-proxy` Edge
 * Function (`supabase/functions/azure-proxy`), invoked from the app via
 * `SupabaseService` in `@contract-board/data-access`. This typed client remains
 * as the contract reference for the worker layer; methods return mocked data.
 */
@Injectable({ providedIn: 'root' })
export class AzureClient {
  /** Supabase Edge Function that holds the PAT and forwards to Azure. */
  proxyUrl = '/functions/v1/azure-proxy';

  /** Resolve "who owns this token" — identity without a password. */
  async resolveIdentity(_pat: string): Promise<AzureIdentity> {
    return { id: 'mock', displayName: 'Unknown', uniqueName: 'unknown@example.com' };
  }

  /**
   * WIQL that scopes the pull to one project + sprint, filtered Azure-side.
   * IDs only; a batched follow-up fetches full details.
   */
  buildSprintWiql({ project, iterationPath }: SprintRef): string {
    return [
      'SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo]',
      'FROM WorkItems',
      `WHERE [System.TeamProject] = '${project}'`,
      `  AND [System.IterationPath] = '${iterationPath}'`,
      `  AND [System.WorkItemType] = 'Task'`,
      'ORDER BY [System.State]',
    ].join('\n');
  }

  /** Pull the whole sprint (read uses the admin token, server-side). */
  async fetchSprint(_sprint: SprintRef): Promise<WorkItem[]> {
    return [];
  }

  /** Per-user write — Azure records the action under *their* identity. */
  async setState(_id: number, _state: string): Promise<void> {
    /* POST to the proxy with the member's own PAT */
  }

  /** Completed Work is *added*, never overwriting PM estimates (TC-15). */
  async addCompletedWork(_id: number, _hours: number): Promise<void> {
    /* additive update via proxy */
  }
}
