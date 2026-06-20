import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BoardStore } from '@contract-board/data-access';

/** Transient confirmation toast, centered bottom. */
@Component({
  selector: 'cb-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="cb-toast"
      [style.opacity]="visible() ? '1' : '0'"
      [style.transform]="visible() ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(12px)'"
    >
      <div class="cb-toast__inner">
        <span class="cb-toast__check">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <span class="cb-toast__text">{{ store.toast() }}</span>
      </div>
    </div>
  `,
  styles: [
    `
      .cb-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        z-index: 60;
        transition: opacity 0.25s var(--xp-ease), transform 0.25s var(--xp-ease);
        pointer-events: none;
      }
      .cb-toast__inner {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--cb-card);
        border: 1px solid rgba(127, 176, 127, 0.3);
        border-radius: 11px;
        padding: 12px 18px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
      }
      .cb-toast__check {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(127, 176, 127, 0.2);
        color: var(--cb-backend);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .cb-toast__text {
        font-size: 13px;
        color: var(--cb-ink);
      }
    `,
  ],
})
export class Toast {
  protected readonly store = inject(BoardStore);
  protected readonly visible = computed(() => this.store.toast() !== '');
}
