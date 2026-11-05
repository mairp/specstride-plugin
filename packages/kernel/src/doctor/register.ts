/**
 * T059 (feature 116, T064) — the registration call of the doctor check
 * registry (F100-FR-189; annex G, §G.7).
 *
 * "The registration call lives in the kernel package, so that a package
 * registers checks without importing the doctor." A package calls
 * `registerDoctorCheck` here; the doctor of feature 112 reads the registered
 * checks through the same call surface. This module holds the registry only:
 * it imports no doctor, and no core file names a check.
 */
import type { DoctorCheck } from "@specstride/contracts/ep/doctor";

/** The annex that owns the registry. */
export const DOCTOR_REGISTRY_ANNEX = "annex G, §G.7" as const;

/** The requirement that fixes the registry. */
export const DOCTOR_REGISTRY_REQUIREMENT = "F100-FR-189" as const;

const registered: DoctorCheck[] = [];

/** Register one check of the consumer's set-up (§G.7, Inputs). Idempotent per id. */
export function registerDoctorCheck(check: DoctorCheck): void {
  const existing = registered.findIndex((c) => c.id === check.id);
  if (existing >= 0) registered[existing] = check;
  else registered.push(check);
}

/** The checks registered so far, in registration order. */
export function registeredDoctorChecks(): readonly DoctorCheck[] {
  return Object.freeze([...registered]);
}

/** Forget every registered check (the tests of a package run in isolation). */
export function resetDoctorChecks(): void {
  registered.length = 0;
}
