<script setup lang="ts">
import { formatTimeInput, parseTimeInput } from '~/utils/playRange'

// Transport of the timeline, in one row: play controls, where the playhead is, and the range
// «Inici» → «Fi» that playback loops over and «Prova a la Raspberry» rehearses. «Fi» empty = the end
// of the last clip (the show lasts exactly that, there is no length to type).

const playback = usePlaybackStore()
const scene = useSceneStore()

function fmt(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const cs = Math.floor((ms % 1000) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** A time field accepts `5:15`, `5:15.5` or seconds; anything else puts back what it had. */
function onTime(e: Event, set: (ms: number | null) => void, shown: () => string) {
  const input = e.target as HTMLInputElement
  const ms = parseTimeInput(input.value)
  if (ms !== undefined) set(ms)
  input.value = shown()
}

const startText = () => formatTimeInput(playback.rangeStartMs)
const endText = () => (playback.rangeEndMs === null ? '' : formatTimeInput(playback.rangeEndMs))
const setStart = (ms: number | null) => playback.setRangeStart(ms ?? 0)
</script>

<template>
  <div class="flex items-center gap-3">
    <div class="flex items-center gap-1">
      <button class="tbtn" title="Torna a l'inici" @click="playback.stop()">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 5v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          <path d="M19 5.5 9.5 12 19 18.5z" fill="currentColor" />
        </svg>
      </button>

      <button
        class="tbtn tbtn-play"
        :title="playback.playing ? 'Pausa (vista prèvia)' : 'Reprodueix la vista prèvia'"
        @click="playback.toggle()">
        <svg v-if="!playback.playing" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
          <rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" />
        </svg>
      </button>

      <button
        class="tbtn"
        :class="{ 'is-active': playback.loop }"
        :title="playback.loop ? 'En bucle: Inici → Fi es repeteix' : 'Repeteix Inici → Fi'"
        @click="playback.toggleLoop()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      </button>

      <button
        class="tbtn"
        :class="{ 'is-active': playback.audioEnabled }"
        :title="playback.audioEnabled ? 'Silencia l\'àudio de la vista prèvia' : 'Activa l\'àudio de la vista prèvia'"
        @click="playback.toggleAudio()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H2v6h4l5 4z" />
          <template v-if="playback.audioEnabled">
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M19 5.5a9 9 0 0 1 0 13" />
          </template>
          <template v-else>
            <path d="m22 9-6 6" />
            <path d="m16 9 6 6" />
          </template>
        </svg>
      </button>

      <button
        class="tbtn"
        :class="{ 'is-active': playback.ledEnabled }"
        :title="playback.ledEnabled ? 'Amaga els LED al tauler' : 'Mostra els LED al tauler'"
        @click="playback.toggleLed()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M8.5 15a6 6 0 1 1 7 0c-.8.6-1.2 1.2-1.5 2h-4c-.3-.8-.7-1.4-1.5-2z" />
        </svg>
      </button>
    </div>

    <span class="whitespace-nowrap font-mono text-[12px] tabular-nums text-ink-soft" title="Posició del capçal / durada del show (fins al darrer clip)">
      {{ fmt(playback.currentMs) }} <span class="text-ink-muted">/ {{ fmt(scene.durationMs) }}</span>
    </span>

    <div class="flex items-center gap-2 border-l border-line pl-3 text-[12px] text-ink-soft">
      <label class="flex items-center gap-1.5" title="On comença la reproducció i l'assaig (m:ss o segons)">
        Inici
        <input
          class="field time-field"
          type="text" inputmode="decimal" autocomplete="off"
          :value="startText()"
          @change="onTime($event, setStart, startText)">
      </label>
      <label class="flex items-center gap-1.5" title="On s'atura (m:ss o segons); pot ser després del darrer clip. Buit: fins al final del darrer clip">
        Fi
        <input
          class="field time-field"
          type="text" inputmode="decimal" autocomplete="off"
          :placeholder="formatTimeInput(scene.durationMs)"
          :value="endText()"
          @change="onTime($event, playback.setRangeEnd, endText)">
      </label>
    </div>
  </div>
</template>

<style scoped>
.tbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--c-line);
  background: var(--c-bg-card);
  color: var(--c-ink-soft);
  transition: background .15s, color .15s, border-color .15s, transform .06s;
}
.tbtn:hover {
  background: var(--c-bg-soft);
  color: var(--c-ink);
}
.tbtn:active { transform: scale(0.94); }
.tbtn svg { width: 16px; height: 16px; }

.tbtn.is-active {
  border-color: var(--c-accent);
  background: var(--c-accent-soft);
  color: var(--c-accent-ink);
}

.tbtn-play {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: #fff;
  box-shadow: 0 1px 2px rgba(60, 50, 30, .12);
}
.tbtn-play:hover {
  background: color-mix(in oklab, var(--c-accent) 88%, black);
  color: #fff;
}
.tbtn-play svg { width: 18px; height: 18px; }

.time-field {
  height: 28px !important;
  width: 64px !important;
  padding: 0 8px !important;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
</style>
