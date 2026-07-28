import type { SupabaseClient } from '@supabase/supabase-js';
import { SYNC_CONFIG } from '../config/sync-config';
import { EducationDataClient } from '../lib/education-data-client';
import type { Logger } from '../lib/logger';
import type { DistrictDirectoryRow, SyncResult } from '../lib/types';
import {
  discoverDistrictsForStates,
  loadDistrictsFromDb,
  resolveStateList,
  type DistrictRecord,
} from './discover-districts';
import { syncDistrictDirectory } from './district-directory';
import { syncDistrictEnrollment, syncSchoolEnrollment } from './enrollment';
import { syncDistrictFinance } from './finance';
import { syncSchoolDirectory } from './school-directory';
import { syncDistrictStaffFromDirectory } from './staff';

export interface RunSyncOptions {
  leaid?: string;
  stateCodes?: string[];
  discoverOnly?: boolean;
  skipDiscover?: boolean;
  resume?: boolean;
  force?: boolean;
  /** Only districts missing years from SYNC_CONFIG.schoolYears. */
  incompleteOnly?: boolean;
  skipIfSyncedWithinDays?: number;
  verbose?: boolean;
  logger: Logger;
  supabase: SupabaseClient;
}

export interface RunSyncSummary {
  results: SyncResult[];
  totalUpserted: number;
  hadErrors: boolean;
  districtsProcessed: number;
  districtsSkipped: number;
}

async function logSyncStart(db: SupabaseClient, leaid: string, dataset: string, year?: number) {
  const { data } = await db
    .from('nces_sync_log')
    .insert({ leaid, dataset, school_year: year ?? null, status: 'started' })
    .select('id')
    .single();
  return data?.id as number | undefined;
}

async function logSyncFinish(
  db: SupabaseClient,
  logId: number | undefined,
  status: 'success' | 'error',
  records: number,
  errorMessage?: string
) {
  if (!logId) return;
  await db
    .from('nces_sync_log')
    .update({
      status,
      records_upserted: records,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', logId);
}

async function runDataset(
  db: SupabaseClient,
  leaid: string,
  dataset: string,
  year: number | undefined,
  fn: () => Promise<SyncResult>
): Promise<SyncResult> {
  const logId = await logSyncStart(db, leaid, dataset, year);
  const result = await fn();
  const status = result.errors.length ? 'error' : 'success';
  await logSyncFinish(
    db,
    logId,
    status,
    result.upserted,
    result.errors.length ? result.errors.join('; ') : undefined
  );
  return result;
}

function toDistrictConfig(record: DistrictRecord) {
  return {
    leaid: record.leaid,
    districtName: record.districtName,
    stateCode: record.stateCode,
    enabled: record.enabled,
    syncSchoolYears: record.syncSchoolYears,
    syncFinanceYears: record.syncFinanceYears,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncOneDistrict(
  api: EducationDataClient,
  db: SupabaseClient,
  district: DistrictRecord,
  logger: Logger
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const config = toDistrictConfig(district);

  for (const year of district.syncSchoolYears) {
    let directoryRow: DistrictDirectoryRow | undefined;
    const dirResult = await runDataset(db, district.leaid, 'district_directory', year, async () => {
      const result = await syncDistrictDirectory(api, db, config, year, logger);
      directoryRow = result.directoryRow;
      return result;
    });
    results.push(dirResult);

    if (directoryRow) {
      results.push(
        await runDataset(db, district.leaid, 'district_staff', year, () =>
          syncDistrictStaffFromDirectory(db, config, year, directoryRow!, logger)
        )
      );
    }

    results.push(
      await runDataset(db, district.leaid, 'school_directory', year, () =>
        syncSchoolDirectory(api, db, config, year, logger)
      )
    );

    results.push(
      await runDataset(db, district.leaid, 'school_enrollment', year, () =>
        syncSchoolEnrollment(api, db, config, year, logger)
      )
    );

    results.push(
      await runDataset(db, district.leaid, 'district_enrollment', year, () =>
        syncDistrictEnrollment(api, db, config, year, logger)
      )
    );
  }

  for (const year of district.syncFinanceYears) {
    results.push(
      await runDataset(db, district.leaid, 'district_finance', year, () =>
        syncDistrictFinance(api, db, config, year, logger)
      )
    );
  }

  await db
    .from('nces_sync_districts')
    .update({
      last_synced: new Date().toISOString(),
      // Persist the expanded year list so the dashboard filter shows new years.
      sync_school_years: district.syncSchoolYears,
      sync_finance_years: district.syncFinanceYears,
    })
    .eq('leaid', district.leaid);

  return results;
}

function statesToSync(options: RunSyncOptions): string[] {
  if (options.leaid) return [];
  if (options.stateCodes?.length) return resolveStateList(options.stateCodes);
  return resolveStateList(SYNC_CONFIG.states);
}

function resolveSkipRecentDays(options: RunSyncOptions): number | undefined {
  if (options.force) return undefined;
  if (options.incompleteOnly) return undefined;
  if (options.resume) return undefined;
  if (options.skipIfSyncedWithinDays !== undefined) return options.skipIfSyncedWithinDays;
  return SYNC_CONFIG.skipIfSyncedWithinDays;
}

export async function runSync(options: RunSyncOptions): Promise<RunSyncSummary> {
  const api = new EducationDataClient({ logger: options.logger });
  const results: SyncResult[] = [];
  let districtsProcessed = 0;
  let districtsSkipped = 0;

  if (!options.skipDiscover && !options.leaid) {
    const toDiscover = options.stateCodes?.length ? options.stateCodes : SYNC_CONFIG.states;
    await discoverDistrictsForStates(
      api,
      options.supabase,
      toDiscover,
      SYNC_CONFIG.discoveryYear,
      options.logger
    );
  }

  if (options.discoverOnly) {
    return { results: [], totalUpserted: 0, hadErrors: false, districtsProcessed: 0, districtsSkipped: 0 };
  }

  const syncStates = statesToSync(options);
  const stateBatches: string[][] = options.leaid
    ? [[]]
    : syncStates.length
      ? syncStates.map((s) => [s])
      : [[]];

  let globalIndex = 0;
  let totalDistricts = 0;

  const skipRecentDays = resolveSkipRecentDays(options);

  if (!options.leaid) {
    for (const batch of stateBatches) {
      const allInState = await loadDistrictsFromDb(options.supabase, {
        stateCodes: batch.length ? batch : undefined,
      });
      const pending = await loadDistrictsFromDb(options.supabase, {
        stateCodes: batch.length ? batch : undefined,
        resume: options.resume,
        skipIfSyncedWithinDays: skipRecentDays,
        incompleteOnly: options.incompleteOnly,
      });
      districtsSkipped += allInState.length - pending.length;
      totalDistricts += pending.length;
    }
  } else {
    totalDistricts = (await loadDistrictsFromDb(options.supabase, {
      leaid: options.leaid,
      resume: options.resume,
      skipIfSyncedWithinDays: skipRecentDays,
      incompleteOnly: options.incompleteOnly,
    })).length;
    if (totalDistricts === 0) districtsSkipped = 1;
  }

  options.logger.info('Nationwide sync plan', {
    states: syncStates.length || 1,
    districtsToProcess: options.leaid ? totalDistricts : totalDistricts,
    districtsSkipped,
    schoolYears: SYNC_CONFIG.schoolYears,
    resume: options.resume ?? false,
    skipIfSyncedWithinDays: skipRecentDays ?? null,
    force: options.force ?? false,
    incompleteOnly: options.incompleteOnly ?? false,
  });

  for (const batch of stateBatches) {
    const districts = options.leaid
      ? await loadDistrictsFromDb(options.supabase, {
          leaid: options.leaid,
          resume: options.resume,
          skipIfSyncedWithinDays: skipRecentDays,
          incompleteOnly: options.incompleteOnly,
        })
      : await loadDistrictsFromDb(options.supabase, {
          stateCodes: batch.length ? batch : undefined,
          resume: options.resume,
          skipIfSyncedWithinDays: skipRecentDays,
          incompleteOnly: options.incompleteOnly,
        });

    if (!districts.length) {
      if (options.leaid) {
        const reason = options.resume
          ? `District ${options.leaid} already synced (use without --resume for 30-day skip, or --force to re-sync)`
          : skipRecentDays
            ? `District ${options.leaid} synced within the last ${skipRecentDays} days (use --force to re-sync)`
            : `District ${options.leaid} not found or disabled`;
        options.logger.info(reason);
        return { results: [], totalUpserted: 0, hadErrors: false, districtsProcessed: 0, districtsSkipped };
      }
      continue;
    }

    if (batch[0]) {
      options.logger.info(`Processing state ${batch[0]}`, { districts: districts.length });
    }

    for (const district of districts) {
      globalIndex++;
      options.logger.info(`District ${globalIndex}/${totalDistricts || districts.length}`, {
        leaid: district.leaid,
        name: district.districtName,
        state: district.stateCode,
      });

      const districtResults = await syncOneDistrict(api, options.supabase, district, options.logger);
      results.push(...districtResults);
      districtsProcessed++;

      if (SYNC_CONFIG.delayBetweenDistrictsMs > 0) {
        await sleep(SYNC_CONFIG.delayBetweenDistrictsMs);
      }
    }
  }

  if (!districtsProcessed && !options.leaid) {
    if (districtsSkipped > 0) {
      const reason = options.resume
        ? 'All districts already synced (use without --resume to apply 30-day skip, or --force to re-sync all)'
        : skipRecentDays
          ? `All districts synced within the last ${skipRecentDays} days (use --force to re-sync)`
          : 'All districts already synced';
      options.logger.info(reason);
    } else {
      throw new Error(
        'No districts to sync. Run: npm run sync -- --discover-only --state ALL'
      );
    }
  }

  const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0);
  const hadErrors = results.some((r) => r.errors.length > 0);

  return { results, totalUpserted, hadErrors, districtsProcessed, districtsSkipped };
}
