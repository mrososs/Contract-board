import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthStore } from '@contract-board/data-access';
import { BrandMark } from '@contract-board/ui';

/**
 * Sign in — "authenticate as yourself so Azure records *who* moved each task".
 * Identity comes from the Personal Access Token (the password field), not a
 * stored password (planning doc §5). The admin (mohamed.osama) is recognised
 * server-side and gets the sprint-setup controls.
 */
@Component({
  selector: 'cb-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  constructor() {
    // A restored session (installed PWA relaunch) skips the login screen.
    if (this.auth.isAuthenticated()) {
      this.router.navigate([this.auth.needsRole() ? '/role' : '/app']);
    }
  }

  protected readonly orgUrl = signal('dev.azure.com/iSaned');
  protected readonly pat = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    if (this.busy() || !this.pat().trim()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signIn(this.orgUrl().trim(), this.pat().trim());
      this.router.navigate([this.auth.needsRole() ? '/role' : '/app']);
    } catch (e) {
      this.error.set((e as Error).message || 'Could not verify that token.');
    } finally {
      this.busy.set(false);
    }
  }
}
