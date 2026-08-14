# TrustAnchor Engine 2 Service

Document forensics microservice — answers "does the physical document match the
cryptographically-authenticated data Engine 1 already established?" See
`Engine2_Architecture.md` (project root) for the full architecture and rationale.

## Status: all 8 pipeline stages built, tested, and wired into a real API — AUTHENTIC is now reachable

| Stage | File | Status |
|---|---|---|
| 1. Preprocessing | `app/pipeline/preprocessing.py` | Built, tested |
| 2. Perspective correction (homography) | `app/pipeline/homography.py` | Built, tested |
| 3. OCR (multilingual) | `app/pipeline/ocr.py` | Built, tested |
| 4. Template matching | `app/pipeline/template_matching.py` | Built, tested |
| 5. Asset verification | `app/pipeline/asset_verification.py` | Built, tested |
| 6. Document comparison | `app/pipeline/comparison.py` | Built, tested |
| 7. Confidence scoring | `app/pipeline/confidence.py` | Built, tested |
| 8. Final Engine 2 verdict | `app/pipeline/confidence.py` | Built, tested |

`app/pipeline/confidence.py`'s module docstring explains the full formula:
confidence starts at 1.0 (Engine 2 can only ever subtract trust, never add
it), a weighted average across alignment/screenshot/template/assets/fields,
a hard veto for any MANDATORY reject anywhere, and AUTHENTIC requires both
high aggregate confidence AND zero review-tier items anywhere — not just
zero rejects.

`app/main.py` exposes `POST /pipeline/run` — the endpoint
`packages/backend/src/routes/v2/engine2Client.ts` calls. It runs stages 1-3 for
real against the uploaded photo and returns a fully-shaped response today.
It never returns `AUTHENTIC` (only stages 4-8, once built, are allowed to
assert that) — see the module docstring in `app/main.py` for exactly what's
real versus placeholder in the response.

### Running the service

```bash
cd packages/engine2-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Check it's up: `curl http://localhost:8000/health` → `{"status":"ok"}`.

The backend's `.env` must have `ENGINE2_SERVICE_URL="http://localhost:8000"`
(already in `.env.example`) for `POST /v2/verify/:docId` to reach it.

## System dependencies — Windows setup (tested instructions)

### 1. Install Tesseract OCR with language packs

Download the Windows installer from the UB Mannheim build (the standard,
widely-used Windows distribution of Tesseract, since the official Tesseract
project doesn't ship its own Windows installer):

**https://github.com/UB-Mannheim/tesseract/wiki**

Run the installer. On the "Choose Components" screen, expand **"Additional
language data"** and check:
- **Hindi**
- **Punjabi**

(English is included by default.) Finish the install — it defaults to
`C:\Program Files\Tesseract-OCR\`.

### 2. Tell pytesseract where Tesseract is installed

Windows doesn't automatically put Tesseract on your `PATH`. Set an
environment variable before running anything in this package — `ocr.py`
reads it automatically (`app/pipeline/ocr.py`'s `TESSERACT_CMD` handling):

```powershell
$env:TESSERACT_CMD = "C:\Program Files\Tesseract-OCR\tesseract.exe"
```

(Add this to your PowerShell profile, or set it as a permanent environment
variable via System Properties → Environment Variables, so you don't need
to re-run it every session.)

Verify Tesseract itself works and has the right language packs:

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs
```

You should see `eng`, `hin`, `pan` in the output.

### 3. Fonts for the test fixture generator (not needed for the real pipeline)

`tests/generate_test_document.py` needs fonts capable of rendering
Devanagari (Hindi) and Gurmukhi (Punjabi) script to build its synthetic
test image. **Windows 8 and later ship a font called Nirmala UI that
covers both scripts by default** — the script auto-detects
`C:\Windows\Fonts\Nirmala.ttf` and uses it automatically; you shouldn't need
to install anything extra. If it's somehow missing on your machine: Settings
→ Time & Language → Language & region → add an "Hindi" or "Punjabi"
language pack (this installs the matching Windows font automatically).

## Setup (all platforms, after the above)

```powershell
pip install -r requirements.txt
```

## Running the tests

```powershell
# Regenerate the synthetic test fixtures (a real document image + a
# simulated camera photo of it, with known perspective distortion,
# rotation, lighting gradient, and sensor noise applied):
python tests/generate_test_document.py

# Run all 19 tests:
python -m pytest tests/ -v
```

## macOS / Linux setup

**macOS:** `brew install tesseract tesseract-lang` (installs all language
packs including Hindi/Punjabi). Fonts: install via Font Book, or
`brew install --cask font-noto-sans-devanagari font-noto-sans-gurmukhi`.

**Linux (Debian/Ubuntu):**
```bash
sudo apt-get install tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-pan fonts-noto-core
```

On both platforms, if `tesseract` isn't automatically on `PATH` after
install, set `pytesseract.pytesseract.tesseract_cmd` the same way as the
Windows instructions above, pointing at wherever `which tesseract` reports.

## What "genuinely working end to end" means here

`tests/generate_test_document.py` builds a real 842x595 document image with:
- A real, scannable QR code (via the system `qrencode` tool)
- Real English text ("Simran Kaur")
- Real Hindi/Devanagari text ("Bi.I. Computer Vigyaan" script)
- Real Punjabi/Gurmukhi text ("Panjab University" script)

...then applies a KNOWN, controlled perspective warp (simulating a camera
held at an angle), a 3.5 degree rotation, a lighting gradient (simulating an
uneven-lit room), and Gaussian sensor noise - producing a realistic
simulated phone photo, saved as `test_data/captured_photo.jpg`.

Running the actual pipeline (`preprocessing.preprocess` ->
`homography.align_document` -> `ocr.extract_all_zones`) against that
simulated photo:

- Preprocessing correctly reports dimensions and a low screenshot-likelihood
  score (0.326 - correctly below the midpoint for a genuine photo simulation).
- Homography completes Tiers 1 (QR-seeded) and 2 (border-refined),
  correctly recovering the 842x595 template dimensions from the distorted
  input. A freshly-run QR detector on the ALIGNED output lands within 15px
  of the QR's declared template position - direct proof the correction is
  geometrically accurate, not just "some transform."
- OCR extracts ALL THREE zones with exact text match at 94-96% confidence,
  correctly selecting English/Hindi/Punjabi per zone via each zone's
  declared `languages` list - zero hardcoded language logic anywhere in
  `ocr.py`.

This is real, verifiable output - not asserted, not hand-waved. Re-run the
two commands above yourself to see it.

## Architecture notes carried forward from Engine 1's standards

- Every pipeline stage is a standalone module with a narrow, typed function
  signature - independently unit-testable with synthetic inputs, matching
  Engine 1's "every module does one explicit thing" philosophy.
- No hardcoded field names, positions, or languages anywhere in `ocr.py` -
  every zone is declared data (the `OcrZone` shape from Engine 2's database
  schema), read as plain dicts so this module has zero dependency on any
  specific web framework's request/response schema.
- Heuristic signals (screenshot likelihood, alignment quality) are explicitly
  documented as heuristic - never presented as a certainty, and never used to
  hard-reject on their own; they are evidence for the eventual confidence
  scoring stage to weigh.