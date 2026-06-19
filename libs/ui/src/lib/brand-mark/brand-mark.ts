import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The ContractBoard mark — three bars for the three tracks (Design/FE/BE). */
@Component({
  selector: 'cb-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="cb-mark"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.padding.px]="pad()"
    >
      <span class="cb-mark__bar" style="height: 9px; background: var(--cb-design);"></span>
      <span class="cb-mark__bar" style="height: 14px; background: var(--cb-frontend);"></span>
      <span class="cb-mark__bar" style="height: 11px; background: var(--cb-backend);"></span>
    </span>
  `,
  styles: [
    `
      .cb-mark {
        display: inline-flex;
        align-items: flex-end;
        justify-content: center;
        gap: 2.5px;
        border-radius: 8px;
        background: var(--cb-ink-bg);
        border: 1px solid var(--cb-line-2);
      }
      .cb-mark__bar {
        width: 3px;
        border-radius: 1px;
      }
    `,
  ],
})
export class BrandMark {
  readonly size = input(30);
  protected readonly pad = computed(() => Math.round(this.size() / 5));
}
