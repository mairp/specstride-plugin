/**
 * T007 (feature 112) — the registry of doctor checks (F112-FR-002,
 * F112-FR-003; EP-14). A check registers at process start; the registry is
 * read-only after launch.
 *
 * Refusals at registration (F112-FR-002):
 * - a group outside the 19 of row 134 is refused;
 * - an id that is already registered is refused (ids are never renamed, and a
 *   second registration of one id must not silently replace the first owner).
 *
 * Every package registers through the registration call of the kernel
 * (`registerDoctorCheck`, F100-FR-234). This module is the doctor's own
 * registry over that surface: it holds the validation, the running order, and
 * the seal that makes the registry read-only after launch. Registering or
 * removing a check changes no core file (F112-FR-002): the registry is
 * process memory, never a file on disk.
 */
import { MESSAGE_TEMPLATE_CAP_BYTES, GROUPS, type Check, type CheckGroup } from "./types.ts";

/** The error the registry refuses a registration with. */
export class RegistrationRefusedError extends Error {
  readonly id: string;
  readonly why: string;
  constructor(id: string, why: string) {
    super(`the check \`${id}\` is refused at registration: ${why}`);
    this.name = "RegistrationRefusedError";
    this.id = id;
    this.why = why;
  }
}

/** A stable dotted id: lowercase letters and digits, joined by single dots. */
const DOTTED_ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** One registry: validated registration, the running order, and the seal. */
export interface DoctorCheckRegistry {
  /** Register one check. Refuses a foreign group, a duplicate id and a late registration. */
  register(check: Check): void;
  /** The registered checks, in the running order (by `order`, then by id). */
  registered(): readonly Check[];
  /** True once the seal is on: after launch, the registry is read-only. */
  readonly sealed: boolean;
  /** Seal the registry: from here, every registration is refused. */
  seal(): void;
}

/**
 * Create one registry. The registry is process memory: registering or removing
 * a check writes no file (F112-FR-002, last sentence).
 */
export function createDoctorRegistry(): DoctorCheckRegistry {
  const byId = new Map<string, Check>();
  let sealedNow = false;
  return {
    get sealed(): boolean {
      return sealedNow;
    },
    seal(): void {
      sealedNow = true;
    },
    register(check: Check): void {
      if (sealedNow) {
        throw new RegistrationRefusedError(
          check.id,
          "the registry is read-only after launch (F112-FR-002)",
        );
      }
      if (!DOTTED_ID.test(check.id)) {
        throw new RegistrationRefusedError(check.id, "the id is not a stable dotted id");
      }
      if (!GROUPS.includes(check.group as CheckGroup)) {
        throw new RegistrationRefusedError(
          check.id,
          `the group \`${String(check.group)}\` is not one of the 19 groups of row 134`,
        );
      }
      if (byId.has(check.id)) {
        throw new RegistrationRefusedError(
          check.id,
          "an id is registered once; ids are never renamed and never shared",
        );
      }
      const templateBytes = Buffer.byteLength(check.messageTemplate, "utf8");
      if (templateBytes > MESSAGE_TEMPLATE_CAP_BYTES) {
        throw new RegistrationRefusedError(
          check.id,
          `the message template is ${String(templateBytes)} bytes, over the cap of ${String(
            MESSAGE_TEMPLATE_CAP_BYTES,
          )}`,
        );
      }
      byId.set(check.id, check);
    },
    registered(): readonly Check[] {
      return Object.freeze(
        [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
      );
    },
  };
}
