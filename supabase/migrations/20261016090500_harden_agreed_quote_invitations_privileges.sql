-- ============================================================================
-- Migration: harden agreed_quote_invitations / agreed_quote_invitation_sends
-- privileges.
--
-- AUTHORED ONLY. Do not apply to production. May be applied to
-- operational-beta-preview (pitvmtsenkcuapixrilg) after review, per this
-- project's migration-safety rules.
--
-- Same recurring issue already found and fixed on financial_audit_log,
-- admin_users, and stripe_disputes: this schema's default grants hand
-- service_role REFERENCES/TRIGGER/TRUNCATE on every new table regardless
-- of what the table's own creating migration explicitly granted.
-- TRUNCATE in particular would bypass every row-level guarantee these two
-- tables are meant to provide. Explicitly revoking the unrequested
-- privileges here, independently re-verified against the actual grants
-- rather than trusted from the creating migration's own GRANT statement.
-- ============================================================================

revoke truncate, references, trigger
on table public.agreed_quote_invitations
from service_role;

revoke truncate, references, trigger
on table public.agreed_quote_invitation_sends
from service_role;
