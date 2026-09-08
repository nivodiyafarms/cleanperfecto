-- ============================================================================
-- Migration: create financial_audit_log table
-- Phase 2 — Production Safety, Environment Controls, RBAC, and Financial
-- Auditability.
--
-- AUTHORED ONLY — DO NOT APPLY. Rehearsed and reviewed in Phase 3.
--
-- Dependencies: requires admin_users (20260823100000_create_admin_users.sql)
-- and service_visit_payments (20260828100300_create_service_visit_payments.sql)
-- to already be applied — both are referenced by foreign key below.
--
-- The prior production-readiness audit found that external-payment
-- recording (record-external-payment.ts) had no actor attribution at all —
-- no "who did this" record for a privileged financial action. This table
-- is a NEW, dedicated append-only ledger rather than an extension of
-- service_visit_events, because that table's event_type enum and shape are
-- specifically about service-visit scheduling lifecycle moments (see its
-- own migration) and has no actor-identity or role-snapshot concept at
-- all — reusing it would mean bolting financial-actor semantics onto a
-- table whose CHECK constraint, indexes, and every existing reader assume
-- a narrower purpose. A dedicated table keeps both audit trails legible on
-- their own terms and is Phase 2's explicitly-invited option when reuse
-- doesn't cleanly fit.
--
-- Scope for this milestone: financial_audit_log currently exists to make
-- the ALREADY-BUILT recordExternalPayment() action traceable (see
-- action_type below). Additional action_type values are pre-declared for
-- capabilities the RBAC model already reserves as owner-only
-- (waive_fee, issue_refund, financial_correction, override_tax,
-- manage_roles, manage_payment_configuration — see
-- src/lib/admin/rbac/capabilities.ts) even though most of those have no
-- real admin action calling them yet, so this table doesn't need a second
-- widening migration the moment one is built.
-- ============================================================================

create table public.financial_audit_log (
  id uuid primary key default gen_random_uuid(),

  -- Actor identity — who performed the action. Not nullable: every row in
  -- this table represents a privileged action an authenticated admin took,
  -- never a system/background process (those have their own event trails,
  -- e.g. service_visit_events, stripe_webhook_events).
  actor_admin_user_id uuid not null references public.admin_users (id),
  -- Snapshotted at write time — admin_users.role can change later (or the
  -- Phase 3 legacy-'admin' backfill can reassign it), and this row must
  -- keep recording what the actor's role actually was at the moment of
  -- the action, not whatever it happens to be now.
  actor_role text not null,

  action_type text not null check (action_type in (
    'external_payment_recorded',
    'fee_waived',
    'refund_issued',
    'financial_correction',
    'tax_override',
    'role_changed',
    'payment_configuration_changed'
  )),

  target_entity_type text not null,
  target_entity_id uuid not null,

  -- Convenience reference for the common case (nearly every financial
  -- action in this codebase is visit-scoped) — nullable because a future
  -- action_type (e.g. role_changed) may have no service_visit at all.
  service_visit_id uuid references public.service_visits (id),

  -- Required by application code for action types that are inherently a
  -- judgment call (e.g. fee_waived) — not DB-enforced per-action-type here
  -- to avoid a second, drifting copy of that business rule; see
  -- src/lib/admin/financial-audit/record-financial-audit-event.ts.
  reason text,

  -- Action-specific before/after or detail snapshot (e.g. { amount: 25,
  -- paymentMethodType: "zelle", externalPaymentReference: "ZL-9" }).
  -- Never a raw card number, bank account number, or any Stripe secret —
  -- application code must only ever pass already-non-sensitive fields.
  metadata jsonb not null default '{}',

  created_at timestamptz not null default now()
);

comment on table public.financial_audit_log is
  'Append-only audit trail for privileged financial admin actions (external payment recording, and reserved for future fee-waiver/refund/correction/tax-override/role-management/payment-configuration actions — see src/lib/admin/rbac/capabilities.ts). Distinct from service_visit_events (scheduling lifecycle only, no actor-identity/role-snapshot concept). Never stores secrets or raw card/bank details — metadata is an already-sanitized JSON snapshot only.';

comment on column public.financial_audit_log.actor_role is
  'Snapshotted at write time, not looked up live from admin_users — a later role change must never rewrite the historical record of what the actor was authorized as when they acted.';

create index financial_audit_log_target_idx
  on public.financial_audit_log (target_entity_type, target_entity_id);

create index financial_audit_log_service_visit_id_idx
  on public.financial_audit_log (service_visit_id)
  where service_visit_id is not null;

create index financial_audit_log_actor_admin_user_id_idx
  on public.financial_audit_log (actor_admin_user_id);

alter table public.financial_audit_log enable row level security;

revoke all privileges
on table public.financial_audit_log
from anon, authenticated;

grant select, insert
on table public.financial_audit_log
to service_role;
-- Deliberately NO update or delete grant — genuinely append-only, enforced
-- at the DB privilege level (same stricter-than-usual convention as
-- service_visit_events), not merely by application-code discipline.
