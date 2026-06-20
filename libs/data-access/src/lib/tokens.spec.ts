import { describe, expect, it } from 'vitest';
import { conv, deriveConv, initials, pill } from './tokens';

describe('deriveConv — the planning-doc convergence gate', () => {
  it('is closed when Azure macro-status is Closed/Done', () => {
    expect(deriveConv('todo', 'fe_blocked', 'be_wip', 'Closed')).toBe('closed');
    expect(deriveConv('design_ready', 'fe_integration', 'contract_ready', 'Done')).toBe('closed');
  });

  it('is closed when both FE and BE are done, regardless of macro', () => {
    expect(deriveConv('design_ready', 'fe_done', 'be_done')).toBe('closed');
  });

  it('flags an alert when design or frontend changed after handoff', () => {
    expect(deriveConv('design_changed', 'fe_integration', 'contract_ready')).toBe('alert');
    expect(deriveConv('design_ready', 'fe_changed', 'contract_ready')).toBe('alert');
  });

  it('is ready to integrate only when BOTH design and contract are ready', () => {
    expect(deriveConv('design_ready', 'fe_integration', 'contract_ready')).toBe('ready');
    expect(deriveConv('design_ready', 'fe_integration', 'be_done')).toBe('ready');
  });

  it('lets the FE scaffold from design alone (no contract yet)', () => {
    expect(deriveConv('design_ready', 'fe_scaffold', 'be_wip')).toBe('scaffold');
  });

  it('waits on the backend when design is ready but the contract is not', () => {
    expect(deriveConv('design_ready', 'fe_blocked', 'be_wip')).toBe('wait_be');
  });

  it('waits on design when the design is not ready', () => {
    expect(deriveConv('todo', 'fe_blocked', 'be_wip')).toBe('wait_design');
    expect(deriveConv('design_wip', 'fe_blocked', 'contract_ready')).toBe('wait_design');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two names, uppercased', () => {
    expect(initials('Mohamed Osama')).toBe('MO');
    expect(initials('cher')).toBe('C');
  });
  it('returns a middot for the unassigned placeholder', () => {
    expect(initials('—')).toBe('·');
    expect(initials('')).toBe('·');
  });
});

describe('pill / conv tokens', () => {
  it('resolves a known state to its label + colors', () => {
    const p = pill('contract_ready');
    expect(p.label).toBe('Contract Ready');
    expect(p.fg).toBeTruthy();
    expect(p.bg).toBeTruthy();
  });
  it('falls back to To Do for an unknown state', () => {
    expect(pill('nonsense' as never).label).toBe('To Do');
  });
  it('builds a convergence pill with a translucent background from the fg', () => {
    const c = conv('ready');
    expect(c.label).toBe('Ready to integrate');
    expect(c.bg.startsWith(c.fg)).toBe(true);
  });
});
