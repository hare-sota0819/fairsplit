import { describe, expect, it } from 'vitest'
import { targetSize } from './resize'

describe('targetSize', () => {
  it('scales a portrait phone photo so the long edge (its height) hits the target', () => {
    // The fixtures after EXIF rotation: 4284x5712.
    expect(targetSize(4284, 5712, 1800)).toEqual({ width: 1350, height: 1800 })
  })

  it('scales a landscape photo by its width instead', () => {
    expect(targetSize(5712, 4284, 1800)).toEqual({ width: 1800, height: 1350 })
  })

  it('preserves the aspect ratio', () => {
    const { width, height } = targetSize(4032, 3024, 1500)
    expect(width / height).toBeCloseTo(4032 / 3024, 5)
  })

  it('never enlarges an image that is already smaller', () => {
    expect(targetSize(800, 600, 1800)).toEqual({ width: 800, height: 600 })
  })

  it('leaves an image exactly at the target alone', () => {
    expect(targetSize(1350, 1800, 1800)).toEqual({ width: 1350, height: 1800 })
  })

  it('handles a square image', () => {
    expect(targetSize(3000, 3000, 1200)).toEqual({ width: 1200, height: 1200 })
  })

  it('never returns a zero dimension for an extreme aspect ratio', () => {
    // A very long till roll photographed edge-on.
    const size = targetSize(40, 8000, 1200)
    expect(size.height).toBe(1200)
    expect(size.width).toBeGreaterThanOrEqual(1)
  })

  it('tolerates a zero-sized input rather than dividing by zero', () => {
    expect(targetSize(0, 0, 1800)).toEqual({ width: 0, height: 0 })
  })

  it('uses the calibrated default when no long edge is given', () => {
    // RECEIPT_IMAGE_LONG_EDGE, fixed by the Phase 5 calibration.
    expect(targetSize(4284, 5712)).toEqual({ width: 1350, height: 1800 })
  })
})
