import type { SupabaseClient } from '@supabase/supabase-js';
import type { DistrictConfig } from '../config/districts';
import type { Logger } from '../lib/logger';
import type { DistrictDirectoryRow, SyncResult } from '../lib/types';
import { upsertBatched } from '../lib/supabase-client';

/**
 * CCD does not expose a separate district staff endpoint.
 * Staff FTE counts are included in the district directory record.
 */
export async function syncDistrictStaffFromDirectory(
  db: SupabaseClient,
  district: DistrictConfig,
  year: number,
  directoryRow: DistrictDirectoryRow,
  logger: Logger
): Promise<SyncResult> {
  const dataset = 'district_staff';
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];

  try {
    const payload = {
      leaid: district.leaid,
      school_year: year,
      teachers_total_fte: num(directoryRow.teachers_total_fte),
      teachers_prek_fte: num(directoryRow.teachers_prek_fte),
      teachers_kindergarten_fte: num(directoryRow.teachers_kindergarten_fte),
      teachers_elementary_fte: num(directoryRow.teachers_elementary_fte),
      teachers_secondary_fte: num(directoryRow.teachers_secondary_fte),
      instructional_aides_fte: num(directoryRow.instructional_aides_fte),
      guidance_counselors_total_fte: num(directoryRow.guidance_counselors_total_fte),
      school_administrators_fte: num(directoryRow.school_administrators_fte),
      lea_administrators_fte: num(directoryRow.lea_administrators_fte),
      staff_total_fte: num(directoryRow.staff_total_fte),
      raw_data: directoryRow,
      last_synced: syncedAt,
    };

    const upserted = await upsertBatched(db, 'nces_district_staff', [payload], 'leaid,school_year');
    logger.info(`Synced ${dataset}`, { leaid: district.leaid, year, upserted });
    return { dataset, leaid: district.leaid, year, upserted, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Failed ${dataset}`, { leaid: district.leaid, year, error: message });
    errors.push(message);
    return { dataset, leaid: district.leaid, year, upserted: 0, errors };
  }
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
