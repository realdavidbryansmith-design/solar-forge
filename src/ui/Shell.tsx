/**
 * App shell.
 *
 * Phone: 3D view on top, scrollable panel beneath, tab bar pinned to the
 * bottom inside the safe area.
 * Tablet and up: fixed side panel on the left, 3D fills the rest.
 *
 * The page itself never scrolls horizontally — every wide element scrolls
 * inside its own container.
 */

import type { PanelId } from '../store'
import { useStore } from '../store'
import { Scene } from '../render3d'
import { ArrayPanel, ElectricalPanel, EvPanel, SitePanel, StoragePanel } from './panels'
import { WizardPanel } from './WizardPanel'
import { CompliancePanel } from './CompliancePanel'
import { BomPanel } from './BomPanel'
import { ObjectPalette } from './ObjectPalette'
import { DRAG_MIME, screenToGround } from '../render3d/placement'
import { makeSiteObject } from '../siteObjectPresets'
import type { SiteObjectKind } from '../types'

interface Tab {
  id: PanelId
  label: string
  /** Narrow form for the phone tab bar, where seven cells share 375px. */
  short?: string
  icon: string
}

const TABS: Tab[] = [
  { id: 'wizard', label: 'Start', icon: '✨' },
  { id: 'site', label: 'Site', icon: '📍' },
  { id: 'array', label: 'Array', icon: '▦' },
  { id: 'electrical', label: 'Electrical', short: 'Elec', icon: '⚡' },
  { id: 'storage', label: 'Storage', short: 'Batt', icon: '🔋' },
  { id: 'ev', label: 'EV', icon: '🚗' },
  { id: 'compliance', label: 'Code', icon: '§' },
  { id: 'bom', label: 'BOM', icon: '📋' },
]

function ActivePanel({ id }: { id: PanelId }) {
  switch (id) {
    case 'wizard':
      return <WizardPanel />
    case 'site':
      return <SitePanel />
    case 'array':
      return <ArrayPanel />
    case 'electrical':
      return <ElectricalPanel />
    case 'storage':
      return <StoragePanel />
    case 'ev':
      return <EvPanel />
    case 'compliance':
      return <CompliancePanel />
    case 'bom':
      return <BomPanel />
  }
}

export function Shell() {
  const activePanel = useStore((s) => s.activePanel)
  const setPanel = useStore((s) => s.setPanel)
  const designName = useStore((s) => s.design.name)
  const addSiteObject = useStore((s) => s.addSiteObject)

  /** Drop from the palette: project the pointer onto the ground and place. */
  const handleDrop = (e: React.DragEvent<HTMLElement>) => {
    const kind = e.dataTransfer.getData(DRAG_MIME) as SiteObjectKind
    if (!kind) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const spot = screenToGround(e.clientX, e.clientY, rect)
    if (!spot) return
    const existing = useStore.getState().design.site_objects
    addSiteObject(makeSiteObject(kind, spot.x, spot.y, existing))
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden md:flex-row">
      {/* ---- Side panel (desktop) / bottom sheet (mobile) ---- */}
      <aside className="order-2 flex min-h-0 min-w-0 flex-1 flex-col border-ink-700 md:order-1 md:w-[380px] md:flex-none md:border-r">
        <header className="safe-top hidden shrink-0 items-baseline gap-2 border-b border-ink-700 px-4 py-3 md:flex">
          <span className="text-sm font-bold tracking-wide text-slate-100">SolarForge</span>
          <span className="min-w-0 truncate text-xs text-slate-500">{designName}</span>
        </header>

        {/*
          Desktop tab rail. Wraps rather than scrolls: the panel is a fixed
          380px and seven labels do not fit on one line, so scrolling would
          silently hide the last tab off the right edge.
        */}
        <nav className="hidden shrink-0 flex-wrap gap-0.5 border-b border-ink-700 px-1.5 py-2 md:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPanel(t.id)}
              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                activePanel === t.id
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <ActivePanel id={activePanel} />
        </div>
      </aside>

      {/* ---- 3D view ---- */}
      <main
        className="relative order-1 h-[45vh] w-full shrink-0 md:order-2 md:h-full md:min-w-0 md:flex-1"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDrop={handleDrop}
      >
        <ObjectPalette />
        <Scene />
      </main>

      {/*
        Mobile tab bar. All seven tabs must fit a 375px screen without
        scrolling, so each cell is allowed to shrink below its content width
        and the label truncates rather than pushing the last tab off-screen.
      */}
      <nav className="safe-bottom order-3 shrink-0 border-t border-ink-700 bg-ink-900 md:hidden">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPanel(t.id)}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-2 text-[10px] font-medium ${
                activePanel === t.id ? 'text-brand-400' : 'text-slate-500'
              }`}
            >
              <span aria-hidden className="text-base leading-none">
                {t.icon}
              </span>
              <span className="w-full truncate text-center">{t.short ?? t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
