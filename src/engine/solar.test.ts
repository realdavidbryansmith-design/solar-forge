import { describe, it, expect } from 'vitest'
import {
  solarDeclination,
  equationOfTime,
  sunPositionSolarTime,
  cosIncidence,
  minimumRowSpacing,
  backtrackingAngle,
  trueTrackingAngle,
  optimalFixedTilt,
  cellTemperature,
  dcPower,
  inverterAcPower,
  dayOfYear,
} from './solar'

describe('solar declination', () => {
  it('is near zero at the equinoxes', () => {
    expect(Math.abs(solarDeclination(80))).toBeLessThan(1.5) // ~Mar 21
    expect(Math.abs(solarDeclination(266))).toBeLessThan(1.5) // ~Sep 23
  })

  it('reaches +23.45 at the June solstice', () => {
    expect(solarDeclination(172)).toBeCloseTo(23.4, 0)
  })

  it('reaches -23.45 at the December solstice', () => {
    expect(solarDeclination(355)).toBeCloseTo(-23.4, 0)
  })
})

describe('equation of time', () => {
  // Classic reference values: ~-14 min in mid-Feb, ~+16 min in early Nov.
  it('is most negative in February', () => {
    expect(equationOfTime(43)).toBeLessThan(-13)
  })

  it('is most positive in early November', () => {
    expect(equationOfTime(307)).toBeGreaterThan(15)
  })
})

describe('sun position', () => {
  it('puts the sun due south at solar noon in the northern hemisphere', () => {
    const sun = sunPositionSolarTime(40, 172, 12)
    expect(sun.azimuth_deg).toBeCloseTo(180, 0)
  })

  it('gives noon altitude = 90 - lat + declination', () => {
    // Summer solstice at 40N: 90 - 40 + 23.44 = 73.44
    const sun = sunPositionSolarTime(40, 172, 12)
    expect(sun.altitude_deg).toBeCloseTo(73.4, 0)
  })

  it('gives the winter solstice noon altitude at 40N', () => {
    // 90 - 40 - 23.44 = 26.56
    const sun = sunPositionSolarTime(40, 355, 12)
    expect(sun.altitude_deg).toBeCloseTo(26.6, 0)
  })

  it('is east of south in the morning, west of south in the afternoon', () => {
    expect(sunPositionSolarTime(40, 172, 9).azimuth_deg).toBeLessThan(180)
    expect(sunPositionSolarTime(40, 172, 15).azimuth_deg).toBeGreaterThan(180)
  })

  it('places the sun below the horizon at midnight', () => {
    expect(sunPositionSolarTime(40, 355, 0).altitude_deg).toBeLessThan(0)
  })
})

describe('angle of incidence', () => {
  it('is 1.0 when the sun is normal to the panel', () => {
    // Sun at 45 altitude due south, panel tilted 45 facing south.
    const sun = { altitude_deg: 45, azimuth_deg: 180, hour_angle_deg: 0, declination_deg: 0 }
    expect(cosIncidence(45, 180, sun)).toBeCloseTo(1, 5)
  })

  it('is zero when the sun is behind the plane', () => {
    const sun = { altitude_deg: 10, azimuth_deg: 0, hour_angle_deg: 0, declination_deg: 0 }
    expect(cosIncidence(80, 180, sun)).toBe(0)
  })

  it('equals sin(altitude) for a flat panel', () => {
    const sun = { altitude_deg: 30, azimuth_deg: 140, hour_angle_deg: 0, declination_deg: 0 }
    expect(cosIncidence(0, 180, sun)).toBeCloseTo(Math.sin((30 * Math.PI) / 180), 5)
  })
})

describe('row spacing', () => {
  const base = {
    latitude_deg: 40,
    tilt_deg: 30,
    module_length_m: 2.0,
    design_hour: 9,
    azimuth_deg: 180,
  }

  it('computes rise and run from tilt', () => {
    const r = minimumRowSpacing(base)
    expect(r.module_rise_m).toBeCloseTo(2.0 * Math.sin((30 * Math.PI) / 180), 3)
    expect(r.module_run_m).toBeCloseTo(2.0 * Math.cos((30 * Math.PI) / 180), 3)
  })

  it('produces a pitch greater than the module run', () => {
    const r = minimumRowSpacing(base)
    expect(r.row_pitch_m).toBeGreaterThan(r.module_run_m)
  })

  it('yields a GCR in the range real fixed-tilt arrays use', () => {
    // Fixed-tilt utility arrays with a 9am winter no-shade rule land ~0.3-0.5.
    const r = minimumRowSpacing(base)
    expect(r.gcr).toBeGreaterThan(0.2)
    expect(r.gcr).toBeLessThan(0.6)
  })

  it('needs more spacing at higher latitude', () => {
    const north = minimumRowSpacing({ ...base, latitude_deg: 55 })
    const south = minimumRowSpacing({ ...base, latitude_deg: 25 })
    expect(north.row_pitch_m).toBeGreaterThan(south.row_pitch_m)
  })

  it('needs more spacing at steeper tilt', () => {
    const steep = minimumRowSpacing({ ...base, tilt_deg: 45 })
    const shallow = minimumRowSpacing({ ...base, tilt_deg: 10 })
    expect(steep.row_pitch_m).toBeGreaterThan(shallow.row_pitch_m)
  })

  it('needs more spacing for a 8am rule than a 10am rule', () => {
    const early = minimumRowSpacing({ ...base, design_hour: 8 })
    const late = minimumRowSpacing({ ...base, design_hour: 10 })
    expect(early.row_pitch_m).toBeGreaterThan(late.row_pitch_m)
  })

  it('flags sun below horizon instead of returning a bogus pitch', () => {
    const r = minimumRowSpacing({ ...base, latitude_deg: 70, design_hour: 9 })
    expect(r.sun_below_horizon).toBe(true)
    expect(r.row_pitch_m).toBe(Infinity)
  })
})

describe('tracker angles', () => {
  it('is flat at solar noon on the equator', () => {
    const sun = sunPositionSolarTime(0, 80, 12)
    expect(Math.abs(trueTrackingAngle(sun, 60))).toBeLessThan(2)
  })

  it('rotates east in the morning and west in the afternoon', () => {
    const morning = sunPositionSolarTime(35, 172, 8)
    const afternoon = sunPositionSolarTime(35, 172, 16)
    expect(trueTrackingAngle(morning, 60)).toBeLessThan(0)
    expect(trueTrackingAngle(afternoon, 60)).toBeGreaterThan(0)
  })

  it('clamps to the mechanical rotation limit', () => {
    const sun = sunPositionSolarTime(35, 172, 6)
    expect(Math.abs(trueTrackingAngle(sun, 45))).toBeLessThanOrEqual(45)
  })

  it('backtracks toward horizontal at low sun angles', () => {
    const sun = sunPositionSolarTime(40, 355, 8.5)
    const tracked = trueTrackingAngle(sun, 60)
    const backtracked = backtrackingAngle(sun, 0.45, 60)
    // Backtracking always reduces the magnitude of the rotation.
    expect(Math.abs(backtracked)).toBeLessThan(Math.abs(tracked))
  })

  it('does not backtrack when rows are far apart', () => {
    const sun = sunPositionSolarTime(35, 172, 10)
    // Very low GCR = wide spacing = no self-shading to avoid.
    expect(backtrackingAngle(sun, 0.05, 60)).toBeCloseTo(
      trueTrackingAngle(sun, 60),
      5,
    )
  })

  it('keeps the tracker flat at night', () => {
    const sun = sunPositionSolarTime(40, 355, 2)
    expect(backtrackingAngle(sun, 0.4, 60)).toBe(0)
  })
})

describe('optimal tilt', () => {
  it('is below latitude for mid latitudes', () => {
    expect(optimalFixedTilt(40)).toBeLessThan(40)
    expect(optimalFixedTilt(40)).toBeGreaterThan(25)
  })

  it('increases with latitude', () => {
    expect(optimalFixedTilt(48)).toBeGreaterThan(optimalFixedTilt(30))
  })
})

describe('cell temperature', () => {
  it('equals ambient in the dark', () => {
    expect(cellTemperature(0, 20, 1)).toBeCloseTo(20, 5)
  })

  it('runs hot at full sun', () => {
    const t = cellTemperature(1000, 25, 1)
    expect(t).toBeGreaterThan(45)
    expect(t).toBeLessThan(70)
  })

  it('runs hotter roof-mounted than on an open rack', () => {
    expect(cellTemperature(1000, 25, 1, 'roof-mount')).toBeGreaterThan(
      cellTemperature(1000, 25, 1, 'open-rack'),
    )
  })

  it('cools with wind', () => {
    expect(cellTemperature(1000, 25, 8)).toBeLessThan(cellTemperature(1000, 25, 0))
  })
})

describe('DC power', () => {
  const base = {
    poa_wm2: 1000,
    cell_temp_c: 25,
    nameplate_dc_w: 10_000,
    temp_coeff_pmax_pct_per_c: -0.34,
    system_losses_pct: 0,
  }

  it('returns nameplate at STC with no losses', () => {
    expect(dcPower(base)).toBeCloseTo(10_000, 3)
  })

  it('derates for hot cells', () => {
    // 45C is 20C above STC: 20 * -0.34% = -6.8%
    expect(dcPower({ ...base, cell_temp_c: 45 })).toBeCloseTo(9320, 0)
  })

  it('gains a little in the cold', () => {
    expect(dcPower({ ...base, cell_temp_c: 5 })).toBeGreaterThan(10_000)
  })

  it('scales linearly with irradiance', () => {
    expect(dcPower({ ...base, poa_wm2: 500 })).toBeCloseTo(5000, 3)
  })

  it('applies system losses', () => {
    expect(dcPower({ ...base, system_losses_pct: 14 })).toBeCloseTo(8600, 0)
  })

  it('is zero at night', () => {
    expect(dcPower({ ...base, poa_wm2: 0 })).toBe(0)
  })
})

describe('inverter AC power', () => {
  it('clips at the AC rating', () => {
    expect(inverterAcPower(12_000, 7600)).toBeLessThanOrEqual(7600)
  })

  it('is near nominal efficiency at moderate load', () => {
    const ac = inverterAcPower(5000, 7600, 0.96)
    expect(ac / 5000).toBeGreaterThan(0.94)
    expect(ac / 5000).toBeLessThan(0.98)
  })

  it('is zero with no DC input', () => {
    expect(inverterAcPower(0, 7600)).toBe(0)
  })
})

describe('day of year', () => {
  it('is 1 on January 1', () => {
    expect(dayOfYear(new Date(Date.UTC(2026, 0, 1)))).toBe(1)
  })

  it('is 365 on December 31 of a common year', () => {
    expect(dayOfYear(new Date(Date.UTC(2026, 11, 31)))).toBe(365)
  })
})
