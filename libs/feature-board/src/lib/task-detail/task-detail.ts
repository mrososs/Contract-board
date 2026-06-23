import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { BoardStore, formatHours } from '@contract-board/data-access';
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
  /** Designer dashboard: paste a Figma screen link. */
  protected readonly newLink = signal('');
  /** FE "raise blocker" note + open toggle. */
  protected readonly newBlocker = signal('');
  protected readonly blockerOpen = signal(false);

  /** True for the designer lens (or admin) — may edit design links / handoff. */
  protected readonly canDesign = computed(() => this.store.isAdmin() || this.store.role() === 'designer');

  /** Compact hours label for the estimate block. */
  protected readonly fmt = formatHours;

  /** Completed-over-original fill width for the estimate bar (clamped, /0-safe). */
  protected estPct(sel: { estOriginal: number | null; estCompleted: number | null }): string {
    const o = sel.estOriginal ?? 0;
    const c = sel.estCompleted ?? 0;
    if (o <= 0) return '0%';
    return Math.min(100, Math.round((c / o) * 100)) + '%';
  }

  protected val(e: Event): string {
    const t = e.target;
    return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement ? t.value : '';
  }

  protected raiseBlocker(): void {
    this.store.raiseBlocker(this.newBlocker());
    this.newBlocker.set('');
    this.blockerOpen.set(false);
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
  protected addLink(): void {
    this.store.addDesignLink(this.newLink());
    this.newLink.set('');
  }

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.open()) this.store.closeTask();
  }
}
