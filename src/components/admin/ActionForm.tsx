"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/admin/actions/types";

type Action = (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * Thin useActionState wrapper shared by every admin mutation form — one
 * place that shows the server-authoritative ActionResult (success message
 * or error) inline, so no page hand-rolls its own pending/result state.
 * The action itself always runs requireAdmin() + the existing scheduling/
 * package domain functions server-side; this component only renders the
 * outcome.
 */
export default function ActionForm({
  action,
  children,
  className,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      {pending && <p className="mt-2 text-xs text-muted">Working…</p>}
      {!pending && state && (
        <p className={`mt-2 text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`} role={state.ok ? "status" : "alert"}>
          {state.ok ? (state.message ?? "Done.") : state.error}
        </p>
      )}
    </form>
  );
}
