# Stocka Timeline Editor

A specialized, full-screen editor for **timelines**, opened in a new window from the **Modificar**
button of a timeline in the main Stocka app. Built with Nuxt 4 + Vue 3, Pinia, Tailwind and
**Konva** (board canvas). It talks to the **same** Spring Boot backend as Stocka through its own
BFF (`server/`) and authenticates via a one-time **handoff ticket**.

## What you can do

- Configure a **board** (dimensions + shape: rectangle / circle / polygon) with **multiple layers**.
- Place **articles (pieces)** on the board across layers (drag from the palette or click), then
  move / resize / rotate them (Konva transformer); reorder, hide and lock layers.
- Build a **video-editor-style timeline**: one track per placed article; add **clips** that pick a
  **piece-type action** and set its typed parameters; drag to move, resize to change duration.
- **Preview** with a playhead that highlights which action is active on each article.
- Everything **autosaves** to the backend (`/organizations/{org}/timelines/{id}/scene`).

> Phase 1 is authoring + preview. Driving real hardware/ports (Raspberry Pi GPIO) is a later phase;
> the data model already supports it.

## Installable, offline and connected to the Raspberry Pi

The editor is an installable web app (Chrome: «Instal·la» in the address bar). It renders in the browser
only (`ssr: false`) and `public/sw.js` keeps the app available without a connection; `sw-manifest.json`,
written at build time by the `nitro:build:public-assets` hook, lists the files it precaches. The service
worker only exists in production builds (`pnpm build`), not in `pnpm dev`.

- **Data offline** (`app/utils/offline/`): every read goes network-first with a copy in IndexedDB
  (`cachedRequest`), attachment bytes are cached once (`cachedBytes`), and each timeline has a local record
  (`sceneSync`). Opening a timeline once with a connection is enough to edit it later without one; the home
  page lists the timelines kept on the laptop.
- **Saving**: each edit is written to the laptop at once and to Stocka by the autosave. Without a connection
  the edits wait («Desat al portàtil») and go up when it is back (retry every 15 s and on the `online` event).
  If another session (web, MCP assistant, another laptop) saved meanwhile, `sceneMerge` merges the two
  editions per entity; changes to the same thing open «Canvis que xoquen», where the user keeps theirs or the
  other one.
- **Raspberry** (toolbar button, `components/editor/PiPanel.vue`, `stores/pi.ts`, `utils/pi/`): connects to
  the Pi on the local network (`belen.local:8080`, `10.42.0.1:8080` or any address), asks for its PIN (kept
  for the browser session), sends the open show (only what the Pi lacks: a show it has is just activated,
  audio it has stays home), plays, stops, panics, shows alerts and unlocks motors, and follows its log live.
  Chrome asks once for «local network access»; the Pi must allow the editor's origin (`CORS_ORIGINS` in
  `rpi4-system`). An SSH tunnel on `localhost` works too (no address-space hint is sent to loopback).

## Requirements

The Stocka backend must expose the handoff + scene endpoints (already added):
`POST /auth/handoff`, `POST /auth/handoff/exchange`,
`GET|PUT /organizations/{orgSlug}/timelines/{timelineId}/scene`.

## Setup

```bash
cp .env.example .env   # point NUXT_API_BASE_URL at the backend (default http://localhost:9095)
npm install
npm run dev            # http://localhost:3001 (no service worker in dev)
# Offline / installable test: production build on the same port
pnpm build && PORT=3001 NUXT_API_BASE_URL=http://localhost:9095 NUXT_PUBLIC_STOCKA_URL=http://localhost:3000 node .output/server/index.mjs
```

Open it the way the app does: `/(open)?ticket=<JWT>&org=<slug>&timeline=<id>`. In normal use the
main Stocka frontend mints the ticket and calls `window.open(...)` for you.

## Architecture

- `server/` — BFF: `[...path].ts` proxies `/api/**` to the backend with the access-token cookie;
  `auth/exchange.post.ts` swaps a handoff ticket for a session; `auth/refresh.post.ts` rotates it.
  Cookie scheme mirrors the main app (`stocka_token`, `stocka_refresh`).
- `app/stores/` — `auth`, `catalog` (pieces, types, locations, ports, actions; the server search the
  palette uses), `scene` (the document + autosave),
  `playback`, `selection`.
- `app/components/editor/` — `BoardStage` (Konva), `TimelinePanel`, `ClipInspector`, `LayersPanel`,
  `PieceCatalog`, `Toolbar`, `PlaybackControls`, `ActionParameterInput`.
- `app/types/editor.ts` — the versioned scene document schema persisted as JSON in the backend.
- `app/utils/portRoles.ts` — which piece type each port of an item plays (`item.portTypes`): a port
  fits any type of the piece with its kind, and the actions of a type drive the ports playing it,
  so a piece with two relay types («Llum» + «Moviment») gets one relay per type. Mirrored by the
  backend's `SceneDocument.Item.portRole`.
