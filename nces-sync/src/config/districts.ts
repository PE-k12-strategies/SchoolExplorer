/**
 * @deprecated Use SYNC_CONFIG in sync-config.ts and nces_sync_districts table instead.
 * Jeffco default LEA ID: 0804800
 */
export interface DistrictConfig {
  leaid: string;
  districtName: string;
  stateCode: string;
  enabled: boolean;
  syncSchoolYears: number[];
  syncFinanceYears: number[];
  notes?: string;
}

/** Grade URL slugs for CCD enrollment (pk/kg/ungraded often return API 500) */
export const ENROLLMENT_GRADE_SLUGS = [
  'grade-1',
  'grade-2',
  'grade-3',
  'grade-4',
  'grade-5',
  'grade-6',
  'grade-7',
  'grade-8',
  'grade-9',
  'grade-10',
  'grade-11',
  'grade-12',
] as const;

export const API_BASE_URL = 'https://educationdata.urban.org/api/v1';
