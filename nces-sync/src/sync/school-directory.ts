import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictConfig } from '../config/districts';
import type { EducationDataClient } from '../lib/education-data-client';
import type { Logger } from '../lib/logger';
import type { SchoolDirectoryRow, SyncResult } from '../lib/types';
import { upsertBatched } from '../lib/supabase-client';

export async function syncSchoolDirectory(
  api: EducationDataClient,
  db: SupabaseClient,
  district: DistrictConfig,
  year: number,
  logger: Logger
): Promise<SyncResult> {
  const dataset = 'school_directory';
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];

  try {
    const url = api.schoolDirectoryUrl(year, district.leaid);
    logger.info(`Syncing ${dataset}`, { leaid: district.leaid, year });
    const rows = await api.fetchAllPages<SchoolDirectoryRow>(url);

    const payloads = rows
      .filter((r) => r.ncessch)
      .map((r) => ({
        ncessch: String(r.ncessch),
        leaid: district.leaid,
        school_year: year,
        school_name: r.school_name ?? null,
        school_level: r.school_level ?? null,
        charter: r.charter ?? null,
        lowest_grade_offered: r.lowest_grade_offered ?? null,
        highest_grade_offered: r.highest_grade_offered ?? null,
        teachers_fte: r.teachers_fte ?? null,
        city_location: r.city_location ?? null,
        state_location: r.state_location ?? null,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        raw_data: r,
        last_synced: syncedAt,
      }));

    const upserted = payloads.length
      ? await upsertBatched(db, 'nces_school_directory', payloads, 'ncessch,school_year')
      : 0;

    if (!upserted) errors.push(`No school directory rows for ${district.leaid} year ${year}`);
    return { dataset, leaid: district.leaid, year, upserted, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed ${dataset}`, { leaid: district.leaid, year, error: message });
    errors.push(message);
    return { dataset, leaid: district.leaid, year, upserted: 0, errors };
  }
}
