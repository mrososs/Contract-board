import { ChangeDetectionStrategy, Component, HostListener, computed, inject } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';
import { StatusPill } from '@contract-board/ui';
import { FocusTrap } from '../focus-trap.directive';

/**
 * Task detail slide-over: the design link (Figma), the backend contract
 * (endpoint + DTOs), any DTO diff that landed after the FE started, and the
 * per-task actions (Generate types · Mark FE_Done).
 */
@Component({
  selector: 'cb-task-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StatusPill, FocusTrap],
  templateUrl: './task-detail.html',
  styleUrl: './task-detail.scss',
})
export class TaskDetail {
  protected readonly store = inject(BoardStore);
  protected readonly open = computed(() => this.store.selectedUc() !== null);

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.open()) this.store.closeTask();
  }
}
