"""
app.pipeline — the 8-stage Engine 2 document forensics pipeline.
Each module is independently callable and independently testable.
Stages 1-5 (preprocessing, homography, OCR, template matching, asset
verification) are built and tested; remaining stages (document
comparison, confidence scoring, final verdict) are still placeholders,
wired provisionally in app/main.py — see that file's module docstring.
"""
