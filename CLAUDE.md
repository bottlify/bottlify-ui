# bottlify-ui — working notes for whoever drives development here

The Bottlify launcher: a React app (Vite, MUI) and the Node server that hosts it, the engine, the
game bundles and the network relay on one cross-origin-isolated origin. The engine itself is the
`bottlify` repository; this one only consumes it. Services behind the product (accounts, hosting a
person's bottles, the profile) are `bottlify-server`.

Do not trust this file over the tree; a claim here the code contradicts is a bug in this file.
Work is listed in `TODO.md`, a local file outside git (TODO and Done, a status on every open item).

## Layout

- `src/` — the app. `App.jsx` routes; `components/` the screens (`Landing`, `GameGrid`,
  `GameDetails`, `PlayScreen`, `InstallScreen`, `SettingsDrawer`, `PerfOverlay`, …);
  `engine/session.js` starts a run through `@bottlify/core`'s `createApp`, `engine/overlay.js` and
  `engine/journal.js` read its diagnostics and journal; `api/` reads the bundle list and
  `public/config.json`.
- `server.mjs` — the local/production server. Routes: `/` the built app (`dist/`), `/engine/*` the
  engine package's `dist/`, `/networking/*` the relay client's sources, `/bundles/*` the bundles
  from `BUNDLES_DIR`, `/source/*` the engine's sources only when `BOTTLIFY_SOURCE` names them,
  `/debug/*` the legacy vanilla page, `/relay` the network relay (WebSocket). Every file is served
  with byte ranges: a bundle is read a block at a time.
- `debug/` — the legacy vanilla page (needs `BOTTLIFY_SOURCE`).
- `public/` — fonts, favicon, `config.example.json`.
- Local only, outside git: `design/` (the hero image's sources and briefs), `public/covers/`
  (game art), `TASK-*.md` (briefs and reports of earlier launcher work).

## The engine as packages

`@bottlify/core`, `@bottlify/installer`, `@bottlify/networking` are named by version in
`package.json`; production installs them from the registry the `@bottlify` scope is configured for.
Locally the engine checkout sits beside this one (`../bottlify`) and `npm run dev:link` puts its
packages in place of the published ones without touching `package.json`. A change in the engine is
served once it is built there (`npm run build` in `../bottlify`).

**A launcher that reaches past the engine's public API is a defect of the API.** Anything the page
does that the engine should own (audio output, fullscreen, input capture, fetching engine files by
hand) is fixed by giving the engine that function and dropping the copy here — not by growing the
copy.

## Commands

```
npm run dev:link     # local only, instead of npm install
npm run build        # the app, into dist/ -- the License page is made from the engine's
                     # THIRD-PARTY-NOTICES.md, so the engine has to be built beside it (or
                     # installed from the registry); without it the build stops and says so
npm start            # http://127.0.0.1:5180/
TLS_DIR=../bottlify/.certs npm start    # https on every address, for another machine
npm test             # node:test, src/**/*.test.js
npm run lint         # eslint, zero warnings
npm run dev          # Vite dev server
```

Environment: `PORT` (5180), `TLS_DIR`, `BUNDLES_DIR` (default `../bottlify/bundles`),
`BOTTLIFY_SOURCE`, `RELAY_ALLOW`, `BOTTLE_PORT` (8788, the bottle server uploads are passed to).

## Rules

1. **One origin, always the same: https on port 5180.** The browser keys OPFS — game files, saves,
   the warm bundle store — by scheme, host and port. A launcher restarted on another port, or over
   plain http, is an empty origin and the player's saves are gone. Never change the port or drop
   TLS for a run the owner plays in.
2. **Cursor, pointer lock, fullscreen.** Never hide the cursor unconditionally. While the program
   hides its cursor, a click on the canvas takes pointer lock and hides the browser cursor; when the
   program shows one, release the lock and show the program's cursor. Double-click enters
   fullscreen; in fullscreen Esc goes to the program through the Keyboard Lock API. Ctrl held gives
   the pointer back to the person. It has to work both in the windowed canvas and in fullscreen.
3. **Installing runs the installer's own wizard.** Add takes an installer or a disc image (`.iso`,
   told apart by its contents); a disc is mounted as a CD-ROM drive, D:, and the program its
   `autorun.inf` opens -- `setup.exe` at its root when it names none -- runs from there. The person
   clicks through the installer's windows on the canvas; its silent mode (`C:\App` forced as the
   destination) is only for a run with no screen, `launch`'s `silentInstall`. When a bottle is
   saved after an installation, always show a modal to pick the executable it starts; the guessed
   entry is only the preselection.
4. **Access model.** A guest with no account plays the demo library out of the box. Sharing a
   person's own uploaded build by private link is `bottlify-server`'s; nothing here puts an account
   in front of a demo.
5. **A fetched bundle block is never fetched again**, within a run or across starts: it is served
   from the local store once downloaded.
6. **A new control ships with its click path.** When a change adds a setting or a button, the
   report says exactly where it is: which screen, which gear, which section, what to scroll to.
7. **Shipped text says nothing about which games run.** No titles, no "a real title" in the README
   or anything user-facing; the one permitted line is that the list of supported games will be filled
   in later.
8. **Imagery.** Bottlify's image is a joystick in a bottle (the home-page concept: a frog with a
   joystick wired into a bottle, a boxy TV, monochrome except the screen's coloured rays). A ship in
   a bottle is someone else's and never appears.
9. **Comments explain why**, never what the code already says; no changelog comments, no dates, no
   tombstones. Match the density around you.
10. **Commits** say what changed and why in one message; never add a `Co-Authored-By` line or a
    session link.
