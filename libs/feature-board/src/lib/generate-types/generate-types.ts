import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';
import { FocusTrap } from '../focus-trap.directive';

/** One-click `ng-openapi-gen` preview — TS interfaces + service from the DTO. */
@Component({
  selector: 'cb-generate-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FocusTrap],
  templateUrl: './generate-types.html',
  styleUrl: './generate-types.scss',
})
export class GenerateTypes {
  protected readonly store = inject(BoardStore);

  protected stop(e: Event): void {
    e.stopPropagation();
  }

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.store.genOpen()) this.store.closeGen();
  }
}
