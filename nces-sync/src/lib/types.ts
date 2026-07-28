export interface ApiPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface SyncResult {
  dataset: string;
  leaid: string;
  year?: number;
  upserted: number;
  errors: string[];
}

export interface DistrictDirectoryRow {
  year: number;
  leaid: string;
  lea_name?: string;
  state_leaid?: string;
  fips?: number;
  city_location?: string;
  state_location?: string;
  county_name?: string;
  phone?: string;
  number_of_schools?: number;
  enrollment?: number;
  teachers_total_fte?: number;
  staff_total_fte?: number;
  [key: string]: unknown;
}

export interface SchoolDirectoryRow {
  year: number;
  ncessch: string;
  school_name?: string;
  leaid?: string;
  school_level?: number;
  charter?: number;
  lowest_grade_offered?: number;
  highest_grade_offered?: number;
  teachers_fte?: number;
  city_location?: string;
  state_location?: string;
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
}

export interface EnrollmentRow {
  year: number;
  ncessch?: string;
  leaid?: string;
  grade?: number;
  race?: number;
  sex?: number;
  enrollment?: number;
  [key: string]: unknown;
}

export interface FinanceRow {
  year: number;
  leaid: string;
  rev_total?: number;
  exp_total?: number;
  enrollment_fall_school?: number;
  salaries_total?: number;
  [key: string]: unknown;
}
