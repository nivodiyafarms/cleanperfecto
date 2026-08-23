import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AdminDayOverride {
  id: string;
  overrideDate: string;
  type: "closed_all_day" | "partial_block";
  blockStartTime: string | null;
  blockEndTime: string | null;
  reason: string | null;
}

/** scheduling_day_overrides from today forward — never a stored 'full' value; see the migration's own comment on why. */
export async function listUpcomingDayOverrides(fromDate: string): Promise<AdminDayOverride[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("scheduling_day_overrides")
    .select("id,override_date,type,block_start_time,block_end_time,reason")
    .gte("override_date", fromDate)
    .order("override_date", { ascending: true });
  if (error) {
    throw new Error(`[admin] scheduling_day_overrides lookup failed: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    overrideDate: r.override_date,
    type: r.type,
    blockStartTime: r.block_start_time,
    blockEndTime: r.block_end_time,
    reason: r.reason,
  }));
}
