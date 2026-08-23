-- ============================================================================
-- Migration: enable btree_gist and create service_visit_assignments
-- Scheduling + Package Management milestone.
--
-- Many-to-many link between cleaners and service_visits (no fixed crews —
-- any mix of cleaners can be assigned to any job). Reassignment preserves
-- history: the old row gets unassigned_at set, a new row is inserted; rows
-- are never deleted or overwritten in place.
--
-- Double-booking protection, layer 2 (DB-level; layer 1 is the application
-- availability check in src/lib/scheduling/availability.ts): an EXCLUDE
-- constraint using btree_gist guarantees no two ACTIVE assignments for the
-- same cleaner can have overlapping (buffer-inclusive) time ranges, even
-- under concurrent confirmation attempts racing the same slot. This is
-- enforced atomically by Postgres itself — no application-level locking
-- code is required for correctness, only for a friendlier error message.
--
-- buffered_range is buffered on ONE side only:
--   [confirmed_start_at, confirmed_end_at + turnaround_buffer_minutes)
-- A symmetric +/- buffer would silently require DOUBLE the intended gap
-- between back-to-back jobs (e.g. 120 min instead of the V1 60-minute
-- buffer) — this asymmetric range is deliberate. For two ranges
-- [s1, e1+B) and [s2, e2+B), disjointness requires e1+B <= s2 OR
-- e2+B <= s1 — exactly a single B-minute gap in whichever order the two
-- jobs fall, with no special-casing by which job comes first. This also
-- means a literal 0-buffer overlap is still caught by the same constraint,
-- so no separate plain-overlap constraint is needed.
--
-- buffered_range is a plain stored column, NOT a Postgres GENERATED column
-- — it is computed and written explicitly by set_service_visit_schedule()
-- (see 20260822091400_create_scheduling_rpc_functions.sql) from that row's
-- OWN frozen turnaround_buffer_minutes, never by re-reading live config.
-- This is what lets the buffer default change later (e.g. 60 -> 30 minutes
-- as staffing grows) without rewriting any historical assignment's range.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

create table public.service_visit_assignments (
  id uuid primary key default gen_random_uuid(),

  service_visit_id uuid not null references public.service_visits (id),
  cleaner_id uuid not null references public.cleaners (id),

  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,

  -- Buffer-inclusive confirmed time range for this specific assignment,
  -- frozen at assignment time (or updated in place by
  -- set_service_visit_schedule() if the same cleaner's timing/buffer
  -- changes on a reschedule) — see migration header comment.
  buffered_range tstzrange not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint service_visit_assignments_no_overlap
    exclude using gist (cleaner_id with =, buffered_range with &&)
    where (unassigned_at is null)
);

comment on table public.service_visit_assignments is
  'Many-to-many cleaner <-> service_visit link. Rows exist ONLY for a scheduled (confirmed) visit — a merely-requested visit has zero rows here, so "unassigned_at IS NULL" always means real reserved capacity, with no need to join back to service_visits.status to know that. Reassignment = unassign the old row (set unassigned_at) + insert a new one; history is preserved, never overwritten.';

comment on constraint service_visit_assignments_no_overlap on public.service_visit_assignments is
  'DB-level double-booking protection: no two active (unassigned_at IS NULL) assignments for the same cleaner may have overlapping buffered_range values. Enforced atomically by Postgres, independent of any application-level pre-check.';

create trigger service_visit_assignments_set_updated_at
before update on public.service_visit_assignments
for each row execute function public.set_updated_at();

create unique index service_visit_assignments_one_active_per_visit_cleaner
  on public.service_visit_assignments (service_visit_id, cleaner_id) where unassigned_at is null;

create index service_visit_assignments_service_visit_id_idx
  on public.service_visit_assignments (service_visit_id);
create index service_visit_assignments_cleaner_active_idx
  on public.service_visit_assignments (cleaner_id) where unassigned_at is null;

alter table public.service_visit_assignments enable row level security;

revoke all privileges
on table public.service_visit_assignments
from anon, authenticated;

grant select, insert, update
on table public.service_visit_assignments
to service_role;
-- No delete grant — unassign via unassigned_at, never delete, so historical
-- staffing/assignment data is preserved for future cleaner-hour tracking.
