@[AGENTS.md](http://AGENTS.md)

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

## Design Concept: Responsive Property Imagery

Version 1 (current, launch-ready) uses one primary hero visual: a responsive photograph (`next/image`) of the selected property type, swapped via the Property Type selector — Home, Airbnb, Restaurant, or Office. This replaced the earlier interactive-3D/WebGL hero, which was too weak visually and too heavy for a fast mobile-first launch.

- Property Type selector (Home / Airbnb / Restaurant / Office) controls which photo is shown

- Cleaning Service selector (Standard / Deep / Move-In/Move-Out / Recurring) is kept separate and does not change the hero image — it feeds the quote request

- Service and property-type names must remain clear and immediately understandable

- Do not use literal planets, invented names, gaming-style navigation, or visuals that make customers guess what each option means

- Alt text must change with the selected property type (accessibility, not decorative)

A future milestone may reintroduce an interactive/3D hero (see "Future: Advanced 3D Property" below) once a properly licensed, premium-quality asset is available — do not build that until then.

## Homepage Message

The website should communicate the service within five seconds.

Suggested hero direction:

**From lived-in to perfectly clean.**

Choose your space, customize your cleaning, and book in minutes.

The primary call to action should be:

**Get Instant Quote**

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

The logo (`src/components/brand/BrandLogo.tsx`, plus `public/logo-icon.svg`, `public/logo-horizontal.svg`, `src/app/icon.svg`) is a minimal "C" formed from a smooth cleaning sweep with one sparkle, in the blue/turquoise identity. No circular text, no broom/hand illustration, no tagline inside the mark. Use "Where clean meets perfection" as a separate tagline where appropriate (e.g. footer).

## Design Requirements

- Premium and modern

- Spacious Apple-style layout

- Bright, light-first background — see Brand Identity above

- Large, clear typography

- Subtle glass effects

- Smooth but restrained animations

- Strong mobile experience

- Prominent “Get Instant Quote” button visible immediately

- Clear service names and descriptions

- One primary responsive property image instead of decorative 3D scenes

- The hero image should react to property-type selection

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

## Proposed Homepage Sections

1. Transparent premium navigation

2. Hero section with responsive property imagery

3. Clearly labeled service selector

4. Trust indicators

5. How the cleaning process works

6. Before-and-after transformation section

7. Services and what is included

8. AI assistant preview

9. Customer reviews

10. Service-area information

11. Final instant-quote call to action

12. Professional footer

## Property Visuals (Version 1)

The hero property visual is a set of four locally-hosted, licensed photographs (`public/images/{home,airbnb,restaurant,office}-cleaning.webp`), rendered with `next/image`.

- Use `next/image`, never a raw `<img>`, for the property photo

- Fixed aspect-ratio container so switching property type causes no layout shift

- `object-cover` for consistent framing across the four photos

- A real `sizes` attribute matched to the container's responsive width

- `priority` only on the initial default (Home) image — never on images loaded after user interaction

- Alt text must change with the selected property type

- Keep all selector controls as real HTML `<button>`s outside the image

- One quote CTA in the hero (no duplicates); label switches between "Get Instant Quote" (Home/Airbnb) and "Request a Commercial Quote" (Restaurant/Office)

- A mobile-only sticky bottom CTA linking to `#quote` is allowed, but must hide/step aside whenever the quote form or footer is in view — never cover form controls or footer content

## Future: Advanced 3D Property

An interactive/3D hero was prototyped and removed for Version 1 (too weak visually as procedural geometry, added WebGL/mobile-performance risk, and slowed launch). `three`, `@react-three/fiber`, and `@react-three/drei` are **not** installed in Version 1.

A future milestone may reintroduce a 3D hero, but only once:

- A properly licensed (commercial-use verified), premium-quality GLB/GLTF asset has been sourced and approved — preview, source, price, license, polygon count, file size, and format must be shown before anything is downloaded or purchased

- The implementation plan explains why the added dependencies and complexity are justified over the Version 1 image-based hero

Do not re-add 3D dependencies or components until that plan is approved.

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