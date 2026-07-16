"""
comparison.py — Stage 6 of the Engine 2 pipeline: document comparison.
============================================================================
This is the actual question Engine 2 exists to answer: does what's
PRINTED on the physical document (Stage 3's OCR output, read off the
captured photo) match what was actually ISSUED (the credential's
Engine-1-AUTHENTICATED field values — cryptographically signed, tamper-
evident, and, by the time this module runs, already confirmed genuine by
Engine 1's own verification)?

Preprocessing/homography/OCR (Stages 1-3) and template/asset matching
(Stages 4-5) all establish confidence that this is a real photo of a real
instance of the claimed template. This stage is the one that would catch
an actual forgery: a physically altered document whose printed text no
longer matches what the issuer signed — e.g. a roll number or a grade
changed by hand or with a photo edit after issuance.

WHY NOT PLAIN STRING EQUALITY: OCR is not a perfect transcription of what's
printed, even on a genuine, unaltered document — a signature-adjacent
zone with light bleed, a slightly skewed crop, or a low-resolution capture
can turn "0" into "O", drop a hyphen, or introduce stray whitespace. Naive
`extracted == expected` would reject genuine documents constantly on OCR
noise alone. This module distinguishes "OCR read it imperfectly, but this
is unmistakably the same value" from "this genuinely does not match" by:

  1. NORMALIZING before comparing — case, whitespace, and punctuation
     variations that carry no meaning are stripped before any comparison
     happens (`_normalize_text`).

  2. FIELD-TYPE-AWARE NORMALIZATION — a field whose AUTHENTICATED value is
     mostly digits (roll numbers, dates, marks) additionally gets
     letter/digit confusion normalized (O/0, l/I/1, S/5, etc. —
     `_normalize_numeric`), since Tesseract's digit/letter confusion is a
     well-known, well-documented failure mode on printed serif fonts. This
     normalization is DELIBERATELY NOT applied to name/text fields: a name
     that's actually different should never be silently forgiven by a
     letter-swap table meant for numerals — that would turn a real
     forgery-detection signal into a blind spot.

  3. FUZZY SIMILARITY AS A FALLBACK, NOT THE FIRST CHECK — an exact
     normalized match is always checked and recorded first
     (`exact_match`); the fuzzy `SequenceMatcher` similarity score exists
     for the case where normalization alone doesn't produce an exact
     match, to distinguish "one OCR'd character off" from "completely
     different value" instead of collapsing both into the same "not
     exact" bucket.

Like every prior pipeline stage, this module's output is EVIDENCE for the
eventual Stage 7 confidence-scoring formula, not a final verdict by
itself — it reports `is_mandatory` alongside each result without using it
to change its own tier, exactly like asset_verification.py does; the
"which failures cause an overall REJECT" decision belongs to the caller.
"""
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Dict, List, Optional


@dataclass
class FieldComparisonResult:
    field_name: str
    extracted_text: str
    expected_text: str
    normalized_extracted: str
    normalized_expected: str
    exact_match: bool
    similarity: float
    field_type: str  # "numeric" | "text"
    is_mandatory: bool
    extraction_failed: bool
    tier: str  # "accept" | "review" | "reject"
    reason: str


_DIGIT_CONFUSIONS = {
    "O": "0", "o": "0", "D": "0", "Q": "0",
    "I": "1", "l": "1", "|": "1", "i": "1",
    "S": "5", "s": "5",
    "Z": "2", "z": "2",
    "B": "8",
    "G": "6",
    "T": "7",
}

_NUMERIC_STRIP_RE = re.compile(r"[\s\-_/.]")
_TEXT_PUNCT_RE = re.compile(r"[^\w\s'-]", flags=re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")


def _looks_numeric(text: str) -> bool:
    """A field is treated as 'numeric' (roll numbers, dates, marks, ...)
    when most of its non-separator characters are digits. Judged from the
    AUTHENTICATED value, since that's the ground-truth format — never from
    the OCR output, which is exactly the noisy side of the comparison."""
    stripped = _NUMERIC_STRIP_RE.sub("", text)
    if not stripped:
        return False
    digit_count = sum(ch.isdigit() for ch in stripped)
    return (digit_count / len(stripped)) >= 0.6


def _normalize_numeric(text: str) -> str:
    cleaned = _NUMERIC_STRIP_RE.sub("", text)
    return "".join(_DIGIT_CONFUSIONS.get(ch, ch) for ch in cleaned)


def _normalize_text(text: str) -> str:
    cleaned = text.strip().lower()
    cleaned = _WHITESPACE_RE.sub(" ", cleaned)
    cleaned = _TEXT_PUNCT_RE.sub("", cleaned)
    return cleaned.strip()


def _similarity(a: str, b: str) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return round(SequenceMatcher(None, a, b).ratio(), 3)


def _tier_from_score(score: float) -> str:
    """Same 0.9/0.6 thresholds used elsewhere in the pipeline (asset
    verification, template matching) — one consistent scale across
    stages. Stage 7 (confidence scoring) may eventually want per-field-
    type thresholds (numeric fields arguably deserve a stricter bar than
    names do); that's a scoring-policy decision left to that stage, not
    baked into the comparison primitive here."""
    if score >= 0.9:
        return "accept"
    if score >= 0.6:
        return "review"
    return "reject"


def compare_field(
    field_name: str,
    extracted_text: str,
    expected_text: Optional[str],
    is_mandatory: bool,
    extraction_failed: bool,
) -> FieldComparisonResult:
    """
    Compares one OCR'd zone against its Engine-1-authenticated value.

    @param expected_text: the authenticated value for this field, or None
        if the credential has no such field on record at all (distinct
        from an authenticated EMPTY string — this module cannot compare
        against a value it was never given).
    """
    if extraction_failed:
        return FieldComparisonResult(
            field_name=field_name,
            extracted_text=extracted_text,
            expected_text=expected_text or "",
            normalized_extracted="",
            normalized_expected="",
            exact_match=False,
            similarity=0.0,
            field_type="unknown",
            is_mandatory=is_mandatory,
            extraction_failed=True,
            tier="reject",
            reason="OCR could not extract any text from this zone — nothing to compare.",
        )

    if expected_text is None:
        return FieldComparisonResult(
            field_name=field_name,
            extracted_text=extracted_text,
            expected_text="",
            normalized_extracted="",
            normalized_expected="",
            exact_match=False,
            similarity=0.0,
            field_type="unknown",
            is_mandatory=is_mandatory,
            extraction_failed=False,
            tier="review",
            reason="No authenticated value is on record for this field; nothing to compare it against.",
        )

    field_type = "numeric" if _looks_numeric(expected_text) else "text"
    if field_type == "numeric":
        normalized_extracted = _normalize_numeric(extracted_text)
        normalized_expected = _normalize_numeric(expected_text)
    else:
        normalized_extracted = _normalize_text(extracted_text)
        normalized_expected = _normalize_text(expected_text)

    exact_match = normalized_extracted == normalized_expected
    similarity = 1.0 if exact_match else _similarity(normalized_extracted, normalized_expected)
    tier = _tier_from_score(similarity)

    if exact_match:
        reason = f"Normalized values match exactly ({field_type} field)."
    else:
        reason = (
            f"Normalized values differ ({field_type} field): "
            f"OCR read '{normalized_extracted}', authenticated value is "
            f"'{normalized_expected}' (similarity {similarity:.3f})."
        )

    return FieldComparisonResult(
        field_name=field_name,
        extracted_text=extracted_text,
        expected_text=expected_text,
        normalized_extracted=normalized_extracted,
        normalized_expected=normalized_expected,
        exact_match=exact_match,
        similarity=similarity,
        field_type=field_type,
        is_mandatory=is_mandatory,
        extraction_failed=False,
        tier=tier,
        reason=reason,
    )


def compare_all_fields(
    ocr_results: List,
    authenticated_fields: Dict[str, str],
    is_mandatory_by_field: Dict[str, bool],
) -> List[FieldComparisonResult]:
    """
    Convenience wrapper running compare_field() over every OCR'd zone —
    same shape of convenience function as ocr.py's `extract_all_zones` and
    asset_verification.py's `verify_all_assets`.

    @param ocr_results: objects/dicts with `.field_name`, `.extracted_text`,
        `.extraction_failed` (accepts either OcrZoneResult dataclass
        instances or plain dicts with those keys).
    """
    results = []
    for r in ocr_results:
        field_name = r["field_name"] if isinstance(r, dict) else r.field_name
        extracted_text = r["extracted_text"] if isinstance(r, dict) else r.extracted_text
        extraction_failed = r["extraction_failed"] if isinstance(r, dict) else r.extraction_failed
        results.append(
            compare_field(
                field_name=field_name,
                extracted_text=extracted_text,
                expected_text=authenticated_fields.get(field_name),
                is_mandatory=is_mandatory_by_field.get(field_name, True),
                extraction_failed=extraction_failed,
            )
        )
    return results
