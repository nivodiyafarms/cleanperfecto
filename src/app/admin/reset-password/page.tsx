import { redirect } from "next/navigation";
import ResetPasswordForm from "./ResetPasswordForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Reached only after /admin/auth/callback successfully exchanges a
 * recovery code for a session. Does its own lightweight "is there an
 * authenticated user at all" check (same reasoning as /my/activate's own
 * doc comment: Proxy already covers this for the normal case, but a Server
 * Component render must never assume Proxy ran first). No admin_users
 * lookup here — establishing a session and setting a password never
 * grants admin access by itself; that's requireAdmin()'s job everywhere
 * else under /admin/*.
 */
export default async function AdminResetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-alt px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <p className="text-sm font-medium text-muted">CleanPerfecto</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Set your password</h1>
        <ResetPasswordForm />
      </div>
    </div>
  );
}
