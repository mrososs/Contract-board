import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore, BoardStore } from '@contract-board/data-access';
import { BrandMark } from '@contract-board/ui';
import { BoardView } from '../board-view/board-view';
import { GenerateTypes } from '../generate-types/generate-types';
import { Insights } from '../insights/insights';
import { MyWork } from '../my-work/my-work';
import { TaskDetail } from '../task-detail/task-detail';
import { Toast } from '../toast/toast';

/**
 * The application shell — sidebar (nav · who you are) + top bar (title · board
 * layout · admin sprint setup · install) + the active screen, with the task
 * drawer, generate-types modal and toast layered on top.
 */
@Component({
  selector: 'cb-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMark, MyWork, BoardView, Insights, TaskDetail, GenerateTypes, Toast],
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

  /** Captured `beforeinstallprompt` event for the Install button. */
  private installPrompt: { prompt: () => void } | null = null;

  /** Already running as an installed standalone window? Then hide Install. */
  protected readonly standalone = signal(
    typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as { standalone?: boolean }).standalone === true),
  );

  @HostListener('window:beforeinstallprompt', ['$event'])
  onBeforeInstall(e: Event): void {
    e.preventDefault();
    this.installPrompt = e as unknown as { prompt: () => void };
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
    this.store.loadIterations((e.target as HTMLSelectElement).value);
  }
  protected onIteration(e: Event): void {
    this.store.selectedIteration.set((e.target as HTMLSelectElement).value);
  }
}
