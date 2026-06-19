import { computed, inject, Injectable, signal } from '@angular/core';
import { BoardStore } from './board-store';
import { Role } from './models';
import { SupabaseService } from './supabase.service';

export interface Session {
  orgUrl: string;
  /** The Azure PAT — held in memory only, re-sent per privileged call, never stored. */
  pat: string;
  /** Identity resolved from the PAT (no password, planning doc §5). */
  uniqueName: string;
  displayName: string;
  isAdmin: boolean;
  /** The board lens, picked once on first sign-in. null = not chosen yet. */
  role: Role | null;
}

/**
 * Auth is identity-from-token: the user pastes an Azure DevOps PAT (+ org URL),
 * the `azure-proxy` Edge Function asks Azure *who* the token belongs to, and the
 * app records that identity. No password is ever stored. The admin
 * (mohamed.osama) is flagged server-side and gets the sprint-setup controls.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly board = inject(BoardStore);
  private readonly supabase = inject(SupabaseService);

  readonly session = signal<Session | null>(null);
  readonly isAuthenticated = computed(() => this.session() !== null);
  /** A non-admin member who hasn't picked their board lens yet. */
  readonly needsRole = computed(() => {
    const s = this.session();
    return !!s && !s.isAdmin && !s.role;
  });

  /** Paste org URL + PAT → resolve identity → seed the board. Throws on a bad token. */
  async signIn(orgUrl: string, pat: string): Promise<void> {
    const id = await this.supabase.invoke<{
      displayName: string;
      uniqueName: string;
      isAdmin: boolean;
      role: Role | null;
    }>('resolveIdentity', { orgUrl, pat });
    const session: Session = { orgUrl, pat, ...id };
    this.session.set(session);
    if (!this.needsRole()) await this.board.startSession(session);
  }

  /** First-run lens pick (members only) — persisted to Supabase, then board loads. */
  async setRole(role: Role): Promise<void> {
    const s = this.session();
    if (!s) return;
    await this.supabase.invoke('setRole', { uniqueName: s.uniqueName, role });
    const next = { ...s, role };
    this.session.set(next);
    await this.board.startSession(next);
  }

  signOut(): void {
    this.session.set(null);
    this.board.reset();
  }
}
