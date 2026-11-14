# Brand system — Hustler Community Opportunities

This document records the **real** Hustler Community brand as found in the live
references, how the official assets are used, and the token system shared by the
public site and the private admin workspace. Nothing here is invented: colours,
type and logo are taken from the published brand.

## 1. References

| Reference | What was used |
| --- | --- |
| `https://hustlerscommunity.in/` | Published site CSS (colour variables, font family), logo and community artwork downloaded from the site |
| Hustler Community LinkedIn company page | Voice, positioning language and audience ("builders", "founders", "hustlers") |
| `https://github.com/Pasha2308/jobposting` | Delivery repository for this product |

The site's own CSS exposes the palette and typography below. The logo assets in
`public/brand/` are the official files, used unmodified apart from a cropped
`viewBox` on the mark so it can sit on a dark header without extra whitespace.

## 2. Official assets

| File | Origin | Usage |
| --- | --- | --- |
| `public/brand/h-mark.svg` | Downloaded image export of the official mark, wrapped in SVG with a cropped `viewBox` | Favicon, admin/product mark, compact lockups |
| `public/brand/wordmark.png` | Official wordmark export (4000 × 1500) | Admin sign-in panel, social/OG fallback image |
| `public/brand/community-art.webp` | Official community artwork from the live site | Editorial/homepage imagery where a photographic/illustrative cue is needed |

Rules:

- Never redraw, recolour, distort or add effects to the mark or wordmark.
- Keep clear space of at least the height of the mark's inner counter on all sides.
- On dark surfaces the mark is used as supplied; do not invert it.
- The wordmark is preferred for wide lockups, the mark for square/compact slots.
- `brand-assets/h-mark.png` is a local research file and is gitignored; only the
  shipped assets under `public/brand/` belong in the repository.

## 3. Colour tokens

Defined once in `src/styles/global.css` and reused everywhere. Public and admin
share the same tokens — the admin workspace is not a separate design language.

### Core brand

| Token | Value | Meaning |
| --- | --- | --- |
| `--teal` | `#1D4E53` | Primary brand teal from the live site |
| `--teal-bright` | `#2A7A82` | Interactive/hover teal |
| `--teal-ink` | `#123B3F` | Deep teal for borders and dark fills |
| `--orange` | `#FF6427` | Primary action / highlight orange |
| `--orange-soft` | `#FF8555` | Hover orange |
| `--orange-ink` | `#2B0D02` | Text on orange |
| `--ink` | `#050505` | Near-black page background |
| `--white` | `#FFFFFF` | Pure white |
| `--paper` | `#F6F3EE` | Warm paper for light sections |
| `--paper-2` | `#ECE7DF` | Secondary paper |

### Surfaces and text (dark UI)

| Token | Value |
| --- | --- |
| `--ink-2` | `#090B0B` |
| `--surface` | `#0E1212` |
| `--surface-2` | `#131918` |
| `--surface-3` | `#18201F` |
| `--text` | `#F5F2EC` |
| `--text-dim` | `#C3C8C4` |
| `--muted` | `#98A29E` |
| `--muted-2` | `#6D7773` |
| `--line` | `rgba(245,242,236,0.10)` |
| `--line-strong` | `rgba(245,242,236,0.18)` |

### Semantic

| Token | Value | Use |
| --- | --- | --- |
| `--success` | `#67C58B` | Published, resolved, verified |
| `--warning` | `#E9B872` | Pending review, needs verification, warnings |
| `--danger` | `#FF7B6B` | Rejected, destructive actions, errors |
| `--info` | `#84B6D8` | Informational badges and metadata |

Each semantic colour has a paired `*-bg` token at 12% alpha for badge and alert
fills. Status badges are colour + label, never colour alone.

### Usage discipline

- Orange is reserved for the single most important action on a screen.
- Teal is the brand/identity colour: links, focus rings, selected states.
- Gradients are used sparingly (hero atmosphere only). No glassmorphism cards,
  no neon glows, no decorative blobs behind content.
- Borders carry structure (`--line`), not heavy shadows.

## 4. Typography

| Token | Value |
| --- | --- |
| `--font-sans` | `'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-mono` | `ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Roboto Mono', Menlo, monospace` |

Space Grotesk is loaded from Google Fonts with the weights 300–700 and is the
same family used on the live Hustler Community site. Monospace is used only for
timestamps, IDs, counts and audit metadata.

Type scale (fluid where useful):

| Token | Size | Role |
| --- | --- | --- |
| `--fs-xs` | `0.75rem` | Eyebrows, badges, legal microcopy |
| `--fs-sm` | `0.8125rem` | Table text, metadata |
| `--fs-base` | `0.9375rem` | Body |
| `--fs-md` | `1.0625rem` | Lede |
| `--fs-lg` | `1.25rem` | Card titles |
| `--fs-xl` | `1.5rem` | Section subheads |
| `--fs-2xl` | `clamp(1.75rem, 3vw, 2.35rem)` | Section headings |
| `--fs-3xl` | `clamp(2.15rem, 4vw, 3.1rem)` | Page titles |
| `--fs-hero` | `clamp(2.7rem, 6.1vw, 5.35rem)` | Homepage headline |

Headings use tight tracking and 1.02–1.15 line-height; body copy uses 1.6–1.7.

## 5. Spacing, radius, elevation

- Spacing scale: `--s-1` … `--s-24` (4px → 96px), 4px base.
- Radii are restrained: 4/7/11/16/22px and a pill. Cards are not overly round.
- Shadows are subtle and directional:
  - `--shadow-sm`, `--shadow-md`, `--shadow-lg`
  - `--shadow-orange` only under the single primary CTA.
- `--ease: cubic-bezier(0.16, 1, 0.3, 1)` for all transitions.
- Container width `--container: 1220px`, header height `--header-height: 74px`.

## 6. Components and motifs

- **Eyebrow** (`eyebrow--orange` / default teal): short uppercase label above a
  heading, used to structure pages without generic card grids.
- **Opportunity card**: title, company, location chips, salary/experience
  metadata, verification badge, source-vs-verified distinction, single primary
  action. Missing data renders as "Not specified" rather than blank space.
- **Apply panel**: lists every real application route (external URL, email,
  LinkedIn post, careers page) with the source clearly attributed.
- **Admin shell**: sidebar + top bar, same tokens, denser type scale, tables and
  status badges. No separate colour scheme.
- **Icons**: one 24px / 1.6-stroke set in `src/components/Icon.astro`, with names
  in `src/lib/domain/icons.ts`.

## 7. Voice

- Direct, builder-to-builder. Short sentences. No recruiter jargon.
- Promise: **"Discover opportunities. Connect with builders. Start building."**
- Homepage headline: **"Find Your Next Opportunity. Start Building."**
- Never overstate: listings distinguish source-supplied facts from
  admin-verified information, and missing fields say "Not specified".
- No fake urgency ("posted today" from discovery timestamps is forbidden), no
  invented salaries, no invented contact details.

## 8. Accessibility

- Text/background pairs meet WCAG AA contrast on the dark surfaces.
- Focus states use a visible teal ring and are never removed.
- Status is conveyed by label + colour, not colour alone.
- Touch targets are at least 40px on mobile; primary actions stay reachable.
- Motion respects `prefers-reduced-motion` for non-essential transitions.
- Forms use explicit `<label>` elements and server-side error messages tied to
  the field, not colour-only validation.
- The site remains usable with JavaScript disabled: filters, search, sharing
  links and application routes are plain links/GET forms.
