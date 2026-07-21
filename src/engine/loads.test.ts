import { describe, it, expect } from 'vitest'
import {
  APPLIANCES,
  LOAD_PRESETS,
  dailyInsolationKwhM2,
  estimateLoads,
  insolationSummary,
  sizeSystem,
} from './loads'

describe('appliance library', () => {
  it('has unique ids', () => {
    const ids = APPLIANCES.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never claims more than 24 running hours a day', () => {
    for (const a of APPLIANCES) expect(a.hours_per_day).toBeLessThanOrEqual(24)
  })

  it('gives a surge at least as large as the running draw', () => {
    for (const a of APPLIANCES) {
      if (a.surge_watts !== null) expect(a.surge_watts).toBeGreaterThanOrEqual(a.watts)
    }
  })

  it('warns on the loads that wreck an off-grid budget', () => {
    const warned = APPLIANCES.filter((a) => a.offgrid_warning).map((a) => a.id)
    expect(warned).toContain('water-heater-electric')
    expect(warned).toContain('space-heater')
    expect(warned).toContain('electric-range')
  })
})

describe('preset integrity', () => {
  it('references only real appliances', () => {
    const ids = new Set(APPLIANCES.map((a) => a.id))
    for (const p of LOAD_PRESETS) {
      for (const id of p.implies) expect(ids.has(id)).toBe(true)
    }
  })

  it('increases in energy as the lifestyle grows', () => {
    for (let i = 1; i < LOAD_PRESETS.length; i++) {
      expect(LOAD_PRESETS[i].daily_kwh).toBeGreaterThan(LOAD_PRESETS[i - 1].daily_kwh)
    }
  })

  it("lands near its own implied appliance list", () => {
    // The guess should be in the same ballpark as itemising what it assumes,
    // otherwise the two paths would contradict each other.
    for (const p of LOAD_PRESETS) {
      const itemised = estimateLoads(p.implies.map((id) => ({ appliance_id: id, quantity: 1 })))
      expect(itemised.daily_kwh).toBeGreaterThan(p.daily_kwh * 0.4)
      expect(itemised.daily_kwh).toBeLessThan(p.daily_kwh * 2.2)
    }
  })
})

describe('load estimation', () => {
  it('is zero for an empty list', () => {
    const r = estimateLoads([])
    expect(r.daily_kwh).toBe(0)
    expect(r.peak_watts).toBe(0)
  })

  it('multiplies by quantity', () => {
    const one = estimateLoads([{ appliance_id: 'led-lights', quantity: 1 }])
    const three = estimateLoads([{ appliance_id: 'led-lights', quantity: 3 }])
    expect(three.daily_kwh).toBeCloseTo(one.daily_kwh * 3, 6)
  })

  it('computes kWh as watts x hours / 1000', () => {
    // Microwave: 1000 W for 0.25 h = 0.25 kWh
    const r = estimateLoads([{ appliance_id: 'microwave', quantity: 1 }])
    expect(r.daily_kwh).toBeCloseTo(0.25, 6)
  })

  it('ignores unknown appliance ids rather than throwing', () => {
    const r = estimateLoads([{ appliance_id: 'does-not-exist', quantity: 1 }])
    expect(r.daily_kwh).toBe(0)
  })

  it('ignores zero and negative quantities', () => {
    expect(estimateLoads([{ appliance_id: 'microwave', quantity: 0 }]).daily_kwh).toBe(0)
    expect(estimateLoads([{ appliance_id: 'microwave', quantity: -2 }]).daily_kwh).toBe(0)
  })

  it('counts only the single largest surge, not the sum', () => {
    // Well pump surge 2500 dominates the washing machine's 1500.
    const r = estimateLoads([
      { appliance_id: 'well-pump', quantity: 1 },
      { appliance_id: 'washing-machine', quantity: 1 },
    ])
    expect(r.surge_watts - r.peak_watts).toBeCloseTo(2500, 6)
  })

  it('applies diversity so peak is below connected load', () => {
    const r = estimateLoads([
      { appliance_id: 'well-pump', quantity: 1 },
      { appliance_id: 'microwave', quantity: 1 },
    ])
    expect(r.peak_watts).toBeLessThan(r.connected_watts)
  })

  it('never sizes peak below the largest single appliance', () => {
    // A microwave among small always-on loads: diversity would give ~630 W,
    // but the inverter still has to run the 1000 W microwave on its own.
    const r = estimateLoads([
      { appliance_id: 'microwave', quantity: 1 },
      { appliance_id: 'wifi-router', quantity: 1 },
    ])
    expect(r.peak_watts).toBeGreaterThanOrEqual(1000)
  })

  it('keeps the itemised peak within reach of the preset guess', () => {
    // The two paths must not disagree wildly, or switching between them would
    // swing the inverter recommendation by multiples.
    for (const p of LOAD_PRESETS) {
      const itemised = estimateLoads(p.implies.map((id) => ({ appliance_id: id, quantity: 1 })))
      expect(itemised.peak_watts).toBeGreaterThan(p.peak_watts * 0.1)
    }
  })

  it('surfaces the off-grid warning for resistance heating', () => {
    const r = estimateLoads([{ appliance_id: 'space-heater', quantity: 1 }])
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  it('sorts the breakdown by energy, biggest first', () => {
    const r = estimateLoads([
      { appliance_id: 'phone-charging', quantity: 1 },
      { appliance_id: 'fridge-standard', quantity: 1 },
    ])
    expect(r.breakdown[0].name).toMatch(/Refrigerator/)
  })
})

describe('insolation', () => {
  it('produces plausible peak sun hours for a mid-latitude site', () => {
    // 40N, 30 deg tilt facing south, summer — US sites run roughly 4-8.
    const s = dailyInsolationKwhM2(40, 30, 180, 172)
    expect(s).toBeGreaterThan(4)
    expect(s).toBeLessThan(11)
  })

  it('collects less in winter than in summer', () => {
    const summer = dailyInsolationKwhM2(40, 30, 180, 172)
    const winter = dailyInsolationKwhM2(40, 30, 180, 355)
    expect(winter).toBeLessThan(summer)
  })

  it('is near zero above the arctic circle in midwinter', () => {
    expect(dailyInsolationKwhM2(72, 30, 180, 355)).toBeLessThan(0.2)
  })

  it('prefers a south-facing array over a north-facing one', () => {
    const south = dailyInsolationKwhM2(40, 30, 180, 172)
    const north = dailyInsolationKwhM2(40, 30, 0, 172)
    expect(south).toBeGreaterThan(north)
  })

  it('identifies December as the worst month in the northern hemisphere', () => {
    const s = insolationSummary(40, 30, 180)
    expect(['November', 'December', 'January']).toContain(s.worst_month_name)
  })

  it('orders worst <= average <= best', () => {
    const s = insolationSummary(40, 30, 180)
    expect(s.worst_month_kwh_m2).toBeLessThanOrEqual(s.annual_average_kwh_m2)
    expect(s.annual_average_kwh_m2).toBeLessThanOrEqual(s.best_month_kwh_m2)
  })

  it('gains from steeper tilt in winter at high latitude', () => {
    const shallow = dailyInsolationKwhM2(50, 10, 180, 355)
    const steep = dailyInsolationKwhM2(50, 60, 180, 355)
    expect(steep).toBeGreaterThan(shallow)
  })
})

describe('system sizing', () => {
  const base = {
    goal: 'off-grid' as const,
    daily_kwh: 5,
    peak_watts: 2000,
    surge_watts: 5000,
    latitude_deg: 40,
    tilt_deg: 30,
    azimuth_deg: 180,
    autonomy_days: 2,
    weather_factor: 0.7,
  }

  it('sizes an off-grid array on the worst month, not the average', () => {
    const r = sizeSystem(base)
    expect(r.design_sun_hours).toBeCloseTo(
      r.insolation.worst_month_kwh_m2 * 0.7,
      5,
    )
    expect(r.notes.join(' ')).toMatch(/worst|December|November|January/i)
  })

  it('sizes a grid-tied array on the annual average instead', () => {
    const r = sizeSystem({ ...base, goal: 'grid-offset' })
    expect(r.design_sun_hours).toBeCloseTo(
      r.insolation.annual_average_kwh_m2 * 0.7,
      5,
    )
  })

  it('produces a bigger off-grid array than grid-tied for the same load', () => {
    const off = sizeSystem(base)
    const grid = sizeSystem({ ...base, goal: 'grid-offset' })
    expect(off.array_w).toBeGreaterThan(grid.array_w)
  })

  it('scales the array linearly with daily load', () => {
    const a = sizeSystem(base)
    const b = sizeSystem({ ...base, daily_kwh: 10 })
    expect(b.array_w / a.array_w).toBeCloseTo(2, 1)
  })

  it('scales the battery with autonomy days', () => {
    const two = sizeSystem(base)
    const four = sizeSystem({ ...base, autonomy_days: 4 })
    expect(four.battery_usable_kwh).toBeCloseTo(two.battery_usable_kwh * 2, 6)
  })

  it('makes nameplate larger than usable, for depth of discharge', () => {
    const r = sizeSystem(base)
    expect(r.battery_nameplate_kwh).toBeGreaterThan(r.battery_usable_kwh)
  })

  it('recommends no battery for a pure grid offset', () => {
    expect(sizeSystem({ ...base, goal: 'grid-offset' }).battery_usable_kwh).toBe(0)
  })

  it('sizes the inverter above the peak load', () => {
    const r = sizeSystem(base)
    expect(r.inverter_w).toBeGreaterThan(base.peak_watts)
  })

  it('warns when autonomy is too thin', () => {
    const r = sizeSystem({ ...base, autonomy_days: 1 })
    expect(r.notes.join(' ')).toMatch(/autonomy|cloudy/i)
  })

  it('needs a bigger array in a cloudier place', () => {
    const sunny = sizeSystem({ ...base, weather_factor: 0.85 })
    const cloudy = sizeSystem({ ...base, weather_factor: 0.5 })
    expect(cloudy.array_w).toBeGreaterThan(sunny.array_w)
  })

  it('produces a sane whole-system result for a basic cabin', () => {
    // 4 kWh/day off-grid at 40N should land in the low single-digit kW range.
    const r = sizeSystem({ ...base, daily_kwh: 4 })
    expect(r.array_w).toBeGreaterThan(1500)
    expect(r.array_w).toBeLessThan(9000)
    expect(r.battery_nameplate_kwh).toBeGreaterThan(5)
    expect(r.battery_nameplate_kwh).toBeLessThan(20)
  })
})
