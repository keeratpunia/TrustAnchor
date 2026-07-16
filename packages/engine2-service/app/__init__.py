"""
TrustAnchor Engine 2 Service
============================================================================
A standalone Python microservice implementing document forensics — the
question Engine 1 (frozen, in packages/backend and packages/verifier-app)
deliberately does NOT answer: "does the physical document in someone's hand
visually match the cryptographically-authenticated data Engine 1 already
established?"

WHY THIS IS A SEPARATE SERVICE, NOT NEW CODE IN packages/backend:
Node.js has no mature ecosystem for OCR, perspective correction, or image
similarity work. Python's Tesseract (with multilingual support) and OpenCV
are the standard, battle-tested tools for exactly this workload. See
Engine2_Architecture.md §1 for the full rationale.

WHAT THIS SERVICE NEVER DOES:
- Never re-implements hashing (SHA-256), canonical CBOR encoding, or Ed25519
  signature verification — those are Engine 1's frozen responsibility.
- Never makes a trust decision that could cause a non-AUTHENTIC Engine 1
  result to be accepted. Engine 2 can only ever SUBTRACT confidence from an
  already-cryptographically-proven AUTHENTIC credential, never add trust to
  one Engine 1 rejected.
"""
