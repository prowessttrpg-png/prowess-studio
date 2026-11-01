"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { CharacterApiError, removePortrait, updatePortraitTransform, uploadPortrait, type CharacterSheetDto } from "../../_lib/character-client";
import { DEFAULT_FRAMING, ZOOM_MAX, ZOOM_MIN, dragFraming, framedImageBox, type Framing } from "./portrait-framing";
import { PaperclipIcon, PersonnelSilhouette } from "./SheetIcons";

/**
 * The Character Portrait (PAS-10 M6-WO5 §9–§15): the attached personnel photograph of the Field Manual sheet. The
 * stored image is shown through its saved NONDESTRUCTIVE framing (cover-fit, zoom, offsets — never stretched). The
 * editor uploads / replaces / removes the image and adjusts the framing by drag, keyboard or zoom slider; only the
 * framing numbers are saved, never a re-cut image. Without a portrait the subdued silhouette is shown.
 */
const FRAME_ASPECT = 3 / 4;
const ACCEPT = "image/png,image/jpeg,image/webp";

type Portrait = CharacterSheetDto["portrait"];

function FramedImage({ portrait, framing, alt }: { portrait: Portrait; framing: Framing; alt: string }) {
  if (!portrait.hasImage || portrait.imageUrl === null || portrait.width === null || portrait.height === null) {
    return <PersonnelSilhouette className="sheet-portrait__silhouette" data-testid="portrait-placeholder" />;
  }
  const box = framedImageBox({ width: portrait.width, height: portrait.height }, FRAME_ASPECT, framing);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the bytes are served by the application's own protected route
    <img
      src={portrait.imageUrl}
      alt={alt}
      draggable={false}
      className="sheet-portrait__image"
      data-testid="portrait-image"
      data-zoom={framing.zoom}
      data-offset-x={framing.offsetX}
      data-offset-y={framing.offsetY}
      style={{ width: `${box.widthPct}%`, height: `${box.heightPct}%`, left: `${box.leftPct}%`, top: `${box.topPct}%` }}
    />
  );
}

export function PortraitFrame({ sheet, editable, onSheet }: { sheet: CharacterSheetDto; editable: boolean; onSheet: (next: CharacterSheetDto) => void }) {
  const portrait = sheet.portrait;
  const saved: Framing = { zoom: portrait.zoom, offsetX: portrait.offsetX, offsetY: portrait.offsetY };
  const name = sheet.identity.name;
  const [open, setOpen] = useState(false);
  return (
    <div className="sheet-portrait">
      <PaperclipIcon className="sheet-portrait__clip" />
      <figure className="sheet-portrait__photo" data-testid="portrait-photo" aria-label={portrait.hasImage ? `Portrait of ${name}` : `No portrait for ${name}`}>
        <div className="sheet-portrait__frame">
          <FramedImage portrait={portrait} framing={saved} alt={`Portrait of ${name}`} />
        </div>
      </figure>
      {editable ? (
        <button type="button" className="sheet-button sheet-portrait__edit" onClick={() => setOpen(true)} aria-haspopup="dialog">
          {portrait.hasImage ? "Edit portrait" : "Add portrait"}
        </button>
      ) : null}
      {open ? <PortraitEditor sheet={sheet} onSheet={onSheet} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function PortraitEditor({ sheet, onSheet, onClose }: { sheet: CharacterSheetDto; onSheet: (next: CharacterSheetDto) => void; onClose: () => void }) {
  const portrait = sheet.portrait;
  const [framing, setFraming] = useState<Framing>({ zoom: portrait.zoom, offsetX: portrait.offsetX, offsetY: portrait.offsetY });
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; start: Framing } | null>(null);
  const maxMb = portrait.maxBytes / (1024 * 1024);

  const run = async (action: () => Promise<CharacterSheetDto>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await action();
      onSheet(next);
      setFraming({ zoom: next.portrait.zoom, offsetX: next.portrait.offsetX, offsetY: next.portrait.offsetY });
      setMessage({ kind: "ok", text: done });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof CharacterApiError ? `${e.message} (${e.code})` : "The portrait could not be saved." });
    } finally {
      setBusy(false);
    }
  };
  const onFile = (file: File | undefined) => {
    if (file === undefined) return;
    if (file.size > portrait.maxBytes) {
      setMessage({ kind: "error", text: `That image is larger than ${maxMb} MB. Choose a smaller PNG, JPEG or WebP image.` });
      return;
    }
    void run(() => uploadPortrait(sheet.identity.id, portrait.version, file), portrait.hasImage ? "Portrait replaced." : "Portrait uploaded. Drag or zoom to frame it, then save.");
  };
  const box = portrait.width !== null && portrait.height !== null ? framedImageBox({ width: portrait.width, height: portrait.height }, FRAME_ASPECT, framing) : null;
  const move = (dx: number, dy: number, start: Framing) => {
    const el = frameRef.current;
    if (el === null || box === null) return;
    const rect = el.getBoundingClientRect();
    setFraming(dragFraming(start, framedImageBox({ width: portrait.width as number, height: portrait.height as number }, FRAME_ASPECT, start), { width: rect.width || 240, height: rect.height || 320 }, dx, dy));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 12;
    const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key as "ArrowLeft"];
    if (delta === undefined) return;
    e.preventDefault();
    move(delta[0] as number, delta[1] as number, framing);
  };

  return (
    <div className="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="portrait-editor-title">
      <div className="sheet-dialog__body">
        <h2 id="portrait-editor-title">Character portrait</h2>
        <p className="sheet-muted">PNG, JPEG or WebP, up to {maxMb} MB. Framing never crops or changes your original image.</p>
        {portrait.hasImage ? (
          <>
            <div
              ref={frameRef}
              className="sheet-portrait__frame sheet-portrait__frame--editor"
              data-testid="portrait-editor-frame"
              tabIndex={0}
              role="application"
              aria-label="Portrait framing area. Drag, or use the arrow keys, to reposition the image."
              onKeyDown={onKey}
              onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY, start: framing };
              }}
              onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
                if (drag.current !== null) move(e.clientX - drag.current.x, e.clientY - drag.current.y, drag.current.start);
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
            >
              <FramedImage portrait={portrait} framing={framing} alt="Portrait being framed" />
            </div>
            <label className="sheet-field">
              <span>Zoom</span>
              <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={framing.zoom} onChange={(e) => setFraming({ ...framing, zoom: Number(e.target.value) })} />
            </label>
            <p className="sheet-actions">
              <button type="button" className="sheet-button" disabled={busy} onClick={() => setFraming(DEFAULT_FRAMING)}>
                Reset framing
              </button>
              <button type="button" className="sheet-button sheet-button--primary" disabled={busy} onClick={() => void run(() => updatePortraitTransform(sheet.identity.id, portrait.version, framing), "Framing saved.")}>
                Save framing
              </button>
            </p>
          </>
        ) : null}
        <p className="sheet-actions">
          <label className="sheet-button sheet-file">
            {portrait.hasImage ? "Replace image" : "Upload portrait image"}
            <input type="file" accept={ACCEPT} aria-label={portrait.hasImage ? "Replace portrait image" : "Upload portrait image"} disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {portrait.hasImage ? (
            <button type="button" className="sheet-button" disabled={busy} onClick={() => void run(() => removePortrait(sheet.identity.id, portrait.version), "Portrait removed.")}>
              Remove portrait
            </button>
          ) : null}
          <button type="button" className="sheet-button" onClick={onClose}>
            Close
          </button>
        </p>
        {message !== null ? (
          <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "sheet-error" : "sheet-ok"} data-testid="portrait-message">
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
