-- Estimate / time track (lead feedback #1).
--
-- The board pulls only story-level items (Scrum PBIs / Agile User Stories); the
-- real hours live on each story's child Tasks. azure-proxy.pullSprint now sums
-- the child Tasks' Microsoft.VSTS.Scheduling.* hours per parent story and writes
-- them here. numeric (not integer) because Azure scheduling fields are decimals
-- (e.g. 2.5h). Nullable: a story with no child Tasks has no estimate (≠ 0h).
alter table task add column if not exists est_original  numeric;
alter table task add column if not exists est_completed numeric;
alter table task add column if not exists est_remaining numeric;
