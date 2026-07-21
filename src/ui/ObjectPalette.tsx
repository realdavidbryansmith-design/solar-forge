/**
 * Drag-and-drop palette for site objects.
 *
 * Two ways to place, because the app has to work on a phone as well as a
 * desktop:
 *   - Drag an icon onto the scene (desktop pointer / HTML5 drag-and-drop)
 *   - Tap an icon to arm it, then tap the ground (touch)
 *
 * The armed state is shared through the store so the 3D ground can consume it.
 */

import { OBJECT_PRESETS, PALETTE_ORDER } from '../siteObjectPresets'
import { DRAG_MIME } from '../render3d/placement'
import { useStore } from '../store'

export function ObjectPalette() {
  const armedTool = useStore((s) => s.armedTool)
  const setArmedTool = useStore((s) => s.setArmedTool)

  return (
    <div className="pointer-events-none absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-col gap-1">
      <div className="pointer-events-auto flex flex-wrap gap-1 rounded-xl border border-ink-700/80 bg-ink-900/85 p-1.5 backdrop-blur">
        {PALETTE_ORDER.map((kind) => {
          const p = OBJECT_PRESETS[kind]
          const armed = armedTool === kind
          return (
            <button
              key={kind}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_MIME, kind)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => setArmedTool(armed ? null : kind)}
              title={`${p.label} — drag onto the site, or tap then tap the ground`}
              aria-pressed={armed}
              className={`flex w-14 shrink-0 cursor-grab flex-col items-center gap-0.5 rounded-lg border px-1 py-1.5 text-[10px] font-medium active:cursor-grabbing ${
                armed
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-ink-700 bg-ink-800/80 text-slate-300 hover:border-brand-500'
              }`}
            >
              <span aria-hidden className="text-lg leading-none">
                {p.icon}
              </span>
              <span className="w-full truncate text-center">{p.label}</span>
            </button>
          )
        })}
      </div>

      {armedTool ? (
        <div className="pointer-events-auto w-fit rounded-lg border border-brand-500/60 bg-brand-600/20 px-2.5 py-1 text-[11px] text-brand-100 backdrop-blur">
          Tap the ground to place the {OBJECT_PRESETS[armedTool].label.toLowerCase()} ·{' '}
          <button
            type="button"
            onClick={() => setArmedTool(null)}
            className="underline underline-offset-2"
          >
            cancel
          </button>
        </div>
      ) : null}
    </div>
  )
}
