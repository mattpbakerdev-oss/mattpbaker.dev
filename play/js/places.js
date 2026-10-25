// DATA: every place in Mattsville. Adding a project means adding one object here.
// position is the building centre; rotation turns the door (local +z) to face its road.
// footprint is [width, depth] of the plot the model fills. Copy comes from /work/* pages.

export const KINDS = ['project', 'about', 'contact', 'soon'];
export const RING_RADIUS = 3.5;
const RING_GAP = 3.5; // from the front wall to the ring centre

const EAST = Math.PI / 2, WEST = -Math.PI / 2, NORTH = Math.PI, SOUTH = 0;

export const PLACES = [
  {
    id: 'up-lock',
    kind: 'project',
    model: 'gym',
    position: [40, -18.5], rotation: SOUTH, footprint: [16, 12],
    title: 'Up Lock',
    tagline: 'An iPhone app that blocks distracting apps until you do a set of push-ups, squats or jumping jacks.',
    body: [
      'The camera counts reps on the phone itself and a finished set unlocks the app for a timed window, with daily limits, streaks, stats and a subscription. Apple’s pose model gives you joints, not exercises, so the first version counted waving. Every anti-cheat rule now has a test named for the thing it stops.',
    ],
    stats: [
      { value: '~145', label: 'tests, each anti-cheat rule with one of its own' },
      { value: '10,000', label: 'views in the first week, from four TikTok posts a day' },
    ],
    media: [1, 2, 3, 4].map((n) => ({ type: 'image', src: `/work/up-lock/img/0${n}.jpg`, alt: `Up Lock App Store screen ${n}` })),
    tech: ['Swift', 'Vision', 'Screen Time API'],
    links: [
      { label: 'Live on the App Store', href: 'https://apps.apple.com/app/id6784176155' },
      { label: 'Read the full write-up', href: '/work/up-lock' },
    ],
  },
  {
    id: 'listing-check',
    kind: 'project',
    model: 'condo',
    position: [-18.5, -40], rotation: EAST, footprint: [18, 12],
    title: 'Listing Check',
    tagline: 'A pre-publish checker for Bangkok rental agents.',
    body: [
      'Paste a draft listing and it scores completeness out of 100 with per-field fixes, benchmarks the rent per square metre against comparable listings, and offers an AI rewrite in English and Thai that may only use facts from the draft. Built in about 12 to 16 hours from a one-page spec, with the build log kept from the first commit.',
    ],
    stats: [
      { value: '79.6 → 98.0', label: 'mean score of the flagged listings, before and after the fixes' },
      { value: '0 of 55', label: 'rewrites that added a fact not in the draft' },
      { value: '274', label: 'tests' },
    ],
    media: [
      { type: 'video', src: '/video/listing-check-walkthrough.mp4', poster: '/video/listing-check-poster.jpg', alt: 'Listing Check walkthrough' },
    ],
    tech: ['Next.js', 'TypeScript', 'Supabase', 'Vercel'],
    links: [
      { label: 'Try it live', href: 'https://listing-check.mattpbaker.dev' },
      { label: 'Source on GitHub', href: 'https://github.com/mattpbakerdev-oss/listing-check' },
      { label: 'Build log', href: 'https://github.com/mattpbakerdev-oss/listing-check/blob/main/BUILD_LOG.md' },
      { label: 'Read the full write-up', href: '/work/listing-check' },
    ],
  },
  {
    id: 'ugc-pipeline',
    kind: 'project',
    model: 'studio',
    position: [-51.5, 40], rotation: WEST, footprint: [16, 12],
    title: 'UGC pipeline',
    tagline: 'Talking-head takes in, finished videos out.',
    body: [
      'I’m paid to make short videos promoting a social media scheduler, and editing each one by hand didn’t scale. You write a small storyboard per video, “when I say this phrase, show this number, play this sound”, and the rest is automatic: silence trimmed, colour corrected, captioned from Whisper word timings, titles and graphics placed around the face.',
    ],
    stats: [
      { value: '27', label: 'videos live across TikTok, Reels, Shorts and Facebook in the first three weeks' },
      { value: '~26,000', label: 'views in those three weeks' },
    ],
    // Show the thumbnail first; only swap in the youtube-nocookie embed on click.
    media: [
      { type: 'youtube', id: 'S4q-Ie9Scps', alt: 'UGC pipeline video, YouTube Short 1' },
      { type: 'youtube', id: 'p9sebfN-z20', alt: 'UGC pipeline video, YouTube Short 2' },
    ],
    tech: ['TypeScript', 'Remotion', 'whisper.cpp', 'Python', 'ffmpeg'],
    links: [
      { label: 'Source on GitHub', href: 'https://github.com/mattpbakerdev-oss/ugc-shorts-pipeline' },
      { label: 'Watch on TikTok', href: 'https://www.tiktok.com/@postizwithmatt/video/7694395558743510274' },
      { label: 'Read the full write-up', href: '/work/ugc-pipeline' },
    ],
  },
  {
    id: 'house',
    kind: 'about',
    model: 'house',
    position: [24, 17], rotation: NORTH, footprint: [10, 9],
    title: 'Matt’s house',
    body: [
      'First Class Business graduate from UWE Bristol, relocating to Bangkok. I came to building from the product side: three years running a 14-person student company, two years on a shop floor measured weekly on sales, and the habit of asking people what they need before building anything. Then AI coding agents meant I could ship it myself.',
      'I write a one-page spec first, Claude Code builds, I review every plan before it runs, and every build keeps a public log of what the AI got wrong.',
    ],
    media: [
      { type: 'image', src: '/img/about/bangkok.jpg', alt: 'Bangkok skyline' },
      { type: 'image', src: '/img/about/spec.jpg', alt: 'The Listing Check spec, printed' },
    ],
    links: [{ label: 'The full site', href: '/' }],
  },
  {
    id: 'post-office',
    kind: 'contact',
    model: 'post-office',
    position: [48, 16.5], rotation: NORTH, footprint: [10, 8],
    title: 'Post office',
    body: ['Looking for a product role, or want something built? Drop me a line.'],
    links: [
      { label: 'Email me', href: 'mailto:mattpbakerdev@gmail.com' },
      { label: 'GitHub', href: 'https://github.com/mattpbakerdev-oss' },
    ],
    // Gaps for Matt: render nothing until filled.
    cv: null,
    social: [],
  },
  ...[-45, -20, 5].map((x, i) => ({
    id: `site-${i + 1}`,
    kind: 'soon',
    model: 'site',
    position: [x, 89.5], rotation: NORTH, footprint: [18, 14],
    title: 'Building site',
  })),
];

/** Axis-aligned rect { x, z, w, d } the building covers, after rotation. */
export function footprintRect(place) {
  const [w, d] = place.footprint;
  const c = Math.abs(Math.cos(place.rotation)), s = Math.abs(Math.sin(place.rotation));
  return { x: place.position[0], z: place.position[1], w: w * c + d * s, d: w * s + d * c };
}

/** Centre of the amber ring, just outside the door. */
export function ringCentre(place) {
  const out = place.footprint[1] / 2 + RING_GAP;
  return [place.position[0] + Math.sin(place.rotation) * out, place.position[1] + Math.cos(place.rotation) * out];
}
