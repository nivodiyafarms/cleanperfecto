import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOKING_REFERRAL_HEADLINE,
  HOMEPAGE_REFERRAL_HEADLINE,
  OFFERS_AND_REWARDS_LABEL,
  PORTAL_REFERRAL_HEADLINE,
  REFERRAL_TERMS_LINK,
  REFERRAL_TERMS_PARAGRAPHS,
} from "./copy";
import { PRIMARY_NAV_LINKS } from "@/lib/site-nav";

describe("referral copy", () => {
  it("uses the approved headlines and states every program rule without the minimum-service or first-cleaning offer", () => {
    expect(PORTAL_REFERRAL_HEADLINE).toBe("Give $15. Get $15.");
    expect(HOMEPAGE_REFERRAL_HEADLINE).toBe("Refer a friend. You both get $15 off.");
    expect(BOOKING_REFERRAL_HEADLINE).toBe("Get $15 off your 2nd cleaning with a referral code.");
    expect(REFERRAL_TERMS_LINK).toBe("/terms#referral-rewards");
    expect(OFFERS_AND_REWARDS_LABEL).toBe("Offers & Rewards");

    const terms = REFERRAL_TERMS_PARAGRAPHS.join(" ");
    expect(terms).toMatch(/at least \$150/);
    expect(terms).toMatch(/60 days/);
    expect(terms).toMatch(/One \$15 credit can be used on one later visit/);
    expect(terms).toMatch(/does not stack with other discounts or with a prepaid package/);
    expect(terms).toMatch(/completed and fully paid/);
    expect(terms).toMatch(/at most 5 credits in a rolling 12 months/);
    expect(terms).toMatch(/friend still receives their credit/);
    expect(terms).toMatch(/benefits only the friend/);
    expect(terms).toMatch(/same expiry date/);
    expect(terms).toMatch(/voids credits that have not been used/);
    expect(terms).not.toMatch(/\$99/);
    expect(terms).not.toMatch(/25%/);
    expect(PRIMARY_NAV_LINKS).toContainEqual({ href: "/rewards", label: "Offers & Rewards" });
  });

  it("places the offers link in the footer and the terms section on the terms page", () => {
    const footer = readFileSync("src/components/footer/SiteFooter.tsx", "utf8");
    const termsPage = readFileSync("src/app/terms/page.tsx", "utf8");
    const nav = readFileSync("src/components/nav/SiteNav.tsx", "utf8");
    expect(footer).toContain("Offers & Rewards");
    expect(footer).toContain('href="/rewards"');
    expect(termsPage).toContain('id="referral-rewards"');
    expect(nav).toContain("lg:hidden");
    expect(nav).toContain("PRIMARY_NAV_LINKS");
  });
});
