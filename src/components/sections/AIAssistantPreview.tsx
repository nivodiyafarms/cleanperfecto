import GlassPanel from "@/components/ui/GlassPanel";

export default function AIAssistantPreview() {
  return (
    <section aria-labelledby="ai-preview-heading" className="px-6 py-20 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <GlassPanel className="p-10 text-center sm:p-14">
          <span className="inline-flex items-center rounded-full border border-white/10 px-3 py-1 text-xs font-medium tracking-wide text-muted uppercase">
            Coming soon
          </span>
          <h2
            id="ai-preview-heading"
            className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Your AI cleaning assistant
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
            Soon you&apos;ll be able to ask questions about your booking,
            service details, and cleaning plan — and get instant, accurate
            answers.
          </p>
        </GlassPanel>
      </div>
    </section>
  );
}
