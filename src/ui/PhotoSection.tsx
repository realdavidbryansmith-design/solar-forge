/**
 * Aerial photo import and underlay controls.
 *
 * Drop or capture a top-down drone shot, scale it to a real dimension, and
 * trace the property over it. EXIF location is *suggested*, never applied
 * silently — a drone's GPS is the operator's position, not the roof.
 */

import { useRef, useState } from 'react'
import type { PhotoMeta } from '../engine/photo'
import { loadImageForUnderlay, readPhotoMeta } from '../engine/photo'
import { useStore } from '../store'
import {
  NumberField,
  Section,
  SliderField,
  Toggle,
} from './controls'

export function PhotoSection() {
  const image = useStore((s) => s.design.site_image)
  const setSiteImage = useStore((s) => s.setSiteImage)
  const updateSiteImage = useStore((s) => s.updateSiteImage)
  const updateSite = useStore((s) => s.updateSite)

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [meta, setMeta] = useState<PhotoMeta | null>(null)
  const [metaApplied, setMetaApplied] = useState(false)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setMetaApplied(false)
    try {
      const [loaded, m] = await Promise.all([
        loadImageForUnderlay(file),
        readPhotoMeta(file),
      ])
      setSiteImage({
        data_url: loaded.dataUrl,
        aspect: loaded.width_px / Math.max(1, loaded.height_px),
        x: 0,
        y: 0,
        // A guess the user corrects against a known dimension.
        width_m: 30,
        rotation_deg: 0,
        opacity: 0.85,
        visible: true,
      })
      setMeta(m)
    } finally {
      setBusy(false)
      // Allow re-selecting the same file later.
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyLocation = () => {
    if (meta?.latitude == null || meta?.longitude == null) return
    updateSite({
      latitude_deg: meta.latitude,
      longitude_deg: meta.longitude,
      ...(meta.altitude_m != null ? { elevation_m: meta.altitude_m } : {}),
    })
    setMetaApplied(true)
  }

  const hasGps = meta?.latitude != null && meta?.longitude != null

  return (
    <Section
      title="Aerial photo"
      hint="Import a top-down drone or satellite shot, scale it to a known dimension, then trace your buildings and trees over it with the palette on the 3D view."
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        // On a phone this offers the camera as well as the library.
        capture="environment"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Reading photo…' : image ? 'Replace photo' : 'Import a photo'}
      </button>

      {/* EXIF suggestion — never auto-applied. */}
      {meta ? (
        hasGps ? (
          <div className="rounded-lg border border-brand-500/50 bg-brand-600/10 p-3 text-xs">
            <p className="font-medium text-slate-200">Location found in the photo</p>
            <p className="mt-1 text-slate-400">
              {meta.latitude!.toFixed(5)}, {meta.longitude!.toFixed(5)}
              {meta.altitude_m != null ? ` · ${Math.round(meta.altitude_m)} m` : ''}
              {meta.camera ? ` · ${meta.camera}` : ''}
            </p>
            <p className="mt-1 leading-relaxed text-amber-200/80">
              This is where the camera was, which for a drone is the take-off point,
              not the roof. Check it before applying.
            </p>
            {metaApplied ? (
              <p className="mt-2 font-medium text-emerald-300">Applied to the site.</p>
            ) : (
              <button
                type="button"
                onClick={applyLocation}
                className="mt-2 rounded-md border border-brand-500 px-2 py-1 font-medium text-brand-200"
              >
                Use as site location
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            No location metadata in this photo{meta.camera ? ` (${meta.camera})` : ''}. You
            can still use it as a tracing underlay.
          </p>
        )
      ) : null}

      {/* Underlay placement controls. */}
      {image ? (
        <>
          <NumberField
            label="Image width in real life"
            unit="m"
            emphasis
            min={1}
            step={0.5}
            value={image.width_m}
            onChange={(v) => updateSiteImage({ width_m: v ?? 1 })}
            hint="Match it against something you know the size of — a house wall, a driveway."
          />
          <SliderField
            label="Rotation"
            value={image.rotation_deg}
            onChange={(v) => updateSiteImage({ rotation_deg: v })}
            min={0}
            max={360}
            readout={`${Math.round(image.rotation_deg)}°`}
          />
          <SliderField
            label="Opacity"
            value={image.opacity}
            onChange={(v) => updateSiteImage({ opacity: v })}
            min={0.1}
            max={1}
            step={0.05}
            readout={`${Math.round(image.opacity * 100)}%`}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Move east / west"
              unit="m"
              step={0.5}
              value={image.x}
              onChange={(v) => updateSiteImage({ x: v ?? 0 })}
            />
            <NumberField
              label="Move north / south"
              unit="m"
              step={0.5}
              value={image.y}
              onChange={(v) => updateSiteImage({ y: v ?? 0 })}
            />
          </div>
          <Toggle
            label="Show underlay"
            checked={image.visible}
            onChange={(v) => updateSiteImage({ visible: v })}
          />
          <button
            type="button"
            onClick={() => {
              setSiteImage(null)
              setMeta(null)
            }}
            className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300"
          >
            Remove photo
          </button>
          <p className="text-[11px] leading-relaxed text-slate-500">
            The photo is a visual reference only — it is not stored with the design when you
            leave, and nothing is measured from it automatically.
          </p>
        </>
      ) : null}
    </Section>
  )
}
