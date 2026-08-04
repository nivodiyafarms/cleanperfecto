import GlassPanel from "@/components/ui/GlassPanel";

const STEPS = [
  {
    step: "01",
    title: "Request your quote",
    detail: "Tell us about your space, service needs, and preferred date.",
  },
  {
    step: "02",
    title: "Confirm your scope and rate",
    detail: "We confirm the cleaning scope, final rate, and service date.",
  },
  {
    step: "03",
    title: "We clean, you relax",
    detail: "Our cleaning team completes the agreed cleaning scope.",
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="bg-background-alt px-6 pt-10 pb-8 sm:pt-12 sm:pb-10 lg:px-8 lg:pt-14 lg:pb-12"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            How it works
          </h2>
          <p className="mt-4 text-lg text-muted">
            Three simple steps from booking to a perfectly clean space.
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-3 lg:mt-12">
          {STEPS.map((item) => (
            <GlassPanel key={item.step} className="p-8">
              <span className="inline-flex rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-foreground">
                {item.step}
              </span>
              <h3 className="mt-4 text-xl font-semibold text-foreground">
                {item.title}
              </h3>
              <p className="mt-2 text-muted">{item.detail}</p>
            </GlassPanel>
          ))}
        </div>
      </div>
    </section>
  );
}
