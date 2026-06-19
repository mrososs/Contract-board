import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';

/** One-click `ng-openapi-gen` preview — TS interfaces + service from the DTO. */
@Component({
  selector: 'cb-generate-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './generate-types.html',
  styleUrl: './generate-types.scss',
})
export class GenerateTypes {
  protected readonly store = inject(BoardStore);

  protected stop(e: Event): void {
    e.stopPropagation();
  }
}
