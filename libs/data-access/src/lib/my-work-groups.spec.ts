import { describe, expect, it, vi } from 'vitest';
import { DecoratedTask } from './models';
import { buildMyGroups, MyWorkDeps } from './my-work-groups';
import { conv, pill } from './tokens';

/** Minimal DecoratedTask factory — only the fields buildMyGroups reads matter. */
function task(over: Partial<DecoratedTask>): DecoratedTask {
  const base: DecoratedTask = {
    uc: 'UC-1',
    azureId: 1,
    title: 'Story',
    designer: '—',
    feDev: '—',
    beDev: '—',
    d: 'todo',
    f: 'fe_blocked',
    b: 'be_wip',
    conv: 'wait_design',
    endpoint: '— pending',
    dtos: '',
    closed: false,
    feStartedBy: null,
    beStartedBy: null,
    dp: pill('todo'),
    fp: pill('fe_blocked'),
    bp: pill('be_wip'),
    cv: conv('wait_design'),
    dtoList: [],
    open: vi.fn(),
  };
  return { ...base, ...over };
}

const deps: MyWorkDeps = {
  me: 'Me',
  toastCta: () => vi.fn(),
  openCta: () => vi.fn(),
  startCta: () => vi.fn(),
  stopCta: () => vi.fn(),
  doneCta: () => vi.fn(),
};

const byLabel = (groups: ReturnType<typeof buildMyGroups>, label: string) =>
  groups.find((g) => g.label === label);

describe('buildMyGroups — frontend lens', () => {
  const tasks = [
    task({ uc: 'UC-1', feStartedBy: 'Me', f: 'fe_integration' }), // working on
    task({ uc: 'UC-2', feStartedBy: null, f: 'fe_blocked', d: 'design_ready', b: 'be_wip' }), // ready to build (scaffold)
    task({ uc: 'UC-3', feStartedBy: 'Me', f: 'fe_done' }), // done by me
    task({ uc: 'UC-4', feStartedBy: 'Ada', f: 'fe_integration' }), // taken by team
    task({ uc: 'UC-5', feStartedBy: null, f: 'fe_blocked', d: 'design_wip' }), // waiting on design
    task({ uc: 'UC-6', feStartedBy: null, f: 'fe_blocked', d: 'design_ready', b: 'contract_ready' }), // ready to build (integrate)
  ];
  const groups = buildMyGroups('frontend', tasks, deps);

  it('puts the story I started in "Working on" with a Stop secondary action', () => {
    const g = byLabel(groups, 'Working on');
    expect(g?.count).toBe(1);
    expect(g?.items[0].uc).toBe('UC-1');
    expect(g?.items[0].cta2Label).toBe('Stop');
  });

  it('offers design-ready unclaimed stories under "Ready to build" with a Start action', () => {
    const g = byLabel(groups, 'Ready to build');
    expect(g?.items.map((i) => i.uc)).toEqual(['UC-2', 'UC-6']);
    expect(g?.items.every((i) => i.ctaLabel === 'Start')).toBe(true);
  });

  it('labels the scaffold vs integrate start path by contract readiness', () => {
    const g = byLabel(groups, 'Ready to build');
    expect(g?.items.find((i) => i.uc === 'UC-2')?.sub).toContain('scaffold');
    expect(g?.items.find((i) => i.uc === 'UC-6')?.sub).toContain('integrate');
  });

  it('holds not-yet-designed unclaimed stories under "Waiting on design" (no Start)', () => {
    const g = byLabel(groups, 'Waiting on design');
    expect(g?.items.map((i) => i.uc)).toEqual(['UC-5']);
    expect(g?.items[0].ctaLabel).toBe('Open');
  });

  it('separates my finished stories from ones taken by teammates', () => {
    expect(byLabel(groups, 'Done')?.items[0].uc).toBe('UC-3');
    expect(byLabel(groups, 'Taken by the team')?.items[0].uc).toBe('UC-4');
  });

  it('omits empty groups entirely', () => {
    const onlyReady = buildMyGroups('frontend', [task({ feStartedBy: null, d: 'design_ready' })], deps);
    expect(onlyReady.map((g) => g.label)).toEqual(['Ready to build']);
  });
});

describe('buildMyGroups — pm lens (read-only oversight)', () => {
  const tasks = [
    task({ uc: 'UC-1', feStartedBy: 'Ada' }), // in progress
    task({ uc: 'UC-2', f: 'fe_done', b: 'be_done' }), // done (both tracks)
    task({ uc: 'UC-3' }), // not started
  ];
  const groups = buildMyGroups('pm', tasks, deps);

  it('classifies started / done / not-started', () => {
    expect(byLabel(groups, 'In progress')?.items[0].uc).toBe('UC-1');
    expect(byLabel(groups, 'Done')?.items[0].uc).toBe('UC-2');
    expect(byLabel(groups, 'Not started yet')?.items[0].uc).toBe('UC-3');
  });

  it('every PM card uses the read-only "Open" action', () => {
    for (const g of groups) for (const i of g.items) expect(i.ctaLabel).toBe('Open');
  });
});

describe('buildMyGroups — unknown role', () => {
  it('returns no groups', () => {
    expect(buildMyGroups('designer', [], deps)).toEqual([]);
  });
});
