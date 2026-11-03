import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOKING_REFERRAL_HEADLINE,
  CONTINUE_WITHOUT_REFERRAL_LABEL,
  HOMEPAGE_REFERRAL_CTA,
  HOMEPAGE_REFERRAL_HEADLINE,
  HOMEPAGE_BANNER_HEADLINE,
  NEW_CUSTOMER_REFERRAL_CTA,
  NEW_CUSTOMER_REFERRAL_PROMPT,
  NEW_CUSTOMER_REFERRAL_ACTION,
  EXISTING_CUSTOMER_REFERRAL_PROMPT,
  NEW_CUSTOMER_REFERRAL_HREF,
  REWARDS_PAGE_HREF,
  OFFERS_AND_REWARDS_LABEL,
  PORTAL_REFERRAL_HEADLINE,
  REFERRAL_CODE_APPLIED_MESSAGE,
  REFERRAL_CODE_CHECK_FAILED_MESSAGE,
  REFERRAL_CODE_HREF,
  REFERRAL_CODE_INACTIVE_MESSAGE,
  referralCodeRateLimitedMessage,
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
    expect(HOMEPAGE_BANNER_HEADLINE).toBe("Refer a friend. You both get $15 off.");
    expect(REWARDS_PAGE_HREF).toBe("/rewards");
    expect(NEW_CUSTOMER_REFERRAL_CTA).toBe("Have a referral code? Book now");
    expect(NEW_CUSTOMER_REFERRAL_PROMPT).toBe("Have a referral code?");
    expect(NEW_CUSTOMER_REFERRAL_ACTION).toBe("Book now");
    expect(EXISTING_CUSTOMER_REFERRAL_PROMPT).toBe("Already a customer?");
    expect(NEW_CUSTOMER_REFERRAL_HREF).toBe("/quote");
    expect(HOMEPAGE_REFERRAL_CTA).toBe("Get my referral code");
    expect(REFERRAL_CODE_HREF).toBe("/my/rewards");
    expect(BOOKING_REFERRAL_HEADLINE).toBe("Get $15 off your 2nd cleaning with a referral code.");
    expect(REFERRAL_CODE_APPLIED_MESSAGE).toBe(
      "Referral code applied — $15 off your 2nd cleaning, subject to eligibility."
    );
    expect(REFERRAL_CODE_INACTIVE_MESSAGE).toBe(
      "That referral code isn't active. Change it or continue without a referral."
    );
    expect(REFERRAL_CODE_CHECK_FAILED_MESSAGE).toBe("We couldn't check your code. Try again.");
    expect(referralCodeRateLimitedMessage(7)).toBe("Too many tries. Try again in 7 seconds.");
    expect(CONTINUE_WITHOUT_REFERRAL_LABEL).toBe("Continue without referral");
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
    const hero = readFileSync("src/components/hero/Hero.tsx", "utf8");
    const rewards = readFileSync("src/app/rewards/page.tsx", "utf8");
    const termsPage = readFileSync("src/app/terms/page.tsx", "utf8");
    const footer = readFileSync("src/components/footer/SiteFooter.tsx", "utf8");
    const nav = readFileSync("src/components/nav/SiteNav.tsx", "utf8");
    const portal = readFileSync("src/app/my/(protected)/rewards/page.tsx", "utf8");
    const booking = readFileSync("src/components/booking/BookingPaymentClient.tsx", "utf8");
    const wizard = readFileSync("src/components/quote-wizard/StepTwoContact.tsx", "utf8");

    expect(home).toContain("<Hero />");
    expect(home).not.toContain("ReferralOffer");
    expect(hero).toContain("HOMEPAGE_BANNER_HEADLINE");
    expect(hero).toContain("REWARDS_PAGE_HREF");
    expect(hero).toContain("Learn more");
    expect(hero.indexOf("<FirstCleaningOfferBadge")).toBeLessThan(hero.indexOf("{HOMEPAGE_BANNER_HEADLINE}"));

    expect(rewards).toContain("REWARDS_PAGE_BULLETS");
    expect(rewards).toContain("SEE_FULL_TERMS_LABEL");
    expect(rewards).toContain("REFERRAL_CODE_HREF");
    expect(rewards).toContain("NEW_CUSTOMER_REFERRAL_HREF");
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
    expect(wizard).toContain("REFERRAL_CODE_APPLIED_MESSAGE");
    expect(wizard).toContain("REFERRAL_CODE_INACTIVE_MESSAGE");
    expect(wizard).toContain("REFERRAL_CODE_CHECK_FAILED_MESSAGE");
    expect(wizard).toContain("referralCodeRateLimitedMessage");
    expect(wizard).toContain("CONTINUE_WITHOUT_REFERRAL_LABEL");
    expect(wizard).toContain("See terms");
    expect(wizard).toContain('href={REFERRAL_TERMS_LINK}');
  });
});
