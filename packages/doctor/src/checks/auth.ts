/**
 * T050 (feature 112) — the checks of the groups `auth` and `model`
 * (F112-FR-014; CT-112-114; catalogue rows 17 to 20).
 *
 * F112-FR-014:
 * - `auth.<id>.<role>` reports whether the credential of a role in use is
 *   present — the status command of the harness at auth tier 1, the presence
 *   of the secret reference at auth tier 2 — and `unprobed` where no way
 *   exists; it fails when a role in use has no credential.
 * - `auth.tier.<role>` shows the auth tier and the billing mode in effect and
 *   warns loudly when an API key is in effect.
 * - `model.reach.<role>` fails when the configured model is not served, using
 *   a free model list where the harness has one and reporting `unprobed`
 *   otherwise; skipped by `--quick` and `--offline`.
 * - `model.window.<role>` warns when the context window is unknown and the
 *   harness could be a critic candidate.
 * An account identifier is never printed: it is dropped from the evidence
 * before the finding is built.
 *
 * Every probe reads only its injected probe bag: no real machine in a test,
 * no secret is read, no paid call is made (the model-list GET is a free list).
 */
import type { Check, ProbeBag, Severity } from "../registry/types.ts";
import { cfg } from "./read.ts";

/** The credential state `auth.<id>.<role>` reports (F112-FR-014). */
export type AuthState = "present" | "missing" | "unprobed";

/** `auth.<id>.<role>` — the credential of one role of one harness (row 17, lb). */
export function authCheckFor(harnessId: string, role: string): Check {
  return {
    id: `auth.${harnessId}.${role}`,
    group: "auth",
    lb: true,
    order: 17,
    messageTemplate: `${harnessId}: ${role} {state}`,
    fixHint: "log in yourself, or set a secret reference for the role",
    severityRule: (o: unknown): Severity => {
      const s = o as { state: AuthState };
      // F112-FR-014: fail when a role in use has no credential; info unprobed.
      return s.state === "missing" ? "fail" : s.state === "unprobed" ? "info" : "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const key = `auth.${harnessId}.${role}`;
      const entry = cfg<{ tier?: number; state?: AuthState; statusCommand?: readonly string[] }>(
        b,
        key,
        {},
      );
      if (entry === undefined || (entry.state === undefined && entry.tier === undefined)) {
        return undefined;
      }
      const tier = entry.tier === 2 ? 2 : 1;
      let state = entry.state;
      if (state === undefined) {
        if (tier === 2) {
          // Auth tier 2: the presence of the secret reference is the probe.
          state = "unprobed";
        } else {
          // Auth tier 1: the status command of the harness (a free call).
          const command = entry.statusCommand;
          if (command === undefined || b.quick) {
            state = "unprobed";
          } else {
            const result = await b.subprocess.run(command[0] as string, command.slice(1));
            if (result.skipped === true) state = "unprobed";
            else state = result.code === 0 && result.stdout.trim() !== "" ? "present" : "missing";
          }
        }
      }
      return { state, tier };
    },
  };
}

/** `auth.tier.<role>` — the auth tier and the billing mode (row 18). */
export function authTierCheckFor(role: string): Check {
  return {
    id: `auth.tier.${role}`,
    group: "auth",
    lb: false,
    order: 18,
    messageTemplate: `${role}: tier {tier} {mode}{capText}{keyText}`,
    fixHint: "none",
    severityRule: (o: unknown): Severity => {
      const s = o as { apiKey: boolean };
      // F112-FR-014: a loud warning when an API key is in effect.
      return s.apiKey ? "warn" : "info";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = cfg<{
        tier?: number;
        billingMode?: string;
        apiKey?: boolean;
        capUsd?: number;
        accountId?: string;
      }>(b, `auth.tier.${role}`, {});
      if (entry.tier === undefined && entry.billingMode === undefined && !entry.apiKey) {
        return undefined;
      }
      const apiKey = entry.apiKey === true;
      return {
        tier: entry.tier ?? 1,
        mode: entry.billingMode ?? "subscription",
        capText: entry.capUsd !== undefined ? `, cap $${String(entry.capUsd)}` : "",
        // Loud: the warning names the API key in the message as well.
        keyText: apiKey ? ", API key in effect" : "",
        apiKey,
      };
    },
  };
}

/** `model.reach.<role>` — the configured model against the model list (row 19, lb). */
export function modelReachCheckFor(role: string): Check {
  return {
    id: `model.reach.${role}`,
    group: "model",
    lb: true,
    order: 19,
    messageTemplate: `${role}: {modelText}`,
    fixHint: "choose a listed model",
    severityRule: (o: unknown): Severity => {
      const s = o as { state: "served" | "not-served" | "unprobed" };
      // F112-FR-014: fail when the configured model is not served; info unprobed.
      return s.state === "not-served" ? "fail" : s.state === "unprobed" ? "info" : "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = cfg<{
        model?: string;
        served?: boolean;
        modelListUrl?: string;
      }>(b, `model.reach.${role}`, {});
      if (entry.model === undefined && entry.served === undefined) return undefined;
      // `--quick` and `--offline` skip the check: no finding at all. Offline
      // is the configuration key `doctor.online` false (row 61) or the flag.
      if (b.quick) return undefined;
      if (cfg<boolean>(b, "doctor.online", true) === false) return undefined;
      const model = entry.model ?? "unknown";
      let served = entry.served;
      if (served === undefined && entry.modelListUrl !== undefined) {
        // A free model list, GET only through the bag (research D-11).
        const response = await b.network.get(entry.modelListUrl as string);
        served = response.status === 200 && response.body.includes(model);
      }
      return {
        model,
        state: served === undefined ? "unprobed" : served ? "served" : "not-served",
        modelText:
          served === undefined
            ? `${model} unprobed (no model list)`
            : served
              ? `${model} in the model list`
              : `${model} not in the model list`,
      };
    },
  };
}

/** `model.window.<role>` — the context window of the role (row 20). */
export function modelWindowCheckFor(role: string): Check {
  return {
    id: `model.window.${role}`,
    group: "model",
    lb: false,
    order: 20,
    messageTemplate: `${role}: {windowText}`,
    fixHint: "declare the window in the harness entry",
    severityRule: (o: unknown): Severity => {
      const s = o as { warn: boolean };
      // F112-FR-014: warn when the window is unknown and the harness could be
      // a critic candidate.
      return s.warn ? "warn" : "ok";
    },
    probe: async (bag) => {
      const b = bag as unknown as ProbeBag;
      const entry = cfg<{ window?: number; criticCandidate?: boolean }>(
        b,
        `model.window.${role}`,
        {},
      );
      if (entry.window === undefined && entry.criticCandidate !== true) return undefined;
      const warn = entry.window === undefined && entry.criticCandidate === true;
      return {
        warn,
        window: entry.window,
        windowText:
          entry.window === undefined
            ? "window unknown: harness cannot be auto-picked as critic"
            : `window ${String(entry.window)}`,
      };
    },
  };
}
