import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNC_CONFIG } from '../config/sync-config';
import { ALL_STATE_CODES, leaidToStateCode, stateToFips } from '../config/states';
import type { EducationDataClient } from '../lib/education-data-client';
import type { Logger } from '../lib/logger';
import type { DistrictDirectoryRow } from '../lib/types';
import { upsertBatched } from '../lib/supabase-client';

export interface DiscoverResult {
  stateCode: string;
  discovered: number;
  upserted: number;
}

function resolveStateList(states: string[]): string[] {
  if (states.length === 1 && states[0].toUpperCase() === 'ALL') {
    return ALL_STATE_CODES;
  }
  return states.map((s) => s.toUpperCase());
}

export { resolveStateList };

export async function discoverDistrictsForStates(
  api: EducationDataClient,
  db: SupabaseClient,
  states: string[],
  year: number,
  logger: Logger
): Promise<DiscoverResult[]> {
  const results: DiscoverResult[] = [];
  const stateList = resolveStateList(states);

  for (const stateCode of stateList) {
    const fips = stateToFips(stateCode);
    const url = api.districtDirectoryByStateUrl(year, fips);
    logger.info('Discovering districts', { stateCode, year, fips });

    const rows = await api.fetchAllPages<DistrictDirectoryRow>(url);
    const leaids = rows.filter((r) => r.leaid).map((r) => String(r.leaid));
    // Preserve sync_school_years on re-discover. Stamping SYNC_CONFIG.schoolYears
    // here made --incomplete-only never see unfinished districts (discover runs
    // before the incomplete filter and marked every LEA as year-complete).
    const existingYears = new Map<string, { school: number[]; finance: number[] }>();
    for (let i = 0; i < leaids.length; i += 500) {
      const chunk = leaids.slice(i, i + 500);
      const { data, error } = await db
        .from('nces_sync_districts')
        .select('leaid, sync_school_years, sync_finance_years')
        .in('leaid', chunk);
      if (error) throw new Error(`Failed to load existing districts: ${error.message}`);
      for (const row of data || []) {
        existingYears.set(String(row.leaid), {
          school: (row.sync_school_years || []).map(Number).filter((y: number) => Number.isFinite(y)),
          finance: (row.sync_finance_years || []).map(Number).filter((y: number) => Number.isFinite(y)),
        });
      }
    }

    const payloads = rows
      .filter((r) => r.leaid)
      .map((r) => {
        const leaid = String(r.leaid);
        const prior = existingYears.get(leaid);
        return {
          leaid,
          district_name: r.lea_name ?? `District ${r.leaid}`,
          state_code: stateCode,
          fips,
          enabled: true,
          // New LEAs start empty until runSync finishes and writes real years.
          sync_school_years: prior?.school ?? [],
          sync_finance_years: prior?.finance ?? [],
          notes: `Auto-discovered from CCD directory ${year}`,
        };
      });

    const upserted = payloads.length
      ? await upsertBatched(db, 'nces_sync_districts', payloads, 'leaid')
      : 0;

    logger.info('District discovery complete', { stateCode, discovered: rows.length, upserted });
    results.push({ stateCode, discovered: rows.length, upserted });
  }

  return results;
}

function schoolYearsCoverConfig(stored: number[]): boolean {
  const have = new Set(stored.map(Number));
  return SYNC_CONFIG.schoolYears.every((y) => have.has(y));
}

export async function loadDistrictsFromDb(
  db: SupabaseClient,
  options: {
    leaid?: string;
    stateCodes?: string[];
    resume?: boolean;
    skipIfSyncedWithinDays?: number;
    /** Only districts whose stored sync_school_years are missing configured years. */
    incompleteOnly?: boolean;
  }
): Promise<DistrictRecord[]> {
  type Loaded = DistrictRecord & { lastSynced: string | null; storedSchoolYears: number[] };
  const loaded: Loaded[] = [];
  let from = 0;
  const pageSize = 1000;

  let recentCutoffMs: number | null = null;
  if (options.skipIfSyncedWithinDays != null && options.skipIfSyncedWithinDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.skipIfSyncedWithinDays);
    recentCutoffMs = cutoff.getTime();
  }

  while (true) {
    let query = db
      .from('nces_sync_districts')
      .select('leaid, district_name, state_code, sync_school_years, sync_finance_years, enabled, last_synced')
      .eq('enabled', true)
      .order('state_code')
      .order('district_name');

    if (options.leaid) query = query.eq('leaid', options.leaid);
    // Resume stays SQL-side; year-incomplete + 30-day skip are filtered in JS below
    // so incomplete districts are never skipped just because last_synced is recent.
    if (options.resume) {
      query = query.is('last_synced', null);
    }
    if (options.stateCodes?.length === 1) {
      query = query.eq('state_code', options.stateCodes[0].toUpperCase());
    } else if (options.stateCodes && options.stateCodes.length > 1) {
      query = query.in(
        'state_code',
        options.stateCodes.map((s) => s.toUpperCase())
      );
    }

    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load districts: ${error.message}`);
    if (!data?.length) break;

    loaded.push(
      ...data.map((row) => {
        // Union stored years with current SYNC_CONFIG so adding years to
        // sync-config.ts picks them up without rediscovering every district.
        const storedSchool = (row.sync_school_years?.length ? row.sync_school_years : [])
          .map(Number)
          .filter((y: number) => Number.isFinite(y));
        const storedFinance = row.sync_finance_years?.length ? row.sync_finance_years : [];
        const schoolYears = [...new Set([...storedSchool, ...SYNC_CONFIG.schoolYears])]
          .map(Number)
          .filter((y: number) => Number.isFinite(y))
          .sort((a, b) => a - b);
        const financeYears = [...new Set([...storedFinance, ...SYNC_CONFIG.financeYears])]
          .map(Number)
          .filter((y: number) => Number.isFinite(y))
          .sort((a, b) => a - b);
        return {
          leaid: row.leaid,
          districtName: row.district_name,
          stateCode: row.state_code ?? leaidToStateCode(row.leaid) ?? '??',
          enabled: row.enabled,
          syncSchoolYears: schoolYears.length ? schoolYears : SYNC_CONFIG.schoolYears,
          syncFinanceYears: financeYears.length ? financeYears : SYNC_CONFIG.financeYears,
          lastSynced: row.last_synced ?? null,
          storedSchoolYears: storedSchool,
        };
      })
    );

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const filtered = loaded.filter((row) => {
    const yearsOk = schoolYearsCoverConfig(row.storedSchoolYears);
    if (options.incompleteOnly) return !yearsOk;
    if (options.resume) return true;
    if (recentCutoffMs == null) return true;
    // Always re-queue year-incomplete districts, even if synced recently.
    if (!yearsOk) return true;
    if (!row.lastSynced) return true;
    return Date.parse(row.lastSynced) < recentCutoffMs;
  });

  return filtered.map(({ lastSynced: _ls, storedSchoolYears: _sy, ...row }) => row);
}

export interface DistrictRecord {
  leaid: string;
  districtName: string;
  stateCode: string;
  enabled: boolean;
  syncSchoolYears: number[];
  syncFinanceYears: number[];
}
