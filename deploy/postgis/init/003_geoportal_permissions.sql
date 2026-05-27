DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoportal_readonly') THEN
    CREATE ROLE geoportal_readonly NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'geoportal_editor') THEN
    CREATE ROLE geoportal_editor NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA geoportal TO geoportal_readonly;
GRANT USAGE ON SCHEMA geoportal TO geoportal_editor;

GRANT SELECT ON ALL TABLES IN SCHEMA geoportal TO geoportal_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA geoportal TO geoportal_editor;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA geoportal TO geoportal_editor;

ALTER DEFAULT PRIVILEGES IN SCHEMA geoportal
  GRANT SELECT ON TABLES TO geoportal_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA geoportal
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO geoportal_editor;

ALTER DEFAULT PRIVILEGES IN SCHEMA geoportal
  GRANT USAGE, SELECT ON SEQUENCES TO geoportal_editor;