import type { SupabaseClient } from '@supabase/supabase-js';
import { ENROLLMENT_GRADE_SLUGS, type DistrictConfig } from '../config/districts';
import type { EducationDataClient } from '../lib/education-data-client';
import type { Logger } from '../lib/logger';
import type { EnrollmentRow, SyncResult } from '../lib/types';
import { upsertBatched } from '../lib/supabase-client';

export async function syncSchoolEnrollment(
  api: EducationDataClient,
  db: SupabaseClient,
  district: DistrictConfig,
  year: number,
  logger: Logger
): Promise<SyncResult> {
  const dataset = 'school_enrollment';
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];
  let upserted = 0;

  for (const gradeSlug of ENROLLMENT_GRADE_SLUGS) {
    try {
      const url = api.schoolEnrollmentUrl(year, gradeSlug, district.leaid);
      logger.debug(`Fetching school enrollment`, { leaid: district.leaid, year, gradeSlug });
      const rows = await api.fetchAllPages<EnrollmentRow>(url);

      const payloads = rows
        .filter((r) => r.ncessch)
        .map((r) => ({
          ncessch: String(r.ncessch),
          leaid: district.leaid,
          school_year: year,
          grade: r.grade ?? 0,
          race: r.race ?? 99,
          sex: r.sex ?? 99,
          enrollment: r.enrollment ?? null,
          raw_data: r,
          last_synced: syncedAt,
        }));

      if (payloads.length) {
        upserted += await upsertBatched(
          db,
          'nces_school_enrollment',
          payloads,
          'ncessch,school_year,grade,race,sex'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`School enrollment grade skipped`, { gradeSlug, error: message });
      errors.push(`${gradeSlug}: ${message}`);
    }
  }

  logger.info(`Synced ${dataset}`, { leaid: district.leaid, year, upserted });
  return { dataset, leaid: district.leaid, year, upserted, errors };
}

export async function syncDistrictEnrollment(
  api: EducationDataClient,
  db: SupabaseClient,
  district: DistrictConfig,
  year: number,
  logger: Logger
): Promise<SyncResult> {
  const dataset = 'district_enrollment';
  const syncedAt = new Date().toISOString();
  const errors: string[] = [];
  let upserted = 0;

  for (const gradeSlug of ENROLLMENT_GRADE_SLUGS) {
    try {
      const url = api.districtEnrollmentUrl(year, gradeSlug, district.leaid);
      const rows = await api.fetchAllPages<EnrollmentRow>(url);

      const payloads = rows.map((r) => ({
        leaid: district.leaid,
        school_year: year,
        grade: r.grade ?? 0,
        race: r.race ?? 99,
        sex: r.sex ?? 99,
        enrollment: r.enrollment ?? null,
        raw_data: r,
        last_synced: syncedAt,
      }));

      if (payloads.length) {
        upserted += await upsertBatched(
          db,
          'nces_district_enrollment',
          payloads,
          'leaid,school_year,grade,race,sex'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`District enrollment grade skipped`, { gradeSlug, error: message });
      errors.push(`${gradeSlug}: ${message}`);
    }
  }

  logger.info(`Synced ${dataset}`, { leaid: district.leaid, year, upserted });
  return { dataset, leaid: district.leaid, year, upserted, errors };
}
