import { resolveEnvironmentBannerData } from "@/lib/admin/environment-banner";

const SEVERITY_CLASSES: Record<string, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-border bg-background-alt text-muted",
};

/**
 * Staff-only environment banner — never rendered on the public site. Shows
 * only safe display values (APP_ENV/PAYMENT_MODE/TAX_MODE labels), never a
 * secret or key prefix. A misconfigured environment gets its own
 * unmissable error state instead of crashing the admin layout — that's
 * exactly the situation staff most need surfaced.
 */
export default function EnvironmentBanner() {
  const data = resolveEnvironmentBannerData();

  if (data.configurationError) {
    return (
      <div role="alert" className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm font-medium text-red-800">
        Configuration error — payments and environment safety checks cannot be verified: {data.message}
      </div>
    );
  }

  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-6 py-2 text-sm font-medium ${SEVERITY_CLASSES[data.severity]}`}>
      <span>{data.label}</span>
      <span aria-hidden="true" className="opacity-50">
        ·
      </span>
      <span className="font-normal">{data.taxLabel}</span>
    </div>
  );
}
