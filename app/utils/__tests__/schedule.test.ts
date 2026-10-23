import { describe, expect, it } from 'vitest'
import type { ButtonSchedule, ScheduleWindow } from '~/types/show'
import {
  MAX_SCHEDULE_WINDOWS,
  cleanSchedule,
  crossesMidnight,
  formatPiTime,
  isEmptyWindow,
  scheduleProblems,
  scheduleStructuralProblems,
  scheduleSummary,
  sortDays,
  windowLabel
} from '~/utils/schedule'

const w = (from: string, to: string, ...days: ScheduleWindow['days']): ScheduleWindow => ({ days, from, to })
const allow = (...windows: ScheduleWindow[]): ButtonSchedule => ({ rule: 'allow', windows })

describe('scheduleProblems', () => {
  it('accepts allow and block with ordinary windows', () => {
    expect(scheduleProblems(allow(w('17:00', '21:00', 'mon', 'fri')))).toEqual([])
    expect(scheduleProblems({ rule: 'block', windows: [w('13:00', '16:00', 'sun')] })).toEqual([])
  })

  it.each([['22:00', '02:00'], ['00:00', '24:00'], ['22:00', '00:00'], ['23:59', '24:00']])('accepts %s–%s', (from, to) => {
    expect(scheduleProblems(allow(w(from, to, 'sat')))).toEqual([])
  })

  it('accepts fifty windows and refuses fifty-one', () => {
    const many = (n: number) => allow(...Array.from({ length: n }, () => w('10:00', '11:00', 'mon')))
    expect(scheduleProblems(many(MAX_SCHEDULE_WINDOWS))).toEqual([])
    expect(scheduleProblems(many(MAX_SCHEDULE_WINDOWS + 1))).toEqual(['com a molt 50 franges'])
  })

  it('refuses an unknown rule and no windows', () => {
    expect(scheduleProblems({ rule: 'maybe' as never, windows: [w('10:00', '11:00', 'mon')] })).toEqual(['la regla ha de ser allow o block'])
    expect(scheduleProblems(allow())).toEqual(['cal almenys una franja'])
  })

  it('refuses missing, unknown and repeated days', () => {
    expect(scheduleProblems(allow(w('10:00', '11:00')))).toEqual(['la franja 1 necessita algun dia'])
    expect(scheduleProblems(allow(w('10:00', '11:00', 'lunes' as never)))).toEqual(['la franja 1 té un dia desconegut: «lunes»'])
    expect(scheduleProblems(allow(w('10:00', '11:00', 'mon', 'mon')))).toEqual(['la franja 1 repeteix mon'])
  })

  it.each(['24:00', '7:00', '10:60', ''])('refuses the start %j', (from) => {
    expect(scheduleProblems(allow(w(from, '11:30', 'mon')))).toContain("la franja 1: l'inici ha de ser HH:MM (00:00 a 23:59)")
  })

  it.each(['24:01', '9:00', ''])('refuses the end %j', (to) => {
    expect(scheduleProblems(allow(w('10:00', to, 'mon')))).toEqual(['la franja 1: el final ha de ser HH:MM o 24:00'])
  })

  it('reports a window that lasts nothing, which is not a structural problem', () => {
    const s = allow(w('10:00', '11:00', 'mon'), w('17:00', '17:00', 'tue'))
    expect(scheduleProblems(s)).toEqual(['la franja 2 comença i acaba a les 17:00: no dura res'])
    expect(scheduleStructuralProblems(s)).toEqual([])
    expect(isEmptyWindow(w('00:00', '24:00', 'mon'))).toBe(false)
  })
})

describe('labels and helpers', () => {
  it('sorts days in week order', () => {
    expect(sortDays(['sun', 'mon', 'fri'])).toEqual(['mon', 'fri', 'sun'])
  })

  it('knows which windows cross midnight', () => {
    expect(crossesMidnight(w('22:00', '02:00', 'sat'))).toBe(true)
    expect(crossesMidnight(w('22:00', '00:00', 'sat'))).toBe(true)
    expect(crossesMidnight(w('22:00', '24:00', 'sat'))).toBe(false)
    expect(crossesMidnight(w('10:00', '11:00', 'sat'))).toBe(false)
  })

  it('summarizes a schedule in one line', () => {
    expect(scheduleSummary(null)).toBe('Sempre')
    expect(scheduleSummary(undefined)).toBe('Sempre')
    expect(scheduleSummary(allow(w('17:00', '21:00', 'fri', 'mon')))).toBe('Només Dl, Dv 17:00–21:00')
    expect(scheduleSummary({ rule: 'block', windows: [w('22:00', '02:00', 'sat'), w('13:00', '16:00', 'sun')] }))
      .toBe('Excepte Ds 22:00–02:00 (l’endemà); Dg 13:00–16:00')
    expect(windowLabel(w('00:00', '24:00', 'sun'))).toBe('Dg 00:00–24:00')
  })

  it('cleans a schedule down to the contract keys', () => {
    const dirty = { rule: 'allow', windows: [{ key: 3, wholeDay: false, days: ['sun', 'mon'], from: '10:00', to: '11:00' }] } as unknown as ButtonSchedule
    expect(cleanSchedule(dirty)).toEqual({ rule: 'allow', windows: [{ days: ['mon', 'sun'], from: '10:00', to: '11:00' }] })
  })

  it('formats the Pi local time with the day', () => {
    expect(formatPiTime('2026-10-23T18:30:05')).toBe('Dv 18:30')
    expect(formatPiTime('2026-10-26T17:00')).toBe('Dl 17:00')
    expect(formatPiTime('no')).toBe('no')
  })
})
