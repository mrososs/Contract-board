import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { ActivityItem, BoardStore } from '@contract-board/data-access';
import { FocusTrap } from '../focus-trap.directive';

interface FeedRow extends ActivityItem {
  dot: string;
  tag: string;
  ago: string;
}

/** kind → [accent color, human label]. Mirrors the track accents in tokens.ts. */
const KIND: Record<string, [string, string]> = {
  design_ready: ['#3BA7B3', 'Design ready'],
  design_changed: ['#D9885F', 'Design changed'],
  contract_ready: ['#3BA7B3', 'Contract ready'],
  contract_changed: ['#D9885F', 'Contract changed'],
  contract_check_failed: ['#D9885F', 'Endpoint check failed'],
  endpoint_ready: ['#3BA7B3', 'Endpoint ready'],
  screen_ready: ['#3BA7B3', 'Screen ready'],
  fe_blocker: ['#D9885F', 'Frontend blocker'],
  fe_done: ['#7FB07F', 'Frontend done'],
  be_done: ['#7FB07F', 'Backend done'],
  closed: ['#7FB07F', 'Closed'],
};

/**
 * Live activity feed (B4): the detected handoff signals — Design Ready, Contract
 * Ready, DTO changed, FE/BE done — newest first. History loads via the Edge
 * Function; new rows arrive over the Realtime 'board' broadcast (B3).
 */
@Component({
  selector: 'cb-activity-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FocusTrap],
  templateUrl: './activity-feed.html',
  styleUrl: './activity-feed.scss',
})
export class ActivityFeed {
  protected readonly store = inject(BoardStore);
  protected readonly open = computed(() => this.store.activityOpen());

  protected readonly rows = computed<FeedRow[]>(() =>
    this.store.activity().map((a) => {
      const [dot, tag] = KIND[a.kind] ?? ['#9097A0', a.kind];
      return { ...a, dot, tag, ago: this.ago(a.created_at) };
    }),
  );

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.open()) this.store.closeActivity();
  }

  /** Compact relative time, e.g. "just now" · "5m" · "2h" · "3d". */
  private ago(iso: string): string {
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '';
    const s = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m`;
    if (s < 86400) return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}d`;
  }
}
