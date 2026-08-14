import React, { useState } from 'react';
import { Button, Field, Input } from './ui';

export interface PublishKeyFormValue {
  publicKeyHex: string;
  keySource: 'yubikey' | 'software_test_key';
}

/**
 * A publicKeyHex field + a keySource choice. Used both when an admin
 * first publishes an issuer's key (applications queue) and when approving
 * a key rotation request (a NEW key, same shape) — see keySigner.ts's
 * header for why this distinction is tracked loudly rather than defaulted.
 */
export function PublishKeyForm({
  onSubmit,
  submitLabel,
  initialPublicKeyHex,
}: {
  onSubmit: (value: PublishKeyFormValue) => void | Promise<void>;
  submitLabel: string;
  initialPublicKeyHex?: string;
}) {
  const [publicKeyHex, setPublicKeyHex] = useState(initialPublicKeyHex ?? '');
  const [keySource, setKeySource] = useState<'yubikey' | 'software_test_key'>('yubikey');
  const [submitting, setSubmitting] = useState(false);

  const isValidHex = /^[0-9a-fA-F]{64}$/.test(publicKeyHex.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidHex) return;
    setSubmitting(true);
    try {
      await onSubmit({ publicKeyHex: publicKeyHex.trim().toLowerCase(), keySource });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Public Key Hex" hint="64 hex characters, from the issuer's keygen output" error={publicKeyHex && !isValidHex ? 'Must be exactly 64 hex characters.' : undefined}>
        <Input value={publicKeyHex} onChange={(e) => setPublicKeyHex(e.target.value)} placeholder="e.g. c54eb043d8578dc5c7f9f741edef946f21af84ec71239099506f69830988fa8" mono />
      </Field>
      <Field label="Key Source">
        <div className="chip-row">
          <div className={`chip ${keySource === 'yubikey' ? 'active' : ''}`} onClick={() => setKeySource('yubikey')}>
            YubiKey
          </div>
          <div className={`chip ${keySource === 'software_test_key' ? 'active' : ''}`} onClick={() => setKeySource('software_test_key')}>
            Software test key
          </div>
        </div>
      </Field>
      <Button variant="primary" type="submit" disabled={!isValidHex || submitting}>
        {submitting ? 'Submitting…' : submitLabel}
      </Button>
    </form>
  );
}
