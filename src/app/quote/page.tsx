import type { Metadata } from "next";
import QuoteWizard from "@/components/quote-wizard/QuoteWizard";

// QA-accessible directly, but NOT yet linked from the homepage CTA or
// production navigation (a separate, later milestone connects "Get My
// Cleaning Quote" -> /quote after manual review). No noindex — this is
// intended to become the production quote route shortly and the project
// has no existing convention of temporarily noindexing pre-launch routes.
export const metadata: Metadata = {
  title: "Get Your Cleaning Estimate — CleanPerfecto",
  description:
    "Tell us about your cleaning and get a personalized estimate from CleanPerfecto in under a minute.",
};

export default function QuotePage() {
  return <QuoteWizard nowIso={new Date().toISOString()} />;
}
