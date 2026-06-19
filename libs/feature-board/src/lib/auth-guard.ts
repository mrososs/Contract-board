import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStore } from '@contract-board/data-access';

/**
 * Gate the app shell — unauthenticated visitors land on the login, and members
 * who haven't yet picked their board lens are sent to the one-time role select.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  if (auth.needsRole()) return router.createUrlTree(['/role']);
  return true;
};
