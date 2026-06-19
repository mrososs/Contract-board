import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore, Role } from '@contract-board/data-access';
import { BrandMark } from '@contract-board/ui';

interface RoleChoice {
  role: Role;
  label: string;
  who: string;
  color: string;
}

/**
 * First-run, one-time lens pick (planning doc §2). Sets the board lens — not an
 * access level — and is persisted to Supabase so it's never asked again. The
 * admin skips this (defaults to the full-board PM lens).
 */
@Component({
  selector: 'cb-role-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark],
  templateUrl: './role-select.html',
  styleUrl: './role-select.scss',
})
export class RoleSelect {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly busy = signal(false);

  protected readonly roles: RoleChoice[] = [
    { role: 'designer', label: 'Designer', who: 'I mark frames Ready for dev', color: 'var(--cb-design)' },
    { role: 'frontend', label: 'Frontend', who: 'I need design + contract to integrate', color: 'var(--cb-frontend)' },
    { role: 'backend', label: 'Backend', who: 'I ship the contract', color: 'var(--cb-backend)' },
    { role: 'pm', label: 'Lead / PM', who: 'I watch every lane', color: 'var(--cb-mut)' },
  ];

  protected async pick(role: Role): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.setRole(role);
      this.router.navigate(['/app']);
    } finally {
      this.busy.set(false);
    }
  }
}
