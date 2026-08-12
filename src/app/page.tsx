import SiteNav from "@/components/nav/SiteNav";
import StickyMobileCTA from "@/components/StickyMobileCTA";
import { SelectionProvider } from "@/components/SelectionProvider";
import Hero from "@/components/hero/Hero";
import CleaningServiceSelector from "@/components/sections/CleaningServiceSelector";
import TrustIndicators from "@/components/sections/TrustIndicators";
import HowItWorks from "@/components/sections/HowItWorks";
import ServicesGrid from "@/components/sections/ServicesGrid";
import ServiceComparison from "@/components/sections/ServiceComparison";
import StartingPrices from "@/components/sections/StartingPrices";
import PropertySpecializations from "@/components/sections/PropertySpecializations";
import ServiceArea from "@/components/sections/ServiceArea";
import QuoteSection from "@/components/sections/QuoteSection";
import SiteFooter from "@/components/footer/SiteFooter";

// The first-cleaning offer badge transitions from 30% to 25% automatically
// based on server time (src/lib/offers/first-cleaning-offer.ts). Real
// visitors get this instantly client-side, but without periodic
// regeneration a statically-cached page would keep serving build-time
// offer copy to non-JS clients/crawlers past the deadline.
export const revalidate = 3600;

export default function Home() {
  return (
    <SelectionProvider>
      <SiteNav />
      <main className="flex-1 pb-20 md:pb-0">
        <Hero />
        <CleaningServiceSelector />
        <TrustIndicators />
        <HowItWorks />
        <ServicesGrid />
        <ServiceComparison />
        <StartingPrices />
        <PropertySpecializations />
        <ServiceArea />
        <QuoteSection />
      </main>
      <SiteFooter />
      <StickyMobileCTA />
    </SelectionProvider>
  );
}
