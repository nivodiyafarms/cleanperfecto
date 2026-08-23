import Link from "next/link";
import { listRequestedServiceVisits } from "@/lib/admin/queries/service-visits";
import { formatCadenceLabel, formatInstant } from "@/lib/admin/format";

export default async function AdminRequestsPage() {
  const requests = await listRequestedServiceVisits();

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground">Requests</h1>
      <p className="mt-1 text-sm text-muted">Visits customers have requested that CleanPerfecto hasn&apos;t confirmed yet.</p>

      {requests.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No pending requests.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
          {requests.map((visit) => (
            <li key={visit.id}>
              <Link href={`/admin/requests/${visit.id}`} className="flex items-center justify-between gap-4 p-4 text-sm hover:bg-background-alt">
                <div>
                  <p className="font-medium text-foreground">{visit.customerName}</p>
                  <p className="text-muted">
                    {formatCadenceLabel(visit.cleaningType)}
                    {visit.visitNumber ? ` · Package visit ${visit.visitNumber}` : ""}
                  </p>
                  {(visit.serviceCity || visit.serviceZip) && (
                    <p className="text-muted">{[visit.serviceCity, visit.serviceState, visit.serviceZip].filter(Boolean).join(", ")}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-medium text-foreground">Requested {formatInstant(visit.requestedStartAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
