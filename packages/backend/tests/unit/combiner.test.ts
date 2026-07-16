/**
 * combiner.test.ts — exhaustive tests for src/routes/v2/combiner.ts.
 *
 * This is the single most important test file in the Engine 2 codebase.
 * It proves, for every possible input combination, that VERIFIED is
 * reachable ONLY when both engines say AUTHENTIC.
 */
import { combineVerdicts, Engine2Verdict } from '../../src/routes/v2/combiner';

describe('combineVerdicts — the core security rule', () => {
  it('produces VERIFIED only when Engine 1 is AUTHENTIC and Engine 2 is AUTHENTIC', () => {
    expect(combineVerdicts('AUTHENTIC', 'AUTHENTIC')).toBe('VERIFIED');
  });

  // Every Engine 1 status OTHER than AUTHENTIC, paired with every possible
  // Engine 2 verdict (including AUTHENTIC) — none of these 33 combinations
  // may ever produce VERIFIED. This is the literal "Engine 2 cannot add
  // trust" guarantee, tested exhaustively rather than spot-checked.
  const nonAuthenticEngine1Statuses = [
    'INVALID_QR',
    'BAD_MANIFEST_SIGNATURE',
    'MANIFEST_ROLLBACK',
    'MANIFEST_STALE',
    'UNKNOWN_ISSUER',
    'ISSUER_SUSPENDED',
    'HASH_MISMATCH',
    'IDENTITY_MISMATCH',
    'BAD_SIGNATURE',
    'REVOKED',
    'EXPIRED',
    'NETWORK_ERROR',
  ];
  const allEngine2Verdicts: Engine2Verdict[] = ['AUTHENTIC', 'NEEDS_REVIEW', 'REJECTED'];

  for (const engine1Status of nonAuthenticEngine1Statuses) {
    for (const engine2Verdict of allEngine2Verdicts) {
      it(`never returns VERIFIED for engine1=${engine1Status}, engine2=${engine2Verdict}`, () => {
        const result = combineVerdicts(engine1Status, engine2Verdict);
        expect(result).not.toBe('VERIFIED');
        expect(result).toBe('REJECTED'); // Engine 1 non-AUTHENTIC is always a hard REJECTED
      });
    }
  }

  it('returns NEEDS_REVIEW when Engine 1 is AUTHENTIC but Engine 2 needs review', () => {
    expect(combineVerdicts('AUTHENTIC', 'NEEDS_REVIEW')).toBe('NEEDS_REVIEW');
  });

  it('returns REJECTED when Engine 1 is AUTHENTIC but Engine 2 rejects', () => {
    expect(combineVerdicts('AUTHENTIC', 'REJECTED')).toBe('REJECTED');
  });

  it('throws (fails closed) on an unrecognized Engine 2 verdict value rather than silently accepting it', () => {
    expect(() => combineVerdicts('AUTHENTIC', 'SOMETHING_UNEXPECTED' as Engine2Verdict)).toThrow();
  });

  it('the ONLY code path to VERIFIED requires both engine1Status===AUTHENTIC and engine2Verdict===AUTHENTIC — exhaustive matrix', () => {
    const allEngine1Statuses = ['AUTHENTIC', ...nonAuthenticEngine1Statuses];
    let verifiedCount = 0;

    for (const e1 of allEngine1Statuses) {
      for (const e2 of allEngine2Verdicts) {
        const result = combineVerdicts(e1, e2);
        if (result === 'VERIFIED') {
          verifiedCount++;
          expect(e1).toBe('AUTHENTIC');
          expect(e2).toBe('AUTHENTIC');
        }
      }
    }

    // Across the entire 13 x 3 = 39-combination matrix, EXACTLY ONE
    // combination produces VERIFIED.
    expect(verifiedCount).toBe(1);
  });
});
