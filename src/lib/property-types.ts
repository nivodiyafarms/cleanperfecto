export type PropertyTypeId = "home" | "airbnb" | "restaurant" | "office";

export interface PropertyType {
  id: PropertyTypeId;
  name: string;
  description: string;
  specializations: string[];
  image: {
    src: string;
    alt: string;
  };
}

export const PROPERTY_TYPES: PropertyType[] = [
  {
    id: "home",
    name: "Home",
    description: "Routine care for the place you live.",
    specializations: [
      "Routine residential cleaning",
      "Deep cleaning",
      "Move-in/move-out cleaning",
      "Recurring cleaning",
    ],
    image: {
      src: "/images/home-cleaning.webp",
      alt: "Bright, freshly cleaned home interior",
    },
  },
  {
    id: "airbnb",
    name: "Airbnb",
    description: "Guest-ready turnovers between every stay.",
    specializations: [
      "Between-stay turnover",
      "Linen reset",
      "Kitchen and bathroom preparation",
      "Guest-ready staging",
    ],
    image: {
      src: "/images/airbnb-cleaning.webp",
      alt: "Guest-ready Airbnb rental interior, staged and spotless",
    },
  },
  {
    id: "restaurant",
    name: "Restaurant",
    description: "Sanitation-focused cleaning for dining and service areas.",
    specializations: [
      "Dining-area cleaning",
      "Floors and tables",
      "Service counters",
      "Grease-prone and sanitation-focused areas",
      "Recurring commercial cleaning",
    ],
    image: {
      src: "/images/restaurant-cleaning.webp",
      alt: "Clean restaurant dining area ready for service",
    },
  },
  {
    id: "office",
    name: "Office",
    description: "Recurring commercial cleaning that keeps your workplace sharp.",
    specializations: [
      "Desks and workstations",
      "Shared areas",
      "Restrooms",
      "Trash and recycling",
      "Recurring commercial cleaning",
    ],
    image: {
      src: "/images/office-cleaning.webp",
      alt: "Tidy, organized office workspace",
    },
  },
];

export const DEFAULT_PROPERTY_TYPE_ID: PropertyTypeId = "home";

export const COMMERCIAL_PROPERTY_TYPE_IDS: PropertyTypeId[] = ["restaurant", "office"];
