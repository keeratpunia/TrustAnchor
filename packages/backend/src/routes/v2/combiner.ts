/**
 * combiner.ts — THE security-critical rule of the entire Engine 2 system.
 * ============================================================================
 * Engine2_Architecture.md §5, §12: "Engine 2 can only ever subtract
 * confidence, never add trust." This file is where that rule lives as
 * code, isolated as a single pure function specifically so it can be
 * exhaustively tested against every possible input combination — see
 * tests/unit/combiner.test.ts.
 *
 * THIS FUNCTION DOES NOT GATE ANYTHING BY ITSELF. It only combines two
 * already-computed verdicts. The actual gate — refusing to even CALL
 * Engine 2 unless Engine 1 already said AUTHENTIC — lives in verify.ts,
 * enforced by control flow (an early return before any fetch to
 * engine2-service happens), not by this function. This function is a
 * second, independent layer of the same guarantee: even if verify.ts's
 * early-return gate were ever accidentally removed or reordered in a
 * future edit, this function STILL cannot produce VERIFIED unless
 * BOTH inputs say so.
 */

export type Engine1StatusForCombiner = string; // any of the 12 Engine1Status values (Engine 1 Freeze Spec §20.5)
export type Engine2Verdict = 'AUTHENTIC' | 'NEEDS_REVIEW' | 'REJECTED';
export type OverallVerdict = 'VERIFIED' | 'NEEDS_REVIEW' | 'REJECTED';

/**
 * Combines Engine 1's status and Engine 2's verdict into the final,
 * user-facing overall verdict.
 *
 * The ONLY way to get 'VERIFIED' out of this function is
 * engine1Status === 'AUTHENTIC' AND engine2Verdict === 'AUTHENTIC'. Every
 * other combination produces either 'NEEDS_REVIEW' or 'REJECTED' — never
 * 'VERIFIED'. This is exhaustively tested, not just asserted in a comment.
 */
export function combineVerdicts(
  engine1Status: Engine1StatusForCombiner,
  engine2Verdict: Engine2Verdict
): OverallVerdict {
  // Engine 1 gate: anything other than AUTHENTIC is an immediate, final
  // REJECTED — Engine 2's opinion is irrelevant once Engine 1 has already
  // said the credential itself isn't genuine/valid. This branch should be
  // unreachable in practice (verify.ts's earlier gate prevents Engine 2
  // from ever running at all in this case — see this file's header) but
  // is handled here too as defense-in-depth, not left as an unhandled case.
  if (engine1Status !== 'AUTHENTIC') {
    return 'REJECTED';
  }

  switch (engine2Verdict) {
    case 'AUTHENTIC':
      return 'VERIFIED';
    case 'NEEDS_REVIEW':
      return 'NEEDS_REVIEW';
    case 'REJECTED':
      return 'REJECTED';
    default: {
      // Exhaustiveness guard: TypeScript's discriminated union check above
      // makes this branch unreachable for valid input, but it is kept as a
      // defensive runtime guard against a value that bypasses the type
      // system (e.g. an unexpected string from a misbehaving
      // engine2-service response, parsed from JSON without validation
      // upstream). Fails closed, never open.
      const exhaustiveCheck: never = engine2Verdict;
      throw new Error(`combineVerdicts: unknown engine2Verdict: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
