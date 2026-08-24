import { sanitizeNextPath } from "@/lib/customer-portal/next-path";
import CustomerLoginForm from "./CustomerLoginForm";

interface CustomerLoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * Server wrapper so reading ?next= doesn't require a useSearchParams()
 * Suspense boundary (same "read searchParams via the page prop" pattern as
 * /my/activate) — the actual form/OTP call stays a client component
 * (CustomerLoginForm), since signInWithOtp is inherently client-side.
 */
export default async function CustomerLoginPage({ searchParams }: CustomerLoginPageProps) {
  const { next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext);
  return <CustomerLoginForm next={next} />;
}
