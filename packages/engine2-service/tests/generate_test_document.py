"""
generate_test_document.py — builds a REAL synthetic test document + a
REAL simulated "camera photo" of it, used to prove the Stage 1-3 pipeline
(preprocessing -> homography -> OCR) genuinely works end to end.

CROSS-PLATFORM (Windows/macOS/Linux) — this file previously shelled out to
the Linux-only `qrencode` binary and hardcoded /usr/share/fonts/... paths.
It now uses the pure-Python `qrcode` library (pip-installable everywhere)
and auto-detects fonts across common Windows/macOS/Linux install locations,
with a clear error message telling you exactly what to install if none are
found — see _find_font() below.

This is a TEST FIXTURE GENERATOR, not part of the shipped pipeline. The
actual pipeline (app/pipeline/*.py) has zero OS-specific code — it only
ever touches OpenCV/PIL/pytesseract, all fully cross-platform.
"""
import json
from pathlib import Path

import cv2
import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFont

TEST_DATA_DIR = Path(__file__).parent.parent / "test_data"
TEST_DATA_DIR.mkdir(exist_ok=True)
FONTS_DIR = Path(__file__).parent / "fonts"

TEMPLATE_WIDTH = 842
TEMPLATE_HEIGHT = 595

# BUNDLED fonts (tests/fonts/) are the PRIMARY, GUARANTEED source — no
# dependency on the OS having a particular font installed at a particular
# path, which turned out to be unreliable in practice even on Windows 8+
# machines that are "supposed to" ship Nirmala.ttf (it depends on exactly
# which language packs were installed, and per-user font installs land in
# a different folder than C:\Windows\Fonts on modern Windows). These three
# files (Noto Sans Devanagari, Noto Sans Gurmukhi, DejaVu Sans Bold) are
# all SIL Open Font License / permissively licensed and safe to
# redistribute — the same fonts essentially every Linux distro and Google's
# own products ship with.
#
# OS-installed fonts are checked only as a SECONDARY fallback, in case
# someone deletes the bundled fonts folder and wants to test against their
# own system fonts instead.
FONT_CANDIDATES = {
    "latin": [
        str(FONTS_DIR / "DejaVuSans-Bold.ttf"),
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "devanagari": [
        str(FONTS_DIR / "NotoSansDevanagari-Regular.ttf"),
        r"C:\Windows\Fonts\mangal.ttf",
        r"C:\Windows\Fonts\Nirmala.ttf",
        "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
    ],
    "gurmukhi": [
        str(FONTS_DIR / "NotoSansGurmukhi-Regular.ttf"),
        r"C:\Windows\Fonts\Nirmala.ttf",
        r"C:\Windows\Fonts\raavi.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansGurmukhi-Regular.ttf",
    ],
}


def _find_font(script: str) -> str:
    """
    Returns the first existing font file path for the given script.
    Raises a clear, actionable error (not a cryptic file-not-found) if none
    of the candidate paths exist on this machine.
    """
    for candidate in FONT_CANDIDATES[script]:
        if Path(candidate).exists():
            return candidate

    raise FileNotFoundError(
        f"No usable font found for script '{script}'. Tried: {FONT_CANDIDATES[script]}\n"
        f"The bundled font in tests/fonts/ should always be found first — if you're seeing "
        f"this, either the tests/fonts/ folder is missing from your checkout (re-download "
        f"the deliverable), or it was accidentally deleted. As a fallback, you can also "
        f"install a system font: on Windows 8+, add a Hindi or Punjabi language pack via "
        f"Settings -> Time & Language -> Language & region (installs Nirmala UI); on "
        f"Linux, `sudo apt-get install fonts-noto-core`; on macOS, "
        f"`brew install --cask font-noto-sans-devanagari font-noto-sans-gurmukhi`."
    )


# Ground truth text for each zone — the pipeline must recover these.
ZONES = {
    "student_name_en": {"box": (300, 180, 400, 40), "text": "Simran Kaur", "script": "latin"},
    "degree_name_hi": {"box": (300, 240, 450, 45), "text": "बी.ई. कंप्यूटर विज्ञान", "lang": ["hi"], "script": "devanagari"},
    "university_pa": {"box": (300, 300, 450, 45), "text": "ਪੰਜਾਬ ਯੂਨੀਵਰਸਿਟੀ", "lang": ["pa"], "script": "gurmukhi"},
}
# (student_name_en's "lang" added below to keep the dict literal readable)
ZONES["student_name_en"]["lang"] = ["en"]

QR_BOX = (60, 60, 140, 140)  # x, y, width, height


def _generate_qr_image(data: str, size_px: int) -> Image.Image:
    """
    Generates a QR code as a PIL Image using the pure-Python `qrcode`
    library — replaces the previous Linux-only `qrencode` subprocess call.
    Works identically on Windows, macOS, and Linux with no external binary.
    """
    qr = qrcode.QRCode(border=1, box_size=10)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    return img.resize((size_px, size_px), Image.NEAREST)


def render_template():
    """Builds the flat, undistorted template image."""
    img = Image.new("RGB", (TEMPLATE_WIDTH, TEMPLATE_HEIGHT), color="white")
    draw = ImageDraw.Draw(img)

    # Border (a document edge, used by Tier 2 homography refinement).
    draw.rectangle([15, 15, TEMPLATE_WIDTH - 15, TEMPLATE_HEIGHT - 15], outline="black", width=3)

    qr_img = _generate_qr_image("TRUSTANCHOR-TEST-FIXTURE", QR_BOX[2])
    img.paste(qr_img, (QR_BOX[0], QR_BOX[1]))

    # Draw each text zone with its real font/script.
    for field_name, zone in ZONES.items():
        x, y, w, h = zone["box"]
        font_path = _find_font(zone["script"])
        font = ImageFont.truetype(font_path, 28)
        draw.rectangle([x, y, x + w, y + h], outline="lightgray", width=1)
        draw.text((x + 5, y + 5), zone["text"], fill="black", font=font)

    img.save(TEST_DATA_DIR / "template_flat.png")
    return img


def simulate_camera_photo(template_img: Image.Image):
    """
    Applies a KNOWN perspective warp (simulating a camera at an angle),
    slight rotation, and a lighting gradient (simulating uneven room
    lighting) to the flat template — this is the "captured photo" the
    pipeline must recover the original layout from.
    """
    bgr = cv2.cvtColor(np.array(template_img), cv2.COLOR_RGB2BGR)
    h, w = bgr.shape[:2]

    # Known source->destination point mapping for a moderate perspective
    # distortion (simulating a camera held at an angle, not top-down).
    src_pts = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst_pts = np.float32([
        [40, 60],       # top-left pushed right/down
        [w - 10, 20],   # top-right pulled up
        [w - 60, h - 30],  # bottom-right pushed left/up
        [30, h - 5],    # bottom-left roughly in place
    ])
    matrix = cv2.getPerspectiveTransform(src_pts, dst_pts)

    # Warp onto a LARGER canvas so the whole distorted page remains visible
    # (simulating extra background/desk visible around the document in a
    # real photo).
    canvas_w, canvas_h = int(w * 1.2), int(h * 1.3)
    warped = cv2.warpPerspective(bgr, matrix, (canvas_w, canvas_h), borderValue=(200, 200, 200))

    # Slight additional rotation (simulating imperfect hand-held framing).
    center = (canvas_w // 2, canvas_h // 2)
    rot_matrix = cv2.getRotationMatrix2D(center, 3.5, 1.0)
    rotated = cv2.warpAffine(warped, rot_matrix, (canvas_w, canvas_h), borderValue=(200, 200, 200))

    # Lighting gradient (simulating a shadow across one side of the page).
    gradient = np.tile(np.linspace(0.7, 1.15, canvas_w), (canvas_h, 1)).astype(np.float32)
    gradient = cv2.merge([gradient, gradient, gradient])
    lit = np.clip(rotated.astype(np.float32) * gradient, 0, 255).astype(np.uint8)

    # Mild gaussian noise (simulating real camera sensor noise).
    noise = np.random.normal(0, 4, lit.shape).astype(np.float32)
    noisy = np.clip(lit.astype(np.float32) + noise, 0, 255).astype(np.uint8)

    cv2.imwrite(str(TEST_DATA_DIR / "captured_photo.jpg"), noisy, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return noisy


def main():
    template_img = render_template()
    simulate_camera_photo(template_img)

    ground_truth = {
        "template_width": TEMPLATE_WIDTH,
        "template_height": TEMPLATE_HEIGHT,
        "qr_position_in_template": [
            [QR_BOX[0], QR_BOX[1]],
            [QR_BOX[0] + QR_BOX[2], QR_BOX[1]],
            [QR_BOX[0] + QR_BOX[2], QR_BOX[1] + QR_BOX[3]],
            [QR_BOX[0], QR_BOX[1] + QR_BOX[3]],
        ],
        "zones": {
            name: {
                "field_name": name,
                "bounding_box": {"x": z["box"][0], "y": z["box"][1], "width": z["box"][2], "height": z["box"][3]},
                "languages": z["lang"],
                "expected_text": z["text"],
            }
            for name, z in ZONES.items()
        },
    }
    with open(TEST_DATA_DIR / "ground_truth.json", "w", encoding="utf-8") as f:
        json.dump(ground_truth, f, ensure_ascii=False, indent=2)

    print("Generated test_data/template_flat.png (the flat, undistorted document)")
    print("Generated test_data/captured_photo.jpg (simulated camera photo — perspective+rotation+lighting+noise)")
    print("Generated test_data/ground_truth.json (expected zone text + coordinates)")


if __name__ == "__main__":
    main()
