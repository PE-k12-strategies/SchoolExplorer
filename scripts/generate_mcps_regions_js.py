"""Generate js/mcps-regions.js from dissolved HS region coordinates."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COORDS = Path(__file__).resolve().parent / "mcps-regions-coords.json"
OUT = ROOT / "js" / "mcps-regions.js"

META = [
    {
        "code": 1,
        "name": "Region 1",
        "color": "#f9a8d4",
        "articulations": [
            "Walt Whitman",
            "Bethesda-Chevy Chase",
            "Albert Einstein",
            "Wheaton",
            "John F. Kennedy",
            "Northwood",
            "Montgomery Blair",
        ],
        "note": "South / southeast — Bethesda, Chevy Chase, Silver Spring, Wheaton",
    },
    {
        "code": 2,
        "name": "Region 2",
        "color": "#e7d5b8",
        "articulations": [
            "Sherwood",
            "James Hubert Blake",
            "Springbrook",
            "Paint Branch",
        ],
        "note": "East / northeast — White Oak, Burtonsville, Olney east, Sherwood",
    },
    {
        "code": 3,
        "name": "Region 3",
        "color": "#d4d4d8",
        "articulations": [
            "Rockville",
            "Walter Johnson",
            "Charles W. Woodward",
        ],
        "note": "Central / south — Rockville core, WJ, Woodward (Woodward HS not in 2024-25 HS layer)",
    },
    {
        "code": 4,
        "name": "Region 4",
        "color": "#fde047",
        "articulations": [
            "Thomas S. Wootton",
            "Richard Montgomery",
            "Winston Churchill",
        ],
        "note": "Central / southwest — Potomac, Churchill, Wootton, RM",
    },
    {
        "code": 5,
        "name": "Region 5",
        "color": "#c4b5fd",
        "articulations": [
            "Watkins Mill",
            "Gaithersburg",
            "Col. Zadok Magruder",
        ],
        "note": "Central / north — Gaithersburg, Magruder, Watkins Mill",
    },
    {
        "code": 6,
        "name": "Region 6",
        "color": "#86efac",
        "articulations": [
            "Poolesville",
            "Damascus",
            "Clarksburg",
            "Seneca Valley",
            "Northwest",
            "Quince Orchard",
        ],
        "note": "West / northwest — Germantown, Poolesville, Damascus, Clarksburg",
    },
]


def js_string_list(items: list[str], indent: str) -> str:
    inner = ",\n".join(f"{indent}  '{x}'" for x in items)
    return f"[\n{inner},\n{indent}]"


def main() -> None:
    coords = json.loads(COORDS.read_text(encoding="utf-8"))
    region_blocks = []
    for meta in META:
        code = meta["code"]
        c = coords[str(code)]
        gtype = c["geometryType"]
        coordinates = c["coordinates"]
        # Compact JSON for coordinates (one line per region would be huge; keep pretty-ish via dumps)
        coord_js = json.dumps(coordinates, separators=(",", ":"))
        arts = js_string_list(meta["articulations"], "      ")
        block = f"""    {{
      code: {code},
      name: '{meta["name"]}',
      color: '{meta["color"]}',
      articulations: {arts},
      // {meta["note"]}
      // Source: MCPS GIS HS attendance areas 2024-2025 (EPSG:2248 → WGS84), dissolved.
      geometryType: '{gtype}',
      coordinates: {coord_js},
    }}"""
        region_blocks.append(block)

    regions_js = ",\n".join(region_blocks)

    out = f"""/**
 * Montgomery County Public Schools (LEA 2400480) — six planning regions.
 * Boundaries dissolved from official MCPS GIS high-school attendance areas
 * (MCPS_GIS_Data_2024_2025 / HS.*, school year 2024-2025), reprojected from
 * NAD83 Maryland State Plane feet (EPSG:2248) to WGS84. Not from NCES.
 * Rebuild: py -3 scripts/build_mcps_regions_from_hs.py && py -3 scripts/generate_mcps_regions_js.py
 */
(function (global) {{
  const LEAID = '2400480';

  const REGIONS = [
{regions_js}
  ];

  function exteriorRings(region) {{
    const coords = region.coordinates;
    if (!coords || !coords.length) return [];
    if (region.geometryType === 'MultiPolygon') {{
      // Each polygon: [exterior, ...holes]
      return coords.map((poly) => poly[0]).filter(Boolean);
    }}
    // Polygon: [exterior, ...holes]
    return coords[0] ? [coords[0]] : [];
  }}

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

  /** True if point is inside exterior and outside all holes for one polygon ring set. */
  function pointInPolygonRings(lng, lat, rings) {{
    if (!rings || !rings.length) return false;
    if (!pointInRing(lng, lat, rings[0])) return false;
    for (let h = 1; h < rings.length; h += 1) {{
      if (pointInRing(lng, lat, rings[h])) return false;
    }}
    return true;
  }}

  function pointInRegionGeometry(lng, lat, region) {{
    const lon = Number(lng);
    const la = Number(lat);
    if (!region || Number.isNaN(lon) || Number.isNaN(la)) return false;
    if (region.geometryType === 'MultiPolygon') {{
      return (region.coordinates || []).some((poly) => pointInPolygonRings(lon, la, poly));
    }}
    return pointInPolygonRings(lon, la, region.coordinates);
  }}

  function toFeatureCollection() {{
    return {{
      type: 'FeatureCollection',
      features: REGIONS.map((r) => ({{
        type: 'Feature',
        properties: {{
          leaid: LEAID,
          region_code: r.code,
          region_name: r.name,
          color: r.color,
          articulations: r.articulations,
        }},
        geometry: {{
          type: r.geometryType || 'Polygon',
          coordinates: r.coordinates,
        }},
      }})),
    }};
  }}

  function pointInRegion(lng, lat, regionCode) {{
    const r = REGIONS.find((x) => x.code === Number(regionCode));
    return pointInRegionGeometry(lng, lat, r);
  }}

  function regionForPoint(lng, lat) {{
    if (lng == null || lat == null) return null;
    for (const r of REGIONS) {{
      if (pointInRegionGeometry(lng, lat, r)) return r.code;
    }}
    return null;
  }}

  function districtHasRegions(leaid) {{
    return String(leaid || '') === LEAID;
  }}

  /** Snapshot of shipped coordinates (for Reset). */
  const DEFAULT_COORDINATES = REGIONS.map((r) => ({{
    code: r.code,
    geometryType: r.geometryType,
    coordinates: JSON.parse(JSON.stringify(r.coordinates)),
  }}));

  /** Apply edited rings. Supports Polygon rings or full MultiPolygon coordinates. */
  function applyCoordinates(edits) {{
    if (!Array.isArray(edits)) return false;
    edits.forEach((e) => {{
      const r = REGIONS.find((x) => x.code === Number(e.code));
      if (!r || !e.coordinates) return;
      if (e.geometryType) r.geometryType = e.geometryType;
      r.coordinates = JSON.parse(JSON.stringify(e.coordinates));
    }});
    return true;
  }}

  function resetCoordinates() {{
    DEFAULT_COORDINATES.forEach((d) => {{
      const r = REGIONS.find((x) => x.code === d.code);
      if (!r) return;
      r.geometryType = d.geometryType;
      r.coordinates = JSON.parse(JSON.stringify(d.coordinates));
    }});
  }}

  /** Paste-friendly export for feeding adjusted rings back to the agent. */
  function exportCoordinatesText() {{
    const lines = [
      'MCPS region boundary coordinates (WGS84; from MCPS GIS HS 2024-2025):',
      '',
    ];
    REGIONS.forEach((r) => {{
      lines.push(`Region ${{r.code}} (${{r.name}}) [${{r.geometryType || 'Polygon'}}]:`);
      if (r.geometryType === 'MultiPolygon') {{
        lines.push(JSON.stringify(r.coordinates));
      }} else {{
        lines.push(JSON.stringify(r.coordinates[0]));
      }}
      lines.push('');
    }});
    return lines.join('\\n');
  }}

  global.MCPS_REGIONS = {{
    LEAID,
    REGIONS,
    toFeatureCollection,
    pointInRegion,
    regionForPoint,
    districtHasRegions,
    applyCoordinates,
    resetCoordinates,
    exportCoordinatesText,
    exteriorRings,
  }};
}})(typeof window !== 'undefined' ? window : globalThis);
"""
    OUT.write_text(out, encoding="utf-8")
    print("Wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
