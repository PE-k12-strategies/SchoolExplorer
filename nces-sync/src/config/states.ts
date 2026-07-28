/** US state/territory codes → NCES FIPS (integer used by Education Data API) */
export const STATE_FIPS: Record<string, number> = {
  AL: 1, AK: 2, AZ: 4, AR: 5, CA: 6, CO: 8, CT: 9, DE: 10, DC: 11, FL: 12,
  GA: 13, HI: 15, ID: 16, IL: 17, IN: 18, IA: 19, KS: 20, KY: 21, LA: 22,
  ME: 23, MD: 24, MA: 25, MI: 26, MN: 27, MS: 28, MO: 29, MT: 30, NE: 31,
  NV: 32, NH: 33, NJ: 34, NM: 35, NY: 36, NC: 37, ND: 38, OH: 39, OK: 40,
  OR: 41, PA: 42, RI: 44, SC: 45, SD: 46, TN: 47, TX: 48, UT: 49, VT: 50,
  VA: 51, WA: 53, WV: 54, WI: 55, WY: 56, PR: 72,
};

export const ALL_STATE_CODES = Object.keys(STATE_FIPS).sort();

export function stateToFips(stateCode: string): number {
  const fips = STATE_FIPS[stateCode.toUpperCase()];
  if (!fips) throw new Error(`Unknown state code: ${stateCode}`);
  return fips;
}

export function leaidToStateCode(leaid: string): string | null {
  if (!leaid || leaid.length < 2) return null;
  const fips = parseInt(leaid.slice(0, 2), 10);
  const entry = Object.entries(STATE_FIPS).find(([, v]) => v === fips);
  return entry ? entry[0] : null;
}
