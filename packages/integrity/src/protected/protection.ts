// T035 (F116-FR-007) — the value of `protection` from the containment level
// and the confirmation of the harness adapter, handed to the run record.
export const PROTECTION_CLOSED_SET = ["prevent", "detect"] as const;
export type Protection = (typeof PROTECTION_CLOSED_SET)[number];

const CONTAINMENT_ORDER = ["C0", "C1", "C2", "C3"];

/** `prevent` only at containment C2 or above with a confirmed sandbox. */
export function protectionFor(containmentLevel: string, harnessConfirmed: boolean): Protection {
  const atLeastC2 = CONTAINMENT_ORDER.indexOf(containmentLevel) >= CONTAINMENT_ORDER.indexOf("C2");
  return atLeastC2 && harnessConfirmed ? "prevent" : "detect";
}

/** Hand the value to the run record (annex E §E.2, field `containment`). */
export function applyProtectionToRunRecord(
  record: { containment?: Record<string, unknown> },
  protection: Protection,
): void {
  record.containment = { ...(record.containment ?? {}), protection };
}
