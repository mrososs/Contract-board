import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BoardStore, formatHours } from '@contract-board/data-access';
import { StatusPill } from '@contract-board/ui';

/**
 * The board — three layouts over the same sprint:
 *  · Lanes       — Design / Frontend / Backend columns
 *  · Matrix      — one row per task, a pill per track
 *  · Convergence — grouped by "what's blocking what"
 * with loading / empty / error overrides layered on top.
 */
@Component({
  selector: 'cb-board-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusPill],
  templateUrl: './board-view.html',
  styleUrl: './board-view.scss',
})
export class BoardView {
  protected readonly store = inject(BoardStore);
  /** Compact hours label for the estimate chips. */
  protected readonly fmt = formatHours;

  /** Keyboard activation for role="button" cards/rows (Enter/Space → open). */
  protected activate(e: Event, open: (e?: Event) => void): void {
    e.preventDefault();
    open(e);
  }
}
