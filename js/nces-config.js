// NCES dashboard — reads only from Supabase (never calls Education Data API)

window.NCES_CONFIG = {
  tables: {
    districts: 'nces_sync_districts',
    districtDirectory: 'nces_district_directory',
    schoolDirectory: 'nces_school_directory',
    schoolEnrollment: 'nces_school_enrollment',
    districtEnrollment: 'nces_district_enrollment',
    districtFinance: 'nces_district_finance',
    districtStaff: 'nces_district_staff',
    articulationAreas: 'nces_articulation_areas',
    schoolArticulationMap: 'nces_school_articulation_map',
    districtRegions: 'nces_district_regions',
    syncLog: 'nces_sync_log',
  },
  /** Districts that expose a Region filter (local planning layer above articulation). */
  districtsWithRegions: ['2400480'],
  defaultLeaid: '0804800',
  defaultState: 'CO',
  /** Baseline / “to” year for snapshots and change comparisons (latest CCD year in sync-config). */
  defaultSchoolYear: 2024,
  /** Years offered in the year filter (unioned with whatever each district has synced). */
  schoolYears: [2015, 2020, 2021, 2022, 2023, 2024],
  map: {
    /** Set via js/nces-config.local.js (gitignored). See nces-config.local.js.example. */
    token: '',
    style: 'mapbox://styles/mapbox/light-v11',
    center: [-98.5, 39.5],
    zoom: 3.4,
  },
  usStates: [
    'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY',
    'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH',
    'OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR',
  ],
  stateNames: {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
    CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
    TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
  },
  gradeLabels: {
    '-1': 'Pre-K',
    0: 'Kindergarten',
    1: 'Grade 1',
    2: 'Grade 2',
    3: 'Grade 3',
    4: 'Grade 4',
    5: 'Grade 5',
    6: 'Grade 6',
    7: 'Grade 7',
    8: 'Grade 8',
    9: 'Grade 9',
    10: 'Grade 10',
    11: 'Grade 11',
    12: 'Grade 12',
    99: 'Total / Ungraded',
  },
};

window.ncesStateLabel = function (code) {
  const name = window.NCES_CONFIG.stateNames[code];
  return name ? `${name} (${code})` : code;
};

window.ncesGradeLabel = function (grade) {
  const key = String(grade);
  return window.NCES_CONFIG.gradeLabels[key] ?? `Grade ${grade}`;
};

window.formatCurrency = function (value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
};
