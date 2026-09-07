import Link from "next/link";
import {
  ADD_ON_CATALOG,
  EXTERIOR_WINDOW_CUSTOMER_NOTE,
  QUANTIFIED_ADD_ON_CATALOG,
} from "@/lib/pricing/add-ons";
import { SPECIAL_ROOM_CONFIG, SPECIAL_ROOM_LABELS } from "@/lib/pricing/room-adjustments";
import {
  ALGAE_MILDEW_CONFIG,
  ALGAE_MILDEW_CUSTOMER_NOTE,
  GARAGE_CONFIG,
  OIL_DEGREASE_PER_BAY,
  PATIO_CONFIG,
  PORCH_CONFIG,
  TRIO_CONFIG,
} from "@/lib/pricing/outdoor-add-ons";
import type { SizeBand } from "@/lib/pricing/outdoor-add-ons";

const PROPERTY_PRICING = [
  {
    label: "Studio / 1 Bath Apartment",
    standard: 109,
    deep: 169,
  },
  {
    label: "1 Bedroom / 1 Bath Apartment",
    standard: 129,
    deep: 199,
  },
  {
    label: "2 Bedroom / 2 Bath Apartment or Home",
    standard: 149,
    deep: 229,
  },
  {
    label: "3 Bedroom / 2 Bath Home",
    standard: 179,
    deep: 279,
  },
  {
    label: "4+ Bedrooms or Large Homes",
    standard: 209,
    deep: 329,
  },
];

const DEDICATED_ROOMS = (["game_room", "media_room"] as const).map((id) => ({
  label: SPECIAL_ROOM_LABELS[id],
  standard: SPECIAL_ROOM_CONFIG.standard[id]!,
  deepOrMove: SPECIAL_ROOM_CONFIG.deep[id]!,
}));

const INDOOR_ADD_ONS = (
  ["inside_refrigerator", "inside_oven", "refrigerator_oven_bundle", "inside_cabinets_drawers", "extra_pet_hair_removal"] as const
).map((id) => {
  const def = ADD_ON_CATALOG[id];
  return {
    label: def.label,
    price: def.kind === "starting_at" ? `Starting at $${def.amount}` : `$${def.amount}`,
  };
});

const QUANTIFIED_WINDOW_ADD_ONS = (["interior_window_detailing", "exterior_window_cleaning"] as const).map((id) => {
  const def = QUANTIFIED_ADD_ON_CATALOG[id];
  return {
    label: def.label,
    price: `$${def.perUnitAmount} each`,
    note: id === "exterior_window_cleaning" ? EXTERIOR_WINDOW_CUSTOMER_NOTE : undefined,
  };
});

function formatSizeBands(config: SizeBand<string>[]) {
  return config.map((band, index) => {
    const lower = index === 0 ? null : config[index - 1]!.maxSqFt + 1;
    const rangeLabel = lower === null ? `Up to ${band.maxSqFt} sq ft` : `${lower}–${band.maxSqFt} sq ft`;
    return { rangeLabel, amount: band.amount };
  });
}

const PORCH_BANDS = formatSizeBands(PORCH_CONFIG);
const PATIO_BANDS = formatSizeBands(PATIO_CONFIG);
const PORCH_MAX_SQFT = PORCH_CONFIG[PORCH_CONFIG.length - 1]!.maxSqFt;
const PATIO_MAX_SQFT = PATIO_CONFIG[PATIO_CONFIG.length - 1]!.maxSqFt;
const GARAGE_MAX_CARS = GARAGE_CONFIG[GARAGE_CONFIG.length - 1]!.cars;

const TRIO_BUNDLES = (["small", "medium", "large"] as const).map((size) => {
  const t = TRIO_CONFIG[size];
  return {
    label: `${size[0]!.toUpperCase()}${size.slice(1)} Trio`,
    amount: t.amount,
    detail: `${t.garageCars}-car garage, porch up to ${t.porchMaxSqFt} sq ft, patio up to ${t.patioMaxSqFt} sq ft`,
  };
});

const ALGAE_MILDEW_TIERS = (["small", "medium", "large"] as const).map((size) => ({
  label: `${size[0]!.toUpperCase()}${size.slice(1)}`,
  amount: ALGAE_MILDEW_CONFIG[size],
}));

export default function StartingPrices() {
  return (
    <section
      aria-labelledby="pricing-heading"
      className="bg-background-alt px-6 pt-10 pb-8 sm:pt-12 sm:pb-10 lg:px-8 lg:pt-14 lg:pb-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="pricing-heading"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Starting Prices
          </h2>
          <p className="mt-4 text-lg text-muted">
            Transparent starting rates to help you plan your cleaning.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:mt-12 lg:grid-cols-3">
          {PROPERTY_PRICING.map((tier) => (
            <div
              key={tier.label}
              className="rounded-3xl border border-border bg-white p-6"
            >
              <h3 className="text-lg font-semibold text-foreground">{tier.label}</h3>
              <div className="mt-4 space-y-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted">Standard Cleaning</span>
                  <span className="text-lg font-semibold text-foreground whitespace-nowrap">
                    From ${tier.standard}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                  <span className="text-sm text-muted">Deep Cleaning</span>
                  <span className="text-lg font-semibold text-secondary whitespace-nowrap">
                    From ${tier.deep}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold text-foreground">
              Move-In / Move-Out Cleaning
            </h3>
            <span className="text-lg font-semibold text-foreground whitespace-nowrap">
              From $199
            </span>
          </div>
          <p className="mt-2 text-sm text-muted">
            Based on property size, condition, and requested scope.
          </p>
        </div>

        <div className="mt-10 text-center">
          <h3 className="text-2xl font-semibold tracking-tight text-foreground">
            Additional Services &amp; Add-Ons
          </h3>
          <p className="mt-2 text-sm text-muted">
            Every optional service available when you request a quote — add what your space needs.
          </p>
        </div>

        <div className="mt-6 columns-1 gap-6 sm:columns-2 lg:columns-3">
          <div className="mb-6 break-inside-avoid rounded-3xl border border-border bg-white p-6">
            <p className="text-sm font-semibold text-foreground">Dedicated Rooms</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {DEDICATED_ROOMS.map((room) => (
                <li key={room.label} className="flex items-baseline justify-between gap-3">
                  <span>{room.label}</span>
                  <span className="font-medium text-foreground whitespace-nowrap">
                    ${room.standard} Standard / ${room.deepOrMove} Deep or Move
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted">For separate dedicated rooms only.</p>
          </div>

          <div className="mb-6 break-inside-avoid rounded-3xl border border-border bg-white p-6">
            <p className="text-sm font-semibold text-foreground">Indoor Add-Ons</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {INDOOR_ADD_ONS.map((addOn) => (
                <li key={addOn.label} className="flex items-baseline justify-between gap-3">
                  <span>{addOn.label}</span>
                  <span className="font-medium text-foreground whitespace-nowrap">{addOn.price}</span>
                </li>
              ))}
              {QUANTIFIED_WINDOW_ADD_ONS.map((addOn) => (
                <li key={addOn.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{addOn.label}</span>
                    <span className="font-medium text-foreground whitespace-nowrap">{addOn.price}</span>
                  </div>
                  {addOn.note ? <p className="mt-0.5 text-xs text-muted">{addOn.note}</p> : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-6 break-inside-avoid rounded-3xl border border-border bg-white p-6">
            <p className="text-sm font-semibold text-foreground">Outdoor Cleaning</p>
            <div className="mt-3 space-y-3 text-sm text-muted">
              <div>
                <p className="font-medium text-foreground">Porch</p>
                <ul className="mt-1 space-y-1">
                  {PORCH_BANDS.map((band) => (
                    <li key={band.rangeLabel} className="flex items-baseline justify-between gap-3">
                      <span>{band.rangeLabel}</span>
                      <span className="whitespace-nowrap">${band.amount}</span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3">
                    <span>Over {PORCH_MAX_SQFT} sq ft</span>
                    <span className="whitespace-nowrap">Custom Quote</span>
                  </li>
                </ul>
              </div>
              <div className="border-t border-border pt-3">
                <p className="font-medium text-foreground">Patio</p>
                <ul className="mt-1 space-y-1">
                  {PATIO_BANDS.map((band) => (
                    <li key={band.rangeLabel} className="flex items-baseline justify-between gap-3">
                      <span>{band.rangeLabel}</span>
                      <span className="whitespace-nowrap">${band.amount}</span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3">
                    <span>Over {PATIO_MAX_SQFT} sq ft</span>
                    <span className="whitespace-nowrap">Custom Quote</span>
                  </li>
                </ul>
              </div>
              <div className="border-t border-border pt-3">
                <p className="font-medium text-foreground">Garage</p>
                <ul className="mt-1 space-y-1">
                  {GARAGE_CONFIG.map((garage) => (
                    <li key={garage.cars} className="flex items-baseline justify-between gap-3">
                      <span>{garage.cars}-Car</span>
                      <span className="whitespace-nowrap">${garage.amount}</span>
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3">
                    <span>Over {GARAGE_MAX_CARS}-Car</span>
                    <span className="whitespace-nowrap">Custom Quote</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mb-6 break-inside-avoid rounded-3xl border border-border bg-white p-6">
            <p className="text-sm font-semibold text-foreground">Outdoor Bundles &amp; Treatments</p>
            <ul className="mt-3 space-y-2 text-sm text-muted">
              {TRIO_BUNDLES.map((trio) => (
                <li key={trio.label}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{trio.label}</span>
                    <span className="font-medium text-foreground whitespace-nowrap">${trio.amount}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{trio.detail}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              Trio bundles are an optional selection — never applied automatically.
            </p>
            <div className="mt-4 border-t border-border pt-3 text-sm text-muted">
              <div className="flex items-baseline justify-between gap-3">
                <span>Heavy Garage Oil &amp; Degrease</span>
                <span className="font-medium text-foreground whitespace-nowrap">
                  ${OIL_DEGREASE_PER_BAY} per bay
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">Additional to regular garage cleaning.</p>
            </div>
            <div className="mt-4 border-t border-border pt-3 text-sm text-muted">
              <p className="font-medium text-foreground">Black Algae &amp; Mildew Deep Treatment</p>
              <ul className="mt-1 space-y-1">
                {ALGAE_MILDEW_TIERS.map((tier) => (
                  <li key={tier.label} className="flex items-baseline justify-between gap-3">
                    <span>{tier.label}</span>
                    <span className="whitespace-nowrap">${tier.amount}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">{ALGAE_MILDEW_CUSTOMER_NOTE}</p>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted">
          Starting prices are estimates. Final pricing depends on property
          size, condition, cleaning type, requested scope, add-ons, and
          service frequency. Your final rate will be confirmed before
          service.
        </p>

        <div className="mt-8 flex justify-center">
          <Link
            href="/quote"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-medium text-foreground transition-colors hover:bg-secondary"
          >
            Get My Cleaning Quote
          </Link>
        </div>
      </div>
    </section>
  );
}
