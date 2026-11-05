/**
 * Whether an address is loopback (F109-FR-018): the loopback addresses of
 * the host, by name or by number. The seam refuses a plain, unencrypted
 * endpoint unless its address is one of these.
 */
export const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "::1", "[::1]"] as const;

/** True for a hostname or literal address that is loopback. */
export function isLoopbackAddress(hostname: string): boolean {
  const name = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    (LOOPBACK_NAMES as readonly string[]).includes(name) ||
    name.startsWith("127.") ||
    name === "::ffff:127.0.0.1"
  );
}
