/**
 * Default dimensions and iconography for placeable site objects.
 *
 * Shared by the drag-and-drop palette and the Site panel list so the two can
 * never disagree about what a "barn" is.
 */

import type { SiteObject, SiteObjectKind } from './types'

export interface ObjectPreset {
  label: string
  icon: string
  width: number
  depth: number
  height: number
  pitch: number
}

export const OBJECT_PRESETS: Record<SiteObjectKind, ObjectPreset> = {
  house: { label: 'House', icon: '\u{1F3E0}', width: 12, depth: 8, height: 3, pitch: 25 },
  barn: { label: 'Barn', icon: '\u{1F6D6}', width: 14, depth: 9, height: 5, pitch: 30 },
  garage: { label: 'Garage', icon: '\u{1F697}', width: 7, depth: 6, height: 2.7, pitch: 20 },
  shed: { label: 'Shed', icon: '\u{1F3DA}', width: 3, depth: 2.5, height: 2.2, pitch: 15 },
  'tree-deciduous': { label: 'Tree', icon: '\u{1F333}', width: 7, depth: 7, height: 9, pitch: 0 },
  'tree-conifer': { label: 'Conifer', icon: '\u{1F332}', width: 4.5, depth: 4.5, height: 12, pitch: 0 },
}

export const PALETTE_ORDER: SiteObjectKind[] = [
  'house',
  'barn',
  'garage',
  'shed',
  'tree-deciduous',
  'tree-conifer',
]

/** Monotonic suffix so two objects dropped on the same spot never collide. */
let idCounter = 0

/**
 * Build a site object of the given kind at a plan position.
 *
 * Numbering is per kind — the second barn is "Barn 2" regardless of how many
 * trees are already on the site.
 */
export function makeSiteObject(
  kind: SiteObjectKind,
  x: number,
  y: number,
  existing: readonly SiteObject[],
): SiteObject {
  const p = OBJECT_PRESETS[kind]
  const sameKind = existing.filter((o) => o.kind === kind).length
  idCounter += 1
  return {
    id: `obj-${kind}-${idCounter}`,
    kind,
    name: `${p.label} ${sameKind + 1}`,
    x,
    y,
    rotation_deg: 0,
    width_m: p.width,
    depth_m: p.depth,
    height_m: p.height,
    roof_pitch_deg: p.pitch,
  }
}
