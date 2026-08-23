import { formatVisitStatusLabel } from "@/lib/admin/format";

const STYLES: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800",
  scheduled: "bg-secondary/15 text-secondary",
  completed: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-red-100 text-red-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? "bg-background-alt text-muted"}`}>
      {formatVisitStatusLabel(status)}
    </span>
  );
}
