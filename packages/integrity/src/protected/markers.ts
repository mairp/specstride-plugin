// T039 (F116-FR-011; IR-39) — the count of suppression markers per file, from
// the versioned pattern set of the toolchain profile. A count of tests is NOT
// shown in Wave 1: the only counts here are the marker counts.
export const NO_TEST_COUNTS = true as const;

export interface MarkerCount {
  path: string;
  added: number;
  removed: number;
}

function occurrences(content: string, pattern: string): number {
  const re = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  return (content.match(re) ?? []).length;
}

/** Markers added and removed since phase entry, per file, per pattern set. */
export function countMarkersPerFile(
  before: Record<string, string>,
  after: Record<string, string>,
  markerPatterns: string[],
): MarkerCount[] {
  const counts: MarkerCount[] = [];
  for (const path of Object.keys(after).sort()) {
    if (!(path in before)) continue; // a new file is a class B fact, not a marker count
    let added = 0;
    let removed = 0;
    for (const pattern of markerPatterns) {
      const was = occurrences(before[path], pattern);
      const now = occurrences(after[path], pattern);
      if (now > was) added += now - was;
      else if (was > now) removed += was - now;
    }
    if (added > 0 || removed > 0) counts.push({ path, added, removed });
  }
  return counts;
}
