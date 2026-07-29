export type ServiceId = "standard" | "deep" | "move" | "recurring";

export interface Service {
  id: ServiceId;
  name: string;
  description: string;
  included: string[];
  /** Screen-reader description of what the interactive property illustrates for this service. */
  visualState: string;
}

export const SERVICES: Service[] = [
  {
    id: "standard",
    name: "Standard Cleaning",
    description:
      "A thorough refresh for everyday living — dusted, vacuumed, and polished from room to room.",
    included: [
      "Dusting & surface wipe-down",
      "Vacuuming & mopping",
      "Kitchen & bathroom refresh",
      "Trash removal",
    ],
    visualState:
      "The home appears fresh, polished, and organized with a soft clean glow.",
  },
  {
    id: "deep",
    name: "Deep Cleaning",
    description:
      "An intensive, detail-first clean that reaches the spots everyday cleaning skips.",
    included: [
      "Inside oven & appliances",
      "Cabinet interiors",
      "Baseboards & trim",
      "Bathroom deep scrub",
    ],
    visualState:
      "Detailed hotspots glow across the oven, cabinets, baseboards, and bathrooms.",
  },
  {
    id: "move",
    name: "Move-In/Move-Out Cleaning",
    description:
      "A complete reset for an empty property, ready for its next chapter.",
    included: [
      "Full interior deep clean",
      "Inside closets & cabinets",
      "Window sills & tracks",
      "Move-ready inspection",
    ],
    visualState:
      "Furniture fades away, revealing a fully emptied and reset property.",
  },
  {
    id: "recurring",
    name: "Recurring Cleaning",
    description:
      "Scheduled visits — weekly, biweekly, or monthly — that keep your space consistently clean.",
    included: [
      "Flexible scheduling",
      "Consistent cleaning team",
      "Priority booking",
      "Loyalty pricing",
    ],
    visualState:
      "A subtle recurring cycle ring appears around the property, marking scheduled visits.",
  },
];

export const DEFAULT_SERVICE_ID: ServiceId = "standard";
