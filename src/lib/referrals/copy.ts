import { REFERRAL_TERMS_HREF } from "./constants";

export const REFERRAL_TERMS_LINK = REFERRAL_TERMS_HREF;

/** Customer portal referrals section. Signed-out visitors are sent through login by the existing portal gate and returned here. */
export const REFERRAL_CODE_HREF = "/my/rewards";

export const PORTAL_REFERRAL_HEADLINE = "Give $15. Get $15.";

export const HOMEPAGE_REFERRAL_HEADLINE = "Give $15, Get $15";

export const HOMEPAGE_REFERRAL_SUBTEXT = "Your friend saves $15 on their second cleaning. You save $15 on your next.";

export const HOMEPAGE_REFERRAL_CTA = "Get my referral code";

export const HOMEPAGE_REFERRAL_FINE_PRINT =
  "Rewards unlock after your friend's first completed, paid cleaning. $150 minimum · Valid 60 days ·";

export const BOOKING_REFERRAL_HEADLINE = "Get $15 off your 2nd cleaning with a referral code.";

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
