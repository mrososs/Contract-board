import { DestroyRef, Directive, ElementRef, HostListener, effect, inject, input } from '@angular/core';

/**
 * Lightweight focus trap for overlays (A3) — no @angular/cdk dependency.
 *
 * When `[cbFocusTrap]` is true: focus moves into the host on activation, Tab /
 * Shift+Tab wrap within it, and focus is restored to the previously-focused
 * element on deactivation/destroy. Pair with `[attr.inert]` on a persistent
 * (always-in-DOM) panel so its controls leave the tab order while hidden.
 */
@Directive({ selector: '[cbFocusTrap]' })
export class FocusTrap {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Whether the trap is active. Aliased so the selector doubles as the input. */
  readonly active = input.required<boolean>({ alias: 'cbFocusTrap' });
  private restore: HTMLElement | null = null;

  constructor() {
    effect(() => {
      if (this.active()) {
        this.restore = document.activeElement as HTMLElement | null;
        queueMicrotask(() => this.focusables()[0]?.focus());
      } else if (this.restore) {
        this.restore.focus?.();
        this.restore = null;
      }
    });
    inject(DestroyRef).onDestroy(() => this.restore?.focus?.());
  }

  @HostListener('keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    if (!this.active() || e.key !== 'Tab') return;
    const f = this.focusables();
    if (!f.length) {
      e.preventDefault();
      return;
    }
    const first = f[0];
    const last = f[f.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && a === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null);
  }
}
