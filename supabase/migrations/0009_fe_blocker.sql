-- Frontend "raise blocker" with a note.
--
-- When the Frontend finds a Contract-Ready task is insufficient (e.g. missing
-- DTOs), they raise a blocker with a note. The task's backend track goes back to
-- Building (handled in azure-proxy.raiseBlocker) and the note is stored here so
-- it stays visible on the task until the rework lands.
alter table task add column if not exists block_note text;

-- Activity-feed event for the blocker so it renders with its own label.
alter type event_kind add value if not exists 'fe_blocker';
