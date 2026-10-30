import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalNotice, LegalSection } from "@/components/legal/LegalDocument";
import { SITE_CONTACT } from "@/lib/site-contact";

export const metadata: Metadata = {
  title: "Privacy Policy — CleanPerfecto",
  description: "How CleanPerfecto collects, uses, and stores information from quotes, bookings, payments, messages, and Google reviews.",
};

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      description="This policy describes the information the CleanPerfecto website actually collects and how that information is used. It does not add practices that are not in the product. Last updated October 29, 2026."
    >
      <LegalSection id="who-we-are" title="Who we are">
        <p>
          CleanPerfecto provides residential and commercial cleaning across Frisco, Plano, Lewisville, Richardson, McKinney, and nearby DFW communities.
          The public website is {SITE_CONTACT.websiteUrl}.
        </p>
        <p>
          Privacy questions go to{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>{" "}
          or{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.phoneHref}>
            {SITE_CONTACT.phoneDisplay}
          </a>
          .
        </p>
        <LegalNotice>
          A legal business form, such as an LLC, and a mailing address are not published on this website. This policy does not invent them.
        </LegalNotice>
      </LegalSection>

      <LegalSection id="quotes-and-bookings" title="Quotes and bookings">
        <p>The homepage quote form collects your name, phone number, email address, ZIP code, property type, cleaning service, preferred date, and an optional message.</p>
        <p>
          The quote and booking flow can also collect a service address (street, optional second line, city, state, and ZIP), property details you choose (property type, cleaning
          type, condition, bedrooms and bathrooms, square footage if you provide it, frequency, add-ons, special rooms, move-in or move-out details, and outdoor areas), how you
          heard about CleanPerfecto, and the estimate or agreed scope and rate for that request. At least one of phone or email is required on an instant quote. The homepage form
          requires both.
        </p>
        <p>
          CleanPerfecto keeps a customer record with your name, email, and phone so quotes, visits, and follow-up can stay attached to the same person. The service address is
          stored with the quote or visit. Staff can also store follow-up notes and follow-up dates on the customer record.
        </p>
        <p>Quotes and bookings may be entered from the website, or recorded by CleanPerfecto when a request arrives by phone, text, or through an admin.</p>
      </LegalSection>

      <LegalSection id="service-authorization" title="Service authorization">
        <p>
          Before service, CleanPerfecto asks you to accept the Service Consent Agreement shown during booking or in your customer portal. The agreement you accept is stored with
          the version you were shown, including the text itself, your typed legal name, and the time of acceptance. A PDF of a signed agreement can be stored so you can download
          your own copy.
        </p>
        <p>
          When you accept, the website may also store the IP address and browser type from that request as extra evidence of the acceptance. Acceptance is still recorded if that
          extra evidence is missing.
        </p>
        <p>
          That agreement authorizes the cleaning team to access the areas you make available, move items when it is reasonably necessary and safe, take photos or videos of the
          work for CleanPerfecto business and marketing use, and place a yard sign until the next visit or until it is removed. The public website does not have a form for
          customers to upload those photos.
        </p>
      </LegalSection>

      <LegalSection id="payments" title="Payments">
        <p>
          Card and bank-account payments are processed by Stripe. You enter payment details on Stripe. CleanPerfecto does not store your full card number in its own database. For
          a saved card, CleanPerfecto stores the Stripe customer and payment-method identifiers, the card brand, the last four digits, and the expiration month and year.
        </p>
        <p>
          CleanPerfecto also stores the amounts related to a visit or package, including the confirmed total, tip, tax when Stripe calculates it, payment status, receipts, and
          invoices. A cash or Zelle payment can be recorded by CleanPerfecto staff when that is how a visit was paid. Those records do not include a bank login.
        </p>
        <p>
          For a pay-per-cleaning booking, the payment authorization you accept lets CleanPerfecto charge a later cancellation, rescheduling, or no-access fee on the saved payment
          method. The regular cleaning charge is still sent to you as a Final Total to review and pay. A prepaid package is paid at checkout. The{" "}
          <Link href="/terms" className="font-medium text-secondary underline-offset-2 hover:underline">
            Terms of Service
          </Link>{" "}
          restate those rules.
        </p>
      </LegalSection>

      <LegalSection id="messages" title="Email, text messages, and the customer portal">
        <p>
          CleanPerfecto sends email through Resend to the address you provide and to CleanPerfecto staff. Those messages include quote replies, booking and schedule updates,
          service-authorization requests, payment and receipt notices, and a request to leave a Google review after a cleaning.
        </p>
        <p>
          The customer portal can store whether you want text-message updates. No text-message provider is connected, so the website does not currently send text messages. Turning
          text updates on or off in your profile only stores that preference.
        </p>
        <p>
          The customer portal signs you in with an email link and keeps a sign-in session in a cookie. The admin area uses its own sign-in cookie. These cookies operate the
          account. This website does not include a third-party advertising or analytics tag, and it does not show a separate marketing-cookie banner.
        </p>
      </LegalSection>

      <LegalSection id="google-reviews" title="Google Business Profile reviews">
        <p>
          CleanPerfecto connects its own Google Business Profile listing with a private authorization that stays on CleanPerfecto&apos;s servers. The website does not publish that
          authorization, and visitors are not asked to sign in with Google to read reviews.
        </p>
        <p>
          The fetch is built to run about once a day after that connection is configured. Turning the schedule on is a separate step for each environment. The database setup does
          not start the daily fetch by itself. This policy describes the connection that is built. It does not mean a production sync is already running.
        </p>
        <p>After a complete, successful fetch, CleanPerfecto stores each review Google returns:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>the reviewer&apos;s display name</li>
          <li>the reviewer&apos;s photo address, when Google provides one</li>
          <li>the star rating</li>
          <li>the review text, when the review has text</li>
          <li>the times Google gives for when the review was created and updated</li>
          <li>when CleanPerfecto first stored the review and when a successful sync last confirmed it</li>
        </ul>
        <p>
          CleanPerfecto also stores Google&apos;s overall rating and total review count from that fetch. The photo file itself is not copied into CleanPerfecto&apos;s database. If
          a photo is shown, the page loads it from Google. If Google does not provide a photo, the page shows the reviewer&apos;s initial instead.
        </p>
        <p>
          On the public homepage, signed-in CleanPerfecto staff choose up to five of those reviews to feature, and the order they appear in. The page shows the reviewer&apos;s
          name, photo or initial, star rating, review date, and review text as Google provided them. A long review can be shortened on screen with a control that reveals the full
          text. The overall rating and total count are Google&apos;s numbers, not a score recalculated from the featured reviews. The section stays hidden until at least one
          featured review is still inside the storage window below and the overall rating comes from a successful sync inside that same window. A link to the Google listing is
          shown when that public listing address is configured.
        </p>
        <p>Cached reviews are deleted in two ways:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            After a complete successful sync, a cached review that Google no longer returns is deleted. A failed or incomplete sync does not delete reviews for that reason. A
            featured review is removed from the homepage when its cached copy is deleted.
          </li>
          <li>
            A cached review that has not been reconfirmed within 30 days is deleted. A separate database job runs that deletion once a day even if the website is down, the daily
            fetch is off, or the Google connection is removed. The homepage also hides a review, and hides the overall rating, once they are outside that 30-day window.
          </li>
        </ul>
        <p>
          Deleting a cached copy removes it from CleanPerfecto&apos;s website. It does not delete the original review on Google. The 30-day limit is the retention window built
          for this connection. Google&apos;s own content policy should be rechecked before that number is changed.
        </p>
      </LegalSection>

      <LegalSection id="use" title="How the information is used">
        <p>CleanPerfecto uses this information to answer quote requests, confirm scope and rate, schedule and perform cleaning, take payment, send the messages above, keep the service-authorization record, operate the customer portal, and show Google reviews on the website.</p>
      </LegalSection>

      <LegalSection id="sharing" title="Who else handles it">
        <p>The website uses these providers for the jobs named here:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Supabase stores the database records, sign-in sessions, and signed service-authorization files.</li>
          <li>Stripe processes card and bank payments and can calculate tax on a charge.</li>
          <li>Resend delivers email.</li>
          <li>Google provides the Business Profile reviews for CleanPerfecto&apos;s listing, and reviewer photos when a photo address is shown.</li>
        </ul>
        <p>CleanPerfecto staff can see the records they need to do the work, including the cached Google reviews used to choose the featured set.</p>
        <LegalNotice>
          This website does not include a tool that sells personal information to advertisers. A formal promise that CleanPerfecto never sells personal information has not been
          adopted as a legal statement. No data-residency, international-transfer, or children&apos;s-privacy statement is published here.
        </LegalNotice>
      </LegalSection>

      <LegalSection id="retention" title="How long it is kept">
        <p>
          Google review content in CleanPerfecto&apos;s cache follows the 30-day rule above. Customer records are not given a public deletion period. The application is not set
          up to delete a customer row. Quote, booking, payment, message, and service-authorization retention periods are not published. To ask about your information, email{" "}
          <a className="font-medium text-secondary underline-offset-2 hover:underline" href={SITE_CONTACT.emailHref}>
            {SITE_CONTACT.email}
          </a>
          . The customer portal does not let you change the email address on the account from the profile page.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes">
        <p>If this policy changes, the updated page will replace this one and the date at the top will change. The service agreement you already accepted stays the version stored with that acceptance.</p>
      </LegalSection>
    </LegalDocument>
  );
}
