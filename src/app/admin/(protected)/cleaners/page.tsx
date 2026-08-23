import Link from "next/link";
import ActionForm from "@/components/admin/ActionForm";
import { listCleaners } from "@/lib/admin/queries/cleaners";
import { addCleanerAction, setCleanerActiveAction } from "@/lib/admin/actions/cleaner-actions";

export default async function AdminCleanersPage() {
  const cleaners = await listCleaners();

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-foreground">Cleaners</h1>

      <ul className="mt-6 divide-y divide-border rounded-2xl border border-border bg-surface">
        {cleaners.map((cleaner) => (
          <li key={cleaner.id} className="flex items-center justify-between gap-4 p-4">
            <Link href={`/admin/cleaners/${cleaner.id}`} className="font-medium text-foreground hover:text-secondary">
              {cleaner.name}
            </Link>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium ${cleaner.active ? "text-emerald-700" : "text-muted"}`}>
                {cleaner.active ? "Active" : "Inactive"}
              </span>
              <ActionForm action={setCleanerActiveAction}>
                <input type="hidden" name="cleanerId" value={cleaner.id} />
                <input type="hidden" name="active" value={(!cleaner.active).toString()} />
                <button type="submit" className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-background-alt">
                  {cleaner.active ? "Deactivate" : "Activate"}
                </button>
              </ActionForm>
            </div>
          </li>
        ))}
        {cleaners.length === 0 && <li className="p-4 text-sm text-muted">No cleaners yet.</li>}
      </ul>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold text-foreground">Add a cleaner</h2>
        <ActionForm action={addCleanerAction} className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="name" className="block text-xs font-medium text-muted">
              Name
            </label>
            <input id="name" name="name" type="text" required className="mt-1 rounded-lg border border-border px-3 py-1.5 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90">
            Add cleaner
          </button>
        </ActionForm>
      </div>
    </div>
  );
}
