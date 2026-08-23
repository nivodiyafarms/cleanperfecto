-- ============================================================================
-- Migration: extend service_visits for real operational scheduling
-- Scheduling + Package Management milestone.
--
-- service_visits remains the scheduling anchor (per the original migration's
-- own intent) but has so far been disconnected from booking_orders /
-- prepaid_packages and has no time-of-day. This migration adds:
--   - traceable origin: booking_order_id, prepaid_package_id,
--     recurring_schedule_id (all nullable — a visit may still be created
--     directly with none of these, same rationale as the existing nullable
--     quote_request_id)
--   - a new 'requested' status ahead of the existing scheduled/completed/
--     cancelled lifecycle, representing "customer asked for a date/time but
--     CleanPerfecto has not confirmed a real appointment yet"
--   - timezone-safe confirmed_start_at/confirmed_end_at timestamps (not
--     split date/time columns) plus the frozen duration/staffing estimate
--     that produced them
--
-- Purely additive except widening the status CHECK and replacing the
-- status/timestamp consistency CHECK. Every existing row already has
-- status in ('scheduled','completed','cancelled') with no confirmed_* data
-- at all, so the replacement consistency constraint deliberately does NOT
-- require confirmed_* to be non-null for status='scheduled' — that would
-- break this migration against any existing row. New scheduling code is
-- expected to always set confirmed_* before transitioning to 'scheduled'
-- (enforced by set_service_visit_schedule(), not by this CHECK) — same
-- precedent as requested_start_time not being NOT NULL on booking_orders
-- (see 20260819130000_add_ach_and_cancellation_policy_fields.sql).
--
-- The legacy scheduled_for (date-only) column is left untouched and unused
-- going forward, same precedent as booking_orders.requested_time_window
-- being kept-but-unused after requested_start_time was added.
-- ============================================================================

alter table public.service_visits
  add column booking_order_id uuid references public.booking_orders (id),
  add column prepaid_package_id uuid references public.prepaid_packages (id),
  add column recurring_schedule_id uuid, -- FK added in 20260822090600 once recurring_schedules exists
  add column requested_start_at timestamptz,
  add column confirmed_at timestamptz,
  add column confirmed_start_at timestamptz,
  add column confirmed_end_at timestamptz,
  add column estimated_labor_minutes integer check (estimated_labor_minutes is null or estimated_labor_minutes > 0),
  add column estimated_service_minutes integer check (estimated_service_minutes is null or estimated_service_minutes > 0),
  add column recommended_cleaner_count smallint check (recommended_cleaner_count is null or recommended_cleaner_count > 0),
  add column turnaround_buffer_minutes integer check (turnaround_buffer_minutes is null or turnaround_buffer_minutes >= 0),
  add column timezone text not null default 'America/Chicago';

comment on column public.service_visits.requested_start_at is
  'The customer''s requested appointment start, as a timezone-safe timestamp — still a request, not a guarantee (see booking_orders.requested_date/requested_start_time, which this is derived from at visit-creation time and which retains its own separate meaning). Never treated as a reservation by the availability engine.';

comment on column public.service_visits.confirmed_start_at is
  'The actual confirmed appointment start. Only set (together with confirmed_end_at) when status transitions to ''scheduled'', via set_service_visit_schedule(). Only a ''scheduled'' visit with populated confirmed_* fields and active service_visit_assignments rows counts as real reserved capacity.';

comment on column public.service_visits.estimated_labor_minutes is
  'Frozen at confirmation time from the duration engine (src/lib/scheduling/duration-engine.ts) — total person-minutes of work (e.g. 2 cleaners x 180 min = 360). Not re-derived later, so a future config change never rewrites a historical visit''s recorded estimate.';

comment on column public.service_visits.estimated_service_minutes is
  'Frozen at confirmation time — the calendar time the appointment actually blocks (confirmed_end_at - confirmed_start_at). What the scheduling engine reserves, as distinct from estimated_labor_minutes.';

comment on column public.service_visits.turnaround_buffer_minutes is
  'The turnaround buffer in effect when this visit was confirmed (see DEFAULT_TURNAROUND_BUFFER_MINUTES in src/lib/scheduling/config.ts), frozen per-visit so a later change to the default does not retroactively alter historical buffered_range values on service_visit_assignments.';

alter table public.service_visits
  drop constraint service_visits_status_timestamps_consistent;

alter table public.service_visits
  drop constraint service_visits_status_check;

alter table public.service_visits
  add constraint service_visits_status_check
  check (status in ('requested', 'scheduled', 'completed', 'cancelled'));

alter table public.service_visits
  add constraint service_visits_status_timestamps_consistent check (
    (
      status = 'requested'
      and confirmed_at is null and confirmed_start_at is null and confirmed_end_at is null
      and completed_at is null and cancelled_at is null
    )
    or (
      status = 'scheduled'
      and completed_at is null and cancelled_at is null
      -- confirmed_* is intentionally NOT required non-null here — see
      -- migration header comment on why (pre-existing rows).
    )
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and completed_at is null)
  );

comment on constraint service_visits_status_timestamps_consistent on public.service_visits is
  'requested requires no confirmation/completion/cancellation data at all. scheduled/completed/cancelled remain mutually exclusive on their timestamp columns. confirmed_* is application-enforced (not DB-required) for scheduled, to stay valid against pre-existing rows created before this milestone.';

create index service_visits_booking_order_id_idx
  on public.service_visits (booking_order_id) where booking_order_id is not null;
create index service_visits_prepaid_package_id_idx
  on public.service_visits (prepaid_package_id) where prepaid_package_id is not null;
create index service_visits_status_confirmed_start_idx
  on public.service_visits (status, confirmed_start_at) where status = 'scheduled';
