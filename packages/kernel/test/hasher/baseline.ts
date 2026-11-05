/**
 * T007 — the golden values of the baseline, for the unit tests of the
 * canonical hasher (F104-FR-021: every hash MUST equal the baseline's on the
 * same input).
 *
 * Every value below was produced by running the BASELINE's own rule in the
 * baseline's own language, Python, over the input beside it:
 *
 *  - the content hash: `hashlib.sha256(...).hexdigest()`;
 *  - the hash that ignores checkboxes: `re.sub(r"(?m)^(\s*-\s*\[)[ xX](\]\s+T\d+[A-Za-z]?\b)", r"\1 \2", text)`
 *    then SHA-256 — `skills/mixture-of-loops/scripts/bootstrap_contract.py:44`
 *    at `9c88f86`, behaviour row B-2477, research D-3;
 *  - the canonical record text: `json.dumps(sort_keys=True,
 *    separators=(",", ":"), ensure_ascii=False)` — the behaviour row
 *    "Canonical contract bytes" of `docs/ecosystem/research/R18-partial/raw/mol-runtime.tsv`,
 *    row 75 (011 FR-009);
 *  - the canonical record hash: the content hash of that text plus `"\n"`;
 *  - the phase shape: the first 16 hexadecimal characters of the SHA-256 of
 *    the compact JSON `[n, title, [criteria]]` with runs of white space
 *    collapsed — `lib/specstride_spec.py:462`, behaviour row B-2041.
 *
 * They are written out as literals and not recomputed by the test, so that a
 * change to the TypeScript implementation cannot move the expectation with it.
 */

/** The inputs the goldens below are taken over. */
export const TASK_LIST = "# Tasks\n\n## Phase 1\n\n- [ ] T001 first task\n- [x] T002 second task\n";
export const TASK_LIST_TICKED =
  "# Tasks\n\n## Phase 1\n\n- [x] T001 first task\n- [x] T002 second task\n";
export const TASK_LIST_WITH_IDS =
  "  - [x] T012a letter id\n\t-\t[ ]\tT013 tab separated\n- [X] T014 capital mark\n";
export const TASK_LIST_WITH_IDS_CLEARED =
  "  - [ ] T012a letter id\n\t-\t[ ]\tT013 tab separated\n- [ ] T014 capital mark\n";
export const OPENSPEC_TASK_LIST =
  "## 1. First group\n\n- [ ] 1.1 first openspec task\n- [x] 1.2 second openspec task\n- [ ] 2.10.3 deep id\n";
export const OPENSPEC_TASK_LIST_TICKED =
  "## 1. First group\n\n- [x] 1.1 first openspec task\n- [x] 1.2 second openspec task\n- [X] 2.10.3 deep id\n";
export const MIXED_TASK_LIST = "- [ ] T001 a\n- [ ] 1.1 b\n";
export const MIXED_TASK_LIST_TICKED = "- [x] T001 a\n- [X] 1.1 b\n";
export const RECORD = { b: 1, a: "café", c: [3, 2] };

/** Content hashes (`hashlib.sha256`). */
export const CONTENT_HASH_OF_THE_EMPTY_TEXT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const CONTENT_HASH_OF_ABC =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
/** Over the text `"phase — café ✓\n"`, taken as UTF-8. */
export const CONTENT_HASH_OF_A_NON_ASCII_TEXT =
  "b7a2518259d44e9c87b039ccec31e8f4531ea89519ee581463e68fb3afeaf75d";
export const CONTENT_HASH_OF_THE_TASK_LIST =
  "fe17229ffba690c1901159ecd9b017018c4494dce085889aedbb65beff40dd66";
export const CONTENT_HASH_OF_THE_TASK_LIST_TICKED =
  "1d11b4235b7cbdc3594d4ac82200aeb68d9ce4412afab4ed1d01d413ba23fffa";

/**
 * The hash that ignores checkboxes, by the BASELINE's expression. The ticked
 * and the unticked task list give one value: that is the point of the rule.
 */
export const BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_TASK_LIST =
  "7ac1c740284a5dcc741558b809cc0f3f3b4245fb2c70a4e5c6914857ea74495d";
export const BASELINE_HASH_IGNORING_CHECKBOXES_OF_THE_IDS =
  "f0a0d79e1635ebcfbd09a906eb972b7d18f8f986d75ffb3187d73da40f50884a";

/**
 * A line with an EMPTY box `[]` is outside the rule, as at the baseline, so a
 * tick of such a line IS a difference: the two values differ.
 */
export const EMPTY_BOX = "- [] T003 empty box\n";
export const EMPTY_BOX_TICKED = "- [x] T003 empty box\n";
export const HASH_IGNORING_CHECKBOXES_OF_THE_EMPTY_BOX =
  "7b3116358961bdd59b64e5679406c59adeb37dbd7f58e5247aeed8db55b30a32";
export const HASH_IGNORING_CHECKBOXES_OF_THE_EMPTY_BOX_TICKED =
  "a11ad51ad0c0010a306635c9d9e423863c49d4d22e893d72b5a052f9db385783";

/** A checkbox line with no task id at all is not covered either. */
export const LINE_WITHOUT_A_TASK_ID = "- [ ] a criterion without a task id\n";
export const LINE_WITHOUT_A_TASK_ID_TICKED = "- [x] a criterion without a task id\n";
export const HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID =
  "aa904d1e69e19d256e569fb41fc7dcd27aed9239a76edde94adae069cd2cbb84";
export const HASH_IGNORING_CHECKBOXES_WITHOUT_A_TASK_ID_TICKED =
  "01884590e2f3daa6eb47ab9cffcf332f6393c14369e19b02ae1c00e377475381";

/** A single undotted number is no dotted id, so it is not covered. */
export const SINGLE_NUMBER = "- [ ] 1 not a dotted id\n";
export const SINGLE_NUMBER_TICKED = "- [x] 1 not a dotted id\n";
export const HASH_OF_THE_SINGLE_NUMBER =
  "9404cd2be569e132a0e21a3853f4c02170c1292bdc0498288530dded3b54f405";
export const HASH_OF_THE_SINGLE_NUMBER_TICKED =
  "ca87c7817d79cf2f7e832b454edaf4a2aa1f5f63a8f57c0524e9f98b9c308563";

/**
 * The widened rule of F104-FR-022 (DV-118) over an `openspec-change` task
 * list, computed in Python with the dotted-id form added to the baseline's
 * expression. The ticked and the unticked list give one value.
 */
export const HASH_IGNORING_CHECKBOXES_OF_THE_OPENSPEC_TASK_LIST =
  "a73d27ea7832ba4532db8b652452d532c1af5f861f54a48efbb4465862183952";
export const HASH_IGNORING_CHECKBOXES_OF_THE_MIXED_TASK_LIST =
  "4c9b36fec3fb94408afdcc67a5c8079d7c83fbcbc784c1717abc5fe87ff471cd";

/** The canonical record text and hash of `RECORD`, and of the empty record. */
export const CANONICAL_TEXT_OF_THE_RECORD = '{"a":"café","b":1,"c":[3,2]}';
export const CANONICAL_HASH_OF_THE_RECORD =
  "8b0cc256f6f19504d3440517096f3a43a1e3965c483abacb77ac57014c0acc09";
export const CANONICAL_TEXT_OF_THE_EMPTY_RECORD = "{}";
export const CANONICAL_HASH_OF_THE_EMPTY_RECORD =
  "ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356";

/** Phase shapes. The first and the third input differ only in white space. */
export const PHASE_ONE = {
  number: 1,
  title: "Setup  and\tcaptures",
  criteria: ["first  criterion", "second\ncriterion"],
};
export const PHASE_ONE_COLLAPSED = {
  number: 1,
  title: "Setup and captures",
  criteria: ["first criterion", "second criterion"],
};
export const PHASE_TWO = { number: 2, title: "Foundational", criteria: [] };
export const PHASE_SHAPE_OF_PHASE_ONE = "e284fc2ce34f24a6";
export const PHASE_SHAPE_OF_PHASE_TWO = "85b0fff488c90dde";
