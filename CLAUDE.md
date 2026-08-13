@AGENTS.md

# CleanPerfecto

## Product

CleanPerfecto is a premium cleaning-company website and future business platform.

The final platform will include:

- Residential and commercial cleaning services

- Instant quote generation

- Online booking and scheduling

- Stripe payments

- Customer and admin portals

- AI chatbot

- Company-document uploads

- RAG-based answers

- Controlled access to live business data

## Current Milestone

Work only on the project foundation and public homepage.

Do not implement the database, authentication, payments, booking, AI chatbot, or RAG yet.

## Approved Launch Direction (current source of truth)

The sections below describe the **approved, owner-signed-off** launch implementation. Where anything here conflicts with older assumptions, this document wins — it reflects a deliberate decision, not a regression.

## Hero: Cinematic Video Background

The approved launch hero is a full-width video-background hero — not a static property photograph and not a 3D/WebGL scene.

Approved assets:

- `public/videos/cleanperfecto-hero.mp4`
- `public/images/cleanperfecto-hero-poster.webp`

Approved behavior:

- `autoplay`, `muted`, `loop`, `playsInline`, no visible controls
- Local MP4 source (no external/CDN video dependency)
- Poster image (`next/image`, `priority`) renders first and remains the fallback
- `prefers-reduced-motion: reduce` shows the poster only — no video is mounted
- Dark navy readability overlay/gradient over the video so hero text stays legible
- Stable hero height (`min-h-[700px]`, `lg:h-[88vh] lg:min-h-[760px]`) — do not change this unless a new, measurable defect is found
- Video remains visible on both desktop and mobile (not desktop-only)

**Priority loading**: the hero poster is the only above-the-fold, priority-loaded media on the page. No other image on the homepage should carry `priority` or `fetchPriority="high"` — see "Property Selector" below.

**Known asset caveat**: the current hero MP4 contains a visible Gemini/Veo-style generation sparkle watermark baked into the footage. This is accepted for the current launch — do not crop, blur, cover, or otherwise alter the video file to hide it, and do not block shipping on it. A properly licensed, watermark-free replacement should be sourced for a future revision; when that happens, source, license, price, and format should be presented before anything is downloaded or swapped in (same bar as the "Future: Advanced 3D Property" process below).

## Property Selector: Second Conversion Step

The property type selector, property photo, cleaning service selector, service summary, and quote CTA are **not** part of the hero. They live in their own section directly below it:

**"Find the Right Cleaning Service"** (`CleaningServiceSelector` → renders `HeroInteractive`)

- Property Type selector (Home / Airbnb / Restaurant / Office) controls which photo (`PropertyImage`, `next/image`) is shown
- Cleaning Service selector (Standard / Deep / Move-In/Move-Out / Recurring) is kept separate and does not change the property photo — it feeds the quote request
- The property photo is below-the-fold: it must render as a normal lazy-loaded image and must **not** be `priority` — only the hero poster/video is priority media on this page
- Fixed aspect-ratio container (`aspect-square`) so switching property type causes no layout shift
- `object-cover` for consistent framing across the four photos
- A real `sizes` attribute matched to the container's responsive width
- Alt text changes with the selected property type (accessibility, not decorative)
- Keep all selector controls as real HTML `<button>`s outside the image
- One quote CTA in this section; label switches between "Get My Cleaning Quote" (Home/Airbnb) and "Request a Commercial Quote" (Restaurant/Office)

Service and property-type names must remain clear and immediately understandable. Do not use literal planets, invented names, gaming-style navigation, or visuals that make customers guess what each option means.

## Homepage Message

The website should communicate the service within five seconds.

Hero direction:

**From lived-in to perfectly clean.**

Professional cleaning for homes, Airbnbs, offices, restaurants, and more across DFW.

## Approved CTA Wording

The site does not display a final instant price — pricing is confirmed before service, not shown instantly. CTA copy must reflect that:

- Primary CTA (nav, sticky mobile bar, hero, property selector, starting prices): **"Get My Cleaning Quote"**
- Commercial property types (Restaurant/Office) in the property selector: **"Request a Commercial Quote"**
- Quote form section heading: **"Request Your Quote"**

Do not use "Get Instant Quote," "Pricing appears in seconds," or any wording implying a price is calculated/shown instantly — no such feature exists. Do not change the underlying CTA links or form-submission behavior when updating copy.

## Brand Identity

CleanPerfecto uses a light-first, blue-and-turquoise identity. Deep navy is used mainly for text, the footer, and small contrast areas — never as the main page background.

Base CSS variables (defined in `src/app/globals.css`, adjustable there):

- `--background: #FFFFFF`
- `--background-alt: #F1FAFB`
- `--surface: #FFFFFF`
- `--primary: #58C7C9` (turquoise)
- `--secondary: #3A9EDB` (blue)
- `--foreground: #17233C` (deep navy — text, footer)
- `--muted: #66758A`
- `--border: #DDECEF`

No gold. No black-dominant or dark-space presentation.

**Navbar branding**: compact `BrandLogo` icon (`src/components/brand/BrandLogo.tsx`) + business name text, current nav links, and the quote CTA. Do not squeeze the full stacked logo into the navbar.

**Footer branding**: the full stacked logo image, `public/brand/cleanperfecto-logo-full.png`, rendered via `next/image` on a white rounded background for contrast against the dark footer. Approved alt text: `"CleanPerfecto — Where Clean Meets Perfection"`. The stacked logo already contains the tagline visually — do not also render a separate tagline line, and do not revert the footer to the icon-only `BrandLogo`.

The `BrandLogo` component/icon (minimal "C" formed from a smooth cleaning sweep with one sparkle) remains the mark used everywhere else (navbar, favicon, `src/app/icon.svg`). No circular text, no broom/hand illustration, no tagline inside the mark itself.

## Design Requirements

- Premium and modern

- Spacious Apple-style layout

- Bright, light-first background — see Brand Identity above

- Large, clear typography

- Subtle glass effects

- Smooth but restrained animations

- Prominent "Get My Cleaning Quote" button visible immediately

- Clear service names and descriptions

- One primary hero visual (cinematic video, see above) plus a dedicated below-hero property/service selector — not decorative 3D scenes

- Keep all service controls as clear HTML buttons

- Use lightweight fallbacks for mobile and slower devices

- Provide a reduced-motion experience

- Keep navigation simple and familiar

- Make the website understandable within five seconds

- No cluttered dashboard appearance

- No excessive neon colors

- No gaming-style interface

- No long introduction animation before customers can interact

- Do not sacrifice usability or conversion for visual effects

- Consistent section vertical rhythm — see "Approved Section Spacing" below; do not let two adjacent sections each apply a full/large padding value on their shared edge

## Approved Homepage Section Order (Launch)

1. Video Hero
2. Find the Right Cleaning Service (property + service selector)
3. Trust Indicators
4. How It Works
5. Services
6. Standard vs. Deep Cleaning (service comparison)
7. Starting Prices
8. Property Specializations
9. Service Area
10. Quote Form
11. Footer

**Intentionally deferred** (not on the launch homepage — do not restore without a new decision):

- Before/After transformation gallery
- AI Cleaning Assistant preview

## Approved Section Spacing

The spacing audit corrected excessive/inconsistent whitespace between sections. Preserve these values; do not restore the old padding, and do not make further spacing changes for stylistic preference alone. Only touch Hero or Quote Form spacing if a new, measurable defect is found.

| Section | Mobile | Tablet (`sm:`) | Desktop (`lg:`) |
|---|---|---|---|
| CleaningServiceSelector | `pt-10 pb-8` | `pt-12 pb-10` | `pt-14 pb-12` |
| TrustIndicators (compact band) | `py-10` | `py-12` | `py-14` |
| HowItWorks | `pt-10 pb-8` | `pt-12 pb-10` | `pt-14 pb-12` |
| ServicesGrid | `pt-8 pb-8` | `pt-10 pb-10` | `pt-12 pb-12` |
| ServiceComparison | `pt-10 pb-8` | `pt-12 pb-10` | `pt-14 pb-12` |
| StartingPrices | `pt-10 pb-8` | `pt-12 pb-10` | `pt-14 pb-12` |
| PropertySpecializations | `pt-8 pb-8` | `pt-10 pb-10` | `pt-12 pb-12` |
| ServiceArea (compact band) | `py-10` | `py-12` | `py-14` |

Hero and Quote Form spacing are unchanged from their existing values and are not part of this system.

## Approved Trust Indicators

- Residential & Commercial Cleaning — Homes, Airbnbs, offices, restaurants, and more
- Serving DFW — Local cleaning across North Dallas communities
- 24-Hour Make-It-Right Promise — We return for missed areas included in the agreed scope
- Scope Confirmed Before Service — Your service details and final rate are confirmed in advance

Do not require or restore unverified claims such as "5.0 Average Rating," "Insured & Bonded," "Satisfaction Guarantee," or "Background-Checked Team" — these are not currently substantiated.

## Approved How It Works Wording

1. **Request your quote** — Tell us about your space, service needs, and preferred date.
2. **Confirm your scope and rate** — We confirm the cleaning scope, final rate, and service date.
3. **We clean, you relax** — Our cleaning team completes the agreed cleaning scope.

## Approved Business Offers

- **Launch Month Offer** — Up to 30% Off Your First Cleaning, applies across all cleaning service types. Active through August 31, 2026 at 11:59:59 PM America/Chicago, shown with an accessible countdown near the promotional message and a "$99 minimum service total applies" note. The "Up to" qualifier is required — the $99 minimum can reduce the effective discount on smaller jobs below the advertised percentage.
- **Standard First-Cleaning Offer** — Up to 25% Off Your First Cleaning, applies across all cleaning service types. Takes effect automatically at September 1, 2026 12:00:00 AM America/Chicago and remains active until CleanPerfecto explicitly changes it again. The Launch Month countdown and "Launch Month Special" copy disappear once this offer takes over; the "$99 minimum service total applies" note remains.
- The transition between these two offers is time-based and automatic — it must not require a redeploy. The single source of truth is `getActiveFirstCleaningOffer` in `src/lib/offers/first-cleaning-offer.ts`; do not hardcode `30`, `25`, or the deadline anywhere else, including in the quote calculator, server-side pricing logic, or emails.
- The pure pricing-engine architecture (`src/lib/pricing/`, see "Approved Instant Quote Calculator" below) reuses this offer helper for its own calculations, but it is **not yet wired into the production `QuoteForm`, booking, or payment flow**, and no customer-eligibility service exists yet (see Current Milestone). Do not assume the displayed percentage is applied to any actual quote until that integration is separately approved and implemented.
- Fixed rate — available after the first service
- Save 20% when scheduling 6+ recurring cleanings — applies to the qualifying recurring package itself; it is **not** 20% off the next single cleaning, not a reward earned only after six completed services, and not a replacement for loyalty pricing
- 24-Hour Make-It-Right Promise

## Approved Service Catalog (`src/lib/services.ts`)

**Standard Cleaning** — "Routine maintenance cleaning for spaces that are already regularly maintained."

**Deep Cleaning** — "An intensive, detail-first clean for built-up dirt, grime, and areas that need extra attention." Includes: heavy grease and buildup, baseboards/trim/corners/edges, doors/frames/handles/switches, detailed bathroom surfaces, interior window refresh for up to 5 reachable panes.

- Window wording must stay positively framed: "Interior window refresh for up to 5 reachable panes," with supporting copy "Additional window detailing is available by quote." Never phrase this as "only five panes," "the first five panes," or "not included after five panes."
- Scope note (service comparison section): "Exact scope is confirmed before service. Tracks, screens, exterior glass, and high or unsafe windows require a separate quote."

**Move-In/Move-Out Cleaning** — "A detailed reset for an empty property, ready for its next chapter." Includes: empty-property deep clean, inside closets, detailed cabinet exteriors, move-ready final walkthrough. Inside cabinets/drawers remain a paid add-on (not automatically included); detailed window tracks are available by quote.

**Recurring Cleaning** — included list must read exactly: Flexible scheduling, Consistent cleaning team, **Priority booking**, **Loyalty pricing**. These two are approved, standing recurring-plan perks and must not be removed or swapped out (the "Save 20% on 6+ visits" offer is communicated separately via the hero benefits strip, not by replacing these bullets).

**Add-ons**:

- Priced: Inside Oven ($35), Inside Refrigerator ($35), Inside Cabinets and Drawers (starting at $40), Pet Hair Treatment (starting at $20)
- Available without a published price: Carpet Shampooing, Heavy Organization, additional interior window detailing
- Heavy grease and buildup is part of Deep Cleaning, not an add-on

## Approved Starting Prices

| Property | Standard | Deep |
|---|---|---|
| Studio / 1 Bath Apartment | From $109 | From $169 |
| 1 Bedroom / 1 Bath Apartment | From $129 | From $199 |
| 2 Bedroom / 2 Bath Apartment or Home | From $149 | From $229 |
| 3 Bedroom / 2 Bath Home | From $179 | From $279 |
| 4+ Bedrooms or Large Homes | From $209 | From $329 |
| Move-In / Move-Out Cleaning | From $199 | — |

Disclaimer (must stay attached to these prices): "Starting prices are estimates. Final pricing depends on property size, condition, cleaning type, requested scope, add-ons, and service frequency. Your final rate will be confirmed before service."

## Approved Instant Quote Calculator (Pricing Engine)

A pure, deterministic pricing engine exists at `src/lib/pricing/` (`types.ts`, `config.ts`, `zip-travel.ts`, `supplies-equipment.ts`, `square-footage.ts`, `room-adjustments.ts`, `add-ons.ts`, `discount-program.ts`, `calculate-estimate.ts`), fully unit-tested. It is **not yet wired into the production `QuoteForm`, homepage, or booking flow** — see Current Milestone and Production-Protected Systems. The rules below are the owner-approved calculation rules already implemented; do not re-derive or invent different values elsewhere.

**Condition multipliers** (`CONDITION_MULTIPLIERS` in `src/lib/pricing/config.ts`):

| Condition | Standard | Deep |
|---|---|---|
| Light | 1.00 | 1.00 |
| Moderate | 1.00 | 1.00 |
| Heavy | 1.15 | 1.15 |
| Extensive | Unavailable — Deep Cleaning required | 1.20 |

Move-In/Move-Out Cleaning uses the same condition multipliers as Deep Cleaning.

**Customer-facing estimate ranges** (`RANGE_MULTIPLIERS`), applied to the server-calculated total — never a single exact price:

- Light — up to +5%
- Moderate — up to +7%
- Heavy — up to +10%
- Extensive Deep — up to +15%

Ranges round up to clean $5 increments; the lower bound is never rounded below the actual calculated amount, and never below $99.

**Recurring cleaning pricing** (`RECURRING_MULTIPLIERS`):

- Weekly — 21% lower
- Biweekly — 14% lower
- Monthly — 7% lower

**6+ prepaid recurring package**: an additional 20% discount, applied sequentially *after* recurring-cycle pricing (e.g. weekly: 0.79 × 0.80 = 0.632, a 36.8% effective saving) — never added to the recurring percentage. The first-cleaning offer does not stack with the 6+ prepaid package; on a first visit that is not yet a 6+ prepaid package, the engine applies whichever of the first-cleaning offer or the plain recurring-cycle rate benefits the customer more, never both.

**$99 minimum**: the final price after the first-cleaning offer (or any other applicable discount) can never fall below $99. This is enforced server-side in `calculate-estimate.ts`, not merely display copy.

**Manual-quote add-ons** (no invented dollar amount; preserved on the request for manual follow-up): Carpet Shampooing, Heavy Organization, Additional Interior Window Detailing, Boxing & Packing.

**Unresolved production configuration** — intentionally empty/unconfigured until the owner supplies approved values; the engine returns a typed manual-review result rather than guessing:

- ZIP → travel percentage table (`src/lib/pricing/zip-travel.ts`)
- Supplies/equipment charges by service type × size tier (`src/lib/pricing/supplies-equipment.ts`)
- Square-footage bands and multipliers (`src/lib/pricing/square-footage.ts`)
- Room-adjustment charges — additional bedroom / full-bath / half-bath (`src/lib/pricing/room-adjustments.ts`)

Do not add values to these four until they are separately approved.

## Approved Service Area

Frisco, Plano, Lewisville, Richardson, McKinney, and nearby DFW communities.

Wording: "Serving Frisco, Plano, Lewisville, Richardson, McKinney, and nearby DFW communities. Contact us to confirm availability for your address."

## Future: Advanced 3D Property

An interactive/3D hero was prototyped and removed early in the project for being too weak visually as procedural geometry and too heavy for mobile performance. The current video hero (see above) is the approved launch direction in its place. `three`, `@react-three/fiber`, and `@react-three/drei` are **not** installed.

A future milestone may revisit a 3D hero, but only once:

- A properly licensed (commercial-use verified), premium-quality GLB/GLTF asset has been sourced and approved — preview, source, price, license, polygon count, file size, and format must be shown before anything is downloaded or purchased

- The implementation plan explains why the added dependencies and complexity are justified over the current video hero

Do not add 3D dependencies or components until that plan is approved.

## Technical Rules

- Read the relevant Next.js 16 documentation inside `node_modules/next/dist/docs/` before writing code

- Use Next.js App Router

- Use TypeScript strict mode

- Use Tailwind CSS

- Use React Server Components by default

- Use Client Components only when interaction requires them

- Do not install dependencies without explaining why

- Do not modify unrelated files

- Do not expose secrets to the browser

- Keep components small and reusable

- Use semantic HTML and accessible controls

- Maintain keyboard accessibility

- Provide reduced-motion and mobile fallbacks for animations

- Only the true above-the-fold hero media may use `priority` / `fetchPriority="high"` on `next/image` — all other images, including the below-the-fold property selector photo, must lazy-load normally

- Run lint and production build before declaring work complete

- Do not implement backend functionality during the homepage milestone

## Future Technology Stack

Future milestones may use:

- Supabase PostgreSQL

- Supabase Authentication

- Supabase Storage

- pgvector

- OpenAI Responses API

- Stripe Checkout

- Resend

- Twilio

- Vercel

Do not add these integrations during the current homepage milestone.

## Production-Protected Systems

These are live/working and must not be modified as a side effect of homepage or content work — changes here require an explicit, separate request:

- Quote form submission behavior and `submitQuoteRequest.ts`
- Supabase clients, tables, migrations, and permissions
- Resend configuration and admin/customer notification emails
- Environment variables
- Payment, booking, and pricing-calculator logic (none of this exists yet in the current milestone — do not add it)

## Development Workflow

For each feature:

1. Inspect the existing project

2. Read the relevant Next.js 16 documentation

3. Present an implementation plan

4. Wait for approval

5. Implement only the approved scope

6. Run validation

7. Summarize all changed files

8. Do not create Git commits automatically
