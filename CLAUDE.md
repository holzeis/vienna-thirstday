# Handoff: Sunset Five-a-Side mobile/PWA redesign

This note was written by a Claude session working through the desktop app's remote
file bridge, to hand off to Claude Code running directly on this machine. Read this
before touching frontend/ so you have the context the previous session had.

## What's been done

The `frontend/` app (Vite + React + react-router) was retheme'd to match a set of
"Sunset Five-a-Side" mobile mockups and turned into an installable PWA:

- `frontend/src/index.css` — design tokens replaced with the Sunset palette (cream/
  peach day mode, plum/violet night mode), fonts swapped to Baloo 2 (headings) +
  Nunito (body). Both themes are driven by the existing `data-theme` attribute /
  `vt-theme` localStorage toggle — that mechanism was already there, only the token
  values and fonts changed.
- `frontend/src/styles/app.css` — brand-mark restyled to use real logo images
  (`public/brand/logo-compact-day.png` / `-night.png`, swapped via CSS based on
  `[data-theme]`), plus a new bottom tab bar (`.tabbar`) for mobile and a
  `@media (max-width: 760px)` block that replaces the top nav with it.
- `frontend/src/components/Layout.tsx` — exports `BrandMark`, renders the bottom
  tab bar (Home/Gamedays/Standings/Admin) alongside the existing top nav.
- `frontend/src/pages/Login.tsx` / `Register.tsx` — added the brand mark above the
  auth forms for identity consistency with the mockups.
- `frontend/vite.config.ts` — added `vite-plugin-pwa` (manifest + Workbox service
  worker, `NetworkFirst` for `/api`, `CacheFirst` for fonts). `npm run build`
  produces `dist/sw.js` + `dist/manifest.webmanifest` cleanly.
- `frontend/index.html` — Baloo 2/Nunito font links, favicon/apple-touch-icon/
  theme-color meta, `viewport-fit=cover` for safe-area support.
- `frontend/public/` — new `icons/` (192/512/maskable app icons), `brand/` (logo
  PNGs used in-app), `favicon.ico`, `favicon.svg` replaced with the new mark.

All of this compiles (`npm run build` succeeds) but **could not be visually
verified live** from the remote session — no reliable way to keep a background
dev server alive or load `localhost` in a controlled browser from there. That's
the main reason you're picking this up.

## Known open issue: mobile layout still feels wrong

User tested by installing via Chrome's "Add to Home Screen" on iPhone and reported:
components jumping, bottom tab bar not staying put, header overlapping the status
bar (battery/wifi icons).

Diagnosis so far (not yet confirmed on-device): iOS/WebKit resizes the visual
viewport as the browser's toolbar shows/hides on scroll, which breaks naive
`position: fixed`/`sticky` + `100%`/`100vh` layouts. Applied fix in `app.css`'s
mobile media query: the `.app-shell` is locked to `100dvh` with `overflow: hidden`,
`.main` is the only scrolling region (`overflow-y: auto`), and `.topbar`/`.tabbar`
are now plain flex items (no `position: fixed`) so they can't detach from the
shell during scroll. Also added `env(safe-area-inset-top)` padding to `.topbar`
(always, not just mobile) and kept `env(safe-area-inset-bottom)` on `.tabbar`.

This needs to actually be tested on the phone (`npm run dev -- --host` and hit it
from the iPhone on the same network is the fastest loop). Also worth telling the
user: Chrome on iOS does NOT support true standalone (chrome-less) launch from
"Add to Home Screen" — only Safari does, since it's the only iOS browser that can
launch a WebKit process without its own browser UI. If the header still looks off
in Chrome specifically, some of that may just be Chrome's own toolbar, not a bug
in this code — worth comparing against Safari's "Add to Home Screen" on the same
phone to isolate what's actually broken here versus a platform limitation.

## File permissions footgun (should be resolved, but verify)

Files written through the earlier remote-desktop bridge landed with owner-only
`600`/`700` permissions on disk (a FUSE quirk of that bridge — `chmod` through it
silently no-ops). This caused 403s serving `public/` assets through nginx/Docker.
The user was asked to manually run:

```bash
cd frontend
find public -type d -exec chmod 755 {} \;
find public -type f -exec chmod 644 {} \;
```

You're running directly on the filesystem now, so new files you write should get
normal permissions — but it's worth a quick `ls -la frontend/public` sanity check
before assuming this is fully resolved, in case some of the earlier 600 files are
still sitting there.

## Suggested next steps

1. Run `cd frontend && npm run dev -- --host` and open the printed LAN URL on the
   iPhone (same wifi) to get a real, live test loop — much faster than round-
   tripping through a remote bridge.
2. Verify the `.app-shell` / `100dvh` fix actually resolves the jump/overlap.
   Test in both Safari (true standalone via its own Add to Home Screen) and
   Chrome, since they behave differently on iOS.
3. If it's still wrong, the likely next suspects: `.topbar`'s `backdrop-filter`
   creating an unexpected stacking/containing-block context, or Safari's own
   home-indicator safe area needing `env(safe-area-inset-bottom)` on `.app-shell`
   itself rather than only on `.tabbar`.
