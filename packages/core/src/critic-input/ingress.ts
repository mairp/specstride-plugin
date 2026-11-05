// Feature 117 (T097) — the ONE ingress of F100-FR-009, as this feature calls
// it.
//
// Every text from outside the runtime that a module of `critic-input/` writes
// to a sink (a field of a grounding event, a line on standard error, the kept
// prompt, the transparency section of the feedback, a refusal record) passes
// THIS ingress, where it is redacted first and cut second (annex X §X.4,
// F100-FR-205). No module of this group redacts: a scan of the group finds no
// redaction primitive and no placeholder literal (checked by the observability
// static check `redactionOutsideTheIngress` and by CT-117-44).
//
// The composition root hands the real ingress in (the observability `Ingress`
// of `packages/observability/src/ingress/ingress.ts`, class of the call
// target); the core holds the TYPE only and imports nothing from the
// observability package.
//
// Where the redactor CANNOT run, the ingress fails closed: the result carries
// no text, only the drop and its mark (F100-FR-205). A writer that receives a
// drop writes the MARK in the content's place and says so in its record; it
// never fails the call for it (F117-FR-044).

/** The ingress class of the texts of the call target (row 89 of annex X §X.6). */
export const INGRESS_CLASS = "target" as const;

/**
 * The one ingress the outside text of a critic-class call passes, injected.
 * Returns the redacted, cut text, or the drop with its mark. The composition
 * root wires the observability ingress of class `target`; core holds the type
 * only.
 */
export type OutsideTextIngress = (
  text: string,
  ingressClass: string,
) =>
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly dropped: true; readonly mark: string };

/**
 * Hand ONE piece of outside text over to the ingress, for a writer that can
 * hold only a string (a path in an event, a token in a section line). Where no
 * ingress is wired the text stands as it is; where the ingress drops it the
 * mark of dropped content stands in the text's place (F100-FR-205) — the
 * caller's record states the drop, and nothing of the text reaches the sink.
 */
export function throughIngress(text: string, ingress: OutsideTextIngress | undefined): string {
  if (ingress === undefined) return text;
  const outcome = ingress(text, INGRESS_CLASS);
  if (outcome.ok) return outcome.text;
  return outcome.mark;
}
