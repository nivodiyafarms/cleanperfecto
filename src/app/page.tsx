import SiteNav from "@/components/nav/SiteNav";
import Hero from "@/components/hero/Hero";
import TrustIndicators from "@/components/sections/TrustIndicators";
import HowItWorks from "@/components/sections/HowItWorks";
import BeforeAfter from "@/components/sections/BeforeAfter";
import ServicesGrid from "@/components/sections/ServicesGrid";
import PropertySpecializations from "@/components/sections/PropertySpecializations";
import AIAssistantPreview from "@/components/sections/AIAssistantPreview";
import ServiceArea from "@/components/sections/ServiceArea";
import QuoteSection from "@/components/sections/QuoteSection";
import SiteFooter from "@/components/footer/SiteFooter";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="flex-1">
        <Hero />
        <TrustIndicators />
        <HowItWorks />
        <BeforeAfter />
        <ServicesGrid />
        <PropertySpecializations />
        <AIAssistantPreview />
        <ServiceArea />
        <QuoteSection />
      </main>
      <SiteFooter />
    </>
  );
}
