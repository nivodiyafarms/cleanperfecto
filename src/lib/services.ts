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
      "Routine maintenance cleaning for spaces that are already regularly maintained.",
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
      "An intensive, detail-first clean for built-up dirt, grime, and areas that need extra attention.",
    included: [
      "Heavy grease & buildup",
      "Baseboards, trim, corners & edges",
      "Doors, frames, handles & switches",
      "Detailed bathroom surfaces",
      "Interior window refresh (up to 5 panes)",
    ],
    visualState:
      "Detailed hotspots glow across baseboards, doors, handles, and bathroom surfaces.",
  },
  {
    id: "move",
    name: "Move-In/Move-Out Cleaning",
    description:
      "A detailed reset for an empty property, ready for its next chapter.",
    included: [
      "Empty-property deep clean",
      "Inside closets",
      "Detailed cabinet exteriors",
      "Move-ready final walkthrough",
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
