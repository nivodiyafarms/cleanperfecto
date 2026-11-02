/** Referral reward amount. Never a percentage and never mixed into the pricing engine. */
export const REFERRAL_CREDIT_DOLLARS = 15;

/** Cleaning price (after recurring-rate adjustments, before this credit, excluding tax, tips, and add-ons) required to redeem. */
export const REFERRAL_MIN_CLEANING_DOLLARS = 150;

export const REFERRAL_CREDIT_EXPIRY_DAYS = 60;

export const REFERRER_CREDIT_CAP = 5;

/** Rolling window for the referrer cap. */
export const REFERRER_CAP_MONTHS = 12;

export const REFERRAL_CODE_LENGTH = 8;

/** Unambiguous alphabet. Codes are random; nothing here is derived from a name, email, phone, or address. */
export const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const REFERRAL_TERMS_HREF = "/terms#referral-rewards";

export const REFERRAL_REWARDS_HREF = "/rewards";
