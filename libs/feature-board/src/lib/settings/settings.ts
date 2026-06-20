import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { BoardStore, ProjectSource } from '@contract-board/data-access';

/**
 * Admin-only Settings screen — configure each Azure project's sync sources
 * (OpenAPI spec URL + Figma file key + polling), separate from the Pull dialog.
 * The Figma PAT stays a shared server secret; only non-secret URLs/keys live here.
 */
@Component({
  selector: 'cb-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly store = inject(BoardStore);

  // Edit form (one project at a time).
  protected readonly project = signal('');
  protected readonly specUrl = signal('');
  protected readonly figmaKey = signal('');
  protected readonly pollEnabled = signal(true);
  protected readonly specTest = signal('');
  protected readonly figmaTest = signal('');

  constructor() {
    this.store.loadProjects();
    this.store.loadProjectSources();
  }

  protected val(e: Event): string {
    return e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement ? e.target.value : '';
  }

  protected onProject(e: Event): void {
    this.loadInto(this.val(e));
  }

  protected edit(s: ProjectSource): void {
    this.loadInto(s.project);
  }

  private loadInto(project: string): void {
    this.project.set(project);
    const existing = this.store.projectSources().find((s) => s.project === project);
    this.specUrl.set(existing?.openapi_spec_url ?? '');
    this.figmaKey.set(existing?.figma_file_key ?? '');
    this.pollEnabled.set(existing?.poll_enabled ?? true);
    this.specTest.set('');
    this.figmaTest.set('');
  }

  protected async testSpec(): Promise<void> {
    if (!this.specUrl().trim()) return;
    this.specTest.set('Testing…');
    try {
      const r = await this.store.testOpenApi(this.specUrl().trim());
      this.specTest.set(r.ok ? `✓ ${r.operations} operations found` : `✗ ${r.error}`);
    } catch (e) {
      this.specTest.set(`✗ ${(e as Error).message}`);
    }
  }

  protected async testFigmaFile(): Promise<void> {
    if (!this.figmaKey().trim()) return;
    this.figmaTest.set('Testing…');
    try {
      const r = await this.store.testFigma(this.figmaKey().trim());
      this.figmaTest.set(r.ok ? `✓ ${r.name}` : `✗ ${r.error}`);
    } catch (e) {
      this.figmaTest.set(`✗ ${(e as Error).message}`);
    }
  }

  protected save(): void {
    if (!this.project()) return;
    this.store.saveProjectSource({
      project: this.project(),
      openapiSpecUrl: this.specUrl().trim(),
      figmaFileKey: this.figmaKey().trim(),
      pollEnabled: this.pollEnabled(),
    });
  }
}
