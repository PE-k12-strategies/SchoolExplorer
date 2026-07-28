import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictConfig } from '../config/districts';
import type { EducationDataClient } from '../lib/education-data-client';
import type { Logger } from '../lib/logger';
import type { DistrictDirectoryRow, SyncResult } from '../lib/types';
import { upsertBatched } from '../lib/supabase-client';

export interface DistrictDirectorySyncResult extends SyncResult {
  directoryRow?: DistrictDirectoryRow;
}

export async function syncDistrictDirectory(
  api: EducationDataClient,
  db: SupabaseClient,
  district: DistrictConfig,
  year: number,
  logger: Logger
): Promise<DistrictDirectorySyncResult> {
  const dataset = 'district_directory';
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];

  try {
    const url = api.districtDirectoryUrl(year, district.leaid);
    logger.info(`Syncing ${dataset}`, { leaid: district.leaid, year });
    const rows = await api.fetchAllPages<DistrictDirectoryRow>(url);

    if (!rows.length) {
      errors.push(`No district directory rows for ${district.leaid} year ${year}`);
      return { dataset, leaid: district.leaid, year, upserted: 0, errors };
    }

    const record = rows[0];
    const payload = {
      leaid: district.leaid,
      school_year: year,
      lea_name: record.lea_name ?? district.districtName,
      state_leaid: record.state_leaid ?? null,
      fips: record.fips ?? null,
      city_location: record.city_location ?? null,
      state_location: record.state_location ?? null,
      county_name: record.county_name ?? null,
      phone: record.phone ?? null,
      number_of_schools: record.number_of_schools ?? null,
      enrollment: record.enrollment ?? null,
      teachers_total_fte: record.teachers_total_fte ?? null,
      staff_total_fte: record.staff_total_fte ?? null,
      raw_data: record,
      last_synced: syncedAt,
    };

    const upserted = await upsertBatched(db, 'nces_district_directory', [payload], 'leaid,school_year');
    return { dataset, leaid: district.leaid, year, upserted, errors, directoryRow: record };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed ${dataset}`, { leaid: district.leaid, year, error: message });
    errors.push(message);
    return { dataset, leaid: district.leaid, year, upserted: 0, errors };
  }
}
