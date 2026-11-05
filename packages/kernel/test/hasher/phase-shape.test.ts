/**
 * T007 — unit tests of the phase shape (annex X §X.5; F104-FR-021;
 * behaviour rows B-2041 and B-1986).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PHASE_SHAPE_LENGTH, phaseShape } from "../../src/hasher/index.ts";
import {
  PHASE_ONE,
  PHASE_ONE_COLLAPSED,
  PHASE_SHAPE_OF_PHASE_ONE,
  PHASE_SHAPE_OF_PHASE_TWO,
  PHASE_TWO,
} from "./baseline.ts";

test("T007: the phase shape is 16 hexadecimal characters", () => {
  assert.equal(PHASE_SHAPE_LENGTH, 16);
  const shape = phaseShape(PHASE_ONE);
  assert.equal(shape.length, 16);
  assert.match(shape, /^[0-9a-f]{16}$/);
});

test("T007: the phase shape is taken over the number, the title and the criteria", () => {
  assert.equal(phaseShape(PHASE_ONE), PHASE_SHAPE_OF_PHASE_ONE);
  assert.equal(phaseShape(PHASE_TWO), PHASE_SHAPE_OF_PHASE_TWO);
  // Each of the three is in the input: changing any one changes the shape.
  assert.notEqual(phaseShape({ ...PHASE_ONE, number: 9 }), PHASE_SHAPE_OF_PHASE_ONE);
  assert.notEqual(phaseShape({ ...PHASE_ONE, title: "Other" }), PHASE_SHAPE_OF_PHASE_ONE);
  assert.notEqual(phaseShape({ ...PHASE_ONE, criteria: [] }), PHASE_SHAPE_OF_PHASE_ONE);
});

test("T007: runs of white space are collapsed", () => {
  // The two inputs differ only in white space inside the title and the
  // criteria; the shape is one value.
  assert.equal(phaseShape(PHASE_ONE), phaseShape(PHASE_ONE_COLLAPSED));
  assert.equal(phaseShape(PHASE_ONE_COLLAPSED), PHASE_SHAPE_OF_PHASE_ONE);
  // Leading and trailing white space is trimmed too.
  assert.equal(
    phaseShape({ ...PHASE_ONE_COLLAPSED, title: "  Setup and captures\t" }),
    PHASE_SHAPE_OF_PHASE_ONE,
  );
});

test("T007: the order of the criteria is content, and is not sorted away", () => {
  const reversed = { ...PHASE_ONE_COLLAPSED, criteria: ["second criterion", "first criterion"] };
  assert.notEqual(phaseShape(reversed), PHASE_SHAPE_OF_PHASE_ONE);
});

test("T007: a tick never changes the shape, because no mark is in its input", () => {
  // The criteria a model hands over are the TEXT of the checkbox lines and
  // carry no mark, so ticking cannot reach the shape. The hasher strips no
  // mark itself: that would be grammar, which it does not hold beyond the
  // mark rule of F104-FR-022.
  const phase = { number: 3, title: "Polish", criteria: ["the first thing", "the second thing"] };
  assert.equal(phaseShape(phase), phaseShape({ ...phase, criteria: [...phase.criteria] }));
  // Were a caller to hand marks over, the shape would differ — which is why
  // the model, and not the hasher, owns what a criterion's text is.
  assert.notEqual(
    phaseShape({ ...phase, criteria: ["- [x] the first thing", "the second thing"] }),
    phaseShape(phase),
  );
});

test("T007: the shape is stable across calls", () => {
  assert.equal(phaseShape(PHASE_ONE), phaseShape(PHASE_ONE));
});
