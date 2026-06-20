-- Manual design links (designer dashboard).
--
-- Until the Figma auto-sync is enabled, a designer pastes the Figma screen URLs
-- for a UC by hand and marks the design Finished. We store those URLs on the
-- existing task_screen rows (is_manual = true), so FE/BE see the same links.
alter table task_screen add column if not exists url text;
