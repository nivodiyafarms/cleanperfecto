-- ============================================================================
-- Migration: waive_service_fee_assessment_with_audit() atomic RPC
-- Phase 2 — closing the fee-waiver actor-audit gap.
--
-- AUTHORED ONLY — DO NOT APPLY. Rehearsed and reviewed in Phase 3.
--
-- Fee waiving is now an owner-only privileged financial mutation (see
-- src/lib/admin/rbac/capabilities.ts's waive_fee capability), but
-- service_fee_assessments has no actor column at all — not even a
-- free-text one (unlike service_visit_events.actor). A successful waiver
-- had no traceable actor whatsoever. This function closes that gap using
-- the SAME atomic-mutation-plus-audit-insert principle already established
-- for external-payment recording (see
-- 20260907090200_create_record_external_visit_payment_with_audit_function.sql):
-- the fee-state transition and its financial_audit_log row commit
-- together, in one transaction, or neither commits.
--
-- Reuses financial_audit_log (not service_visit_events) as the audit
-- target — deliberately. service_visit_events.actor is a bare TEXT field
-- (free-form strings like "admin:<uuid>") with no actor_role snapshot
-- column and no FK to admin_users; retrofitting it to carry a proper
-- role-snapshot would mean widening a table used by ~10 other scheduling-
-- lifecycle event types for a concern (privileged-financial-actor
-- attribution) it was never scoped for. financial_audit_log already has
-- the exact actor_admin_user_id/actor_role/action_type/target/reason/
-- metadata shape this needs, and 'fee_waived' was already reserved as a
-- valid action_type when that table was authored — no widening needed.
--
-- Also closes a smaller pre-existing gap as a side effect: the previous
-- application-level update had no guard against re-waiving an
-- already-waived/paid/void fee (an unconditional UPDATE), which could
-- otherwise let a duplicate/replayed action grow the reason text and/or
-- write more than one audit row for what should be a single logical
-- waiver. This function requires state='assessed' — the same "guard the
-- one-time transition, reuse the pattern already used for external
-- payments" approach, not a new invented idempotency mechanism.
--
-- Dependencies: requires service_fee_assessments
-- (20260822091100_create_service_fee_assessments.sql) and
-- financial_audit_log (20260907090100_create_financial_audit_log.sql) to
-- already be applied.
--
-- Safety: no DROP/TRUNCATE, no destructive statement, no cron/side effect —
-- a single new function definition, mirroring this schema's existing
-- atomic-RPC convention.
-- ============================================================================

create or replace function public.waive_service_fee_assessment_with_audit(
  p_fee_assessment_id uuid,
  p_reason text,
  p_actor_admin_user_id uuid,
  p_actor_role text
)
returns public.service_fee_assessments
language plpgsql
set search_path = public
as $$
declare
  v_assessment service_fee_assessments;
  v_next_reason text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'waive_service_fee_assessment_with_audit: a reason is required to waive a fee';
  end if;

  select * into v_assessment from service_fee_assessments where id = p_fee_assessment_id for update;

  if v_assessment.id is null then
    raise exception 'service_fee_assessments % not found', p_fee_assessment_id;
  end if;

  if v_assessment.state <> 'assessed' then
    raise exception 'service_fee_assessments % is not eligible for waiver (state=%)', p_fee_assessment_id, v_assessment.state;
  end if;

  v_next_reason := case
    when v_assessment.reason is not null then v_assessment.reason || ' — Waived: ' || p_reason
    else 'Waived: ' || p_reason
  end;

  update service_fee_assessments
  set state = 'waived', reason = v_next_reason
  where id = p_fee_assessment_id
  returning * into v_assessment;

  insert into financial_audit_log (
    actor_admin_user_id, actor_role, action_type,
    target_entity_type, target_entity_id, service_visit_id,
    reason, metadata
  ) values (
    p_actor_admin_user_id, p_actor_role, 'fee_waived',
    'service_fee_assessment', p_fee_assessment_id, v_assessment.service_visit_id,
    p_reason,
    jsonb_build_object(
      'feeType', v_assessment.fee_type,
      'amount', v_assessment.amount,
      'policyVersion', v_assessment.policy_version
    )
  );

  return v_assessment;
end;
$$;

comment on function public.waive_service_fee_assessment_with_audit(uuid, text, uuid, text) is
  'Atomically transitions a service_fee_assessments row to state=waived AND records the required financial_audit_log actor-attribution row in one transaction — either both commit or neither does. Refuses (raises) if the row is not currently state=assessed, closing a prior gap where a duplicate/replayed waiver could grow the reason text or double-audit the same logical action. See src/lib/admin/actions/schedule-actions.ts (waiveFeeAction), the sole caller.';

revoke all on function public.waive_service_fee_assessment_with_audit(uuid, text, uuid, text)
from public, anon, authenticated;

grant execute on function public.waive_service_fee_assessment_with_audit(uuid, text, uuid, text)
to service_role;
