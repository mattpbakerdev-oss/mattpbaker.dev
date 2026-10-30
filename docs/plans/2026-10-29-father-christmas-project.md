# Add Father Christmas Video to mattpbaker.dev

Goal: show Father Christmas Video as the fourth project, presented exactly like the other three: a home card that links to an evidence page on this site, with the outbound link on that page.

## What the project is (sourced)

Sources: the Cornelius card (`registry/cards/father-christmas-video.md`), the repo's `PRODUCT.md`, `BUILD_LOG.md`, `docs/plans/`, and a fresh `npm test` run on 29 Oct.

- A one-off personalised video from a British Father Christmas in a green robe, written for one child by name: friends, three good things from the year, one wish. Never promises a present.
- Two styles: Animated £4.99, Painted £7.99. Paid once, no accounts, no photos, first names only, deleted after Christmas. Printable Nice List certificate.
- Pipeline: Claude Haiku 5.5 writes the script and judges it, ElevenLabs voices it, fal Boreal lip-syncs it, ffmpeg joins the parts, Stripe takes payment, Resend emails the link.
- Live at fatherchristmas.io, in Stripe **test mode**. Launch target mid-November.

## Numbers available

| Figure | Source | Use |
|---|---|---|
| 882 tests passing (884 total, 0 failing) | `npm test`, 29 Oct | Stat and card |
| About $0.60 per video to render, sold at £4.99 or £7.99 | Card, 28 Oct plan | Stat: unit economics |
| Delivered 5 to 12 minutes after payment | Card, live test orders | Stat |
| 44 commits, scaffold 26 Oct to chained parts 28 Oct | git log | "Built in three days" line |
| Kling Avatar cost about $3.37 a video, too high | Card | Story: cost drove the model choice |

No customer or revenue numbers exist yet, because it has not launched. The page should say so plainly rather than imply sales.

## What the AI got wrong (sourced stories)

1. **Regex rules could not guard the script.** Two review rounds of pattern rules failed both ways: they flagged ordinary praise like "Brave" and missed invented names and present promises worded a new way. Fix: a deterministic checker as a backstop, plus a Haiku judge for invented people and gift promises at about £0.0002 a script. (BUILD_LOG.md)
2. **The first live Animated order rendered but never arrived.** fal lip-synced all seven parts, then the ffmpeg join on Vercel hit the 300 s timeout and, on retry, ran out of memory. Fix: join part by part with ffmpeg capped at two threads; the second live order was delivered end to end. (Card, commit 3aa671d)
3. **The cheap lip-sync could not find a cartoon face.** LatentSync could not reliably detect the painted Father Christmas, and a semi-realistic 3D still that it could detect had lip-sync you judged terrible. Fix: both styles moved to fal Boreal at about $0.60 a video. (Card)
4. Optional fourth: **a provider blip after payment would have stranded a parent who paid.** Orders now stay `paid` with an error code and retry up to three times; a fal request is never resubmitted. (BUILD_LOG.md)

## Changes

### 1. New evidence page: `work/father-christmas/index.html`

Same template, sections and eyebrows as the other three work pages, using `work/work.css`.

- **Title and lede:** what it is and who it is for, plus one honest status line: "Live in test mode; launching for Christmas 2026."
- **See it:** the two real sample videos side by side, Animated and Painted, each with its poster. Both are 640x800 and about 2.3 to 2.5 MB, self-hosted under `/video/`. The Animated sample has a captions file, which goes in as a `<track>`. Both are made for "Isla, a made-up child", which the caption says.
- **What was measured:** a stat row of tests, cost per video against price, and delivery time, with a short line that it has no sales yet.
- **What the AI got wrong:** stories 1 to 3 above, optionally 4.
- **Links:** the live site, and a note that the repository is private. See decision B.
- **Meta:** title "Father Christmas Video · Matt Baker", description, OG title and description, and the repo's own `public/og.png` copied in as its OG image.
- Add it to the work-page nav pill on all four work pages.

### 2. Home page

- **Fourth card.** Title, a two-sentence outcome ending on the proof, tech pills (Next.js, Claude, ElevenLabs, fal, Stripe), ghost figure "882", internal arrow, linking to `/work/father-christmas`. See decision A for the grid.
- **Stack cloud:** add ElevenLabs, fal and Stripe.
- **Stats row:** leave as it is. The four tiles are all measured outcomes already.

### 3. Mattsville grotto (`play/js/places.js`)

Its copy predates the last three days and is now wrong in four places: it says 555 tests, £7, a free preview of the child's name, and "It isn't live yet". Update it to 882 tests, the two prices, the sample video in place of the preview, and the test-mode status. Swap its sample video for the newer Animated render, and add a link to the evidence page.

### 4. Application page

No change. It is tailored to the PropertyScout role and frozen while that application is open.

### 5. Checks

At 375 and 1280: no horizontal scroll, both samples play with posters showing, captions work, no console errors, every link returns 200, video files under 3 MB. Then commit, push, and confirm the page, both videos and the OG image return 200 live.

## Decisions for you

- **A. Home grid with four cards.** Three columns leave the fourth card alone on a second row. Recommended: two columns on desktop, a 2x2 grid, which also gives each card more room. Alternative: four narrow columns.
- **B. Link to fatherchristmas.io while it is in test mode?** A visitor can reach checkout, but no real card will work. Recommended: link it with the label "See the live site (test mode)" until you switch Stripe to live, then drop the label. Alternative: no outbound link until launch.
- **C. Card order.** Recommended: Father Christmas second, after Listing Check, since it is the most recent and the most consumer-facing. Alternative: last.
- **D. The fourth story** about paid-order recovery: include it or keep the page to three.

## Effort

One session. The page is a copy of an existing template with new content, and the assets already exist in the project repo.
