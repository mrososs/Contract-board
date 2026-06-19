import { Route } from '@angular/router';
import { AppShell } from './app-shell/app-shell';

/** Routes mounted under `/app` — the shell drives screens via signal state. */
export const boardRoutes: Route[] = [{ path: '', component: AppShell }];
