import type { ButtonSchedule, ScheduleDay, ScheduleWindow } from '~/types/show'

// Button schedule (`mode.schedule`): the same rules as `backend/.../scene/ScheduleRules.java` and
// the device's `show.schema.json`, plus "a window must last something". Semantics in
// `rpi4-system/contract/README.md`.

export const SCHEDULE_DAYS: readonly ScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export const SCHEDULE_DAY_LABELS: Record<ScheduleDay, string> = {
  mon: 'Dl', tue: 'Dt', wed: 'Dc', thu: 'Dj', fri: 'Dv', sat: 'Ds', sun: 'Dg'
}
export const MAX_SCHEDULE_WINDOWS = 50

const FROM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
const TO = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/

/** A window that starts and ends at the same time lasts nothing. */
export function isEmptyWindow(w: ScheduleWindow): boolean {
  return w.from === w.to
}

/** What the device's JSON schema would refuse: rule, number of windows, days and time formats. */
export function scheduleStructuralProblems(schedule: ButtonSchedule): string[] {
  const problems: string[] = []
  if (schedule.rule !== 'allow' && schedule.rule !== 'block') problems.push('la regla ha de ser allow o block')
  const windows = Array.isArray(schedule.windows) ? schedule.windows : []
  if (windows.length === 0) problems.push('cal almenys una franja')
  else if (windows.length > MAX_SCHEDULE_WINDOWS) problems.push(`com a molt ${MAX_SCHEDULE_WINDOWS} franges`)
  windows.forEach((w, i) => {
    const n = i + 1
    const days = Array.isArray(w?.days) ? w.days : []
    if (days.length === 0) problems.push(`la franja ${n} necessita algun dia`)
    const seen = new Set<string>()
    for (const day of days) {
      if (!SCHEDULE_DAYS.includes(day)) problems.push(`la franja ${n} té un dia desconegut: «${String(day)}»`)
      else if (seen.has(day)) problems.push(`la franja ${n} repeteix ${day}`)
      seen.add(day)
    }
    if (typeof w?.from !== 'string' || !FROM.test(w.from)) problems.push(`la franja ${n}: l'inici ha de ser HH:MM (00:00 a 23:59)`)
    if (typeof w?.to !== 'string' || !TO.test(w.to)) problems.push(`la franja ${n}: el final ha de ser HH:MM o 24:00`)
  })
  return problems
}

/** Every problem, including windows that last nothing; empty when the schedule is valid. */
export function scheduleProblems(schedule: ButtonSchedule): string[] {
  const problems = scheduleStructuralProblems(schedule)
  ;(schedule.windows ?? []).forEach((w, i) => {
    if (w && isEmptyWindow(w)) problems.push(`la franja ${i + 1} comença i acaba a les ${w.from}: no dura res`)
  })
  return problems
}

/** Days in week order, without repeats. */
export function sortDays(days: ScheduleDay[]): ScheduleDay[] {
  return SCHEDULE_DAYS.filter(d => days.includes(d))
}

/** Whether the window crosses midnight (it then belongs to the day it starts). */
export function crossesMidnight(w: ScheduleWindow): boolean {
  return w.to !== '24:00' && w.to <= w.from
}

/** «Dl, Dv 17:00–21:00» */
export function windowLabel(w: ScheduleWindow): string {
  return `${sortDays(w.days).map(d => SCHEDULE_DAY_LABELS[d]).join(', ')} ${w.from}–${w.to}${crossesMidnight(w) ? ' (l’endemà)' : ''}`
}

/** One line for the toolbar: «Només Dl, Dv 17:00–21:00» / «Excepte …». */
export function scheduleSummary(schedule: ButtonSchedule | undefined | null): string {
  if (!schedule) return 'Sempre'
  return `${schedule.rule === 'allow' ? 'Només' : 'Excepte'} ${schedule.windows.map(windowLabel).join('; ')}`
}

/** A copy with only the contract's keys (no UI helpers), days in week order. */
export function cleanSchedule(schedule: ButtonSchedule): ButtonSchedule {
  return {
    rule: schedule.rule,
    windows: schedule.windows.map(w => ({ days: sortDays(w.days), from: w.from, to: w.to }))
  }
}

/** «Dv 18:30» from a local ISO time of the Pi (no offset: read as local time). */
export function formatPiTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = SCHEDULE_DAY_LABELS[SCHEDULE_DAYS[(d.getDay() + 6) % 7]!]
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
