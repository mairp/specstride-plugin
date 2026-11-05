/**
 * T047 — THE VERIFICATION OF THE OBJECTS OF A TREE (F143-FR-003; R29v
 * PU-100).
 *
 * F143-FR-003: "Before `materialize` and before the application the store
 * MUST verify that every object of the tree is present; a missing object MUST
 * refuse the group and switch the loop layer off for the phase attempt."
 *
 * WHY THE CHECK IS WORTH A MODULE. A tree of the store is a list of object
 * ids, and an object id is a promise that bytes with that hash are somewhere
 * the store can read them. Two things can break the promise between the
 * snapshot and the use: the project's own object database can be pruned (a
 * `gc` in the project removes what no reference of the project reaches), and
 * the store's own object database can be damaged. Either way the honest
 * answer is to REFUSE THE WHOLE GROUP before one directory is made or one
 * byte of the workspace is written — not to materialize half a tree and
 * discover the rest is gone. `snapshot.ts` closes the first hole by COPYING
 * into the store every object that no reference of the project reaches
 * (`copyUnreachableObjects`); this module is the check that says so at the
 * two moments the requirement names.
 *
 * WHAT THE REFUSAL IS. `ObjectMissingFromTheStore` carries the tree, the
 * object, the refusal (`the group is refused`) and what the loop layer is
 * switched off for (`the phase attempt`) — as data, so that a caller records
 * the right thing rather than reading it out of a message.
 */
import type { TreeId } from "@specstride/contracts/ep/tree-store";
import { listTree, objectIsPresent, type StorePlaces } from "./git.ts";

/** F143-FR-003 — the two moments a tree is verified, in order. */
export const VERIFIED_BEFORE = ["materialize", "the application"] as const;
export type VerifiedBefore = (typeof VERIFIED_BEFORE)[number];

/** F143-FR-003 — what a missing object does to the group. */
export const THE_GROUP_IS_REFUSED = "the group is refused" as const;

/** F143-FR-003 — what the loop layer is switched off for. */
export const THE_LAYER_IS_OFF_FOR = "the phase attempt" as const;

/** The refusal of a tree whose object is not in the store (F143-FR-003). */
export class ObjectMissingFromTheStore extends Error {
  readonly treeId: string;
  readonly objectId: string;
  /** What happens to the group: it is refused. */
  readonly refusal: typeof THE_GROUP_IS_REFUSED = THE_GROUP_IS_REFUSED;
  /** What the loop layer is switched off for: the phase attempt. */
  readonly theLayerIsOffFor: typeof THE_LAYER_IS_OFF_FOR = THE_LAYER_IS_OFF_FOR;
  /** The moment the verification ran, where the caller named one. */
  readonly before: VerifiedBefore | "";
  constructor(treeId: string, objectId: string, before: VerifiedBefore | "" = "") {
    super(
      `the object ${objectId} of the tree ${treeId} is not in the store` +
        (before === "" ? "" : ` (verified before ${before})`) +
        `: ${THE_GROUP_IS_REFUSED} and the loop layer is switched off for ` +
        `${THE_LAYER_IS_OFF_FOR} (F143-FR-003)`,
    );
    this.name = "ObjectMissingFromTheStore";
    this.treeId = treeId;
    this.objectId = objectId;
    this.before = before;
  }
}

/**
 * F143-FR-003 — the objects of the tree that are NOT in the store, in the
 * order of the paths. The tree object itself is checked first: a tree whose
 * own object is gone cannot even be listed, and the honest report is that the
 * tree id is the missing object.
 */
export function missingObjectsOfTheTree(places: StorePlaces, treeId: TreeId): readonly string[] {
  if (!objectIsPresent(places, treeId)) return Object.freeze([treeId]);
  const missing: string[] = [];
  for (const entry of listTree(places, treeId)) {
    if (!objectIsPresent(places, entry.oid)) missing.push(entry.oid);
  }
  return Object.freeze(missing);
}

/** What one verification of a tree found. */
export type Verification = {
  readonly treeId: string;
  readonly before: VerifiedBefore | "";
  /** The object ids checked, the tree's own included. */
  readonly checked: number;
  readonly missing: readonly string[];
  readonly verified: boolean;
};

/**
 * F143-FR-003 — VERIFY THAT EVERY OBJECT OF THE TREE IS PRESENT. Returns the
 * verification where it holds and THROWS `ObjectMissingFromTheStore` where it
 * does not: the group is refused and the loop layer is switched off for the
 * phase attempt.
 */
export function verifyEveryObjectIsPresent(
  places: StorePlaces,
  treeId: TreeId,
  before: VerifiedBefore | "" = "",
): Verification {
  const missing = missingObjectsOfTheTree(places, treeId);
  if (missing.length > 0) {
    throw new ObjectMissingFromTheStore(treeId, missing[0] as string, before);
  }
  return Object.freeze({
    treeId,
    before,
    checked: listTree(places, treeId).length + 1,
    missing,
    verified: true,
  });
}

/** F143-FR-003 — the verification `materialize` runs before it makes a tree. */
export function verifyBeforeMaterialize(places: StorePlaces, treeId: TreeId): Verification {
  return verifyEveryObjectIsPresent(places, treeId, "materialize");
}

/** F143-FR-003 — the verification the application runs before it writes. */
export function verifyBeforeTheApplication(places: StorePlaces, treeId: TreeId): Verification {
  return verifyEveryObjectIsPresent(places, treeId, "the application");
}

/**
 * The name kept from phase 3, when the per-object check lived in
 * `materialize.ts`. It is the same check; `verify.ts` is its home from T047
 * on (the task names this file), and `materialize.ts` calls
 * `verifyBeforeMaterialize`.
 */
export function everyObjectIsPresent(places: StorePlaces, treeId: TreeId): void {
  verifyEveryObjectIsPresent(places, treeId);
}
