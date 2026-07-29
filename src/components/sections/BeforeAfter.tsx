export default function BeforeAfter() {
  return (
    <section aria-labelledby="before-after-heading" className="px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2
            id="before-after-heading"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            The transformation
          </h2>
          <p className="mt-4 text-lg text-muted">
            See the difference a perfectly clean space makes.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border border-border bg-background-alt p-10">
            <span className="text-sm font-medium text-muted">Before</span>
            <p className="mt-3 text-lg text-foreground">
              Cluttered surfaces, dust in the corners, and a to-do list that
              never gets shorter.
            </p>
          </div>
          <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-10">
            <span className="text-sm font-semibold text-foreground">After</span>
            <p className="mt-3 text-lg text-foreground">
              Every surface polished, every room organized — a space that
              feels like new again.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
