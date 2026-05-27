from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Geoportal Pichari API"
    app_env: str = "dev"
    secret_key: str = "change_me_super_secret"
    access_token_expire_minutes: int = 480
    algorithm: str = "HS256"

    database_url: str = "postgresql://geoportal_user:change_me_db_password@db:5432/geoportal"
    db_schema: str = "geoportal"

    geoserver_url: str = "http://geoserver:8080/geoserver"
    geoserver_workspace: str = "pichari"
    geoserver_user: str = "admin"
    geoserver_pass: str = "geoserver"

    app_admin_user: str = "admin"
    app_admin_password: str = "admin123"

    cors_origins: str = "*"


settings = Settings()
