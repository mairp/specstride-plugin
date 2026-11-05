/**
 * The child of the operating-system trace of CT-146-9: it runs discovery
 * once over the fixture home and prints the ids it found, so the trace of
 * the parent can see that discovery really ran.
 */
const module_ = await import("./canary.ts");
const run = await module_.runCanaryDiscovery();
process.stdout.write(`${JSON.stringify(run.candidateIds)}\n`);
