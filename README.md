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

## Requirements

The Stocka backend must expose the handoff + scene endpoints (already added):
`POST /auth/handoff`, `POST /auth/handoff/exchange`,
`GET|PUT /organizations/{orgSlug}/timelines/{timelineId}/scene`.

## Setup

```bash
cp .env.example .env   # point NUXT_API_BASE_URL at the backend (default http://localhost:9095)
npm install
npm run dev            # http://localhost:3010
```

Open it the way the app does: `/(open)?ticket=<JWT>&org=<slug>&timeline=<id>`. In normal use the
main Stocka frontend mints the ticket and calls `window.open(...)` for you.

## Architecture

- `server/` — BFF: `[...path].ts` proxies `/api/**` to the backend with the access-token cookie;
  `auth/exchange.post.ts` swaps a handoff ticket for a session; `auth/refresh.post.ts` rotates it.
  Cookie scheme mirrors the main app (`stocka_token`, `stocka_refresh`).
- `app/stores/` — `auth`, `catalog` (pieces + actions), `scene` (the document + autosave),
  `playback`, `selection`.
- `app/components/editor/` — `BoardStage` (Konva), `TimelinePanel`, `ClipInspector`, `LayersPanel`,
  `PieceCatalog`, `Toolbar`, `PlaybackControls`, `ActionParameterInput`.
- `app/types/editor.ts` — the versioned scene document schema persisted as JSON in the backend.
