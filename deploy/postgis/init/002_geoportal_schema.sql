CREATE SCHEMA IF NOT EXISTS geoportal;

CREATE OR REPLACE FUNCTION geoportal.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS geoportal.manzanas (
  manzana_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_layer TEXT NOT NULL,
  source_path TEXT,
  id_mz TEXT,
  cod_mz TEXT,
  sector TEXT,
  uso_pred TEXT,
  obs TEXT,
  area_m2 NUMERIC(14,2),
  perimetro_m NUMERIC(14,2),
  geom geometry(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS geoportal.lotes (
  lote_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_layer TEXT NOT NULL DEFAULT 'capa_lotes',
  source_path TEXT,
  source_id TEXT,
  cod_catas TEXT,
  cod_mz TEXT,
  num_lote TEXT,
  sector TEXT,
  uso TEXT,
  estado TEXT,
  condicion TEXT,
  area_m2 NUMERIC(14,2),
  perimetro_m NUMERIC(14,2),
  geom geometry(MultiPolygon, 4326) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manzanas_geom
  ON geoportal.manzanas USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_manzanas_sector
  ON geoportal.manzanas (sector);

CREATE INDEX IF NOT EXISTS idx_manzanas_cod_mz
  ON geoportal.manzanas (cod_mz);

CREATE INDEX IF NOT EXISTS idx_lotes_geom
  ON geoportal.lotes USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_lotes_sector
  ON geoportal.lotes (sector);

CREATE INDEX IF NOT EXISTS idx_lotes_cod_catas
  ON geoportal.lotes (cod_catas);

CREATE INDEX IF NOT EXISTS idx_lotes_cod_mz
  ON geoportal.lotes (cod_mz);

DROP TRIGGER IF EXISTS trg_manzanas_set_updated_at ON geoportal.manzanas;
CREATE TRIGGER trg_manzanas_set_updated_at
BEFORE UPDATE ON geoportal.manzanas
FOR EACH ROW
EXECUTE FUNCTION geoportal.set_updated_at();

DROP TRIGGER IF EXISTS trg_lotes_set_updated_at ON geoportal.lotes;
CREATE TRIGGER trg_lotes_set_updated_at
BEFORE UPDATE ON geoportal.lotes
FOR EACH ROW
EXECUTE FUNCTION geoportal.set_updated_at();