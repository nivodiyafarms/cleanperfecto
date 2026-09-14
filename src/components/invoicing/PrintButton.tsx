"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-background-alt"
    >
      Print / Save as PDF
    </button>
  );
}
