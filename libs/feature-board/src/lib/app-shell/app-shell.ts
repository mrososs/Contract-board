import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore, BoardStore, Role } from '@contract-board/data-access';
import { BrandMark } from '@contract-board/ui';
import { ActivityFeed } from '../activity-feed/activity-feed';
import { BoardView } from '../board-view/board-view';
import { GenerateTypes } from '../generate-types/generate-types';
import { Insights } from '../insights/insights';
import { MyWork } from '../my-work/my-work';
import { Settings } from '../settings/settings';
import { TaskDetail } from '../task-detail/task-detail';
import { Toast } from '../toast/toast';

/** The Chromium `beforeinstallprompt` event — not in the standard DOM lib. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/**
 * The application shell — sidebar (nav · who you are) + top bar (title · board
 * layout · admin sprint setup · install) + the active screen, with the task
 * drawer, generate-types modal and toast layered on top.
 */
@Component({
  selector: 'cb-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, MyWork, BoardView, Insights, Settings, TaskDetail, GenerateTypes, Toast, ActivityFeed],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class AppShell {
  protected readonly store = inject(BoardStore);
  protected readonly auth = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly layouts: { key: 'lanes' | 'matrix' | 'conv'; label: string }[] = [
    { key: 'lanes', label: 'Lanes' },
    { key: 'matrix', label: 'Matrix' },
    { key: 'conv', label: 'Convergence' },
  ];

  /** Demo-mode lens switcher options. */
  protected readonly demoRoles: { role: Role; label: string }[] = [
    { role: 'designer', label: 'Designer' },
    { role: 'frontend', label: 'Frontend' },
    { role: 'backend', label: 'Backend' },
    { role: 'pm', label: 'Lead / PM' },
  ];

  /** Captured `beforeinstallprompt` event for the Install button. */
  private installPrompt: BeforeInstallPromptEvent | null = null;

  /** Already running as an installed standalone window? Then hide Install. */
  protected readonly standalone = signal(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as { standalone?: boolean }).standalone === true),
  );

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstall(e: Event): void {
    e.preventDefault();
    // Only Chromium fires this; guard the shape before keeping it.
    this.installPrompt = 'prompt' in e ? (e as BeforeInstallPromptEvent) : null;
  }

  @HostListener('window:appinstalled')
  onInstalled(): void {
    this.installPrompt = null;
    this.standalone.set(true);
    this.store.fireToast('ContractBoard installed — open it from your desktop');
  }

  protected install(): void {
    if (this.installPrompt) {
      this.installPrompt.prompt();
      this.installPrompt = null;
    } else {
      this.store.fireToast('Use your browser menu → Install ContractBoard');
    }
  }

  protected signOut(): void {
    this.auth.signOut();
    this.router.navigate(['/login']);
  }

  // ---- admin sprint setup -------------------------------------------------
  protected onProject(e: Event): void {
    if (e.target instanceof HTMLSelectElement) this.store.loadIterations(e.target.value);
  }
  protected onIteration(e: Event): void {
    if (e.target instanceof HTMLSelectElement) this.store.selectedIteration.set(e.target.value);
  }

  /** Multi-project board switcher. */
  protected onBoardProject(e: Event): void {
    if (e.target instanceof HTMLSelectElement) this.store.setBoardProject(e.target.value);
  }
}
