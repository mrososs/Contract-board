import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';
import { StatusPill } from '@contract-board/ui';

/** Role-focused "what's mine" view — you see only what's yours. */
@Component({
  selector: 'cb-my-work',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusPill],
  templateUrl: './my-work.html',
})
export class MyWork {
  protected readonly store = inject(BoardStore);
}
