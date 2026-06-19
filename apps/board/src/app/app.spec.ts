import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { SUPABASE_CONFIG } from '@contract-board/data-access';
import { App } from './app';
import { appRoutes } from './app.routes';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(appRoutes),
        { provide: SUPABASE_CONFIG, useValue: { url: 'http://localhost', anonKey: 'test-anon-key' } },
      ],
    }).compileComponents();
  });

  it('should create the root component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
