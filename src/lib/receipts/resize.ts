import {
  RECEIPT_IMAGE_JPEG_QUALITY,
  RECEIPT_IMAGE_LONG_EDGE,
} from './config'

/**
 * Client-side resize before upload, PHASE5_RECEIPT_PROMPT.md §31-43.
 *
 * Phone photos are 3-5 MB and hotel wifi is the single biggest latency source,
 * so the browser shrinks the image before it ever leaves the device. The
 * server stores exactly these bytes — originals are never uploaded (§169,
 * §193).
 */

export interface TargetSize {
  width: number
  height: number
}

/**
 * Scale so the LONG edge equals `longEdge`, preserving aspect ratio.
 *
 * Never enlarges: a photo already smaller than the target is left alone rather
 * than upscaled into blur that costs upload bytes and buys no detail.
 */
export function targetSize(
  width: number,
  height: number,
  longEdge: number = RECEIPT_IMAGE_LONG_EDGE,
): TargetSize {
  const longest = Math.max(width, height)
  if (longest <= longEdge || longest === 0) return { width, height }
  const scale = longEdge / longest
  return {
    // round, not floor: flooring a 4284x5712 receipt drops a pixel column and
    // shifts the aspect ratio by a hair for no benefit.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Decode a picked file into a bitmap with EXIF orientation ALREADY APPLIED.
 *
 * `imageOrientation: 'from-image'` is the whole point. Every one of the four
 * test fixtures is an iPhone photo with EXIF orientation 6, and a pipeline
 * that ignores it hands the model a receipt lying on its side — proven, not
 * hypothetical: the same fixture resizes to 900x1200 upright with rotation
 * applied and 1200x900 landscape without it.
 */
async function decodeUpright(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export interface ResizedImage {
  blob: Blob
  width: number
  height: number
}

/**
 * Resize a picked photo to the calibrated long edge and re-encode as JPEG.
 *
 * Throws only if the browser cannot decode the file at all; the caller turns
 * that into the manual-entry exit rather than a dead end.
 */
export async function resizeReceiptImage(
  file: Blob,
  longEdge: number = RECEIPT_IMAGE_LONG_EDGE,
): Promise<ResizedImage> {
  const bitmap = await decodeUpright(file)
  try {
    const size = targetSize(bitmap.width, bitmap.height, longEdge)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas 2d context unavailable')
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', RECEIPT_IMAGE_JPEG_QUALITY),
    )
    if (!blob) throw new Error('canvas encode failed')
    return { blob, width: size.width, height: size.height }
  } finally {
    // Bitmaps hold decoded pixels; on a phone, leaking one per scan matters.
    bitmap.close()
  }
}
