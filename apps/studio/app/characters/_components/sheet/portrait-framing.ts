/**
 * Nondestructive portrait framing (PAS-10 M6-WO5 §12–§13). The stored source image is never cropped or resized: the
 * frame shows it scaled to COVER the frame (aspect ratio preserved, never stretched), then `zoom` (≥ 1) enlarges it
 * and `offsetX` / `offsetY` (each −1 … 1) choose which part of the overflow is visible (−1 = left / top edge,
 * 0 = centred, 1 = right / bottom edge). Presentation geometry only — never a rule.
 */
export interface Framing {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 5;
export const DEFAULT_FRAMING: Framing = { zoom: 1, offsetX: 0, offsetY: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The image box inside the frame, in percent of the frame. Width / height keep the source aspect ratio exactly. */
export function framedImageBox(image: { readonly width: number; readonly height: number }, frameAspect: number, framing: Framing): { widthPct: number; heightPct: number; leftPct: number; topPct: number } {
  const zoom = clamp(framing.zoom, ZOOM_MIN, ZOOM_MAX);
  const imageAspect = image.width / image.height;
  // Cover: the shorter relative side fills the frame.
  const widthPct = imageAspect >= frameAspect ? 100 * zoom * (imageAspect / frameAspect) : 100 * zoom;
  const heightPct = imageAspect >= frameAspect ? 100 * zoom : 100 * zoom * (frameAspect / imageAspect);
  const overflowX = widthPct - 100;
  const overflowY = heightPct - 100;
  return {
    widthPct,
    heightPct,
    leftPct: -(overflowX / 2) * (1 + clamp(framing.offsetX, -1, 1)),
    topPct: -(overflowY / 2) * (1 + clamp(framing.offsetY, -1, 1)),
  };
}

/** Converts a pointer drag (pixels) into new offsets: dragging right reveals more of the left side. */
export function dragFraming(framing: Framing, box: { widthPct: number; heightPct: number }, frame: { width: number; height: number }, dx: number, dy: number): Framing {
  const overflowXPx = ((box.widthPct - 100) / 100) * frame.width;
  const overflowYPx = ((box.heightPct - 100) / 100) * frame.height;
  return {
    zoom: framing.zoom,
    offsetX: overflowXPx <= 0 ? 0 : clamp(framing.offsetX - (2 * dx) / overflowXPx, -1, 1),
    offsetY: overflowYPx <= 0 ? 0 : clamp(framing.offsetY - (2 * dy) / overflowYPx, -1, 1),
  };
}
