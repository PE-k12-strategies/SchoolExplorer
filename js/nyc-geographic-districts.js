/**
 * NYC Geographic District boundaries (NCES LEAs under supervisory union 3620580).
 *
 * Census TIGER/EDGE only publish a single NYC DOE polygon (3620580). The ~32
 * "New York City Geographic District #N" LEAs exist in CCD enrollment data but
 * have no TIGER school-district shapes. Official NYC DCP school-district
 * polygons (Open Data) align with geographic districts 1–32.
 *
 * Source: https://data.cityofnewyork.us/City-Government/School-Districts/8ugf-3d8u
 */
(function (global) {
  const NYC_DOE_LEAID = '3620580';
  const OPEN_DATA_URL =
    'https://data.cityofnewyork.us/api/geospatial/8ugf-3d8u?method=export&format=GeoJSON';
  const LS_KEY = 'nces_nyc_geo_districts_v1';

  // NCES LEAID for NYC Geographic District #N (CCD / Urban Institute).
  // District 75 (special schools) has no contiguous DCP polygon.
  const DISTRICT_TO_LEAID = {
    1: '3600076',
    2: '3600077',
    3: '3600078',
    4: '3600079',
    5: '3600081',
    6: '3600083',
    7: '3600084',
    8: '3600085',
    9: '3600086',
    10: '3600087',
    11: '3600088',
    12: '3600090',
    13: '3600091',
    14: '3600119',
    15: '3600092',
    16: '3600094',
    17: '3600095',
    18: '3600096',
    19: '3600120',
    20: '3600151',
    21: '3600152',
    22: '3600153',
    23: '3600121',
    24: '3600098',
    25: '3600122',
    26: '3600099',
    27: '3600123',
    28: '3600100',
    29: '3600101',
    30: '3600102',
    31: '3600103',
    32: '3600097',
  };

  let memoryFc = null;
  let loadPromise = null;

  function loadLs() {
    try {
      const raw = global.localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const fc = JSON.parse(raw);
      return fc && Array.isArray(fc.features) ? fc : null;
    } catch (_) {
      return null;
    }
  }

  function saveLs(fc) {
    try {
      global.localStorage.setItem(LS_KEY, JSON.stringify(fc));
    } catch (_) { /* quota — in-memory still works */ }
  }

  function toFeature(distNum, geometry) {
    const leaid = DISTRICT_TO_LEAID[distNum];
    if (!leaid || !geometry) return null;
    return {
      type: 'Feature',
      properties: {
        GEOID: leaid,
        BASENAME: `New York City Geographic District # ${distNum}`,
        NAME: `New York City Geographic District # ${distNum}`,
        leaid,
        district_name: `New York City Geographic District # ${distNum}`,
        nyc_school_dist: distNum,
        tiger_layer: 'nyc_open_data',
      },
      geometry,
    };
  }

  function mergeGeometries(geoms) {
    const polys = [];
    geoms.forEach((g) => {
      if (!g) return;
      if (g.type === 'Polygon') polys.push(g.coordinates);
      else if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
    });
    if (!polys.length) return null;
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    return { type: 'MultiPolygon', coordinates: polys };
  }

  function openDataToFc(raw) {
    const byDist = {};
    (raw.features || []).forEach((f) => {
      const n = Number(f.properties && (f.properties.schooldist || f.properties.SchoolDist));
      if (!Number.isFinite(n) || !DISTRICT_TO_LEAID[n]) return;
      if (!byDist[n]) byDist[n] = [];
      byDist[n].push(f.geometry);
    });
    const features = Object.keys(byDist)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => toFeature(n, mergeGeometries(byDist[n])))
      .filter(Boolean);
    return { type: 'FeatureCollection', features };
  }

  async function fetchGeographicDistricts() {
    if (memoryFc) return memoryFc;
    const cached = loadLs();
    if (cached && cached.features.length) {
      memoryFc = cached;
      return memoryFc;
    }
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const r = await fetch(OPEN_DATA_URL, {
        headers: { Accept: 'application/json' },
      });
      if (!r.ok) throw new Error('NYC Open Data HTTP ' + r.status);
      const raw = await r.json();
      const fc = openDataToFc(raw);
      memoryFc = fc;
      if (fc.features.length) saveLs(fc);
      return fc;
    })().finally(() => { loadPromise = null; });
    return loadPromise;
  }

  /**
   * Replace the single NYC DOE TIGER polygon with geographic district polygons.
   * Leaves all other NY district features unchanged.
   */
  async function enrichNyBoundaryFc(tigerFc) {
    const base = tigerFc && tigerFc.features ? tigerFc.features : [];
    const withoutDoe = base.filter((f) => {
      const gid = f.properties && (f.properties.GEOID || f.properties.leaid);
      return String(gid) !== NYC_DOE_LEAID;
    });
    try {
      const geo = await fetchGeographicDistricts();
      return {
        type: 'FeatureCollection',
        features: withoutDoe.concat(geo.features || []),
      };
    } catch (_) {
      return { type: 'FeatureCollection', features: base };
    }
  }

  global.NYC_GEO_DISTRICTS = {
    NYC_DOE_LEAID,
    DISTRICT_TO_LEAID,
    fetchGeographicDistricts,
    enrichNyBoundaryFc,
  };
})(typeof window !== 'undefined' ? window : globalThis);
