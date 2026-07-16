# @trustanchor/offline-signer

The offline signing CLI. **Never run this on a networked machine in production** — see the project
root README and the Frozen Architecture Specification §4 for why.

## Commands

```bash
# Generate an Ed25519 keypair (issuer or platform trust key — same command, different use)
npx ts-node src/cli.ts keygen --label "My University" --out issuer-key.json

# Sign a credential payload's content hash
npx ts-node src/cli.ts sign-credential \
  --payload unsigned-credential.json \
  --key issuer-key.json \
  --out signed-credential.json

# Sign a trust manifest
npx ts-node src/cli.ts sign-manifest \
  --manifest unsigned-manifest.json \
  --key platform-key.json \
  --out signed-manifest.json

# Render a signed credential's QR code as a scannable PNG
npx ts-node src/cli.ts generate-qr \
  --signed signed-credential.json \
  --out document-qr.png \
  --terminal   # optional: also print an ASCII QR to the terminal
```

Every signing command performs an immediate **self-check** — it verifies the signature it just
produced against the public key before writing any output file. If that self-check ever fails, the
tool refuses to write output and exits with an error; this should never happen in practice and would
indicate a serious bug if it did.

## Unsigned input file shapes

**Credential payload** (for `sign-credential`), matching `CredentialPayload` in
`packages/shared/src/types.ts`:

```json
{
  "v": 1,
  "issuer_id": "uuid",
  "doc_id": "uuid",
  "template_id": "uuid",
  "template_version": 1,
  "issued_at": "2026-05-20T00:00:00Z",
  "expires_at": null,
  "fields": { "student_name": "...", "cgpa": "9.37" },
  "asset_hashes": { "student_photo": "64-hex-char-sha256" },
  "template_hash": "64-hex-char-sha256"
}
```

**Manifest payload** (for `sign-manifest`), matching `ManifestPayload`:

```json
{
  "version": 1,
  "generated_at": "2026-07-08T00:00:00Z",
  "valid_until": "2026-07-15T00:00:00Z",
  "issuers": [
    {
      "issuer_id": "uuid",
      "issuer_name": "XYZ University",
      "status": "active",
      "keys": [{ "public_key": "64-hex-char-ed25519-pubkey", "valid_from": "...", "valid_until": null }]
    }
  ],
  "revoked_docs": []
}
```

See `/samples` at the project root for real, working examples of every file shape above.
