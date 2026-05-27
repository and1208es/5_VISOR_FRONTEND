import json
from typing import Any

import requests
from requests.auth import HTTPBasicAuth

from .config import settings


class GeoServerClient:
    def __init__(self) -> None:
        self.base_url = settings.geoserver_url.rstrip("/")
        self.workspace = settings.geoserver_workspace
        self.auth = HTTPBasicAuth(settings.geoserver_user, settings.geoserver_pass)
        self.headers = {"Content-Type": "application/json"}

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        response = requests.request(method, self._url(path), auth=self.auth, timeout=30, **kwargs)
        return response

    def ensure_workspace(self) -> None:
        ws_path = f"/rest/workspaces/{self.workspace}.json"
        response = self._request("GET", ws_path)
        if response.status_code == 200:
            return

        payload = {"workspace": {"name": self.workspace}}
        create_response = self._request("POST", "/rest/workspaces", json=payload, headers=self.headers)
        if create_response.status_code not in (200, 201):
            raise RuntimeError(f"No se pudo crear workspace {self.workspace}: {create_response.text}")

    def create_or_replace_datastore(self, store_name: str) -> None:
        datastore_path = f"/rest/workspaces/{self.workspace}/datastores/{store_name}.json"
        self._request("DELETE", datastore_path + "?recurse=true")

        database_url = settings.database_url
        connection = database_url.split("postgresql://", 1)[-1]
        user_part, host_part = connection.split("@", 1)
        db_user, db_password = user_part.split(":", 1)
        host_port, db_name = host_part.split("/", 1)
        if ":" in host_port:
            db_host, db_port = host_port.split(":", 1)
        else:
            db_host, db_port = host_port, "5432"

        payload = {
            "dataStore": {
                "name": store_name,
                "connectionParameters": {
                    "entry": [
                        {"@key": "dbtype", "$": "postgis"},
                        {"@key": "host", "$": db_host},
                        {"@key": "port", "$": db_port},
                        {"@key": "database", "$": db_name},
                        {"@key": "schema", "$": settings.db_schema},
                        {"@key": "user", "$": db_user},
                        {"@key": "passwd", "$": db_password},
                        {"@key": "Expose primary keys", "$": "true"},
                    ]
                },
            }
        }

        response = self._request(
            "POST",
            f"/rest/workspaces/{self.workspace}/datastores",
            data=json.dumps(payload),
            headers=self.headers,
        )
        if response.status_code not in (200, 201):
            raise RuntimeError(f"No se pudo crear datastore {store_name}: {response.text}")

    def publish_feature_type(self, store_name: str, layer_name: str, title: str | None = None) -> None:
        payload = {
            "featureType": {
                "name": layer_name,
                "nativeName": layer_name,
                "title": title or layer_name,
            }
        }
        response = self._request(
            "POST",
            f"/rest/workspaces/{self.workspace}/datastores/{store_name}/featuretypes",
            data=json.dumps(payload),
            headers=self.headers,
        )
        if response.status_code not in (200, 201):
            raise RuntimeError(f"No se pudo publicar la capa {layer_name}: {response.text}")

    def delete_layer(self, layer_name: str) -> None:
        self._request("DELETE", f"/rest/layers/{self.workspace}:{layer_name}?recurse=true")
        self._request(
            "DELETE",
            f"/rest/workspaces/{self.workspace}/datastores/{layer_name}?recurse=true",
        )

    def list_layers(self) -> list[dict[str, str]]:
        response = self._request("GET", f"/rest/workspaces/{self.workspace}/layers.json")
        if response.status_code != 200:
            return []

        payload = response.json()
        layers = payload.get("layers", {}).get("layer", [])
        if isinstance(layers, dict):
            layers = [layers]

        result = []
        for entry in layers:
            name = entry.get("name", "")
            result.append(
                {
                    "name": name.split(":", 1)[-1],
                    "workspace": self.workspace,
                    "qualified_name": name,
                    "wms_url": f"/geoserver/{self.workspace}/wms",
                }
            )
        return result

    def upload_style(self, layer_name: str, sld_name: str, sld_body: str) -> None:
        style_path = f"/rest/workspaces/{self.workspace}/styles"
        payload = {"style": {"name": sld_name, "filename": f"{sld_name}.sld"}}
        self._request("POST", style_path, data=json.dumps(payload), headers=self.headers)

        put_response = self._request(
            "PUT",
            f"/rest/workspaces/{self.workspace}/styles/{sld_name}",
            data=sld_body,
            headers={"Content-Type": "application/vnd.ogc.sld+xml"},
        )
        if put_response.status_code not in (200, 201):
            raise RuntimeError(f"No se pudo subir estilo {sld_name}: {put_response.text}")

        layer_payload = {"layer": {"defaultStyle": {"name": sld_name, "workspace": self.workspace}}}
        apply_response = self._request(
            "PUT",
            f"/rest/layers/{self.workspace}:{layer_name}",
            data=json.dumps(layer_payload),
            headers=self.headers,
        )
        if apply_response.status_code not in (200, 201):
            raise RuntimeError(f"No se pudo aplicar estilo a la capa {layer_name}: {apply_response.text}")
