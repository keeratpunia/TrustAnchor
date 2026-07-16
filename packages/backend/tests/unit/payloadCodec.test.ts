/**
 * payloadCodec.test.ts — automated regression tests for credential/manifest
 * hashing and the full Ed25519 sign/verify/tamper-detection cycle. This
 * formalizes the manual end-to-end crypto test performed during
 * development.
 */
import nacl from 'tweetnacl';
import { CredentialPayload, credentialContentHash } from '@trustanchor/shared';

function samplePayload(): CredentialPayload {
  return {
    v: 1,
    issuer_id: '22222222-2222-2222-2222-222222222222',
    doc_id: '11111111-1111-1111-1111-111111111111',
    template_id: '33333333-3333-3333-3333-333333333333',
    template_version: 2,
    issued_at: '2026-05-20T00:00:00Z',
    expires_at: null,
    fields: { student_name: 'Simran Kaur', cgpa: '9.37', degree_name: 'B.E. Computer Science' },
    asset_hashes: { student_photo: 'a'.repeat(64), university_seal: 'b'.repeat(64) },
    template_hash: 'c'.repeat(64),
  };
}

describe('credential content hash', () => {
  it('produces a 32-byte hash', () => {
    expect(credentialContentHash(samplePayload())).toHaveLength(32);
  });

  it('is deterministic across repeated calls', () => {
    const payload = samplePayload();
    expect(credentialContentHash(payload).equals(credentialContentHash(payload))).toBe(true);
  });

  it('is independent of field insertion order', () => {
    const payload = samplePayload();
    const reordered: CredentialPayload = {
      ...payload,
      fields: {
        degree_name: payload.fields.degree_name,
        cgpa: payload.fields.cgpa,
        student_name: payload.fields.student_name,
      },
    };
    expect(credentialContentHash(payload).equals(credentialContentHash(reordered))).toBe(true);
  });

  it('changes when any field value changes', () => {
    const payload = samplePayload();
    const tampered: CredentialPayload = { ...payload, fields: { ...payload.fields, cgpa: '4.12' } };
    expect(credentialContentHash(payload).equals(credentialContentHash(tampered))).toBe(false);
  });

  it('changes when an asset hash changes', () => {
    const payload = samplePayload();
    const tampered: CredentialPayload = {
      ...payload,
      asset_hashes: { ...payload.asset_hashes, student_photo: 'f'.repeat(64) },
    };
    expect(credentialContentHash(payload).equals(credentialContentHash(tampered))).toBe(false);
  });

  it('changes when doc_id changes (prevents cross-document substitution)', () => {
    const payload = samplePayload();
    const tampered: CredentialPayload = { ...payload, doc_id: '99999999-9999-9999-9999-999999999999' };
    expect(credentialContentHash(payload).equals(credentialContentHash(tampered))).toBe(false);
  });
});

describe('full Ed25519 sign/verify cycle with tamper detection', () => {
  it('signs, verifies, and detects tampering end-to-end', () => {
    const keyPair = nacl.sign.keyPair();
    const payload = samplePayload();

    const hash = credentialContentHash(payload);
    const signature = nacl.sign.detached(new Uint8Array(hash), keyPair.secretKey);

    // Genuine signature verifies.
    expect(nacl.sign.detached.verify(new Uint8Array(hash), signature, keyPair.publicKey)).toBe(true);

    // Tampering the payload changes the hash, and the OLD signature no
    // longer verifies against the NEW hash — this is the core mechanism
    // that makes Engine 1's HASH_MISMATCH / signature check catch fraud.
    const tampered: CredentialPayload = { ...payload, fields: { ...payload.fields, cgpa: '4.12' } };
    const tamperedHash = credentialContentHash(tampered);
    expect(hash.equals(tamperedHash)).toBe(false);
    expect(nacl.sign.detached.verify(new Uint8Array(tamperedHash), signature, keyPair.publicKey)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const keyPairA = nacl.sign.keyPair();
    const keyPairB = nacl.sign.keyPair();
    const payload = samplePayload();
    const hash = credentialContentHash(payload);
    const signature = nacl.sign.detached(new Uint8Array(hash), keyPairA.secretKey);

    expect(nacl.sign.detached.verify(new Uint8Array(hash), signature, keyPairB.publicKey)).toBe(false);
  });
});
