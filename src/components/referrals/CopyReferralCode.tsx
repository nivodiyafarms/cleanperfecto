"use client";

import { useState } from "react";

export default function CopyReferralCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-foreground"
    >
      {copied ? "Copied" : "Copy my code"}
    </button>
  );
}
