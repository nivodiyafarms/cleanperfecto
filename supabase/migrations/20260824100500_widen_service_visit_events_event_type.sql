-- ============================================================================
-- Migration: widen service_visit_events.event_type
-- My CleanPerfecto — Customer Portal V1 milestone.
--
-- Adds 'reschedule_requested', distinct from the existing 'rescheduled'
-- (which remains admin's actual, operational reschedule action). A customer
-- self-service reschedule request only ever writes service_visits.
-- requested_start_at — it never touches confirmed_start_at/status/
-- assignments, so it must never be logged under the same event_type as a
-- real admin-performed reschedule; conflating the two would make the
-- history unreadable ("was this visit actually moved, or just asked to
-- be?"). See request-visit-reschedule.ts.
--
-- Constraint name is the table's original auto-generated name from its
-- inline CHECK in 20260822091200_create_service_visit_events.sql
-- (service_visit_events_event_type_check) — known directly since that
-- migration was authored in this same body of work, not discovered
-- dynamically.
-- ============================================================================

alter table public.service_visit_events
  drop constraint service_visit_events_event_type_check;

alter table public.service_visit_events
  add constraint service_visit_events_event_type_check
  check (event_type in (
    'requested', 'confirmed', 'rescheduled', 'reschedule_requested',
    'cleaner_assigned', 'cleaner_reassigned', 'cleaner_unassigned',
    'cancelled', 'completed', 'no_access_recorded'
  ));
