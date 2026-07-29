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

## Design Concept: Interactive Space Transformation

Create a premium Apple-style experience centered around one interactive 3D property.

The main visual should be a floating 3D home that reacts when the customer selects a cleaning service:

- Standard Cleaning — the home becomes fresh, polished, and organized

- Deep Cleaning — detailed areas such as the oven, cabinets, baseboards, bathrooms, and hard-to-reach spaces are highlighted

- Move-In/Move-Out Cleaning — furniture disappears and the empty property is transformed

- Office Cleaning — the home transitions into a professional workspace

- Recurring Cleaning — a subtle calendar cycle appears around the property

Service names must remain clear and immediately understandable.

Do not use literal planets, invented service names, gaming-style navigation, or visuals that make customers guess what each service means.

The interactive property should support the customer journey and demonstrate the result of the cleaning service without distracting from booking.

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

- One primary interactive 3D property instead of multiple decorative 3D scenes

- The property should react to service selection

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

2. Hero section with interactive 3D property

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

## 3D and Animation Rules

The hero property is a real procedurally-built 3D scene using `three`, `@react-three/fiber`, and `@react-three/drei` (approved dependencies for this milestone — see `package.json`).

- Use only one `<Canvas>` on the homepage

- No `OrbitControls` and no free/gaming-style camera interaction — only a fixed professional angle with subtle pointer-based parallax

- No downloaded stock 3D models, textures, images, HDR files, or remote/environment assets — geometry and lighting are built locally (ambient, hemisphere, and directional lights only; no `Environment` presets)

- Keep glass/physical materials restrained: `MeshPhysicalMaterial` only where it meaningfully improves quality (desktop window glass); replace transmission-heavy materials with simple transparent/standard materials on mobile

- Keep important text, buttons, and service controls (real HTML `<button>`s) outside the Canvas

- Lazy-load the 3D experience (`next/dynamic`, `ssr: false`) behind a component that detects missing WebGL or a failed dynamic import and renders the static fallback instead of a blank canvas

- Provide a static, on-brand visual fallback if 3D cannot load

- Reduce complexity on mobile devices (capped `dpr`, reduced/disabled shadows, no transmission materials)

- Respect the user's reduced-motion preference: disable pointer parallax and recurring/continuous animation; service-state transitions become instant

- Prefer `frameloop="demand"` (or equivalent) so the scene only renders on pointer movement, a service-selection change, or an in-progress purposeful transition — not continuously

- Avoid heavy particle effects

- Avoid animations that block clicking or scrolling

- Maintain good performance and readable contrast

- Do not add further 3D or animation dependencies until the implementation plan explains why they are required

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