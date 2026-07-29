import GlassPanel from "@/components/ui/GlassPanel";

const STEPS = [
  {
    step: "01",
    title: "Get your instant quote",
    detail: "Tell us about your space and choose a service — pricing appears in seconds.",
  },
  {
    step: "02",
    title: "Pick a time that works",
    detail: "Book a one-time visit or set up a recurring schedule that fits your routine.",
  },
  {
    step: "03",
    title: "We clean, you relax",
    detail: "A vetted, background-checked team arrives ready — you come home to perfectly clean.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-background-alt px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            How it works
          </h2>
          <p className="mt-4 text-lg text-muted">
            Three simple steps from booking to a perfectly clean space.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
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
