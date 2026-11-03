import { REFERRAL_TERMS_HREF } from "./constants";

export const REFERRAL_TERMS_LINK = REFERRAL_TERMS_HREF;

/** Customer portal referrals section. Signed-out visitors are sent through login by the existing portal gate and returned here. */
export const REFERRAL_CODE_HREF = "/my/rewards";

export const PORTAL_REFERRAL_HEADLINE = "Give $15. Get $15.";

export const HOMEPAGE_REFERRAL_HEADLINE = "Give $15, Get $15";

export const HOMEPAGE_REFERRAL_CTA = "Get my referral code";

export const HOMEPAGE_BANNER_HEADLINE = "Refer a friend. You both get $15 off.";

export const REWARDS_PAGE_HREF = "/rewards";

/** For visitors without an account: go straight to the quote/booking flow, where the code is entered. */
export const NEW_CUSTOMER_REFERRAL_PROMPT = "Have a referral code?";

export const NEW_CUSTOMER_REFERRAL_ACTION = "Book now";

export const NEW_CUSTOMER_REFERRAL_CTA = `${NEW_CUSTOMER_REFERRAL_PROMPT} ${NEW_CUSTOMER_REFERRAL_ACTION}`;

export const EXISTING_CUSTOMER_REFERRAL_PROMPT = "Already a customer?";

export const NEW_CUSTOMER_REFERRAL_HREF = "/quote";

export const BOOKING_REFERRAL_HEADLINE = "Get $15 off your 2nd cleaning with a referral code.";

/** Shown under the quote-wizard referral field when a code is confirmed active. */
export const REFERRAL_CODE_APPLIED_MESSAGE =
  "Referral code applied — $15 off your 2nd cleaning, subject to eligibility.";

/** Missing, malformed, or disabled codes share this message — never distinguish them. */
export const REFERRAL_CODE_INACTIVE_MESSAGE =
  "That referral code isn't active. Change it or continue without a referral.";

/** Lookup/rate-limit/outage failures — never labeled as an invalid code. */
export const REFERRAL_CODE_CHECK_FAILED_MESSAGE = "We couldn't check your code. Try again.";

export const CONTINUE_WITHOUT_REFERRAL_LABEL = "Continue without referral";

export const OFFERS_AND_REWARDS_LABEL = "Offers & Rewards";

export const SEE_FULL_TERMS_LABEL = "See full terms";

export const REWARDS_PAGE_BULLETS = [
  "Share your personal referral code.",
  "Your friend gets $15 off their second cleaning.",
  "You get $15 off your next cleaning after their first completed, paid visit.",
  "$150 minimum per redemption. Credits expire 60 days after issuance.",
] as const;

export const REFERRAL_TERMS_ITEMS = [
  {
    label: "Who qualifies",
    body: "New referred customers only; one referral per household. Enter the code or use the referral link when booking.",
  },
  {
    label: "When earned",
    body: "Credits unlock after the friend's first cleaning is completed and fully paid.",
  },
  {
    label: "Who receives credit",
    body: "Customer referrals earn $15 for each person. Owner-issued family/friend codes reward only the referred customer.",
  },
  {
    label: "Where usable",
    body: "Friend credit applies to their second cleaning; referrer credit applies to a future cleaning.",
  },
  {
    label: "Minimum",
    body: "$150 in eligible cleaning charges after normal recurring-rate adjustments, excluding tax, tips, and add-ons.",
  },
  {
    label: "Limits",
    body: "One credit per visit. No combining with other promotions or prepaid-package discounts. Normal recurring rates qualify.",
  },
  {
    label: "Expiry and cap",
    body: "Use credits within 60 days of issuance. Referrers earn up to five rewards per rolling 12 months.",
  },
  {
    label: "Cancellations/refunds",
    body: "Canceled or unpaid first visits earn nothing. Full refunds or chargebacks void unused rewards. Canceled redemption visits restore credit with its original expiry.",
  },
  {
    label: "Misuse",
    body: "No self-referrals, duplicate claims, cash redemption, or credit transfers. Suspected misuse may be reviewed.",
  },
] as const;
