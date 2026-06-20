import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';
import { FocusTrap } from '../focus-trap.directive';

/** `ng-openapi-gen` helper — shows the real command for the task's spec URL,
 *  copies it, and flips the task to Integration on confirm. */
@Component({
  selector: 'cb-generate-types',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FocusTrap],
  templateUrl: './generate-types.html',
  styleUrl: './generate-types.scss',
})
export class GenerateTypes {
  protected readonly store = inject(BoardStore);
  protected readonly copied = signal(false);

  protected stop(e: Event): void {
    e.stopPropagation();
  }

  protected async copy(cmd: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      this.store.fireToast('Copy failed — select the command manually');
    }
  }

  @HostListener('document:keydown.escape')
  protected onEsc(): void {
    if (this.store.genOpen()) this.store.closeGen();
  }
}
