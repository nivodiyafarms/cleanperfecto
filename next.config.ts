import type { NextConfig } from "next";
import { REVIEWER_PHOTO_REMOTE_PATTERNS } from "./src/lib/google-reviews/reviewer-photo-url";

const nextConfig: NextConfig = {
  images: {
    // Same hosts isAllowedReviewerPhotoUrl accepts. A rejected or failed
    // photo falls back to reviewer initials in GoogleReviewsCarousel.
    remotePatterns: REVIEWER_PHOTO_REMOTE_PATTERNS,
  },
};

export default nextConfig;
