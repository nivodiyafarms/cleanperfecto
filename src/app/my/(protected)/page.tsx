import Link from "next/link";
import { formatCadenceLabel } from "@/lib/admin/format";
import {
  getMostRecentPackageSummary,
  hasActiveRecurringRelationship,
  listNextSixVisits,
} from "@/lib/customer-portal/queries";
import { requireCustomer } from "@/lib/customer-portal/require-customer";
import { createSupabaseSchedulingRepository } from "@/lib/scheduling/supabase-scheduling-repository";

function statusLabel(status: "confirmed" | "requested" | "planned"): string {
  switch (status) {
    case "confirmed":
      return "Confirmed";
    case "requested":
      return "Requested";
    case "planned":
      return "Planned";
  }
}

export default async function PortalHomePage() {
  const session = await requireCustomer();
  const isRecurring = await hasActiveRecurringRelationship(session.customerId);

  if (!isRecurring) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-foreground">Welcome back</h1>
        <p className="text-sm text-muted">You don&apos;t have an active recurring cleaning plan right now.</p>
        <Link href="/quote" className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white">
          Get My Cleaning Quote
        </Link>
      </div>
    );
  }

  const repo = createSupabaseSchedulingRepository();
  const [nextSix, schedules, packageSummary] = await Promise.all([
    listNextSixVisits(session.customerId),
    repo.listActiveRecurringSchedulesForCustomer(session.customerId),
    getMostRecentPackageSummary(session.customerId),
  ]);

  const next = nextSix[0] ?? null;
  const cadence = schedules[0]?.cadence ?? null;
  const activePackage = packageSummary && packageSummary.status === "active" ? packageSummary : null;

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-xl font-semibold text-foreground">Next Cleaning</h1>
        {next ? (
          <p className="mt-2 text-sm text-foreground">
            {next.date} at {next.startTime} — {statusLabel(next.status)}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing scheduled yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Cleaning Plan</h2>
        <p className="mt-2 text-sm text-foreground">{formatCadenceLabel(cadence)}</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Next 6 Cleanings</h2>
        <ol className="mt-2 space-y-1 text-sm text-foreground">
          {nextSix.map((v, i) => (
            <li key={`${v.recurringScheduleId}-${v.visitNumber}`}>
              {i + 1}. {v.date} — {statusLabel(v.status)}
            </li>
          ))}
          {nextSix.length === 0 && <li className="text-muted">No upcoming cleanings yet.</li>}
        </ol>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Payment Summary</h2>
        {activePackage ? (
          <p className="mt-2 text-sm text-foreground">
            Prepaid 6-Cleaning Package — {activePackage.purchasedVisitCount} purchased,{" "}
            {activePackage.purchasedVisitCount - activePackage.remainingVisitCount} completed,{" "}
            {activePackage.remainingVisitCount} remaining
          </p>
        ) : (
          <p className="mt-2 text-sm text-foreground">Pay Per Cleaning — charged after each completed visit.</p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Quick Actions</h2>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link href="/my/cleanings" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
            View My Cleanings
          </Link>
          {activePackage && (
            <Link href="/my/package" className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-background-alt">
              View My Package
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
