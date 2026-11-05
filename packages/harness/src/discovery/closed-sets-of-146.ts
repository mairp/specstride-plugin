/**
 * The re-export of the three closed sets feature 146 owns, for the tests
 * of this package. The owning module is
 * `packages/contracts/src/closed-sets/harness-discovery.ts`; the sets are
 * registered in the batch files of the contracts package, and read here
 * through the all-sets module that the exports of `@specstride/contracts`
 * name.
 */
export {
  sourcesOfDiscovery,
  statesOfAHarness,
  stepsOfTheProbeLadder,
} from "@specstride/contracts/enums/all-sets";
