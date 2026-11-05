/**
 * The events of a check: `check.started`, `check.ended` with the batch fields
 * of F148-FR-017, and the integrity note of F148-FR-010 (the event type whose
 * kind is manifest-hash) (plan.md, "Project Structure"; F148-FR-007,
 * F148-FR-010, F148-FR-017).
 *
 * The two events of a batch itself, the admission and the lowering, belong
 * with the formation that decides them and stand in `../batch/`.
 */
export * from "./check-events.ts";
export * from "./batch-fields.ts";
