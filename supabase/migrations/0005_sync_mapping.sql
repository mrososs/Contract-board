-- Sync-worker support (B1/B2).
--
-- The Figma worker compares the file `version` it saw last vs. now to decide
-- "edited after handoff" (TC-24); store that basis per design snapshot.
alter table design_snapshot
  add column if not exists fingerprint text;

-- The workers resolve task ↔ operation/frame by the UC number on the task, so
-- index it for the per-run lookups.
create index if not exists task_uc_idx on task(uc);

-- Mapping lookups by the resolved operation / node (manual-override UI, B2).
create index if not exists task_mapping_op_idx   on task_mapping(openapi_operation_id);
create index if not exists task_mapping_node_idx on task_mapping(figma_node_id);
