import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';
import { StatusPill } from '@contract-board/ui';
import { FocusTrap } from '../focus-trap.directive';

/**
 * Task detail slide-over: the design link (Figma), the backend contract
 * (endpoint + DTOs), the N:N mapping (endpoints + screens this task needs), any
 * DTO diff that landed after the FE started, and the per-task actions.
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

  /** Manual-mapping inputs (admin only). */
  protected readonly newOp = signal('');
  protected readonly newNode = signal('');
  protected readonly newFrame = signal('');

  protected val(e: Event): string {
    return e.target instanceof HTMLInputElement ? e.target.value : '';
  }

  protected addEndpoint(): void {
    this.store.addEndpoint(this.newOp());
    this.newOp.set('');
  }
  protected addScreen(): void {
    this.store.addScreen(this.newNode(), this.newFrame());
    this.newNode.set('');
    this.newFrame.set('');
  }

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.open()) this.store.closeTask();
  }
}
