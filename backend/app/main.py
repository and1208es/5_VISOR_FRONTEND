import json
import re
from datetime import timedelta

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .auth import authenticate_user, get_current_user, require_admin
from .config import settings
from .db import engine, get_db
from .geoserver_client import GeoServerClient
from .schemas import LayerWmsResponse, LoginRequest, LoginResponse, StyleRequest
from .security import create_access_token, get_password_hash
from .services.upload_service import load_upload_into_postgis


app = FastAPI(title=settings.app_name)
geoserver = GeoServerClient()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_base_tables() -> None:
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS geoportal"))
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS geoportal.app_users (
                    username text PRIMARY KEY,
                    password_hash text NOT NULL,
                    role text NOT NULL CHECK (role in ('admin', 'consultor')),
                    is_active boolean NOT NULL DEFAULT true,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS geoportal.layer_metadata (
                    layer_name text PRIMARY KEY,
                    source_filename text,
                    srid integer DEFAULT 4326,
                    is_active boolean NOT NULL DEFAULT true,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS geoportal.activity_log (
                    id bigserial PRIMARY KEY,
                    username text,
                    action text NOT NULL,
                    layer_name text,
                    details jsonb,
                    created_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
        )

        exists = conn.execute(
            text("SELECT 1 FROM geoportal.app_users WHERE username = :username"),
            {"username": settings.app_admin_user},
        ).first()

        if not exists:
            conn.execute(
                text(
                    """
                    INSERT INTO geoportal.app_users (username, password_hash, role)
                    VALUES (:username, :password_hash, 'admin')
                    """
                ),
                {
                    "username": settings.app_admin_user,
                    "password_hash": get_password_hash(settings.app_admin_password),
                },
            )


def _safe_identifier(value: str) -> str:
    if not value or not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]{0,62}$", value):
        raise HTTPException(status_code=400, detail="Nombre de capa inválido")
    return value


@app.on_event("startup")
def startup() -> None:
    _ensure_base_tables()
    geoserver.ensure_workspace()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": settings.app_name}


@app.post("/api/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="Usuario o clave inválidos")

    token = create_access_token(
        subject=user["username"],
        role=user["role"],
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )
    return LoginResponse(access_token=token, role=user["role"])


@app.post("/api/upload")
def upload_layer(
    file: UploadFile = File(...),
    user=Depends(require_admin),
):
    try:
        content = file.file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Archivo vacío")

        load_result = load_upload_into_postgis(content, file.filename, engine)
        layer_name = load_result["layer_name"]

        geoserver.ensure_workspace()
        geoserver.create_or_replace_datastore(layer_name)
        geoserver.publish_feature_type(layer_name, layer_name, title=layer_name)

        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO geoportal.activity_log (username, action, layer_name, details) "
                    "VALUES (:username, 'upload_layer', :layer_name, :details::jsonb)"
                ),
                {
                    "username": user["username"],
                    "layer_name": layer_name,
                    "details": json.dumps(
                        {
                            "filename": file.filename,
                            "features": load_result["feature_count"],
                        }
                    ),
                },
            )

        return {
            "ok": True,
            "message": "Capa cargada y publicada correctamente",
            **load_result,
            "workspace": settings.geoserver_workspace,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error procesando carga: {exc}") from exc


@app.get("/api/layers")
def get_layers(user=Depends(get_current_user), db: Session = Depends(get_db)):
    layers = geoserver.list_layers()
    metadata_rows = db.execute(
        text("SELECT layer_name, is_active, source_filename FROM geoportal.layer_metadata")
    ).mappings().all()
    metadata_map = {row["layer_name"]: row for row in metadata_rows}

    for layer in layers:
        md = metadata_map.get(layer["name"])
        layer["is_active"] = bool(md["is_active"]) if md else True
        layer["source_filename"] = md["source_filename"] if md else None

    return {"items": layers, "count": len(layers)}


@app.delete("/api/layers/{layer_name}")
def delete_layer(layer_name: str, user=Depends(require_admin)):
    try:
        safe_layer = _safe_identifier(layer_name)
        geoserver.delete_layer(safe_layer)
        with engine.begin() as conn:
            conn.execute(text(f'DROP TABLE IF EXISTS "{settings.db_schema}"."{safe_layer}" CASCADE'))
            conn.execute(
                text("DELETE FROM geoportal.layer_metadata WHERE layer_name = :layer_name"),
                {"layer_name": safe_layer},
            )
            conn.execute(
                text(
                    "INSERT INTO geoportal.activity_log (username, action, layer_name, details) "
                    "VALUES (:username, 'delete_layer', :layer_name, :details::jsonb)"
                ),
                {
                    "username": user["username"],
                    "layer_name": safe_layer,
                    "details": json.dumps({"result": "ok"}),
                },
            )
        return {"ok": True, "layer_name": safe_layer}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error eliminando capa: {exc}") from exc


@app.post("/api/layers/{layer_name}/style")
def update_layer_style(layer_name: str, payload: StyleRequest, user=Depends(require_admin)):
    safe_layer = _safe_identifier(layer_name)
    style_name = f"{safe_layer}_style"
    sld = f"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<sld:StyledLayerDescriptor xmlns=\"http://www.opengis.net/sld\" xmlns:sld=\"http://www.opengis.net/sld\" xmlns:ogc=\"http://www.opengis.net/ogc\" version=\"1.0.0\">
  <sld:NamedLayer>
    <sld:Name>{safe_layer}</sld:Name>
    <sld:UserStyle>
      <sld:FeatureTypeStyle>
        <sld:Rule>
          <sld:PolygonSymbolizer>
            <sld:Fill>
              <sld:CssParameter name=\"fill\">{payload.fill_color}</sld:CssParameter>
              <sld:CssParameter name=\"fill-opacity\">{payload.opacity}</sld:CssParameter>
            </sld:Fill>
            <sld:Stroke>
              <sld:CssParameter name=\"stroke\">{payload.color}</sld:CssParameter>
              <sld:CssParameter name=\"stroke-width\">1.2</sld:CssParameter>
            </sld:Stroke>
          </sld:PolygonSymbolizer>
        </sld:Rule>
      </sld:FeatureTypeStyle>
    </sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>
"""
    try:
        geoserver.upload_style(safe_layer, style_name, sld)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO geoportal.activity_log (username, action, layer_name, details) "
                    "VALUES (:username, 'update_style', :layer_name, :details::jsonb)"
                ),
                {
                    "username": user["username"],
                    "layer_name": safe_layer,
                    "details": json.dumps(
                        {
                            "color": payload.color,
                            "fill_color": payload.fill_color,
                            "opacity": payload.opacity,
                        }
                    ),
                },
            )
        return {"ok": True, "layer_name": safe_layer, "style_name": style_name}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error aplicando estilo: {exc}") from exc


@app.get("/api/layers/{layer_name}/wms", response_model=LayerWmsResponse)
def get_layer_wms(layer_name: str, user=Depends(get_current_user)):
    safe_layer = _safe_identifier(layer_name)
    return LayerWmsResponse(
        layer_name=safe_layer,
        workspace=settings.geoserver_workspace,
        wms_url=f"/geoserver/{settings.geoserver_workspace}/wms",
        params={
            "layers": f"{settings.geoserver_workspace}:{safe_layer}",
            "format": "image/png",
            "transparent": True,
            "version": "1.1.1",
        },
    )


@app.patch("/api/layers/{layer_name}/active")
def set_layer_active(layer_name: str, enabled: bool, user=Depends(require_admin)):
    safe_layer = _safe_identifier(layer_name)
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE geoportal.layer_metadata "
                "SET is_active = :enabled, updated_at = now() "
                "WHERE layer_name = :layer_name"
            ),
            {"enabled": enabled, "layer_name": safe_layer},
        )
        conn.execute(
            text(
                "INSERT INTO geoportal.activity_log (username, action, layer_name, details) "
                "VALUES (:username, 'toggle_layer', :layer_name, :details::jsonb)"
            ),
            {
                "username": user["username"],
                "layer_name": safe_layer,
                "details": json.dumps({"enabled": enabled}),
            },
        )
    return {"ok": True, "layer_name": safe_layer, "enabled": enabled}
