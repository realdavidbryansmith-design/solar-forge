/**
 * Code checks.
 *
 * Every result shows the citation and the arithmetic behind it, so a plan
 * reviewer can follow the work rather than trusting a green tick. The banner at
 * the top names every NEC table that has not been checked against a real code
 * book — that warning is the point, not decoration.
 */

import { useMemo } from 'react'
import type { CodeCheck, Severity } from '../types'
import { catalog, OPTIMIZER_BASED_INVERTERS, SOLAREDGE_STRING_LIMITS } from '../catalog'
import { moduleCount, systemAcWatts, useStore } from '../store'
import {
  checkBusbar,
  checkEvseLoad,
  maxCircuitCurrent,
  sizeBatteryBank,
  sizeChargeController,
  sizeConductor,
  sizeString,
} from '../nec'
import { nextStandardOcpd } from '../nec/tables'
import { ALL_PROVENANCE } from '../nec/tables'
import { Collapse, EmptyState, PanelBody, ScrollX, Section, Stat, StatGrid } from './controls'

/**
 * A check that cannot run because the design has not said something yet.
 *
 * Used instead of substituting a plausible default. An invented input that
 * produces a confident PASS is more dangerous than an honest gap, because the
 * arithmetic is displayed and looks authoritative.
 */
function needsInput(id: string, citation: string, title: string, detail: string, remedy: string): CodeCheck {
  return { id, citation, title, severity: 'unknown', detail, remedy }
}

const SEVERITY_STYLE: Record<Severity, { chip: string; label: string }> = {
  pass: { chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-600/40', label: 'PASS' },
  warn: { chip: 'bg-amber-500/15 text-amber-300 border-amber-600/40', label: 'WARN' },
  fail: { chip: 'bg-rose-500/15 text-rose-300 border-rose-600/40', label: 'FAIL' },
  unknown: { chip: 'bg-slate-500/15 text-slate-300 border-slate-600/40', label: 'UNKNOWN' },
}

function CheckCard({ check }: { check: CodeCheck }) {
  const style = SEVERITY_STYLE[check.severity]
  const entries = check.values ? Object.entries(check.values) : []

  return (
    <div className="min-w-0 rounded-lg border border-ink-700 bg-ink-800/50 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold ${style.chip}`}>
          {style.label}
        </span>
        <code className="shrink-0 rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-brand-400">
          {check.citation}
        </code>
      </div>
      <p className="text-sm font-medium text-slate-200">{check.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">{check.detail}</p>
      {check.remedy ? (
        <p className="mt-2 rounded border-l-2 border-amber-500/60 bg-amber-500/5 px-2 py-1 text-xs text-amber-200/90">
          {check.remedy}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <div className="mt-2">
          <Collapse summary={`Show the arithmetic (${entries.length} values)`}>
            <ScrollX>
              <table className="w-full text-xs">
                <tbody>
                  {entries.map(([k, v]) => (
                    <tr key={k} className="border-b border-ink-700/60 last:border-0">
                      <td className="py-1 pr-3 whitespace-nowrap text-slate-500">{k}</td>
                      <td className="py-1 text-right font-mono tabular-nums whitespace-nowrap text-slate-300">
                        {v === null ? '—' : String(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          </Collapse>
        </div>
      ) : null}
    </div>
  )
}

function ProvenanceBanner() {
  const unverified = ALL_PROVENANCE.filter((p) => p.status !== 'verified-against-code-book')
  if (unverified.length === 0) return null

  return (
    <div className="mx-4 mt-4 rounded-lg border border-amber-600/50 bg-amber-500/10 p-3">
      <p className="text-sm font-semibold text-amber-200">
        Code tables have not been verified against a code book
      </p>
      <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
        NFPA 70 is paywalled. The tables below were transcribed from secondary sources and
        must be checked by a licensed electrician before any output is used on a permitted
        job. See VERIFICATION.md.
      </p>
      <div className="mt-2">
        <Collapse summary={`${unverified.length} tables need review`}>
          <ul className="space-y-2">
            {unverified.map((p) => (
              <li key={p.citation} className="text-xs">
                <code className="font-mono text-amber-200">{p.citation}</code>{' '}
                <span className="text-amber-100/70">({p.status})</span>
                {p.note ? <p className="mt-0.5 text-amber-100/60">{p.note}</p> : null}
              </li>
            ))}
          </ul>
        </Collapse>
      </div>
    </div>
  )
}

export function CompliancePanel() {
  const design = useStore((s) => s.design)

  const result = useMemo(() => {
    const groups: Array<{ title: string; checks: CodeCheck[] }> = []

    const firstArray = design.arrays[0]
    const module = firstArray
      ? catalog.modules.find((m) => m.id === firstArray.module_id)
      : undefined
    const inverter = catalog.inverters.find((i) => i.id === design.inverter_ids[0])

    // --- String sizing ------------------------------------------------------
    if (module && inverter) {
      const optimizerBased = OPTIMIZER_BASED_INVERTERS.has(
        inverter.manufacturer.toLowerCase(),
      )

      if (optimizerBased) {
        const limits = SOLAREDGE_STRING_LIMITS['single-phase']
        groups.push({
          title: 'String sizing',
          checks: [
            {
              id: 'optimizer-sizing',
              citation: 'Manufacturer string design rules',
              title: 'Optimizer-based inverter — count, not voltage, sets string length',
              severity: 'warn',
              detail:
                `${inverter.manufacturer} optimizers hold each string at a fixed voltage, so ` +
                `the NEC 690.7 cold-temperature Voc method does not apply. Size by optimizer ` +
                `count: ${limits.min_per_string}–${limits.max_per_string} per string.`,
              remedy:
                `Strings longer than ${limits.rapid_shutdown_max} optimizers do not meet the ` +
                'NEC 690.12 rapid-shutdown limit, because the per-optimizer standby voltage ' +
                'accumulates past 30 V. Validate the exact pairing in the manufacturer tool.',
              values: {
                min_per_string: limits.min_per_string,
                max_per_string: limits.max_per_string,
                rapid_shutdown_max: limits.rapid_shutdown_max,
              },
            },
          ],
        })
      } else if (inverter.category === 'micro') {
        groups.push({
          title: 'String sizing',
          checks: [
            {
              id: 'micro-branch',
              citation: 'NEC 690.8 / manufacturer branch limits',
              title: 'Microinverter branch circuit',
              severity: inverter.micro_max_units_per_branch ? 'pass' : 'unknown',
              detail: inverter.micro_max_units_per_branch
                ? `Up to ${inverter.micro_max_units_per_branch} units per ` +
                  `${inverter.micro_branch_ocpd_a ?? 20} A branch circuit. This design has ` +
                  `${moduleCount(firstArray)} modules, needing ` +
                  `${Math.ceil(moduleCount(firstArray) / inverter.micro_max_units_per_branch)} branch circuit(s).`
                : 'No per-branch limit on file for this microinverter.',
              values: {
                // These catalog fields are optional, so normalise undefined to
                // null — CodeCheck.values models "not on file" as null.
                units_per_branch: inverter.micro_max_units_per_branch ?? null,
                branch_ocpd_a: inverter.micro_branch_ocpd_a ?? null,
                modules: moduleCount(firstArray),
              },
            },
          ],
        })
      } else {
        const s = sizeString({
          module,
          inverter,
          record_low_temp_c: design.site.record_low_temp_c,
          max_cell_temp_c: design.site.design_high_temp_c + 25,
          occupancy: 'dwelling',
        })
        groups.push({ title: 'String sizing (NEC 690.7)', checks: s.checks })
      }
    }

    // --- Circuit current and conductors -------------------------------------
    if (module) {
      const c = design.circuit
      const checks: CodeCheck[] = []

      if (c.strings_in_parallel === null || c.modules_per_string === null) {
        checks.push(
          needsInput(
            'circuit-unspecified',
            'NEC 690.8(A)',
            'DC circuit not specified',
            'Conductor sizing depends on how many strings run in parallel and how ' +
              'many modules sit in series. The module grid is a layout, not a ' +
              'circuit, so this cannot be inferred from it.',
            'Set the string configuration on the Electrical panel.',
          ),
        )
      } else {
        const current = maxCircuitCurrent(module, c.strings_in_parallel)
        checks.push(...current.checks)

        if (c.dc_run_ft === null || c.conductors_in_raceway === null) {
          checks.push(
            needsInput(
              'run-unspecified',
              'NEC 310.15 / 210.19',
              'Conductor run not specified',
              'Wire size depends on the run length (voltage drop) and how many ' +
                'current-carrying conductors share the raceway (fill derate).',
              'Set the DC run length and conductor count on the Electrical panel.',
            ),
          )
        } else if (Number.isFinite(current.minimum_conductor_ampacity_a)) {
          const vmp = module.vmp_v ?? 0
          const conductor = sizeConductor({
            required_ampacity_a: current.minimum_conductor_ampacity_a,
            circuit_current_a: current.max_circuit_current_a,
            material: 'Cu',
            insulation_rating: 90,
            insulation_name: 'PV Wire',
            ambient_c: design.site.design_high_temp_c,
            current_carrying_conductors: c.conductors_in_raceway,
            length_ft: c.dc_run_ft,
            // Real string operating voltage, not a placeholder.
            system_voltage_v: Math.max(1, vmp * c.modules_per_string),
            phase: 1,
            termination_rating: c.termination_rating_c,
            rooftop: { edition: design.site.nec_edition, height_above_roof_mm: 100 },
          })
          checks.push(...conductor.checks)
        }
      }

      groups.push({ title: 'Circuit current & conductors (NEC 690.8)', checks })
    }

    // --- Interconnection ----------------------------------------------------
    const acW = systemAcWatts(design)
    if (acW > 0) {
      /*
        Backfeed OCPD at 125% of continuous AC output, rounded UP to a real
        240.6(A) rating. Rounding to the nearest 5 A produced breakers that do
        not exist (55/65/85/95...) and, being smaller than the true rating,
        could turn a 705.12 failure into a pass.
      */
      const acInverter = catalog.inverters.find((i) => i.id === design.inverter_ids[0])
      const acVolts = acInverter?.ac_voltage_v[0] ?? 240
      const phaseFactor = acInverter?.phase === 3 ? Math.sqrt(3) : 1
      const acAmps = acW / (acVolts * phaseFactor)
      const breaker = nextStandardOcpd(acAmps * 1.25) ?? Math.ceil(acAmps * 1.25)
      const busbar = checkBusbar({
        busbar_rating_a: design.service.busbar_rating_a,
        main_breaker_a: design.service.main_breaker_a,
        inverter_breaker_a: breaker,
        backfeed_at_opposite_end: design.service.backfeed_at_opposite_end,
      })
      groups.push({ title: 'Interconnection (NEC 705.12)', checks: busbar.checks })
    }

    // --- EV charging --------------------------------------------------------
    const evse = catalog.evse.find((e) => e.id === design.evse_ids[0])
    if (evse) {
      const hasRenewable =
        design.arrays.length > 0 || design.battery_id !== null
      const ev = checkEvseLoad({
        evse_output_a: evse.max_output_a,
        service_rating_a: design.service.service_rating_a,
        peak_demand_kw: design.service.peak_demand_kw,
        service_voltage_v: 240,
        load_management: evse.load_management,
        managed_limit_a: null,
        has_renewable_or_peak_shaving: hasRenewable,
        nec_edition: design.site.nec_edition,
      })
      groups.push({ title: 'EV charging (NEC 625 / 220)', checks: ev.checks })
    }

    // --- Off-grid -----------------------------------------------------------
    const cc = catalog.chargeControllers.find((c) => c.id === design.charge_controller_id)
    if (cc && module && firstArray) {
      const c = design.circuit
      if (c.modules_per_string === null || c.strings_in_parallel === null) {
        groups.push({
          title: 'Charge controller',
          checks: [
            needsInput(
              'cc-circuit-unspecified',
              'NEC 690.7 / controller rating',
              'String configuration not specified',
              'Whether the array exceeds the controller\u2019s maximum PV input voltage ' +
                'depends entirely on how many modules are wired in series. The ' +
                'physical grid does not determine that — 15 modules can be three ' +
                'strings of five (safe) or one string of fifteen (destroys the unit).',
              'Set the string configuration on the Electrical panel.',
            ),
          ],
        })
        return groups
      }
      const r = sizeChargeController({
        module,
        modules_in_series: c.modules_per_string,
        strings_in_parallel: c.strings_in_parallel,
        record_low_temp_c: design.site.record_low_temp_c,
        controller_max_pv_voltage_v: cc.max_pv_input_voltage_v,
        controller_max_charge_current_a: cc.max_charge_current_a,
        battery_nominal_v: 48,
      })
      groups.push({ title: 'Charge controller', checks: r.checks })
    }

    if (design.autonomy_days !== null && design.autonomy_days > 0) {
      if (design.load_profile === null) {
        groups.push({
          title: 'Battery bank sizing',
          checks: [
            needsInput(
              'load-unspecified',
              'Design practice (not a code rule)',
              'Daily load not specified',
              'Bank capacity is daily load times days of autonomy. Without a load ' +
                'figure there is nothing to size against.',
              'Run the sizing flow on the Start panel, which produces a daily kWh figure.',
            ),
          ],
        })
      } else {
        const b = sizeBatteryBank({
          daily_load_kwh: design.load_profile.daily_kwh,
          autonomy_days: design.autonomy_days,
          depth_of_discharge: 0.8,
          round_trip_efficiency: 0.95,
          temperature_derate: 0.9,
          peak_load_kw: design.load_profile.peak_w / 1000,
        })
        groups.push({ title: 'Battery bank sizing', checks: b.checks })
      }
    }

    return groups
  }, [design])

  const all = result.flatMap((g) => g.checks)
  const counts = {
    fail: all.filter((c) => c.severity === 'fail').length,
    warn: all.filter((c) => c.severity === 'warn').length,
    unknown: all.filter((c) => c.severity === 'unknown').length,
    pass: all.filter((c) => c.severity === 'pass').length,
  }

  return (
    <PanelBody>
      <ProvenanceBanner />

      {all.length === 0 ? (
        <EmptyState title="Nothing to check yet">
          Add an array and select an inverter to run the code checks.
        </EmptyState>
      ) : (
        <>
          <Section title="Summary">
            <StatGrid>
              <Stat label="Failures" value={counts.fail} tone={counts.fail ? 'bad' : 'good'} />
              <Stat label="Warnings" value={counts.warn} tone={counts.warn ? 'warn' : 'good'} />
              <Stat label="Unknown" value={counts.unknown} tone={counts.unknown ? 'warn' : 'good'} />
              <Stat label="Passing" value={counts.pass} tone="good" />
            </StatGrid>
          </Section>

          {result.map((group) => (
            <Section key={group.title} title={group.title}>
              {group.checks.map((c, i) => (
                <CheckCard key={`${c.id}-${i}`} check={c} />
              ))}
            </Section>
          ))}
        </>
      )}
    </PanelBody>
  )
}
