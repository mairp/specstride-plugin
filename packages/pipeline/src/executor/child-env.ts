/**
 * T009 — the child environment builder (F123-FR-003).
 *
 * Every child of the pipeline runs with an environment built as follows:
 *
 * - an entry taken from a named variable copies that variable; a missing
 *   required variable gives the message `required environment variable is
 *   unset: <name>`; a missing optional one removes the target name;
 * - the keys pinned by the launch contract — the learning mode, the bound of
 *   learning decisions, live output in a run without a terminal, and the
 *   feature slug of the stage — and no other key take the value of the
 *   launch contract, and the value from the shell is stripped;
 * - with colour off every child gets `NO_COLOR=1` unless it declares its own;
 * - a stage of kind `specstride` runs without live output;
 * - nothing else of the pipeline entry's own environment leaks into the child.
 */
/** One entry of the environment of an action (§G.8, action). */
export type EnvironmentEntry = {
  /** The name of the variable in the shell of the pipeline entry. */
  name: string;
  /** The name the child sees; defaults to `name`. */
  target?: string;
  /** Whether the entry is required; a missing required one refuses the stage. */
  required: boolean;
  /** A literal value, when the entry is not taken from a variable. */
  value?: string;
};

/**
 * The pinned keys of the launch contract (F123-FR-003) — and no other key.
 *
 * `SPECSTRIDE_FEATURE` names the feature slug of the stage a child runs for
 * (the stage id is `run-<slug>`): it is pinned by the launch and never taken
 * from the shell, so a caller that exports a variable of that name cannot
 * change which feature's evidence a child writes.
 */
export const PINNED_KEYS = [
  "SPECSTRIDE_LEARNING_MODE",
  "SPECSTRIDE_LEARNING_DECISIONS_BOUND",
  "SPECSTRIDE_LIVE_OUTPUT",
  "SPECSTRIDE_FEATURE",
] as const;
export type PinnedKey = (typeof PINNED_KEYS)[number];

/** A missing required variable, with the exact message of F123-FR-003. */
export class MissingEnvironmentVariable extends Error {
  constructor(name: string) {
    super(`required environment variable is unset: ${name}`);
    this.name = "MissingEnvironmentVariable";
  }
}

/** The result of one build: the environment, and every message the build produced. */
export type ChildEnvironment = {
  env: Record<string, string>;
  messages: string[];
};

/**
 * Build the environment of one child. Pure: it reads only its arguments.
 *
 * `pinned` holds the values the launch contract pins; a key of the shell with
 * the same name is stripped and the pinned value wins. A pinned key that is
 * absent from `pinned` is removed from the child too — a pinned key never
 * passes through from the shell.
 */
export function buildChildEnvironment(input: {
  entries: readonly EnvironmentEntry[];
  pinned?: Partial<Record<PinnedKey, string>>;
  shell: Readonly<Record<string, string | undefined>>;
  colourOn: boolean;
  kind: string;
}): ChildEnvironment {
  const env: Record<string, string> = {};
  const messages: string[] = [];

  for (const entry of input.entries) {
    const target = entry.target ?? entry.name;
    if (entry.value !== undefined) {
      env[target] = entry.value;
      continue;
    }
    const value = input.shell[entry.name];
    if (value !== undefined) {
      env[target] = value;
      continue;
    }
    if (entry.required) {
      messages.push(`required environment variable is unset: ${entry.name}`);
      continue;
    }
    // A missing optional entry removes the target name (F123-FR-003).
    delete env[target];
  }

  // The pinned keys take the value of the launch contract; the value from the
  // shell is stripped (F123-FR-003).
  for (const key of PINNED_KEYS) {
    delete env[key];
    const pinned = input.pinned?.[key];
    if (pinned !== undefined) env[key] = pinned;
  }

  // A stage of kind `specstride` runs without live output (F123-FR-003).
  if (input.kind === "specstride") env["SPECSTRIDE_LIVE_OUTPUT"] = "off";

  // With colour off every child gets NO_COLOR=1 unless it declares its own.
  if (!input.colourOn && !("NO_COLOR" in env)) env["NO_COLOR"] = "1";

  return { env, messages };
}
