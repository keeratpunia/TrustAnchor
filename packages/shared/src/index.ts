/**
 * index.ts — public entry point of @trustanchor/shared.
 *
 * Re-exports every primitive the offline-signer and backend packages need:
 * the canonical CBOR encoder, the SHA-256 helper, the schema-specific
 * payload canonicalizers, the QR codec, and all shared TypeScript types.
 */
export * from './canonicalCbor';
export * from './hash';
export * from './payloadCodec';
export * from './qrCodec';
export * from './types';
