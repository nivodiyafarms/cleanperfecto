export type RealResult = {
  id: string;
  caption: string;
  src: string;
  poster: string;
};

export const REAL_RESULTS_HEADING = "Real homes. Real results.";

export const TIKTOK_URL = "https://www.tiktok.com/@cleanperfecto6";
export const FACEBOOK_URL = "https://www.facebook.com/share/1DTNrpKxMc/";

export const REAL_RESULTS: readonly RealResult[] = [
  {
    id: "stovetop",
    caption: "Glass stovetop · Deep clean",
    src: "/videos/results/results-stovetop.mp4",
    poster: "/videos/results/results-stovetop.jpg",
  },
  {
    id: "shower",
    caption: "Shower glass · Soap scum removal",
    src: "/videos/results/results-shower.mp4",
    poster: "/videos/results/results-shower.jpg",
  },
  {
    id: "bathtub",
    caption: "Bathtub · Deep cleaning",
    src: "/videos/results/results-bathtub.mp4",
    poster: "/videos/results/results-bathtub.jpg",
  },
];

/** Pick the single card that should play: the most-visible one at or above the threshold. */
export function pickActiveIndex(ratios: readonly number[], threshold = 0.6): number | null {
  let best: number | null = null;
  for (let i = 0; i < ratios.length; i++) {
    if (ratios[i] >= threshold && (best === null || ratios[i] > ratios[best])) best = i;
  }
  return best;
}
