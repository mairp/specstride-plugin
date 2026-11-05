// T038 (F116-FR-010; IR-12, IR-41) — authorisation from the task text at
// launch: a task that names a path authorises that path and no other. It
// applies to class A and to class B. The proposer cannot grant it: a note of
// a checkpoint that claims authorisation changes nothing.
export type Authorisation = Record<string, string[]>;

const PATH_LIKE = /[\w@.-]+(?:\/[\w@.+*-]+)+\.[A-Za-z0-9]+|\.[\w-]+\/[\w@./+-]*/g;

/** Extract the paths named in the text of the tasks, read at launch. */
export function authorisedPathsFromTasks(tasks: { id: string; text: string }[]): Authorisation {
  const authorised: Authorisation = {};
  for (const task of tasks) {
    const named = new Set<string>();
    for (const match of task.text.matchAll(PATH_LIKE)) {
      const token = match[0].replace(/[.,;:)]+$/, "");
      if (token.length > 0) named.add(token);
    }
    authorised[task.id] = [...named].sort();
  }
  return authorised;
}

/** Is `path` authorised for `taskId`? Authorisation is per task, no other. */
export function isAuthorised(authorised: Authorisation, taskId: string, path: string): boolean {
  return (authorised[taskId] ?? []).includes(path);
}

/**
 * A note of the proposer that claims authorisation changes nothing: the note
 * is data (Principle III), never a source of authorisation. This returns true
 * when the note grants nothing — every path it claims is absent from the
 * authorisation the task text granted at launch.
 */
export function checkpointNoteGrantsNothing(
  authorised: Authorisation,
  taskId: string,
  note: string,
): boolean {
  const claimed = [...note.matchAll(PATH_LIKE)].map((m) => m[0].replace(/[.,;:)]+$/, ""));
  return claimed.every((path) => !isAuthorised(authorised, taskId, path));
}
