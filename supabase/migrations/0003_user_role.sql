-- The board lens each member picks once on first sign-in (fixed, not switchable
-- in the dashboard). Nullable: null = first-run role select still pending.
-- Admin defaults to 'pm' (full-board lens).
alter table app_user add column role member_role;
