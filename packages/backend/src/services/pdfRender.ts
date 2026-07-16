/**
 * pdfRender.ts — renders one printable credential PDF from a template's
 * own declared layout.
 * ============================================================================
 * Deliberately safe to run on the networked backend: nothing here touches
 * a private key. It only lays out already-public information (field
 * values the issuer already signed, and a QR image built from an
 * already-computed hash+signature pair a signed batch upload carries) onto
 * a page, using the exact positions Template Studio's zone canvas captured
 * (see admin-portal/src/components/ZoneCanvas.tsx's header) — the same
 * coordinate space app/pipeline/homography.py aligns a captured phone
 * photo into.
 *
 * PHOTO ZONES (e.g. a student's own photo): rendered PURELY as a visual
 * placement, at the position schema.prisma's PhotoZone model declares —
 * nothing here verifies whose photo it is (see that model's header for
 * why that's a deliberately separate, unsolved problem). If a declared
 * photo zone has no matching image supplied, this renders an empty
 * placeholder box with the zone's field name printed inside it, rather
 * than failing the whole PDF — a missing photo for one student shouldn't
 * block generating the other 199 in the same batch; it just prints an
 * obviously-incomplete box a human will notice immediately.
 *
 * KNOWN SIMPLIFICATION: a template's page_width/page_height (captured from
 * a reference photo's pixel dimensions) are used here as PDF POINTS
 * directly (72 points/inch), with no DPI conversion — nothing in the
 * schema tracks the reference photo's original DPI, so there's no honest
 * way to convert precisely. This means a page can render larger or smaller
 * than the physical original once printed. Fine for a first working
 * version; revisit if precise print sizing ever matters.
 */
import PDFDocument from 'pdfkit';
import { CredentialPayload } from '@trustanchor/shared';
import { buildQrBytes, renderQrPngBuffer } from './qr';

export interface TemplateForRender {
  name: string;
  layoutJson: { page_width: number; page_height: number; qr_position: number[][] };
  ocrZones: Array<{ fieldName: string; boundingBox: { x: number; y: number; width: number; height: number }; isMandatory: boolean }>;
  photoZones: Array<{ fieldName: string; boundingBox: { x: number; y: number; width: number; height: number }; isMandatory: boolean }>;
  /** The reference photo uploaded in Template Studio, if any — drawn as the page's actual background, before anything else (see module docstring). */
  backgroundImage?: Buffer | null;
}

export interface RenderCredentialPdfInput {
  payload: CredentialPayload;
  contentHashHex: string;
  signatureHex: string;
  template: TemplateForRender;
  /** fieldName -> raw image bytes, e.g. { student_photo: <jpeg buffer> }. Missing entries for a declared photo zone are rendered as an empty placeholder box, not a hard failure — see the module docstring on why a missing/late photo shouldn't block issuing the rest of the credential. */
  photos?: Record<string, Buffer>;
}

function qrBoundingBox(qrPosition: number[][]): { x: number; y: number; width: number; height: number } {
  const xs = qrPosition.map((p) => p[0]);
  const ys = qrPosition.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export async function renderCredentialPdf(input: RenderCredentialPdfInput): Promise<Buffer> {
  const { payload, contentHashHex, signatureHex, template } = input;
  const { page_width, page_height, qr_position } = template.layoutJson;

  const qrBytes = buildQrBytes({
    issuerId: payload.issuer_id,
    docId: payload.doc_id,
    contentHashHex,
    signatureHex,
  });
  const qrPngBuffer = await renderQrPngBuffer(qrBytes);

  const doc = new PDFDocument({ size: [page_width, page_height], margin: 0 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (template.backgroundImage) {
    // The reference photo IS the printed background — university name,
    // prose sentences, seal, decorative border, everything static, comes
    // from these exact pixels, drawn first so everything else layers on
    // top of it. This is what actually reproduces a real certificate's
    // look, rather than the bare-bones fallback below.
    doc.image(template.backgroundImage, 0, 0, { width: page_width, height: page_height });
  } else {
    // Fallback for a template with no stored background (e.g. one created
    // before this field existed) — a bare reference frame + title, not a
    // real certificate layout, but still legible and honestly labeled.
    doc
      .lineWidth(1)
      .rect(4, 4, page_width - 8, page_height - 8)
      .strokeColor('#94a3b8')
      .stroke();
    doc.fontSize(14).fillColor('#0f172a').text(template.name, 24, 20, { width: page_width - 48 });
  }

  const hasBackground = !!template.backgroundImage;
  for (const zone of template.ocrZones) {
    const { x, y, width, height } = zone.boundingBox;
    const value = payload.fields[zone.fieldName] ?? '';

    if (!hasBackground) {
      // Bare fallback mode only — a real background already has its own
      // printed labels/underlines, so overlaying a debug box + field name
      // on top of real certificate artwork would look wrong, not helpful.
      doc
        .rect(x, y, width, height)
        .lineWidth(0.5)
        .strokeColor('#cbd5e1')
        .stroke();
      doc
        .fontSize(7)
        .fillColor('#64748b')
        .text(zone.fieldName, x, Math.max(0, y - 10), { width, lineBreak: false });
    }

    // Font size scales off the PAGE, not the zone's own height — a zone
    // drawn thin, tightly around just a printed underline (entirely
    // reasonable — that's the natural place to draw it), previously
    // produced a comically small font once scaled off that thin height,
    // completely out of proportion with the surrounding certificate text
    // at full page scale. `page_height * 0.026` roughly matches how large
    // a real certificate's fill-in text actually reads at that page size.
    // Still capped so a very long value (e.g. a full department name)
    // shrinks to fit the zone's declared WIDTH — using PDFKit's own
    // widthOfString so the shrink is measured, not guessed.
    let fontSize = Math.max(10, Math.min(page_height * 0.026, 26));
    doc.font('Times-Bold');
    while (fontSize > 8 && doc.fontSize(fontSize).widthOfString(String(value)) > width - 8) {
      fontSize -= 1;
    }
    doc
      .fontSize(fontSize)
      .fillColor('#0f172a')
      .text(String(value), x + 4, y + height - fontSize * 0.85, { width: width - 8, lineBreak: false, ellipsis: true });
  }

  const qrBox = qrBoundingBox(qr_position);
  doc.image(qrPngBuffer, qrBox.x, qrBox.y, { width: qrBox.width, height: qrBox.height });

  const photos = input.photos ?? {};
  for (const zone of template.photoZones) {
    const { x, y, width, height } = zone.boundingBox;
    const photoBuffer = photos[zone.fieldName];

    if (photoBuffer) {
      doc.save();
      doc.rect(x, y, width, height).clip();
      doc.image(photoBuffer, x, y, { width, height });
      doc.restore();
      doc.rect(x, y, width, height).lineWidth(0.75).strokeColor('#94a3b8').stroke();
    } else {
      // No image supplied for this zone — an obviously-incomplete
      // placeholder, not a silent gap or a hard failure (see module docstring).
      doc
        .rect(x, y, width, height)
        .lineWidth(0.75)
        .dash(3, { space: 2 })
        .strokeColor('#cbd5e1')
        .stroke()
        .undash();
      doc
        .fontSize(7)
        .fillColor('#94a3b8')
        .text(`${zone.fieldName} (missing)`, x + 4, y + height / 2 - 4, { width: width - 8, align: 'center' });
    }
  }

  doc
    .font('Helvetica')
    .fontSize(6)
    .fillColor('#94a3b8')
    .text(`doc_id: ${payload.doc_id}  ·  issued: ${payload.issued_at}`, 12, page_height - 16, {
      width: page_width - 24,
      lineBreak: false,
    });

  doc.end();
  return done;
}
