import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The signature status chip. State is communicated by colour **and** label
 * (never colour alone — accessibility, planning doc §7). Presentational only:
 * caller passes the resolved tokens.
 */
@Component({
  selector: 'cb-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="cb-pill"
      [style.color]="fg()"
      [style.background]="bg()"
      [style.padding]="dense() ? '3px 8px' : '4px 9px'"
    >
      <span class="cb-pill__dot" [style.background]="fg()"></span>
      {{ label() }}
    </span>
  `,
  styles: [
    `
      .cb-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-family: var(--xp-sans);
        font-size: 10px;
        font-weight: 600;
        border-radius: 999px;
        white-space: nowrap;
        width: fit-content;
      }
      .cb-pill__dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
      }
    `,
  ],
})
export class StatusPill {
  readonly label = input.required<string>();
  readonly fg = input.required<string>();
  readonly bg = input.required<string>();
  readonly dense = input(false);
}
