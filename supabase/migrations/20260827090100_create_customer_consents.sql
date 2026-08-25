-- ============================================================================
-- Migration: create customer_consents
-- Consent + Review Automation V1 milestone.
--
-- One row per (customer, consent_version) — the unique constraint below is
-- the idempotency mechanism for "don't re-request a consent that's already
-- in flight or signed for the active version": enqueueConsentRequest tries
-- to insert 'sent' and only enqueues the notification when that insert
-- actually happens (see src/lib/consent/enqueue-consent-request.ts).
--
-- state is a small, RECOVERABLE lifecycle — 'declined' is NOT terminal.
-- Business rule: a customer who initially declines may return and sign the
-- SAME active version later (sent -> viewed -> declined -> signed is a
-- valid path). 'signed' is the only terminal state, enforced by the
-- trigger below, not by the state machine shape itself.
--
-- ONE consent agreement, ONE acknowledgment, ONE typed signature (owner-
-- approved correction): there is deliberately no separate boolean per
-- clause (service authorization / photo-video / marketing-use / yard-sign).
-- consent_versions.body_text is a single agreement covering all of those
-- as one document — state='signed' + the frozen accepted_text_snapshot +
-- signed_name + signed_at together ARE the evidence that the customer
-- accepted the complete agreement, not a partial/itemized one. The portal
-- sign form still requires a single checkbox acknowledgment before
-- submission (see sign-consent.ts), but that checkbox is a submission
-- gate, not stored data — there is nothing partial to record.
-- ============================================================================

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),

  customer_id uuid not null references public.customers (id),
  consent_version_id uuid not null references public.consent_versions (id),
  -- Informational only — which booking/visit prompted this request. Consent
  -- itself is customer-level and is never invalidated by that visit later
  -- being rescheduled or cancelled (see enqueue-consent-request.ts).
  service_visit_id uuid references public.service_visits (id),

  state text not null default 'sent' check (state in ('sent', 'viewed', 'declined', 'signed')),

  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  declined_at timestamptz,
  signed_at timestamptz,

  -- The frozen, exact text the customer actually saw and accepted — never
  -- re-read from consent_versions after signing, so a later edit to (or
  -- retirement of) that version can never retroactively change what this
  -- row is evidence of. Null until signed.
  accepted_text_snapshot text,
  signed_name text,
  -- Supplemental audit evidence only — see sign-consent.ts. Absence of
  -- either must never block signing.
  ip_address text,
  user_agent text,

  -- Path/hash of the generated signed-document PDF in the private
  -- signed-consents Storage bucket (see below) — populated shortly AFTER
  -- signing, not as part of the sign() write itself, since PDF generation
  -- is a best-effort follow-up step (see protect_customer_consents_after_signing()
  -- and sign-consent.ts's failure handling: a PDF generation/storage
  -- failure must never lose the underlying signature evidence above). Both
  -- null until a document exists; both set together, exactly once.
  signed_document_path text,
  signed_document_sha256 text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_consents_one_per_customer_version unique (customer_id, consent_version_id),
  constraint customer_consents_signed_requires_evidence
    check (state <> 'signed' or (signed_name is not null and accepted_text_snapshot is not null and signed_at is not null)),
  constraint customer_consents_signed_document_pair
    check ((signed_document_path is null) = (signed_document_sha256 is null))
);

comment on table public.customer_consents is
  'One row per (customer, consent_version). Lifecycle: sent -> viewed -> declined -> signed, with declined recoverable back to signed (NOT terminal) — only signed is terminal, enforced by protect_customer_consents_after_signing(). Signing is all-or-nothing acceptance of the ENTIRE agreement in consent_versions.body_text (service authorization, photo/video, marketing use, yard sign, etc.) — there is no per-clause boolean; state=''signed'' plus the frozen accepted_text_snapshot/signed_name/signed_at together constitute the evidence of full acceptance. signed_document_path/signed_document_sha256 point at the retained PDF copy of that same evidence (see the signed-consents Storage bucket below) and may be set exactly once, after signing, independently of the rest of the row.';

-- ---------------------------------------------------------------------------
-- Immutability: once signed, the evidence columns can never be updated
-- again — not even by service_role. The sole narrow exception is
-- signed_document_path/signed_document_sha256, which may transition from
-- null to a value exactly once (the initial PDF generation, or a later
-- retry after a failed attempt — see sign-consent.ts /
-- retry-signed-consent-document.ts) but can never be changed again once
-- set. The only way forward from a fully-signed-and-documented row is a
-- NEW row for a NEW consent_version_id (a new material version).
-- ---------------------------------------------------------------------------
create or replace function public.protect_customer_consents_after_signing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'signed' then
    if new.customer_id is distinct from old.customer_id
      or new.consent_version_id is distinct from old.consent_version_id
      or new.service_visit_id is distinct from old.service_visit_id
      or new.state is distinct from old.state
      or new.sent_at is distinct from old.sent_at
      or new.viewed_at is distinct from old.viewed_at
      or new.declined_at is distinct from old.declined_at
      or new.signed_at is distinct from old.signed_at
      or new.accepted_text_snapshot is distinct from old.accepted_text_snapshot
      or new.signed_name is distinct from old.signed_name
      or new.ip_address is distinct from old.ip_address
      or new.user_agent is distinct from old.user_agent
    then
      raise exception 'customer_consents rows are immutable once signed (id=%)', old.id;
    end if;

    if old.signed_document_path is not null and new.signed_document_path is distinct from old.signed_document_path then
      raise exception 'customer_consents.signed_document_path is immutable once set (id=%)', old.id;
    end if;

    if old.signed_document_sha256 is not null and new.signed_document_sha256 is distinct from old.signed_document_sha256 then
      raise exception 'customer_consents.signed_document_sha256 is immutable once set (id=%)', old.id;
    end if;
  end if;
  return new;
end;
$$;

comment on function public.protect_customer_consents_after_signing() is
  'BEFORE UPDATE guard: once state=''signed'', rejects any change to the signing-evidence columns, including by service_role. The one allowed update is setting signed_document_path/signed_document_sha256 from null to a value (PDF generation/retry) — and once THOSE are set, they too become immutable. No other post-sign metadata may ever change.';

create trigger customer_consents_protect_after_signing
before update on public.customer_consents
for each row execute function public.protect_customer_consents_after_signing();

create trigger customer_consents_set_updated_at
before update on public.customer_consents
for each row execute function public.set_updated_at();

create index customer_consents_customer_id_idx on public.customer_consents (customer_id);
create index customer_consents_consent_version_id_idx on public.customer_consents (consent_version_id);

alter table public.customer_consents enable row level security;

revoke all privileges
on table public.customer_consents
from anon, authenticated;

grant select, insert, update
on table public.customer_consents
to service_role;
-- No delete grant — history (including a declined-then-signed path) is
-- always preserved.

-- ---------------------------------------------------------------------------
-- Private Storage bucket for signed-consent PDF copies (see
-- signed_document_path/signed_document_sha256 above). public=false and no
-- anon/authenticated policies are added on storage.objects for this bucket
-- — same zero-anon/zero-authenticated-privilege convention as every table
-- in this schema. service_role bypasses RLS entirely, so every access
-- (upload at sign time, retry, customer/admin download) goes exclusively
-- through server-only code using the service-role admin client via a
-- server-authoritative route/action — never a public/browsable object URL.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('signed-consents', 'signed-consents', false)
on conflict (id) do nothing;
