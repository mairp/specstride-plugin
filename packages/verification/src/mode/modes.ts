/**
 * T042 — the verification modes and the invalid-mode error (F105-FR-001).
 *
 * The mode is one of the closed set `off`, `plan`, `required` (row 52 of
 * annex X §X.6, registered in `closed-sets.ts` by T008) with the default
 * `required`. It is settable by the flag `--verification` and by
 * configuration, with the as-is variable `SPECSTRIDE_VERIFICATION` as an
 * alias of the key `verification.mode`, AND THE FLAG WINS. Any other value
 * ends the start of a run with the exit code 3 and the as-is message.
 *
 * THE FLAG WINS IS NOT WRITTEN HERE. It is the rank table of annex X §X.2,
 * where a flag is rank 2 and the environment, the project configuration and
 * the user configuration are ranks 4, 5 and 6. The resolution therefore hands
 * its offers to `resolveKey` of feature 100 (`@specstride/contracts`,
 * `envelope/config`) and takes its answer: a change of the table moves this
 * key with it, and no precedence is spelled a second time in this package.
 *
 * The message carries a COMPONENT PREFIX. The baseline writes the name of its
 * engine script there; under rule N-15 of annex X §X.8 such a prefix maps to a
 * logical component name and the text after it must be equal. This module
 * writes the logical name (`engine`, the row of the engine script in the
 * component-name table of the normalization contract) and the baseline's text
 * after it, byte for byte.
 */
import {
  RANK_LAYERS,
  rankOfLayer,
  resolveKey,
  type Offer,
  type RankLayer,
} from "@specstride/contracts/envelope/config";
import { COMPONENT_NAMES } from "@specstride/contracts/grammar/line-keys";
import {
  CONFIGURATION_ERROR_CODE,
  VERIFICATION_MODES,
  verificationModes,
  type VerificationMode,
} from "./closed-sets.ts";
import { VERIFICATION_MODE_KEY } from "./switches.ts";

/** The default of the key `verification.mode` (F105-FR-001; row 123 of §X.7). */
export const DEFAULT_VERIFICATION_MODE: VerificationMode = "required";

/** The flag that sets the mode. */
export const MODE_FLAG = "--verification" as const;

/** The as-is variable that is an alias of the key (annex X §X.8, F100-FR-203). */
export const MODE_VARIABLE = "SPECSTRIDE_VERIFICATION" as const;

/**
 * The logical component name this feature's launch messages carry (annex X
 * §X.8, the row of the engine script). The baseline's own prefix is the name
 * of that script; rule N-15 maps the one onto the other and compares the text
 * after it.
 */
export const MESSAGE_COMPONENT = "engine" as const;

/** The component name is one the table of §X.8 holds, and not a free string. */
export const MESSAGE_COMPONENT_IS_IN_THE_TABLE: boolean =
  COMPONENT_NAMES.includes(MESSAGE_COMPONENT);

/**
 * The layers of §X.2 the mode is settable at. `launch-contract-pin`,
 * `run-snapshot` and `learned-value` are not among them: the mode is no
 * pinnable key of the launch contract, the snapshot is written FROM this
 * resolution (F105-FR-010) and no knob of learning sets it.
 */
export const SETTABLE_LAYERS: readonly RankLayer[] = Object.freeze([
  "flag",
  "environment",
  "project-configuration",
  "user-configuration",
  "default",
]);

/** Every settable layer is a layer of the table of §X.2 and not invented. */
export const LAYERS_ARE_OF_THE_TABLE: boolean = SETTABLE_LAYERS.every((layer) =>
  (RANK_LAYERS as readonly string[]).includes(layer),
);

/**
 * The flag wins because the table of §X.2 gives it the lowest rank of the
 * settable layers. The fact is READ FROM THE TABLE, not asserted.
 */
export const THE_FLAG_WINS: boolean = SETTABLE_LAYERS.filter((layer) => layer !== "flag").every(
  (layer) => rankOfLayer["flag"] < rankOfLayer[layer],
);

/**
 * The text of the invalid-mode message after the component name. It names the
 * three members in the baseline's order (`off, plan, or required`), which is
 * NOT the order of row 52, so it is written FROM the closed set and not from a
 * literal: a member added to the row would otherwise go unnamed.
 */
export function invalidModeText(value: string): string {
  const members = [...VERIFICATION_MODES].reverse();
  const last = members[members.length - 1] as string;
  const spelled = `${members.slice(0, -1).join(", ")}, or ${last}`;
  return `${MODE_FLAG} must be ${spelled} (got: ${value})`;
}

/** The whole invalid-mode message, with its component prefix (B-0112). */
export function invalidModeMessage(value: string, component: string = MESSAGE_COMPONENT): string {
  return `${component}: ${invalidModeText(value)}`;
}

/** What the mode resolution gives back. */
export type ModeResolution =
  | {
      readonly ok: true;
      /** The mode in force at this step. */
      readonly mode: VerificationMode;
      /** The layer it came from, and its rank of §X.2. */
      readonly source: RankLayer;
      readonly rank: number;
    }
  | {
      readonly ok: false;
      /** The exit code of a configuration error: 3 (annex E §E.4). */
      readonly exitCode: typeof CONFIGURATION_ERROR_CODE;
      /** The message, with its component prefix. */
      readonly message: string;
      /** The value that was refused, and the layer that offered it. */
      readonly value: string;
      readonly source: RankLayer;
    };

/** What each layer declared, where it declared anything. */
export type ModeInput = {
  /** The value of `--verification`, the flag of rank 2. */
  readonly flag?: string | undefined;
  /** The whole environment; the as-is variable is read from it. */
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  /** The value of the key `verification.mode` in project configuration. */
  readonly projectConfiguration?: string | undefined;
  /** The value of the key `verification.mode` in user configuration. */
  readonly userConfiguration?: string | undefined;
  /** The component name of the message, where a caller gives its own. */
  readonly component?: string | undefined;
};

/** The offers of the layers, in the shape `resolveKey` of feature 100 takes. */
export function offersOf(input: ModeInput): readonly Offer[] {
  return Object.freeze([
    Object.freeze({ layer: "flag" as const, value: nonEmpty(input.flag) }),
    Object.freeze({
      layer: "environment" as const,
      value: nonEmpty(input.environment?.[MODE_VARIABLE]),
    }),
    Object.freeze({
      layer: "project-configuration" as const,
      value: nonEmpty(input.projectConfiguration),
    }),
    Object.freeze({
      layer: "user-configuration" as const,
      value: nonEmpty(input.userConfiguration),
    }),
    Object.freeze({ layer: "default" as const, value: DEFAULT_VERIFICATION_MODE }),
  ]);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Resolve the mode through the ranks of §X.2, the flag first. A value that is
 * not a member of row 52 ends the start of a run with the exit code 3 and the
 * as-is message (F105-FR-001) — whichever layer gave it, so that a bad value
 * in configuration is refused as a bad flag is.
 */
export function resolveVerificationMode(input: ModeInput = {}): ModeResolution {
  const resolved = resolveKey(VERIFICATION_MODE_KEY, offersOf(input));
  // The layer `default` always offers a value, so `resolveKey` always answers.
  const value = String(resolved?.value ?? DEFAULT_VERIFICATION_MODE);
  const source = (resolved?.source ?? "default") as RankLayer;
  if (!isVerificationMode(value)) {
    return Object.freeze({
      ok: false as const,
      exitCode: CONFIGURATION_ERROR_CODE,
      message: invalidModeMessage(value, input.component ?? MESSAGE_COMPONENT),
      value,
      source,
    });
  }
  return Object.freeze({
    ok: true as const,
    mode: value,
    source,
    rank: resolved?.rank ?? rankOfLayer["default"],
  });
}

/** True where the value is a member of the closed set of row 52. */
export function isVerificationMode(value: string): value is VerificationMode {
  return (VERIFICATION_MODES as readonly string[]).includes(value);
}

/**
 * The branch of row 52 for a value that is not a member. The row's rule is
 * "Exit 3 with the as-is message", so the closed set of T008 and this module
 * give the same answer and cannot drift: `read` throws for every value that is
 * not a member, and a member never reaches the throw below.
 */
export function refuseUnknownMode(value: string): never {
  verificationModes.read(value);
  throw new Error(invalidModeText(value));
}

/** The key of the run snapshot and of configuration this module resolves. */
export const KEY = VERIFICATION_MODE_KEY;
