import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BoardStore, formatHours } from '@contract-board/data-access';

/** Lead/PM pulse — KPIs, track readiness, who's on each side, what's blocked. */
@Component({
  selector: 'cb-insights',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
})
export class Insights {
  protected readonly store = inject(BoardStore);
  /** Compact hours label for the estimate aggregate. */
  protected readonly fmt = formatHours;

  /** Keyboard activation for role="button" cards (Enter/Space → open). */
  protected activate(e: Event, open: (e?: Event) => void): void {
    e.preventDefault();
    open(e);
  }
}
