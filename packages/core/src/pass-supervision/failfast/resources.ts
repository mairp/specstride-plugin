/**
 * T070 of feature 118 — the doctor input: the list of resources that jobs
 * declared (F118-FR-042; CQ-057, the optional field `job.resource`).
 *
 * A job MAY declare an exclusive `resource` that it needs. When a check or a
 * job waits on a declared resource, `resource.wait` is emitted (see
 * `events.ts`), and the doctor is told exactly which resources the jobs of
 * the attempt declared, so that it can name the ones it cannot check.
 *
 * The list is a pure function over the declarations that were read from the
 * yields and the job records: deduplicated, in first-declaration order, so
 * that the doctor's report is stable across runs with the same inputs.
 */

/** A job that declared an exclusive resource it needs. */
export interface JobResourceDeclaration {
  /** The logical name of the job in the process registry. */
  readonly job: string;
  /** The declared resource (a name of the key table of feature 110). */
  readonly resource: string;
}

/**
 * The resources the jobs of a phase attempt declared (F118-FR-042): the
 * doctor is told exactly these, so that it can name the ones it cannot
 * check. Declared once per job; an undeclared job contributes nothing.
 * Duplicates collapse to one entry; the order of the first declaration holds.
 */
export function resourcesForTheDoctor(jobs: readonly JobResourceDeclaration[]): readonly string[] {
  const seen = new Set<string>();
  for (const declaration of jobs) seen.add(declaration.resource);
  return [...seen];
}

/**
 * The doctor input for one declared resource: which jobs declared it, in the
 * order they declared it. A resource no job declared yields an empty list.
 */
export function jobsOfResource(
  resource: string,
  jobs: readonly JobResourceDeclaration[],
): readonly string[] {
  return jobs.filter((declaration) => declaration.resource === resource).map((d) => d.job);
}

/**
 * True when a waiter (a check or a job) waits on a resource that one of the
 * jobs of the attempt declared exclusive (F118-FR-042): the waiter then
 * emits `resource.wait` with the resource, the holder and the waiting time.
 */
export function waitsOnADeclaredResource(
  resource: string,
  jobs: readonly JobResourceDeclaration[],
): boolean {
  return jobs.some((declaration) => declaration.resource === resource);
}
