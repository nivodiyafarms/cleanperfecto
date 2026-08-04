import GlassPanel from "@/components/ui/GlassPanel";

const STANDARD_CATEGORIES = [
  {
    label: "General",
    items: [
      "Dust reachable surfaces",
      "Vacuum carpets and rugs",
      "Sweep and mop floors",
      "Empty trash cans",
      "Make beds with existing linens",
      "Light straightening",
    ],
  },
  {
    label: "Kitchen",
    items: [
      "Clean kitchen countertops",
      "Clean sink and faucet",
      "Wipe backsplash",
      "Wipe stovetop surface",
      "Wipe appliance exteriors",
      "Light cleaning of cabinet fronts",
    ],
  },
  {
    label: "Bathroom",
    items: [
      "Clean and disinfect toilets",
      "Clean bathroom sinks and vanities",
      "Clean mirrors",
      "Clean bathtub and shower surfaces",
    ],
  },
];

const DEEP_ITEMS = [
  "Heavy grease and buildup",
  "Heavy soap scum",
  "Baseboards and trim",
  "Doors and door frames",
  "Handles and switches",
  "Dusting blinds",
  "Reachable ceiling fans and light fixtures",
  "Detailed cabinet exteriors",
  "Cleaning around small appliances",
  "Detailed stovetop burners",
  "Detailed bathroom tile cleaning",
  "Detailed corners and edges",
  "Reachable wall marks",
  "Interior window refresh for up to 5 reachable panes",
];

const ADD_ONS = [
  "Inside oven",
  "Inside refrigerator",
  "Inside cabinets and drawers",
  "Carpet shampooing",
  "Heavy organization",
];

function ItemGrid({ items }: { items: string[] }) {
  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm text-muted sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 text-secondary">
            &bull;
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function ServiceComparison() {
  return (
    <section
      aria-labelledby="comparison-heading"
      className="px-6 pt-10 pb-8 sm:pt-12 sm:pb-10 lg:px-8 lg:pt-14 lg:pb-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="comparison-heading"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Standard vs. Deep Cleaning
          </h2>
          <p className="mt-4 text-lg text-muted">
            A high-level guide to help you choose. Your exact cleaning scope
            is confirmed before service.
          </p>
          <p className="mt-2 text-sm text-muted">
            Exact scope is confirmed before service. Tracks, screens,
            exterior glass, and high or unsafe windows require a separate
            quote.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:mt-12">
          <GlassPanel className="p-8">
            <h3 className="text-xl font-semibold text-foreground">Standard Cleaning</h3>
            <p className="mt-2 text-muted">
              Routine maintenance cleaning for spaces that are already
              regularly maintained.
            </p>
            <div className="mt-5 space-y-5">
              {STANDARD_CATEGORIES.map((category) => (
                <div key={category.label}>
                  <p className="text-xs font-semibold tracking-wide text-foreground uppercase">
                    {category.label}
                  </p>
                  <div className="mt-2">
                    <ItemGrid items={category.items} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted">
              Interior Window Detailing — Available by quote
            </p>
          </GlassPanel>

          <GlassPanel className="border-primary/30 p-8">
            <h3 className="text-xl font-semibold text-foreground">Deep Cleaning</h3>
            <p className="mt-2 text-muted">
              An intensive, detail-first clean for built-up dirt, grime, and
              areas that need extra attention.
            </p>
            <p className="mt-3 text-xs font-semibold tracking-wide text-foreground uppercase">
              Includes the Standard Cleaning foundation, plus:
            </p>
            <div className="mt-2">
              <ItemGrid items={DEEP_ITEMS} />
            </div>
            <p className="mt-4 text-xs text-muted">
              Additional window detailing is available by quote.
            </p>
          </GlassPanel>
        </div>

        <div className="mt-6 rounded-3xl border border-dashed border-border bg-background-alt p-6 sm:p-8">
          <p className="text-sm font-semibold text-foreground">
            Add-ons (available for Standard and Deep Cleaning)
          </p>
          <div className="mt-3">
            <ItemGrid items={ADD_ONS} />
          </div>
          <p className="mt-4 text-sm text-muted">
            Inside oven, refrigerator, cabinets and drawers, carpet
            shampooing, and heavy organization are available as add-ons.
          </p>
        </div>
      </div>
    </section>
  );
}
