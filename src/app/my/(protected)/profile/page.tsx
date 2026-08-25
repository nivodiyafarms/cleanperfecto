import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import { signOutAction } from "@/lib/customer-portal/actions/auth-actions";
import { setSmsOptInAction } from "@/lib/customer-portal/actions/notification-preferences-actions";
import { getCustomerProfile, getMostRecentServiceAddress } from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseCustomerNotificationPreferencesRepository } from "@/lib/notifications/customer-notification-preferences-repository";
import { createSupabaseConsentRepository } from "@/lib/consent/consent-repository";

export default async function MyProfilePage() {
  const session = await requireCustomer();
  const preferencesRepo = createSupabaseCustomerNotificationPreferencesRepository();
  const consentRepo = createSupabaseConsentRepository();
  const [profile, address, preferences, activeConsentVersion] = await Promise.all([
    getCustomerProfile(session.customerId),
    getMostRecentServiceAddress(session.customerId),
    preferencesRepo.findByCustomerId(session.customerId),
    consentRepo.findActiveVersion(),
  ]);
  const smsOptIn = preferences?.smsOptIn ?? false;
  const consentRecord = activeConsentVersion ? await consentRepo.findByCustomerAndVersion(session.customerId, activeConsentVersion.id) : null;
  const consentStatusLabel = consentRecord?.state === "signed" ? "Signed" : "Action needed";

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-semibold text-foreground">Profile</h1>

      <div>
        <p className="text-xs font-medium text-muted">Name</p>
        <p className="text-sm text-foreground">{profile?.name ?? "—"}</p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Email</p>
        <p className="text-sm text-foreground">{profile?.email ?? "—"}</p>
        <p className="mt-1 text-xs text-muted">Email is tied to your sign-in and can&apos;t be changed here — contact us if you need it updated.</p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Phone</p>
        <p className="text-sm text-foreground">{profile?.phone ?? "—"}</p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Service Address</p>
        <p className="text-sm text-foreground">
          {address?.line1 ? `${address.line1}${address.line2 ? `, ${address.line2}` : ""}, ${address.city}, ${address.state}` : "—"}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Consent</p>
        <p className={`mt-1 text-sm ${consentRecord?.state === "signed" ? "text-emerald-700" : "text-foreground"}`}>{consentStatusLabel}</p>
        <Link href="/my/consent" className="mt-1 inline-block text-xs font-medium text-secondary hover:underline">
          View consent →
        </Link>
      </div>

      <div>
        <p className="text-xs font-medium text-muted">Text message updates</p>
        <p className="mt-1 text-sm text-foreground">{smsOptIn ? "On" : "Off"}</p>
        <ActionForm action={setSmsOptInAction} className="mt-2">
          <input type="hidden" name="optIn" value={(!smsOptIn).toString()} />
          <button type="submit" className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-background-alt">
            {smsOptIn ? "Turn off text updates" : "Turn on text updates"}
          </button>
        </ActionForm>
      </div>

      <form action={signOutAction}>
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
          Sign out
        </button>
      </form>
    </div>
  );
}
