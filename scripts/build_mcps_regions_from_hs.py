"""
Build MCPS program-region GeoJSON from official 2024-2025 HS attendance shapefile.
Reprojects EPSG:2248 (MD State Plane US feet) -> WGS84, dissolves by region articulations.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union

HS_PATH = Path(r"C:\Users\d.wieberdink\Downloads\MCPS_GIS_Data_2024_2025\HS")
OUT_JSON = Path(__file__).resolve().parent / "mcps-regions-from-hs.json"
OUT_JS_SNIPPET = Path(__file__).resolve().parent / "mcps-regions-coords.json"

# Articulation display names (app) -> substrings that match HS_csv_S_N
REGIONS = [
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
        "hs_match": [
            "Whitman HS",
            "Bethesda-Chevy Chase HS",
            "Einstein HS",
            "Wheaton HS",
            "Kennedy HS",
            "Northwood HS",
            "Blair HS",
        ],
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
        "hs_match": [
            "Sherwood HS",
            "Blake HS",
            "Springbrook HS",
            "Paint Branch HS",
        ],
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
        # Woodward not in 2024-25 HS layer (reopened; boundary may still be under WJ)
        "hs_match": [
            "Rockville HS",
            "Walter Johnson HS",
        ],
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
        "hs_match": [
            "Wootton HS",
            "Richard Montgomery HS",
            "Churchill HS",
        ],
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
        "hs_match": [
            "Watkins Mill HS",
            "Gaithersburg HS",
            "Magruder HS",
        ],
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
        "hs_match": [
            "Poolesville HS",
            "Damascus HS",
            "Clarksburg HS",
            "Seneca Valley HS",
            "Northwest HS",
            "Quince Orchard HS",
        ],
    },
]

# ~3–5 ft tolerance in projected feet, then simplify in degrees after reproject
SIMPLIFY_DEG = 0.00005  # ~5.5 m


def shp_to_shapely(shp) -> Polygon | MultiPolygon:
    geo = shp.__geo_interface__
    return shape(geo)


def round_coords(obj, ndigits=6):
    """Recursively round coordinate arrays for smaller JS."""
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(x), ndigits) for x in obj]
        return [round_coords(x, ndigits) for x in obj]
    return obj


def main() -> None:
    transformer = Transformer.from_crs("EPSG:2248", "EPSG:4326", always_xy=True)

    def project(x, y, z=None):
        lng, lat = transformer.transform(x, y)
        return (lng, lat)

    sf = shapefile.Reader(str(HS_PATH))
    field_names = [f[0] for f in sf.fields[1:]]
    records = []
    for shape_rec in sf.shapeRecords():
        attrs = dict(zip(field_names, shape_rec.record))
        name = str(attrs.get("HS_csv_S_N") or "").strip()
        geom = shp_to_shapely(shape_rec.shape)
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = geom.buffer(0)
        records.append({"name": name, "geom": geom})

    print("HS features:", len(records))
    for r in records:
        print(" ", r["name"])

    matched_names = set()
    features = []
    coords_by_code = {}

    for region in REGIONS:
        geoms = []
        used = []
        for hs_name in region["hs_match"]:
            hits = [r for r in records if r["name"] == hs_name]
            if not hits:
                # fuzzy: strip punctuation / allow without HS
                key = re.sub(r"\s+", " ", hs_name.lower().replace(" hs", "")).strip()
                hits = [
                    r
                    for r in records
                    if key in re.sub(r"\s+", " ", r["name"].lower().replace(" hs", "")).strip()
                ]
            if not hits:
                print(f"WARNING: no match for {hs_name!r} in region {region['code']}")
                continue
            for h in hits:
                geoms.append(h["geom"])
                used.append(h["name"])
                matched_names.add(h["name"])

        if not geoms:
            raise SystemExit(f"No geometries for region {region['code']}")

        dissolved = unary_union(geoms)
        if not dissolved.is_valid:
            dissolved = dissolved.buffer(0)
        # light clean in projected feet before reproject
        dissolved = dissolved.buffer(0)

        wgs = transform(project, dissolved)
        if not wgs.is_valid:
            wgs = wgs.buffer(0)
        wgs = wgs.simplify(SIMPLIFY_DEG, preserve_topology=True)

        gj = mapping(wgs)
        gj["coordinates"] = round_coords(gj["coordinates"], 6)

        print(
            f"Region {region['code']}: {used} -> {gj['type']} "
            f"parts={getattr(wgs, 'geoms', [wgs]).__len__() if hasattr(wgs, 'geoms') else 1}"
        )

        features.append(
            {
                "type": "Feature",
                "properties": {
                    "region_code": region["code"],
                    "region_name": region["name"],
                    "color": region["color"],
                    "articulations": region["articulations"],
                    "hs_source": used,
                },
                "geometry": gj,
            }
        )
        coords_by_code[region["code"]] = {
            "geometryType": gj["type"],
            "coordinates": gj["coordinates"],
            "hs_source": used,
        }

    unmatched = [r["name"] for r in records if r["name"] not in matched_names]
    if unmatched:
        print("UNMATCHED HS (not assigned to any region):", unmatched)

    fc = {"type": "FeatureCollection", "features": features}
    OUT_JSON.write_text(json.dumps(fc), encoding="utf-8")
    OUT_JS_SNIPPET.write_text(json.dumps(coords_by_code), encoding="utf-8")
    print("Wrote", OUT_JSON)
    print("Wrote", OUT_JS_SNIPPET)
    print("GeoJSON bytes:", OUT_JSON.stat().st_size)


if __name__ == "__main__":
    main()
