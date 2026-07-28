"""Export individual MCPS HS attendance areas as js/mcps-hs-areas.js (WGS84)."""
from __future__ import annotations

import json
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import transform

HS_PATH = Path(r"C:\Users\d.wieberdink\Downloads\MCPS_GIS_Data_2024_2025\HS")
OUT = Path(__file__).resolve().parents[1] / "js" / "mcps-hs-areas.js"
SIMPLIFY_DEG = 0.00005

# Short display / articulation name used in the app
ARTICULATION = {
    "Whitman HS": "Walt Whitman",
    "Bethesda-Chevy Chase HS": "Bethesda-Chevy Chase",
    "Einstein HS": "Albert Einstein",
    "Wheaton HS": "Wheaton",
    "Kennedy HS": "John F. Kennedy",
    "Northwood HS": "Northwood",
    "Blair HS": "Montgomery Blair",
    "Sherwood HS": "Sherwood",
    "Blake HS": "James Hubert Blake",
    "Springbrook HS": "Springbrook",
    "Paint Branch HS": "Paint Branch",
    "Rockville HS": "Rockville",
    "Walter Johnson HS": "Walter Johnson",
    "Wootton HS": "Thomas S. Wootton",
    "Richard Montgomery HS": "Richard Montgomery",
    "Churchill HS": "Winston Churchill",
    "Watkins Mill HS": "Watkins Mill",
    "Gaithersburg HS": "Gaithersburg",
    "Magruder HS": "Col. Zadok Magruder",
    "Poolesville HS": "Poolesville",
    "Damascus HS": "Damascus",
    "Clarksburg HS": "Clarksburg",
    "Seneca Valley HS": "Seneca Valley",
    "Northwest HS": "Northwest",
    "Quince Orchard HS": "Quince Orchard",
}

# Default program-region assignment (user can change in the map UI)
DEFAULT_REGION = {
    "Whitman HS": 1,
    "Bethesda-Chevy Chase HS": 1,
    "Einstein HS": 1,
    "Wheaton HS": 1,
    "Kennedy HS": 1,
    "Northwood HS": 1,
    "Blair HS": 1,
    "Sherwood HS": 2,
    "Blake HS": 2,
    "Springbrook HS": 2,
    "Paint Branch HS": 2,
    "Rockville HS": 3,
    "Walter Johnson HS": 3,
    "Wootton HS": 4,
    "Richard Montgomery HS": 4,
    "Churchill HS": 4,
    "Watkins Mill HS": 5,
    "Gaithersburg HS": 5,
    "Magruder HS": 5,
    "Poolesville HS": 6,
    "Damascus HS": 6,
    "Clarksburg HS": 6,
    "Seneca Valley HS": 6,
    "Northwest HS": 6,
    "Quince Orchard HS": 5,
}

REGION_META = [
    {"code": 1, "name": "Program region 1", "color": "#f9a8d4"},
    {"code": 2, "name": "Program region 2", "color": "#e7d5b8"},
    {"code": 3, "name": "Program region 3", "color": "#d4d4d8"},
    {"code": 4, "name": "Program region 4", "color": "#fde047"},
    {"code": 5, "name": "Program region 5", "color": "#c4b5fd"},
    {"code": 6, "name": "Program region 6", "color": "#86efac"},
]


def round_coords(obj, ndigits=6):
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(x), ndigits) for x in obj]
        return [round_coords(x, ndigits) for x in obj]
    return obj


def main() -> None:
    transformer = Transformer.from_crs("EPSG:2248", "EPSG:4326", always_xy=True)

    def project(x, y, z=None):
        return transformer.transform(x, y)

    sf = shapefile.Reader(str(HS_PATH))
    field_names = [f[0] for f in sf.fields[1:]]
    features = []
    for sr in sf.shapeRecords():
        attrs = dict(zip(field_names, sr.record))
        hs_name = str(attrs.get("HS_csv_S_N") or "").strip()
        geom = shape(sr.shape.__geo_interface__)
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        wgs = transform(project, geom)
        if not wgs.is_valid:
            wgs = wgs.buffer(0)
        wgs = wgs.simplify(SIMPLIFY_DEG, preserve_topology=True)
        gj = mapping(wgs)
        gj["coordinates"] = round_coords(gj["coordinates"], 6)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "hs_name": hs_name,
                    "articulation": ARTICULATION.get(hs_name, hs_name.replace(" HS", "")),
                    "region_code": DEFAULT_REGION.get(hs_name),
                    "school_year": str(attrs.get("HS_csv_S_1") or ""),
                },
                "geometry": gj,
            }
        )

    features.sort(key=lambda f: f["properties"]["hs_name"])
    print(f"Exported {len(features)} HS features")

    # Embed as JS module (IIFE)
    data_json = json.dumps(
        {
            "leaid": "2400480",
            "schoolYear": "2024-2025",
            "regionMeta": REGION_META,
            "defaults": DEFAULT_REGION,
            "features": features,
        },
        separators=(",", ":"),
    )

    out = f"""/**
 * MCPS high-school attendance areas (2024-2025), WGS84.
 * Source: MCPS_GIS_Data_2024_2025/HS.* (EPSG:2248 → WGS84).
 * Rebuild: py -3 scripts/export_mcps_hs_areas.py
 */
(function (global) {{
  const DATA = {data_json};

  const STORAGE_KEY = 'mcps_hs_region_assignments_v1';

  function cloneFeatures() {{
    return JSON.parse(JSON.stringify(DATA.features));
  }}

  let features = cloneFeatures();

  function loadAssignments() {{
    try {{
      const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const map = JSON.parse(raw);
      if (!map || typeof map !== 'object') return;
      features.forEach((f) => {{
        const name = f.properties.hs_name;
        if (map[name] != null && map[name] !== '') {{
          f.properties.region_code = Number(map[name]) || null;
        }}
      }});
    }} catch (_) {{ /* ignore */ }}
  }}

  function saveAssignments() {{
    try {{
      const map = {{}};
      features.forEach((f) => {{
        map[f.properties.hs_name] = f.properties.region_code;
      }});
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }} catch (_) {{ /* ignore */ }}
  }}

  function resetAssignments() {{
    features = cloneFeatures();
    try {{
      if (global.localStorage) global.localStorage.removeItem(STORAGE_KEY);
    }} catch (_) {{ /* ignore */ }}
  }}

  function setHsRegion(hsName, regionCode) {{
    const f = features.find((x) => x.properties.hs_name === hsName);
    if (!f) return false;
    f.properties.region_code = regionCode == null || regionCode === ''
      ? null
      : Number(regionCode);
    saveAssignments();
    return true;
  }}

  function getAssignments() {{
    return features.map((f) => ({{
      hs_name: f.properties.hs_name,
      articulation: f.properties.articulation,
      region_code: f.properties.region_code,
    }}));
  }}

  function toFeatureCollection() {{
    const colorBy = {{}};
    (DATA.regionMeta || []).forEach((r) => {{ colorBy[r.code] = r.color; }});
    return {{
      type: 'FeatureCollection',
      features: features.map((f) => {{
        const code = f.properties.region_code;
        return {{
          type: 'Feature',
          properties: {{
            ...f.properties,
            region_name: code ? ('Program region ' + code) : 'Unassigned',
            color: colorBy[code] || '#94a3b8',
            label: f.properties.hs_name.replace(/ HS$/, ''),
          }},
          geometry: f.geometry,
        }};
      }}),
    }};
  }}

  /** Point-in-ring (exterior only; holes handled by caller). */
  function pointInRing(lng, lat, ring) {{
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {{
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      const intersect = ((yi > lat) !== (yj > lat))
        && (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }}
    return inside;
  }}

  function pointInGeometry(lng, lat, geometry) {{
    if (!geometry || !geometry.coordinates) return false;
    const polys = geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [geometry.coordinates];
    for (let p = 0; p < polys.length; p += 1) {{
      const rings = polys[p];
      if (!rings || !rings.length) continue;
      if (!pointInRing(lng, lat, rings[0])) continue;
      let inHole = false;
      for (let h = 1; h < rings.length; h += 1) {{
        if (pointInRing(lng, lat, rings[h])) {{ inHole = true; break; }}
      }}
      if (!inHole) return true;
    }}
    return false;
  }}

  function hsForPoint(lng, lat) {{
    if (lng == null || lat == null) return null;
    const lon = Number(lng);
    const la = Number(lat);
    for (let i = 0; i < features.length; i += 1) {{
      const f = features[i];
      if (pointInGeometry(lon, la, f.geometry)) return f;
    }}
    return null;
  }}

  function regionForPoint(lng, lat) {{
    const f = hsForPoint(lng, lat);
    return f && f.properties.region_code != null ? Number(f.properties.region_code) : null;
  }}

  /**
   * Rebuild MCPS_REGIONS polygon overlays from current HS assignments.
   * Each region becomes a MultiPolygon of its member HS geometries (no dissolve).
   */
  function applyToRegions(regionsApi) {{
    if (!regionsApi || !Array.isArray(regionsApi.REGIONS)) return false;
    const byCode = {{}};
    features.forEach((f) => {{
      const code = f.properties.region_code;
      if (code == null) return;
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push(f);
    }});

    regionsApi.REGIONS.forEach((r) => {{
      const members = byCode[r.code] || [];
      r.articulations = members.map((f) => f.properties.articulation);
      const polys = [];
      members.forEach((f) => {{
        const g = f.geometry;
        if (!g) return;
        if (g.type === 'MultiPolygon') polys.push(...g.coordinates);
        else if (g.type === 'Polygon') polys.push(g.coordinates);
      }});
      if (polys.length === 1) {{
        r.geometryType = 'Polygon';
        r.coordinates = polys[0];
      }} else if (polys.length > 1) {{
        r.geometryType = 'MultiPolygon';
        r.coordinates = polys;
      }} else {{
        r.geometryType = 'Polygon';
        r.coordinates = [];
      }}
    }});

    if (typeof regionsApi.refreshDefaults === 'function') {{
      regionsApi.refreshDefaults();
    }}
    return true;
  }}

  function exportAssignmentsText() {{
    const lines = ['MCPS HS → program region assignments:', ''];
    getAssignments()
      .sort((a, b) => String(a.region_code).localeCompare(String(b.region_code))
        || a.hs_name.localeCompare(b.hs_name))
      .forEach((a) => {{
        lines.push(`Region ${{a.region_code == null ? '—' : a.region_code}}: ${{a.hs_name}} (${{a.articulation}})`);
      }});
    return lines.join('\\n');
  }}

  loadAssignments();

  global.MCPS_HS_AREAS = {{
    LEAID: DATA.leaid,
    schoolYear: DATA.schoolYear,
    regionMeta: DATA.regionMeta,
    features,
    toFeatureCollection,
    getAssignments,
    setHsRegion,
    resetAssignments,
    saveAssignments,
    loadAssignments,
    hsForPoint,
    regionForPoint,
    applyToRegions,
    exportAssignmentsText,
  }};
}})(typeof window !== 'undefined' ? window : globalThis);
"""
    OUT.write_text(out, encoding="utf-8")
    print("Wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
