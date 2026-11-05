/**
 * The folder `gate` of `@specstride/verification`: the verification gate that
 * runs every command before the critic is called, the feedback the engine
 * writes itself when it fails, the events and the log line around it, and the
 * result records it writes once, and RELEASE VERIFICATION — the one further
 * gate a release is verified as a whole by (F105-FR-008).
 *
 * Owned requirements: F105-FR-005 to F105-FR-009, F105-FR-032 and
 * the path of command output through the one ingress (F105-FR-054). The one
 * call site of the check runner (T010) is here as well.
 */
export * from "./run-command.ts";
export * from "./ingress.ts";
export * from "./gate.ts";
export * from "./feedback.ts";
export * from "./events.ts";
export * from "./records.ts";
export * from "./release.ts";
