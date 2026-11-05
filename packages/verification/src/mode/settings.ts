/**
 * T043 — the settings of the plan place, the commands document and the
 * scaffold directory (F105-FR-002).
 *
 * Three settings, each settable by a flag and by configuration with the as-is
 * variable as an alias, and five rules that hold between them:
 *
 *  1. Unless the mode is `off`, the plan for people defaults to
 *     `testautomation/<slug>/TEST_PLAN.md` and the scaffolds to
 *     `testautomation/<slug>/generated`, both UNDER THE WORKING DIRECTORY.
 *  2. A scaffold directory that is not absolute ends the start with exit 3.
 *  3. A plan place that is relative ends the start with exit 3, AND THAT
 *     CHECK IS SKIPPED WHEN THE MODE IS `off`.
 *  4. A relative place of the commands document is resolved against the
 *     directory of the launch, and the document is READ ONLY WHEN THE MODE IS
 *     NOT `off`; a missing or empty document ends the start with exit 3 and
 *     the as-is message of B-0121.
 *  5. A scaffold directory given while the mode is `off` CHANGES THE MODE TO
 *     `plan`, without a message.
 *
 * THE ORDER MATTERS AND IS THE BASELINE'S. The scaffold check and the upgrade
 * of rule 5 run BEFORE the plan-place check of rule 3, so a relative plan
 * place given together with a scaffold directory while the mode is `off` is
 * refused — the upgrade already made the mode `plan`. `SETTING_STEPS` names
 * the steps in that order and `resolveVerificationSettings` walks them, so the
 * order is readable and not buried in control flow.
 *
 * The file system is reached through ONE injected reader (`sizeOf`), so the
 * refusal of rule 4 is provable without a file and the module has one place
 * where it touches a disk.
 */
import { statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CONFIGURATION_ERROR_CODE, type VerificationMode } from "./closed-sets.ts";
import { MESSAGE_COMPONENT, type ModeInput } from "./modes.ts";
import { COMMANDS_KEY, GENERATE_TESTS_KEY, TEST_PLAN_KEY } from "./switches.ts";
import {
  RANK_LAYERS,
  rankOfLayer,
  resolveKey,
  type Offer,
  type RankLayer,
} from "@specstride/contracts/envelope/config";

/** The flag, the as-is variable and the key of each setting (F105-FR-002). */
export const SETTINGS = Object.freeze({
  testPlan: Object.freeze({
    flag: "--test-plan",
    variable: "SPECSTRIDE_TEST_PLAN",
    key: TEST_PLAN_KEY,
  }),
  commands: Object.freeze({
    flag: "--verification-commands",
    variable: "SPECSTRIDE_VERIFICATION_COMMANDS",
    key: COMMANDS_KEY,
  }),
  generateTests: Object.freeze({
    flag: "--generate-tests",
    variable: "SPECSTRIDE_GENERATE_TESTS",
    key: GENERATE_TESTS_KEY,
  }),
});
export type SettingName = keyof typeof SETTINGS;

/** The directory under the working directory the two defaults sit in. */
export const TEST_AUTOMATION_DIRECTORY = "testautomation" as const;

/** The file name of the plan for people, under `testautomation/<slug>/`. */
export const TEST_PLAN_FILE = "TEST_PLAN.md" as const;

/** The directory of the scaffolds, under `testautomation/<slug>/`. */
export const GENERATED_DIRECTORY = "generated" as const;

/**
 * The default place of the plan for people: `testautomation/<slug>/TEST_PLAN.md`
 * under the working directory. (The placeholder of the working directory is
 * not written here: a file of a package may not name the as-is state
 * directory of one of the three as-is systems, F100-FR-026.)
 */
export function defaultTestPlan(workdir: string, slug: string): string {
  return join(workdir, TEST_AUTOMATION_DIRECTORY, slug, TEST_PLAN_FILE);
}

/**
 * The default directory of the scaffolds: `testautomation/<slug>/generated`
 * under the working directory.
 */
export function defaultGenerateTests(workdir: string, slug: string): string {
  return join(workdir, TEST_AUTOMATION_DIRECTORY, slug, GENERATED_DIRECTORY);
}

/**
 * The steps of the resolution, in the order the baseline runs them. The
 * `upgrade` step is between the scaffold check and the plan-place check, which
 * is why a relative plan place with a scaffold directory and the mode `off` is
 * refused and not skipped.
 */
export const SETTING_STEPS = [
  "scaffold-is-absolute",
  "upgrade-off-to-plan",
  "plan-place-is-absolute",
  "default-places",
  "commands-document",
] as const;
export type SettingStep = (typeof SETTING_STEPS)[number];

/** The step the plan-place check is skipped at when the mode is `off`. */
export const PLAN_PLACE_CHECK_IS_SKIPPED_WHEN_THE_MODE_IS_OFF = true as const;

/** The text of the message that refuses a relative scaffold directory. */
export function scaffoldNotAbsoluteText(path: string): string {
  return `${SETTINGS.generateTests.flag} must be an absolute path: ${path}`;
}

/** The text of the message that refuses a relative plan place. */
export function testPlanNotAbsoluteText(path: string): string {
  return `${SETTINGS.testPlan.flag} must be an absolute path: ${path}`;
}

/** The text of the message that refuses a missing or empty document (B-0121). */
export function commandsDocumentText(path: string): string {
  return `${SETTINGS.commands.flag} not found or empty: ${path}`;
}

/** A refusal of a setting: the exit code 3 and the message with its prefix. */
export type SettingRefusal = {
  readonly ok: false;
  readonly exitCode: typeof CONFIGURATION_ERROR_CODE;
  readonly step: SettingStep;
  readonly message: string;
  readonly path: string;
};

/** The settings in force, and the mode after the upgrade of rule 5. */
export type ResolvedSettings = {
  readonly ok: true;
  /** The mode after a scaffold directory given while it was `off` (rule 5). */
  readonly mode: VerificationMode;
  /** True where the mode was changed by rule 5, which happens without a message. */
  readonly modeWasUpgraded: boolean;
  /** The place of the plan for people, or `undefined` while the mode is `off`. */
  readonly testPlan: string | undefined;
  /** The directory of the scaffolds, or `undefined` while the mode is `off`. */
  readonly generateTests: string | undefined;
  /** The resolved place of the commands document, or `undefined` where none. */
  readonly commandsDocument: string | undefined;
  /** True where the document was read, which happens only outside the mode `off`. */
  readonly commandsDocumentWasRead: boolean;
};

/** The outcome of the resolution of the settings. */
export type SettingsResolution = ResolvedSettings | SettingRefusal;

/** The layers each setting is offered at. */
export type SettingOffers = {
  readonly flag?: string | undefined;
  readonly environment?: Readonly<Record<string, string | undefined>> | undefined;
  readonly projectConfiguration?: string | undefined;
  readonly userConfiguration?: string | undefined;
};

/** What the resolution of the settings is given. */
export type SettingsInput = {
  /** The mode that `resolveVerificationMode` gave, before rule 5. */
  readonly mode: VerificationMode;
  /** The working directory, under which the two defaults sit. */
  readonly workdir: string;
  /** The feature slug the two defaults are scoped by. */
  readonly slug: string;
  /** The directory of the launch, which a relative document resolves against. */
  readonly launchDirectory: string;
  readonly testPlan?: SettingOffers | undefined;
  readonly commands?: SettingOffers | undefined;
  readonly generateTests?: SettingOffers | undefined;
  /** The component name of a message, where a caller gives its own. */
  readonly component?: string | undefined;
  /**
   * The ONE reader of the file system of this module: the size of a file in
   * bytes, or `undefined` where it is not a readable file. A test gives its
   * own and proves the refusal of rule 4 without a file.
   */
  readonly sizeOf?: ((path: string) => number | undefined) | undefined;
};

/** The size of a file in bytes, or `undefined` where it is not a readable file. */
export function sizeOnDisk(path: string): number | undefined {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats.size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The layers a setting is settable at. The name carries `SETTING` because
 * `modes.ts` reads the same table of §X.2 for the key of the mode, and the two
 * lists are about different keys: a reader must not take one for the other.
 */
export const SETTING_LAYERS: readonly RankLayer[] = Object.freeze([
  "flag",
  "environment",
  "project-configuration",
  "user-configuration",
]);

/** Every layer a setting is settable at is a layer of the table of §X.2. */
export const SETTING_LAYERS_ARE_OF_THE_TABLE: boolean = SETTING_LAYERS.every((layer) =>
  (RANK_LAYERS as readonly string[]).includes(layer),
);

/** The flag of a setting wins over its variable and over configuration. */
export const THE_FLAG_OF_A_SETTING_WINS: boolean = SETTING_LAYERS.filter(
  (layer) => layer !== "flag",
).every((layer) => rankOfLayer["flag"] < rankOfLayer[layer]);

/**
 * The value of one setting through the ranks of §X.2. No default is offered
 * here: the two places take their defaults at the step `default-places`, after
 * the checks, because the baseline gives them there and a default is always
 * absolute and would make the checks unreachable.
 */
export function valueOf(name: SettingName, offers: SettingOffers | undefined): string | undefined {
  const setting = SETTINGS[name];
  const list: readonly Offer[] = Object.freeze([
    Object.freeze({ layer: "flag" as const, value: nonEmpty(offers?.flag) }),
    Object.freeze({
      layer: "environment" as const,
      value: nonEmpty(offers?.environment?.[setting.variable]),
    }),
    Object.freeze({
      layer: "project-configuration" as const,
      value: nonEmpty(offers?.projectConfiguration),
    }),
    Object.freeze({
      layer: "user-configuration" as const,
      value: nonEmpty(offers?.userConfiguration),
    }),
  ]);
  const resolved = resolveKey(setting.key, list);
  return resolved === undefined ? undefined : String(resolved.value);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Resolve the three settings and apply the five rules of F105-FR-002, in the
 * order of `SETTING_STEPS`.
 */
export function resolveVerificationSettings(input: SettingsInput): SettingsResolution {
  const component = input.component ?? MESSAGE_COMPONENT;
  const sizeOf = input.sizeOf ?? sizeOnDisk;
  let mode: VerificationMode = input.mode;
  let modeWasUpgraded = false;

  const declaredScaffolds = valueOf("generateTests", input.generateTests);
  const declaredTestPlan = valueOf("testPlan", input.testPlan);
  const declaredCommands = valueOf("commands", input.commands);

  // Step 1 and step 2. A scaffold directory is checked WHATEVER the mode is,
  // and only then does rule 5 change the mode.
  if (declaredScaffolds !== undefined) {
    if (!isAbsolute(declaredScaffolds)) {
      return refuse(
        component,
        "scaffold-is-absolute",
        scaffoldNotAbsoluteText(declaredScaffolds),
        declaredScaffolds,
      );
    }
    if (mode === "off") {
      mode = "plan";
      modeWasUpgraded = true;
    }
  }

  // Step 3. The check is SKIPPED while the mode is `off` — and the mode here
  // is the one after step 2, which is what makes the order matter.
  if (mode !== "off" && declaredTestPlan !== undefined && !isAbsolute(declaredTestPlan)) {
    return refuse(
      component,
      "plan-place-is-absolute",
      testPlanNotAbsoluteText(declaredTestPlan),
      declaredTestPlan,
    );
  }

  // Step 4. The defaults, under the working directory, unless the mode is `off`.
  const testPlan =
    mode === "off"
      ? declaredTestPlan
      : (declaredTestPlan ?? defaultTestPlan(input.workdir, input.slug));
  const generateTests =
    mode === "off"
      ? declaredScaffolds
      : (declaredScaffolds ?? defaultGenerateTests(input.workdir, input.slug));

  // Step 5. A relative document resolves against the directory of the launch,
  // and the document is READ only when the mode is not `off`.
  let commandsDocument = declaredCommands;
  let commandsDocumentWasRead = false;
  if (declaredCommands !== undefined) {
    commandsDocument = isAbsolute(declaredCommands)
      ? declaredCommands
      : join(input.launchDirectory, declaredCommands);
    if (mode !== "off") {
      commandsDocumentWasRead = true;
      const size = sizeOf(commandsDocument);
      if (size === undefined || size === 0) {
        return refuse(
          component,
          "commands-document",
          commandsDocumentText(commandsDocument),
          commandsDocument,
        );
      }
    }
  }

  return Object.freeze({
    ok: true as const,
    mode,
    modeWasUpgraded,
    testPlan,
    generateTests,
    commandsDocument,
    commandsDocumentWasRead,
  });
}

function refuse(component: string, step: SettingStep, text: string, path: string): SettingRefusal {
  return Object.freeze({
    ok: false as const,
    exitCode: CONFIGURATION_ERROR_CODE,
    step,
    message: `${component}: ${text}`,
    path,
  });
}

/** The mode and the settings resolved together, which is what a launch needs. */
export type ModeAndSettingsInput = ModeInput & Omit<SettingsInput, "mode">;
