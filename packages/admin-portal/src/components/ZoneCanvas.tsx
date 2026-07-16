/**
 * ZoneCanvas.tsx — draw bounding boxes directly on a reference photo of
 * the document template.
 * ============================================================================
 * This is Template Studio's signature interaction: rather than asking an
 * admin to type raw pixel coordinates into a form (accurate but
 * meaningless to look at, and easy to get subtly wrong), they draw the QR
 * position, each OCR zone, and each reference asset directly on an image
 * of the real document — the same document a phone camera will
 * eventually photograph and Engine 2 will align against.
 *
 * Boxes are stored and reported in the image's NATURAL pixel dimensions
 * (not the responsively-scaled displayed size) — this is exactly the
 * page_width/page_height coordinate space app/pipeline/homography.py
 * aligns every captured photo into, so what's drawn here maps directly
 * onto backend's layoutJson/boundingBox fields with no unit conversion
 * required anywhere else in this app.
 */
import React, { useRef, useState } from 'react';
import { BoundingBox } from '../lib/types';
import './ZoneCanvas.css';

export interface CanvasBox {
  id: string;
  box: BoundingBox;
  color: string;
  label: string;
}

interface Props {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  boxes: CanvasBox[];
  /** Color used for the box currently being drawn. Drawing is disabled when this is undefined. */
  drawColor?: string;
  onDraw?: (box: BoundingBox) => void;
}

export function ZoneCanvas({ imageUrl, naturalWidth, naturalHeight, boxes, drawColor, onDraw }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  const toNaturalPoint = (clientX: number, clientY: number) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    const px = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const py = Math.min(Math.max(clientY - rect.top, 0), rect.height);
    return {
      x: Math.round((px / rect.width) * naturalWidth),
      y: Math.round((py / rect.height) * naturalHeight),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!drawColor) return;
    overlayRef.current?.setPointerCapture(e.pointerId);
    const pt = toNaturalPoint(e.clientX, e.clientY);
    setDragStart(pt);
    setDragCurrent(pt);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStart) return;
    setDragCurrent(toNaturalPoint(e.clientX, e.clientY));
  };

  const handlePointerUp = () => {
    if (!dragStart || !dragCurrent || !onDraw) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const width = Math.abs(dragCurrent.x - dragStart.x);
    const height = Math.abs(dragCurrent.y - dragStart.y);
    setDragStart(null);
    setDragCurrent(null);
    // Ignore accidental clicks/taps that produce a near-zero-area box.
    if (width < 8 || height < 8) return;
    onDraw({ x, y, width, height });
  };

  const pctBox = (box: BoundingBox): React.CSSProperties => ({
    left: `${(box.x / naturalWidth) * 100}%`,
    top: `${(box.y / naturalHeight) * 100}%`,
    width: `${(box.width / naturalWidth) * 100}%`,
    height: `${(box.height / naturalHeight) * 100}%`,
  });

  const draftBox: BoundingBox | null =
    dragStart && dragCurrent
      ? {
          x: Math.min(dragStart.x, dragCurrent.x),
          y: Math.min(dragStart.y, dragCurrent.y),
          width: Math.abs(dragCurrent.x - dragStart.x),
          height: Math.abs(dragCurrent.y - dragStart.y),
        }
      : null;

  return (
    <div className="zc-wrap">
      <div className="zc-frame">
        <div className="zc-reg-mark zc-reg-tl" />
        <div className="zc-reg-mark zc-reg-tr" />
        <div className="zc-reg-mark zc-reg-bl" />
        <div className="zc-reg-mark zc-reg-br" />
        <img src={imageUrl} alt="Document template reference" className="zc-image" draggable={false} />
        <div
          ref={overlayRef}
          className={`zc-overlay ${drawColor ? '' : 'no-draw'}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {boxes.map((b) => (
            <div key={b.id} className="zc-box" style={{ ...pctBox(b.box), ['--box-color' as any]: b.color }}>
              <span className="zc-tag">{b.label}</span>
            </div>
          ))}
          {draftBox && (
            <div
              className="zc-box zc-box-draft"
              style={{ ...pctBox(draftBox), ['--box-color' as any]: drawColor }}
            />
          )}
        </div>
      </div>
      {drawColor && <div className="zc-hint">Click and drag on the document to draw a box</div>}
    </div>
  );
}
