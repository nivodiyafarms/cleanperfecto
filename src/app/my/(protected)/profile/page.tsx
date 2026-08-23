import { signOutAction } from "@/lib/customer-portal/actions/auth-actions";
import { getCustomerProfile, getMostRecentServiceAddress } from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";

export default async function MyProfilePage() {
  const session = await requireCustomer();
  const [profile, address] = await Promise.all([
    getCustomerProfile(session.customerId),
    getMostRecentServiceAddress(session.customerId),
  ]);

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

      <form action={signOutAction}>
        <button type="submit" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
          Sign out
        </button>
      </form>
    </div>
  );
}
