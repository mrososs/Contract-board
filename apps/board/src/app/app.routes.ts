import { inject } from '@angular/core';
import { CanActivateFn, Route, Router } from '@angular/router';
import { AuthStore } from '@contract-board/data-access';
import { Login, RoleSelect } from '@contract-board/feature-auth';
import { authGuard, boardRoutes } from '@contract-board/feature-board';

/** Only reachable while signed in *and* still owing a one-time role pick. */
const roleGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login']);
  if (!auth.needsRole()) return router.createUrlTree(['/app']);
  return true;
};

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: 'login', component: Login },
  { path: 'role', canActivate: [roleGuard], component: RoleSelect },
  { path: 'app', canActivate: [authGuard], children: boardRoutes },
  { path: '**', redirectTo: 'login' },
];
