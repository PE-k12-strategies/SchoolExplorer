/**
 * NCES map module (Mapbox GL JS).
 * Renders three layers from Supabase RPCs: States, Districts, Schools.
 * Driven by the dashboard filters (state / district / year).
 */
(function (global) {
  const CFG = (global.NCES_CONFIG && global.NCES_CONFIG.map) || {};

  // Approximate state centroids (lng, lat) for the States layer + fit bounds.
  const STATE_CENTROIDS = {
    AL: [-86.83, 32.8], AK: [-152.0, 63.6], AZ: [-111.66, 34.29], AR: [-92.44, 34.9],
    CA: [-119.68, 37.18], CO: [-105.55, 38.998], CT: [-72.76, 41.6], DE: [-75.51, 39.0],
    DC: [-77.02, 38.9], FL: [-81.69, 28.63], GA: [-83.44, 32.64], HI: [-155.5, 19.9],
    ID: [-114.48, 44.24], IL: [-89.2, 40.06], IN: [-86.28, 39.89], IA: [-93.5, 42.07],
    KS: [-98.38, 38.5], KY: [-84.86, 37.65], LA: [-91.87, 31.05], ME: [-69.24, 45.37],
    MD: [-76.8, 39.06], MA: [-71.53, 42.23], MI: [-84.71, 44.35], MN: [-94.31, 46.28],
    MS: [-89.67, 32.74], MO: [-92.46, 38.36], MT: [-109.65, 46.92], NE: [-99.79, 41.53],
    NV: [-116.66, 39.33], NH: [-71.58, 43.69], NJ: [-74.52, 40.19], NM: [-106.11, 34.41],
    NY: [-75.53, 42.95], NC: [-79.36, 35.56], ND: [-100.47, 47.45], OH: [-82.79, 40.29],
    OK: [-97.51, 35.57], OR: [-120.56, 43.94], PA: [-77.6, 40.88], RI: [-71.51, 41.68],
    SC: [-80.9, 33.86], SD: [-100.23, 44.44], TN: [-86.35, 35.86], TX: [-99.34, 31.48],
    UT: [-111.67, 39.32], VT: [-72.71, 44.07], VA: [-78.66, 37.52], WA: [-120.45, 47.38],
    WV: [-80.61, 38.64], WI: [-89.99, 44.62], WY: [-107.55, 42.99], PR: [-66.5, 18.2],
  };

  // State code -> 2-digit FIPS (for filtering Census district boundaries by GEOID prefix).
  const STATE_FIPS = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
    DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
    KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
    MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
    NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
    SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
    WV: '54', WI: '55', WY: '56', PR: '72',
  };

  // School type palette — avoid red / yellow / green / blue (reserved for
  // enrollment sequential + change diverging legends).
  const LEVEL_COLORS = {
    1: '#6d28d9', // Elementary — violet
    2: '#db2777', // Middle — pink
    3: '#c2410c', // High — burnt orange
    4: '#57534e', // Other / Combined — stone
  };
  const LEVEL_LABELS = { 1: 'Elementary', 2: 'Middle', 3: 'High', 4: 'Other / Combined' };

  // Discrete change % bins (schools + district/state choropleth).
  // Yellow band is −2% to +2%; then 2–5, 5–10, and >10 both ways.
  const CHANGE_PCT_SCALE = {
    noData: '#94a3b8',
    bins: [
      { key: 'lt-10', label: 'More than 10% decline', title: 'More than 10% decline', color: '#a50026' },
      { key: '-10--5', label: '−10 to −5%', title: 'Decrease 5–10%', color: '#f46d43' },
      { key: '-5--2', label: '−5 to −2%', title: 'Decrease 2–5%', color: '#fdae61' },
      { key: '-2-2', label: '−2 to 2%', title: 'Little change (−2% to +2%)', color: '#ffffbf' },
      { key: '2-5', label: '2 to 5%', title: 'Increase 2–5%', color: '#a6d96a' },
      { key: '5-10', label: '5 to 10%', title: 'Increase 5–10%', color: '#1a9850' },
      { key: 'gt-10', label: 'More than 10% growth', title: 'More than 10% growth', color: '#006837' },
    ],
  };
  // Back-compat alias used by the UI legend.
  const SCHOOL_CHANGE_SCALE = CHANGE_PCT_SCALE;

  // School markers are circles for every level; color encodes school type.
  const SCHOOL_CIRCLE_ICON = 'school-circle';
  const SCHOOL_SHAPES = {
    1: { icon: SCHOOL_CIRCLE_ICON, shape: 'circle' },
    2: { icon: SCHOOL_CIRCLE_ICON, shape: 'circle' },
    3: { icon: SCHOOL_CIRCLE_ICON, shape: 'circle' },
    4: { icon: SCHOOL_CIRCLE_ICON, shape: 'circle' },
  };

  function schoolLevelColorExpr() {
    return [
      'match', ['coalesce', ['get', 'school_level'], 4],
      1, LEVEL_COLORS[1],
      2, LEVEL_COLORS[2],
      3, LEVEL_COLORS[3],
      4, LEVEL_COLORS[4],
      LEVEL_COLORS[4],
    ];
  }

  const DISTRICT_COLORS = [
    '#60a5fa', '#34d399', '#fbbf24', '#f87171',
    '#a78bfa', '#22d3ee', '#fb923c', '#f472b6',
  ];

  function districtColor(leaid) {
    const id = String(leaid || '');
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = ((hash * 31) + id.charCodeAt(i)) >>> 0;
    return DISTRICT_COLORS[hash % DISTRICT_COLORS.length];
  }

  function padLeaid(id) {
    const s = String(id == null ? '' : id).trim();
    if (!s) return '';
    const digits = s.replace(/\D/g, '');
    if (!digits) return s.length >= 7 ? s : s.padStart(7, '0');
    return digits.length >= 7 ? digits.slice(-7) : digits.padStart(7, '0');
  }

  /** All lookup keys that might appear for the same LEA across Census / NCES / JSON. */
  function leaKeys(id) {
    const raw = String(id == null ? '' : id).trim();
    if (!raw) return [];
    const digits = raw.replace(/\D/g, '');
    const padded = padLeaid(raw);
    const keys = new Set([raw, digits, padded]);
    if (digits) {
      keys.add(digits.padStart(7, '0'));
      if (digits.length > 7) keys.add(digits.slice(-7));
      // Number() drops leading zeros — still index for unpadded RPC values.
      const n = String(Number(digits));
      if (n && n !== 'NaN') keys.add(n);
    }
    return [...keys].filter(Boolean);
  }

  function districtHasMetricData(fc) {
    return !!((fc && fc.features) || []).some((f) => {
      const p = f.properties || {};
      return (Number(p.enrollment) || 0) > 0
        || (Number(p.teachers_fte) || 0) > 0
        || (Number(p.staff_fte) || 0) > 0;
    });
  }

  /** Merge RPC district metrics onto boundary features (mutates + returns fc). */
  function mergeDistrictMetrics(fc, rows) {
    if (!fc || !fc.features) return fc || emptyFc();
    const byLea = Object.create(null);
    (rows || []).forEach((r) => {
      leaKeys(r && r.leaid).forEach((k) => { byLea[k] = r; });
    });
    let matched = 0;
    fc.features.forEach((f) => {
      if (!f.properties) f.properties = {};
      const keys = leaKeys(f.properties.leaid || f.properties.GEOID || f.properties.geoid);
      if (!keys.length) return;
      const id = padLeaid(keys[0]);
      f.properties.leaid = id || keys[0];
      f.properties.GEOID = f.properties.GEOID || f.properties.leaid;
      f.properties.district_color = f.properties.district_color || districtColor(f.properties.leaid);
      let r = null;
      for (let i = 0; i < keys.length; i++) {
        if (byLea[keys[i]]) { r = byLea[keys[i]]; break; }
      }
      if (!r) return;
      matched += 1;
      const enrollment = Number(r.enrollment) || 0;
      const teachers = r.teachers_fte != null ? Number(r.teachers_fte) : 0;
      const staff = r.staff_fte != null ? Number(r.staff_fte) : 0;
      f.properties.enrollment = enrollment;
      f.properties.teachers_fte = teachers;
      f.properties.staff_fte = staff;
      f.properties.stu_teacher = stuTeacher(enrollment, teachers) || 0;
      f.properties.schools = r.schools != null ? Number(r.schools) || 0 : f.properties.schools;
      if (r.district_name) f.properties.district_name = r.district_name;
      if (r.lowest_grade != null || r.highest_grade != null) {
        f.properties.grades = gradeRange(r.lowest_grade, r.highest_grade);
      }
    });
    fc._metricMatched = matched;
    fc._metricTotal = fc.features.length;
    return fc;
  }

  /**
   * Re-apply cached change props (From→To) onto a FeatureCollection.
   * District polygons are rebuilt whenever a state loads, which drops the props
   * merged by ensureChangeMetrics — without this, Color by Change goes flat.
   */
  function applyChangePropsToFc(fc) {
    if (!fc || !fc.features || !fc.features.length) return 0;
    const keys = Object.keys(changeByLeaid || {});
    if (!keys.length) return 0;
    let matched = 0;
    fc.features.forEach((f) => {
      if (!f.properties) f.properties = {};
      const ids = leaKeys(f.properties.leaid || f.properties.GEOID);
      let ch = null;
      for (let i = 0; i < ids.length; i++) {
        if (changeByLeaid[ids[i]]) { ch = changeByLeaid[ids[i]]; break; }
      }
      if (ch) {
        Object.assign(f.properties, ch);
        matched += 1;
      } else {
        clearChangeProps(f.properties);
      }
    });
    return matched;
  }

  /** Re-apply metrics + change props onto the visible polygons and repaint. */
  function syncDistrictMetricsToMap() {
    if (!map || !lastDistrictFc.features.length) return false;
    const rows = lastData.districts || [];
    if (rows.length) mergeDistrictMetrics(lastDistrictFc, rows);
    const changeMatched = applyChangePropsToFc(lastDistrictFc);
    if (!rows.length && !changeMatched) return false;
    setDistrictsSourceData(lastDistrictFc);
    applyMetricPaint();
    return (lastDistrictFc._metricMatched || 0) > 0 || changeMatched > 0;
  }

  // Choropleth metrics for district fills (panel "Color by").
  const COLOR_METRICS = {
    enrollment: {
      prop: 'enrollment',
      label: 'Enrollment',
      stops: [0, '#fee5d9', 2000, '#fcae91', 10000, '#fb6a4a', 30000, '#de2d26', 80000, '#a50f15'],
      // States hold millions of students — district stops (max 80k) made every
      // state max out at the darkest red. Spread breaks across the state range.
      stateStops: [
        50000, '#fee5d9',
        200000, '#fcbba1',
        500000, '#fc9272',
        900000, '#fb6a4a',
        1500000, '#ef3b2c',
        2500000, '#cb181d',
        4500000, '#99000d',
      ],
    },
    teachers: {
      prop: 'teachers_fte',
      label: 'Teachers (FTE)',
      stops: [0, '#eff6ff', 50, '#bfdbfe', 200, '#60a5fa', 600, '#2563eb', 1500, '#1e3a8a'],
      stateStops: [
        3000, '#eff6ff',
        15000, '#c6dbef',
        40000, '#9ecae1',
        80000, '#6baed6',
        150000, '#3182bd',
        300000, '#08519c',
      ],
    },
    staff: {
      prop: 'staff_fte',
      label: 'Staff (FTE)',
      stops: [0, '#f0fdf4', 80, '#bbf7d0', 300, '#4ade80', 900, '#16a34a', 2500, '#14532d'],
      stateStops: [
        5000, '#f0fdf4',
        30000, '#c7e9c0',
        80000, '#a1d99b',
        160000, '#74c476',
        300000, '#31a354',
        600000, '#006d2c',
      ],
    },
    ratio: {
      prop: 'stu_teacher',
      label: 'Students / teacher',
      // Higher ratio = more crowded = worse (green → yellow → red).
      // Per-student ratio is the same scale for states and districts.
      stops: [0, '#166534', 10, '#a6d96a', 15, '#ffffbf', 20, '#fdae61', 30, '#a50026'],
    },
    // Diverging change uses discrete % brackets (see CHANGE_PCT_SCALE / fillExpr).
    change: {
      prop: 'enrollment_delta',
      label: 'Change',
      stops: [], // unused — pct step expression
    },
  };

  const CHANGE_FIELDS = {
    enrollment: {
      delta: 'enrollment_delta', from: 'enrollment_from', to: 'enrollment_to', pct: 'enrollment_pct',
      label: 'Enrollment',
    },
    teachers: {
      delta: 'teachers_delta', from: 'teachers_from', to: 'teachers_to', pct: 'teachers_pct',
      label: 'Teachers (FTE)',
    },
    staff: {
      delta: 'staff_delta', from: 'staff_from', to: 'staff_to', pct: 'staff_pct',
      label: 'Staff (FTE)',
    },
    ratio: {
      delta: 'ratio_delta', from: 'ratio_from', to: 'ratio_to', pct: 'ratio_pct',
      label: 'Stud / teacher',
      // Higher students/teacher is worse: ↓ ratio = green (better), ↑ = red (worse).
      worseWhenUp: true,
    },
  };

  function isChangeMetric(metricKey) {
    return metricKey === 'change';
  }

  function changeFieldMeta() {
    return CHANGE_FIELDS[changeField] || CHANGE_FIELDS.enrollment;
  }

  /** Nested Color-by / Change fetches — keep the host loading bar up until all finish. */
  let metricLoadDepth = 0;
  function setMetricLoad(state) {
    if (typeof opts.onMetricLoad !== 'function') return;
    const active = !!(state && state.active);
    if (active) {
      metricLoadDepth += 1;
      try { opts.onMetricLoad(state); } catch (_) { /* ignore */ }
      return;
    }
    metricLoadDepth = Math.max(0, metricLoadDepth - 1);
    if (metricLoadDepth === 0) {
      try { opts.onMetricLoad({ active: false }); } catch (_) { /* ignore */ }
    }
  }

  /** Step colors for % change (optionally inverted for ratio). */
  function changePctColors(invert) {
    const colors = CHANGE_PCT_SCALE.bins.map((b) => b.color);
    return invert ? colors.slice().reverse() : colors;
  }

  function changePctFillExpr(pctProp, invert) {
    const c = changePctColors(!!invert);
    const v = ['to-number', ['coalesce', ['get', pctProp], 0]];
    return [
      'case',
      ['!', ['all',
        ['has', pctProp],
        ['!=', ['get', pctProp], null],
      ]],
      CHANGE_PCT_SCALE.noData,
      ['<', v, -10], c[0],
      ['<', v, -5], c[1],
      ['<', v, -2], c[2],
      ['<=', v, 2], c[3],
      ['<=', v, 5], c[4],
      ['<=', v, 10], c[5],
      c[6],
    ];
  }

  function fillExpr(metricKey, scope) {
    if (isChangeMetric(metricKey)) {
      const meta = changeFieldMeta();
      return changePctFillExpr(meta.pct || 'enrollment_pct', !!meta.worseWhenUp);
    }
    const m = COLOR_METRICS[metricKey] || COLOR_METRICS.enrollment;
    // States span millions; districts thousands. Use a state-scaled ramp when
    // painting the state choropleth so states aren't all the same dark color.
    const stops = (scope === 'states' && m.stateStops) ? m.stateStops : m.stops;
    // to-number: GeoJSON / ArcGIS sometimes leave numeric props as strings, which
    // makes interpolate treat every feature the same.
    // Repeat the value expression (don't reuse one array node) for Mapbox.
    const valueExpr = () => ['to-number', ['coalesce', ['get', m.prop], 0]];
    return [
      'case',
      ['<=', valueExpr(), 0],
      '#e2e8f0',
      ['interpolate', ['linear'], valueExpr(), ...stops],
    ];
  }

  function metricFilterExpr(metricKey) {
    if (isChangeMetric(metricKey)) {
      const meta = changeFieldMeta();
      // Keep features that have data for this metric in either comparison year.
      return ['>', ['max',
        ['coalesce', ['get', meta.from], 0],
        ['coalesce', ['get', meta.to], 0],
      ], 0];
    }
    const prop = (COLOR_METRICS[metricKey] || COLOR_METRICS.enrollment).prop;
    return ['>', ['coalesce', ['get', prop], 0], 0];
  }

  let map = null;
  let ready = false;
  let initPromise = null;
  let client = null;
  let opts = {};
  // Left detail panel elements (resolved during init).
  let detailPanel = null;
  let detailTitle = null;
  let detailBody = null;
  let detailReopen = null;
  let detailDropdown = null;
  const visibility = { states: true, districts: false, schools: false };
  // null | 'enrollment' | 'teachers' | 'staff' | 'ratio' | 'change'
  let colorMetric = 'enrollment';
  // When colorMetric === 'change': which value to compare across years.
  let changeField = 'enrollment'; // 'enrollment' | 'teachers' | 'staff' | 'ratio'
  // Baseline (“to”) = latest configured year; “from” = earlier compare year.
  // Overridden by From/To UI and by the dashboard year filter when 2+ years selected.
  const _cfgYears = (global.NCES_CONFIG && global.NCES_CONFIG.schoolYears) || [2021, 2024];
  const _baseline = Number(global.NCES_CONFIG && global.NCES_CONFIG.defaultSchoolYear)
    || Math.max(..._cfgYears.map(Number));
  let changeYears = {
    from: _cfgYears.map(Number).includes(2021) ? 2021 : Math.min(..._cfgYears.map(Number).filter((y) => y < _baseline).concat([_baseline - 1])),
    to: _baseline,
  };
  let changeKey = null; // cache key when loaded
  let changeLoading = false;
  let changeByLeaid = {}; // leaid(string) → change props (Details lookup independent of mesh)
  let activeRegionCode = null; // planning region filter (e.g. MCPS 1–6)
  let activeRegionLeaid = null;
  let regionEditActive = false;
  let regionEditFocus = null; // null = all, or region code number
  let regionEditDrag = null; // { regionCode, vi, part }
  let regionLayersVisible = false;
  let hsAreasVisible = false;
  let hsAssignMode = false;
  let selectedHsName = null;
  let lastChangeNote = null; // status tip / error for the change layer
  let lastChangeMatched = 0;  // districts whose change props matched the polygons
  let schoolChangeById = {}; // ncessch -> change props
  let schoolChangeKey = null;
  // 'both' | 'complete' | 'partial' | 'none' — filter states by data completeness.
  let stateFilterMode = 'both';
  // Per-state sync stats: { CO: { total, synced }, ... } from nces_state_completeness().
  let stateCompleteness = {};
  let completenessLoaded = false;
  let completenessLoading = false;
  let lastData = { states: [], districts: [], schools: [] };
  let lastDistrictFc = { type: 'FeatureCollection', features: [] };
  let allStatesFc = { type: 'FeatureCollection', features: [] };
  let allDistrictsFc = { type: 'FeatureCollection', features: [] };
  let stateSummaryByCode = {};
  const selectedDistricts = new Set();
  // Last school click — refreshed when From/To years change while detail is open.
  let lastSchoolDetail = null; // { props, lngLat }
  const selectedStates = new Set();
  let lastRenderedState = null;
  let lastFilters = {};

  // Active school levels (1=Elem, 2=Middle, 3=High, 4=Other/Combined).
  const schoolLevels = new Set([1, 2, 3, 4]);
  // School marker encoding when From≠To: 'type' = fill by level;
  // 'change' / 'enrollment' = metric fill, optional type ring (schoolTypeRing).
  let schoolMarkerMode = 'type'; // 'type' | 'change' | 'enrollment'
  let schoolTypeRing = false; // rim by school level when fill is change/enrollment
  // Enrollment min/max filters per layer (null = unbounded).
  const sizeRange = {
    states: [null, null],
    districts: [null, null],
    schools: [null, null],
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function gradeLabel(v) {
    if (v == null) return '—';
    if (v === -1) return 'PK';
    if (v === 0) return 'K';
    return String(v);
  }

  function gradeRange(low, high) {
    if (low == null && high == null) return '—';
    return `${gradeLabel(low)}–${gradeLabel(high)}`;
  }

  function num(n) {
    return (Number(n) || 0).toLocaleString();
  }

  // Compact enrollment label, e.g. 1.2M / 45k / 900.
  function compactNum(n) {
    const v = Number(n) || 0;
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(v);
  }

  function setClient(c) {
    client = c;
  }

  function isReady() {
    // Recover when layers exist but the ready flag was never set (init threw
    // after addLayers, or a Mapbox error rejected the promise).
    if (!ready && map && typeof map.getLayer === 'function' && map.getLayer('schools-dots')) {
      ready = true;
    }
    return ready;
  }

  function emptyFc() {
    return { type: 'FeatureCollection', features: [] };
  }

  /**
   * Push state polygons to the map. Always pass a new FeatureCollection object —
   * Mapbox often ignores setData() when given the same object reference after
   * in-place property edits (Color-by then paints as if every metric were 0).
   */
  function setStateOutlineData(fc) {
    if (!map || !map.getSource('state-outline')) return;
    const features = (fc && fc.features) || [];
    map.getSource('state-outline').setData({
      type: 'FeatureCollection',
      features,
    });
  }

  /**
   * Canvas → Mapbox SDF glyph. Alpha encodes signed distance from the edge
   * (cutoff 192) so icon-color / icon-halo can recolor the fixed school shapes.
   */
  function makeSdfShape(kind, size) {
    const s = size || 64;
    const data = new Uint8ClampedArray(s * s * 4);
    const cx = (s - 1) / 2;
    const cy = (s - 1) / 2;
    // Generous padding — Mapbox clips icon-halo to the square texture; a large
    // circle leaves a visible square rim. Keep the glyph small in the canvas.
    const r = s * 0.22;
    const spread = 10;
    const cutoff = 192;

    function insideAt(x, y) {
      const dx = x - cx;
      const dy = y - cy;
      if (kind === 'circle') return dx * dx + dy * dy <= r * r;
      if (kind === 'square') {
        const half = r * 0.72;
        return Math.abs(dx) <= half && Math.abs(dy) <= half;
      }
      if (kind === 'triangle') {
        // Barycentric test for upward triangle.
        const x1 = cx;
        const y1 = cy - r * 1.05;
        const x2 = cx + r * 0.98;
        const y2 = cy + r * 0.78;
        const x3 = cx - r * 0.98;
        const y3 = cy + r * 0.78;
        const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        if (!d) return false;
        const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
        const b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
        const c = 1 - a - b;
        return a >= 0 && b >= 0 && c >= 0;
      }
      // Diamond (rhombus).
      return Math.abs(dx) + Math.abs(dy) <= r;
    }

    const mask = new Uint8Array(s * s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        mask[y * s + x] = insideAt(x, y) ? 1 : 0;
      }
    }

    const search = Math.ceil(spread) + 1;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const isIn = mask[y * s + x];
        let minD = Infinity;
        for (let dy = -search; dy <= search; dy++) {
          for (let dx = -search; dx <= search; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= s || ny >= s) {
              if (isIn) minD = Math.min(minD, Math.hypot(dx, dy));
              continue;
            }
            if (mask[ny * s + nx] !== isIn) {
              minD = Math.min(minD, Math.hypot(dx, dy));
            }
          }
        }
        if (minD === Infinity) minD = spread;
        const signed = isIn ? minD : -minD;
        const a = Math.max(0, Math.min(255, Math.round(
          cutoff + (signed / spread) * (255 - cutoff)
        )));
        const i = (y * s + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = a;
      }
    }
    return { width: s, height: s, data };
  }

  // 64px art at ratio 3 ≈ 21 CSS px before icon-size scaling.
  const SCHOOL_ICON_PIXEL_RATIO = 3;

  function ensureSchoolIcons() {
    if (!map) return;
    // All levels share one SDF circle; fill/ring color carries school type.
    if (map.hasImage(SCHOOL_CIRCLE_ICON)) {
      try { map.removeImage(SCHOOL_CIRCLE_ICON); } catch (_) { /* ignore */ }
    }
    map.addImage(SCHOOL_CIRCLE_ICON, makeSdfShape('circle'), {
      sdf: true,
      pixelRatio: SCHOOL_ICON_PIXEL_RATIO,
    });
  }

  /**
   * Icon size always tracks enrollment (× zoom). Selected school is larger.
   * Values are multipliers on the ~21 CSS-px glyph.
   */
  function schoolIconSizeExpr(factor) {
    const f = Number(factor) > 0 ? Number(factor) : 1;
    const id = selectedSchoolId();
    const byEnroll = (lo, hi) => {
      const expr = [
        'interpolate', ['linear'],
        ['sqrt', ['max', ['coalesce', ['get', 'enrollment'], 0], 0]],
        0, lo * f,
        20, (lo + hi) * 0.55 * f,
        50, hi * f,
      ];
      if (!id) return expr;
      return [
        'case',
        ['==', ['to-string', ['get', 'ncessch']], id],
        ['*', expr, 1.45],
        expr,
      ];
    };
    return [
      'interpolate', ['linear'], ['zoom'],
      3, byEnroll(0.22, 0.55),
      6, byEnroll(0.32, 0.85),
      9, byEnroll(0.45, 1.15),
      12, byEnroll(0.65, 1.55),
      15, byEnroll(0.85, 2.05),
    ];
  }

  /**
   * Single state that drives district Color-by / fills.
   * Prefer live UI scope, then last render filters, then one map pick.
   */
  function colorScopeState() {
    if (typeof opts.getColorScope === 'function') {
      const live = opts.getColorScope();
      // Empty string from the cascade means nationwide — do not fall back to a
      // stale lastFilters.state from the previous drill-in.
      if (live === '' || live == null) return null;
      return live;
    }
    if (lastFilters && lastFilters.state) return lastFilters.state;
    if (selectedStates.size === 1) return [...selectedStates][0];
    return null;
  }

  /**
   * Color-by paints the active boundary layer only (states XOR districts).
   * Schools are independent and never take choropleth fills.
   */
  function colorFillTargets() {
    if (!colorMetric) return { states: false, districts: false };
    if (visibility.districts && !visibility.states) return { states: false, districts: true };
    if (visibility.states && !visibility.districts) return { states: true, districts: false };
    return { states: false, districts: false };
  }

  /** After Color-by / map selection changes, load district metrics for the active state. */
  function refreshColorScope() {
    applyVisibility();
    if (!visibility.districts) return;
    const st = colorScopeState();
    if (!st) {
      // Nationwide districts: color the coarse mesh from the all-states metrics.
      ensureNationwideMetrics().catch(() => {});
      if (isChangeMetric(colorMetric) && changeYears.from !== changeYears.to) {
        ensureChangeMetrics();
      }
      return;
    }
    const fips = STATE_FIPS[st];
    const polygonsReady =
      lastDistrictFc.features.length
      && fips
      && lastDistrictFc.features.every((f) =>
        String((f.properties && (f.properties.leaid || f.properties.GEOID)) || '').slice(0, 2) === fips
      );
    if (!polygonsReady) {
      ensureStateDistrictMetrics(st).catch(() => {});
    } else {
      // Re-attach enrollment + cached change props after polygon rebuilds.
      syncDistrictMetricsToMap();
    }
    if (isChangeMetric(colorMetric) && changeYears.from !== changeYears.to) {
      ensureChangeMetrics();
    }
  }

  function notifyLayerVisibility() {
    if (typeof opts.onLayerVisibility !== 'function') return;
    try {
      opts.onLayerVisibility({
        schools: !!visibility.schools,
        states: !!visibility.states,
        districts: !!visibility.districts,
      });
    } catch (_) { /* ignore */ }
  }

  function ensureInit(containerId, options = {}) {
    if (initPromise) return initPromise;
    // Already have a live map from a prior half-failed init — mark ready and continue.
    if (map && map.getLayer && map.getLayer('schools-dots')) {
      ready = true;
      opts = Object.assign(opts || {}, options || {});
      return Promise.resolve(map);
    }
    opts = options;
    initPromise = new Promise((resolve, reject) => {
      if (!global.mapboxgl) {
        reject(new Error('Mapbox GL failed to load.'));
        return;
      }
      const token = (global.NCES_CONFIG && global.NCES_CONFIG.map && global.NCES_CONFIG.map.token) || CFG.token;
      if (!token) {
        reject(new Error(
          'Missing Mapbox token. Copy js/nces-config.local.js.example to js/nces-config.local.js and set map.token.'
        ));
        return;
      }
      global.mapboxgl.accessToken = token;
      let settled = false;
      let initWatchdog = null;
      let stylePulse = null;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        if (initWatchdog) clearTimeout(initWatchdog);
        if (stylePulse) clearInterval(stylePulse);
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        if (initWatchdog) clearTimeout(initWatchdog);
        if (stylePulse) clearInterval(stylePulse);
        ready = true;
        reportProgress(40, 'Map engine ready');
        resolve(map);
        loadNationwideBoundaries().catch(() => {});
        map.on('zoomend', scheduleDetailedBoundaryRefresh);
        map.on('moveend', scheduleDetailedBoundaryRefresh);
      };

      try {
        reportProgress(6, 'Creating map…');
        map = new global.mapboxgl.Map({
          container: containerId,
          style: CFG.style || 'mapbox://styles/mapbox/light-v11',
          center: CFG.center || [-98.5, 39.5],
          zoom: CFG.zoom || 3.4,
        });
      } catch (err) {
        fail(err);
        return;
      }
      reportProgress(8, 'Downloading basemap…');
      // Zoom control bottom-right so it never collides with the left detail panel.
      try {
        map.addControl(new global.mapboxgl.NavigationControl(), 'bottom-right');
      } catch (_) { /* ignore */ }
      // Distance scale (click to toggle mi / km).
      try {
        map.addControl(new global.mapboxgl.ScaleControl({
          maxWidth: 120,
          unit: 'imperial',
        }), 'bottom-left');
      } catch (_) { /* ignore */ }
      // Wire detail panel DOM only — do NOT resize/setPadding until style 'load'.
      // Calling map.resize/setPadding before the style loads can hang Mapbox at 0–4%.
      try { setupDetailPanel({ deferResize: true }); } catch (_) { /* ignore */ }

      // Creep 8% → ~34% while Mapbox style/tiles download so the bar isn't frozen.
      let styleTick = 0;
      const styleLabels = [
        'Downloading basemap…',
        'Loading map tiles…',
        'Preparing map style…',
        'Almost ready…',
      ];
      stylePulse = setInterval(() => {
        if (settled) {
          clearInterval(stylePulse);
          return;
        }
        styleTick += 1;
        const pct = Math.min(34, 8 + styleTick * 2);
        reportProgress(pct, styleLabels[Math.min(styleTick, styleLabels.length) - 1] || styleLabels[0]);
      }, 450);
      try {
        map.on('styledata', () => {
          if (!settled) reportProgress(18, 'Basemap style received…');
        });
        map.on('sourcedata', (e) => {
          if (settled || !e || e.sourceDataType !== 'metadata') return;
          reportProgress(24, 'Loading map sources…');
        });
      } catch (_) { /* ignore */ }

      // Hard stop so the UI never stays on "Starting map… 4%" forever.
      initWatchdog = setTimeout(() => {
        if (settled) return;
        clearInterval(stylePulse);
        console.warn('Map style load timed out — forcing ready');
        try {
          if (map && !map.getLayer('schools-dots')) {
            reportProgress(36, 'Building map layers…');
            addLayers();
          }
          ready = true;
          try { wireDetailResize(); } catch (_) { /* ignore */ }
          succeed();
        } catch (err) {
          fail(err);
        }
      }, 15000);

      map.on('load', () => {
        clearTimeout(initWatchdog);
        clearInterval(stylePulse);
        try {
          reportProgress(36, 'Building map layers…');
          addLayers();
          reportProgress(38, 'Wiring map controls…');
          // Mark ready as soon as layers exist so render/school loads are not blocked
          // if wiring/visibility throws below.
          ready = true;
        } catch (err) {
          console.error('Map addLayers failed', err);
          fail(err);
          return;
        }
        try { wireDetailResize(); } catch (err) {
          console.warn('Map detail resize wire failed', err);
        }
        try { wireInteractions(); } catch (err) {
          console.warn('Map wireInteractions failed', err);
        }
        try { clearLegacyBoundaryCaches(); } catch (_) { /* ignore */ }
        try { applyVisibility(); } catch (err) {
          console.warn('Map applyVisibility failed', err);
        }
        succeed();
      });
      map.on('error', (e) => {
        // Mapbox emits many non-fatal style/tile errors. Only fail init if the
        // style never loaded and we have no layers yet.
        const msg = (e && e.error && e.error.message) || (e && e.message) || '';
        console.warn('Mapbox error', msg || e);
        if (settled || ready) return;
        if (map && map.getLayer && map.getLayer('schools-dots')) {
          clearTimeout(initWatchdog);
          ready = true;
          succeed();
          return;
        }
        // Ignore noisy sprite/glyph/tile errors during startup.
        if (/sprite|glyph|tile|image|404|Failed to fetch/i.test(String(msg))) return;
      });
    }).catch((err) => {
      // Allow a later retry after a failed init — but keep the map if layers exist.
      if (map && map.getLayer && map.getLayer('schools-dots')) {
        ready = true;
        // Recover: treat as success so showMap continues to render/schools.
        return map;
      }
      initPromise = null;
      ready = false;
      throw err;
    });
    return initPromise;
  }

  function addLayers() {
    try { ensureSchoolIcons(); } catch (err) {
      console.warn('School SDF icons unavailable', err);
    }
    // Satellite fades in under labels as you zoom (Zillow-style) — before data layers.
    try { ensureAutoSatelliteLayer(); } catch (err) {
      console.warn('Auto satellite layer failed', err);
    }
    const ensureSource = (id) => {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: emptyFc() });
    };
    const addIfMissing = (layer) => {
      if (map.getLayer(layer.id)) return;
      try {
        map.addLayer(layer);
      } catch (err) {
        console.error('Layer failed:', layer.id, err);
      }
    };

    ensureSource('state-outline');
    ensureSource('districts-all');
    ensureSource('districts');
    ensureSource('district-label-points');
    ensureSource('states');
    ensureSource('district-regions');
    ensureSource('hs-areas');
    ensureSource('schools');
    ensureSource('region-edit-verts');
    ensureSource('region-edit-mids');

    // State-level choropleth (only states that have loaded data). Sits at the
    // very bottom so district/school layers always render on top.
    addIfMissing({
      id: 'states-choropleth-fill',
      type: 'fill',
      source: 'state-outline',
      layout: { visibility: 'none' },
      filter: ['>', ['coalesce', ['get', 'enrollment'], 0], 0],
      paint: { 'fill-color': fillExpr('enrollment', 'states'), 'fill-opacity': 0.6 },
    });

    addIfMissing({
      id: 'districts-all-fill',
      type: 'fill',
      source: 'districts-all',
      layout: { visibility: 'none' },
      filter: ['>', ['coalesce', ['get', 'enrollment'], 0], 0],
      paint: { 'fill-color': fillExpr('enrollment'), 'fill-opacity': 0.6 },
    });
    addIfMissing({
      id: 'districts-all-line',
      type: 'line',
      source: 'districts-all',
      paint: { 'line-color': '#cbd5e1', 'line-width': 0.6, 'line-opacity': 0.9 },
    });
    addIfMissing({
      id: 'districts-all-hit',
      type: 'fill',
      source: 'districts-all',
      paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
    });
    addIfMissing({
      id: 'districts-all-multi-line',
      type: 'line',
      source: 'districts-all',
      filter: ['in', ['get', 'leaid'], ['literal', []]],
      paint: { 'line-color': '#1d4ed8', 'line-width': 2.5, 'line-opacity': 1 },
    });

    addIfMissing({
      id: 'state-fill-hit',
      type: 'fill',
      source: 'state-outline',
      paint: { 'fill-color': '#000000', 'fill-opacity': 0 },
    });
    addIfMissing({
      id: 'state-outline-line',
      type: 'line',
      source: 'state-outline',
      paint: { 'line-color': '#0f4c81', 'line-width': 1, 'line-opacity': 0.7 },
    });
    addIfMissing({
      id: 'state-outline-selected',
      type: 'line',
      source: 'state-outline',
      filter: ['==', ['get', 'stusab'], '__none__'],
      paint: { 'line-color': '#0f4c81', 'line-width': 2.4, 'line-opacity': 0.95 },
    });
    addIfMissing({
      id: 'states-multi-fill',
      type: 'fill',
      source: 'state-outline',
      filter: ['in', ['get', 'stusab'], ['literal', []]],
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.18 },
    });
    addIfMissing({
      id: 'states-multi-line',
      type: 'line',
      source: 'state-outline',
      filter: ['in', ['get', 'stusab'], ['literal', []]],
      paint: { 'line-color': '#1d4ed8', 'line-width': 3, 'line-opacity': 1 },
    });

    addIfMissing({
      id: 'districts-fill',
      type: 'fill',
      source: 'districts',
      layout: { visibility: 'none' },
      paint: { 'fill-color': fillExpr('enrollment'), 'fill-opacity': 0.6 },
    });
    addIfMissing({
      id: 'districts-hit',
      type: 'fill',
      source: 'districts',
      paint: { 'fill-color': '#000000', 'fill-opacity': 0.01 },
    });
    addIfMissing({
      id: 'districts-line',
      type: 'line',
      source: 'districts',
      paint: { 'line-color': '#b45309', 'line-width': 1.5, 'line-opacity': 0.85 },
    });
    addIfMissing({
      id: 'districts-multi-fill',
      type: 'fill',
      source: 'districts',
      filter: ['in', ['get', 'leaid'], ['literal', []]],
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.28 },
    });
    addIfMissing({
      id: 'districts-multi-line',
      type: 'line',
      source: 'districts',
      filter: ['in', ['get', 'leaid'], ['literal', []]],
      paint: { 'line-color': '#1d4ed8', 'line-width': 3, 'line-opacity': 1 },
    });
    addIfMissing({
      id: 'districts-line-selected',
      type: 'line',
      source: 'districts',
      filter: ['==', ['get', 'leaid'], '__none__'],
      paint: { 'line-color': '#7c2d12', 'line-width': 3.5, 'line-opacity': 1 },
    });
    // District names: one label point per LEA (avoids MultiPolygon island spam).
    if (map.getLayer('districts-labels')) {
      try {
        const existing = map.getLayer('districts-labels');
        if (existing && existing.source !== 'district-label-points') {
          map.removeLayer('districts-labels');
        }
      } catch (_) { /* ignore */ }
    }
    addIfMissing({
      id: 'districts-labels',
      type: 'symbol',
      source: 'district-label-points',
      layout: {
        visibility: 'none',
        'text-field': ['coalesce', ['get', 'district_name'], ['get', 'NAME'], ''],
        'text-size': 10,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-max-width': 14,
        'text-padding': 8,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-optional': true,
        'symbol-sort-key': ['coalesce', ['get', 'label_min_zoom'], 99],
      },
      paint: {
        'text-color': '#1c1917',
        'text-halo-color': 'rgba(255,255,255,0.92)',
        'text-halo-width': 1.5,
      },
    });

    addIfMissing({
      id: 'states-labels',
      type: 'symbol',
      source: 'states',
      layout: {
        'text-field': [
          'format',
          ['get', 'state_code'], { 'font-scale': 1.1 },
          '\n', {},
          ['to-string', ['get', 'enroll_label']], { 'font-scale': 0.8 },
        ],
        'text-size': 12,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#0b3a63',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    });

    addIfMissing({
      id: 'district-regions-fill',
      type: 'fill',
      source: 'district-regions',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#94a3b8'],
        'fill-opacity': 0.28,
      },
    });
    addIfMissing({
      id: 'district-regions-line',
      type: 'line',
      source: 'district-regions',
      layout: { visibility: 'none' },
      paint: {
        'line-color': '#334155',
        'line-width': 1.5,
        'line-opacity': 0.9,
      },
    });
    addIfMissing({
      id: 'district-regions-label',
      type: 'symbol',
      source: 'district-regions',
      layout: {
        visibility: 'none',
        'text-field': ['get', 'region_name'],
        'text-size': 13,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#1e293b',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    });

    // Individual HS attendance areas (assignable to program regions).
    addIfMissing({
      id: 'hs-areas-fill',
      type: 'fill',
      source: 'hs-areas',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['coalesce', ['get', 'color'], '#94a3b8'],
        'fill-opacity': [
          'case',
          ['==', ['get', 'selected'], 1],
          0.58,
          0.34,
        ],
      },
    });
    addIfMissing({
      id: 'hs-areas-line',
      type: 'line',
      source: 'hs-areas',
      layout: { visibility: 'none' },
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'selected'], 1],
          '#ea580c',
          '#0f172a',
        ],
        'line-width': [
          'case',
          ['==', ['get', 'selected'], 1],
          3,
          1.2,
        ],
        'line-opacity': 0.95,
      },
    });
    addIfMissing({
      id: 'hs-areas-label',
      type: 'symbol',
      source: 'hs-areas',
      layout: {
        visibility: 'none',
        'text-field': [
          'format',
          ['get', 'label'], {},
          '\n', {},
          ['get', 'region_name'], { 'font-scale': 0.85 },
        ],
        'text-size': 11,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    });

    addIfMissing({
      id: 'region-edit-mids',
      type: 'circle',
      source: 'region-edit-mids',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 5,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#ea580c',
        'circle-stroke-width': 1.5,
        'circle-opacity': 0.95,
      },
    });
    addIfMissing({
      id: 'region-edit-verts',
      type: 'circle',
      source: 'region-edit-verts',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 7,
        'circle-color': '#ea580c',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    });

    // School markers — shape icons always (level = shape). Color/size applied in paint.
    addIfMissing({
      id: 'schools-dots',
      type: 'circle',
      source: 'schools',
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': 8,
        'circle-color': '#000000',
        'circle-opacity': 0,
        'circle-stroke-width': 0,
      },
    });
    // Larger circle behind the fill = circular school-type rim (avoids square SDF halos).
    addIfMissing({
      id: 'schools-rings',
      type: 'symbol',
      source: 'schools',
      layout: {
        visibility: 'none',
        'icon-image': SCHOOL_CIRCLE_ICON,
        'icon-size': schoolIconSizeExpr(1.38),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': schoolLevelColorExpr(),
        'icon-opacity': 0.95,
        'icon-halo-width': 0,
      },
    });
    addIfMissing({
      id: 'schools-circles',
      type: 'symbol',
      source: 'schools',
      layout: {
        visibility: 'none',
        'icon-image': SCHOOL_CIRCLE_ICON,
        'icon-size': schoolIconSizeExpr(),
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': schoolLevelColorExpr(),
        'icon-opacity': 0.95,
        // No icon-halo — Mapbox clips halos to the square texture bounds.
        'icon-halo-width': 0,
      },
    });
    // School names — neighborhood zoom and closer; hide if they collide.
    addIfMissing({
      id: 'schools-labels',
      type: 'symbol',
      source: 'schools',
      minzoom: SCHOOL_LABEL_MIN_ZOOM,
      layout: {
        visibility: 'none',
        'text-field': ['coalesce', ['get', 'school_name'], ''],
        'text-size': 10,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-offset': [0, 1.15],
        'text-anchor': 'top',
        'text-max-width': 12,
        'text-padding': 2,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-optional': true,
        'symbol-sort-key': ['*', -1, ['coalesce', ['to-number', ['get', 'enrollment']], 0]],
      },
      paint: {
        'text-color': '#1c1917',
        'text-halo-color': 'rgba(255,255,255,0.92)',
        'text-halo-width': 1.4,
        'text-opacity': 0.95,
      },
    });
    if (map.getLayer('schools-labels')) {
      try { map.setLayerZoomRange('schools-labels', SCHOOL_LABEL_MIN_ZOOM, 24); } catch (_) { /* ignore */ }
    }
  }

  function popup(lngLat, html, maxWidth) {
    return new global.mapboxgl.Popup({ closeButton: true, maxWidth: maxWidth || '300px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  // ---- Edge-flush details panel ---------------------------------------------
  function setupDetailPanel({ deferResize = false } = {}) {
    detailPanel = document.getElementById('map-detail-panel');
    detailTitle = document.getElementById('map-detail-title');
    detailBody = document.getElementById('map-detail-body');
    detailReopen = document.getElementById('map-detail-reopen');
    detailDropdown = null;
    const closeBtn = document.getElementById('map-detail-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.dataset.wired = '1';
      closeBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        closeDetail();
      });
    }
    if (detailReopen && !detailReopen.dataset.wired) {
      detailReopen.dataset.wired = '1';
      detailReopen.addEventListener('click', () => {
        if (detailPanel && detailPanel.classList.contains('is-open')) closeDetail();
        else openDetail();
      });
    }
    // Resize/padding touches the Mapbox camera — only after style 'load'.
    if (!deferResize) wireDetailResize();
  }

  const DETAIL_WIDTH_MIN = 260;
  const DETAIL_WIDTH_MAX = 640;
  const DETAIL_WIDTH_DEFAULT = 380;
  const DETAIL_WIDTH_KEY = 'nces-map-detail-width';

  function clampDetailWidth(px) {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const max = Math.min(DETAIL_WIDTH_MAX, Math.floor(vw * 0.92));
    return Math.max(DETAIL_WIDTH_MIN, Math.min(max, Math.round(px)));
  }

  function readStoredDetailWidth() {
    try {
      const n = Number(sessionStorage.getItem(DETAIL_WIDTH_KEY));
      if (Number.isFinite(n) && n > 0) return clampDetailWidth(n);
    } catch (_) { /* ignore */ }
    return DETAIL_WIDTH_DEFAULT;
  }

  function applyDetailWidth(px, { persist = true } = {}) {
    const w = clampDetailWidth(px);
    const wrap = detailPanel && detailPanel.closest('.map-wrap');
    if (wrap) wrap.style.setProperty('--map-detail-width', `${w}px`);
    if (detailPanel) detailPanel.style.width = `${w}px`;
    if (persist) {
      try { sessionStorage.setItem(DETAIL_WIDTH_KEY, String(w)); } catch (_) { /* ignore */ }
    }
    applyDetailCameraPadding();
    if (map) {
      try { map.resize(); } catch (_) { /* ignore */ }
    }
    return w;
  }

  function wireDetailResize() {
    if (!detailPanel || detailPanel.dataset.resizeWired) return;
    detailPanel.dataset.resizeWired = '1';
    applyDetailWidth(readStoredDetailWidth(), { persist: false });

    let handle = detailPanel.querySelector('.map-detail-resize');
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'map-detail-resize';
      handle.title = 'Drag to resize';
      handle.setAttribute('role', 'separator');
      handle.setAttribute('aria-orientation', 'vertical');
      handle.setAttribute('aria-label', 'Resize details panel');
      detailPanel.appendChild(handle);
    }

    let dragging = false;
    let startX = 0;
    let startW = DETAIL_WIDTH_DEFAULT;

    const onMove = (ev) => {
      if (!dragging) return;
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      applyDetailWidth(startW + (x - startX), { persist: false });
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing-detail');
      const w = detailPanel.getBoundingClientRect().width;
      applyDetailWidth(w, { persist: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
    const onDown = (ev) => {
      if (ev.button != null && ev.button !== 0) return;
      ev.preventDefault();
      dragging = true;
      startX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      startW = detailPanel.getBoundingClientRect().width || readStoredDetailWidth();
      document.body.classList.add('is-resizing-detail');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    };
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
  }

  function detailEnabled() {
    return !!(detailPanel && detailBody);
  }

  function openDetail() {
    if (!detailPanel) return;
    detailPanel.classList.add('is-open');
    const wrap = detailPanel.closest('.map-wrap');
    if (wrap) wrap.classList.add('has-detail-open');
    if (detailReopen) detailReopen.setAttribute('aria-expanded', 'true');
    applyDetailCameraPadding();
    // resize() recenters the viewport — skip during flythrough camera lock.
    if (map && !cameraLocked()) map.resize();
  }

  function closeDetail() {
    if (!detailPanel) return;
    detailPanel.classList.remove('is-open');
    const wrap = detailPanel.closest('.map-wrap');
    if (wrap) wrap.classList.remove('has-detail-open');
    if (detailReopen) detailReopen.setAttribute('aria-expanded', 'false');
    applyDetailCameraPadding();
    if (map && !cameraLocked()) map.resize();
  }

  /**
   * Shift the map's visual center so fits / flyTo / pan stay clear of the
   * left details panel (and don't land the selection under it).
   */
  function cameraLocked() {
    return !!(global.__mapLockCamera || global.__mapSkipAutoFit);
  }

  function setCameraLock(on) {
    global.__mapLockCamera = !!on;
    global.__mapSkipAutoFit = !!on;
    if (!map) return;
    try { map.stop(); } catch (_) { /* ignore */ }
    // Keep padding zero while locked so opening the detail panel cannot shove the camera.
    try {
      if (typeof map.setPadding === 'function') {
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      }
    } catch (_) { /* ignore */ }
  }

  function applyDetailCameraPadding() {
    if (!map || typeof map.setPadding !== 'function') return;
    // Flythrough owns the camera — never shift padding underneath an easeTo.
    if (cameraLocked()) {
      try { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } catch (_) { /* ignore */ }
      return;
    }
    try {
      if (detailPanel && detailPanel.classList.contains('is-open')) {
        const w = Math.round(
          detailPanel.getBoundingClientRect().width
          || Math.min(380, (typeof window !== 'undefined' ? window.innerWidth * 0.92 : 380))
        );
        map.setPadding({ top: 0, bottom: 0, left: w + 8, right: 0 });
      } else {
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      }
    } catch (_) { /* ignore */ }
  }

  /** Extra inset inside the visible (padded) map area for fitBounds. */
  function fitPadding() {
    return { top: 56, bottom: 56, left: 56, right: 56 };
  }

  /** Build From→To grade rows via two single-year RPCs (district-aware). */
  async function fetchGradeChangeViaSnapshots(args, leaids) {
    const yFrom = args.p_year_from;
    const yTo = args.p_year_to;
    const ncessch = args.p_ncessch || null;
    const fetchYear = async (year, leaid) => rpc('nces_map_enrollment_by_grade', {
      p_leaid: leaid || null,
      p_ncessch: ncessch,
      p_year: year,
    });
    let fromRows;
    let toRows;
    if (leaids.length > 1) {
      const [fromSets, toSets] = await Promise.all([
        Promise.all(leaids.map((id) => fetchYear(yFrom, id))),
        Promise.all(leaids.map((id) => fetchYear(yTo, id))),
      ]);
      fromRows = mergeGradeRows(fromSets, false);
      toRows = mergeGradeRows(toSets, false);
    } else {
      const leaid = leaids[0] || args.p_leaid || null;
      [fromRows, toRows] = await Promise.all([
        fetchYear(yFrom, leaid),
        fetchYear(yTo, leaid),
      ]);
    }
    const byGrade = new Map();
    (fromRows || []).forEach((r) => {
      const g = Number(r.grade);
      if (!Number.isFinite(g)) return;
      byGrade.set(g, {
        grade: g,
        enrollment_from: Number(r.enrollment) || 0,
        enrollment_to: 0,
      });
    });
    (toRows || []).forEach((r) => {
      const g = Number(r.grade);
      if (!Number.isFinite(g)) return;
      const cur = byGrade.get(g) || { grade: g, enrollment_from: 0, enrollment_to: 0 };
      cur.enrollment_to = Number(r.enrollment) || 0;
      byGrade.set(g, cur);
    });
    return [...byGrade.values()]
      .map((r) => {
        const from = Number(r.enrollment_from) || 0;
        const to = Number(r.enrollment_to) || 0;
        return {
          grade: r.grade,
          enrollment_from: from,
          enrollment_to: to,
          enrollment_delta: to - from,
          enrollment_pct: from > 0 ? Math.round(((to - from) / from) * 1000) / 10 : null,
        };
      })
      .filter((r) => r.enrollment_from > 0 || r.enrollment_to > 0)
      .sort((a, b) => a.grade - b.grade);
  }

  function gradeChangeFromLooksEmpty(rows) {
    const list = rows || [];
    if (!list.length) return true;
    const fromTotal = list.reduce((s, r) => s + (Number(r.enrollment_from) || 0), 0);
    const toTotal = list.reduce((s, r) => s + (Number(r.enrollment_to) || 0), 0);
    // Change RPC used school enrollment only — From year missing → fake growth.
    return fromTotal <= 0 && toTotal > 0;
  }

  async function loadGradeChangeRows(args) {
    const leaids = (args && args.p_leaids && args.p_leaids.length)
      ? args.p_leaids
      : (args && args.p_leaid ? [args.p_leaid] : []);
    let rows;
    try {
      if (leaids.length > 1) {
        const sets = await Promise.all(leaids.map((id) => rpc('nces_map_enrollment_by_grade_change', {
          p_year_from: args.p_year_from,
          p_year_to: args.p_year_to,
          p_leaid: id,
          p_ncessch: null,
        })));
        rows = mergeGradeRows(sets, true);
      } else {
        rows = await rpc('nces_map_enrollment_by_grade_change', {
          p_year_from: args.p_year_from,
          p_year_to: args.p_year_to,
          p_leaid: leaids[0] || args.p_leaid || null,
          p_ncessch: args.p_ncessch || null,
        });
      }
    } catch (_) {
      rows = [];
    }
    if (gradeChangeFromLooksEmpty(rows)) {
      try {
        const rebuilt = await fetchGradeChangeViaSnapshots(args, leaids);
        if (rebuilt.length) rows = rebuilt;
      } catch (_) { /* keep original rows */ }
    }
    return rows || [];
  }

  async function loadGradeIntoSlot(slot, args) {
    if (!slot || !client) return;
    try {
      const leaids = (args && args.p_leaids && args.p_leaids.length)
        ? args.p_leaids
        : (args && args.p_leaid ? [args.p_leaid] : []);

      if (args && args.change) {
        const rows = await loadGradeChangeRows(args);
        if (slot.isConnected) slot.innerHTML = gradeChangeChartHtml(rows, args.p_year_from, args.p_year_to);
        return;
      }

      let rows;
      if (leaids.length > 1) {
        const sets = await Promise.all(leaids.map((id) => rpc('nces_map_enrollment_by_grade', {
          p_leaid: id,
          p_ncessch: null,
          p_year: args.p_year,
        })));
        rows = mergeGradeRows(sets, false);
      } else {
        rows = await rpc('nces_map_enrollment_by_grade', {
          p_leaid: leaids[0] || args.p_leaid || null,
          p_ncessch: args.p_ncessch || null,
          p_year: args.p_year,
        });
      }
      if (slot.isConnected) slot.innerHTML = gradeChartHtml(rows);
    } catch (_) {
      if (args && args.change && args.p_year_to != null) {
        try {
          const leaid = (args.p_leaids && args.p_leaids[0]) || args.p_leaid || null;
          const rows = await rpc('nces_map_enrollment_by_grade', {
            p_leaid: leaid,
            p_ncessch: args.p_ncessch || null,
            p_year: args.p_year_to,
          });
          if (slot.isConnected) {
            slot.innerHTML = gradeChartHtml(rows)
              + '<div class="map-grade-empty">Per-grade change needs 009_nces_grade_enrollment_change.sql</div>';
          }
          return;
        } catch (__) { /* ignore */ }
      }
      if (slot.isConnected) slot.innerHTML = '<div class="map-grade-empty">Grade detail unavailable — run 005_nces_map_detail.sql</div>';
    }
  }

  // Route a detail card to the left panel when present, else a map popup.
  function detailYearSuffix(title) {
    const base = title || 'Details';
    if (changeYears.from != null && changeYears.to != null && changeYears.from !== changeYears.to) {
      return `${base} · ${changeYears.from}→${changeYears.to}`;
    }
    const y = resolveMetricYear();
    return Number.isFinite(y) ? `${base} · ${y}` : base;
  }

  function present(lngLat, d) {
    const withLoading = d.html.replace(
      '<!--GRADE_CHART-->',
      d.grade ? '<div class="map-grade-empty">Loading grades…</div>' : ''
    ).replace(
      '<!--CHANGE_BLOCK-->',
      d.loadChange ? '<div class="map-grade-empty">Loading enrollment change…</div>' : ''
    );
    if (detailEnabled()) {
      if (detailTitle) detailTitle.textContent = detailYearSuffix(d.title);
      detailBody.innerHTML = `<div class="map-popup map-detail-card">${withLoading}</div>`;
      detailBody.setAttribute('data-has-content', '1');
      openDetail();
      if (d.grade) loadGradeIntoSlot(detailBody.querySelector('.map-grade-slot'), d.grade);
      if (d.loadChange) d.loadChange(detailBody.querySelector('.map-change-slot'));
      if (d.afterPresent) d.afterPresent(detailBody);
      return;
    }
    const baseHtml = `<div class="map-popup"><strong>${detailYearSuffix(d.title)}</strong>${d.html}</div>`;
    const inst = popup(lngLat, baseHtml
      .replace('<!--GRADE_CHART-->', d.grade ? '<div class="map-grade-empty">Loading grades…</div>' : '')
      .replace('<!--CHANGE_BLOCK-->', d.loadChange ? '<div class="map-grade-empty">Loading enrollment change…</div>' : ''), d.width);
    if (d.grade) attachGradeChart(inst, baseHtml, d.grade);
    if (d.loadChange) {
      const slot = document.createElement('div');
      d.loadChange(slot).then(() => {
        if (!inst.isOpen()) return;
        const html = inst.getElement();
        const target = html && html.querySelector('.map-change-slot');
        if (target) target.innerHTML = slot.innerHTML;
      });
    }
  }

  function fmtFte(n) {
    if (n == null || n === '' || Number.isNaN(Number(n))) return 'n/a';
    const v = Number(n);
    if (v === 0) return '0';
    return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  /** Percent change display: always one decimal (e.g. -36.3). */
  function fmtPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return null;
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function stuTeacher(enroll, teachers) {
    const e = Number(enroll) || 0;
    const t = Number(teachers) || 0;
    if (!t) return null;
    return Math.round((e / t) * 10) / 10;
  }

  function ratioChangeProps(eFrom, eTo, tFrom, tTo) {
    const ef = Number(eFrom) || 0;
    const et = Number(eTo) || 0;
    const tf = Number(tFrom) || 0;
    const tt = Number(tTo) || 0;
    const ratio_from = tf > 0 ? Math.round((ef / tf) * 10) / 10 : 0;
    const ratio_to = tt > 0 ? Math.round((et / tt) * 10) / 10 : 0;
    const ratio_delta = Math.round((ratio_to - ratio_from) * 10) / 10;
    const ratio_pct = ratio_from > 0
      ? Math.round(((ratio_to - ratio_from) / ratio_from) * 1000) / 10
      : null;
    return { ratio_from, ratio_to, ratio_delta, ratio_pct };
  }

  function aggregateChangeProps(list) {
    let eFrom = 0;
    let eTo = 0;
    let tFrom = 0;
    let tTo = 0;
    let sFrom = 0;
    let sTo = 0;
    let have = false;
    (list || []).forEach((p) => {
      if (!p) return;
      if (p.enrollment_from == null && p.enrollment_to == null
        && p.teachers_from == null && p.teachers_to == null
        && p.staff_from == null && p.staff_to == null) {
        return;
      }
      have = true;
      eFrom += Number(p.enrollment_from) || 0;
      eTo += Number(p.enrollment_to) || 0;
      tFrom += Number(p.teachers_from) || 0;
      tTo += Number(p.teachers_to) || 0;
      sFrom += Number(p.staff_from) || 0;
      sTo += Number(p.staff_to) || 0;
    });
    if (!have) return null;
    const eDelta = eTo - eFrom;
    const tDelta = tTo - tFrom;
    const sDelta = sTo - sFrom;
    return Object.assign({
      enrollment_from: eFrom,
      enrollment_to: eTo,
      enrollment_delta: eDelta,
      enrollment_pct: eFrom > 0 ? Math.round((eDelta / eFrom) * 1000) / 10 : null,
      teachers_from: tFrom,
      teachers_to: tTo,
      teachers_delta: tDelta,
      teachers_pct: tFrom > 0 ? Math.round((tDelta / tFrom) * 1000) / 10 : null,
      staff_from: sFrom,
      staff_to: sTo,
      staff_delta: sDelta,
      staff_pct: sFrom > 0 ? Math.round((sDelta / sFrom) * 1000) / 10 : null,
    }, ratioChangeProps(eFrom, eTo, tFrom, tTo));
  }

  function gradeChartHtml(rows) {
    if (!rows || !rows.length) return '<div class="map-grade-empty">No grade enrollment synced</div>';
    const max = Math.max(...rows.map((r) => Number(r.enrollment) || 0), 1);
    const total = rows.reduce((sum, r) => sum + (Number(r.enrollment) || 0), 0);
    const bars = rows.map((r) => {
      const v = Number(r.enrollment) || 0;
      const pct = Math.max(2, Math.round((v / max) * 100));
      return `<div class="map-grade-row"><span class="map-grade-lbl">${gradeLabel(r.grade)}</span>`
        + `<span class="map-grade-bar"><i style="width:${pct}%"></i></span>`
        + `<span class="map-grade-n">${num(v)}</span></div>`;
    }).join('');
    return `<div class="map-grade-chart"><div class="map-grade-title">Enrollment by grade</div>${bars}`
      + `<div class="map-grade-row map-grade-total"><span class="map-grade-lbl">Tot</span>`
      + `<span class="map-grade-bar"><i style="width:100%"></i></span>`
      + `<span class="map-grade-n">${num(total)}</span></div>`
      + `</div>`;
  }

  function gradeChangeChartHtml(rows, yearFrom, yearTo) {
    if (!rows || !rows.length) {
      return `<div class="map-grade-empty">No grade enrollment for ${yearFrom} → ${yearTo}</div>`;
    }
    const max = Math.max(
      ...rows.map((r) => Math.max(Number(r.enrollment_from) || 0, Number(r.enrollment_to) || 0)),
      1
    );
    let totalFrom = 0;
    let totalTo = 0;
    const bars = rows.map((r) => {
      const from = Number(r.enrollment_from) || 0;
      const to = Number(r.enrollment_to) || 0;
      totalFrom += from;
      totalTo += to;
      const delta = Number(r.enrollment_delta);
      const d = Number.isFinite(delta) ? delta : (to - from);
      const sign = d > 0 ? '+' : '';
      const cls = d > 0 ? 'is-up' : d < 0 ? 'is-down' : '';
      const wFrom = from > 0 ? Math.max(2, Math.round((from / max) * 100)) : 0;
      const wTo = to > 0 ? Math.max(2, Math.round((to / max) * 100)) : 0;
      return `<div class="map-grade-change-row">`
        + `<span class="map-grade-lbl">${gradeLabel(r.grade)}</span>`
        + `<span class="map-grade-dual">`
        + `<span class="map-grade-bar is-from" title="${yearFrom}"><i style="width:${wFrom}%"></i></span>`
        + `<span class="map-grade-bar is-to" title="${yearTo}"><i style="width:${wTo}%"></i></span>`
        + `</span>`
        + `<span class="map-grade-n">${num(from)}→${num(to)}</span>`
        + `<span class="map-grade-delta ${cls}">${sign}${num(d)}</span>`
        + `</div>`;
    }).join('');
    const dTot = totalTo - totalFrom;
    const signTot = dTot > 0 ? '+' : '';
    const clsTot = dTot > 0 ? 'is-up' : dTot < 0 ? 'is-down' : '';
    const scale = Math.max(totalFrom, totalTo, 1);
    const wFromT = totalFrom > 0 ? Math.max(2, Math.round((totalFrom / scale) * 100)) : 0;
    const wToT = totalTo > 0 ? Math.max(2, Math.round((totalTo / scale) * 100)) : 0;
    return `<div class="map-grade-chart">`
      + `<div class="map-grade-title">Enrollment by grade (${yearFrom} → ${yearTo})</div>`
      + `<div class="map-grade-legend"><span class="is-from">■ ${yearFrom}</span><span class="is-to">■ ${yearTo}</span></div>`
      + bars
      + `<div class="map-grade-change-row map-grade-total">`
      + `<span class="map-grade-lbl">Tot</span>`
      + `<span class="map-grade-dual">`
      + `<span class="map-grade-bar is-from" title="${yearFrom}"><i style="width:${wFromT}%"></i></span>`
      + `<span class="map-grade-bar is-to" title="${yearTo}"><i style="width:${wToT}%"></i></span>`
      + `</span>`
      + `<span class="map-grade-n">${num(totalFrom)}→${num(totalTo)}</span>`
      + `<span class="map-grade-delta ${clsTot}">${signTot}${num(dTot)}</span>`
      + `</div>`
      + `</div>`;
  }

  function mergeGradeRows(rowSets, change) {
    const byGrade = new Map();
    (rowSets || []).forEach((rows) => {
      (rows || []).forEach((r) => {
        const g = Number(r.grade);
        if (!Number.isFinite(g)) return;
        const cur = byGrade.get(g) || {
          grade: g,
          enrollment: 0,
          enrollment_from: 0,
          enrollment_to: 0,
          enrollment_delta: 0,
        };
        if (change) {
          cur.enrollment_from += Number(r.enrollment_from) || 0;
          cur.enrollment_to += Number(r.enrollment_to) || 0;
          cur.enrollment_delta = cur.enrollment_to - cur.enrollment_from;
        } else {
          cur.enrollment += Number(r.enrollment) || 0;
        }
        byGrade.set(g, cur);
      });
    });
    return [...byGrade.values()].sort((a, b) => a.grade - b.grade);
  }

  async function attachGradeChart(popupInst, baseHtml, args) {
    if (!client || !popupInst) return;
    const writeGrade = (inner) => {
      if (!popupInst.isOpen()) return;
      const root = popupInst.getElement && popupInst.getElement();
      const slot = root && root.querySelector('.map-grade-slot');
      if (slot) {
        slot.innerHTML = inner;
        return;
      }
      // Fallback only when slot markup is missing.
      popupInst.setHTML(
        baseHtml
          .replace('<!--GRADE_CHART-->', inner)
          .replace('<!--CHANGE_BLOCK-->', '')
      );
    };
    try {
      const leaids = (args && args.p_leaids && args.p_leaids.length)
        ? args.p_leaids
        : (args && args.p_leaid ? [args.p_leaid] : []);
      if (args && args.change) {
        const rows = await loadGradeChangeRows(args);
        writeGrade(gradeChangeChartHtml(rows, args.p_year_from, args.p_year_to));
        return;
      }
      let rows;
      if (leaids.length > 1) {
        const sets = await Promise.all(leaids.map((id) => rpc('nces_map_enrollment_by_grade', {
          p_leaid: id,
          p_ncessch: null,
          p_year: args.p_year,
        })));
        rows = mergeGradeRows(sets, false);
      } else {
        rows = await rpc('nces_map_enrollment_by_grade', {
          p_leaid: leaids[0] || args.p_leaid || null,
          p_ncessch: args.p_ncessch || null,
          p_year: args.p_year,
        });
      }
      writeGrade(gradeChartHtml(rows));
    } catch (_) {
      writeGrade('<div class="map-grade-empty">Grade detail unavailable — run 005_nces_map_detail.sql</div>');
    }
  }

  async function fetchSchoolMetricChange(ncessch) {
    if (!client || !ncessch) return null;
    const cached = schoolChangeById[ncessch];
    if (cached
      && cached._from === changeYears.from
      && cached._to === changeYears.to) {
      return cached;
    }
    const wrap = ( partial) => {
      const ch = Object.assign({
        enrollment_from: 0,
        enrollment_to: 0,
        enrollment_delta: 0,
        enrollment_pct: null,
        teachers_from: 0,
        teachers_to: 0,
        teachers_delta: 0,
        teachers_pct: null,
        _from: changeYears.from,
        _to: changeYears.to,
      }, partial);
      schoolChangeById[ncessch] = ch;
      return ch;
    };
    async function teachersFromDirectory() {
      if (!client) return null;
      try {
        const pick = async (year) => {
          const { data, error } = await client
            .from('nces_school_directory')
            .select('teachers_fte, raw_data')
            .eq('ncessch', ncessch)
            .eq('school_year', year)
            .maybeSingle();
          if (error) throw error;
          if (!data) return 0;
          if (data.teachers_fte != null && Number.isFinite(Number(data.teachers_fte))) {
            return Number(data.teachers_fte);
          }
          const raw = data.raw_data || {};
          const n = Number(raw.teachers_fte ?? raw.teachers ?? raw.fte_teachers);
          return Number.isFinite(n) ? n : 0;
        };
        const [tf, tt] = await Promise.all([
          pick(changeYears.from),
          pick(changeYears.to),
        ]);
        if (!tf && !tt) return null;
        return {
          teachers_from: tf,
          teachers_to: tt,
          teachers_delta: tt - tf,
          teachers_pct: tf > 0 ? Math.round(((tt - tf) / tf) * 1000) / 10 : null,
        };
      } catch (_) {
        return null;
      }
    }

    try {
      const rows = await rpc('nces_map_school_metric_change', {
        p_year_from: changeYears.from,
        p_year_to: changeYears.to,
        p_state: (lastFilters && lastFilters.state) || null,
        p_leaid: (lastFilters && lastFilters.leaid) || null,
        p_ncessch: ncessch,
      });
      const r = (rows || [])[0];
      if (!r) {
        const tch = await teachersFromDirectory();
        return tch ? wrap(tch) : null;
      }
      let teachers_from = Number(r.teachers_from) || 0;
      let teachers_to = Number(r.teachers_to) || 0;
      let teachers_delta = Number(r.teachers_delta);
      let teachers_pct = r.teachers_pct != null ? Number(r.teachers_pct) : null;
      if (!teachers_from && !teachers_to) {
        const tch = await teachersFromDirectory();
        if (tch) {
          teachers_from = tch.teachers_from;
          teachers_to = tch.teachers_to;
          teachers_delta = tch.teachers_delta;
          teachers_pct = tch.teachers_pct;
        }
      }
      return wrap({
        enrollment_from: Number(r.enrollment_from) || 0,
        enrollment_to: Number(r.enrollment_to) || 0,
        enrollment_delta: Number(r.enrollment_delta) || 0,
        enrollment_pct: r.enrollment_pct != null ? Number(r.enrollment_pct) : null,
        teachers_from,
        teachers_to,
        teachers_delta: Number.isFinite(teachers_delta) ? teachers_delta : (teachers_to - teachers_from),
        teachers_pct,
      });
    } catch (_) {
      // Fallback if 009 (5-arg school change) is not installed yet.
      try {
        const sum = (rows) => (rows || []).reduce((s, row) => s + (Number(row.enrollment) || 0), 0);
        const [fromRows, toRows] = await Promise.all([
          rpc('nces_map_enrollment_by_grade', {
            p_ncessch: ncessch, p_leaid: null, p_year: changeYears.from,
          }),
          rpc('nces_map_enrollment_by_grade', {
            p_ncessch: ncessch, p_leaid: null, p_year: changeYears.to,
          }),
        ]);
        const enrollment_from = sum(fromRows);
        const enrollment_to = sum(toRows);
        const enrollment_delta = enrollment_to - enrollment_from;
        const tch = await teachersFromDirectory();
        return wrap(Object.assign({
          enrollment_from,
          enrollment_to,
          enrollment_delta,
          enrollment_pct: enrollment_from > 0
            ? Math.round((enrollment_delta / enrollment_from) * 1000) / 10
            : null,
        }, tch || {}));
      } catch (__) {
        return null;
      }
    }
  }

  function schoolEnrollmentChangeHtml(ch) {
    if (!ch) {
      return `<div class="map-change-block"><div class="map-grade-empty">No enrollment change for ${changeYears.from} → ${changeYears.to}</div></div>`;
    }
    const from = Number(ch.enrollment_from) || 0;
    const to = Number(ch.enrollment_to) || 0;
    const delta = Number(ch.enrollment_delta);
    const d = Number.isFinite(delta) ? delta : (to - from);
    const pct = ch.enrollment_pct != null ? Number(ch.enrollment_pct) : null;
    const sign = d > 0 ? '+' : '';
    const tFrom = Number(ch.teachers_from) || 0;
    const tTo = Number(ch.teachers_to) || 0;
    const tDelta = Number(ch.teachers_delta);
    const td = Number.isFinite(tDelta) ? tDelta : (tTo - tFrom);
    const tSign = td > 0 ? '+' : '';
    let teachers = '';
    if (tFrom || tTo) {
      teachers = `
        <div class="map-grade-title" style="margin-top:8px">Teachers FTE ${changeYears.from} → ${changeYears.to}</div>
        <div class="map-kpi-grid">
          <div><span>${changeYears.from}</span><b>${fmtFte(tFrom)}</b></div>
          <div><span>${changeYears.to}</span><b>${fmtFte(tTo)}</b></div>
          <div><span>Change</span><b class="${td > 0 ? 'is-up' : td < 0 ? 'is-down' : ''}">${tSign}${fmtFte(td)}</b></div>
          <div><span>% change</span><b>${ch.teachers_pct != null ? `${tSign}${fmtPct(ch.teachers_pct)}%` : 'n/a'}</b></div>
        </div>`;
      const ratio = ratioChangeProps(from, to, tFrom, tTo);
      if (ratio.ratio_from || ratio.ratio_to) {
        const rSign = ratio.ratio_delta > 0 ? '+' : '';
        // Higher students/teacher is worse → red when up, green when down.
        const rCls = ratio.ratio_delta > 0 ? 'is-down' : ratio.ratio_delta < 0 ? 'is-up' : '';
        teachers += `
        <div class="map-grade-title" style="margin-top:8px">Stud / teacher ${changeYears.from} → ${changeYears.to}</div>
        <div class="map-kpi-grid">
          <div><span>${changeYears.from}</span><b>${ratio.ratio_from}</b></div>
          <div><span>${changeYears.to}</span><b>${ratio.ratio_to}</b></div>
          <div><span>Change</span><b class="${rCls}">${rSign}${ratio.ratio_delta}</b></div>
          <div><span>% change</span><b>${ratio.ratio_pct != null ? `${rSign}${fmtPct(ratio.ratio_pct)}%` : 'n/a'}</b></div>
        </div>`;
      }
    }
    return `
      <div class="map-change-block">
        <div class="map-grade-title">Enrollment ${changeYears.from} → ${changeYears.to}</div>
        <div class="map-kpi-grid">
          <div><span>${changeYears.from}</span><b>${num(from)}</b></div>
          <div><span>${changeYears.to}</span><b>${num(to)}</b></div>
          <div><span>Change</span><b class="${d > 0 ? 'is-up' : d < 0 ? 'is-down' : ''}">${sign}${num(d)}</b></div>
          <div><span>% change</span><b>${pct != null ? `${sign}${fmtPct(pct)}%` : 'n/a'}</b></div>
        </div>
        ${teachers}
      </div>`;
  }

  // Count nationwide-mesh districts belonging to a state (GEOID prefix = FIPS).
  function meshDistrictCount(code) {
    const fips = STATE_FIPS[code];
    if (!fips || !allDistrictsFc.features.length) return null;
    let n = 0;
    allDistrictsFc.features.forEach((f) => {
      const gid = f.properties && f.properties.GEOID;
      if (gid && gid.slice(0, 2) === fips) n += 1;
    });
    return n;
  }

  const STATE_ZOOM = 5.5; // below this, clicks act on states; above, on districts

  function changeBlockHtml(p) {
    return leaMetricChangeHtml(p);
  }

  /** Full LEA change: enrollment + teachers + staff + stud/teacher (when From≠To). */
  function leaMetricChangeHtml(p) {
    if (!p) return '';
    const yFrom = changeYears.from;
    const yTo = changeYears.to;
    const ratio = (p.ratio_from != null || p.ratio_to != null)
      ? {
        ratio_from: Number(p.ratio_from) || 0,
        ratio_to: Number(p.ratio_to) || 0,
        ratio_delta: Number(p.ratio_delta),
        ratio_pct: p.ratio_pct != null ? Number(p.ratio_pct) : null,
      }
      : ratioChangeProps(
        Number(p.enrollment_from) || 0,
        Number(p.enrollment_to) || 0,
        Number(p.teachers_from) || 0,
        Number(p.teachers_to) || 0
      );

    const sections = [
      {
        field: 'enrollment',
        label: 'Enrollment',
        from: Number(p.enrollment_from) || 0,
        to: Number(p.enrollment_to) || 0,
        delta: Number(p.enrollment_delta),
        pct: p.enrollment_pct != null ? Number(p.enrollment_pct) : null,
        fmt: num,
      },
      {
        field: 'teachers',
        label: 'Teachers FTE',
        from: Number(p.teachers_from) || 0,
        to: Number(p.teachers_to) || 0,
        delta: Number(p.teachers_delta),
        pct: p.teachers_pct != null ? Number(p.teachers_pct) : null,
        fmt: fmtFte,
      },
      {
        field: 'staff',
        label: 'Staff FTE',
        from: Number(p.staff_from) || 0,
        to: Number(p.staff_to) || 0,
        delta: Number(p.staff_delta),
        pct: p.staff_pct != null ? Number(p.staff_pct) : null,
        fmt: fmtFte,
      },
      {
        field: 'ratio',
        label: 'Stud / teacher',
        from: Number(ratio.ratio_from) || 0,
        to: Number(ratio.ratio_to) || 0,
        delta: Number.isFinite(Number(ratio.ratio_delta))
          ? Number(ratio.ratio_delta)
          : ((Number(ratio.ratio_to) || 0) - (Number(ratio.ratio_from) || 0)),
        pct: ratio.ratio_pct != null ? Number(ratio.ratio_pct) : null,
        worseWhenUp: true,
        fmt: (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return 'n/a';
          return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
        },
      },
    ];

    const html = sections.map((s) => {
      if (!s.from && !s.to) return '';
      const d = Number.isFinite(s.delta) ? s.delta : (s.to - s.from);
      const sign = d > 0 ? '+' : '';
      const deltaCls = s.worseWhenUp
        ? (d > 0 ? 'is-down' : d < 0 ? 'is-up' : '')
        : (d > 0 ? 'is-up' : d < 0 ? 'is-down' : '');
      const active = changeField === s.field ? ' is-active-change' : '';
      return `
        <div class="map-change-block${active}">
          <div class="map-grade-title">${s.label} ${yFrom} → ${yTo}</div>
          <div class="map-kpi-grid">
            <div><span>${yFrom}</span><b>${s.fmt(s.from)}</b></div>
            <div><span>${yTo}</span><b>${s.fmt(s.to)}</b></div>
            <div><span>Change</span><b class="${deltaCls}">${sign}${s.fmt(d)}</b></div>
            <div><span>% change</span><b>${s.pct != null ? `${sign}${fmtPct(s.pct)}%` : 'n/a'}</b></div>
          </div>
        </div>`;
    }).join('');

    return html || '';
  }

  function statePopup(p) {
    const code = p.stusab || p.STUSAB;
    if (!code) return;
    // Toggle multi-select on the map; host syncs filters via onToggleState.
    if (typeof opts.onToggleState === 'function') {
      opts.onToggleState(code);
      return;
    }
    if (typeof opts.onSelectState === 'function') {
      opts.onSelectState(code);
      return;
    }
    toggleState(code);
  }

  function districtPopup(p) {
    if (!p || !p.leaid) return;
    if (typeof opts.onToggleDistrict === 'function') {
      opts.onToggleDistrict(String(p.leaid));
      return;
    }
    if (typeof opts.onSelectDistrict === 'function') {
      opts.onSelectDistrict(p.leaid);
      return;
    }
    toggleDistrict(p.leaid);
  }

  function schoolPopup(p, lngLat, optsPopup) {
    const o = optsPopup || {};
    const syncFilters = o.syncFilters !== false;
    lastSchoolDetail = { props: p, lngLat };
    // Toggle school into multi-select when host provides onToggleSchool.
    if (syncFilters && typeof opts.onToggleSchool === 'function' && p && p.ncessch) {
      opts.onToggleSchool(String(p.ncessch), {
        leaid: p.leaid ? String(p.leaid) : '',
        state: p.leaid ? stateForLeaid(p.leaid) : (lastFilters && lastFilters.state) || '',
        name: p.school_name || '',
      });
      return;
    }
    if (syncFilters && typeof opts.onSelectSchool === 'function' && p && p.ncessch) {
      opts.onSelectSchool(String(p.ncessch), {
        leaid: p.leaid ? String(p.leaid) : '',
        state: p.leaid ? stateForLeaid(p.leaid) : (lastFilters && lastFilters.state) || '',
        name: p.school_name || '',
      });
    }
    const enroll = Number(p.enrollment) || 0;
    const teachers = p.teachers_fte != null && Number(p.teachers_fte) > 0
      ? Number(p.teachers_fte)
      : (p.teachers_to != null && Number(p.teachers_to) > 0
        ? Number(p.teachers_to)
        : (p.teachers_fte != null ? Number(p.teachers_fte) : null));
    const ratio = stuTeacher(enroll, teachers);
    const year = resolveMetricYear();
    const yFrom = changeYears.from;
    const yTo = changeYears.to;
    const useGradeChange = yFrom != null && yTo != null && yFrom !== yTo;
    present(lngLat, {
      title: p.school_name || p.ncessch,
      width: '360px',
      grade: useGradeChange
        ? {
          change: true,
          p_year_from: yFrom,
          p_year_to: yTo,
          p_leaid: null,
          p_ncessch: p.ncessch,
        }
        : { p_leaid: null, p_ncessch: p.ncessch, p_year: year },
      loadChange: useGradeChange
        ? async (slot) => {
          if (!slot) return;
          let ch = schoolChangeById[p.ncessch];
          // Only reuse marker props when they were painted for this From/To pair.
          const propsMatch = p._change_from === yFrom && p._change_to === yTo
            && (p.enrollment_from != null || p.enrollment_to != null);
          if (!ch || ch._from !== yFrom || ch._to !== yTo) {
            if (propsMatch) {
              ch = {
                enrollment_from: Number(p.enrollment_from) || 0,
                enrollment_to: Number(p.enrollment_to) || 0,
                enrollment_delta: Number(p.enrollment_delta) || 0,
                enrollment_pct: p.enrollment_pct != null ? Number(p.enrollment_pct) : null,
                teachers_from: Number(p.teachers_from) || 0,
                teachers_to: Number(p.teachers_to) || 0,
                teachers_delta: Number(p.teachers_delta) || 0,
                teachers_pct: p.teachers_pct != null ? Number(p.teachers_pct) : null,
                _from: yFrom,
                _to: yTo,
              };
            } else {
              ch = await fetchSchoolMetricChange(p.ncessch);
            }
          }
          if (slot.isConnected || slot.parentNode) slot.innerHTML = schoolEnrollmentChangeHtml(ch);
        }
        : null,
      html: `
        <div>NCES ${p.ncessch}</div>
        <div>Type: ${LEVEL_LABELS[p.school_level] || 'Unknown'}${Number(p.charter) === 1 ? ' · Charter' : ''}</div>
        <div class="map-kpi-grid">
          <div><span>Enrollment</span><b>${num(enroll)}</b></div>
          <div><span>Grades</span><b>${p.grades || '—'}</b></div>
          <div><span>Teachers FTE</span><b>${fmtFte(teachers)}</b></div>
          <div><span>Stud / teacher</span><b>${ratio != null ? ratio : 'n/a'}</b></div>
        </div>
        <div class="map-change-slot"><!--CHANGE_BLOCK--></div>
        <div class="map-grade-slot"><!--GRADE_CHART--></div>`,
    });
  }

  let schoolHoverPopup = null;

  function wireInteractions() {
    const hoverLayers = [
      'state-fill-hit', 'districts-hit', 'districts-all-hit',
      'schools-circles', 'schools-rings', 'schools-dots', 'hs-areas-fill', 'district-regions-fill',
    ];
    hoverLayers.forEach((layer) => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    // Hover name chip for schools at any zoom (map labels only appear when zoomed in).
    const schoolHoverLayers = ['schools-circles', 'schools-rings', 'schools-dots'];
    schoolHoverLayers.forEach((layerId) => {
      map.on('mousemove', layerId, (e) => {
        if (regionEditActive || !e.features || !e.features.length) return;
        const p = e.features[0].properties || {};
        const name = p.school_name || p.ncessch || 'School';
        if (!schoolHoverPopup) {
          schoolHoverPopup = new global.mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 14,
            className: 'map-school-hover-popup',
            maxWidth: '240px',
          });
        }
        schoolHoverPopup
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${escapeHtml(String(name))}</strong>`)
          .addTo(map);
      });
      map.on('mouseleave', layerId, () => {
        if (schoolHoverPopup) {
          schoolHoverPopup.remove();
          schoolHoverPopup = null;
        }
      });
    });

    // Single zoom-aware click handler. Precedence: HS assign → school → district → state.
    map.on('click', (e) => {
      if (regionEditActive) {
        const editHits = map.queryRenderedFeatures(e.point, {
          layers: ['region-edit-verts', 'region-edit-mids'].filter((id) => map.getLayer(id)),
        });
        if (editHits.length) return;
        return; // suppress school/district selection while editing boundaries
      }

      const has = (id) => map.getLayer(id);
      const q = (ids) => map.queryRenderedFeatures(e.point, { layers: ids.filter(has) });

      if (hsAreasVisible) {
        const hsHits = q(['hs-areas-fill']);
        if (hsHits.length) {
          const name = hsHits[0].properties && hsHits[0].properties.hs_name;
          if (name && typeof opts.onSelectHsArea === 'function') {
            opts.onSelectHsArea(name);
            return;
          }
        }
      }

      if (regionLayersVisible) {
        const regionHits = q(['district-regions-fill']);
        if (regionHits.length) {
          const code = regionHits[0].properties && regionHits[0].properties.region_code;
          if (code != null && typeof opts.onSelectProgramRegion === 'function') {
            opts.onSelectProgramRegion(Number(code));
            return;
          }
        }
      }

      const school = q(['schools-circles', 'schools-rings', 'schools-dots']);
      if (school.length) { schoolPopup(school[0].properties, e.lngLat); return; }

      if (map.getZoom() >= STATE_ZOOM) {
        const dist = q(['districts-hit', 'districts-all-hit']);
        if (dist.length) { districtPopup(dist[0].properties, e.lngLat); return; }
      }

      const state = q(['state-fill-hit']);
      if (state.length) { statePopup(state[0].properties, e.lngLat); return; }

      // Zoomed in but clicked outside a detailed district: still allow district select.
      const distAny = q(['districts-hit', 'districts-all-hit']);
      if (distAny.length) { districtPopup(distAny[0].properties, e.lngLat); }
    });

    // Delegate detail-card buttons (works for both the map popup and the left panel).
    document.addEventListener('click', (ev) => {
      const stateBtn = ev.target.closest('[data-select-state]');
      if (stateBtn && opts.onSelectState) {
        opts.onSelectState(stateBtn.getAttribute('data-select-state'));
        return;
      }
      const clearSel = ev.target.closest('[data-clear-map-selection]');
      if (clearSel) {
        clearSelection();
        return;
      }
      const distBtn = ev.target.closest('[data-select-district]');
      if (distBtn && opts.onSelectDistrict) {
        opts.onSelectDistrict(distBtn.getAttribute('data-select-district'));
      }
    });
  }

  // ---- Map multi-selection (states + districts) --------------------------------
  function applySelectionFilter() {
    const leaIds = [...selectedDistricts];
    const leaFilter = ['in', ['get', 'leaid'], ['literal', leaIds]];
    ['districts-multi-fill', 'districts-multi-line', 'districts-all-multi-line'].forEach((id) => {
      if (map && map.getLayer(id)) map.setFilter(id, leaFilter);
    });
    const stateIds = [...selectedStates];
    const stateFilter = ['in', ['get', 'stusab'], ['literal', stateIds]];
    ['states-multi-fill', 'states-multi-line'].forEach((id) => {
      if (map && map.getLayer(id)) map.setFilter(id, stateFilter);
    });
  }

  function districtPropsByLeaid(leaid) {
    if (leaid == null || leaid === '') return null;
    const id = String(leaid);
    const fromRows = (lastData.districts || []).find((r) => String(r.leaid) === id) || null;
    const fromFc = (lastDistrictFc.features || [])
      .concat(allDistrictsFc.features || [])
      .find((f) => f.properties && String(f.properties.leaid) === id);
    const fcProps = fromFc ? fromFc.properties : null;
    const ch = changeByLeaid[id] || null;
    // Merge row + mesh + change cache so Details always sees From/To when loaded.
    const base = fromRows || fcProps ? Object.assign({}, fromRows || {}, fcProps || {}) : null;
    if (base && ch) return Object.assign(base, ch);
    if (ch) return Object.assign({ leaid: id }, ch);
    return base;
  }

  /**
   * Schools currently matching map filters (level checkboxes + size range)
   * within the selected district(s) / state(s). null when markers are not loaded.
   */
  function filteredSchoolsInSelection() {
    const rows = lastData.schools || [];
    if (!rows.length) return null;
    if (!selectedDistricts.size && !selectedStates.size) return null;
    const leaSet = selectedDistricts.size
      ? new Set([...selectedDistricts].map((id) => padLeaid(id)))
      : null;
    return rows.filter((r) => {
      if (leaSet) {
        if (!leaSet.has(padLeaid(r.leaid))) return false;
      } else if (selectedStates.size) {
        const st = stateForLeaid(r.leaid) || r.state_location;
        if (!st || !selectedStates.has(st)) return false;
      }
      const level = Number(r.school_level) || 4;
      if (!schoolLevels.has(level)) return false;
      if (!enrollmentInRange(r.enrollment, 'schools')) return false;
      return true;
    });
  }

  function selectionSummary() {
    const nameByLea = {};
    (allDistrictsFc.features || []).forEach((f) => {
      const p = f.properties || {};
      if (p.leaid) nameByLea[p.leaid] = p.district_name || p.leaid;
    });
    (lastDistrictFc.features || []).forEach((f) => {
      const p = f.properties || {};
      if (p.leaid) nameByLea[p.leaid] = p.district_name || p.leaid;
    });

    let districts = 0;
    let schools = 0;
    let enrollment = 0;
    let teachers = 0;
    let staff = 0;
    let haveDist = false;
    let haveState = false;

    const stateList = [...selectedStates].map((code) => {
      const summary = stateSummaryByCode[code] || {};
      const distCount = summary.districts != null ? Number(summary.districts) : (meshDistrictCount(code) || 0);
      const sch = Number(summary.schools) || 0;
      const enroll = Number(summary.enrollment) || 0;
      const t = Number(summary.teachers_fte) || 0;
      const s = Number(summary.staff_fte) || 0;
      if (summary.districts != null || summary.enrollment != null || summary.schools != null) haveState = true;
      districts += distCount;
      schools += sch;
      enrollment += enroll;
      teachers += t;
      staff += s;
      const feat = (allStatesFc.features || []).find((f) =>
        f.properties && (f.properties.stusab || f.properties.STUSAB) === code);
      const name = (feat && (feat.properties.BASENAME || feat.properties.NAME)) || code;
      return { code, name, districts: distCount, schools: sch, enrollment: enroll };
    });

    const districtList = [...selectedDistricts].map((leaid) => {
      const r = districtPropsByLeaid(leaid);
      if (r) {
        haveDist = true;
        // When states are also selected, district metrics are additive only if we
        // show "selection mix" — prefer not double-count: states OR districts.
        if (!selectedStates.size) {
          schools += Number(r.schools) || 0;
          enrollment += Number(r.enrollment) || 0;
          teachers += Number(r.teachers_fte) || 0;
          staff += Number(r.staff_fte) || 0;
          districts += 1;
        }
      } else if (!selectedStates.size) {
        districts += 1;
      }
      return {
        leaid,
        name: nameByLea[leaid] || (r && r.district_name) || leaid,
        enrollment: r ? Number(r.enrollment) || 0 : null,
        schools: r && r.schools != null ? Number(r.schools) : null,
      };
    });

    // District-only selection: count selected LEAs even when metrics missing.
    if (!selectedStates.size && selectedDistricts.size) {
      districts = selectedDistricts.size;
    }

    // Prefer count of map-visible schools (level / size filters) when markers are loaded.
    const visibleSchools = filteredSchoolsInSelection();
    if (visibleSchools) {
      schools = visibleSchools.length;
      // Per-district list counts should match the same filters.
      if (selectedDistricts.size && !selectedStates.size) {
        const byLea = new Map();
        visibleSchools.forEach((r) => {
          const id = padLeaid(r.leaid);
          byLea.set(id, (byLea.get(id) || 0) + 1);
        });
        districtList.forEach((d) => {
          d.schools = byLea.get(padLeaid(d.leaid)) || 0;
        });
      }
    }

    const haveData = haveState || haveDist || !!visibleSchools;
    const ratio = stuTeacher(enrollment, teachers);
    return {
      stateCount: selectedStates.size,
      count: selectedDistricts.size,
      states: stateList,
      districts: districtList,
      districtTotal: districts,
      schools: haveData ? schools : null,
      enrollment: haveData ? enrollment : null,
      teachers: haveData ? teachers : null,
      staff: haveData ? staff : null,
      ratio: haveData ? ratio : null,
    };
  }

  function nationwideSummary() {
    const codes = Object.keys(stateSummaryByCode || {});
    let districts = 0;
    let schools = 0;
    let enrollment = 0;
    let teachers = 0;
    let staff = 0;
    codes.forEach((code) => {
      const s = stateSummaryByCode[code] || {};
      districts += Number(s.districts) || 0;
      schools += Number(s.schools) || 0;
      enrollment += Number(s.enrollment) || 0;
      teachers += Number(s.teachers_fte) || 0;
      staff += Number(s.staff_fte) || 0;
    });
    const meshDistricts = (allDistrictsFc.features || []).length || 0;
    return {
      ready: codes.length > 0,
      stateCount: codes.length || (allStatesFc.features || []).length || 0,
      districts: districts || meshDistricts || null,
      schools: schools || null,
      enrollment: enrollment || null,
      teachers: teachers || null,
      staff: staff || null,
      ratio: stuTeacher(enrollment, teachers),
    };
  }

  async function refreshDistrictDetailForYear(leaid, year, root) {
    if (!client || !leaid || !root || !root.isConnected) return;
    const note = root.querySelector('.map-year-missing-note');
    const setKpi = (key, text) => {
      const el = root.querySelector(`[data-kpi="${key}"]`);
      if (el) el.textContent = text;
    };
    try {
      const st = stateForLeaid(leaid);
      let row = null;
      try {
        const rows = await rpc('nces_map_metric_change', {
          p_year_from: year,
          p_year_to: year,
          p_state: st || null,
        });
        row = (rows || []).find((r) => padLeaid(r.leaid) === padLeaid(leaid)) || null;
      } catch (_) {
        row = null;
      }
      if (!row && client.from) {
        const keys = leaKeys(leaid);
        const { data } = await client
          .from((global.NCES_CONFIG && global.NCES_CONFIG.tables && global.NCES_CONFIG.tables.districtDirectory)
            || 'nces_district_directory')
          .select('leaid, school_year, enrollment, teachers_total_fte, staff_total_fte, number_of_schools')
          .in('leaid', keys.length ? keys : [padLeaid(leaid)])
          .eq('school_year', year)
          .limit(1)
          .maybeSingle();
        if (data) {
          row = {
            enrollment_to: data.enrollment,
            teachers_to: data.teachers_total_fte,
            staff_to: data.staff_total_fte,
            schools: data.number_of_schools,
          };
        }
      }

      const enroll = row ? Number(row.enrollment_to ?? row.enrollment) || 0 : null;
      const teachers = row ? Number(row.teachers_to ?? row.teachers_fte ?? row.teachers_total_fte) || 0 : null;
      const staff = row ? Number(row.staff_to ?? row.staff_fte ?? row.staff_total_fte) || 0 : null;
      const schools = row && row.schools != null ? Number(row.schools) : null;
      const hasAny = row && (enroll || teachers || staff || schools);

      if (hasAny) {
        setKpi('enrollment', enroll != null ? num(enroll) : 'n/a');
        setKpi('teachers', teachers != null ? fmtFte(teachers) : 'n/a');
        setKpi('staff', staff != null ? fmtFte(staff) : 'n/a');
        setKpi('ratio', stuTeacher(enroll, teachers) != null ? String(stuTeacher(enroll, teachers)) : 'n/a');
        if (note) {
          note.classList.add('hidden');
          note.textContent = '';
        }
        return;
      }

      // No row / empty metrics for this year — list years that do exist.
      let yearsHave = [];
      try {
        const keys = leaKeys(leaid);
        const { data: yearRows } = await client
          .from((global.NCES_CONFIG && global.NCES_CONFIG.tables && global.NCES_CONFIG.tables.districtDirectory)
            || 'nces_district_directory')
          .select('school_year, enrollment')
          .in('leaid', keys.length ? keys : [padLeaid(leaid)])
          .order('school_year', { ascending: false });
        yearsHave = (yearRows || [])
          .filter((r) => r.enrollment != null && Number(r.enrollment) > 0)
          .map((r) => Number(r.school_year))
          .filter(Number.isFinite);
      } catch (_) { /* ignore */ }

      setKpi('enrollment', 'n/a');
      setKpi('teachers', 'n/a');
      setKpi('staff', 'n/a');
      setKpi('ratio', 'n/a');
      if (note) {
        note.classList.remove('hidden');
        if (yearsHave.length) {
          note.textContent = `No enrollment in district directory for ${year}. Years with enrollment: ${yearsHave.join(', ')}.`;
        } else {
          note.textContent = `No enrollment in district directory for ${year}.`;
        }
      }
    } catch (_) {
      if (note) {
        note.classList.remove('hidden');
        note.textContent = `Could not load directory metrics for ${year}.`;
      }
    }
  }

  function presentSelectionDetail(lngLat) {
    const s = selectionSummary();
    if (!s.stateCount && !s.count) {
      if (!detailEnabled()) return;
      const n = nationwideSummary();
      const yFrom = changeYears.from;
      const yTo = changeYears.to;
      const useGradeChange = yFrom != null && yTo != null && yFrom !== yTo;
      let changeHtml = '';
      if (useGradeChange && n.ready) {
        const stateProps = (allStatesFc.features || []).map((f) => f && f.properties).filter(Boolean);
        changeHtml = changeBlockHtml(aggregateChangeProps(stateProps));
      }
      if (!n.ready) {
        if (detailTitle) detailTitle.textContent = detailYearSuffix('United States');
        detailBody.innerHTML =
          '<p class="map-detail-empty">Loading nationwide totals…</p>';
        detailBody.setAttribute('data-has-content', '0');
        return;
      }
      present(lngLat || (map && map.getCenter()), {
        title: 'United States',
        width: '360px',
        html: `
          <div class="map-kpi-grid">
            <div><span>States</span><b>${num(n.stateCount)}</b></div>
            <div><span>Districts</span><b>${n.districts != null ? num(n.districts) : 'n/a'}</b></div>
            <div><span>Schools</span><b>${n.schools != null ? num(n.schools) : 'n/a'}</b></div>
            <div><span>Enrollment</span><b>${n.enrollment != null ? num(n.enrollment) : 'n/a'}</b></div>
            <div><span>Teachers FTE</span><b>${n.teachers != null ? fmtFte(n.teachers) : 'n/a'}</b></div>
            <div><span>Staff FTE</span><b>${n.staff != null ? fmtFte(n.staff) : 'n/a'}</b></div>
            <div><span>Stud / teacher</span><b>${n.ratio != null ? n.ratio : 'n/a'}</b></div>
          </div>
          ${changeHtml}
          <p class="map-detail-empty" style="margin-top:10px">
            Combined totals for all states · ${resolveMetricYear()}.
            Click a state to drill in.
          </p>`,
      });
      return;
    }

    const titleParts = [];
    if (s.stateCount) titleParts.push(`${s.stateCount} state${s.stateCount === 1 ? '' : 's'}`);
    if (s.count) titleParts.push(`${s.count} district${s.count === 1 ? '' : 's'}`);
    // Prefer a concrete name in the details header when a single place is selected.
    let title = titleParts.join(' · ') + ' selected';
    if (s.stateCount === 1 && !s.count && s.states[0]) {
      title = `${s.states[0].name} (${s.states[0].code})`;
    } else if (s.count === 1 && !s.stateCount && s.districts[0]) {
      title = s.districts[0].name || s.districts[0].leaid;
    } else if (s.stateCount === 1 && s.count === 1 && s.states[0] && s.districts[0]) {
      title = `${s.districts[0].name || s.districts[0].leaid}`;
    }

    const stateBits = (s.states || []).map((st) =>
      `<li><strong>${st.code}</strong> ${st.name}`
      + (st.enrollment != null ? ` · ${num(st.enrollment)} students` : '')
      + `</li>`
    ).join('');
    const distBits = (s.districts || []).slice(0, 40).map((d) =>
      `<li>${d.name}${d.enrollment != null ? ` · ${num(d.enrollment)}` : ''}</li>`
    ).join('')
      + (s.districts.length > 40 ? `<li>…and ${s.districts.length - 40} more</li>` : '');

    const openBtn = s.stateCount === 1 && !s.count
      ? `<button type="button" class="map-popup-btn" data-select-state="${s.states[0].code}">Open ${s.states[0].code} in filters</button>`
      : (s.count === 1 && !s.stateCount
        ? `<button type="button" class="map-popup-btn" data-select-district="${s.districts[0].leaid}">Open district in filters</button>`
        : '');

    const year = resolveMetricYear();
    const yFrom = changeYears.from;
    const yTo = changeYears.to;
    const useGradeChange = yFrom != null && yTo != null && yFrom !== yTo;
    const districtLeaids = (!s.stateCount && s.count >= 1)
      ? (s.districts || []).map((d) => d.leaid).filter(Boolean)
      : [];

    // Aggregate change across selected states or districts when From/To differ.
    let changeHtml = '';
    let aggChange = null;
    if (useGradeChange && s.stateCount) {
      const stateProps = (s.states || []).map((st) => {
        const feat = (allStatesFc.features || []).find((f) =>
          f.properties && (f.properties.stusab || f.properties.STUSAB) === st.code);
        return feat && feat.properties;
      });
      aggChange = aggregateChangeProps(stateProps);
      changeHtml = changeBlockHtml(aggChange);
    } else if (useGradeChange && districtLeaids.length) {
      const distProps = districtLeaids.map((id) => districtPropsByLeaid(id));
      aggChange = aggregateChangeProps(distProps);
      changeHtml = changeBlockHtml(aggChange);
    }

    const gradeArgs = districtLeaids.length
      ? (useGradeChange
        ? {
          change: true,
          p_year_from: yFrom,
          p_year_to: yTo,
          p_leaids: districtLeaids,
          p_leaid: districtLeaids[0],
          p_ncessch: null,
        }
        : {
          p_leaids: districtLeaids,
          p_leaid: districtLeaids[0],
          p_ncessch: null,
          p_year: year,
        })
      : null;

    const missingYearNote = (!useGradeChange && s.count === 1 && !s.stateCount
      && (s.enrollment == null || s.enrollment === 0)
      && (s.teachers == null || s.teachers === 0))
      ? `<p class="map-detail-empty map-year-missing-note" style="margin-top:8px">Checking directory for ${year}…</p>`
      : `<p class="map-detail-empty map-year-missing-note hidden" style="margin-top:8px"></p>`;

    present(lngLat || (map && map.getCenter()), {
      title,
      width: '360px',
      grade: gradeArgs,
      afterPresent: (!useGradeChange && districtLeaids.length === 1)
        ? (root) => refreshDistrictDetailForYear(districtLeaids[0], year, root)
        : null,
      html: `
        <div class="map-kpi-grid" data-detail-kpi>
          <div><span>States</span><b>${num(s.stateCount)}</b></div>
          <div><span>Districts</span><b>${s.districtTotal != null ? num(s.districtTotal) : num(s.count)}</b></div>
          <div><span>Schools</span><b data-kpi="schools">${s.schools != null ? num(s.schools) : 'n/a'}</b></div>
          <div><span>Enrollment</span><b data-kpi="enrollment">${s.enrollment != null ? num(s.enrollment) : 'n/a'}</b></div>
          <div><span>Teachers FTE</span><b data-kpi="teachers">${s.teachers != null ? fmtFte(s.teachers) : 'n/a'}</b></div>
          <div><span>Staff FTE</span><b data-kpi="staff">${s.staff != null ? fmtFte(s.staff) : 'n/a'}</b></div>
          <div><span>Stud / teacher</span><b data-kpi="ratio">${s.ratio != null ? s.ratio : 'n/a'}</b></div>
        </div>
        ${changeHtml}
        ${missingYearNote}
        ${stateBits ? `<div class="map-grade-title">States</div><ul class="map-selection-list-inline">${stateBits}</ul>` : ''}
        ${distBits ? `<div class="map-grade-title">Districts</div><ul class="map-selection-list-inline">${distBits}</ul>` : ''}
        <div class="map-grade-slot"><!--GRADE_CHART--></div>
        <button type="button" class="map-popup-btn" data-clear-map-selection="1">Clear selection</button>
        ${openBtn}`,
    });
  }

  function notifySelection() {
    applySelectionFilter();
    const summary = selectionSummary();
    if (opts.onSelectionChange) opts.onSelectionChange(summary);
    // Keep the left detail panel in sync with the current selection.
    presentSelectionDetail(map ? map.getCenter() : null);
  }

  function toggleDistrict(leaid) {
    if (!leaid) return;
    if (selectedDistricts.has(leaid)) selectedDistricts.delete(leaid);
    else selectedDistricts.add(leaid);
    // Selecting while "All states" must load full-res outlines for that LEA's state.
    const st = stateForLeaid(leaid);
    if (st) ensureDetailedStateBoundaries(st);
    notifySelection();
  }

  function toggleState(code) {
    if (!code) return;
    if (selectedStates.has(code)) selectedStates.delete(code);
    else selectedStates.add(code);
    notifySelection();
    // Exclusive Color-by: exactly one map-selected state → district fills.
    if (colorMetric) refreshColorScope();
    else applyVisibility();
  }

  function clearSelection() {
    lastSchoolDetail = null;
    if (!selectedDistricts.size && !selectedStates.size) {
      presentSelectionDetail(null);
      return;
    }
    selectedDistricts.clear();
    selectedStates.clear();
    notifySelection();
    refreshColorScope();
  }

  /**
   * Drive the left details panel from cascade / filter selection (not only map clicks).
   * Shows the state or district name in the details header.
   * When filters are empty, keep existing map multi-selection (needed for Color-by).
   * Does NOT re-fetch map data — render() owns district/school loads.
   */
  function presentFilterScope(filters) {
    const f = filters || lastFilters || {};
    const schoolIds = (f.schools && f.schools.length)
      ? f.schools.map(String)
      : (f.school ? [String(f.school)] : []);
    const leaIds = (f.leaids && f.leaids.length)
      ? f.leaids.map(String)
      : (f.leaid ? [String(f.leaid)] : []);

    // Single school: keep school detail in the left panel.
    if (schoolIds.length === 1) {
      if (focusSchool(schoolIds[0], {
        syncFilters: false,
        fit: autoFitAllowed(),
      })) return;
    }
    lastSchoolDetail = null;

    selectedDistricts.clear();
    selectedStates.clear();
    if (leaIds.length) {
      leaIds.forEach((id) => selectedDistricts.add(id));
      const st = f.state || stateForLeaid(leaIds[0]);
      if (st) ensureDetailedStateBoundaries(st);
    } else if (f.states && f.states.length) {
      f.states.forEach((c) => selectedStates.add(c));
    } else if (f.state) {
      selectedStates.add(f.state);
    }
    notifySelection();
    applyVisibility();
  }

  function getSelection() {
    return selectionSummary();
  }

  function stateForLeaid(leaid) {
    const fips = String(leaid || '').slice(0, 2);
    if (!fips) return null;
    const entry = Object.entries(STATE_FIPS).find(([, v]) => v === fips);
    return entry ? entry[0] : null;
  }

  const DETAILED_DISTRICT_ZOOM = 7.5;
  /** School name labels on the map (collision-aware). ~1 mile scale (earlier than street level). */
  const SCHOOL_LABEL_MIN_ZOOM = 12;
  let detailedFocusState = null;
  let detailedLoadToken = 0;
  let detailedViewTimer = null;

  function shouldShowNationwideDistrictMesh() {
    if (!visibility.districts) return false;
    // Only hide the coarse mesh once detailed polygons for the current state exist.
    // Hiding earlier left a blank map whenever EDGE/TIGER detail was slow or failed.
    if (lastFilters && lastFilters.state && lastDistrictFc.features.length) return false;
    if (map && map.getZoom() >= DETAILED_DISTRICT_ZOOM && lastDistrictFc.features.length) return false;
    if (detailedFocusState && lastDistrictFc.features.length) return false;
    return true;
  }

  function stateAtMapCenter() {
    if (!map) return null;
    try {
      const pt = map.project(map.getCenter());
      const hits = map.queryRenderedFeatures(pt, {
        layers: ['state-fill-hit'].filter((id) => map.getLayer(id)),
      });
      if (hits.length) {
        const p = hits[0].properties || {};
        return p.stusab || p.STUSAB || null;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  async function ensureDetailedStateBoundaries(stateCode) {
    if (!stateCode || !map || !map.getSource('districts')) return;
    if (lastFilters && lastFilters.state) return;
    if (stateCode === detailedFocusState && lastDistrictFc.features.length) {
      applyVisibility();
      return;
    }
    const token = ++detailedLoadToken;
    detailedFocusState = stateCode;
    try {
      const year = lastFilters && lastFilters.year != null ? lastFilters.year : null;
      const [bounds, rows] = await Promise.all([
        fetchStateDistrictBoundaries(stateCode),
        client
          ? rpc('nces_map_district_points', { p_state: stateCode, p_year: year }).catch(() => [])
          : Promise.resolve([]),
      ]);
      if (token !== detailedLoadToken) return;
      let fc = districtBoundariesToFc(bounds, rows || []);
      if (changeByLeaid && Object.keys(changeByLeaid).length) {
        fc = {
          type: 'FeatureCollection',
          features: fc.features.map((f) => {
            const ch = changeByLeaid[String(f.properties.leaid)];
            return ch ? { ...f, properties: Object.assign({}, f.properties, ch) } : f;
          }),
        };
      }
      lastDistrictFc = fc;
      setDistrictsSourceData(fc);
      applyVisibility();
      applyFilters();
      if (colorMetric) applyMetricPaint();
    } catch (_) {
      if (token === detailedLoadToken) detailedFocusState = null;
    }
  }

  function scheduleDetailedBoundaryRefresh() {
    if (detailedViewTimer) clearTimeout(detailedViewTimer);
    detailedViewTimer = setTimeout(() => {
      detailedViewTimer = null;
      refreshDetailedBoundariesForView();
    }, 250);
  }

  async function refreshDetailedBoundariesForView() {
    if (!map || !ready) return;
    if (lastFilters && lastFilters.state) {
      applyVisibility();
      return;
    }
    if (map.getZoom() < DETAILED_DISTRICT_ZOOM) {
      detailedFocusState = null;
      detailedLoadToken += 1;
      if (map.getSource('districts')) {
        lastDistrictFc = emptyFc();
        setDistrictsSourceData(emptyFc());
      }
      applyVisibility();
      return;
    }
    const code = stateAtMapCenter();
    if (code) await ensureDetailedStateBoundaries(code);
    else applyVisibility();
  }

  /** Type rim is available when fill is enrollment, or change with From≠To. */
  function schoolMetricFillActive() {
    return schoolMarkerMode === 'enrollment'
      || (schoolMarkerMode === 'change' && showSchoolChangeRings());
  }

  function schoolTypeRingVisible() {
    return !!(visibility.schools && schoolTypeRing && schoolMetricFillActive());
  }

  /**
   * Schools always use shape icons (level = shape). Circles layer stays hidden
   * (kept only as a cheap hit-test fallback). Color mode is applied in paint.
   * Type rim (schools-rings) when fill is enrollment/change and ring toggle is on.
   */
  function applySchoolLayerVisibility() {
    if (!map) return;
    if (map.getLayer('schools-dots')) {
      map.setLayoutProperty('schools-dots', 'visibility', 'none');
    }
    const schoolVis = visibility.schools ? 'visible' : 'none';
    if (map.getLayer('schools-rings')) {
      map.setLayoutProperty(
        'schools-rings',
        'visibility',
        schoolTypeRingVisible() ? 'visible' : 'none'
      );
    }
    if (map.getLayer('schools-circles')) {
      map.setLayoutProperty('schools-circles', 'visibility', schoolVis);
    }
    if (map.getLayer('schools-labels')) {
      map.setLayoutProperty('schools-labels', 'visibility', schoolVis);
    }
    try {
      // Rim behind fill: rings first, then circles on top.
      if (map.getLayer('schools-rings')) map.moveLayer('schools-rings');
      if (map.getLayer('schools-circles')) map.moveLayer('schools-circles');
      if (map.getLayer('schools-labels')) map.moveLayer('schools-labels');
    } catch (_) { /* ignore */ }
  }

  function applyVisibility() {
    if (!map) return;
    const set = (layer, key) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, 'visibility', visibility[key] ? 'visible' : 'none');
      }
    };
    set('state-fill-hit', 'states');
    set('state-outline-line', 'states');
    set('state-outline-selected', 'states');
    set('states-multi-fill', 'states');
    set('states-multi-line', 'states');
    set('states-labels', 'states');
    // Hide coarse nationwide mesh when zoomed in / state selected / detailed loaded.
    const showNationwideDistricts = shouldShowNationwideDistrictMesh();
    ['districts-all-line', 'districts-all-hit', 'districts-all-multi-line'].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', showNationwideDistricts ? 'visible' : 'none');
      }
    });
    set('districts-hit', 'districts');
    set('districts-line', 'districts');
    set('districts-multi-fill', 'districts');
    set('districts-multi-line', 'districts');
    set('districts-line-selected', 'districts');
    set('districts-labels', 'districts');
    applySchoolLayerVisibility();
    const targets = colorFillTargets();
    // When Color-by is on: one state → district fills only; nationwide → state fills only.
    // With Color-by off, still show district polygons when outlines are enabled.
    const showDetailedDistrictFill = visibility.districts && lastDistrictFc.features.length > 0
      && (!colorMetric || targets.districts);
    if (map.getLayer('districts-fill')) {
      map.setLayoutProperty('districts-fill', 'visibility', showDetailedDistrictFill ? 'visible' : 'none');
    }
    if (map.getLayer('districts-all-fill')) {
      // Nationwide district choropleth: used when districts are colored but the
      // detailed per-state polygons aren't loaded (i.e. no state selected).
      const showMeshFill = visibility.districts && !!colorMetric && targets.districts
        && !showDetailedDistrictFill && allDistrictsFc.features.length > 0;
      map.setLayoutProperty('districts-all-fill', 'visibility', showMeshFill ? 'visible' : 'none');
    }
    if (map.getLayer('states-choropleth-fill')) {
      // Only show metric fills when Color-by is on for states — Off must clear them.
      const showStateFill = visibility.states && !!colorMetric && targets.states;
      map.setLayoutProperty('states-choropleth-fill', 'visibility', showStateFill ? 'visible' : 'none');
    }
    applyFilters();
  }

  function setLayerVisible(key, visible) {
    const on = !!visible;
    if (key === 'states' || key === 'districts') {
      // States XOR districts: one on, or both off — never both on.
      if (on) {
        visibility.states = key === 'states';
        visibility.districts = key === 'districts';
      } else {
        visibility[key] = false;
      }
    } else if (key === 'schools') {
      visibility.schools = on;
      if (!on) {
        // Cancel any in-flight nationwide / scoped school load and clear markers.
        schoolLoadToken += 1;
        schoolLoadStatus = 'idle';
        schoolLoadPaused = false;
        schoolLoadRun = null;
        nationwideLoadPromise = null;
        nationwideFailedStates = [];
        lastData.schools = [];
        try {
          if (map && map.getSource('schools')) map.getSource('schools').setData(emptyFc());
        } catch (_) { /* ignore */ }
        if (typeof opts.onSchoolsLoaded === 'function') {
          try { opts.onSchoolsLoaded([], { status: 'idle' }); } catch (_) { /* ignore */ }
        }
      }
    } else {
      visibility[key] = on;
    }
    notifyLayerVisibility();
    applyVisibility();
    if (!on && key !== 'schools') return;
    if (visibility.districts && (key === 'districts' || (key === 'states' && on === false))) {
      const st = colorScopeState() || (lastFilters && lastFilters.state);
      if (st) ensureStateDistrictMetrics(st).catch(() => {});
      else kickNationwideDistricts();
    }
    if (visibility.schools && key === 'schools') {
      const st = colorScopeState() || (lastFilters && lastFilters.state);
      if (st) {
        loadSchoolsForScope(Object.assign({}, lastFilters || {}, { state: st })).catch(() => {});
      } else {
        // Country-wide: progressive state-by-state load.
        loadNationwideSchools(lastFilters || {}).catch(() => {});
      }
    }
  }

  /** Boundary mode: 'states' | 'districts' | 'off' (both boundary layers off). */
  function setBoundaryMode(mode) {
    if (mode === 'states') {
      visibility.states = true;
      visibility.districts = false;
    } else if (mode === 'districts') {
      visibility.states = false;
      visibility.districts = true;
    } else {
      visibility.states = false;
      visibility.districts = false;
    }
    notifyLayerVisibility();
    applyVisibility();
    if (visibility.districts) {
      const st = colorScopeState() || (lastFilters && lastFilters.state);
      if (st) {
        ensureStateDistrictMetrics(st).catch(() => {});
      } else {
        // Nationwide: make sure both the mesh polygons and their metrics load,
        // otherwise the country-wide district choropleth stays blank.
        kickNationwideDistricts();
        if (colorMetric) ensureNationwideMetrics().catch(() => {});
      }
    }
  }

  function getLayerVisibility() {
    return {
      schools: !!visibility.schools,
      states: !!visibility.states,
      districts: !!visibility.districts,
      boundary: visibility.states ? 'states' : (visibility.districts ? 'districts' : 'off'),
    };
  }

  function applyMetricPaint() {
    if (!map) return;
    if (!colorMetric) {
      if (map.getLayer('districts-fill')) {
        map.setPaintProperty(
          'districts-fill',
          'fill-color',
          ['coalesce', ['get', 'district_color'], '#93c5fd']
        );
        map.setPaintProperty('districts-fill', 'fill-opacity', 0.38);
      }
      // Drop leftover choropleth expressions so toggling Off never keeps old colors.
      if (map.getLayer('states-choropleth-fill')) {
        map.setPaintProperty('states-choropleth-fill', 'fill-color', '#93c5fd');
        map.setPaintProperty('states-choropleth-fill', 'fill-opacity', 0.35);
      }
      if (map.getLayer('districts-all-fill')) {
        map.setPaintProperty('districts-all-fill', 'fill-color', '#93c5fd');
        map.setPaintProperty('districts-all-fill', 'fill-opacity', 0.35);
      }
      applyFilters();
      return;
    }
    const districtExpr = fillExpr(colorMetric, 'districts');
    const stateExpr = fillExpr(colorMetric, 'states');
    ['districts-fill', 'districts-all-fill'].forEach((id) => {
      if (map.getLayer(id)) {
        map.setPaintProperty(id, 'fill-color', districtExpr);
        map.setPaintProperty(id, 'fill-opacity', 0.6);
      }
    });
    if (map.getLayer('states-choropleth-fill')) {
      map.setPaintProperty('states-choropleth-fill', 'fill-color', stateExpr);
      map.setPaintProperty('states-choropleth-fill', 'fill-opacity', 0.6);
    }
    // Feature filters are rebuilt centrally.
    applyFilters();
  }

  // Merge the current state summary metrics onto the nationwide state polygons so
  // the state choropleth can read them (enrollment / teachers / staff / ratio).
  function applyStateMetrics() {
    if (!map || !allStatesFc.features.length) return;
    allStatesFc.features.forEach((f) => {
      if (!f.properties) f.properties = {};
      const code = f.properties.stusab || f.properties.STUSAB;
      const s = code ? stateSummaryByCode[code] : null;
      const enrollment = s ? Number(s.enrollment) || 0 : 0;
      const teachers = s ? Number(s.teachers_fte) || 0 : 0;
      const staff = s ? Number(s.staff_fte) || 0 : 0;
      f.properties.enrollment = enrollment;
      f.properties.teachers_fte = teachers;
      f.properties.staff_fte = staff;
      f.properties.stu_teacher = stuTeacher(enrollment, teachers) || 0;
    });
    setStateOutlineData(allStatesFc);
  }

  function stateSummaryHasFte() {
    return Object.values(stateSummaryByCode).some(
      (s) => (Number(s.teachers_fte) || 0) > 0 || (Number(s.staff_fte) || 0) > 0
    );
  }

  let stateFteLoadKey = null;
  let stateFteLoading = false;

  /**
   * Enrollment comes from nces_map_state_summary; teachers/staff often do not
   * (older RPC without FTE columns, or empty teachers_total_fte). Change Color-by
   * works because it uses nces_map_state_metric_change — reuse that for FTE.
   * Also fills landing-page US detail (Teachers / Staff / Stud-teacher).
   */
  async function ensureStateFteMetrics(opts = {}) {
    if (!client || !map) return;
    const year = resolveMetricYear();
    const key = String(year);
    const needsColor = colorMetric === 'teachers'
      || colorMetric === 'staff'
      || colorMetric === 'ratio';
    const showLoad = !opts.quiet && needsColor;
    if (stateSummaryHasFte()) {
      if (stateFteLoadKey !== key) stateFteLoadKey = key;
      applyStateMetrics();
      if (needsColor) {
        applyMetricPaint();
        applyVisibility();
      }
      return;
    }
    if (stateFteLoading) return;
    stateFteLoading = true;
    const metricLabel = (COLOR_METRICS[colorMetric] && COLOR_METRICS[colorMetric].label) || 'staffing';
    if (showLoad) {
      setMetricLoad({
        active: true,
        title: `Loading ${metricLabel}`,
        label: `Retrieving state ${metricLabel.toLowerCase()} for ${year}…`,
      });
    }
    try {
      let rows = null;
      try {
        rows = await rpc('nces_map_state_metric_change', {
          p_year_from: year,
          p_year_to: year,
        });
      } catch (_) {
        try {
          rows = await rpc('nces_map_state_enrollment_change', {
            p_year_from: year,
            p_year_to: year,
          });
        } catch (__) {
          rows = null;
        }
      }
      (rows || []).forEach((r) => {
        const code = r.state_code;
        if (!code) return;
        if (!stateSummaryByCode[code]) {
          stateSummaryByCode[code] = {
            districts: Number(r.districts) || 0,
            schools: 0,
            enrollment: 0,
            teachers_fte: 0,
            staff_fte: 0,
          };
        }
        const cur = stateSummaryByCode[code];
        const enroll = Number(r.enrollment_to) || Number(r.enrollment_from) || 0;
        if (enroll > 0) cur.enrollment = enroll;
        cur.teachers_fte = Number(r.teachers_to) || Number(r.teachers_from) || 0;
        cur.staff_fte = Number(r.staff_to) || Number(r.staff_from) || 0;
      });
      stateFteLoadKey = key;
      applyStateMetrics();
      if (needsColor) {
        applyMetricPaint();
        applyVisibility();
      }
      // Refresh landing US panel (or open selection) now that FTE exists.
      if (!selectedDistricts.size) {
        presentSelectionDetail(map ? map.getCenter() : null);
      }
    } finally {
      stateFteLoading = false;
      if (showLoad) setMetricLoad({ active: false });
    }
  }

  // metric: null/'off' | 'enrollment' | 'teachers' | 'staff' | 'ratio' | 'change'
  function setColorMetric(metric) {
    colorMetric = metric && COLOR_METRICS[metric] ? metric : null;
    if (!isChangeMetric(colorMetric)) {
      lastChangeNote = null;
      applySchoolChangePaint();
    } else if (changeYears.from === changeYears.to) {
      // Host should set From/To first; if not, expand to a usable compare pair.
      const cfg = (global.NCES_CONFIG && global.NCES_CONFIG.schoolYears) || [2021, 2024];
      const years = cfg.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      const to = changeYears.to || Math.max(...years);
      const from = years.includes(2021) && 2021 < to
        ? 2021
        : (years.filter((y) => y < to).pop() || (to - 1));
      if (from !== to) {
        changeYears = { from, to };
        changeKey = null;
      }
    }
    if (isChangeMetric(colorMetric)) {
      // Paint + show immediately; change props load async onto polygons.
      applyMetricPaint();
      applyVisibility();
      ensureChangeMetrics();
      ensureSchoolChangeMetrics();
      return;
    }
    if (colorMetric) {
      // Merge summary metrics onto state polygons BEFORE paint/visibility so
      // Color-by switches don't flash blank (filter/paint reading empty props).
      applyStateMetrics();
      applyMetricPaint();
      applyVisibility();
      // Belt-and-suspenders: force choropleth on after Off → metric.
      if (map.getLayer('states-choropleth-fill') && visibility.states) {
        map.setLayoutProperty('states-choropleth-fill', 'visibility', 'visible');
      }
      // Teachers / staff / ratio need FTE — load from metric_change if summary lacks them.
      if (colorMetric === 'teachers' || colorMetric === 'staff' || colorMetric === 'ratio') {
        ensureStateFteMetrics().catch(() => {});
      }
      refreshColorScope();
      return;
    }
    applyMetricPaint();
    applyVisibility();
  }

  /** Fetch district metrics for one state and paint color-by / categorical fills. */
  async function ensureStateDistrictMetrics(stateCode) {
    if (!client || !map || !stateCode) return;
    const year = lastFilters && lastFilters.year != null
      ? lastFilters.year
      : (lastFilters && lastFilters.years && lastFilters.years.length
        ? Math.max(...lastFilters.years.map(Number))
        : null);
    const fips = STATE_FIPS[stateCode];
    // Show a loading note while district enrollment is fetched (can be large).
    if (opts.onStatus) {
      try {
        const loading = computeFilteredStatus();
        loading.notes = (loading.notes || []).concat(['Loading district enrollment…']);
        opts.onStatus(loading);
      } catch (_) { /* ignore */ }
    }
    try {
      const [rows, bounds] = await Promise.all([
        rpc('nces_map_district_points', { p_state: stateCode, p_year: year }),
        fetchStateDistrictBoundaries(stateCode).catch(() => null),
      ]);
      // Scope may have changed while RPCs were in flight.
      if (colorScopeState() !== stateCode && !(lastFilters && lastFilters.state === stateCode)) return;

      lastData.districts = rows || [];
      if (bounds && bounds.features && bounds.features.length) {
        lastDistrictFc = districtBoundariesToFc(bounds, rows || []);
      } else if (lastDistrictFc.features.length) {
        // Keep existing polygons if they match this state; else slice from mesh.
        const sameState = fips && lastDistrictFc.features.every((f) =>
          String((f.properties && (f.properties.leaid || f.properties.GEOID)) || '').slice(0, 2) === fips
        );
        if (sameState) {
          mergeDistrictMetrics(lastDistrictFc, rows || []);
        } else if (fips && allDistrictsFc.features.length) {
          const quick = allDistrictsFc.features.filter((f) =>
            String((f.properties && (f.properties.leaid || f.properties.GEOID)) || '').slice(0, 2) === fips
          );
          lastDistrictFc = mergeDistrictMetrics(
            { type: 'FeatureCollection', features: quick.map((f) => ({
              type: 'Feature',
              geometry: f.geometry,
              properties: Object.assign({}, f.properties),
            })) },
            rows || []
          );
        } else {
          mergeDistrictMetrics(lastDistrictFc, rows || []);
        }
      } else if (fips && allDistrictsFc.features.length) {
        const quick = allDistrictsFc.features.filter((f) =>
          String((f.properties && (f.properties.leaid || f.properties.GEOID)) || '').slice(0, 2) === fips
        );
        lastDistrictFc = mergeDistrictMetrics(
          { type: 'FeatureCollection', features: quick.map((f) => ({
            type: 'Feature',
            geometry: f.geometry,
            properties: Object.assign({}, f.properties),
          })) },
          rows || []
        );
      }
      detailedFocusState = stateCode;
      setDistrictsSourceData(lastDistrictFc);
      syncDistrictMetricsToMap();
      if (allDistrictsFc.features.length) {
        mergeDistrictMetrics(allDistrictsFc, rows || []);
        if (map.getSource('districts-all')) map.getSource('districts-all').setData(allDistrictsFc);
      }
      applyMetricPaint();
      applyVisibility();
      if (isChangeMetric(colorMetric) && changeYears.from !== changeYears.to) {
        ensureChangeMetrics();
      }
      if (opts.onDataRanges) {
        opts.onDataRanges({ districts: computeRange(rows || [], 'enrollment') });
      }
      if (opts.onStatus) {
        try { opts.onStatus(computeFilteredStatus()); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* leave uncolored */ }
  }

  // 'idle' | 'loading' | 'done' | 'error' — so the dropdown never sticks on "Loading…".
  let schoolLoadStatus = 'idle';
  let schoolLoadToken = 0;
  /** Nationwide progressive load: pause flag (stop bumps schoolLoadToken). */
  let schoolLoadPaused = false;
  let schoolLoadRun = null; // { token, done, total, byId size snapshot helpers }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitWhileSchoolLoadPaused(token) {
    while (schoolLoadPaused && token === schoolLoadToken) {
      await sleep(160);
    }
  }

  function notifySchoolLoadMeta(extra) {
    if (typeof opts.onSchoolsLoaded !== 'function') return;
    const rows = lastData.schools || [];
    try {
      opts.onSchoolsLoaded(rows, Object.assign({
        status: schoolLoadStatus,
        schools: rows.length,
        paused: schoolLoadPaused,
      }, extra || {}));
    } catch (_) { /* ignore */ }
  }

  function pauseNationwideSchools() {
    if (schoolLoadStatus !== 'loading' && schoolLoadStatus !== 'paused') return false;
    schoolLoadPaused = true;
    schoolLoadStatus = 'paused';
    notifySchoolLoadMeta(schoolLoadRun ? {
      done: schoolLoadRun.done,
      total: schoolLoadRun.total,
      doneStates: schoolLoadRun.doneStates.slice(),
      activeStates: [...schoolLoadRun.activeStates],
      failed: schoolLoadRun.failed.slice(),
    } : {});
    return true;
  }

  function resumeNationwideSchools() {
    if (!schoolLoadPaused && schoolLoadStatus !== 'paused') return false;
    schoolLoadPaused = false;
    schoolLoadStatus = 'loading';
    notifySchoolLoadMeta(schoolLoadRun ? {
      done: schoolLoadRun.done,
      total: schoolLoadRun.total,
      doneStates: schoolLoadRun.doneStates.slice(),
      activeStates: [...schoolLoadRun.activeStates],
      failed: schoolLoadRun.failed.slice(),
    } : {});
    return true;
  }

  function stopNationwideSchools() {
    const wasActive = schoolLoadStatus === 'loading' || schoolLoadStatus === 'paused';
    schoolLoadPaused = false;
    schoolLoadToken += 1;
    schoolLoadStatus = 'stopped';
    schoolLoadRun = null;
    nationwideLoadPromise = null;
    notifySchoolLoadMeta({
      status: 'stopped',
      done: null,
      total: null,
      activeStates: [],
    });
    return wasActive;
  }

  function mapSchoolRow(r) {
    return {
      ncessch: r.ncessch,
      leaid: r.leaid,
      school_name: r.school_name,
      latitude: r.latitude,
      longitude: r.longitude,
      school_level: r.school_level,
      charter: r.charter,
      lowest_grade: r.lowest_grade != null ? r.lowest_grade : r.lowest_grade_offered,
      highest_grade: r.highest_grade != null ? r.highest_grade : r.highest_grade_offered,
      enrollment: Number(r.enrollment) || 0,
      teachers_fte: r.teachers_fte,
      school_year: r.school_year != null ? Number(r.school_year) : null,
    };
  }

  /**
   * Fast directory-only school rows for immediate dropdown + marker display.
   * 4th arg: onPage callback OR options { onPage, yearOnly, pageSize, token }.
   */
  async function fetchSchoolDirectoryRows(state, leaid, year, onPageOrOpts) {
    const opts = typeof onPageOrOpts === 'function'
      ? { onPage: onPageOrOpts }
      : (onPageOrOpts || {});
    const onPage = opts.onPage;
    const yearOnly = !!opts.yearOnly;
    const pageSize = Math.max(500, Math.min(2000, Number(opts.pageSize) || 1000));
    const token = opts.token;
    const table = (global.NCES_CONFIG && global.NCES_CONFIG.tables
      && global.NCES_CONFIG.tables.schoolDirectory) || 'nces_school_directory';
    const lea = leaid ? padLeaid(leaid) : '';
    const rawLea = leaid ? String(leaid).trim() : '';
    const years = [];
    if (year != null && Number.isFinite(Number(year))) years.push(Number(year));
    if (!yearOnly) {
      const defY = Number((global.NCES_CONFIG && global.NCES_CONFIG.defaultSchoolYear) || 2024);
      [defY, 2023, 2022, 2021, 2020, 2015].forEach((y) => {
        if (!years.includes(y)) years.push(y);
      });
    }
    if (!years.length) {
      years.push(Number((global.NCES_CONFIG && global.NCES_CONFIG.defaultSchoolYear) || 2024));
    }

    async function pageQuery(build) {
      const rows = [];
      for (let from = 0; from < 200000; from += pageSize) {
        if (token != null && token !== schoolLoadToken) return rows;
        if (token != null) await waitWhileSchoolLoadPaused(token);
        if (token != null && token !== schoolLoadToken) return rows;
        const q = build(from, from + pageSize - 1);
        const { data, error } = await q;
        if (error) throw new Error(error.message || 'School directory query failed');
        const chunk = (data || []).map(mapSchoolRow);
        rows.push(...chunk);
        if (typeof onPage === 'function' && chunk.length) {
          try { onPage(chunk, rows.length); } catch (_) { /* ignore */ }
        }
        if (chunk.length < pageSize) break;
      }
      return rows;
    }

    const selectCols = 'ncessch,leaid,school_name,latitude,longitude,school_level,charter,'
      + 'lowest_grade_offered,highest_grade_offered,teachers_fte,state_location,school_year';

    // Match the School-level tab path: LEA + year first (fast), then LEA any year,
    // then state + year. Avoid .order() — it can stall large directory scans.
    if (lea || rawLea) {
      const ids = [...new Set([rawLea, lea].filter(Boolean))];
      for (let yi = 0; yi < years.length; yi++) {
        for (let ii = 0; ii < ids.length; ii++) {
          try {
            const rows = await pageQuery((from, to) => client
              .from(table)
              .select(selectCols)
              .eq('leaid', ids[ii])
              .eq('school_year', years[yi])
              .range(from, to));
            if (rows.length) return rows;
          } catch (_) { /* try next */ }
        }
      }
      if (!yearOnly) {
        for (let ii = 0; ii < ids.length; ii++) {
          try {
            const rows = await pageQuery((from, to) => client
              .from(table)
              .select(selectCols)
              .eq('leaid', ids[ii])
              .range(from, to));
            if (rows.length) {
              const best = new Map();
              rows.forEach((r) => {
                const prev = best.get(r.ncessch);
                if (!prev || (Number(r.school_year) || 0) > (Number(prev.school_year) || 0)) {
                  best.set(r.ncessch, r);
                }
              });
              return [...best.values()];
            }
          } catch (_) { /* try next */ }
        }
      }
    }

    if (state) {
      for (let yi = 0; yi < years.length; yi++) {
        try {
          const rows = await pageQuery((from, to) => client
            .from(table)
            .select(selectCols)
            .eq('state_location', state)
            .eq('school_year', years[yi])
            .range(from, to));
          if (rows.length) return rows;
        } catch (_) { /* try next */ }
      }
    }
    return [];
  }

  function fitToSchoolScope(rows) {
    if (!map || !visibility.schools) return;
    const f = lastFilters || {};
    const list = rows || lastData.schools || [];
    if (!list.length) {
      if (f.state && STATE_CENTROIDS[f.state]) {
        flyToCenter(STATE_CENTROIDS[f.state], 6.2, 700);
      }
      return;
    }
    const selected = f.school
      ? list.find((r) => String(r.ncessch) === String(f.school))
      : null;
    if (selected && selected.longitude != null && selected.latitude != null) {
      fitTo(schoolsToFc([selected]), 14);
      return;
    }
    fitTo(schoolsToFc(list), f.leaid ? 11 : 8);
  }

  function publishSchools(rows, status, optsPublish) {
    const out = rows || [];
    lastData.schools = out;
    schoolLoadStatus = status || 'done';
    try {
      if (map.getSource('schools')) map.getSource('schools').setData(schoolsToFc(out));
    } catch (err) {
      console.error('schools source setData failed', err);
    }
    // Only force the Schools layer on when the caller asks (district drill).
    // Auto-enabling here made state selection turn schools on unexpectedly.
    if (optsPublish && optsPublish.showLayer) visibility.schools = true;
    try { applyVisibility(); } catch (err) { console.warn('applyVisibility after schools', err); }
    try { applyFilters(); } catch (err) { console.warn('applyFilters after schools', err); }
    try { applySchoolChangePaint(); } catch (err) { console.warn('school paint after schools', err); }
    if (opts.onDataRanges) {
      try { opts.onDataRanges({ schools: computeRange(out, 'enrollment') }); } catch (_) { /* ignore */ }
    }
    if (typeof opts.onSchoolsLoaded === 'function') {
      try { opts.onSchoolsLoaded(out, { status: schoolLoadStatus }); } catch (_) { /* ignore */ }
    }
    if (optsPublish && optsPublish.fit && autoFitAllowed()) {
      try { fitToSchoolScope(out); } catch (_) { /* ignore */ }
    }
    try { pushFilteredStatus(); } catch (_) { /* ignore */ }
  }

  /** Push school rows from outside (e.g. School-tab directory fetch). */
  function setSchools(rows, optsPublish) {
    const mapped = (rows || []).map(mapSchoolRow);
    // Do not force the Schools layer on — year/filter refreshes must keep the user's toggle.
    publishSchools(mapped, 'done', Object.assign({ fit: true }, optsPublish || {}));
    return mapped;
  }

  /**
   * Open the left detail panel for a school and optionally zoom to it.
   * syncFilters:false avoids re-entering the cascade when filters are already set.
   */
  function focusSchool(ncessch, optsFocus) {
    if (!ncessch) return false;
    const o = optsFocus || {};
    const row = (lastData.schools || []).find((s) => String(s.ncessch) === String(ncessch));
    if (!row) return false;
    const p = Object.assign({}, row, {
      grades: gradeRange(row.lowest_grade, row.highest_grade),
    });
    const lngLat = (row.longitude != null && row.latitude != null)
      ? { lng: Number(row.longitude), lat: Number(row.latitude) }
      : (map ? map.getCenter() : null);
    schoolPopup(p, lngLat, { syncFilters: o.syncFilters === true });
    if (o.fit !== false && autoFitAllowed() && row.longitude != null && row.latitude != null) {
      try { fitTo(schoolsToFc([row]), 14); } catch (_) { /* ignore */ }
    }
    return true;
  }

  function debugSchools() {
    const src = map && map.getSource('schools');
    let featureCount = null;
    try {
      featureCount = src && src._data && src._data.features ? src._data.features.length : null;
    } catch (_) { /* ignore */ }
    const recovered = isReady();
    return {
      status: schoolLoadStatus,
      lastCount: (lastData.schools || []).length,
      sourceFeatures: featureCount,
      visibility: visibility.schools,
      layerDots: map && map.getLayer('schools-dots')
        ? map.getLayoutProperty('schools-dots', 'visibility')
        : null,
      layerSymbols: map && map.getLayer('schools-circles')
        ? map.getLayoutProperty('schools-circles', 'visibility')
        : null,
      filters: lastFilters,
      clientSet: !!client,
      mapReady: recovered,
      mapLoaded: !!(map && map.loaded && map.loaded()),
      sample: (lastData.schools || []).slice(0, 3).map((s) => ({
        ncessch: s.ncessch,
        name: s.school_name,
        lat: s.latitude,
        lng: s.longitude,
        level: s.school_level,
        enrollment: s.enrollment,
      })),
      hint: !recovered
        ? 'Map engine not ready — hard-refresh the page'
        : (schoolLoadStatus === 'idle' && !(lastData.schools || []).length
          ? 'No school load ran — pick a state/district, then: await forceReloadMapSchools()'
          : null),
    };
  }

  function getSchoolLoadStatus() {
    return schoolLoadStatus;
  }

  // In-memory cache of per-state school point rows (keyed dir:year:ST). Survives
  // re-toggles so a second nationwide pass is nearly instant.
  const nationwideSchoolCache = new Map();
  let nationwideSchoolYear = null;
  /** In-flight nationwide load promise — coalesce duplicate kicks from render/sync. */
  let nationwideLoadPromise = null;
  let nationwideFailedStates = [];

  function schoolYearFromFilters(f) {
    const filters = f || lastFilters || {};
    if (changeYears.from === changeYears.to && Number.isFinite(Number(changeYears.to))) {
      return Number(changeYears.to);
    }
    if (filters.year != null) return Number(filters.year);
    if (filters.years && filters.years.length) return Math.max(...filters.years.map(Number));
    return Number((global.NCES_CONFIG && global.NCES_CONFIG.defaultSchoolYear) || 2024);
  }

  function cachedNationwideStates(year) {
    const prefix = `dir:${year}:`;
    const out = new Set();
    nationwideSchoolCache.forEach((_, key) => {
      if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
    });
    return out;
  }

  function rememberNationwideCache(cacheKey, rows) {
    // Cache empty arrays too so states with no directory rows are not retried forever.
    if (nationwideSchoolCache.has(cacheKey)) nationwideSchoolCache.delete(cacheKey);
    nationwideSchoolCache.set(cacheKey, rows || []);
    // Keep enough room for every state/territory across a couple of years.
    while (nationwideSchoolCache.size > 120) {
      const oldest = nationwideSchoolCache.keys().next().value;
      nationwideSchoolCache.delete(oldest);
    }
  }

  /**
   * Progressive nationwide school load: stream pages onto the map as they arrive.
   * Large / viewport states first. Uses school directory pagination (fast) instead
   * of nces_map_school_points — that enrollment RPC times out on CA/TX.
   *
   * Duplicate kicks (render + syncMapScopeMode + layer toggle) coalesce onto one
   * in-flight run so partial maps are not left behind by cancelled workers.
   */
  async function loadNationwideSchools(filters) {
    if (!client || !map) return [];
    if (!visibility.schools) return lastData.schools || [];
    // Abort only for an explicit state/LEA filter — not for Color-by scope.
    const f = Object.assign({}, filters || lastFilters || {});
    if (f.state || f.leaid) {
      return loadSchoolsForScope(f);
    }
    const year = schoolYearFromFilters(f);
    const allCodes = Object.keys(STATE_FIPS);
    const cached = cachedNationwideStates(year);
    const missing = allCodes.filter((c) => !cached.has(c));
    const force = !!(filters && filters.forceNationwideReload);

    // Same-year load already running — return it (do not bump token / cancel workers).
    if (
      !force
      && nationwideLoadPromise
      && nationwideSchoolYear === year
      && (schoolLoadStatus === 'loading' || schoolLoadStatus === 'paused')
    ) {
      return nationwideLoadPromise;
    }

    // Complete coverage already on the map — skip re-fetch unless forced or gaps remain.
    if (
      !force
      && schoolLoadStatus === 'done'
      && nationwideSchoolYear === year
      && (lastData.schools || []).length
      && !missing.length
      && !nationwideFailedStates.length
    ) {
      return lastData.schools || [];
    }

    const run = runNationwideSchoolLoad(f, year, {
      preferCodes: missing.length && missing.length < allCodes.length ? missing : null,
      retryFailed: nationwideFailedStates.slice(),
    });
    nationwideLoadPromise = run.finally(() => {
      if (nationwideLoadPromise === run) nationwideLoadPromise = null;
    });
    return nationwideLoadPromise;
  }

  async function runNationwideSchoolLoad(f, year, orderOpts) {
    const token = ++schoolLoadToken;
    schoolLoadPaused = false;
    schoolLoadStatus = 'loading';
    nationwideSchoolYear = year;

    // Prefer states currently on screen, then large states, then A–Z.
    // On resume, uncached / previously failed states go first.
    const LARGE_FIRST = ['CA', 'TX', 'NY', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'];
    const allCodes = Object.keys(STATE_FIPS);
    let viewportCodes = [];
    try {
      const b = map.getBounds && map.getBounds();
      if (b) {
        viewportCodes = allCodes.filter((code) => {
          const c = STATE_CENTROIDS[code];
          if (!c) return false;
          return b.contains(c);
        });
      }
    } catch (_) { /* ignore */ }
    const seen = new Set();
    const codes = [];
    const pushUnique = (list) => {
      (list || []).forEach((c) => {
        if (!STATE_FIPS[c] || seen.has(c)) return;
        seen.add(c);
        codes.push(c);
      });
    };
    pushUnique(orderOpts && orderOpts.retryFailed);
    pushUnique(orderOpts && orderOpts.preferCodes);
    pushUnique(viewportCodes);
    pushUnique(LARGE_FIRST);
    pushUnique(allCodes.slice().sort());

    const byId = new Map();
    (lastData.schools || []).forEach((r) => {
      if (r && r.ncessch) byId.set(String(r.ncessch), r);
    });
    const failed = [];
    const doneStates = [];
    const activeStates = new Set();
    let lastPaintAt = 0;
    schoolLoadRun = {
      token,
      done: 0,
      total: codes.length,
      doneStates,
      activeStates,
      failed,
    };

    const paintNow = (forcePaint) => {
      const now = Date.now();
      if (!forcePaint && now - lastPaintAt < 220) return;
      lastPaintAt = now;
      const rows = [...byId.values()];
      lastData.schools = rows;
      try {
        if (map.getSource('schools')) map.getSource('schools').setData(schoolsToFc(rows));
      } catch (_) { /* ignore */ }
      try { applySchoolLayerVisibility(); } catch (_) { /* ignore */ }
      try { applyFilters(); } catch (_) { /* ignore */ }
    };

    const pushProgress = (done, total, currentCode, note, streaming) => {
      if (token !== schoolLoadToken) return;
      if (schoolLoadRun) schoolLoadRun.done = done;
      paintNow(!!streaming || done === total || schoolLoadPaused);
      const rows = lastData.schools || [];
      const meta = {
        status: schoolLoadPaused ? 'paused' : 'loading',
        done,
        total,
        state: currentCode || null,
        schools: rows.length,
        failed: failed.slice(),
        doneStates: doneStates.slice(),
        activeStates: [...activeStates],
        streaming: !!streaming,
        paused: schoolLoadPaused,
      };
      if (typeof opts.onSchoolsLoaded === 'function') {
        try { opts.onSchoolsLoaded(rows, meta); } catch (_) { /* ignore */ }
      }
    };

    pushProgress(0, codes.length, null, 'Starting nationwide school load (visible + large states first)…');

    const CONCURRENCY = 6;
    let cursor = 0;
    let completed = 0;

    function ingestRow(r) {
      const mapped = mapSchoolRow(r);
      if (!mapped.ncessch) return;
      if (Number(mapped.enrollment) <= 0) {
        const approx = Math.round((Number(mapped.teachers_fte) || 0) * 15);
        mapped.enrollment = approx > 0 ? approx : 50;
      }
      byId.set(String(mapped.ncessch), mapped);
    }

    function normalizeRows(rows) {
      return (rows || []).map((r) => {
        if (Number(r.enrollment) > 0) return r;
        const approx = Math.round((Number(r.teachers_fte) || 0) * 15);
        return Object.assign({}, r, { enrollment: approx > 0 ? approx : 50 });
      });
    }

    async function loadOne(code) {
      if (token !== schoolLoadToken) return;
      await waitWhileSchoolLoadPaused(token);
      if (token !== schoolLoadToken) return;
      activeStates.add(code);
      pushProgress(completed, codes.length, code, `Loading ${code}…`, true);
      const cacheKey = `dir:${year}:${code}`;
      let rows = nationwideSchoolCache.get(cacheKey);
      if (!rows) {
        try {
          const onPage = (chunk) => {
            if (token !== schoolLoadToken) return;
            (chunk || []).forEach(ingestRow);
            pushProgress(
              completed,
              codes.length,
              code,
              `Streaming ${code}… ${byId.size.toLocaleString()} schools so far`,
              true
            );
          };
          rows = await fetchSchoolDirectoryRows(code, null, year, {
            yearOnly: true,
            pageSize: 1000,
            token,
            onPage,
          });
          // Selected year empty for this state — fall back to latest available year.
          if (!(rows || []).length) {
            rows = await fetchSchoolDirectoryRows(code, null, year, {
              yearOnly: false,
              pageSize: 1000,
              token,
              onPage,
            });
          }
          rows = normalizeRows(rows);
        } catch (err) {
          console.warn('Nationwide school load failed for', code, err);
          failed.push(code);
          rows = [];
        }
        // Do not cache hard failures — those stay in nationwideFailedStates for retry.
        if (!failed.includes(code)) rememberNationwideCache(cacheKey, rows || []);
      }
      if (token !== schoolLoadToken) return;
      (rows || []).forEach(ingestRow);
      activeStates.delete(code);
      if (!failed.includes(code)) doneStates.push(code);
      completed += 1;
      pushProgress(completed, codes.length, code);
    }

    async function worker() {
      while (cursor < codes.length) {
        if (token !== schoolLoadToken) return;
        if (!visibility.schools) return;
        // Only stop for an explicit dashboard state/LEA filter (not color-scope).
        if (lastFilters && (lastFilters.state || lastFilters.leaid)) return;
        await waitWhileSchoolLoadPaused(token);
        if (token !== schoolLoadToken) return;
        const code = codes[cursor++];
        await loadOne(code);
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    if (token !== schoolLoadToken) {
      // Stopped or superseded — keep whatever markers we already painted.
      return lastData.schools || [];
    }
    if (!visibility.schools) {
      // Layer turned off mid-run (token usually bumps too); don't leave status=loading.
      if (schoolLoadStatus === 'loading' || schoolLoadStatus === 'paused') {
        schoolLoadStatus = 'idle';
        schoolLoadRun = null;
      }
      return lastData.schools || [];
    }
    if (lastFilters && (lastFilters.state || lastFilters.leaid)) {
      // Scope narrowed mid-run — mark incomplete so a later nationwide kick can resume.
      schoolLoadStatus = 'idle';
      schoolLoadRun = null;
      nationwideFailedStates = allCodes.filter((c) => !doneStates.includes(c) && !failed.includes(c));
      return lastData.schools || [];
    }

    const finalRows = [...byId.values()];
    schoolLoadRun = null;
    schoolLoadStatus = 'done';
    nationwideFailedStates = failed.slice();
    publishSchools(finalRows, 'done', { fit: false });
    if (typeof opts.onSchoolsLoaded === 'function') {
      try {
        opts.onSchoolsLoaded(finalRows, {
          status: 'done',
          done: codes.length,
          total: codes.length,
          schools: finalRows.length,
          failed: failed.slice(),
          doneStates: doneStates.slice(),
          activeStates: [],
          paused: false,
        });
      } catch (_) { /* ignore */ }
    }
    return finalRows;
  }

  /** Load school markers for the current filter scope (survives render cancellation). */
  async function loadSchoolsForScope(filters) {
    if (!client || !map) return [];
    const f = Object.assign({}, filters || lastFilters || {});
    // LEA alone is enough — derive state from the LEAID FIPS prefix.
    if (!f.state && f.leaid) f.state = stateForLeaid(f.leaid);
    const state = f.state || colorScopeState();
    if (!state && !f.leaid) {
      // Nationwide: progressive state-by-state load (single US RPC times out).
      if (visibility.schools) return loadNationwideSchools(f);
      schoolLoadStatus = 'idle';
      lastData.schools = [];
      if (map.getSource('schools')) map.getSource('schools').setData(emptyFc());
      applyVisibility();
      if (typeof opts.onSchoolsLoaded === 'function') {
        opts.onSchoolsLoaded([], { status: 'idle' });
      }
      return [];
    }
    const year = f.year != null
      ? f.year
      : (f.years && f.years.length
        ? Math.max(...f.years.map(Number))
        : Number((global.NCES_CONFIG && global.NCES_CONFIG.defaultSchoolYear) || 2024));
    const rawLeaid = f.leaid ? String(f.leaid).trim() : '';
    const wantLeaid = rawLeaid ? padLeaid(rawLeaid) : '';
    const token = ++schoolLoadToken;
    schoolLoadStatus = 'loading';
    if (typeof opts.onSchoolsLoaded === 'function') {
      opts.onSchoolsLoaded(lastData.schools || [], { status: 'loading' });
    }
    try {
      // LEA: directory first (fast). Statewide: RPC only — directory paging times out.
      let directoryRows = [];
      let dirErrMsg = '';
      try {
        if (rawLeaid || wantLeaid) {
          directoryRows = await fetchSchoolDirectoryRows(state, rawLeaid || wantLeaid, year);
        }
      } catch (dirErr) {
        directoryRows = [];
        dirErrMsg = dirErr && dirErr.message ? String(dirErr.message) : String(dirErr);
      }
      if (token !== schoolLoadToken) return lastData.schools || [];
      if (directoryRows.length) {
        publishSchools(directoryRows, 'done', { fit: true });
      }

      async function rpcSchoolPoints(yr, lea) {
        return rpc('nces_map_school_points', {
          p_state: state,
          p_leaid: lea || null,
          p_year: yr,
        });
      }

      let rows = [];
      let rpcErrMsg = '';
      try {
        const rpcMs = rawLeaid ? 20000 : 90000;
        rows = await Promise.race([
          rpcSchoolPoints(year, rawLeaid || null),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error('School metric load timed out')),
            rpcMs
          )),
        ]);
      } catch (rpcErr) {
        rows = [];
        rpcErrMsg = rpcErr && rpcErr.message ? String(rpcErr.message) : String(rpcErr);
      }
      if (rawLeaid && wantLeaid && wantLeaid !== rawLeaid && !(rows || []).length) {
        try { rows = await rpcSchoolPoints(year, wantLeaid); } catch (_) { rows = []; }
      }
      if (!(rows || []).length && !directoryRows.length && rawLeaid) {
        try {
          directoryRows = await fetchSchoolDirectoryRows(state, rawLeaid, null);
        } catch (_) { /* ignore */ }
      }
      if (!(rows || []).length && directoryRows.length) {
        const dirYear = Number(directoryRows[0].school_year) || null;
        const tryYears = [dirYear, 2023, 2022, 2021].filter((y, i, a) => y && y !== year && a.indexOf(y) === i);
        for (let i = 0; i < tryYears.length && !(rows || []).length; i++) {
          try {
            rows = await rpcSchoolPoints(tryYears[i], rawLeaid || wantLeaid || null);
          } catch (_) { rows = []; }
        }
      }
      // Do NOT fall back to statewide directory paging — it statement-timeouts past offset ~1000.
      if (token !== schoolLoadToken) return lastData.schools || [];
      const curState = (lastFilters && lastFilters.state) || colorScopeState();
      // Only abort on a real state switch — ignore empty lastFilters.state when we derived state from LEA.
      if (curState && state && curState !== state) return lastData.schools || [];
      const curLeaid = lastFilters && lastFilters.leaid ? padLeaid(lastFilters.leaid) : '';
      let out = rows || [];
      if (curLeaid && !rawLeaid) {
        out = out.filter((s) => padLeaid(s.leaid) === curLeaid);
      } else if (curLeaid && wantLeaid && curLeaid !== wantLeaid) {
        return lastData.schools || [];
      }
      if (out.length) publishSchools(out, 'done', { fit: !directoryRows.length });
      else if (directoryRows.length) publishSchools(directoryRows, 'done', { fit: true });
      else {
        const prev = lastData.schools || [];
        const sameScope = prev.length && (!wantLeaid
          || prev.some((s) => padLeaid(s.leaid) === wantLeaid));
        if (!sameScope) publishSchools([], 'done', { fit: false });
        else {
          schoolLoadStatus = 'done';
          if (typeof opts.onSchoolsLoaded === 'function') {
            opts.onSchoolsLoaded(prev, { status: 'done' });
          }
        }
        if (opts.onStatus && (dirErrMsg || rpcErrMsg)) {
          const st = computeFilteredStatus({});
          st.notes = (st.notes || []).concat([
            dirErrMsg ? ('Schools directory: ' + dirErrMsg) : null,
            rpcErrMsg ? ('Schools RPC: ' + rpcErrMsg) : 'No school points for this scope',
          ].filter(Boolean));
          opts.onStatus(st);
        }
      }
      if (curLeaid || showSchoolChangeRings()) ensureSchoolChangeMetrics();
      return lastData.schools || [];
    } catch (err) {
      if (token !== schoolLoadToken) return lastData.schools || [];
      if ((lastData.schools || []).length) {
        schoolLoadStatus = 'done';
        if (typeof opts.onSchoolsLoaded === 'function') {
          opts.onSchoolsLoaded(lastData.schools, { status: 'done' });
        }
        pushFilteredStatus();
        return lastData.schools;
      }
      schoolLoadStatus = 'error';
      publishSchools([], 'error', { fit: false });
      if (opts.onStatus) {
        const st = computeFilteredStatus({});
        st.notes = (st.notes || []).concat(['Schools: ' + (err.message || err)]);
        opts.onStatus(st);
      }
      return [];
    }
  }

  function setChangeField(field) {
    changeField = CHANGE_FIELDS[field] ? field : 'enrollment';
    if (isChangeMetric(colorMetric)) {
      applyMetricPaint();
      applyVisibility();
      ensureSchoolChangeMetrics();
    } else {
      applySchoolChangePaint();
    }
    refreshOpenDetail();
  }

  // Refresh open detail when From/To years change.
  function refreshOpenDetail() {
    if (selectedDistricts.size || selectedStates.size) {
      presentSelectionDetail(map ? map.getCenter() : null);
      return;
    }
    if (lastSchoolDetail && lastSchoolDetail.props) {
      schoolPopup(lastSchoolDetail.props, lastSchoolDetail.lngLat);
    }
  }

  function setChangeYears(fromYear, toYear, yearOpts) {
    const o = yearOpts || {};
    const from = Number(fromYear);
    const to = Number(toYear);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return;
    // Same year = snapshot (no change). Different years are ordered min→max.
    const next = from === to
      ? { from, to }
      : { from: Math.min(from, to), to: Math.max(from, to) };
    const same = next.from === changeYears.from && next.to === changeYears.to;
    if (!same) {
      changeYears = next;
      // Flythrough / warm paths can keep a prior cache while the year UI flickers.
      if (!o.keepCache) {
        changeKey = null; // force reload
        changeByLeaid = {};
        schoolChangeKey = null;
        Object.keys(schoolChangeById).forEach((k) => { delete schoolChangeById[k]; });
      }
    }
    if (o.skipEnsure) {
      refreshOpenDetail();
      if (opts.onChangeYears) opts.onChangeYears(getChangeYears());
      return;
    }
    if (next.from === next.to) {
      if (isChangeMetric(colorMetric)) {
        lastChangeNote = `Pick different From/To years to show ${changeField} change.`;
        applyMetricPaint();
        applyVisibility();
      } else if (colorMetric) {
        nationwideMetricKey = null;
        ensureNationwideMetrics();
      }
      applySchoolChangePaint();
    } else {
      if (isChangeMetric(colorMetric)) lastChangeNote = null;
      ensureChangeMetrics();
      ensureSchoolChangeMetrics();
    }
    refreshOpenDetail();
    if (opts.onChangeYears) opts.onChangeYears(getChangeYears());
  }

  /** Await district + school change RPCs (used by admin flythrough preload). */
  async function warmChangeCaches() {
    if (changeYears.from == null || changeYears.to == null || changeYears.from === changeYears.to) {
      return { change: false, schools: false };
    }
    await ensureChangeMetrics();
    await ensureSchoolChangeMetrics();
    // ensure* may early-return and schedule a retry while boundaries load.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const changeReady = !!changeKey && !changeLoading;
      const schoolReady = !showSchoolChangeRings() || !!schoolChangeKey;
      if (changeReady && schoolReady) break;
      await new Promise((r) => setTimeout(r, 200));
      if (!changeKey && !changeLoading) await ensureChangeMetrics();
      if (showSchoolChangeRings() && !schoolChangeKey) await ensureSchoolChangeMetrics();
    }
    return { change: !!changeKey, schools: !!schoolChangeKey };
  }

  // Optional: align map From/To with dashboard year checkboxes (explicit UI sync only).
  // Do NOT call this from every render — that overwrote the map controls and left
  // the detail panel on a stale pair (e.g. controls 2021→2024, detail still 2020→2024).
  function syncChangeYearsFromFilters(filters) {
    const years = ((filters && filters.years) || [])
      .map(Number)
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => a - b);
    if (years.length < 2) return false;
    const next = { from: years[0], to: years[years.length - 1] };
    if (next.from === changeYears.from && next.to === changeYears.to) return false;
    setChangeYears(next.from, next.to);
    return true;
  }

  function getChangeYears() {
    return { from: changeYears.from, to: changeYears.to, field: changeField };
  }

  // Back-compat for older callers.
  function setColorByEnrollment(on) {
    setColorMetric(on ? 'enrollment' : null);
  }

  function clearChangeProps(p) {
    [
      'enrollment_from', 'enrollment_to', 'enrollment_delta', 'enrollment_pct',
      'teachers_from', 'teachers_to', 'teachers_delta', 'teachers_pct',
      'staff_from', 'staff_to', 'staff_delta', 'staff_pct',
      'ratio_from', 'ratio_to', 'ratio_delta', 'ratio_pct',
    ].forEach((k) => { p[k] = k.endsWith('_pct') ? null : 0; });
  }

  function rowChangeProps(r) {
    const eFrom = Number(r.enrollment_from) || 0;
    const eTo = Number(r.enrollment_to) || 0;
    const tFrom = Number(r.teachers_from) || 0;
    const tTo = Number(r.teachers_to) || 0;
    return Object.assign({
      enrollment_from: eFrom,
      enrollment_to: eTo,
      enrollment_delta: Number(r.enrollment_delta) || 0,
      enrollment_pct: r.enrollment_pct != null ? Number(r.enrollment_pct) : null,
      teachers_from: tFrom,
      teachers_to: tTo,
      teachers_delta: Number(r.teachers_delta) || 0,
      teachers_pct: r.teachers_pct != null ? Number(r.teachers_pct) : null,
      staff_from: Number(r.staff_from) || 0,
      staff_to: Number(r.staff_to) || 0,
      staff_delta: Number(r.staff_delta) || 0,
      staff_pct: r.staff_pct != null ? Number(r.staff_pct) : null,
    }, ratioChangeProps(eFrom, eTo, tFrom, tTo));
  }

  async function ensureChangeMetrics() {
    if (!client || !map) return;
    const from = changeYears.from;
    const to = changeYears.to;
    if (from == null || to == null || from === to) return;
    // Prefer live UI scope so Change recolors districts as soon as one state is picked.
    const state = colorScopeState() || (lastFilters && lastFilters.state) || null;
    const key = `${from}-${to}-${state || ''}`;
    if (changeLoading) return;
    if (changeKey === key) {
      // Already fetched — but polygons may have been rebuilt since. Re-apply.
      const detailMatched = applyChangePropsToFc(lastDistrictFc);
      if (detailMatched && map.getSource('districts')) {
        setDistrictsSourceData(lastDistrictFc);
      }
      if (isChangeMetric(colorMetric)) {
        applyMetricPaint();
        applyVisibility();
      }
      return;
    }

    // Mesh may still be loading — retry shortly instead of giving up.
    if (!allDistrictsFc.features.length && !allStatesFc.features.length) {
      lastChangeNote = 'Loading boundaries for change choropleth…';
      pushFilteredStatus();
      setMetricLoad({
        active: true,
        title: 'Loading change data',
        label: 'Waiting for map boundaries…',
      });
      setTimeout(() => {
        setMetricLoad({ active: false });
        if (changeYears.from !== changeYears.to) ensureChangeMetrics();
      }, 1500);
      return;
    }

    changeLoading = true;
    const metaPending = changeFieldMeta();
    if (isChangeMetric(colorMetric)) {
      lastChangeNote = `Loading ${metaPending.label} change ${from} → ${to}…`;
      pushFilteredStatus();
    }
    setMetricLoad({
      active: true,
      title: 'Loading change data',
      label: `Retrieving ${metaPending.label.toLowerCase()} change ${from} → ${to}…`,
    });
    try {
      let distRows = [];
      let stateRows = [];
      try {
        [distRows, stateRows] = await Promise.all([
          rpc('nces_map_metric_change', { p_year_from: from, p_year_to: to, p_state: state }),
          rpc('nces_map_state_metric_change', { p_year_from: from, p_year_to: to }),
        ]);
      } catch (e1) {
        // Fallback for DBs that only have the older enrollment-only 007.
        [distRows, stateRows] = await Promise.all([
          rpc('nces_map_enrollment_change', { p_year_from: from, p_year_to: to, p_state: state }),
          rpc('nces_map_state_enrollment_change', { p_year_from: from, p_year_to: to }),
        ]);
      }

      changeByLeaid = {};
      (distRows || []).forEach((r) => {
        const props = rowChangeProps(r);
        leaKeys(r && r.leaid).forEach((k) => { changeByLeaid[k] = props; });
      });

      const meshMatched = applyChangePropsToFc(allDistrictsFc);
      if (map.getSource('districts-all')) map.getSource('districts-all').setData(allDistrictsFc);

      const detailMatched = applyChangePropsToFc(lastDistrictFc);
      if (lastDistrictFc.features.length && map.getSource('districts')) {
        setDistrictsSourceData(lastDistrictFc);
      }
      lastChangeMatched = detailMatched || meshMatched;

      const byState = {};
      (stateRows || []).forEach((r) => { byState[r.state_code] = rowChangeProps(r); });
      allStatesFc.features.forEach((f) => {
        const code = f.properties && (f.properties.stusab || f.properties.STUSAB);
        const s = byState[code];
        if (s) Object.assign(f.properties, s);
        else clearChangeProps(f.properties);
      });
      setStateOutlineData(allStatesFc);

      changeKey = key;
      const n = (distRows || []).length;
      const meta = changeFieldMeta();
      if (isChangeMetric(colorMetric)) {
        if (!n) {
          lastChangeNote = `No ${meta.label.toLowerCase()} data for ${from}→${to}. Sync those years (schoolYears in sync-config), then retry.`;
        } else if (!lastChangeMatched) {
          lastChangeNote = `${meta.label} change ${from}→${to}: ${n.toLocaleString()} district row(s) loaded but none matched the drawn boundaries (LEAID/GEOID mismatch).`;
        } else {
          lastChangeNote = `${meta.label} change ${from}→${to}: ${n.toLocaleString()} district(s) with data. ${meta.worseWhenUp ? 'Red↑ (worse) Green↓ (better)' : 'Red↓ Green↑'}`;
        }
        applyMetricPaint();
      }
      // Refresh Details now that change props are attached.
      if (selectedDistricts.size || selectedStates.size) {
        presentSelectionDetail(map ? map.getCenter() : null);
      }
      ensureSchoolChangeMetrics();
    } catch (e) {
      if (isChangeMetric(colorMetric)) {
        lastChangeNote = 'Change RPCs missing or failed — re-run sql/migrations/007_nces_enrollment_change.sql';
        pushFilteredStatus();
      }
    } finally {
      changeLoading = false;
      setMetricLoad({ active: false });
    }
  }

  // ---- Level + enrollment-range + completeness filters ------------------------
  function rangeExpr(layer) {
    const [lo, hi] = sizeRange[layer];
    const parts = [];
    if (lo != null) parts.push(['>=', ['coalesce', ['get', 'enrollment'], 0], lo]);
    if (hi != null) parts.push(['<=', ['coalesce', ['get', 'enrollment'], 0], hi]);
    return parts;
  }

  function combineFilters(...exprs) {
    const parts = exprs.filter(Boolean);
    if (!parts.length) return null;
    if (parts.length === 1) return parts[0];
    return ['all', ...parts];
  }

  // Expected district count for a state (Census mesh preferred, then NCES summary).
  function expectedDistrictCount(code) {
    const mesh = meshDistrictCount(code);
    if (mesh != null && mesh > 0) return mesh;
    const s = stateSummaryByCode[code];
    if (s && s.districts > 0) return Number(s.districts) || 0;
    return 0;
  }

  // Classify a state's download status from real sync stats.
  //   'complete' = fully discovered AND every district covers configured years
  //   'partial'  = some sync progress (touched or year-incomplete)
  //   'none'     = nothing synced yet
  //
  // years_complete matches sync --incomplete-only: last_synced +
  // sync_school_years covers configured years (not every CCD directory row;
  // many LEAs never existed in older years).
  function stateStatus(code) {
    const c = stateCompleteness[code];
    const synced = c ? Number(c.synced) || 0 : 0;
    const total = c ? Number(c.total) || 0 : 0;
    const yearsComplete = c && c.years_complete != null
      ? Number(c.years_complete) || 0
      : synced;
    if (synced <= 0) return 'none';

    const expected = expectedDistrictCount(code);
    // Require discovery coverage ~70% of expected districts (min 10) before
    // a state can be called complete. CO/VA-sized states pass; single-LEA does not.
    const discoverFloor = expected > 0
      ? Math.max(10, Math.floor(expected * 0.7))
      : 10;
    const fullyDiscovered = total >= discoverFloor;
    const allYears = total > 0 && yearsComplete >= total;

    if (allYears && fullyDiscovered) return 'complete';
    return 'partial';
  }

  // State codes matching the active filter mode.
  function statesMatchingMode() {
    const codes = Object.keys(STATE_FIPS);
    if (stateFilterMode === 'both') return null;
    return codes.filter((code) => stateStatus(code) === stateFilterMode);
  }

  // Completeness filter for state layers (keyed on the `stusab` property).
  function stateModeExprByCode() {
    const codes = statesMatchingMode();
    if (!codes) return null;
    return ['in', ['get', 'stusab'], ['literal', codes]];
  }

  // Completeness filter for the nationwide district mesh (keyed on GEOID/leaid prefix = FIPS).
  function stateModeExprByFips() {
    const codes = statesMatchingMode();
    if (!codes) return null;
    const fips = codes.map((c) => STATE_FIPS[c]).filter(Boolean);
    return ['in', ['slice', ['coalesce', ['get', 'leaid'], ['get', 'GEOID'], ''], 0, 2], ['literal', fips]];
  }

  function requiredSchoolYears() {
    const cfg = (global.NCES_CONFIG && global.NCES_CONFIG.schoolYears) || [2021, 2022, 2023];
    return [...new Set(cfg.map(Number))].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  }

  // Fetch per-state synced/total/years_complete once (cheap grouped aggregate).
  async function ensureStateCompleteness() {
    if (!client || completenessLoaded || completenessLoading) return;
    completenessLoading = true;
    const years = requiredSchoolYears();
    try {
      let rows;
      try {
        rows = await rpc('nces_state_completeness', { p_years: years });
      } catch (_) {
        // Pre-010 signature (no p_years) — synced only; never treat as year-complete.
        rows = await rpc('nces_state_completeness', {});
        rows = (rows || []).map((r) => Object.assign({}, r, { years_complete: 0 }));
      }
      const map0 = {};
      (rows || []).forEach((r) => {
        map0[r.state_code] = {
          total: Number(r.total) || 0,
          synced: Number(r.synced) || 0,
          years_complete: r.years_complete != null ? Number(r.years_complete) || 0 : 0,
        };
      });
      stateCompleteness = map0;
      completenessLoaded = true;
      applyFilters();
      if (opts.onCompleteness) opts.onCompleteness(completenessSummary());
    } catch (_) {
      // RPC missing — NEVER mark states Complete.
      const fallback = {};
      Object.keys(stateSummaryByCode).forEach((code) => {
        const v = stateSummaryByCode[code];
        const has = v && ((Number(v.schools) || 0) > 0 || (Number(v.enrollment) || 0) > 0);
        fallback[code] = { total: 0, synced: has ? 1 : 0, years_complete: 0 };
      });
      stateCompleteness = fallback;
      completenessLoaded = true;
      applyFilters();
      if (opts.onCompleteness) {
        opts.onCompleteness({
          ...completenessSummary(),
          setupNeeded: true,
        });
      }
    } finally {
      completenessLoading = false;
    }
  }

  function completenessSummary() {
    const counts = { complete: 0, partial: 0, none: 0 };
    Object.keys(STATE_FIPS).forEach((code) => {
      counts[stateStatus(code)] += 1;
    });
    return counts;
  }

  function enrollmentInRange(value, layer) {
    const [lo, hi] = sizeRange[layer] || [null, null];
    const v = Number(value) || 0;
    if (lo != null && v < lo) return false;
    if (hi != null && v > hi) return false;
    return true;
  }

  function matchingStateCodes() {
    if (stateFilterMode === 'both') return Object.keys(STATE_FIPS);
    return Object.keys(STATE_FIPS).filter((code) => stateStatus(code) === stateFilterMode);
  }

  // NCES LEA count for a state: prefer sync discover total when size filter is
  // wide open; otherwise enrollment-filter the loaded district directory rows.
  function ncesDistrictCountForState(code, filters) {
    const [lo, hi] = sizeRange.districts || [null, null];
    const sizeActive = lo != null || hi != null;
    const rows = (lastData.districts || []).filter((r) =>
      enrollmentInRange(r.enrollment, 'districts'));
    if (filters.leaid) {
      const row = (lastData.districts || []).find((d) => d.leaid === filters.leaid);
      if (row) return enrollmentInRange(row.enrollment, 'districts') ? 1 : 0;
      return 1; // selected from dropdown even if not in map RPC rows
    }
    if (sizeActive && rows.length) return rows.length;
    const c = stateCompleteness[code];
    const discovered = c ? Number(c.total) || 0 : 0;
    const summary = stateSummaryByCode[code];
    const fromSummary = summary ? Number(summary.districts) || 0 : 0;
    return Math.max(rows.length, discovered, fromSummary);
  }

  // Bottom status counts for whatever Completeness / size / school filters are active.
  // districtsMapped = EDGE/Census outline polygons; districtsNces = CCD/sync LEAs.
  function computeFilteredStatus(extra) {
    const filters = lastFilters || {};
    const modeCodes = new Set(matchingStateCodes());
    const fipsAllowed = new Set([...modeCodes].map((c) => STATE_FIPS[c]).filter(Boolean));
    const notes = [];
    let states = 0;
    let districtsMapped = 0;
    let districtsNces = 0;
    let schools = 0;

    const MODE_LABEL = { complete: 'complete', partial: 'partial', none: 'none' };

    if (filters.state) {
      const code = filters.state;
      const summary = stateSummaryByCode[code] || {};
      const stateOk = modeCodes.has(code)
        && enrollmentInRange(summary.enrollment || 0, 'states');
      states = stateOk ? 1 : 0;

      if (filters.leaid) {
        const row = (lastData.districts || []).find((d) => d.leaid === filters.leaid);
        const feat = (lastDistrictFc.features || []).find((f) => f.properties && f.properties.leaid === filters.leaid);
        const enroll = row
          ? Number(row.enrollment) || 0
          : (feat ? Number(feat.properties.enrollment) || 0 : 0);
        const pass = stateOk && enrollmentInRange(enroll, 'districts');
        districtsMapped = (pass && feat) ? 1 : 0;
        districtsNces = pass ? 1 : 0;
      } else {
        districtsMapped = (lastDistrictFc.features || []).filter((f) => {
          const p = f.properties || {};
          return enrollmentInRange(p.enrollment, 'districts');
        }).length;
        districtsNces = ncesDistrictCountForState(code, filters);
        if (!stateOk) {
          districtsMapped = 0;
          districtsNces = 0;
        }
      }

      schools = (lastData.schools || []).filter((r) => {
        if (!stateOk) return false;
        if (filters.school && String(r.ncessch) !== String(filters.school)) return false;
        const level = Number(r.school_level) || 4;
        if (!filters.school && !schoolLevels.has(level)) return false;
        if (!filters.school && !enrollmentInRange(r.enrollment, 'schools')) return false;
        return true;
      }).length;

      if (!stateOk && stateFilterMode !== 'both') {
        notes.push(`Selected state is not “${MODE_LABEL[stateFilterMode] || stateFilterMode}”.`);
      }
    } else {
      const stateCodes = allStatesFc.features.length
        ? allStatesFc.features
          .map((f) => f.properties && (f.properties.stusab || f.properties.STUSAB))
          .filter(Boolean)
        : Object.keys(STATE_FIPS);

      states = stateCodes.filter((code) => {
        if (!modeCodes.has(code)) return false;
        const enroll = (stateSummaryByCode[code] && stateSummaryByCode[code].enrollment) || 0;
        return enrollmentInRange(enroll, 'states');
      }).length;

      districtsMapped = (allDistrictsFc.features || []).filter((f) => {
        const p = f.properties || {};
        const gid = p.leaid || p.GEOID || '';
        if (stateFilterMode !== 'both' && !fipsAllowed.has(gid.slice(0, 2))) return false;
        return enrollmentInRange(p.enrollment, 'districts');
      }).length;

      // Nationwide NCES = discovered sync totals for visible states (directory summary as fallback).
      modeCodes.forEach((code) => {
        const summary = stateSummaryByCode[code];
        if (summary && !enrollmentInRange(summary.enrollment || 0, 'states')) return;
        const c = stateCompleteness[code];
        const discovered = c ? Number(c.total) || 0 : 0;
        const fromSummary = summary ? Number(summary.districts) || 0 : 0;
        districtsNces += Math.max(discovered, fromSummary);
      });

      // Nationwide schools come from NCES state summaries (only synced states have rows).
      Object.keys(stateSummaryByCode).forEach((code) => {
        if (!modeCodes.has(code)) return;
        const s = stateSummaryByCode[code];
        if (!enrollmentInRange(s.enrollment || 0, 'states')) return;
        schools += Number(s.schools) || 0;
      });

      if (stateFilterMode !== 'both') {
        notes.push(`Showing ${MODE_LABEL[stateFilterMode] || stateFilterMode} states only.`);
      }

      // Synced district totals from discover completeness (available without picking a state).
      let districtsSynced = 0;
      let districtsTotal = 0;
      modeCodes.forEach((code) => {
        const c = stateCompleteness[code];
        if (!c) return;
        districtsSynced += Number(c.synced) || 0;
        districtsTotal += Number(c.total) || 0;
      });
      if (districtsTotal > 0) {
        notes.push(`${districtsSynced.toLocaleString()}/${districtsTotal.toLocaleString()} districts synced`);
      }
    }

    if (isChangeMetric(colorMetric) && lastChangeNote) notes.push(lastChangeNote);

    return {
      states,
      districts: districtsMapped,
      districtsMapped,
      districtsNces,
      schools,
      notes,
      setupNeeded: !!(extra && extra.setupNeeded),
    };
  }

  function pushFilteredStatus(extra) {
    if (!opts.onStatus) return;
    opts.onStatus(computeFilteredStatus(extra));
  }

  function applyFilters() {
    if (!map) return;
    const setF = (id, filter) => { if (map.getLayer(id)) map.setFilter(id, filter); };
    const modeCode = stateModeExprByCode();
    const modeFips = stateModeExprByFips();
    const metricActive = colorMetric ? metricFilterExpr(colorMetric) : null;
    const sRange = rangeExpr('states');
    const dRange = rangeExpr('districts');

    // States: enrollment range + completeness on every state representation.
    setF('states-labels', combineFilters(...sRange, modeCode));
    setF('state-fill-hit', combineFilters(...sRange, modeCode));
    setF('state-outline-line', combineFilters(...sRange, modeCode));
    // Do NOT require metric > 0 here — that blanked the choropleth while switching
    // Color-by (props briefly missing / not yet merged onto state-outline).
    setF('states-choropleth-fill', combineFilters(...sRange, modeCode));

    // Detailed districts for the selected state: enrollment range only.
    // Do NOT hide fills when a metric is missing — paint still runs (0 / no-data
    // colors). Hiding was the regression that left only outlines.
    const dFilter = combineFilters(...dRange);
    setF('districts-fill', dFilter);
    setF('districts-line', dFilter);
    setF('districts-hit', dFilter);
    // Names only when zoom is high enough for the label to fit the district shape.
    setF('districts-labels', combineFilters(
      dFilter,
      ['<=', ['coalesce', ['get', 'label_min_zoom'], 99], ['zoom']]
    ));

    // Nationwide district mesh: outlines only (Color-by uses detailed fills).
    // When a state is selected but detailed polygons are not ready yet, keep the
    // coarse mesh and clip it to that state's FIPS so the map is never blank.
    const scopeFips = lastFilters && lastFilters.state && STATE_FIPS[lastFilters.state]
      ? ['==',
        ['slice', ['coalesce', ['get', 'leaid'], ['get', 'GEOID'], ''], 0, 2],
        STATE_FIPS[lastFilters.state]]
      : null;
    const meshFilter = combineFilters(...dRange, modeFips, scopeFips);
    setF('districts-all-line', meshFilter);
    setF('districts-all-hit', meshFilter);
    // Nationwide choropleth: same scope as the mesh, plus "has data for this metric".
    setF('districts-all-fill', combineFilters(metricActive, ...dRange, modeFips, scopeFips));

    // Schools: level set + enrollment range (+ optional planning region).
    // Selected school always stays visible even if level/size filters would hide it.
    // Other schools stay on the map but are dimmed via paint (not removed).
    ['schools-rings', 'schools-circles', 'schools-dots', 'schools-labels'].forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      const levels = [...schoolLevels].map(Number);
      const regionFilter = activeRegionCode
        ? ['==', ['to-number', ['get', 'region_code']], Number(activeRegionCode)]
        : null;
      const schoolId = selectedSchoolId();
      // Directory rows often have enrollment=0 until the metric RPC finishes.
      // Only apply the size slider when the user has narrowed it from full range.
      const [lo, hi] = sizeRange.schools || [null, null];
      const sizeParts = [];
      if (lo != null) {
        sizeParts.push(['>=', ['coalesce', ['to-number', ['get', 'enrollment']], 0], lo]);
      }
      if (hi != null) {
        sizeParts.push(['<=', ['coalesce', ['to-number', ['get', 'enrollment']], 0], hi]);
      }
      const baseSchool = combineFilters(
        ['in', ['coalesce', ['get', 'school_level'], 4], ['literal', levels.length ? levels : [1, 2, 3, 4]]],
        ...sizeParts,
        regionFilter
      );
      if (schoolId && baseSchool) {
        setF(layerId, [
          'any',
          ['==', ['to-string', ['get', 'ncessch']], schoolId],
          baseSchool,
        ]);
      } else if (schoolId) {
        setF(layerId, null);
      } else {
        setF(layerId, baseSchool);
      }
    });
    if (map.getLayer('schools-circles')) applySchoolChangePaint();
    if (map.getLayer('schools-dots')) applySchoolDotPaint();

    // Highlight selected region polygon.
    if (map.getLayer('district-regions-fill')) {
      if (activeRegionCode) {
        setF('district-regions-fill', ['==', ['get', 'region_code'], Number(activeRegionCode)]);
        setF('district-regions-line', ['==', ['get', 'region_code'], Number(activeRegionCode)]);
        setF('district-regions-label', ['==', ['get', 'region_code'], Number(activeRegionCode)]);
        map.setPaintProperty('district-regions-fill', 'fill-opacity', 0.4);
      } else {
        setF('district-regions-fill', null);
        setF('district-regions-line', null);
        setF('district-regions-label', null);
        map.setPaintProperty('district-regions-fill', 'fill-opacity', 0.28);
      }
    }

    pushFilteredStatus();
  }

  function openRing(ring) {
    if (!ring || !ring.length) return [];
    const out = ring.map((p) => [Number(p[0]), Number(p[1])]);
    if (out.length > 1) {
      const a = out[0];
      const b = out[out.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) out.pop();
    }
    return out;
  }

  function closeRing(ring) {
    const open = openRing(ring);
    if (!open.length) return [];
    return open.concat([[open[0][0], open[0][1]]]);
  }

  /** Exterior ring(s) for Polygon or MultiPolygon region records. */
  function regionExteriorParts(r) {
    if (!r || !r.coordinates) return [];
    if (r.geometryType === 'MultiPolygon') {
      return (r.coordinates || [])
        .map((poly, part) => ({ part, ring: (poly && poly[0]) || [] }))
        .filter((x) => x.ring.length);
    }
    const ring = (r.coordinates && r.coordinates[0]) || [];
    return ring.length ? [{ part: 0, ring }] : [];
  }

  function writeRegionExterior(r, part, closedRing) {
    if (!r) return;
    if (r.geometryType === 'MultiPolygon') {
      const poly = r.coordinates[part];
      if (!poly) return;
      r.coordinates[part] = [closedRing].concat(poly.slice(1));
      return;
    }
    r.coordinates = [closedRing].concat((r.coordinates || []).slice(1));
  }

  function regionEditHandlesFc() {
    const verts = [];
    const mids = [];
    if (!global.MCPS_REGIONS || !regionEditActive) {
      return { verts: emptyFc(), mids: emptyFc() };
    }
    global.MCPS_REGIONS.REGIONS.forEach((r) => {
      if (regionEditFocus && Number(r.code) !== Number(regionEditFocus)) return;
      regionExteriorParts(r).forEach(({ part, ring }) => {
        const open = openRing(ring);
        open.forEach((pt, vi) => {
          verts.push({
            type: 'Feature',
            properties: { region_code: r.code, part, vi, kind: 'vertex' },
            geometry: { type: 'Point', coordinates: pt },
          });
          const next = open[(vi + 1) % open.length];
          mids.push({
            type: 'Feature',
            properties: { region_code: r.code, part, after_vi: vi, kind: 'mid' },
            geometry: {
              type: 'Point',
              coordinates: [(pt[0] + next[0]) / 2, (pt[1] + next[1]) / 2],
            },
          });
        });
      });
    });
    return {
      verts: { type: 'FeatureCollection', features: verts },
      mids: { type: 'FeatureCollection', features: mids },
    };
  }

  function refreshRegionEditHandles() {
    if (!map || !map.getSource('region-edit-verts')) return;
    const { verts, mids } = regionEditHandlesFc();
    map.getSource('region-edit-verts').setData(verts);
    map.getSource('region-edit-mids').setData(mids);
  }

  function refreshDistrictRegionsSource() {
    if (!map || !map.getSource('district-regions')) return;
    const show = !!(activeRegionLeaid && global.MCPS_REGIONS
      && global.MCPS_REGIONS.districtHasRegions(activeRegionLeaid));
    const fc = show ? global.MCPS_REGIONS.toFeatureCollection() : emptyFc();
    map.getSource('district-regions').setData(fc);
    const fillVis = show && regionLayersVisible ? 'visible' : 'none';
    ['district-regions-fill', 'district-regions-line', 'district-regions-label'].forEach((id) => {
      if (!map.getLayer(id)) return;
      const hideLabel = regionEditActive && id === 'district-regions-label';
      map.setLayoutProperty(id, 'visibility', hideLabel ? 'none' : fillVis);
    });
    if (map.getLayer('district-regions-fill')) {
      map.setPaintProperty('district-regions-fill', 'fill-opacity', regionEditActive ? 0.22 : 0.28);
    }
    if (map.getLayer('district-regions-line')) {
      map.setPaintProperty('district-regions-line', 'line-width', regionEditActive ? 2.2 : 1.5);
    }
  }

  function syncEditedRegionsToLive(opts) {
    const restampSchools = !opts || opts.restampSchools !== false;
    refreshDistrictRegionsSource();
    refreshRegionEditHandles();
    if (restampSchools && map && map.getSource('schools') && lastData.schools && lastData.schools.length) {
      map.getSource('schools').setData(schoolsToFc(lastData.schools));
      applyFilters();
    }
    if (typeof global.NcesMap._onRegionEditChange === 'function' && global.MCPS_REGIONS) {
      global.NcesMap._onRegionEditChange(global.MCPS_REGIONS.exportCoordinatesText());
    }
  }

  function setRegionEditVertex(regionCode, vi, lng, lat, part) {
    const r = global.MCPS_REGIONS && global.MCPS_REGIONS.REGIONS
      .find((x) => x.code === Number(regionCode));
    if (!r) return;
    const partIdx = Number(part) || 0;
    const parts = regionExteriorParts(r);
    const entry = parts.find((p) => p.part === partIdx) || parts[0];
    if (!entry) return;
    const open = openRing(entry.ring);
    if (vi < 0 || vi >= open.length) return;
    open[vi] = [Number(lng), Number(lat)];
    writeRegionExterior(r, entry.part, closeRing(open));
    // During drag, skip school restamp (done on mouseup).
    syncEditedRegionsToLive({ restampSchools: !regionEditDrag });
  }

  function insertRegionEditVertex(regionCode, afterVi, lng, lat, part) {
    const r = global.MCPS_REGIONS && global.MCPS_REGIONS.REGIONS
      .find((x) => x.code === Number(regionCode));
    if (!r) return;
    const partIdx = Number(part) || 0;
    const parts = regionExteriorParts(r);
    const entry = parts.find((p) => p.part === partIdx) || parts[0];
    if (!entry) return;
    const open = openRing(entry.ring);
    const idx = Number(afterVi) + 1;
    open.splice(idx, 0, [Number(lng), Number(lat)]);
    writeRegionExterior(r, entry.part, closeRing(open));
    syncEditedRegionsToLive();
  }

  function bindRegionEditHandlers() {
    if (!map || map.__regionEditBound) return;
    map.__regionEditBound = true;

    map.on('mousedown', 'region-edit-verts', (e) => {
      if (!regionEditActive || !e.features || !e.features.length) return;
      e.preventDefault();
      const p = e.features[0].properties;
      regionEditDrag = {
        regionCode: Number(p.region_code),
        vi: Number(p.vi),
        part: Number(p.part) || 0,
      };
      map.dragPan.disable();
      map.getCanvas().style.cursor = 'grabbing';
      const el = map.getContainer();
      if (el) el.classList.add('is-region-vertex-drag');
    });

    map.on('click', 'region-edit-mids', (e) => {
      if (!regionEditActive || !e.features || !e.features.length) return;
      e.preventDefault();
      const p = e.features[0].properties;
      const c = e.features[0].geometry.coordinates;
      insertRegionEditVertex(p.region_code, p.after_vi, c[0], c[1], p.part);
    });

    map.on('mousemove', (e) => {
      if (!regionEditDrag) return;
      setRegionEditVertex(
        regionEditDrag.regionCode,
        regionEditDrag.vi,
        e.lngLat.lng,
        e.lngLat.lat,
        regionEditDrag.part,
      );
    });

    const endDrag = () => {
      if (!regionEditDrag) return;
      regionEditDrag = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = '';
      const el = map.getContainer();
      if (el) el.classList.remove('is-region-vertex-drag');
      syncEditedRegionsToLive({ restampSchools: true });
    };
    map.on('mouseup', endDrag);
    map.on('mouseleave', endDrag);

    ['region-edit-verts', 'region-edit-mids'].forEach((id) => {
      map.on('mouseenter', id, () => {
        if (regionEditActive) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', id, () => {
        if (regionEditActive && !regionEditDrag) map.getCanvas().style.cursor = '';
      });
    });

    window.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && regionEditActive) setRegionEditing(false);
      if (ev.key === 'Escape' && hsAssignMode) setHsAssignMode(false);
    });
  }

  function setRegionEditing(on) {
    regionEditActive = !!on;
    if (!map) return;
    bindRegionEditHandlers();
    const el = map.getContainer();
    if (el) el.classList.toggle('is-region-editing', regionEditActive);
    ['region-edit-verts', 'region-edit-mids'].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', regionEditActive ? 'visible' : 'none');
      }
    });
    if (regionEditActive) {
      refreshRegionEditHandles();
      syncEditedRegionsToLive();
    } else {
      regionEditDrag = null;
      map.dragPan.enable();
      if (map.getSource('region-edit-verts')) {
        map.getSource('region-edit-verts').setData(emptyFc());
        map.getSource('region-edit-mids').setData(emptyFc());
      }
      refreshDistrictRegionsSource();
      applyFilters();
    }
    if (typeof global.NcesMap._onRegionEditMode === 'function') {
      global.NcesMap._onRegionEditMode(regionEditActive);
    }
  }

  function setRegionEditFocus(code) {
    regionEditFocus = code ? Number(code) : null;
    refreshRegionEditHandles();
  }

  function setRegionLayersVisible(visible) {
    regionLayersVisible = !!visible;
    refreshDistrictRegionsSource();
  }

  function hsAreasFc() {
    if (!global.MCPS_HS_AREAS) return emptyFc();
    const fc = global.MCPS_HS_AREAS.toFeatureCollection();
    fc.features = (fc.features || []).map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        selected: selectedHsName && f.properties.hs_name === selectedHsName ? 1 : 0,
      },
    }));
    return fc;
  }

  function refreshHsAreasSource() {
    if (!map || !map.getSource('hs-areas')) return;
    const show = !!(activeRegionLeaid && global.MCPS_HS_AREAS
      && global.MCPS_REGIONS
      && global.MCPS_REGIONS.districtHasRegions(activeRegionLeaid)
      && hsAreasVisible);
    map.getSource('hs-areas').setData(show ? hsAreasFc() : emptyFc());
    const vis = show ? 'visible' : 'none';
    ['hs-areas-fill', 'hs-areas-line', 'hs-areas-label'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function notifyHsAssignChange() {
    if (typeof global.NcesMap._onHsAssignChange === 'function') {
      global.NcesMap._onHsAssignChange({
        selected: selectedHsName,
        assignments: global.MCPS_HS_AREAS ? global.MCPS_HS_AREAS.getAssignments() : [],
        assignMode: hsAssignMode,
        visible: hsAreasVisible,
      });
    }
  }

  function rebuildRegionsFromHsAssignments() {
    if (!global.MCPS_HS_AREAS || !global.MCPS_REGIONS) return;
    global.MCPS_HS_AREAS.applyToRegions(global.MCPS_REGIONS);
    refreshDistrictRegionsSource();
    refreshHsAreasSource();
    if (map && map.getSource('schools') && lastData.schools && lastData.schools.length) {
      map.getSource('schools').setData(schoolsToFc(lastData.schools));
      applyFilters();
    }
    notifyHsAssignChange();
  }

  function setHsAreasVisible(visible) {
    hsAreasVisible = !!visible;
    if (!hsAreasVisible && hsAssignMode) setHsAssignMode(false);
    refreshHsAreasSource();
    notifyHsAssignChange();
  }

  function setHsAssignMode(on) {
    hsAssignMode = !!on;
    if (hsAssignMode) {
      if (regionEditActive) setRegionEditing(false);
      if (!hsAreasVisible) {
        hsAreasVisible = true;
        refreshHsAreasSource();
      }
    } else {
      selectedHsName = null;
      refreshHsAreasSource();
    }
    if (map) {
      const el = map.getContainer();
      if (el) el.classList.toggle('is-hs-assigning', hsAssignMode);
    }
    notifyHsAssignChange();
  }

  function selectHsArea(hsName) {
    selectedHsName = hsName || null;
    refreshHsAreasSource();
    notifyHsAssignChange();
  }

  function assignSelectedHsRegion(regionCode) {
    if (!selectedHsName || !global.MCPS_HS_AREAS) return false;
    const ok = global.MCPS_HS_AREAS.setHsRegion(selectedHsName, regionCode);
    if (ok) rebuildRegionsFromHsAssignments();
    return ok;
  }

  function assignHsRegion(hsName, regionCode) {
    if (!global.MCPS_HS_AREAS) return false;
    const ok = global.MCPS_HS_AREAS.setHsRegion(hsName, regionCode);
    if (ok) {
      selectedHsName = hsName;
      rebuildRegionsFromHsAssignments();
    }
    return ok;
  }

  function getRegionCoordinatesText() {
    return global.MCPS_REGIONS ? global.MCPS_REGIONS.exportCoordinatesText() : '';
  }

  function resetRegionCoordinates() {
    if (!global.MCPS_REGIONS) return;
    global.MCPS_REGIONS.resetCoordinates();
    selectedHsName = null;
    rebuildRegionsFromHsAssignments();
    syncEditedRegionsToLive();
  }

  function setDistrictRegions(leaid, regionCode) {
    activeRegionLeaid = leaid || null;
    activeRegionCode = regionCode ? Number(regionCode) : null;
    if (!map || !map.getSource('district-regions')) {
      applyFilters();
      return;
    }
    const show = !!(leaid && global.MCPS_REGIONS && global.MCPS_REGIONS.districtHasRegions(leaid));
    if (!show && regionEditActive) setRegionEditing(false);
    if (!show && hsAssignMode) setHsAssignMode(false);
    if (!show) {
      hsAreasVisible = false;
    }
    refreshDistrictRegionsSource();
    refreshHsAreasSource();
    applyFilters();
    if (typeof global.NcesMap._onRegionsAvailable === 'function') {
      global.NcesMap._onRegionsAvailable(show);
    }
  }

  function setStateFilterMode(mode) {
    stateFilterMode = ['both', 'complete', 'partial', 'none'].includes(mode) ? mode : 'both';
    ensureStateCompleteness();
    applyFilters();
  }

  /** Update detail-panel Schools KPI to match level / size filters (no full re-render). */
  function syncDetailSchoolCount() {
    if (!detailBody) return;
    let el = detailBody.querySelector('[data-kpi="schools"]');
    if (!el) {
      detailBody.querySelectorAll('.map-kpi-grid div').forEach((div) => {
        const label = div.querySelector('span');
        if (label && /^Schools$/i.test((label.textContent || '').trim())) {
          el = div.querySelector('b');
        }
      });
    }
    if (!el) return;
    const s = selectionSummary();
    el.textContent = s.schools != null ? num(s.schools) : 'n/a';
  }

  function setSchoolLevels(levels) {
    schoolLevels.clear();
    (levels || []).forEach((l) => schoolLevels.add(Number(l)));
    applyFilters();
    pushFilteredStatus();
    syncDetailSchoolCount();
  }

  function setSizeRange(layer, lo, hi) {
    if (!sizeRange[layer]) return;
    sizeRange[layer] = [lo == null ? null : Number(lo), hi == null ? null : Number(hi)];
    // Filtering the nationwide district mesh by enrollment needs the mesh values.
    if (layer === 'districts' && lo != null && !(lastFilters && lastFilters.state)) {
      ensureNationwideMetrics();
    }
    applyFilters();
    pushFilteredStatus();
    if (layer === 'schools') syncDetailSchoolCount();
  }

  function setSelectedDistrict(leaid) {
    if (map && map.getLayer('districts-line-selected')) {
      const id = leaid ? padLeaid(leaid) : '__none__';
      map.setFilter('districts-line-selected', ['==', ['get', 'leaid'], id || '__none__']);
    }
  }

  function setSelectedState(code) {
    if (map && map.getLayer('state-outline-selected')) {
      map.setFilter('state-outline-selected', ['==', ['get', 'stusab'], code || '__none__']);
    }
  }

  function statesToFc(rows) {
    return {
      type: 'FeatureCollection',
      features: (rows || [])
        .filter((r) => STATE_CENTROIDS[r.state_code])
        .map((r) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: STATE_CENTROIDS[r.state_code] },
          properties: {
            state_code: r.state_code,
            enrollment: Number(r.enrollment) || 0,
            enroll_label: compactNum(r.enrollment),
            districts: Number(r.districts) || 0,
            schools: Number(r.schools) || 0,
            teachers_fte: Number(r.teachers_fte) || 0,
            staff_fte: Number(r.staff_fte) || 0,
            stu_teacher: stuTeacher(r.enrollment, r.teachers_fte) || 0,
          },
        })),
    };
  }

  function schoolsToFc(rows) {
    return {
      type: 'FeatureCollection',
      features: (rows || [])
        .filter((r) => {
          const lng = Number(r.longitude);
          const lat = Number(r.latitude);
          return Number.isFinite(lng) && Number.isFinite(lat);
        })
        .map((r) => {
          const lng = Number(r.longitude);
          const lat = Number(r.latitude);
          const ch = schoolChangeById[r.ncessch];
          const props = {
            ncessch: String(r.ncessch),
            school_name: r.school_name || '',
            school_level: Number(r.school_level) || 4,
            charter: Number(r.charter) || 0,
            grades: gradeRange(r.lowest_grade, r.highest_grade),
            enrollment: Number(r.enrollment) || 0,
            teachers_fte: r.teachers_fte != null ? Number(r.teachers_fte) : null,
            stu_teacher: stuTeacher(r.enrollment, r.teachers_fte),
            region_code: (global.MCPS_REGIONS
              ? global.MCPS_REGIONS.regionForPoint(lng, lat)
              : null),
          };
          // Only attach change fields when present so rings stay white without data.
          if (ch) {
            props.enrollment_from = ch.enrollment_from || 0;
            props.enrollment_to = ch.enrollment_to || 0;
            props.enrollment_delta = Number(ch.enrollment_delta) || 0;
            props.enrollment_pct = ch.enrollment_pct != null ? ch.enrollment_pct : null;
            props.teachers_from = ch.teachers_from || 0;
            props.teachers_to = ch.teachers_to || 0;
            props.teachers_delta = Number(ch.teachers_delta) || 0;
            props.teachers_pct = ch.teachers_pct != null ? ch.teachers_pct : null;
            const ratio = ratioChangeProps(
              props.enrollment_from,
              props.enrollment_to,
              props.teachers_from,
              props.teachers_to
            );
            Object.assign(props, ratio);
            props._change_from = ch._from != null ? ch._from : changeYears.from;
            props._change_to = ch._to != null ? ch._to : changeYears.to;
          }
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: props,
          };
        }),
    };
  }

  function schoolChangeColorExpr() {
    const meta = changeFieldMeta();
    return changePctFillExpr(meta.pct || 'enrollment_pct', !!meta.worseWhenUp);
  }

  function selectedSchoolId() {
    const id = lastFilters && lastFilters.school;
    return id ? String(id) : '';
  }

  function schoolOpacityExpr() {
    const id = selectedSchoolId();
    if (!id) return 0.92;
    return [
      'case',
      ['==', ['to-string', ['get', 'ncessch']], id],
      0.98,
      0.55,
    ];
  }

  function showSchoolChangeRings() {
    return changeYears.from != null
      && changeYears.to != null
      && changeYears.from !== changeYears.to
      && changeField !== 'staff';
  }

  function schoolEnrollmentColorExpr() {
    // Sequential blue scale by enrollment (landing / enrollment fill mode).
    return [
      'interpolate', ['linear'], ['coalesce', ['get', 'enrollment'], 0],
      0, '#bfdbfe',
      150, '#93c5fd',
      400, '#60a5fa',
      800, '#3b82f6',
      1500, '#2563eb',
      2500, '#1d4ed8',
      4000, '#1e3a8a',
    ];
  }

  function schoolRadiusExpr() {
    const id = selectedSchoolId();
    // Outer zoom interpolate; inner enrollment interpolate — valid Mapbox (zoom is top-level input).
    const ring = (small, large) => [
      'interpolate', ['linear'],
      ['sqrt', ['max', ['coalesce', ['get', 'enrollment'], 0], 0]],
      0, small,
      20, (small + large) * 0.55,
      50, large,
    ];
    const boost = id ? 1.25 : 1;
    return [
      'interpolate', ['linear'], ['zoom'],
      3, ring(1.2 * boost, 3.5 * boost),
      6, ring(2 * boost, 6 * boost),
      9, ring(3 * boost, 10 * boost),
      12, ring(4.5 * boost, 14 * boost),
      15, ring(6 * boost, 18 * boost),
    ];
  }

  /**
   * Shape always = circle. Color = type | enrollment | change.
   * Size always = enrollment (via icon-size).
   * Outer rim = larger schools-rings circle (school type) when enabled + metric fill.
   * Avoid icon-halo — it clips to the square SDF texture and looks like a box.
   */
  function applySchoolDotPaint() {
    applySchoolSymbolPaint();
  }

  function applySchoolSymbolPaint() {
    if (!map || !map.getLayer('schools-circles')) return;
    const changeOn = showSchoolChangeRings();
    const fillChange = changeOn && schoolMarkerMode === 'change';
    const fillEnroll = schoolMarkerMode === 'enrollment';
    const levelColor = schoolLevelColorExpr();
    const changeColor = schoolChangeColorExpr();
    const enrollColor = schoolEnrollmentColorExpr();
    const fill = fillChange ? changeColor : (fillEnroll ? enrollColor : levelColor);
    const opacity = schoolOpacityExpr();
    try {
      map.setLayoutProperty('schools-circles', 'icon-size', schoolIconSizeExpr());
      map.setPaintProperty('schools-circles', 'icon-color', fill);
      map.setPaintProperty('schools-circles', 'icon-opacity', opacity);
      map.setPaintProperty('schools-circles', 'icon-halo-width', 0);

      if (map.getLayer('schools-rings')) {
        map.setLayoutProperty('schools-rings', 'icon-size', schoolIconSizeExpr(1.38));
        map.setPaintProperty('schools-rings', 'icon-color', levelColor);
        map.setPaintProperty('schools-rings', 'icon-opacity', opacity);
        map.setPaintProperty('schools-rings', 'icon-halo-width', 0);
        map.setLayoutProperty(
          'schools-rings',
          'visibility',
          schoolTypeRingVisible() ? 'visible' : 'none'
        );
      }
    } catch (err) {
      console.warn('schools-circles paint failed', err);
    }
  }

  function applySchoolChangePaint() {
    applySchoolSymbolPaint();
    applySchoolLayerVisibility();
  }

  function setSchoolMarkerMode(mode) {
    if (mode === 'change') schoolMarkerMode = 'change';
    else if (mode === 'enrollment') schoolMarkerMode = 'enrollment';
    else schoolMarkerMode = 'type';
    applySchoolChangePaint();
    if (schoolMarkerMode === 'change' || showSchoolChangeRings()) {
      ensureSchoolChangeMetrics();
    }
  }

  function setSchoolTypeRing(on) {
    schoolTypeRing = !!on;
    applySchoolChangePaint();
  }

  function getSchoolTypeRing() {
    return !!schoolTypeRing;
  }

  function schoolDirEnrollment(row) {
    if (!row) return 0;
    const raw = row.raw_data || {};
    const fromRaw = Number(raw.enrollment != null ? raw.enrollment : raw.enrollment_fall_school);
    if (Number.isFinite(fromRaw) && fromRaw > 0) return fromRaw;
    return Number(row.enrollment) || 0;
  }

  /** Page school directory rows for one year (enrollment lives in raw_data for CCD). */
  async function fetchSchoolDirectoryYear(year, { state, leaid } = {}) {
    if (!client || !Number.isFinite(Number(year))) return [];
    const pageSize = 1000;
    const out = [];
    let fromIdx = 0;
    for (;;) {
      let q = client
        .from('nces_school_directory')
        .select('ncessch, leaid, school_name, teachers_fte, raw_data')
        .eq('school_year', year)
        .order('ncessch', { ascending: true })
        .range(fromIdx, fromIdx + pageSize - 1);
      if (leaid) q = q.eq('leaid', leaid);
      else if (state) q = q.eq('state_location', state);
      const { data, error } = await q;
      if (error) throw error;
      const chunk = data || [];
      out.push(...chunk);
      if (chunk.length < pageSize) break;
      fromIdx += pageSize;
      if (fromIdx > 200000) break;
    }
    return out;
  }

  function buildSchoolChangeFromSnapshots(fromRows, toRows) {
    const fromMap = new Map((fromRows || []).map((r) => [String(r.ncessch), r]));
    const toMap = new Map((toRows || []).map((r) => [String(r.ncessch), r]));
    const ids = new Set([...fromMap.keys(), ...toMap.keys()]);
    return [...ids].map((id) => {
      const a = fromMap.get(id);
      const b = toMap.get(id);
      const ef = schoolDirEnrollment(a);
      const et = schoolDirEnrollment(b);
      const tf = Number(a?.teachers_fte) || 0;
      const tt = Number(b?.teachers_fte) || 0;
      return {
        ncessch: id,
        enrollment_from: ef,
        enrollment_to: et,
        enrollment_delta: et - ef,
        enrollment_pct: ef ? ((et - ef) / ef) * 100 : null,
        teachers_from: tf,
        teachers_to: tt,
        teachers_delta: tt - tf,
        teachers_pct: tf ? ((tt - tf) / tf) * 100 : null,
      };
    }).filter((r) =>
      r.enrollment_from > 0 || r.enrollment_to > 0
      || r.teachers_from > 0 || r.teachers_to > 0
    );
  }

  function schoolChangeFromLooksEmpty(rows) {
    const list = rows || [];
    if (!list.length) return true;
    const fromTotal = list.reduce((s, r) => s + (Number(r.enrollment_from) || 0), 0);
    const toTotal = list.reduce((s, r) => s + (Number(r.enrollment_to) || 0), 0);
    return fromTotal <= 0 && toTotal > 0;
  }

  async function ensureSchoolChangeMetrics() {
    if (!client) return;
    if (!lastFilters || !lastFilters.state) return;
    if (!showSchoolChangeRings()) {
      applySchoolChangePaint();
      return;
    }
    const from = changeYears.from;
    const to = changeYears.to;
    const state = lastFilters.state || null;
    const leaid = lastFilters.leaid || null;
    // Statewide is OK for most states; only skip huge loads without a district.
    if (!leaid && (lastData.schools || []).length > 6000) {
      schoolChangeById = {};
      schoolChangeKey = null;
      applySchoolChangePaint();
      if (map.getSource('schools') && lastData.schools.length) {
        map.getSource('schools').setData(schoolsToFc(lastData.schools));
      }
      return;
    }
    const key = `sch-${from}-${to}-${state || ''}-${leaid || ''}`;
    if (schoolChangeKey === key) {
      applySchoolChangePaint();
      if (map.getSource('schools') && lastData.schools.length) {
        map.getSource('schools').setData(schoolsToFc(lastData.schools));
      }
      return;
    }
    setMetricLoad({
      active: true,
      title: 'Loading school change',
      label: `Retrieving ${changeFieldMeta().label.toLowerCase()} change ${from} → ${to}…`,
    });
    try {
      let rows = [];
      try {
        const args = {
          p_year_from: from,
          p_year_to: to,
          p_state: state,
        };
        if (leaid) args.p_leaid = leaid;
        rows = await rpc('nces_map_school_metric_change', args);
      } catch (err) {
        console.warn('nces_map_school_metric_change failed; using per-year snapshots', err);
        rows = [];
      }

      // Early years often lack school_enrollment rows — From=0 looks like growth.
      // Rebuild from directory (raw_data.enrollment) and/or school_points.
      if (schoolChangeFromLooksEmpty(rows)) {
        try {
          const pointArgs = { p_state: state, p_year: from };
          if (leaid) pointArgs.p_leaid = leaid;
          const [fromPts, toPts] = await Promise.all([
            rpc('nces_map_school_points', pointArgs).catch(() => []),
            rpc('nces_map_school_points', { ...pointArgs, p_year: to }).catch(() => []),
          ]);
          let rebuilt = buildSchoolChangeFromSnapshots(fromPts, toPts);
          if (schoolChangeFromLooksEmpty(rebuilt)) {
            const [fromDir, toDir] = await Promise.all([
              fetchSchoolDirectoryYear(from, { state, leaid }),
              fetchSchoolDirectoryYear(to, { state, leaid }),
            ]);
            rebuilt = buildSchoolChangeFromSnapshots(fromDir, toDir);
          }
          if (rebuilt.length) rows = rebuilt;
        } catch (err) {
          console.warn('School change snapshot rebuild failed', err);
        }
      }

      schoolChangeById = {};
      (rows || []).forEach((r) => {
        schoolChangeById[r.ncessch] = {
          enrollment_from: Number(r.enrollment_from) || 0,
          enrollment_to: Number(r.enrollment_to) || 0,
          enrollment_delta: Number(r.enrollment_delta) || 0,
          enrollment_pct: r.enrollment_pct != null ? Number(r.enrollment_pct) : null,
          teachers_from: Number(r.teachers_from) || 0,
          teachers_to: Number(r.teachers_to) || 0,
          teachers_delta: Number(r.teachers_delta) || 0,
          teachers_pct: r.teachers_pct != null ? Number(r.teachers_pct) : null,
          _from: from,
          _to: to,
        };
      });
      schoolChangeKey = key;
      if (map.getSource('schools') && lastData.schools.length) {
        map.getSource('schools').setData(schoolsToFc(lastData.schools));
      }
      applySchoolChangePaint();
    } catch (_) {
      schoolChangeById = {};
      schoolChangeKey = null;
      applySchoolChangePaint();
    } finally {
      setMetricLoad({ active: false });
    }
  }

  function boundsOfFc(fc) {
    const b = new global.mapboxgl.LngLatBounds();
    let has = false;
    const walk = (c) => {
      if (!c) return;
      if (typeof c[0] === 'number') { b.extend(c); has = true; }
      else c.forEach(walk);
    };
    (fc.features || []).forEach((f) => {
      if (f.geometry && f.geometry.coordinates) walk(f.geometry.coordinates);
    });
    return has ? b : null;
  }

  function autoFitAllowed() {
    return !cameraLocked();
  }

  function fitTo(fc, maxZoom) {
    if (!autoFitAllowed()) return;
    const b = boundsOfFc(fc);
    if (!b || !map) return;
    applyDetailCameraPadding();
    map.fitBounds(b, {
      padding: fitPadding(),
      maxZoom: maxZoom || 12,
      duration: 800,
    });
  }

  function flyToCenter(center, zoom, duration) {
    if (!autoFitAllowed()) return;
    if (!map || !center) return;
    applyDetailCameraPadding();
    map.easeTo({
      center,
      zoom: zoom == null ? map.getZoom() : zoom,
      duration: duration == null ? 700 : duration,
      essential: true,
    });
  }

  /**
   * Smooth camera move for demos. Uses easeTo (not flyTo) so zoom never
   * overshoots past the target and snaps back.
   */
  function flyCamera({ center, zoom, duration } = {}) {
    if (!map || !center) return Promise.resolve();
    try { map.stop(); } catch (_) { /* ignore */ }
    const ms = duration == null ? 2000 : Math.max(0, Number(duration) || 0);
    const z = zoom == null ? map.getZoom() : Number(zoom);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try { map.off('moveend', finish); } catch (_) { /* ignore */ }
        resolve();
      };
      if (ms <= 0) {
        try {
          map.jumpTo({ center, zoom: z, bearing: 0, pitch: 0 });
        } catch (_) { /* ignore */ }
        resolve();
        return;
      }
      map.once('moveend', finish);
      try {
        map.easeTo({
          center,
          zoom: z,
          bearing: 0,
          pitch: 0,
          duration: ms,
          easing: (t) => 1 - ((1 - t) ** 3),
          essential: true,
        });
      } catch (_) {
        finish();
        return;
      }
      setTimeout(finish, ms + 120);
    });
  }

  function schoolLngLat(ncessch) {
    const row = (lastData.schools || []).find((s) => String(s.ncessch) === String(ncessch));
    if (!row || row.longitude == null || row.latitude == null) return null;
    return [Number(row.longitude), Number(row.latitude)];
  }

  const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb';
  // NCES EDGE composite school-district boundaries (shoreline-clipped; no maritime
  // buffers). Prefer the ArcGIS Online mirror for reliability.
  const EDGE_DISTRICTS =
    'https://services1.arcgis.com/Ua5sjt3LWTPigjyD/ArcGIS/rest/services/School_Districts_Current/FeatureServer/0';
  const boundaryCache = { state: {}, district: {} };

  async function fetchGeoJson(url, timeoutMs) {
    const ms = timeoutMs == null ? 25000 : timeoutMs;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    try {
      const r = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Page through an ArcGIS query until all features are returned. */
  async function fetchGeoJsonAll(baseUrl, onPage) {
    const features = [];
    let offset = 0;
    const pageSize = 2000;
    // Most US district layers finish in ~7–8 pages; use that for % estimates.
    const estimatedPages = 8;
    for (let guard = 0; guard < 50; guard++) {
      const sep = baseUrl.includes('?') ? '&' : '?';
      const url = `${baseUrl}${sep}resultRecordCount=${pageSize}&resultOffset=${offset}`;
      const fc = await fetchGeoJson(url);
      const batch = fc.features || [];
      features.push(...batch);
      if (typeof onPage === 'function') {
        onPage({
          page: guard + 1,
          batch: batch.length,
          total: features.length,
          done: batch.length < pageSize,
          estimatedPages,
        });
      }
      if (batch.length < pageSize) break;
      offset += pageSize;
    }
    return { type: 'FeatureCollection', features };
  }

  function reportProgress(pct, label) {
    if (opts.onLoadProgress) {
      try { opts.onLoadProgress(pct, label); } catch (_) { /* ignore */ }
    }
  }

  /**
   * Census/EDGE residual polygons for lakes/ocean outside any LEA
   * ("School District Not Defined", GEOID xx99997). Coloring these dominates
   * Great Lakes / coastal choropleths — exclude from the map.
   */
  function isUndefinedWaterDistrict(props) {
    if (!props) return true;
    const gid = String(props.GEOID || props.leaid || '');
    if (/99997$/.test(gid)) return true;
    const name = String(props.NAME || props.BASENAME || props.district_name || '');
    return /not\s+defined/i.test(name);
  }

  /** Bounding box [minLng, minLat, maxLng, maxLat] for Polygon / MultiPolygon. */
  function geomBBox(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const walk = (coords, depth) => {
      if (depth === 0) {
        const x = Number(coords[0]);
        const y = Number(coords[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        return;
      }
      for (let i = 0; i < coords.length; i++) walk(coords[i], depth - 1);
    };
    if (geometry.type === 'Polygon') walk(geometry.coordinates, 2);
    else if (geometry.type === 'MultiPolygon') walk(geometry.coordinates, 3);
    else if (geometry.type === 'Point') walk(geometry.coordinates, 0);
    else return null;
    if (!Number.isFinite(minX)) return null;
    return [minX, minY, maxX, maxY];
  }

  /**
   * Lowest zoom where a ~10px district name fits inside the polygon bbox.
   * Below this, labels stay hidden (name too big for the shape on screen).
   */
  function districtLabelMinZoom(f, textSize) {
    const size = Math.max(10, Number(textSize) || 10);
    const name = String(
      (f && f.properties && (f.properties.district_name || f.properties.NAME || f.properties.BASENAME)) || ''
    ).trim();
    if (!name) return 99;
    // Prefer the largest landmass bbox so Chesapeake MultiPolygons aren't one huge box.
    const labelGeom = largestPolygonGeometry(f && f.geometry) || (f && f.geometry);
    const b = geomBBox(labelGeom);
    if (!b) return 99;
    const wDeg = Math.max(0, b[2] - b[0]);
    const hDeg = Math.max(0, b[3] - b[1]);
    const midLat = (b[1] + b[3]) / 2;
    const cos = Math.max(0.15, Math.cos(midLat * Math.PI / 180));
    // ~0.55em per character; wrap at ~14 chars so tall names need more height.
    const maxCharsPerLine = 14;
    const lines = Math.max(1, Math.ceil(name.length / maxCharsPerLine));
    const needW = Math.min(name.length, maxCharsPerLine) * size * 0.55;
    const needH = lines * size * 1.25;
    // Mapbox world width at zoom z ≈ 512 * 2^z px; deg→px ≈ span * world/360 (* cos for lng).
    const minZFor = (spanDeg, needPx, useCos) => {
      if (!(spanDeg > 0) || !(needPx > 0)) return 22;
      const factor = useCos ? cos : 1;
      const z = Math.log2((needPx * 360) / (spanDeg * 512 * factor));
      return Number.isFinite(z) ? z : 22;
    };
    return Math.min(22, Math.max(minZFor(wDeg, needW, true), minZFor(hDeg, needH, false)));
  }

  /** Absolute shoelace area of a ring [[lng,lat],...]. */
  function ringAbsArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]);
      const yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]);
      const yj = Number(ring[j][1]);
      if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
      sum += (xj * yi) - (xi * yj);
    }
    return Math.abs(sum) * 0.5;
  }

  /** Largest Polygon geometry from a Polygon / MultiPolygon (by exterior ring area). */
  function largestPolygonGeometry(geometry) {
    if (!geometry || !geometry.coordinates) return null;
    let polys = [];
    if (geometry.type === 'Polygon') polys = [geometry.coordinates];
    else if (geometry.type === 'MultiPolygon') polys = geometry.coordinates || [];
    else return null;
    let best = null;
    let bestArea = -1;
    polys.forEach((poly) => {
      const exterior = poly && poly[0];
      const area = ringAbsArea(exterior);
      if (area > bestArea) {
        bestArea = area;
        best = poly;
      }
    });
    return best ? { type: 'Polygon', coordinates: best } : null;
  }

  /** One label anchor per district: centroid of the largest landmass. */
  function districtLabelPoint(geometry) {
    const poly = largestPolygonGeometry(geometry);
    const ring = poly && poly.coordinates && poly.coordinates[0];
    if (!ring || ring.length < 3) {
      const b = geomBBox(geometry);
      if (!b) return null;
      return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    }
    let sx = 0;
    let sy = 0;
    let n = 0;
    // Skip duplicate closing vertex.
    const lim = ring.length > 1
      && ring[0][0] === ring[ring.length - 1][0]
      && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
    for (let i = 0; i < lim; i++) {
      const lng = Number(ring[i][0]);
      const lat = Number(ring[i][1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      sx += lng;
      sy += lat;
      n += 1;
    }
    if (!n) return null;
    return [sx / n, sy / n];
  }

  /** Point FeatureCollection — exactly one label candidate per district feature. */
  function districtLabelPointsFc(fc) {
    const features = [];
    (fc && fc.features ? fc.features : []).forEach((f) => {
      if (!f || !f.geometry) return;
      const coords = districtLabelPoint(f.geometry);
      if (!coords) return;
      const props = { ...(f.properties || {}) };
      // Fit text to the main landmass, not the whole Chesapeake-spanning MultiPolygon.
      const probe = {
        type: 'Feature',
        properties: props,
        geometry: largestPolygonGeometry(f.geometry) || f.geometry,
      };
      props.label_min_zoom = districtLabelMinZoom(probe, 10);
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'Point', coordinates: coords },
      });
    });
    return { type: 'FeatureCollection', features };
  }

  function syncDistrictLabelPoints(fc) {
    if (!map || !map.getSource('district-label-points')) return;
    map.getSource('district-label-points').setData(
      fc && fc.features && fc.features.length ? districtLabelPointsFc(fc) : emptyFc()
    );
  }

  /** Push district polygons + deduped label points to the map. */
  function setDistrictsSourceData(fc) {
    if (!map) return;
    if (map.getSource('districts')) map.getSource('districts').setData(fc || emptyFc());
    syncDistrictLabelPoints(fc);
  }

  function attachDistrictLabelMeta(f) {
    if (!f) return f;
    if (!f.properties) f.properties = {};
    f.properties.label_min_zoom = districtLabelMinZoom(f, 10);
    return f;
  }

  function normalizeDistrictProps(f) {
    if (!f.properties) f.properties = {};
    const p = f.properties;
    const gid = p.GEOID || p.leaid;
    if (gid) {
      p.GEOID = gid;
      p.leaid = gid;
    }
    const name = p.NAME || p.BASENAME || p.district_name || gid;
    if (name) {
      p.NAME = name;
      p.BASENAME = name;
      p.district_name = name;
    }
    p.district_color = p.district_color || districtColor(gid);
    attachDistrictLabelMeta(f);
    return f;
  }

  let nationwideStarted = false;
  let nationwideDistrictsStarted = false;

  // --- Persistent cache (IndexedDB) for the nationwide boundary GeoJSON. -------
  // The mesh is ~5 MB — too large for localStorage — so we keep it in IndexedDB
  // and only hit the district boundary service on the very first load.
  const IDB_NAME = 'nces_map_cache';
  const IDB_STORE = 'boundaries';
  // v6: stronger LEAID join keys for Color-by; drop prior boundary caches.
  const IDB_VERSION = 'v6';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no idb')); return; }
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => {
          const v = req.result;
          resolve(v && v.version === IDB_VERSION ? v.data : null);
        };
        req.onerror = () => resolve(null);
      });
    } catch (_) { return null; }
  }

  async function idbSet(key, data) {
    try {
      const db = await idbOpen();
      await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ version: IDB_VERSION, data }, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch (_) { /* ignore */ }
  }

  async function loadNationwideStates() {
    reportProgress(12, 'Loading state outlines…');
    try {
      let feats = await idbGet('states');
      if (!feats) {
        reportProgress(18, 'Downloading state outlines…');
        const url = `${TIGER}/State_County/MapServer/0/query?where=1%3D1`
          + `&outFields=STUSAB,BASENAME&returnGeometry=true&outSR=4326`
          + `&geometryPrecision=4&maxAllowableOffset=0.01&f=geojson`;
        const fc = await fetchGeoJson(url);
        feats = (fc.features || []).filter((f) => f.properties && STATE_FIPS[f.properties.STUSAB]);
        feats.forEach((f) => { f.properties.stusab = f.properties.STUSAB; });
        idbSet('states', feats);
      }
      allStatesFc = { type: 'FeatureCollection', features: feats };
      setStateOutlineData(allStatesFc);
      // Boundaries often finish after nces_map_state_summary — re-merge so
      // enrollment / teachers / staff / ratio color the whole country (change
      // already merges late via ensureChangeMetrics).
      applyStateMetrics();
      if (!stateSummaryHasFte() && Object.keys(stateSummaryByCode).length) {
        ensureStateFteMetrics({ quiet: true }).catch(() => {});
      }
      if (colorMetric && !isChangeMetric(colorMetric)) {
        applyMetricPaint();
        applyVisibility();
      } else if (isChangeMetric(colorMetric)) {
        ensureChangeMetrics();
      }
      reportProgress(32, 'State outlines ready');
    } catch (_) {
      reportProgress(32, 'State outlines unavailable');
    }
  }

  async function loadNationwideDistricts() {
    if (nationwideDistrictsStarted) return;
    nationwideDistrictsStarted = true;
    reportProgress(62, 'Loading district outlines…');
    try {
      let features = await idbGet('districts');
      if (!features) {
        reportProgress(65, 'Downloading district mesh…');
        const layerUrl = `${EDGE_DISTRICTS}/query`
          + `?where=${encodeURIComponent("NAME NOT LIKE '%Not Defined%'")}`
          + `&outFields=GEOID,NAME&returnGeometry=true&outSR=4326`
          + `&geometryPrecision=4&maxAllowableOffset=0.008&f=geojson`;
        const fc = await fetchGeoJsonAll(layerUrl, ({ page, estimatedPages, done }) => {
          const frac = Math.min(1, page / estimatedPages);
          const pct = Math.round(65 + frac * 25);
          reportProgress(
            Math.min(done ? 90 : pct, 90),
            `Downloading district mesh… (page ${page})`
          );
        }).catch(() => null);
        const fipsSet = new Set(Object.values(STATE_FIPS));
        features = [];
        const seen = new Set();
        (fc && fc.features ? fc.features : []).forEach((f) => {
          if (isUndefinedWaterDistrict(f.properties)) return;
          const gid = f.properties && f.properties.GEOID;
          if (!gid || seen.has(gid) || !fipsSet.has(String(gid).slice(0, 2))) return;
          const geom = sanitizeDistrictGeometry(f.geometry);
          if (!geom) return;
          seen.add(gid);
          f.geometry = geom;
          normalizeDistrictProps(f);
          f.properties.tiger_layer = 0;
          features.push(f);
        });
        if (features.length) idbSet('districts', features);
      } else {
        reportProgress(88, 'District mesh from cache…');
        features.forEach((f) => normalizeDistrictProps(f));
      }
      if (features && features.length) {
        if (global.NYC_GEO_DISTRICTS) {
          try {
            const enriched = await global.NYC_GEO_DISTRICTS.enrichNyBoundaryFc({
              type: 'FeatureCollection',
              features,
            });
            features = enriched.features || features;
            features.forEach((f) => normalizeDistrictProps(f));
          } catch (_) { /* keep EDGE mesh */ }
        }
        allDistrictsFc = { type: 'FeatureCollection', features };
        if (map.getSource('districts-all')) map.getSource('districts-all').setData(allDistrictsFc);
      }
    } catch (_) { /* leave empty */ }

    reportProgress(94, 'Refreshing map layers…');
    // Light refresh — avoid a full render (that re-fetches schools).
    applySelectionFilter();
    applyFilters();
    if (completenessLoaded && opts.onCompleteness) opts.onCompleteness(completenessSummary());
    if (isChangeMetric(colorMetric)) ensureChangeMetrics();
    else if (colorMetric) ensureNationwideMetrics();
    if (opts.onDataRanges && !(lastFilters && lastFilters.state)) {
      opts.onDataRanges({ districts: computeRangeFc(allDistrictsFc, 'enrollment') });
    }
    reportProgress(100, 'Map ready');
  }

  // States first (fast). District mesh is heavy — only kick immediately when
  // Boundaries = Districts; otherwise wait a few seconds so state colors paint first.
  async function loadNationwideBoundaries() {
    if (nationwideStarted) return;
    nationwideStarted = true;
    await loadNationwideStates();
    if (visibility.districts) {
      kickNationwideDistricts();
    } else {
      setTimeout(() => {
        if (!nationwideDistrictsStarted) kickNationwideDistricts();
      }, 4500);
    }
  }

  function kickNationwideDistricts() {
    const start = () => { loadNationwideDistricts().catch(() => {}); };
    // Prefer idle, but don't wait long — outlines should show on landing quickly.
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(start, { timeout: 400 });
    } else {
      setTimeout(start, 50);
    }
  }

  let nationwideMetricKey = null;  // 'null' or 'YYYY' once loaded
  let nationwideMetricLoading = false;

  function resolveMetricYear() {
    if (changeYears.from === changeYears.to && Number.isFinite(Number(changeYears.to))) {
      return Number(changeYears.to);
    }
    if (lastFilters && lastFilters.year != null) return Number(lastFilters.year);
    if (lastFilters && lastFilters.years && lastFilters.years.length) {
      return Math.max(...lastFilters.years.map(Number));
    }
    return Number((global.NCES_CONFIG && global.NCES_CONFIG.defaultSchoolYear) || 2024);
  }

  // Fetch per-district snapshot metrics for the whole country and merge onto the
  // nationwide mesh. Prefer directory-based metric_change (same nationwide
  // coverage as Color-by Change); fall back to school-anchored district_points.
  async function ensureNationwideMetrics() {
    if (!client || !map) return;
    if (!allDistrictsFc.features.length) {
      setTimeout(() => {
        if (colorMetric && !isChangeMetric(colorMetric)) ensureNationwideMetrics();
      }, 1500);
      return;
    }
    const year = resolveMetricYear();
    const key = String(year);
    if (nationwideMetricKey === key || nationwideMetricLoading) return;
    nationwideMetricLoading = true;
    const metricLabel = (COLOR_METRICS[colorMetric] && COLOR_METRICS[colorMetric].label) || 'district metrics';
    setMetricLoad({
      active: true,
      title: `Loading ${metricLabel}`,
      label: `Retrieving nationwide district ${metricLabel.toLowerCase()} for ${year}…`,
    });
    try {
      let rows = null;
      try {
        // Same year twice → snapshot enrollment/teachers/staff for every LEA in
        // nces_district_directory (not only states with synced school points).
        const changeRows = await rpc('nces_map_metric_change', {
          p_year_from: year,
          p_year_to: year,
          p_state: null,
        });
        rows = (changeRows || []).map((r) => ({
          leaid: r.leaid,
          district_name: r.district_name,
          enrollment: Number(r.enrollment_to) || 0,
          teachers_fte: Number(r.teachers_to) || 0,
          staff_fte: Number(r.staff_to) || 0,
          schools: 0,
        }));
      } catch (_) {
        rows = await rpc('nces_map_district_points', { p_state: null, p_year: year });
      }
      const byLea = {};
      (rows || []).forEach((r) => {
        const id = padLeaid(r.leaid);
        byLea[id] = {
          enrollment: Number(r.enrollment) || 0,
          teachers_fte: Number(r.teachers_fte) || 0,
          staff_fte: Number(r.staff_fte) || 0,
          schools: Number(r.schools) || 0,
          district_name: r.district_name,
          grades: gradeRange(r.lowest_grade, r.highest_grade),
          stu_teacher: stuTeacher(r.enrollment, r.teachers_fte) || 0,
        };
        if (r.leaid) byLea[r.leaid] = byLea[id];
      });
      allDistrictsFc.features.forEach((f) => {
        const id = padLeaid(f.properties && (f.properties.leaid || f.properties.GEOID));
        const d = byLea[id] || byLea[f.properties && f.properties.leaid];
        if (id) {
          f.properties.leaid = id;
          f.properties.district_color = f.properties.district_color || districtColor(id);
        }
        if (!d) {
          f.properties.enrollment = 0;
          f.properties.teachers_fte = 0;
          f.properties.staff_fte = 0;
          f.properties.stu_teacher = 0;
          return;
        }
        Object.assign(f.properties, d);
        f.properties.stu_teacher = stuTeacher(d.enrollment, d.teachers_fte) || 0;
      });
      if (map.getSource('districts-all')) map.getSource('districts-all').setData(allDistrictsFc);
      nationwideMetricKey = key;
      applyMetricPaint();
      // Now that the mesh has enrollment, enable/scale the nationwide district slider.
      if (opts.onDataRanges && !(lastFilters && lastFilters.state)) {
        opts.onDataRanges({ districts: computeRangeFc(allDistrictsFc, 'enrollment') });
      }
    } catch (_) { /* setup RPC missing or failed — mesh stays uncolored */ }
    finally {
      nationwideMetricLoading = false;
      setMetricLoad({ active: false });
    }
  }

  const BOUNDARY_LS_PREFIX = 'nces_dist_bounds_v6_';

  function clearLegacyBoundaryCaches() {
    try {
      const drop = [];
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && /^nces_dist_bounds_v[1-5]_/.test(k)) drop.push(k);
      }
      drop.forEach((k) => global.localStorage.removeItem(k));
    } catch (_) { /* ignore */ }
  }

  function loadBoundaryLS(code) {
    try {
      const raw = global.localStorage.getItem(BOUNDARY_LS_PREFIX + code);
      if (!raw) return null;
      const fc = JSON.parse(raw);
      if (fc && Array.isArray(fc.features)) return fc;
    } catch (_) { /* ignore */ }
    return null;
  }

  function saveBoundaryLS(code, fc) {
    try {
      global.localStorage.setItem(BOUNDARY_LS_PREFIX + code, JSON.stringify(fc));
    } catch (_) { /* quota exceeded or unavailable — fine, in-memory cache still used */ }
  }

  /** Drop degenerate rings/parts left by aggressive ArcGIS generalization. */
  function sanitizeDistrictGeometry(geom) {
    if (!geom || !geom.type) return null;

    const cleanRing = (ring) => {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const out = [];
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i];
        if (!p || p.length < 2) continue;
        const lng = Number(p[0]);
        const lat = Number(p[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        const prev = out[out.length - 1];
        if (prev && prev[0] === lng && prev[1] === lat) continue;
        out.push([lng, lat]);
      }
      if (out.length < 3) return null;
      const a = out[0];
      const b = out[out.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
      return out.length >= 4 ? out : null;
    };

    if (geom.type === 'Polygon') {
      const rings = (geom.coordinates || []).map(cleanRing).filter(Boolean);
      return rings.length ? { type: 'Polygon', coordinates: rings } : null;
    }
    if (geom.type === 'MultiPolygon') {
      const polys = (geom.coordinates || [])
        .map((poly) => (poly || []).map(cleanRing).filter(Boolean))
        .filter((poly) => poly.length);
      if (!polys.length) return null;
      if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
      return { type: 'MultiPolygon', coordinates: polys };
    }
    return geom;
  }

  // School-district polygons for a state (EDGE shoreline-clipped composite).
  // No maxAllowableOffset — generalization was crushing coasts/islands into shards.
  // Excludes Census "School District Not Defined" lake/ocean residual polygons.
  // NY: replace single NYC DOE outline with geographic district polygons (Open Data).
  async function fetchStateDistrictBoundaries(code) {
    if (boundaryCache.district[code]) return boundaryCache.district[code];
    const cached = loadBoundaryLS(code);
    if (cached) {
      const enrichedCached = await enrichBoundariesIfNy(code, {
        type: 'FeatureCollection',
        features: (cached.features || []).filter((f) => !isUndefinedWaterDistrict(f.properties)),
      });
      boundaryCache.district[code] = enrichedCached;
      return enrichedCached;
    }

    const fips = STATE_FIPS[code];
    if (!fips) { boundaryCache.district[code] = emptyFc(); return boundaryCache.district[code]; }

    const layerUrl = `${EDGE_DISTRICTS}/query`
      + `?where=${encodeURIComponent(
        `STATEFP='${fips}' AND NAME NOT LIKE '%Not Defined%'`
      )}`
      + `&outFields=GEOID,NAME&returnGeometry=true&outSR=4326`
      + `&geometryPrecision=5&f=geojson`;

    const fc = await fetchGeoJsonAll(layerUrl).catch(() => null);
    const features = [];
    const seen = new Set();
    (fc && fc.features ? fc.features : []).forEach((f) => {
      if (isUndefinedWaterDistrict(f.properties)) return;
      const gid = f.properties && f.properties.GEOID;
      if (!gid || seen.has(gid)) return;
      const geom = sanitizeDistrictGeometry(f.geometry);
      if (!geom) return;
      seen.add(gid);
      f.geometry = geom;
      normalizeDistrictProps(f);
      f.properties.tiger_layer = 0;
      features.push(f);
    });

    let out = { type: 'FeatureCollection', features };
    out = await enrichBoundariesIfNy(code, out);
    boundaryCache.district[code] = out;
    if (out.features.length) saveBoundaryLS(code, out);
    return out;
  }

  async function enrichBoundariesIfNy(code, fc) {
    if (code !== 'NY' || !global.NYC_GEO_DISTRICTS) return fc;
    try {
      return await global.NYC_GEO_DISTRICTS.enrichNyBoundaryFc(fc);
    } catch (_) {
      return fc;
    }
  }

  // Merge enrollment/schools/grades/staff from RPC rows onto Census district polygons.
  function districtBoundariesToFc(boundaryFc, rows) {
    const features = (boundaryFc.features || []).map((f) => {
      const p = f.properties || {};
      const rawId = p.GEOID || p.geoid || p.leaid || p.LEAID || '';
      const leaid = padLeaid(rawId);
      const geom = f.geometry;
      const feat = {
        type: 'Feature',
        geometry: geom,
        properties: {
          leaid,
          GEOID: leaid || String(rawId || ''),
          district_color: districtColor(leaid || rawId),
          district_name: p.BASENAME || p.NAME || p.name || p.district_name || leaid || rawId,
          NAME: p.BASENAME || p.NAME || p.name || p.district_name || leaid || rawId,
          enrollment: 0,
          teachers_fte: 0,
          staff_fte: 0,
          stu_teacher: 0,
          schools: null,
          grades: '',
          label_min_zoom: p.label_min_zoom,
        },
      };
      attachDistrictLabelMeta(feat);
      return feat;
    });
    return mergeDistrictMetrics({ type: 'FeatureCollection', features }, rows);
  }

  // State boundary polygon by 2-letter code.
  async function fetchStateBoundary(code) {
    if (boundaryCache.state[code]) return boundaryCache.state[code];
    const url = `${TIGER}/State_County/MapServer/0/query?where=STUSAB='${encodeURIComponent(code)}'`
      + `&outFields=STUSAB,BASENAME&returnGeometry=true&outSR=4326&f=geojson`;
    try {
      const fc = await fetchGeoJson(url);
      if (fc && fc.features && fc.features.length) {
        boundaryCache.state[code] = fc;
        return fc;
      }
    } catch (_) { /* ignore */ }
    boundaryCache.state[code] = emptyFc();
    return boundaryCache.state[code];
  }

  // PostgREST/Supabase default max rows is 1000. Texas alone has ~9k schools, so
  // statewide overview must page. Always order for stable OFFSET pagination.
  const RPC_ORDER_BY = {
    nces_map_school_points: 'ncessch',
    nces_map_district_points: 'leaid',
    nces_map_metric_change: 'leaid',
    nces_map_enrollment_change: 'leaid',
    nces_map_school_metric_change: 'ncessch',
    nces_map_state_summary: 'state_code',
    nces_map_state_metric_change: 'state_code',
    nces_map_state_enrollment_change: 'state_code',
    nces_state_completeness: 'state_code',
    nces_map_enrollment_by_grade: 'grade',
    nces_map_enrollment_by_grade_change: 'grade',
  };

  // Short-lived cache for the heaviest map RPCs (re-selecting a district/state
  // was re-downloading the same statewide school list every time).
  const RPC_CACHE_TTL_MS = 5 * 60 * 1000;
  const RPC_CACHEABLE = new Set([
    'nces_map_state_summary',
    'nces_map_district_points',
    'nces_map_school_points',
  ]);
  const rpcResultCache = new Map();

  async function rpc(name, args) {
    const pageSize = 1000;
    const orderCol = RPC_ORDER_BY[name];
    const clean = {};
    Object.entries(args || {}).forEach(([k, v]) => {
      if (v !== null && v !== undefined) clean[k] = v;
    });
    const cacheKey = RPC_CACHEABLE.has(name)
      ? `${name}:${JSON.stringify(clean)}`
      : null;
    if (cacheKey) {
      const hit = rpcResultCache.get(cacheKey);
      if (hit && Date.now() - hit.at < RPC_CACHE_TTL_MS) return hit.rows;
    }
    const rows = [];
    let from = 0;
    for (;;) {
      let q = client.rpc(name, clean);
      if (orderCol) q = q.order(orderCol, { ascending: true });
      const { data, error } = await q.range(from, from + pageSize - 1);
      if (error) {
        const detail = [error.message, error.details, error.hint].filter(Boolean).join(' · ');
        throw new Error(`${name}: ${detail || 'request failed'}`);
      }
      const chunk = data || [];
      rows.push(...chunk);
      if (chunk.length < pageSize) break;
      from += pageSize;
      if (from > 200000) break;
    }
    if (cacheKey) {
      rpcResultCache.set(cacheKey, { rows, at: Date.now() });
      if (rpcResultCache.size > 48) {
        const oldest = rpcResultCache.keys().next().value;
        rpcResultCache.delete(oldest);
      }
    }
    // Never cache empty school-point results — transient auth/year misses were
    // sticky for 5 minutes and left the map with "No schools found".
    if (cacheKey && name === 'nces_map_school_points' && !rows.length) {
      rpcResultCache.delete(cacheKey);
    }
    return rows;
  }

  function isSetupError(message) {
    const m = String(message || '').toLowerCase();
    return (
      m.includes('could not find the function') ||
      m.includes('schema cache') ||
      (m.includes('function') && m.includes('does not exist'))
    );
  }

  function computeRange(rows, key) {
    let lo = Infinity;
    let hi = -Infinity;
    let any = false;
    (rows || []).forEach((r) => {
      const v = Number(r[key]);
      if (!Number.isFinite(v)) return;
      any = true;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
    if (!any) return { min: 0, max: 0, empty: true };
    // Single value (e.g. one state in scope): still expose 0…max so the slider enables.
    if (lo === hi) return { min: 0, max: hi > 0 ? hi : 0, empty: hi <= 0 };
    return { min: lo, max: hi, empty: false };
  }

  // Enrollment range from a FeatureCollection's properties (for the nationwide mesh).
  function computeRangeFc(fc, key) {
    let lo = Infinity;
    let hi = -Infinity;
    let any = false;
    (fc.features || []).forEach((f) => {
      const v = Number(f.properties && f.properties[key]);
      if (!Number.isFinite(v)) return;
      any = true;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    });
    if (!any) return { min: 0, max: 0, empty: true };
    if (lo === hi) return { min: 0, max: hi > 0 ? hi : 0, empty: hi <= 0 };
    return { min: lo, max: hi, empty: false };
  }

  // Render map for the current filters. Returns a small status object.
  let renderGen = 0;
  async function render(filters, options) {
    if (!ready) return { ok: false };
    const myGen = ++renderGen;
    const opt = options || {};
    const prevFilters = lastFilters || {};
    lastFilters = filters || {};
    const year = filters.year != null
      ? filters.year
      : (filters.years && filters.years.length ? Math.max(...filters.years) : null);

    // Planning regions overlay (MCPS) + school region filter.
    setDistrictRegions(filters.leaid || null, filters.regionCode || null);

    const status = { states: 0, districts: 0, schools: 0, notes: [], setupNeeded: false };

    // Reset the multi-selection when the state scope changes (leaids differ per state).
    if (filters.state !== lastRenderedState) {
      lastRenderedState = filters.state || null;
      if (selectedDistricts.size) { selectedDistricts.clear(); notifySelection(); }
    }

    // Instant feedback: zoom + highlight before network work.
    setSelectedState(filters.state || null);
    setSelectedDistrict(filters.leaid || null);
    if (filters.state && allDistrictsFc.features.length && map.getSource('districts')) {
      const fips = STATE_FIPS[filters.state];
      if (fips) {
        const quick = allDistrictsFc.features.filter((f) =>
          f.properties && String(f.properties.leaid || '').slice(0, 2) === fips
        );
        if (quick.length) {
          lastDistrictFc = { type: 'FeatureCollection', features: quick };
          setDistrictsSourceData(lastDistrictFc);
          applyMetricPaint();
          applyVisibility();
          applyFilters();
          if (opts.onStatus) {
            opts.onStatus({
              states: 1,
              districts: quick.length,
              schools: null,
              notes: ['Loading detailed outlines…'],
            });
          }
          if (!opt.skipFit && autoFitAllowed() && !filters.leaid && STATE_CENTROIDS[filters.state]) {
            flyToCenter(STATE_CENTROIDS[filters.state], 6, 500);
          }
        }
      }
    } else if (!filters.state) {
      lastDistrictFc = emptyFc();
      setDistrictsSourceData(emptyFc());
      applyVisibility();
    }

    // States (always). Counts are scoped to the current filter below.
    let stateSummary = null;
    let totalStateSchools = 0;
    try {
      const stateRows = await rpc('nces_map_state_summary', { p_year: year });
      if (myGen !== renderGen) return status;
      lastData.states = stateRows;
      map.getSource('states').setData(statesToFc(stateRows));
      stateSummaryByCode = {};
      stateRows.forEach((r) => {
        stateSummaryByCode[r.state_code] = {
          districts: Number(r.districts) || 0,
          schools: Number(r.schools) || 0,
          enrollment: Number(r.enrollment) || 0,
          teachers_fte: Number(r.teachers_fte) || 0,
          staff_fte: Number(r.staff_fte) || 0,
        };
        totalStateSchools += Number(r.schools) || 0;
      });
      // Merge metrics onto the state polygons for the state-level choropleth.
      applyStateMetrics();
      // Older nces_map_state_summary omits FTE — fill Teachers/Staff/ratio for
      // landing Color-by and the US detail panel (quiet unless Color-by needs it).
      if (!stateSummaryHasFte()) {
        ensureStateFteMetrics({ quiet: true }).catch(() => {});
      }
      // Load real per-state completeness (cheap) so nationwide status can show
      // synced/total districts without requiring a state pick.
      await ensureStateCompleteness();
      if (myGen !== renderGen) return status;
      stateSummary = filters.state ? (stateSummaryByCode[filters.state] || null) : null;
      // Scope: selected state = 1; otherwise total US states (from the mesh, ~52).
      status.states = filters.state
        ? 1
        : (allStatesFc.features.length || stateRows.length);
    } catch (e) {
      if (isSetupError(e.message || e)) status.setupNeeded = true;
      status.notes.push('States: ' + (e.message || e));
    }

    // Districts + Schools require a state (nationwide would be too many points).
    // If only a LEA is set, derive the state from its FIPS prefix.
    if (!filters.state && filters.leaid) {
      const derived = stateForLeaid(filters.leaid);
      if (derived) {
        filters = Object.assign({}, filters, { state: derived });
        lastFilters = filters;
      }
    }
    if (filters.state) {
      // Only load school markers when the Schools layer is on.
      // State-only selection keeps schools off; district drill turns them on in the UI.
      const schoolsBusy = visibility.schools
        ? loadSchoolsForScope(filters)
        : Promise.resolve([]);
      if (!visibility.schools) {
        lastData.schools = [];
        schoolLoadStatus = 'idle';
        try {
          if (map.getSource('schools')) map.getSource('schools').setData(emptyFc());
        } catch (_) { /* ignore */ }
      }

      // District polygons come from Census (always available); enrollment for the
      // choropleth comes from the RPC (may be empty if the SQL migration hasn't run).
      // Fetch both in parallel so outlines aren't blocked by the enrollment RPC.
      const [distResult, boundaryResult] = await Promise.allSettled([
        rpc('nces_map_district_points', { p_state: filters.state, p_year: year }),
        fetchStateDistrictBoundaries(filters.state),
      ]);
      if (myGen !== renderGen) {
        // Still wait for schools so markers appear even if this render was superseded.
        await schoolsBusy.catch(() => {});
        return status;
      }

      let distRows = [];
      if (distResult.status === 'fulfilled') {
        distRows = distResult.value;
        lastData.districts = distRows;
      } else {
        const err = distResult.reason;
        if (isSetupError(err && err.message ? err.message : err)) status.setupNeeded = true;
        status.notes.push('Districts: ' + (err && err.message ? err.message : err));
      }

      if (boundaryResult.status === 'fulfilled') {
        lastDistrictFc = districtBoundariesToFc(boundaryResult.value, distRows);
        setDistrictsSourceData(lastDistrictFc);
        // Second pass: guarantee RPC metrics stick even if the first join missed keys.
        syncDistrictMetricsToMap();
        applyMetricPaint();
        applyVisibility();
        if (distRows.length && (lastDistrictFc._metricMatched || 0) === 0) {
          status.notes.push('District Color-by: metrics did not match boundary IDs (check LEAID/GEOID).');
        }
      } else if (distRows.length && lastDistrictFc.features.length) {
        // Boundaries failed/timed out — still merge metrics onto whatever polygons we have.
        mergeDistrictMetrics(lastDistrictFc, distRows);
        setDistrictsSourceData(lastDistrictFc);
        syncDistrictMetricsToMap();
        applyMetricPaint();
        applyVisibility();
      } else {
        lastDistrictFc = emptyFc();
        setDistrictsSourceData(emptyFc());
        status.notes.push('District outlines: ' + (boundaryResult.reason || 'failed to load'));
      }
      // Scope: a selected district counts as 1; otherwise all districts in the
      // state (from the NCES state summary, falling back to loaded rows).
      if (filters.leaid) {
        status.districts = 1;
      } else if (stateSummary && stateSummary.districts != null) {
        status.districts = Number(stateSummary.districts) || 0;
      } else {
        status.districts = lastDistrictFc.features.length;
      }

      // Paint districts immediately so TX-sized states feel responsive, then load schools.
      setSelectedState(filters.state || null);
      setSelectedDistrict(filters.leaid || null);
      applyFilters();
      {
        const early = computeFilteredStatus({ setupNeeded: status.setupNeeded });
        if (visibility.schools) {
          early.notes = (early.notes || []).concat(['Loading schools…']);
        }
        if (opts.onStatus) opts.onStatus(early);
      }
      // Fit to the state as soon as outlines are ready (don't wait on ~9k schools).
      if (!opt.skipFit && autoFitAllowed() && !filters.leaid) {
        let earlyBoundary = emptyFc();
        if (allStatesFc.features.length) {
          earlyBoundary = {
            type: 'FeatureCollection',
            features: allStatesFc.features.filter((f) => f.properties && f.properties.stusab === filters.state),
          };
        }
        if (earlyBoundary.features.length) fitTo(earlyBoundary, 8);
        else if (STATE_CENTROIDS[filters.state]) {
          flyToCenter(STATE_CENTROIDS[filters.state], 6, 600);
        }
      }

      try {
        await schoolsBusy;
        status.schools = (lastData.schools || []).length;
      } catch (e) {
        if (isSetupError(e.message || e)) status.setupNeeded = true;
        status.notes.push('Schools: ' + (e.message || e));
      }
    } else {
      lastData.districts = [];
      lastDistrictFc = emptyFc();
      setDistrictsSourceData(emptyFc());
      // Nationwide: keep / load schools when the layer is on (progressive).
      // Do NOT wipe markers here — that used to cancel a country-wide load.
      if (visibility.schools) {
        loadNationwideSchools(filters).catch(() => {});
        status.schools = (lastData.schools || []).length || totalStateSchools || null;
        status.notes.push('Loading schools nationwide (state by state)…');
      } else {
        lastData.schools = [];
        schoolLoadStatus = 'idle';
        if (map.getSource('schools')) map.getSource('schools').setData(emptyFc());
        if (typeof opts.onSchoolsLoaded === 'function') {
          opts.onSchoolsLoaded([], { status: 'idle' });
        }
        status.schools = totalStateSchools || null;
      }
      // Nationwide: state choropleth + district mesh. Counts come from state summary.
      status.districts = allDistrictsFc.features.length || null;
      status.notes.push('Click a state to explore districts by enrollment.');
      ensureNationwideMetrics();
    }

    // All state outlines are loaded nationwide in the background; just highlight
    // the selected one here (and derive its bounds for fitting).
    setSelectedState(filters.state || null);
    let stateBoundary = emptyFc();
    if (filters.state && allStatesFc.features.length) {
      stateBoundary = {
        type: 'FeatureCollection',
        features: allStatesFc.features.filter((f) => f.properties && f.properties.stusab === filters.state),
      };
    } else if (filters.state) {
      // Fallback: fetch the single state boundary if the nationwide set isn't ready.
      try { stateBoundary = await fetchStateBoundary(filters.state); } catch (_) { /* ignore */ }
    }

    // Highlight the selected district polygon (if any).
    setSelectedDistrict(filters.leaid || null);

    // Re-apply level + size filters against the freshly loaded data
    // (also refreshes the bottom status to filtered counts).
    // Visibility must re-run so Color by flips states ↔ districts with scope.
    applyVisibility();
    applyFilters();

    // Map From/To controls own the change pair. Dashboard year checkboxes sync
    // into those controls only via wireMapToggles (not on every render).

    // Keep change props available for Details / rings whenever From≠To.
    // District polygons were just rebuilt, so this also re-attaches cached props.
    if (changeYears.from !== changeYears.to) {
      ensureChangeMetrics();
    }
    if (isChangeMetric(colorMetric)) {
      if (changeYears.from === changeYears.to) {
        applyMetricPaint();
        applyVisibility();
      }
    } else if (colorMetric && filters.state) {
      // Metrics already merged in the district load above; only refresh if missing.
      refreshColorScope();
    }

    // School change colors when From≠To (state or district scope).
    if (filters.state && showSchoolChangeRings()) {
      ensureSchoolChangeMetrics();
    }

    // Report data enrollment ranges so the UI can set slider bounds. Districts
    // use the loaded state rows when a state is selected, else the nationwide mesh.
    if (opts.onDataRanges) {
      opts.onDataRanges({
        states: computeRange(lastData.states, 'enrollment'),
        districts: filters.state
          ? computeRange(lastData.districts, 'enrollment')
          : computeRangeFc(allDistrictsFc, 'enrollment'),
        schools: computeRange(lastData.schools, 'enrollment'),
      });
    }

    // Refresh selection / nationwide summary now that data has loaded.
    // Don't clobber an open school detail card.
    if (!(lastFilters && lastFilters.school)) {
      notifySelection();
    }

    // Prefer filtered counts; keep setup/error notes from this render pass.
    const filtered = computeFilteredStatus({ setupNeeded: status.setupNeeded });
    if (status.setupNeeded) {
      filtered.notes = (status.notes && status.notes.length)
        ? status.notes
        : filtered.notes;
    } else if (status.notes && status.notes.length) {
      // Keep useful load notes (boundary failures, tips) when filter notes are empty.
      const tip = status.notes.filter((n) => !String(n).startsWith('States:')
        && !String(n).startsWith('Districts:')
        && !String(n).startsWith('Schools:'));
      if (tip.length && !filtered.notes.length) filtered.notes = tip;
    }
    if (opts.onStatus) opts.onStatus(filtered);
    Object.assign(status, filtered);

    // Fit bounds to the most specific scope available (unless a silent refresh).
    if (opt.skipFit || !autoFitAllowed()) return status;
    const selectedSchool = filters.school
      ? (lastData.schools || []).find((r) => String(r.ncessch) === String(filters.school))
      : null;
    const wantLea = filters.leaid ? padLeaid(filters.leaid) : '';
    const selectedFc = wantLea
      ? {
        type: 'FeatureCollection',
        features: (lastDistrictFc.features || []).filter((f) => {
          const ids = leaKeys(f.properties && (f.properties.leaid || f.properties.GEOID));
          return ids.includes(wantLea) || ids.includes(String(filters.leaid).trim());
        }),
      }
      : emptyFc();
    if (selectedSchool && selectedSchool.longitude != null && selectedSchool.latitude != null) {
      fitTo(schoolsToFc([selectedSchool]), 14);
    } else if (filters.leaid && selectedFc.features.length) {
      fitTo(selectedFc, 12);
    } else if (filters.leaid && (lastData.schools || []).length) {
      fitTo(schoolsToFc(lastData.schools), 13);
    } else if (filters.state && stateBoundary.features.length) {
      fitTo(stateBoundary, 8);
    } else if (filters.state && (lastData.schools || []).length) {
      fitTo(schoolsToFc(lastData.schools), 9);
    } else if (filters.state && STATE_CENTROIDS[filters.state]) {
      flyToCenter(STATE_CENTROIDS[filters.state], 6, 800);
    } else if (lastData.states.length) {
      flyToCenter(CFG.center || [-98.5, 39.5], CFG.zoom || 3.4, 600);
    }

    return status;
  }

  function resize() {
    if (map) map.resize();
  }

  const BASEMAPS = {
    light: 'mapbox://styles/mapbox/light-v11',
    streets: 'mapbox://styles/mapbox/streets-v12',
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  };

  let currentBasemap = 'light';
  const AUTO_SAT_SOURCE = 'nces-auto-satellite';
  const AUTO_SAT_LAYER = 'nces-auto-satellite-fill';
  /** Light→satellite crossfade while zooming in (school / campus views). */
  const AUTO_SAT_ZOOM_START = 11.6;
  const AUTO_SAT_ZOOM_END = 13.8;

  /**
   * Raster satellite under street labels; opacity rises with zoom.
   * Skipped when the full Satellite basemap is already active.
   */
  function ensureAutoSatelliteLayer() {
    if (!map) return;
    if (currentBasemap === 'satellite') {
      if (map.getLayer(AUTO_SAT_LAYER)) {
        try { map.setLayoutProperty(AUTO_SAT_LAYER, 'visibility', 'none'); } catch (_) { /* ignore */ }
      }
      return;
    }

    if (!map.getSource(AUTO_SAT_SOURCE)) {
      map.addSource(AUTO_SAT_SOURCE, {
        type: 'raster',
        url: 'mapbox://mapbox.satellite',
        tileSize: 256,
      });
    }

    if (!map.getLayer(AUTO_SAT_LAYER)) {
      const styleLayers = (map.getStyle() && map.getStyle().layers) || [];
      // Sit above basemap land/water, below Mapbox place/road labels.
      const beforeId = styleLayers.find((l) =>
        l.type === 'symbol'
        && l.id !== 'schools-dots'
        && !String(l.id).startsWith('region-')
      )?.id;
      const layer = {
        id: AUTO_SAT_LAYER,
        type: 'raster',
        source: AUTO_SAT_SOURCE,
        layout: { visibility: 'visible' },
        paint: {
          // Steep ramp: light stays clear longer, then snaps to satellite quickly.
          'raster-opacity': [
            'interpolate', ['linear'], ['zoom'],
            AUTO_SAT_ZOOM_START, 0,
            AUTO_SAT_ZOOM_END, 0.95,
          ],
        },
      };
      if (beforeId && map.getLayer(beforeId)) map.addLayer(layer, beforeId);
      else map.addLayer(layer);
    } else {
      try {
        map.setLayoutProperty(AUTO_SAT_LAYER, 'visibility', 'visible');
        map.setPaintProperty(AUTO_SAT_LAYER, 'raster-opacity', [
          'interpolate', ['linear'], ['zoom'],
          AUTO_SAT_ZOOM_START, 0,
          AUTO_SAT_ZOOM_END, 0.95,
        ]);
      } catch (_) { /* ignore */ }
    }
  }

  // Switch basemap. setStyle wipes custom layers, so re-add them and re-render
  // once the new style has loaded — keep the exact camera (no re-fit).
  function setBasemap(key) {
    if (!map) return;
    const next = BASEMAPS[key] ? key : 'light';
    if (next === currentBasemap && map.isStyleLoaded && map.isStyleLoaded()) return;
    currentBasemap = next;
    const url = BASEMAPS[currentBasemap] || BASEMAPS.light;
    const camera = {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    };
    map.once('style.load', async () => {
      const restoreCamera = () => {
        try {
          map.jumpTo({
            center: camera.center,
            zoom: camera.zoom,
            bearing: camera.bearing,
            pitch: camera.pitch,
          });
        } catch (_) { /* ignore */ }
      };
      restoreCamera();
      addLayers();
      applyMetricPaint();
      applyVisibility();
      applySelectionFilter();
      applySchoolChangePaint();
      // Restore nationwide boundary data (setStyle recreates empty sources).
      if (allStatesFc.features.length && map.getSource('state-outline')) {
        setStateOutlineData(allStatesFc);
      }
      if (allDistrictsFc.features.length && map.getSource('districts-all')) {
        map.getSource('districts-all').setData(allDistrictsFc);
      }
      if (lastDistrictFc.features.length) {
        setDistrictsSourceData(lastDistrictFc);
      }
      if (lastData.schools && lastData.schools.length && map.getSource('schools')) {
        try { map.getSource('schools').setData(schoolsToFc(lastData.schools)); } catch (_) { /* ignore */ }
      }
      refreshDistrictRegionsSource();
      refreshHsAreasSource();
      // Re-apply filters/paints without flying/fitting away from the saved view.
      if (lastFilters && Object.keys(lastFilters).length) {
        try { await render(lastFilters, { skipFit: true }); } catch (_) { /* ignore */ }
      }
      restoreCamera();
    });
    map.setStyle(url);
  }

  global.NcesMap = {
    ensureInit,
    setClient,
    setLayerVisible,
    setBoundaryMode,
    getLayerVisibility,
    setColorByEnrollment,
    setColorMetric,
    setChangeYears,
    setChangeField,
    getChangeYears,
    warmChangeCaches,
    setCameraLock,
    closeDetail,
    openDetail,
    flyCamera,
    schoolLngLat,
    getLoadedSchools: () => (lastData.schools || []).slice(),
    setSchools,
    focusSchool,
    getSchoolLoadStatus,
    debugSchools,
    loadSchoolsForScope,
    loadNationwideSchools,
    pauseNationwideSchools,
    resumeNationwideSchools,
    stopNationwideSchools,
    setStateFilterMode,
    setSchoolLevels,
    setSchoolMarkerMode,
    setSchoolTypeRing,
    getSchoolTypeRing,
    setSizeRange,
    setBasemap,
    ensureAutoSatelliteLayer,
    clearSelection,
    presentFilterScope,
    getSelection,
    setDistrictRegions,
    setRegionEditing,
    setRegionEditFocus,
    setRegionLayersVisible,
    setHsAreasVisible,
    setHsAssignMode,
    selectHsArea,
    assignSelectedHsRegion,
    assignHsRegion,
    isHsAssignMode: () => hsAssignMode,
    isHsAreasVisible: () => hsAreasVisible,
    getSelectedHsName: () => selectedHsName,
    getHsAssignments: () => (global.MCPS_HS_AREAS ? global.MCPS_HS_AREAS.getAssignments() : []),
    getRegionCoordinatesText,
    resetRegionCoordinates,
    isRegionEditing: () => regionEditActive,
    stateForLeaid,
    ensureDetailedStateBoundaries,
    kickNationwideDistricts,
    render,
    resize,
    isReady,
    LEVEL_COLORS,
    LEVEL_LABELS,
    SCHOOL_SHAPES,
    COLOR_METRICS,
    SCHOOL_CHANGE_SCALE,
    CHANGE_PCT_SCALE,
  };
})(window);
