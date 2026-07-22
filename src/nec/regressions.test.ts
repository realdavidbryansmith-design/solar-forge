/**
 * Regression tests for bugs found in adversarial review.
 *
 * Each of these shipped at some point. They are pinned here so the specific
 * failure cannot silently return.
 */

import { describe, it, expect } from 'vitest'
import {
  maxCircuitCurrent,
  sizeChargeController,
  sizeConductor,
  sizeString,
  correctedVoc,
} from './index'
import { catalog, hasDcSpecs } from '../catalog'
import type { PvModule } from '../types'

const qcells = catalog.modules.find((m) => m.id.startsWith('qcells'))!
const acModule = catalog.modules.find((m) => m.isc_a === null)!

describe('null DC specs never become zero (review finding 5)', () => {
  it('has an AC module in the catalog with null DC specs', () => {
    expect(acModule).toBeDefined()
    expect(acModule.isc_a).toBeNull()
  })

  it('excludes it from the DC-sizable set', () => {
    expect(hasDcSpecs(acModule)).toBe(false)
    expect(catalog.modules.some((m) => !hasDcSpecs(m))).toBe(true)
  })

  it('reports unknown instead of 0 A for maximum circuit current', () => {
    const r = maxCircuitCurrent(acModule, 2)
    // The bug produced "0.00 A" with a PASS.
    expect(r.max_circuit_current_a).toBeNaN()
    expect(r.checks.some((c) => c.severity === 'unknown')).toBe(true)
    expect(r.checks.every((c) => c.severity !== 'pass')).toBe(true)
  })

  it('reports unknown for Voc correction rather than NaN volts', () => {
    const r = correctedVoc(acModule, -22)
    expect(r.checks[0].severity).toBe('unknown')
  })

  it('never claims a conductor size from a null Isc', () => {
    const cur = maxCircuitCurrent(acModule, 2)
    expect(Number.isFinite(cur.minimum_conductor_ampacity_a)).toBe(false)
  })
})

describe('charge controller (review findings 2, 7, 12)', () => {
  const base = {
    module: qcells,
    strings_in_parallel: 1,
    record_low_temp_c: -22,
    controller_max_pv_voltage_v: 150,
    controller_max_charge_current_a: 45,
    battery_nominal_v: 48,
  }

  it('fails a 15-series string against a 150 V controller', () => {
    // The bug read the 3x5 grid as 3 series x 5 parallel and passed at 131 V.
    // Wired as one string of 15 it is ~656 V and destroys the controller.
    const r = sizeChargeController({ ...base, modules_in_series: 15 })
    const voltage = r.checks.find((c) => c.id === 'cc-voltage')!
    expect(r.string_voc_cold_v).toBeGreaterThan(600)
    expect(voltage.severity).toBe('fail')
  })

  it('passes a 3-series string against the same controller', () => {
    const r = sizeChargeController({ ...base, modules_in_series: 3 })
    expect(r.checks.find((c) => c.id === 'cc-voltage')!.severity).toBe('pass')
  })

  it('checks controller CURRENT, not only power', () => {
    // 690.8: Isc x 1.25 x 1.25. Eight strings of Qcells far exceeds 45 A.
    const r = sizeChargeController({
      ...base,
      modules_in_series: 3,
      strings_in_parallel: 8,
    })
    const current = r.checks.find((c) => c.id === 'cc-current')
    expect(current).toBeDefined()
    expect(current!.severity).toBe('fail')
  })

  it('reports unknown, not a NaN failure, when the coefficient is missing', () => {
    const noCoeff: PvModule = { ...qcells, temp_coeff_voc_pct_per_c: null }
    const r = sizeChargeController({ ...base, module: noCoeff, modules_in_series: 3 })
    const voltage = r.checks.find((c) => c.id === 'cc-voltage')!
    expect(voltage.severity).toBe('unknown')
    // The bug printed "Shorten the string to NaN modules or fewer".
    expect(voltage.remedy ?? '').not.toContain('NaN')
    expect(voltage.detail).not.toContain('NaN V against')
  })
})

describe('AC module never yields a NaN card (review 2, bug A)', () => {
  it('reports unknown, not a NaN FAIL, for the controller current check', () => {
    const r = sizeChargeController({
      module: acModule,
      modules_in_series: 3,
      strings_in_parallel: 1,
      record_low_temp_c: -22,
      controller_max_pv_voltage_v: 150,
      controller_max_charge_current_a: 45,
      battery_nominal_v: 48,
    })
    const current = r.checks.find((c) => c.id === 'cc-current')!
    expect(current.severity).toBe('unknown')
    expect(current.detail).not.toContain('NaN')
    expect(current.detail).not.toContain('null A')
  })
})

describe('AC module emits no green DC card (review 2, bug C)', () => {
  it('sizeString does not push a passing voltage-ceiling card', () => {
    const inverter = catalog.inverters.find((i) => i.category === 'string')!
    const r = sizeString({
      module: acModule,
      inverter,
      record_low_temp_c: -22,
      max_cell_temp_c: 60,
      occupancy: 'dwelling',
    })
    // Only the "no DC rating" unknown check, no green pass.
    expect(r.checks.every((c) => c.severity !== 'pass')).toBe(true)
    expect(r.checks.some((c) => c.severity === 'unknown')).toBe(true)
  })
})

describe('conductor and OCPD sizing (review findings 6, 10)', () => {
  it('sizes the OCPD on 156.25% of Isc, not 125%', () => {
    // Qcells Isc 13.74 A, 2 strings -> max circuit current 34.35 A,
    // continuous requirement 42.94 A -> the OCPD must be 45 A, not 35 A.
    const cur = maxCircuitCurrent(qcells, 2)
    const r = sizeConductor({
      required_ampacity_a: cur.minimum_conductor_ampacity_a,
      circuit_current_a: cur.max_circuit_current_a,
      material: 'Cu',
      insulation_rating: 90,
      insulation_name: 'PV Wire',
      ambient_c: 35,
      current_carrying_conductors: 4,
      length_ft: 80,
      system_voltage_v: 400,
      phase: 1,
      termination_rating: 75,
    })
    expect(r.spec).not.toBeNull()
    expect(r.spec!.ocpd_a).toBeGreaterThanOrEqual(45)
  })

  it('applies 110.14(C) against the continuous requirement', () => {
    // The bug tested the termination limit against the raw circuit current and
    // chose 8 AWG (75 C termination = 50 A) for a 52 A continuous circuit.
    const r = sizeConductor({
      required_ampacity_a: 52,
      circuit_current_a: 41.6,
      material: 'Cu',
      insulation_rating: 90,
      insulation_name: 'THWN-2',
      ambient_c: 30,
      current_carrying_conductors: 3,
      length_ft: 50,
      system_voltage_v: 240,
      phase: 1,
      termination_rating: 75,
    })
    expect(r.spec).not.toBeNull()
    expect(r.spec!.termination_limit_a).toBeGreaterThanOrEqual(52)
    expect(r.spec!.awg).not.toBe('8')
  })
})
