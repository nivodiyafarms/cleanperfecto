import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal/LegalDocument";
import { SITE_CONTACT } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "Privacy Policy — CleanPerfecto",
  description: "What CleanPerfecto collects for quotes, bookings, payments, and messages, and how to ask about your information.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      description="This page explains what we collect, why we collect it, and who helps us handle it. Last updated October 30, 2026."
    >
      <LegalSection id="who-we-are" title="Who we are">
        <p>
          CleanPerfecto provides residential and commercial cleaning across Frisco, Plano, Lewisville, Richardson, McKinney, and nearby DFW communities. Our website is{" "}
          {SITE_CONTACT.websiteUrl}.
        </p>
        <p>
          To ask about your information, email{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>{" "}
          or call or text{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.phoneHref}>
            {SITE_CONTACT.phoneDisplay}
          </a>.
        </p>
      </LegalSection>

      <LegalSection id="what-we-collect" title="What we collect">
        <p>When you request a quote on the homepage, we collect your name, phone number, email address, ZIP code, property type, cleaning service, preferred date, and any message you add.</p>
        <p>
          When you continue through a quote or booking, we may also collect your service address, the property and cleaning details you choose, square footage if you provide it, how
          often you want cleaning, add-ons, how you heard about us, and the estimate or agreed scope and rate.
        </p>
        <p>
          We keep your name, email, and phone so your quotes and cleanings stay together. Your service address is kept with that quote or visit. Our team may add notes about
          follow-up. A request can come through the website, or we may record one that reaches us by phone or text.
        </p>
      </LegalSection>

      <LegalSection id="service-agreement" title="Your service agreement">
        <p>
          Before service, we ask you to accept our service agreement during booking or in your account. We keep the agreement you accepted, your typed legal name, and the time you
          accepted it. We can also keep a copy you can download.
        </p>
        <p>When you accept, we may save the IP address and browser information from that visit.</p>
        <p>
          That agreement lets our cleaning team enter the areas you make available, move items when it is reasonably necessary and safe, take photos or videos of the work for our
          business and marketing, and place a yard sign until the next visit or until it is removed.
        </p>
      </LegalSection>

      <LegalSection id="payments" title="Payments">
        <p>
          Card and bank payments are processed by Stripe. You enter payment details on Stripe. We do not keep your full card number. If you save a card, we keep the card brand, the
          last four digits, the expiration month and year, and a payment reference from Stripe.
        </p>
        <p>
          We also keep the amounts for a visit or package, including the confirmed total, tip, tax when it applies, payment status, receipts, and invoices. If you pay by cash or
          Zelle, our team can record that payment. We do not ask you for a bank login to do that.
        </p>
        <p>
          For pay per cleaning, the payment authorization you accept lets us charge a later cancellation, rescheduling, or no-access fee on the saved payment method. The regular
          cleaning charge is sent to you afterward as a Final Total to review and pay. A prepaid package is paid when you book. Those rules are in our{" "}
          <Link href="/terms" className="font-medium text-secondary underline-offset-2 hover:underline">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="messages" title="Email and your account">
        <p>
          We email you about quotes, booking and schedule changes, your service agreement, payments and receipts, and, after a cleaning, a request to leave a review on Google. Email
          is delivered by Resend.
        </p>
        <p>If you turn text updates on or off in your account, we save that choice. Cleaning updates are sent by email.</p>
        <p>
          Your account signs you in with an email link and uses a cookie to keep you signed in. To change the email on your account, contact us at{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>.
        </p>
      </LegalSection>

      <LegalSection id="google-reviews" title="Google reviews">
        <p>We plan to show reviews from our Google Business Profile on this website. That feature is not turned on yet.</p>
        <p>
          When it is turned on, we plan to show a selection of public reviews on the homepage, together with Google&apos;s overall rating and the total number of reviews. Each review
          would include the reviewer&apos;s name, star rating, review date, and review text when the review has text. If Google provides a profile photo, we would show it. If not, we
          would show the reviewer&apos;s initial. A longer review can be shortened on the page, and the full text stays available. We would not change the reviewer&apos;s words or star
          rating. The overall rating would be Google&apos;s rating.
        </p>
        <p>
          To show those reviews, we would keep a copy of the reviewer&apos;s name, star rating, review text, review date, and photo link. You would not need a Google account to read
          them on our site. Taking a review off our website would not remove it from Google.
        </p>
      </LegalSection>

      <LegalSection id="use" title="Why we use it">
        <p>
          We use this information to answer your quote, confirm the scope and rate, schedule and do the cleaning, take payment, send the messages above, keep your service
          agreement, and run your account. When Google review display is turned on, we would use it to show those reviews.
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="Who else handles it">
        <ul className="list-disc space-y-2 pl-5">
          <li>Supabase stores your account information, sign-in, and signed service agreement.</li>
          <li>Stripe processes card and bank payments and can calculate tax on a charge.</li>
          <li>Resend delivers email.</li>
          <li>When review display is turned on, Google provides the reviews for our listing.</li>
        </ul>
        <p>CleanPerfecto staff can see the information they need to schedule and perform your cleaning.</p>
      </LegalSection>

      <LegalSection id="your-information" title="Questions about your information">
        <p>
          Email{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>{" "}
          to ask what we have or to ask us to update it.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If this policy changes, we will update this page and the date at the top. An agreement you already accepted stays the agreement kept with that acceptance.</p>
      </LegalSection>
    </LegalDocument>
  );
}
