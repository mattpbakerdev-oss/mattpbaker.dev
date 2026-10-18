# mattpbaker.dev design upgrade

Two references, merged into one system.

**Reference A (David Rios, dark).** A warm near-black hero: copy on the left, a hairline-framed stage photo on the right, a centred serif wordmark, pill buttons, four stats along the bottom. Its power is one warm light on one person, and everything else staying quiet.

**Reference B (Shraddha, light).** A component kit with personality: a floating pill nav whose active item is underlined in amber, lowercase section titles ending in an amber full stop, a strip of tilted photos with handwritten captions, project cards with tech pills and a giant ghost numeral, photo cards with a dark gradient and white text, and a cloud of coloured pills for the tech stack. Footer: "Built with React by Shraddha".

The merge: A's atmosphere and hero, B's components, rendered in A's dark palette with B's amber as the single accent. The amber works on the dark page because it reads as the same firelight as the red glow.

## 1. Token system

### Colour

Dark only. The current light theme goes.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#120F0F` | Page. Warm black so the glow blends |
| `--bg-raised` | `#1C1717` | Project cards, nav pill, stack pills (default tone) |
| `--bg-raised-2` | `#262020` | Tech pills inside project cards, hover state |
| `--glow` | `#6B1A1A` | The light. One radial gradient behind the hero photo only |
| `--accent` | `#E0A94A` | Amber. The section-title full stop, the nav underline, the card arrow, one pill tone in the stack cloud. Nowhere else |
| `--ink` | `#F5F1EE` | Headlines, primary text |
| `--ink-2` | `#B8AFAC` | Body copy, labels |
| `--line` | `rgba(245,241,238,0.14)` | Hairline frames and button borders |
| `--paper` | `#F5F1EE` | Polaroid frames only. The one light surface on the page |

### Type

| Role | Face | Setting |
|---|---|---|
| Headline and section titles | Onest, 600 | Hero `clamp(3rem, 7.5vw, 6.5rem)`, line-height 1.0, tracking -0.03em. Section titles lowercase, `clamp(2.5rem, 5vw, 4.5rem)`, 400 weight, followed by an amber full stop |
| Body and UI | Onest, 400 and 500 | 17px / 1.6 body, 15px nav and pills, sentence case |
| Stat numbers and ghost figures | Onest, 500 | Stats `clamp(2rem, 3.5vw, 2.75rem)` tabular. Ghost figures 11rem at 6% white, clipped by the card |
| Wordmark | Instrument Serif, 400 | "Matt Baker", 1.35rem. The only serif |
| Polaroid captions | Caveat, 500 | 1.1rem, `--ink` on paper, slight rotation inherited from the frame |

All on Google Fonts. Archivo, Manrope, JetBrains Mono retired, along with the mono all-caps eyebrows.

## 2. Page structure

```
┌───────────────────────────────────────────────────────────────┐
│ Matt Baker      ( Work   Stack   About   How I work )   ( Email me ) │  sticky pill nav, active item underlined amber
│                                                               │
│  Build the thing,             ┌──────────────────────────┐    │  HERO (ref A)
│  measure what                 │        portrait          │    │  glow radial from frame's top-right
│  happened                     │   warm key light, dark   │    │
│                               │                          │    │
│  I spec products, build them  │   Matt Baker             │    │
│  with AI coding agents, and   │   Product builder        │    │
│  publish the numbers.         └──────────────────────────┘    │
│  ( See the work ↗ )                                           │
│                                                               │
│  79.6 → 98.0       3            2            1                │  stats row
│  listing score     products     languages    app on the       │
│  before / after    shipped      in the AI    App Store        │
│                    in 2026      rewrite                       │
├───────────────────────────────────────────────────────────────┤
│  work.                                                        │  PROJECT CARDS (ref B)
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐  │
│  │ Listing Check ↗ │ │ Up Lock       ↗ │ │ UGC shorts    ↗ │  │  title + amber arrow
│  │                 │ │                 │ │                 │  │
│  │ two-sentence    │ │ two-sentence    │ │ two-sentence    │  │  outcome copy
│  │ outcome         │ │ outcome         │ │ outcome         │  │
│  │                 │ │                 │ │                 │  │
│  │ (Next.js)(Supa) │ │ (Swift)(Vision) │ │ (Python)(ffmpeg)│  │  tech pills
│  │          98.0   │ │             1   │ │           ×12   │  │  ghost figure = the project's number
│  └─────────────────┘ └─────────────────┘ └─────────────────┘  │
├───────────────────────────────────────────────────────────────┤
│  stack.                                                       │  PILL CLOUD (ref B)
│      (Claude Code) (Swift) (Next.js) (Supabase)               │  three tones: raised, amber, outlined
│   (Python) (Vercel) (ffmpeg) (TypeScript) (Postgres)          │  slight random rotation, wraps freely
├───────────────────────────────────────────────────────────────┤
│  about.                                                       │  POLAROID STRIP (ref B)
│   ╱‾‾‾‾‾‾‾‾╲   ┌──────────┐   ╱‾‾‾‾‾‾‾‾╲                      │  three paper frames, -4° / 0° / +3°
│   │ Bristol │   │ the desk │   │ Bangkok  │                   │  centre one lifted, handwritten captions
│   ╲________╱   └──────────┘   ╲________╱                      │
│  Three lines of prose: degree, the move, what I'm looking for │
├───────────────────────────────────────────────────────────────┤
│  how I work.                                                  │  prose, 60ch, left aligned
│  One-page spec → Claude Code builds → build log of failures   │
├───────────────────────────────────────────────────────────────┤
│  mattpbakerdev@gmail.com   GitHub        Built with Claude Code by Matt │
└───────────────────────────────────────────────────────────────┘
```

Everything left-aligned except the nav pill (centred) and the polaroid strip (centred, because tilt reads as placed rather than laid out).

### Component notes

**Nav.** Wordmark left, pill centre with the four section links, "Email me" outlined pill right. Pill background `--bg-raised`, 48px tall, hairline border. Active item gets a 2px amber underline 6px below the text, driven by a small IntersectionObserver scroll-spy. On phones the wordmark and Email me stay, and the centre pill scrolls horizontally with its overflow hidden by fade masks; no hamburger menu.

**Hero.** As reference A. Frame 4:5, 24px radius, hairline border, portrait fills it, name and role overlaid at the bottom inside a soft fade. Primary button "See the work" is a pill with the arrow in a small disc. Stats row: four columns, two-by-two under 720px.

**Project cards.** Background `--bg-raised`, 20px radius, no border, no shadow. Title top-left, amber arrow top-right, the arrow is the whole card's link affordance. Outcome copy is two sentences with the measured result in the second. Tech pills in `--bg-raised-2`, 13px. Ghost figure bottom-right, clipped by `overflow: hidden`: Reference B uses 1, 2, 3, which numbers a list that is not a sequence. Here each card's ghost figure is its own headline number, so the decoration is the data. Fallback to 1, 2, 3 if a project has no clean figure.

**Stack cloud.** Flex-wrap, centred within a 720px measure. Each pill rotates between -6° and 6° (set per pill in CSS, not random at runtime, so it is stable). Three tones only: `--bg-raised` with `--ink` text, amber with `--bg` text, and outlined. Roughly 60/20/20. Hover does nothing; this is not a filter.

**Polaroid strip.** Three paper frames: 12px padding, 28px bottom padding for the caption, 6px radius, soft shadow `0 20px 50px rgba(0,0,0,0.5)`. Rotations -4°, 0°, +3°, centre one translated up 16px and on top. Captions in Caveat. On phones they stack with the rotations halved. This is the one place paper, shadow and handwriting appear, which is why it carries personality instead of looking like the SaaS kit.

**Photo cards (ref B's education cards).** Available but not used by default. You have one degree, so a three-card education section would be padding. If you want them, the honest use is two cards under About: "Bristol" (University of Bristol, BSc) and "Bangkok" (relocating 2026), photo with gradient and white text. Say so and I'll add them.

**Footer.** Email, GitHub, and "Built with Claude Code by Matt". It is true, it is your pitch, and it is the one line of the page that is allowed to be a bit pleased with itself.

### Principles

1. One light, one person. The glow and the portrait are the memorable thing.
2. One accent, four uses. Amber appears only as the title full stop, the nav underline, the card arrow, and one pill tone.
3. Numbers are measured. Stats and ghost figures come from build logs, never vanity.
4. Two surfaces. Raised dark panels for UI, paper only for polaroids. Nothing else is boxed.
5. One motion. On load the glow brightens and the portrait fades in over 900ms. The nav underline slides between items on scroll. Nothing else moves unprompted; reduced motion disables both.

## 3. Copy

Headline (pick one):
- **Build the thing, measure what happened** (recommended)
- Spec it. Ship it. Count it.

Lede: "I spec products, build them with AI coding agents, and publish what the numbers did afterwards. Business graduate from Bristol, relocating to Bangkok."

Section titles: work. stack. about. how I work.

Stats (confirm):

| Number | Label |
|---|---|
| 79.6 → 98.0 | Listing quality score before and after Listing Check |
| 3 | Products shipped in 2026 |
| 2 | Languages in the guarded AI rewrite |
| 1 | iOS app live on the App Store |

Project card ghost figures: Listing Check **98.0**, Up Lock **1** (App Store), UGC pipeline: a count you have, such as shorts produced or hours saved. If none, **3**.

Stack pills (confirm, add, remove): Claude Code, Next.js, TypeScript, Supabase, Vercel, Swift, Vision framework, Python, ffmpeg, Postgres, Git.

Polaroid captions, handwritten: "Bristol, where the degree happened", "the desk, where the specs happen", "Bangkok, next".

## 4. Review against the generic defaults

- **Dark page with one acid accent.** Amber is the accent, but it is warm and shares a family with the glow, so the page reads as lit rather than branded. Four uses only.
- **Big number, small label.** Kept because both references and you asked for it; made honest with measured figures.
- **Numbered markers on non-sequential content.** Reference B's 1 2 3 replaced with each project's own figure.
- **Identical rounded cards with soft shadows.** Project cards have no shadow and no border. Shadow exists only under the polaroids, where it depicts a physical object.
- **Mono all-caps eyebrows, meta strings with middle dots.** Removed from the current site. The tech pills replace the "Web tool · 2026" line.
- **A coloured single word in the headline.** Not done. The amber full stop is on section titles only, and it is punctuation, not a highlighted word.
- **Fade-and-slide on every section.** One hero load sequence plus the functional nav underline.
- **Multi-colour pill cloud.** Reference B uses five colours. Reduced to three tones so the stack reads as one object.

## 5. What I need from you

1. **A portrait** for the hero: dark or plain backdrop, one warm light from the side, shoulders up, 4:5, at least 1600px tall. If none exists, the frame holds a Listing Check screenshot and the hero becomes a product hero; the polaroids then carry the personal side.
2. **Three casual photos** for the polaroids: Bristol, your desk or workspace, Bangkok. Phone photos are right for this.
3. **Confirmation of stats, ghost figures and stack pills**, or replacements.
4. **Headline pick.**
5. Whether you want the optional Bristol / Bangkok photo cards.

## 6. Build sequence

Each step is one commit; the GitHub connection deploys it.

1. Tokens, fonts, dark-only base. Remove the light theme and `data-theme` hooks.
2. Nav: wordmark, centred pill, Email me, scroll-spy underline, mobile overflow behaviour.
3. Hero: split layout, glow, framed portrait with overlay, pill button, stats row.
4. Work: three project cards with pills, arrows, ghost figures.
5. Stack: pill cloud with fixed per-pill rotations and three tones.
6. About: polaroid strip with captions, prose. How I work prose. Footer.
7. Mobile pass at 390px and 768px.
8. Polish: focus rings on dark, reduced motion, OG image 1200x630 from the hero, contrast check.
9. Verify at mattpbaker.dev after the auto-deploy.

Placeholders are fine for every image; each has a fixed aspect box so swapping in the real file changes nothing else.

Out of scope: `propertyscout/index.html` keeps its current design while that application is live.
