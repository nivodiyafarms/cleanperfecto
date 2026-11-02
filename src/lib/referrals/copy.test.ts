import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOKING_REFERRAL_HEADLINE,
  HOMEPAGE_REFERRAL_CTA,
  HOMEPAGE_REFERRAL_FINE_PRINT,
  HOMEPAGE_REFERRAL_HEADLINE,
  HOMEPAGE_REFERRAL_SUBTEXT,
  OFFERS_AND_REWARDS_LABEL,
  PORTAL_REFERRAL_HEADLINE,
  REFERRAL_CODE_HREF,
  REFERRAL_TERMS_ITEMS,
  REFERRAL_TERMS_LINK,
  REWARDS_PAGE_BULLETS,
  SEE_FULL_TERMS_LABEL,
} from "./copy";
import { PRIMARY_NAV_LINKS } from "@/lib/site-nav";

describe("referral copy", () => {
  it("uses the approved headlines and states every program rule without the minimum-service or first-cleaning offer", () => {
    expect(PORTAL_REFERRAL_HEADLINE).toBe("Give $15. Get $15.");
    expect(HOMEPAGE_REFERRAL_HEADLINE).toBe("Give $15, Get $15");
    expect(HOMEPAGE_REFERRAL_SUBTEXT).toBe("Your friend saves $15 on their second cleaning. You save $15 on your next.");
    expect(HOMEPAGE_REFERRAL_CTA).toBe("Get my referral code");
    expect(HOMEPAGE_REFERRAL_FINE_PRINT).toBe(
      "Rewards unlock after your friend's first completed, paid cleaning. $150 minimum · Valid 60 days ·",
    );
    expect(REFERRAL_CODE_HREF).toBe("/my/rewards");
    expect(BOOKING_REFERRAL_HEADLINE).toBe("Get $15 off your 2nd cleaning with a referral code.");
    expect(REFERRAL_TERMS_LINK).toBe("/terms#referral-rewards");
    expect(SEE_FULL_TERMS_LABEL).toBe("See full terms");
    expect(OFFERS_AND_REWARDS_LABEL).toBe("Offers & Rewards");
    expect(REWARDS_PAGE_BULLETS).toEqual([
      "Share your personal referral code.",
      "Your friend gets $15 off their second cleaning.",
      "You get $15 off your next cleaning after their first completed, paid visit.",
      "$150 minimum per redemption. Credits expire 60 days after issuance.",
    ]);

    const terms = REFERRAL_TERMS_ITEMS.map((item) => `${item.label}: ${item.body}`).join(" ");
    expect(terms).toMatch(/\$150 in eligible cleaning charges/);
    expect(terms).toMatch(/60 days of issuance/);
    expect(terms).toMatch(/One credit per visit/);
    expect(terms).toMatch(/No combining with other promotions or prepaid-package discounts/);
    expect(terms).toMatch(/completed and fully paid/);
    expect(terms).toMatch(/five rewards per rolling 12 months/);
    expect(terms).toMatch(/reward only the referred customer/);
    expect(terms).toMatch(/original expiry/);
    expect(terms).toMatch(/void unused rewards/);
    expect(terms).toMatch(/New referred customers only/);
    expect(terms).toMatch(/No self-referrals/);
    expect(terms).not.toMatch(/\$99/);
    expect(terms).not.toMatch(/25%/);
    expect(PRIMARY_NAV_LINKS).toContainEqual({ href: "/rewards", label: "Offers & Rewards" });
  });

  it("places the homepage banner under the hero, the offers link in the footer, and the terms section on the terms page", () => {
    const home = readFileSync("src/app/page.tsx", "utf8");
    const banner = readFileSync("src/components/sections/ReferralOffer.tsx", "utf8");
    const rewards = readFileSync("src/app/rewards/page.tsx", "utf8");
    const termsPage = readFileSync("src/app/terms/page.tsx", "utf8");
    const footer = readFileSync("src/components/footer/SiteFooter.tsx", "utf8");
    const nav = readFileSync("src/components/nav/SiteNav.tsx", "utf8");
    const portal = readFileSync("src/app/my/(protected)/rewards/page.tsx", "utf8");
    const booking = readFileSync("src/components/booking/BookingPaymentClient.tsx", "utf8");
    const wizard = readFileSync("src/components/quote-wizard/StepTwoContact.tsx", "utf8");

    expect(home.indexOf("<Hero />")).toBeGreaterThan(-1);
    expect(home.indexOf("<Hero />")).toBeLessThan(home.indexOf("<ReferralOffer />"));
    expect(home.indexOf("<ReferralOffer />")).toBeLessThan(home.indexOf("<GoogleReviewsSection />"));
    expect(home.match(/<ReferralOffer \/>/g)).toHaveLength(1);
    expect(banner).toContain("bg-primary");
    expect(banner).toContain("w-full");
    expect(banner).toContain("REFERRAL_CODE_HREF");
    expect(banner).toContain("See terms");

    expect(rewards).toContain("REWARDS_PAGE_BULLETS");
    expect(rewards).toContain("SEE_FULL_TERMS_LABEL");
    expect(rewards).toContain("REFERRAL_CODE_HREF");
    expect(rewards).not.toContain("REFERRAL_TERMS_PARAGRAPHS");

    expect(footer).toContain("Offers & Rewards");
    expect(footer).toContain('href="/rewards"');
    expect(termsPage).toContain('id="referral-rewards"');
    expect(termsPage).toContain("REFERRAL_TERMS_ITEMS");
    expect(termsPage).toContain("<strong");
    expect(nav).toContain("lg:hidden");
    expect(nav).toContain("PRIMARY_NAV_LINKS");

    expect(portal).toContain("PORTAL_REFERRAL_HEADLINE");
    expect(portal).toContain("See terms");
    expect(portal).toContain("REFERRAL_TERMS_LINK");
    expect(booking).toContain("BOOKING_REFERRAL_HEADLINE");
    expect(booking).toContain("See terms");
    expect(wizard).toContain("BOOKING_REFERRAL_HEADLINE");
    expect(wizard).toContain("See terms");
  });
});
