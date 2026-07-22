/**
 * Reading a property photo.
 *
 * Two things come out of an uploaded image: its EXIF metadata (where and when
 * it was taken, which way the camera faced) and a downscaled data URL to lay
 * on the ground as a tracing underlay.
 *
 * The metadata is *suggested*, never auto-applied. A drone records the
 * operator's standing position, not the roof — silently adopting that as the
 * site location would place the whole design in the wrong field.
 */

import exifr from 'exifr'

export interface PhotoMeta {
  latitude: number | null
  longitude: number | null
  /** GPS altitude, metres above sea level. */
  altitude_m: number | null
  /** Compass heading the camera faced, degrees from true north. */
  heading_deg: number | null
  /** ISO timestamp the photo was taken, if recorded. */
  taken: string | null
  /** Camera make/model, for the user to recognise the source. */
  camera: string | null
}

const EMPTY: PhotoMeta = {
  latitude: null,
  longitude: null,
  altitude_m: null,
  heading_deg: null,
  taken: null,
  camera: null,
}

/**
 * Pull the useful EXIF fields from an image file.
 *
 * Never throws — a photo with no EXIF (a screenshot, a stripped export) simply
 * returns all-null, which the UI handles as "no location found".
 */
export async function readPhotoMeta(file: File): Promise<PhotoMeta> {
  try {
    const data = await exifr.parse(file, {
      gps: true,
      pick: [
        'latitude',
        'longitude',
        'GPSAltitude',
        'GPSImgDirection',
        'DateTimeOriginal',
        'CreateDate',
        'Make',
        'Model',
      ],
    })
    if (!data) return { ...EMPTY }

    const make = typeof data.Make === 'string' ? data.Make.trim() : ''
    const model = typeof data.Model === 'string' ? data.Model.trim() : ''
    const camera = [make, model].filter(Boolean).join(' ') || null

    const taken =
      data.DateTimeOriginal instanceof Date
        ? data.DateTimeOriginal.toISOString()
        : data.CreateDate instanceof Date
          ? data.CreateDate.toISOString()
          : null

    return {
      latitude: Number.isFinite(data.latitude) ? data.latitude : null,
      longitude: Number.isFinite(data.longitude) ? data.longitude : null,
      altitude_m: Number.isFinite(data.GPSAltitude) ? data.GPSAltitude : null,
      heading_deg: Number.isFinite(data.GPSImgDirection) ? data.GPSImgDirection : null,
      taken,
      camera,
    }
  } catch {
    return { ...EMPTY }
  }
}

export interface LoadedImage {
  dataUrl: string
  /** Pixel dimensions after any downscale, for the ground-plane aspect ratio. */
  width_px: number
  height_px: number
}

/** Longest edge a stored underlay is downscaled to, pixels. */
const MAX_EDGE_PX = 2048

/**
 * Load an image file to a data URL, downscaled so a 12 MP drone photo does not
 * sit in memory at full size or blow the GPU texture budget on a phone.
 *
 * The aspect ratio is preserved and returned so the ground plane can match it.
 */
export async function loadImageForUnderlay(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)

    // JPEG keeps the data URL small; aerial photos have no transparency to lose.
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width_px: w, height_px: h }
  } finally {
    bitmap.close()
  }
}
