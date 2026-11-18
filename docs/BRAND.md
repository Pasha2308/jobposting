# Brand system — Hustler Community Opportunities

This document records the official Hustler Community identity, the assets used by
this product, and the token system shared by the public site and the private admin
workspace. The brand is owned by Hustler Community; no third-party marks, partner
logos or copied brand packs are used anywhere in the product.

## 1. Ownership and official channels

| Item | Value |
| --- | --- |
| Brand | Hustler Community |
| Official LinkedIn page | `https://www.linkedin.com/company/hustlercommunity/home` |
| Product | Hustler Community Opportunities |
| Assets supplied by | Hustler Community (logo PNG and wordmark PNG) |

There is no other website, social account, partner organisation or community
domain presented as official. Do not add partnership, sponsorship, endorsement or
affiliation claims without written approval.

## 2. Official assets

All assets below are derived only from the two official PNG files supplied by
Hustler Community. Nothing is redrawn, recoloured or stretched.

| File | Source | Usage |
| --- | --- | --- |
| `public/brand/logo.png` | Official logo PNG (1254 × 1254) | Master file, archive copy |
| `public/brand/logo-mark.png` | Official logo, cropped square around the mark (no recolouring) | Navbar, footer, admin, favicon source |
| `public/brand/wordmark.png` | Official wordmark PNG (2055 × 765) | Admin sign-in panel, homepage brand panel |
| `public/brand/og-image.png` | Official wordmark centred on the brand black canvas (1200 × 630) | Open Graph and Twitter previews |
| `public/brand/apple-touch-icon.png` | Logo mark, 180 × 180 | iOS home-screen icon |
| `public/favicon-32.png` | Logo mark, 32 × 32 | Browser favicon |
| `public/icon-192.png`, `public/icon-512.png` | Logo mark | Web manifest / installable app |
| `public/site.webmanifest` | Manifest referencing the icons above | Install metadata |

Rules:

- Never redraw, recolour, distort or add effects to the mark or wordmark.
- Keep the supplied proportions. Scale by width and height together; never stretch.
- Keep clear space of at least the height of the mark's inner counter on all sides.
- On dark surfaces the mark is used as supplied; do not invert it.
- The wordmark is preferred for wide lockups; the mark for square/compact slots.
- The black background of the PNGs is part of the asset. Place them on the brand
  black (`#050505`) or a dark surface; do not place them on light cards.
- Any new size must be generated from the master PNG, not from a screenshot.

## 3. Colour tokens

Defined once in `src/styles/global.css` and reused everywhere. Public and admin
share the same tokens — the admin workspace is not a separate design language.

### Core brand

| Token | Value | Meaning |
| --- | --- | --- |
| `--brand` | `#B8FF2E` | Neon green sampled from the official mark |
| `--brand-bright` | `#D6FF7A` | Hover / highlight green |
| `--brand-ink` | `#0A1400` | Deep green-black |
| `--brand-deep` | `#3F6800` | Green that meets contrast on light paper |
| `--ink` | `#050505` | Brand black (page background) |
| `--ink-2` | `#080A05` | Near-black surface |
| `--surface` | `#0B0E07` | Card surface |
| `--surface-2` | `#10140B` | Raised surface |
| `--surface-3` | `#161C0E` | Highest surface |
| `--paper` | `#F6F3EE` | Warm paper for light sections |
| `--paper-2` | `#ECE7DF` | Secondary paper |

### Text

| Token | Value |
| --- | --- |
| `--text` | `#F5F2EC` |
| `--text-dim` | `#C3C8C4` |
| `--muted` | `#9AA392` |
| `--muted-2` | `#6F7768` |
| `--line` | `rgba(245, 242, 236, 0.10)` |
| `--line-strong` | `rgba(245, 242, 236, 0.18)` |

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

- Neon green is the single brand accent: primary actions, links, focus rings and
  selected states. It is never used as a large background fill.
- On `--paper` sections use `--brand-deep`, not `--brand`, so text keeps AA contrast.
- Gradients are used sparingly (hero atmosphere only). No glassmorphism cards,
  no decorative blobs behind content.
- Borders carry structure (`--line`), not heavy shadows.

## 4. Typography

| Token | Value |
| --- | --- |
| `--font-sans` | `'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` |
| `--font-mono` | `ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Roboto Mono', Menlo, monospace` |

Space Grotesk is loaded from Google Fonts with the weights 300–700. Monospace is
used only for timestamps, IDs, counts and audit metadata.

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
| `--fs-hero` | `clamp(2.7rem, 6.1vw, 5.15rem)` | Homepage headline |

Headings use tight tracking and 1.02–1.15 line-height; body copy uses 1.6–1.7.

## 5. Spacing, radius, elevation

- Spacing scale: `--s-1` … `--s-24` (4px → 96px), 4px base.
- Radii are restrained: 4/7/11/16/22px and a pill. Cards are not overly round.
- Shadows are subtle and directional:
  - `--shadow-sm`, `--shadow-md`, `--shadow-lg`
  - `--shadow-brand` only under the single primary CTA.
- `--ease: cubic-bezier(0.16, 1, 0.3, 1)` for all transitions.
- Container width `--container: 1220px`, header height `--header-height: 74px`.

## 6. Components and motifs

- **Eyebrow** (`eyebrow--accent`): short uppercase label above a heading, used to
  structure pages without generic card grids.
- **Opportunity card**: title, company, location chips, salary/experience
  metadata, verification badge, source-vs-verified distinction, single primary
  action. Missing data renders as "Not specified" rather than blank space.
- **Apply panel**: lists every real application route (external URL, email,
  LinkedIn post, careers page) with the source clearly attributed.
- **Admin shell**: sidebar + top bar, same tokens, denser type scale, tables and
  status badges. No separate colour scheme. The sidebar uses the official mark
  plus a text lockup because the wide wordmark is unreadable at sidebar size.
- **Icons**: one 24px / 1.6-stroke set in `src/components/Icon.astro`, with names
  in `src/lib/domain/icons.ts`.

## 7. Voice

- Direct, builder-to-builder. Short sentences. No recruiter jargon.
- Promise: **"Discover opportunities. Connect with builders. Start building."**
- Homepage headline: **"Find Your Next Opportunity. Start Building."**
- Brand line from the official wordmark: **"BUILD. SHIP. GET REAL."**
- Never overstate: listings distinguish source-supplied facts from
  admin-verified information, and missing fields say "Not specified".
- No fake urgency ("posted today" from discovery timestamps is forbidden), no
  invented salaries, no invented contact details.
- Never claim a partnership, sponsorship or endorsement that has not been approved.

## 8. Accessibility

- Text/background pairs meet WCAG AA contrast on the dark surfaces.
- Focus states use a visible green ring and are never removed.
- Status is conveyed by label + colour, not colour alone.
- Touch targets are at least 40px on mobile; primary actions stay reachable.
- Motion respects `prefers-reduced-motion` for non-essential transitions.
- Forms use explicit `<label>` elements and server-side error messages tied to
  the field, not colour-only validation.
- The site remains usable with JavaScript disabled: filters, search, sharing
  links and application routes are plain links/GET forms.
