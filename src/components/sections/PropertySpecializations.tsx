import GlassPanel from "@/components/ui/GlassPanel";
import { PROPERTY_TYPES } from "@/lib/property-types";

export default function PropertySpecializations() {
  return (
    <section
      id="specializations"
      className="bg-background-alt px-6 pt-8 pb-8 sm:pt-10 sm:pb-10 lg:px-8 lg:pt-12 lg:pb-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Specialized for your property
          </h2>
          <p className="mt-4 text-lg text-muted">
            The right cleaning approach for the space you manage.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:mt-12 lg:grid-cols-4">
          {PROPERTY_TYPES.map((type) => (
            <GlassPanel key={type.id} className="p-8">
              <h3 className="text-xl font-semibold text-foreground">
                {type.name}
              </h3>
              <p className="mt-2 text-muted">{type.description}</p>
              <ul className="mt-5 space-y-2">
                {type.specializations.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-muted"
                  >
                    <span aria-hidden="true" className="mt-1 text-secondary">
                      &bull;
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </GlassPanel>
          ))}
        </div>
      </div>
    </section>
  );
}
