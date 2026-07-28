import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictConfig } from '../config/districts';
import type { EducationDataClient } from '../lib/education-data-client';
import type { Logger } from '../lib/logger';
import type { FinanceRow, SyncResult } from '../lib/types';
import { upsertBatched } from '../lib/supabase-client';

export async function syncDistrictFinance(
  api: EducationDataClient,
  db: SupabaseClient,
  district: DistrictConfig,
  year: number,
  logger: Logger
): Promise<SyncResult> {
  const dataset = 'district_finance';
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];

  try {
    const url = api.districtFinanceUrl(year, district.leaid);
    logger.info(`Syncing ${dataset}`, { leaid: district.leaid, year });
    const rows = await api.fetchAllPages<FinanceRow>(url);

    const payloads = rows.map((r) => ({
      leaid: district.leaid,
      fiscal_year: year,
      rev_total: r.rev_total ?? null,
      exp_total: r.exp_total ?? null,
      enrollment_fall_school: r.enrollment_fall_school ?? null,
      salaries_total: r.salaries_total ?? null,
      raw_data: r,
      last_synced: syncedAt,
    }));

    const upserted = payloads.length
      ? await upsertBatched(db, 'nces_district_finance', payloads, 'leaid,fiscal_year')
      : 0;

    if (!upserted) errors.push(`No finance rows for ${district.leaid} fiscal year ${year}`);
    return { dataset, leaid: district.leaid, year, upserted, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed ${dataset}`, { leaid: district.leaid, year, error: message });
    errors.push(message);
    return { dataset, leaid: district.leaid, year, upserted: 0, errors };
  }
}
