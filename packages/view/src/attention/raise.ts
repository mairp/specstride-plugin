/**
 * T055 — the raising of the nine kinds of attention item
 * (`contracts/lane-and-attention.md`; F129-FR-017, F129-FR-018, F129-FR-019,
 * F129-FR-021).
 *
 * An item has `kind`, `key`, `since`, `oneLine`, `need`, `next` and the fields
 * of its kind. `next` comes from the FIXED table (`NEXT_COMMAND` in
 * `index.ts`) and never from text of the run. Items are listed in the order of
 * the table, then by `since` (`orderAttention`). The `need` of a blocked item
 * is text taken from the terminal record or the event `blocked`, redacted and
 * cut by the caller's settle (`project`); every other free text an item
 * carries — the blocked `question` and `options`, and the `file` of a launch
 * refused for a changed source — passes through the SAME text safety here
 * (F129-FR-009), with the redactor the caller injected. The text a run writes
 * never reaches an item unredacted, with a control character, or as a
 * physical path.
 */
import type {
  AttentionItem,
  BudgetRow,
  ProcessHolder,
  StaleCondition,
  ViewState,
} from "../model/view.ts";
import { safeText, type Redactor } from "../text/index.ts";
import { NEXT_COMMAND } from "./index.ts";

/** The budget levels that raise `budget-alert` (`contracts/lane-and-attention.md`, row 6). */
export const BUDGET_ALERT_LEVELS: readonly string[] = Object.freeze(["warn", "loud", "over"]);

/** The class of a holder of the run token that raises `orphan-processes` (row 8). */
export const ORPHAN_HOLDER_CLASS = "owned" as const;

/** What the terminal record or the event `blocked` gives the item of row 1. */
export type BlockedInput = {
  readonly reason: string | null;
  readonly question: string | null;
  readonly options: readonly string[];
  /** The `need` text, already redacted and cut by the settle (F129-FR-009). */
  readonly need: string | null;
};

/** The values the raising reads, all of them fields the view already holds or settle values. */
export type RaiseInputs = {
  readonly runId: string | null;
  readonly state: ViewState;
  /** The state the run record names, where that name is not one of the ten. */
  readonly stateRaw: string | null;
  readonly stateSince: string | null;
  readonly launchId: string | null;
  readonly dead: boolean;
  readonly stale: StaleCondition | null;
  readonly launchAbandoned: boolean;
  readonly blocked: BlockedInput | null;
  /** The `refusalFile` of a launch record refused for a changed source (CQ-166). */
  readonly refusalFile: string | null;
  readonly pause: Readonly<Record<string, unknown>> | null;
  readonly holders: readonly ProcessHolder[];
  readonly budgetRows: readonly BudgetRow[];
  /** The injected redactor of the caller; null where no caller gave one. */
  readonly redactor?: Redactor | null;
};

function str(record: Readonly<Record<string, unknown>> | null, key: string): string | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function item(
  kind: keyof typeof NEXT_COMMAND & AttentionItem["kind"],
  key: string,
  oneLine: string,
  fields: Readonly<Record<string, unknown>>,
  since: string | null,
  need: string | null = oneLine,
): AttentionItem {
  return Object.freeze({
    kind,
    key,
    since,
    oneLine,
    need,
    next: NEXT_COMMAND[kind],
    fields: Object.freeze({ ...fields }) as Readonly<Record<string, unknown>>,
  });
}

/**
 * The nine kinds of attention item, in the order of the table of
 * `contracts/lane-and-attention.md`, each raised exactly when its row says,
 * with the key, the fields of its kind and the fixed `next` command.
 * An item whose cause is gone is not raised: the output holds only what the
 * inputs raise now.
 */
export function attentionItemsOf(inputs: RaiseInputs): readonly AttentionItem[] {
  const items: AttentionItem[] = [];
  const since = inputs.stateSince;
  const reason = inputs.blocked?.reason ?? null;
  const sourceChanged = reason === "source-changed" || inputs.refusalFile !== null;
  // F129-FR-009 (CT-129-43) — the free text an item carries passes through the
  // same text safety as every field of the view. Where the caller injected no
  // redactor the value is carried as the settle left it (the settle of
  // `project` has already redacted the `need`).
  const redactor = inputs.redactor ?? null;
  const safe = (value: string | null): string | null =>
    redactor === null ? value : (safeText(value, redactor).value ?? null);
  const safeOptions = (): readonly string[] =>
    Object.freeze(
      inputs.blocked?.options
        .map((entry) => safe(entry))
        .filter((entry): entry is string => entry !== null) ?? [],
    );
  const safeFile = (raw: string): string =>
    redactor === null ? raw : (safeText(raw, redactor).value ?? "spec");

  /* 1 — `blocked-on-human`: the run rests blocked and the reason is not `source-changed`. */
  if (inputs.blocked !== null && reason !== null && reason !== "source-changed") {
    items.push(
      item(
        "blocked-on-human",
        reason,
        `the run is blocked: ${reason}`,
        {
          reason,
          question: safe(inputs.blocked.question),
          options: safeOptions(),
        },
        since,
        inputs.blocked.need ?? `the run is blocked: ${reason}`,
      ),
    );
  }

  /* 2 — `source-changed`: the blocked reason, or a launch refused for a changed source. */
  if (sourceChanged) {
    const file = inputs.refusalFile === null ? "spec" : safeFile(inputs.refusalFile);
    items.push(
      item(
        "source-changed",
        file,
        `the ${file} changed under the run`,
        { file },
        since,
        `the ${file} changed; accept the change or restore the file`,
      ),
    );
  }

  /* 3 — `dead-run`: the condition `dead`; the survivors are the holders found. */
  if (inputs.dead) {
    items.push(
      item(
        "dead-run",
        inputs.runId ?? "run",
        "the owner of the run is gone",
        { survivors: inputs.holders.length },
        since,
      ),
    );
  }

  /* 4 — `launch-abandoned`: the condition; the key is the launch id. */
  if (inputs.launchAbandoned) {
    items.push(
      item(
        "launch-abandoned",
        inputs.launchId ?? "launch",
        "a launch has no outcome and no lease past the handshake limit",
        {},
        since,
      ),
    );
  }

  /* 5 — `quota-pause`: the state is `paused-quota` and a pause record exists. */
  if (inputs.state === "paused-quota" && inputs.pause !== null) {
    const role = str(inputs.pause, "role") ?? "role";
    items.push(
      item(
        "quota-pause",
        role,
        `the run is paused for quota of the ${role} role`,
        {
          role,
          harness: str(inputs.pause, "harness"),
          class: str(inputs.pause, "class"),
          since: str(inputs.pause, "since") ?? since,
          resumeAt: str(inputs.pause, "resumeAt"),
          ceilingAt: str(inputs.pause, "ceilingAt"),
        },
        str(inputs.pause, "since") ?? since,
      ),
    );
  }

  /* 6 — `budget-alert`: a budget row at `warn`, `loud` or `over`. */
  for (const row of inputs.budgetRows) {
    if (!BUDGET_ALERT_LEVELS.includes(row.level)) continue;
    items.push(
      item(
        "budget-alert",
        `${row.scope}:${row.role ?? ""}:${row.level}`,
        `the budget of ${row.scope} is at ${row.level}`,
        { role: row.role, level: row.level, fraction: row.fraction },
        since,
      ),
    );
  }

  /* 7 — `stale-run`: the condition `stale`, either reason. */
  if (inputs.stale !== null) {
    items.push(
      item(
        "stale-run",
        inputs.stale.reason,
        `the run is stale: ${inputs.stale.reason}`,
        { reason: inputs.stale.reason },
        since,
      ),
    );
  }

  /* 8 — `orphan-processes`: holders of the run token of the `owned` class and no engine. */
  const orphans = inputs.holders.filter((holder) => holder.class === ORPHAN_HOLDER_CLASS);
  const engineHeld = inputs.holders.some((holder) => holder.kind === "engine");
  if (orphans.length > 0 && !engineHeld) {
    items.push(
      item(
        "orphan-processes",
        inputs.runId ?? "run",
        `${orphans.length} process(es) hold the token of a run without an engine`,
        {
          count: orphans.length,
          kinds: Object.freeze([...new Set(orphans.map((entry) => entry.kind ?? "unknown"))]),
        },
        since,
      ),
    );
  }

  /* 9 — `unknown-state`: the run record names a state outside the ten. */
  if (inputs.state === "unknown") {
    const value = inputs.stateRaw ?? "unknown";
    items.push(
      item(
        "unknown-state",
        value,
        `the state of the run record is not one of the written states`,
        { value },
        since,
      ),
    );
  }

  return Object.freeze(items);
}
