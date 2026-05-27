import os
import re
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely import make_valid
from sqlalchemy import text
from sqlalchemy.engine import Engine

from ..config import settings


ALLOWED_SUFFIXES = {".zip", ".geojson", ".json", ".kml", ".csv", ".gpkg", ".shp"}


def sanitize_layer_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", name.strip().lower())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    if not cleaned:
        cleaned = "capa"
    if cleaned[0].isdigit():
        cleaned = f"capa_{cleaned}"
    return cleaned[:50]


def _read_geodata(path: Path) -> gpd.GeoDataFrame:
    suffix = path.suffix.lower()

    if suffix == ".zip":
        with tempfile.TemporaryDirectory() as unzip_dir:
            with zipfile.ZipFile(path, "r") as zf:
                zf.extractall(unzip_dir)
            shp_files = list(Path(unzip_dir).rglob("*.shp"))
            if not shp_files:
                raise ValueError("El ZIP no contiene .shp")
            return gpd.read_file(shp_files[0])

    if suffix == ".csv":
        df = pd.read_csv(path)
        has_lon = "lon" in df.columns or "longitude" in df.columns
        has_lat = "lat" in df.columns or "latitude" in df.columns
        if not (has_lon and has_lat):
            raise ValueError("CSV debe incluir columnas lon/lat o longitude/latitude")
        lon_col = "lon" if "lon" in df.columns else "longitude"
        lat_col = "lat" if "lat" in df.columns else "latitude"
        return gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df[lon_col], df[lat_col]), crs="EPSG:4326")

    return gpd.read_file(path)


def load_upload_into_postgis(file_bytes: bytes, filename: str, engine: Engine) -> dict:
    file_path = Path(filename)
    suffix = file_path.suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"Formato no soportado: {suffix}")

    layer_name = sanitize_layer_name(file_path.stem)

    with tempfile.TemporaryDirectory() as temp_dir:
        tmp_path = Path(temp_dir) / file_path.name
        tmp_path.write_bytes(file_bytes)

        gdf = _read_geodata(tmp_path)

        if gdf.empty:
            raise ValueError("El archivo no contiene entidades")

        if gdf.crs is None:
            gdf = gdf.set_crs("EPSG:4326", allow_override=True)
        if str(gdf.crs).upper() not in ("EPSG:4326", "WGS 84"):
            gdf = gdf.to_crs(epsg=4326)

        gdf = gdf[gdf.geometry.notnull()].copy()
        gdf["geometry"] = gdf.geometry.apply(make_valid)
        gdf = gdf[gdf.geometry.notnull()].copy()

        if gdf.empty:
            raise ValueError("No quedaron geometrías válidas luego de la validación")

        gdf.to_postgis(
            name=layer_name,
            con=engine,
            schema=settings.db_schema,
            if_exists="replace",
            index=False,
        )

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO geoportal.layer_metadata (layer_name, source_filename, srid, is_active)
                VALUES (:layer_name, :source_filename, 4326, true)
                ON CONFLICT (layer_name)
                DO UPDATE SET source_filename = EXCLUDED.source_filename, is_active = true, updated_at = now()
                """
            ),
            {"layer_name": layer_name, "source_filename": os.path.basename(filename)},
        )

    return {
        "layer_name": layer_name,
        "feature_count": int(len(gdf)),
        "geometry_type": str(gdf.geom_type.mode().iloc[0]) if not gdf.geom_type.empty else "Unknown",
    }
