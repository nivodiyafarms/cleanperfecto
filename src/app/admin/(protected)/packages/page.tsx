import Link from "next/link";
import { listPackages } from "@/lib/admin/queries/packages";
import { formatCadenceLabel, formatMoney } from "@/lib/admin/format";

export default async function AdminPackagesPage() {
  const packages = await listPackages();

  return (
    <div>
      <h1 className="text-xl font-semibold text-foreground">Packages</h1>

      <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
        {packages.map((pkg) => (
          <li key={pkg.id}>
            <Link href={`/admin/packages/${pkg.id}`} className="flex items-center justify-between gap-4 p-4 text-sm hover:bg-background-alt">
              <div>
                <p className="font-medium text-foreground">{pkg.customerName}</p>
                <p className="text-muted">
                  {formatCadenceLabel(pkg.frequency)} · {formatMoney(pkg.effectivePricePerVisit)}/visit · {pkg.status}
                </p>
              </div>
              <p className="font-medium text-foreground">
                {pkg.remainingVisitCount} of {pkg.purchasedVisitCount} remaining
              </p>
            </Link>
          </li>
        ))}
        {packages.length === 0 && <li className="p-4 text-sm text-muted">No packages yet.</li>}
      </ul>
    </div>
  );
}
