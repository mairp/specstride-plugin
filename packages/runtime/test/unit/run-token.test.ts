/**
 * T013 — unit test of the run token and the lease token: mint, hash, place in
 * an environment (F122-FR-024, F122-FR-018; research D-9).
 *
 * The requirement is mostly a set of prohibitions — minted from a secure
 * random source, stored nowhere but the environment of the processes of the
 * launch, in records only as a hash — so most of these tests are about what
 * CANNOT happen rather than what can. The interesting ones are the three that
 * try to leak the token the way a careless caller would: by interpolating it
 * into a string, by handing it to `JSON.stringify`, and by printing it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspect } from "node:util";

import {
  LEASE_TOKEN_BYTES,
  LEASE_TOKEN_VAR,
  RUN_TOKEN_BYTES,
  RUN_TOKEN_VAR,
  TOKEN_HASH_ALGORITHM,
  TOKEN_IN_A_RECORD_IS,
  TOKEN_IS_EVER_WRITTEN_TO_DISK,
  TOKEN_VARS,
  hashToken,
  leaseTokenOf,
  mintLeaseToken,
  mintRunToken,
  runTokenOf,
  runTokenOfThisProcess,
  tokenFromSecret,
  tokenMatchesHash,
  withRunToken,
  withoutTokens,
} from "../../src/procs/run-token.ts";

/* ------------------------------------------------------------------ *
 * Mint.
 * ------------------------------------------------------------------ */

test("T013 — a run token is 32 random bytes, and a lease token likewise", () => {
  assert.equal(RUN_TOKEN_BYTES, 32);
  assert.equal(LEASE_TOKEN_BYTES, 32);
  const run = mintRunToken();
  assert.equal(run.bytes, 32);
  // 32 bytes in hexadecimal is 64 characters.
  assert.equal(run.secret().length, 64);
  assert.match(run.secret(), /^[0-9a-f]{64}$/);
  const lease = mintLeaseToken();
  assert.equal(lease.bytes, 32);
  assert.match(lease.secret(), /^[0-9a-f]{64}$/);
});

test("T013 — a token is minted fresh every time, and never derived from a counter", () => {
  // F122-FR-024 — *minted at every launch from a secure random source*. A
  // token derived from a time, a process id or a counter would be guessable by
  // exactly the process we are trying to tell from a stranger.
  const seen = new Set<string>();
  for (let n = 0; n < 200; n += 1) seen.add(mintRunToken().secret());
  assert.equal(seen.size, 200, "two of 200 minted run tokens were the same");

  const hashes = new Set<string>();
  for (let n = 0; n < 200; n += 1) hashes.add(mintRunToken().hash);
  assert.equal(hashes.size, 200);
});

/* ------------------------------------------------------------------ *
 * The token does not leak.
 * ------------------------------------------------------------------ */

test("F122-FR-024 — interpolating a token into a string yields its HASH", () => {
  const token = mintRunToken();
  const secret = token.secret();
  // The careless caller: `${token}` in a message, a path or a log line.
  const interpolated = `${token}`;
  assert.equal(interpolated, token.hash);
  assert.ok(!interpolated.includes(secret), "the secret reached an interpolated string");
  assert.equal(String(token), token.hash);
  assert.equal(token.toString(), token.hash);
});

test("F122-FR-024 — `JSON.stringify` of a token yields its hash, so a record carries the hash", () => {
  const token = mintRunToken();
  const secret = token.secret();
  assert.equal(JSON.stringify(token), JSON.stringify(token.hash));
  // And nested in the kind of object a record is.
  const record = { runTokenHash: token, launchId: "L-1" };
  const text = JSON.stringify(record);
  assert.ok(!text.includes(secret), "the secret reached a serialised record");
  assert.equal(JSON.parse(text).runTokenHash, token.hash);
  assert.equal(TOKEN_IN_A_RECORD_IS, "its hash");
  assert.equal(TOKEN_IS_EVER_WRITTEN_TO_DISK, false);
});

test("F122-FR-024 — printing a token shows its hash and not its secret", () => {
  const token = mintLeaseToken();
  const secret = token.secret();
  const shown = inspect(token);
  assert.ok(!shown.includes(secret), `the secret reached the inspector: ${shown}`);
  assert.ok(shown.includes(token.hash), "the inspector does not show the hash either");

  // `inspect` with every depth and the hidden properties shown — the way a
  // debugger or a crash reporter would — still shows nothing.
  const deep = inspect(token, { depth: null, showHidden: true, getters: true });
  assert.ok(!deep.includes(secret), `the secret reached a deep inspection: ${deep}`);
});

test("F122-FR-024 — the only way out is the named call `secret()`", () => {
  const token = mintRunToken();
  // Nothing enumerable on the token is the secret, so no walk of its own
  // properties finds it: it lives in a closure.
  for (const value of Object.values(token)) {
    assert.notEqual(value, token.secret());
  }
  const walked = JSON.stringify(Object.entries(token));
  assert.ok(!walked.includes(token.secret()));
  // And the token is frozen, so the hash cannot be swapped for another.
  assert.equal(Object.isFrozen(token), true);
  assert.throws(() => {
    (token as unknown as Record<string, unknown>)["hash"] = "0".repeat(64);
  });
});

/* ------------------------------------------------------------------ *
 * Hash.
 * ------------------------------------------------------------------ */

test("T013 — the hash is the one the kernel names, over the secret", () => {
  assert.equal(TOKEN_HASH_ALGORITHM, "sha256");
  const token = mintRunToken();
  const independent = createHash("sha256").update(token.secret(), "utf8").digest("hex");
  assert.equal(token.hash, independent, "the hash is not SHA-256 of the secret");
  assert.equal(hashToken(token.secret()), token.hash);
  assert.match(token.hash, /^[0-9a-f]{64}$/);
});

test("T013 — a token rebuilt from its secret has the same hash", () => {
  // This is how a child that inherited a token through its environment gets
  // the hash its parent recorded.
  const minted = mintRunToken();
  const rebuilt = tokenFromSecret(minted.secret());
  assert.equal(rebuilt.hash, minted.hash);
  assert.equal(rebuilt.secret(), minted.secret());
  // And the rebuilt one leaks no more than the minted one.
  assert.equal(`${rebuilt}`, rebuilt.hash);
  assert.ok(!inspect(rebuilt).includes(rebuilt.secret()));
  assert.throws(() => tokenFromSecret(""), /empty secret/);
});

test("T013 — a secret is matched against a recorded hash, and a wrong one is not", () => {
  const token = mintRunToken();
  assert.equal(tokenMatchesHash(token.secret(), token.hash), true);
  assert.equal(tokenMatchesHash(mintRunToken().secret(), token.hash), false);
  // A hash of another length, an empty one, and a non-string are all `false`
  // and never an exception: this is called on data read from a record.
  assert.equal(tokenMatchesHash(token.secret(), ""), false);
  assert.equal(tokenMatchesHash(token.secret(), token.hash.slice(0, 10)), false);
  assert.equal(tokenMatchesHash("", token.hash), false);
  assert.equal(tokenMatchesHash(token.secret(), undefined as unknown as string), false);
  assert.equal(tokenMatchesHash(undefined as unknown as string, token.hash), false);
});

/* ------------------------------------------------------------------ *
 * Place in an environment.
 * ------------------------------------------------------------------ */

test("F122-FR-024 — the token is placed in the environment of a process", () => {
  const run = mintRunToken();
  const env = withRunToken({ PATH: "/usr/bin", HOME: "/root" }, run);
  assert.equal(env[RUN_TOKEN_VAR], run.secret());
  assert.equal(env["PATH"], "/usr/bin");
  assert.equal(env["HOME"], "/root");
  assert.equal(env[LEASE_TOKEN_VAR], undefined, "no lease token was handed down");
});

test("F122-FR-018 — the lease token is placed beside it when one is handed down", () => {
  const run = mintRunToken();
  const lease = mintLeaseToken();
  const env = withRunToken({ PATH: "/usr/bin" }, run, lease);
  assert.equal(env[RUN_TOKEN_VAR], run.secret());
  assert.equal(env[LEASE_TOKEN_VAR], lease.secret());
  assert.notEqual(run.secret(), lease.secret());
  assert.deepEqual([...TOKEN_VARS], [RUN_TOKEN_VAR, LEASE_TOKEN_VAR]);
});

test("T013 — the caller's environment is not mutated, and `undefined` is dropped", () => {
  const given = Object.freeze({ PATH: "/usr/bin", GONE: undefined });
  const run = mintRunToken();
  // A frozen input proves the function does not write into it: were it to try,
  // this call would throw.
  const env = withRunToken(given, run);
  assert.equal((given as Record<string, unknown>)[RUN_TOKEN_VAR], undefined);
  assert.equal("GONE" in env, false, "an undefined variable reached the child's environment");
  assert.equal(env["PATH"], "/usr/bin");
  // And `process.env` of the starter was never touched.
  assert.equal(process.env[RUN_TOKEN_VAR], undefined);
});

test("T013 — the token of a process is read back out of an environment", () => {
  const run = mintRunToken();
  const lease = mintLeaseToken();
  const env = withRunToken({ PATH: "/usr/bin" }, run, lease);
  assert.equal(runTokenOf(env), run.secret());
  assert.equal(leaseTokenOf(env), lease.secret());
  // The hash of what was read back is the hash that was recorded: this is the
  // identity check of F122-FR-025 in miniature.
  assert.equal(hashToken(runTokenOf(env) as string), run.hash);
  assert.equal(tokenMatchesHash(runTokenOf(env) as string, run.hash), true);
});

test("T013 — an environment without a token reads as null, and so does an empty one", () => {
  assert.equal(runTokenOf({ PATH: "/usr/bin" }), null);
  assert.equal(leaseTokenOf({ PATH: "/usr/bin" }), null);
  assert.equal(runTokenOf({ [RUN_TOKEN_VAR]: "" }), null);
  assert.equal(leaseTokenOf({ [LEASE_TOKEN_VAR]: "" }), null);
  assert.equal(runTokenOf({ [RUN_TOKEN_VAR]: undefined }), null);
  // This test process was not started by a launch, so it carries no token.
  assert.equal(runTokenOfThisProcess(), null);
});

test("T013 — both tokens can be taken back out, for a process that must not pass the check", () => {
  const env = withRunToken({ PATH: "/usr/bin", HOME: "/root" }, mintRunToken(), mintLeaseToken());
  const stripped = withoutTokens(env);
  assert.equal(runTokenOf(stripped), null);
  assert.equal(leaseTokenOf(stripped), null);
  assert.equal(stripped["PATH"], "/usr/bin");
  assert.equal(stripped["HOME"], "/root");
  // Which is also how an environment is filtered before it is reported, so
  // neither token reaches a log.
  const reported = JSON.stringify(stripped);
  assert.ok(!reported.includes(env[RUN_TOKEN_VAR] as string));
  assert.ok(!reported.includes(env[LEASE_TOKEN_VAR] as string));
});

test("T013 — the variable names are the ones the search for survivors looks for", () => {
  // The kernel's `findByRunToken` matches the VALUES of an environment, so it
  // needs no variable name; these names are what a process reads its OWN token
  // from, and what a test fixture of the process table carries.
  assert.equal(RUN_TOKEN_VAR, "SPECSTRIDE_RUN_TOKEN");
  assert.equal(LEASE_TOKEN_VAR, "SPECSTRIDE_LEASE_TOKEN");
});
