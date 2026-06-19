-- Per-track "who started this user story" — set when a FE/BE member presses
-- Start, so the board shows who is actively working each story in their lane.
alter table task
  add column fe_started_by text,
  add column fe_started_at timestamptz,
  add column be_started_by text,
  add column be_started_at timestamptz;
