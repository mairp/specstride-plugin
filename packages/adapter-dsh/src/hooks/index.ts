/**
 * T006 — the code hooks of the dsh adapter, as a registry.
 *
 * The descriptor says what data can say; three things about dsh need code, and
 * they are the hooks of this adapter (plan.md, research D-1):
 *
 *   `settings-overlay`  the throwaway home that selects a model (phase 4, T03x)
 *   `critic-patch`      the deny-list patch and the tool-coverage proof (phase 5)
 *   `plugin-protocol`   the baseline plugin request protocol (phase 6, T05x)
 *
 * This phase (phase 1) creates the directories the hooks live in and exports
 * the registry that names them. Each entry carries the task of
 * `specs/130-adapter-dsh/tasks.md` that implements it, so a consumer that asks
 * for a hook before its phase lands is told plainly that it is scheduled, and
 * no hook is faked. The hook implementations themselves replace the `status`
 * of their entry when their task runs.
 */

/** The id of a code hook of the dsh adapter. */
export type DshHookId = "settings-overlay" | "critic-patch" | "plugin-protocol";

/** One entry of the hook registry: what it is, where it lives, when it lands. */
export type DshHookEntry = {
  readonly id: DshHookId;
  /** What the hook does that the descriptor data cannot say. */
  readonly purpose: string;
  /** The module under `src/` that implements it. */
  readonly module: string;
  /** The task of `specs/130-adapter-dsh/tasks.md` that implements the hook. */
  readonly task: string;
  /** `scheduled` until the implementing task lands the hook. */
  readonly status: "scheduled" | "implemented";
};

/** The hooks of the dsh adapter, in the order the plan builds them. */
export const DSH_HOOKS: readonly DshHookEntry[] = Object.freeze([
  {
    id: "settings-overlay",
    purpose:
      "the throwaway home that selects a model: link every entry of the real home except the settings file, write the new settings block, remove the home afterwards (data-model.md, Settings overlay)",
    module: "packages/adapter-dsh/src/overlay/",
    task: "phase 4 (T032 to T035)",
    status: "implemented",
  },
  {
    id: "critic-patch",
    purpose:
      "the temporary patch file that makes the critic tool-less, and the coverage check of the exposed tool ids against it (data-model.md, Critic patch and proof)",
    module: "packages/adapter-dsh/src/critic/ and packages/adapter-dsh/src/coverage/",
    task: "phase 5 (T036 to T043)",
    status: "implemented",
  },
  {
    id: "plugin-protocol",
    purpose:
      "the plugin request protocol of the baseline: request as a claim, installer call, receipt, consent, prompt section (plan.md, src/plugins/)",
    module: "packages/adapter-dsh/src/plugins/",
    task: "phase 6 (T044 to T057)",
    status: "implemented",
  },
]);

/** The ids of the hooks, as a closed list. */
export const DSH_HOOK_IDS: readonly DshHookId[] = Object.freeze(DSH_HOOKS.map((h) => h.id));

/** The hook with the id, or undefined. */
export function dshHookOf(id: string): DshHookEntry | undefined {
  return DSH_HOOKS.find((hook) => hook.id === id);
}

/**
 * True where every hook of the registry is implemented. Phase 1 exports the
 * registry with every entry `scheduled`; the implementing tasks set their own
 * entry to `implemented` when the hook lands.
 */
export function allHooksImplemented(): boolean {
  return DSH_HOOKS.every((hook) => hook.status === "implemented");
}
