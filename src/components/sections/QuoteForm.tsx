"use client";

import { useState, type FormEvent } from "react";
import { PROPERTY_TYPES } from "@/lib/property-types";
import { SERVICES } from "@/lib/services";
import { submitQuoteRequest } from "@/lib/submitQuoteRequest";

type Status = "idle" | "submitting" | "submitted";

const fieldClass =
  "w-full rounded-xl border border-border bg-white px-4 py-3 text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50";
const labelClass = "text-sm font-medium text-foreground";

export default function QuoteForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const formData = new FormData(event.currentTarget);
    await submitQuoteRequest({
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      propertyType: String(formData.get("propertyType") ?? ""),
      serviceId: String(formData.get("serviceId") ?? ""),
      zip: String(formData.get("zip") ?? ""),
      preferredDate: String(formData.get("preferredDate") ?? ""),
      message: String(formData.get("message") ?? ""),
    });

    setStatus("submitted");
  }

  if (status === "submitted") {
    return (
      <div
        role="status"
        className="rounded-3xl border border-primary/30 bg-primary/10 p-10 text-center"
      >
        <h3 className="text-xl font-semibold text-foreground">
          Thanks — we&apos;ll be in touch
        </h3>
        <p className="mt-2 text-muted">
          Your request has been captured. Our team will follow up shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className={labelClass}>
          Name
        </label>
        <input id="name" name="name" type="text" required className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="phone" className={labelClass}>
          Phone
        </label>
        <input id="phone" name="phone" type="tel" required className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input id="email" name="email" type="email" required className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="zip" className={labelClass}>
          ZIP code
        </label>
        <input id="zip" name="zip" type="text" inputMode="numeric" required className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="propertyType" className={labelClass}>
          Property type
        </label>
        <select id="propertyType" name="propertyType" required defaultValue="" className={fieldClass}>
          <option value="" disabled>
            Select a property type
          </option>
          {PROPERTY_TYPES.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="serviceId" className={labelClass}>
          Cleaning service
        </label>
        <select id="serviceId" name="serviceId" required defaultValue="" className={fieldClass}>
          <option value="" disabled>
            Select a cleaning service
          </option>
          {SERVICES.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <label htmlFor="preferredDate" className={labelClass}>
          Preferred date
        </label>
        <input
          id="preferredDate"
          name="preferredDate"
          type="date"
          className={`${fieldClass} sm:max-w-xs`}
        />
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2">
        <label htmlFor="message" className={labelClass}>
          Message
        </label>
        <textarea id="message" name="message" rows={4} className={fieldClass} />
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={status === "submitting"}
          className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-4 text-base font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {status === "submitting" ? "Sending..." : "Send Request"}
        </button>
      </div>
    </form>
  );
}
