/**
 * Bill of materials.
 *
 * A null price is never summed as zero. Lines with unknown pricing are counted
 * separately and reported, so the total is honest about what it excludes.
 */

import { useMemo, useState } from 'react'
import { catalog } from '../catalog'
import { moduleCount, useStore } from '../store'
import { buildSiteDxf, type DxfUnit } from '../engine/dxf'
import {
  EmptyState,
  PanelBody,
  ScrollX,
  Section,
  SelectField,
  Stat,
  StatGrid,
  Toggle,
  money,
} from './controls'

/** Trigger a browser download of a text file. */
function downloadText(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function DxfExportSection() {
  const design = useStore((s) => s.design)
  const [unit, setUnit] = useState<DxfUnit>('feet')
  const [includeModules, setIncludeModules] = useState(true)

  const hasGeometry =
    design.arrays.length > 0 || design.planes.length > 0 || design.site_objects.length > 0

  const exportDxf = () => {
    const dxf = buildSiteDxf(design, catalog.modules, { unit, includeModules })
    const safe = design.name.replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '') || 'site'
    downloadText(`${safe}-plan.dxf`, 'application/dxf', dxf)
  }

  return (
    <Section
      title="CAD export (DXF)"
      hint="A plan-view drawing for AutoCAD or any CAD viewer — roof, arrays, modules, buildings and trees on named layers, with a north arrow and system summary. R12 format, opens anywhere."
    >
      <SelectField
        label="Drawing units"
        value={unit}
        onChange={(v) => setUnit(v as DxfUnit)}
        options={[
          { value: 'feet', label: 'Feet' },
          { value: 'meters', label: 'Metres' },
        ]}
      />
      <Toggle
        label="Draw individual module footprints"
        checked={includeModules}
        onChange={setIncludeModules}
        hint="Off leaves just the array outlines — a lighter drawing for a busy sheet."
      />
      <button
        type="button"
        disabled={!hasGeometry}
        onClick={exportDxf}
        className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        Export DXF
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500">
        A plan view only — tilt and orientation are recorded per array but the drawing is
        top-down. Roof-mounted arrays are drawn module by module; ground and tracker array
        layout is not yet exported to the drawing (their module count is still in the
        summary).
      </p>
    </Section>
  )
}

interface BomLine {
  category: string
  description: string
  qty: number
  unit: string
  unit_price: number | null
  /** Null when the unit price is unknown. */
  extended: number | null
}

function line(
  category: string,
  description: string,
  qty: number,
  unit: string,
  unit_price: number | null,
): BomLine {
  return {
    category,
    description,
    qty,
    unit,
    unit_price,
    extended: unit_price === null ? null : unit_price * qty,
  }
}

export function BomPanel() {
  const design = useStore((s) => s.design)

  const lines = useMemo(() => {
    const out: BomLine[] = []

    // Modules and mounts, per array.
    for (const array of design.arrays) {
      const mod = catalog.modules.find((m) => m.id === array.module_id)
      const mount = catalog.mounts.find((m) => m.id === array.mount_id)
      const count = moduleCount(array)
      if (mod && count > 0) {
        const each = mod.price_usd_per_w === null ? null : mod.price_usd_per_w * mod.pmax_w
        out.push(line('Module', `${mod.manufacturer} ${mod.model} (${mod.pmax_w} W)`, count, 'ea', each))
      }
      if (mount && count > 0) {
        out.push(
          line(
            'Racking',
            `${mount.manufacturer} ${mount.product_line}`,
            count,
            'per module',
            mount.cost_usd_per_module,
          ),
        )
      }
    }

    for (const id of design.inverter_ids) {
      const inv = catalog.inverters.find((i) => i.id === id)
      if (!inv) continue
      // Microinverters are one per module across the whole design.
      const qty =
        inv.category === 'micro'
          ? design.arrays.reduce((n, a) => n + moduleCount(a), 0)
          : 1
      out.push(line('Inverter', `${inv.manufacturer} ${inv.model}`, qty, 'ea', inv.price_usd))
    }

    const battery = catalog.batteries.find((b) => b.id === design.battery_id)
    if (battery && design.battery_qty > 0) {
      out.push(line('Storage', `${battery.manufacturer} ${battery.model}`, design.battery_qty, 'ea', battery.price_usd))
    }

    const cc = catalog.chargeControllers.find((c) => c.id === design.charge_controller_id)
    if (cc && design.charge_controller_qty > 0) {
      out.push(line('Charge controller', `${cc.manufacturer} ${cc.model}`, design.charge_controller_qty, 'ea', cc.price_usd))
    }

    for (const id of design.evse_ids) {
      const e = catalog.evse.find((x) => x.id === id)
      if (e) out.push(line('EV charging', `${e.manufacturer} ${e.model}`, 1, 'ea', e.price_usd))
    }

    // Balance of system, estimated from module count and system size.
    const totalModules = design.arrays.reduce((n, a) => n + moduleCount(a), 0)
    if (totalModules > 0) {
      const pick = (id: string) => catalog.bos.find((b) => b.id === id)
      const pv10 = pick('pv-wire-10awg')
      const mc4 = pick('mc4-evo2-pair')
      const emt = pick('emt-3-4')
      const acDisc = pick('ac-disconnect-60a-3r')
      const dcDisc = pick('dc-disconnect-60a-3r')
      const labels = pick('label-set-nec')
      const flash = pick('roof-flashing')
      const rod = pick('ground-rod-8ft')
      const spd = pick('spd-type2')

      if (pv10) out.push(line('Wire', pv10.description, totalModules * 8, 'ft', pv10.price_usd))
      if (mc4) out.push(line('Connectors', mc4.description, Math.ceil(totalModules / 6), 'ea', mc4.price_usd))
      if (emt) out.push(line('Conduit', emt.description, 60, 'ft', emt.price_usd))
      if (acDisc) out.push(line('Disconnect', acDisc.description, 1, 'ea', acDisc.price_usd))
      if (dcDisc && design.inverter_ids.some((id) => catalog.inverters.find((i) => i.id === id)?.category !== 'micro')) {
        out.push(line('Disconnect', dcDisc.description, 1, 'ea', dcDisc.price_usd))
      }
      if (spd) out.push(line('Protection', spd.description, 1, 'ea', spd.price_usd))
      if (flash) out.push(line('Roofing', flash.description, Math.ceil(totalModules * 1.5), 'ea', flash.price_usd))
      if (rod) out.push(line('Grounding', rod.description, 1, 'ea', rod.price_usd))
      if (labels) out.push(line('Labels', labels.description, 1, 'set', labels.price_usd))
    }

    return out
  }, [design])

  const priced = lines.filter((l) => l.extended !== null)
  const unpriced = lines.filter((l) => l.extended === null)
  const total = priced.reduce((sum, l) => sum + (l.extended ?? 0), 0)

  const copyCsv = () => {
    const header = 'Category,Description,Qty,Unit,Unit price,Extended'
    const rows = lines.map((l) =>
      [
        l.category,
        `"${l.description.replace(/"/g, '""')}"`,
        l.qty,
        l.unit,
        l.unit_price ?? '',
        l.extended ?? '',
      ].join(','),
    )
    void navigator.clipboard?.writeText([header, ...rows].join('\n'))
  }

  if (lines.length === 0) {
    return (
      <PanelBody>
        <EmptyState title="Nothing to take off yet">
          Add an array to generate a bill of materials.
        </EmptyState>
      </PanelBody>
    )
  }

  return (
    <PanelBody>
      <Section title="Takeoff summary">
        <StatGrid>
          <Stat label="Line items" value={lines.length} />
          <Stat
            label="Priced subtotal"
            value={money(total)}
            hint={unpriced.length > 0 ? `Excludes ${unpriced.length} unpriced item(s)` : undefined}
            tone={unpriced.length > 0 ? 'warn' : 'good'}
          />
        </StatGrid>
        {unpriced.length > 0 ? (
          <p className="rounded border-l-2 border-amber-500/60 bg-amber-500/5 px-2 py-1 text-xs text-amber-200/90">
            {unpriced.length} item{unpriced.length === 1 ? '' : 's'} have no published price
            and are excluded from the subtotal rather than counted as zero. Get a live quote
            before bidding — all prices here are point-in-time estimates.
          </p>
        ) : null}
      </Section>

      <DxfExportSection />

      <Section
        title="Bill of materials"
        right={
          <button
            type="button"
            onClick={copyCsv}
            className="rounded-md border border-ink-600 px-2 py-1 text-xs text-slate-300"
          >
            Copy CSV
          </button>
        }
      >
        <ScrollX>
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b border-ink-600 text-left text-slate-400">
                <th className="py-1.5 pr-3 font-medium">Item</th>
                <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                <th className="py-1.5 pr-3 font-medium">Unit</th>
                <th className="py-1.5 pr-3 text-right font-medium">Each</th>
                <th className="py-1.5 text-right font-medium">Extended</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`${l.description}-${i}`} className="border-b border-ink-700/60">
                  <td className="py-1.5 pr-3">
                    <span className="block text-slate-200">{l.description}</span>
                    <span className="block text-[11px] text-slate-500">{l.category}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">{l.qty}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{l.unit}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums text-slate-400">
                    {money(l.unit_price, '—')}
                  </td>
                  <td
                    className={`py-1.5 text-right whitespace-nowrap tabular-nums ${
                      l.extended === null ? 'text-amber-300/80' : 'text-slate-200'
                    }`}
                  >
                    {money(l.extended, 'no price')}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="py-2 pr-3 text-right font-semibold text-slate-300">
                  Priced subtotal
                </td>
                <td className="py-2 text-right font-semibold tabular-nums text-slate-100">
                  {money(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollX>
      </Section>
    </PanelBody>
  )
}
