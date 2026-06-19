import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { SUPABASE_CONFIG } from '@contract-board/data-access';
import { appRoutes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    {
      // Project URL + public anon key — safe to ship client-side. The PAT and
      // service-role key live only in the `azure-proxy` Edge Function.
      provide: SUPABASE_CONFIG,
      useValue: {
        url: 'https://agynsfjrhpabioiwjdpq.supabase.co',
        anonKey:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFneW5zZmpyaHBhYmlvaXdqZHBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MTU3NjQsImV4cCI6MjA5NzM5MTc2NH0.pvptKM7ZS6FRym5pOspz3OwiPGR5lCNefg25OpPFj5E',
      },
    },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
