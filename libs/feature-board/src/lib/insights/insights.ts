import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';

/** Lead/PM pulse — KPIs, track readiness, who's on each side, what's blocked. */
@Component({
  selector: 'cb-insights',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insights.html',
  styleUrl: './insights.scss',
})
export class Insights {
  protected readonly store = inject(BoardStore);

  /** Keyboard activation for role="button" cards (Enter/Space → open). */
  protected activate(e: Event, open: (e?: Event) => void): void {
    e.preventDefault();
    open(e);
  }
}
