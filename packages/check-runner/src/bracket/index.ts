/**
 * The fingerprint bracket of a command of the verification gate: the two
 * readings taken through the owner of the protected set (EP-16, feature
 * 116), their comparison with the declared writes left out, and the taint
 * that follows a difference (plan.md, "Project Structure"; F148-FR-006,
 * F148-FR-014).
 *
 * Phase 1 creates the folder of `plan.md`. Phase 4 (T028) fills it:
 * `fingerprint.ts` holds the two readings, the comparison and the taint;
 * `protected-fact.ts` holds the protected-set fact of the fact block and the
 * rule that no count of tests is contributed to it. The containment level of a
 * gate command is the fifth claim of F148-FR-006 and sits with the kind it
 * binds, in `../command/containment.ts`.
 */
export * from "./fingerprint.ts";
export * from "./protected-fact.ts";
