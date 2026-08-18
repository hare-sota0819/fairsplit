/**
 * Tunables for the receipt-scanning path. Everything a reviewer might want to
 * change lives here rather than being spread across the route and the client.
 */

/**
 * The Gemini model that reads receipts.
 *
 * GA, deliberately. Phase 5 first shipped `gemini-3-flash-preview`, and a
 * preview id can be withdrawn without notice — mid-trip, on the one feature
 * that has no offline fallback beyond typing the receipt in by hand. The
 * 2026-08-09 calibration ran the GA model over the same four fixtures at the
 * same settings and it matched the preview model exactly (8/8 vs 20/20 line-
 * item-exact), so the risk buys nothing. See docs/PHASE5_CALIBRATION.md.
 *
 * It costs more per scan ($1.50/M in, $9.00/M out against $0.50/$3.00) but
 * turning thinking off (below) more than pays that back.
 */
export const RECEIPT_MODEL_ID = 'gemini-3.5-flash'

/**
 * Long edge, in pixels, that a photo is resized to before it is uploaded.
 *
 * Fixed by the Phase 5 calibration (docs/PHASE5_CALIBRATION.md). Note what
 * that calibration found: token cost does NOT track pixel size — input tokens
 * are a pure function of media resolution and were identical at 5712 px and
 * 1200 px. Resizing buys upload speed, which is the latency the brief actually
 * cares about, and nothing else.
 *
 * 1800 gives a 221 KB upload, inside the brief's 200-500 KB target. The
 * measured receipt lost nothing even at 1200, but only one of the four test
 * receipts got through before the daily quota ran out, and the three that did
 * not are the dense and crumpled ones most likely to need the pixels.
 */
export const RECEIPT_IMAGE_LONG_EDGE = 1800

/** JPEG quality for that re-encode. Brief §37. */
export const RECEIPT_IMAGE_JPEG_QUALITY = 0.8

/**
 * How much image detail the model is billed for — the real input-token lever,
 * which the brief does not mention.
 *
 * HIGH equals today's default (both bill 1503 input tokens), pinned explicitly
 * so a provider-side default change cannot silently move accuracy or cost.
 * LOW would save ~798 input tokens, under 5% of a scan's bill, which is not
 * worth trading against unmeasured accuracy on dense receipts — thinking
 * tokens, not input, are where the money goes.
 */
export const RECEIPT_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH'

/** Per-user scans per calendar day. Brief §181. */
export const RECEIPT_DAILY_SCAN_LIMIT = 50

/**
 * Thinking tokens the model may spend before answering. 0 = off.
 *
 * Thinking was ~91% of the bill and most of the latency, and the 2026-08-09
 * comparison found it buys nothing on receipts: 8/8 line-item-exact with it
 * on, 8/8 with it off, on the same four fixtures at the same settings. Off,
 * the median scan takes 2.2 s instead of 7.3 s and costs $0.0044 instead of
 * $0.0168.
 *
 * This is the setting to reach for FIRST if a receipt ever parses wrong —
 * raising it is the cheap experiment, and the numbers above are the baseline
 * to beat.
 */
export const RECEIPT_THINKING_BUDGET = 0

/**
 * Hard client-side timeout for a parse. Brief §161.
 *
 * Left at the brief's 30 s. It was the wrong ceiling while thinking was on —
 * the slowest observed parse was 43.9 s — but with thinking off the slowest
 * of 16 measured scans was 2.9 s, so 30 s is now ~10x the worst case rather
 * than under it.
 */
export const RECEIPT_PARSE_TIMEOUT_MS = 30_000

/**
 * Upload ceiling for the resized image. The brief targets 200-500 KB
 * (§43); this is the point at which we refuse rather than pay to upload a
 * photo that a resize should already have shrunk.
 */
export const RECEIPT_MAX_UPLOAD_BYTES = 2_000_000

/** Storage bucket for receipt photos. Private; reads go through signed URLs. */
export const RECEIPT_BUCKET = 'receipts'

/** Lifetime of a signed receipt-image URL. */
export const RECEIPT_SIGNED_URL_TTL_SECONDS = 300
