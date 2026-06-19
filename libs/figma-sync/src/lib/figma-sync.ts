import { Injectable } from '@angular/core';

export type DesignStatus = 'wip' | 'ready' | 'changed' | 'unknown';

export interface FrameSnapshot {
  nodeId: string;
  /** Frame / page name — the UC number is embedded here by convention. */
  name: string;
  status: DesignStatus;
  /** Figma `lastModified` at the node level — basis for change detection. */
  lastModified: string;
}

/**
 * Polls the linked Figma file's Dev Mode status and diffs frames the same way
 * the OpenAPI worker diffs DTOs. "Design Ready" is detected from the
 * "Ready for development" status — never a manual checkbox (planning doc §1).
 *
 * v1 relies on Figma's `lastModified` / version history rather than a
 * pixel-level diff (open question §9.7).
 */
@Injectable({ providedIn: 'root' })
export class FigmaSyncService {
  fileKey = '';
  /** Worker proxy holding the Figma read token (open question §9.8). */
  workerUrl = '/functions/v1/figma-worker';

  async pollDesignStatus(): Promise<FrameSnapshot[]> {
    return [];
  }

  /** Frame marked "Ready for development" → DesignReady (TC-22). */
  isReady(frame: FrameSnapshot): boolean {
    return frame.status === 'ready';
  }

  /** Edited after it was marked ready → DesignChanged (TC-24). */
  detectChanged(prev: FrameSnapshot | undefined, next: FrameSnapshot): boolean {
    return !!prev && prev.status === 'ready' && next.lastModified !== prev.lastModified;
  }
}
