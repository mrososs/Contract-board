import { computed, inject, Injectable, signal } from '@angular/core';
import { BoardStore } from './board-store';
import { Role } from './models';
import { SupabaseService } from './supabase.service';

export interface Session {
  orgUrl: string;
  /** The Azure PAT — re-sent per privileged call. Persisted locally so the
   *  installed PWA reopens signed-in (a scoped, revocable token, not a password). */
  pat: string;
  /** Identity resolved from the PAT (no password, planning doc §5). */
  uniqueName: string;
  displayName: string;
  isAdmin: boolean;
  /** The board lens, picked once on first sign-in. null = not chosen yet. */
  role: Role | null;
}

const STORAGE_KEY = 'cb.session';

function readStored(): Session | null {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/**
 * Auth is identity-from-token: the user pastes an Azure DevOps PAT (+ org URL),
 * the `azure-proxy` Edge Function asks Azure *who* the token belongs to, and the
 * app records that identity. The session is persisted to localStorage so the
 * installed PWA relaunches straight into the board — sign out clears it.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly board = inject(BoardStore);
  private readonly supabase = inject(SupabaseService);

  readonly session = signal<Session | null>(readStored());
  readonly isAuthenticated = computed(() => this.session() !== null);
  /** A non-admin member who hasn't picked their board lens yet. */
  readonly needsRole = computed(() => {
    const s = this.session();
    return !!s && !s.isAdmin && !s.role;
  });

  constructor() {
    // Rehydrate the board from a restored session (skip if a role is still owed).
    const s = this.session();
    if (s && !this.needsRole()) void this.board.startSession(s);
  }

  /** Paste org URL + PAT → resolve identity → seed the board. Throws on a bad token. */
  async signIn(orgUrl: string, pat: string): Promise<void> {
    const id = await this.supabase.invoke<{
      displayName: string;
      uniqueName: string;
      isAdmin: boolean;
      role: Role | null;
    }>('resolveIdentity', { orgUrl, pat });
    const session: Session = { orgUrl, pat, ...id };
    this.persist(session);
    if (!this.needsRole()) await this.board.startSession(session);
  }

  /** First-run lens pick (members only) — persisted to Supabase, then board loads. */
  async setRole(role: Role): Promise<void> {
    const s = this.session();
    if (!s) return;
    await this.supabase.invoke('setRole', { uniqueName: s.uniqueName, role });
    const next = { ...s, role };
    this.persist(next);
    await this.board.startSession(next);
  }

  signOut(): void {
    this.session.set(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    this.board.reset();
  }

  private persist(session: Session): void {
    this.session.set(session);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable — session stays in memory only */
    }
  }
}
