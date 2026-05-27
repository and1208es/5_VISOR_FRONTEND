# Geoportal Pichari

Proyecto de visor catastral con separacion operativa entre frontend, backend geoespacial y base de datos.

## Capas del sistema

### Frontend

- Interfaz web estatica servida por Nginx.
- Renderiza el mapa, filtros, seleccion de predios y exportacion.
- Archivos actuales: `index.html`, `app.js`, `styles.css`, `img/`.

### Backend geoespacial

- GeoServer publica los datos espaciales y expone servicios OGC.
- La configuracion automatizada se apoya en `setup-geoserver-rest.ps1`.
- Orquestacion actual: servicio `geoserver` en `docker-compose.yml`.

### Base de datos

- PostGIS almacena capas, atributos y estructura espacial.
- Scripts de inicializacion en `deploy/postgis/init/`.
- Datos fuente actuales en `data/`.

## Orden de trabajo recomendado

1. Modelar y validar la base de datos.
2. Publicar y probar servicios en GeoServer.
3. Hacer que el frontend consuma servicios estables.
4. Cerrar despliegue, proxy y endurecimiento de produccion.

## Estructura actual

```text
.
|-- index.html
|-- app.js
|-- styles.css
|-- data/
|-- deploy/
|   |-- nginx/
|   `-- postgis/
`-- docker-compose.yml
```

## Estructura objetivo

```text
.
|-- frontend/
|-- backend/
|-- database/
|-- deploy/
`-- docs/
```

Esta estructura objetivo no obliga a mover todo de inmediato. Primero debemos estabilizar responsabilidades y flujo de datos.

## Arranque local

1. Crear `.env` a partir de `.env.example`.
2. Levantar infraestructura:

```powershell
docker compose up -d
```

3. Abrir el frontend en `http://localhost:8081`.
4. Configurar GeoServer con el script REST cuando la base tenga las capas listas.

## Backend administrativo (FastAPI)

El proyecto ahora incluye un backend en `backend/` para autenticacion, carga de capas y publicacion automatica en GeoServer.

Variables nuevas en `.env`:

- `API_SECRET_KEY`: clave para firmar JWT.
- `APP_ADMIN_USER`: usuario administrador inicial.
- `APP_ADMIN_PASSWORD`: clave administrador inicial.
- `GEOSERVER_WORKSPACE`: workspace de publicacion (ej: `pichari`).
- `CORS_ORIGINS`: origenes permitidos (por defecto `*`).

Endpoints principales:

- `POST /api/login`
- `POST /api/upload`
- `GET /api/layers`
- `DELETE /api/layers/{layer_name}`
- `POST /api/layers/{layer_name}/style`
- `GET /api/layers/{layer_name}/wms`

Todos los endpoints excepto `POST /api/login` usan JWT Bearer.

## Panel de administracion en el visor

Desde el boton "Administrar capas" en el encabezado del visor puedes:

1. Iniciar sesion como `admin`.
2. Subir archivos (`.zip` con shapefile, GeoJSON, KML o CSV con `lon/lat`).
3. Publicar automaticamente la capa en PostGIS + GeoServer.
4. Listar capas, eliminar capa y aplicar color basico.

## Carga inicial de datos

Con la base levantada, puedes cargar `manzanas` y `lotes` desde los GeoJSON del repositorio ejecutando:

```powershell
powershell -ExecutionPolicy Bypass -File .\load-postgis-data.ps1
```

Para validar sin escribir en la base:

```powershell
powershell -ExecutionPolicy Bypass -File .\load-postgis-data.ps1 -DryRun
```

Por defecto la carga reemplaza el contenido existente de `geoportal.manzanas` y `geoportal.lotes`. Usa `-Append` solo si necesitas anexar datos sin truncar.

## Flujo QGIS -> Frontend

Para que los cambios de poligonos hechos en QGIS se vean en el frontend, el flujo correcto es:

1. QGIS edita tablas PostGIS (`geoportal.lotes` y `geoportal.manzanas`).
2. GeoServer publica esas tablas (workspace `geoportal`).
3. El frontend consulta GeoServer por WFS (`geoportal:lotes` y `geoportal:manzanas`).

Pasos de habilitacion:

```powershell
# 1) Levantar servicios
docker compose up -d

# 2) (Una sola vez o cuando cambies fuentes) cargar datos base
powershell -ExecutionPolicy Bypass -File .\load-postgis-data.ps1

# 3) Configurar/publicar capas en GeoServer
powershell -ExecutionPolicy Bypass -File .\setup-geoserver-rest.ps1
```

Conexion recomendada en QGIS (PostgreSQL):

- Host: `localhost`
- Puerto: `5433`
- Base: valor de `POSTGRES_DB` en `.env`
- Usuario: valor de `POSTGRES_USER` en `.env`
- Password: valor de `POSTGRES_PASSWORD` en `.env`
- Esquema: `geoportal`
- Tablas: `lotes`, `manzanas`

Con esto, cada vez que guardes edicion en QGIS, los cambios quedan en PostGIS y el frontend los tomara desde GeoServer al recargar la pagina.

## Usuarios para edicion de base de datos

El sistema ahora distingue dos tipos de acceso a PostGIS:

- `geoportal_editor`: puede leer, insertar, actualizar y eliminar en el esquema `geoportal`.
- `geoportal_readonly`: puede solo leer tablas del esquema `geoportal`.

### Crear un usuario editor

```powershell
powershell -ExecutionPolicy Bypass -File .\manage-db-user.ps1 `
	-Username "qgis_editor_01" `
	-Password "cambia_esta_clave" `
	-RoleType editor `
	-ApplyPermissionsModel
```

### Crear un usuario solo lectura

```powershell
powershell -ExecutionPolicy Bypass -File .\manage-db-user.ps1 `
	-Username "visor_consulta" `
	-Password "cambia_esta_clave" `
	-RoleType readonly `
	-ApplyPermissionsModel
```

### Listar usuarios gestionados

```powershell
powershell -ExecutionPolicy Bypass -File .\manage-db-user.ps1 -ListUsers
```

### Desactivar un usuario

```powershell
powershell -ExecutionPolicy Bypass -File .\manage-db-user.ps1 `
	-Username "qgis_editor_01" `
	-DisableUser
```

### Eliminar un usuario

```powershell
powershell -ExecutionPolicy Bypass -File .\manage-db-user.ps1 `
	-Username "qgis_editor_01" `
	-DeleteUser
```

Uso recomendado:

- QGIS de edicion: conectar con un usuario `editor`.
- Visores de consulta o integraciones externas: usar un usuario `readonly`.
- Mantener `POSTGRES_USER` como usuario administrativo del sistema, no para trabajo diario.

Conexion recomendada en QGIS para usuarios nuevos:

- Host: `localhost`
- Puerto: `5433`
- Base: valor de `POSTGRES_DB` en `.env`
- Usuario: el creado con `manage-db-user.ps1`
- Password: la clave asignada al usuario
- Esquema: `geoportal`

## Vincular servicios WMS en GeoServer

Para publicar WMS de tus capas PostGIS:

1. Ejecuta la configuracion base:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup-geoserver-rest.ps1
```

2. Verifica el endpoint WMS en navegador:

```text
http://localhost:8081/geoserver/geoportal/wms?service=WMS&request=GetCapabilities
```

3. URL WMS base para clientes GIS:

```text
http://localhost:8081/geoserver/geoportal/wms
```

### Mostrar overlays WMS en el frontend

Ahora `layer-config.json` soporta capas extra en modo `wms` ademas de `wfs`.

Ejemplo:

```json
{
	"extraLayers": [
		{
			"id": "lotes_wms",
			"label": "Lotes (WMS)",
			"sourceType": "wms",
			"wmsUrl": "/geoserver/geoportal/wms",
			"wmsLayers": "geoportal:lotes",
			"wmsFormat": "image/png",
			"wmsTransparent": true,
			"visible": false
		}
	]
}
```

Campos clave para `sourceType: "wms"`:

- `wmsUrl`: endpoint WMS (por defecto usa `/geoserver/geoportal/wms`).
- `wmsLayers`: nombre de capa publicado en GeoServer, por ejemplo `geoportal:lotes`.
- `visible`: si se agrega visible al cargar el visor.

### Consumir WMS de otros geoportales

Tambien puedes mostrar servicios WMS externos (de otra entidad) en tu visor usando una URL absoluta.

Ejemplo en `layer-config.json`:

```json
{
	"extraLayers": [
		{
			"id": "catastro_externo",
			"label": "Catastro Externo",
			"sourceType": "wms",
			"wmsUrl": "https://geoportal.otrainstitucion.gob.pe/geoserver/wms",
			"wmsLayers": "catastro:predios",
			"wmsVersion": "1.1.1",
			"wmsFormat": "image/png",
			"wmsTransparent": true,
			"wmsCrs": "EPSG:4326",
			"wmsOpacity": 0.8,
			"visible": true
		}
	]
}
```

Opciones recomendadas para compatibilidad:

- `wmsCrs`: usa `EPSG:4326` o `EPSG:3857` segun el servicio remoto.
- `wmsVersion`: si el servicio falla con `1.3.0`, prueba `1.1.1`.
- `wmsExtraParams`: parametros adicionales para servidores especificos.

Ejemplo con parametros extra:

```json
{
	"id": "uso_suelo_externo",
	"label": "Uso de Suelo",
	"sourceType": "wms",
	"wmsUrl": "https://servidor.ejemplo.gob/wms",
	"wmsLayers": "plan:uso_suelo",
	"wmsCrs": "EPSG:3857",
	"wmsExtraParams": {
		"CQL_FILTER": "estado='ACTIVO'"
	},
	"visible": false
}
```

Si una capa externa no se ve:

1. Verifica que responda GetCapabilities en el navegador.
2. Si tu visor esta en `http` y el WMS esta en `https` (o viceversa), evita mezcla de protocolo.
3. Si el servidor remoto bloquea origen cruzado (CORS), debes pedir habilitacion al proveedor o exponer ese WMS mediante un proxy en tu infraestructura.

### Agregar poligonos manualmente en QGIS

Si quieres dibujar nuevos poligonos sin importar archivos completos:

1. En QGIS crea una conexion PostgreSQL al contenedor PostGIS.
2. Abre la tabla `geoportal.lotes` o `geoportal.manzanas` en modo edicion.
3. Usa la herramienta de digitalizacion para crear el nuevo poligono.
4. Completa al menos los campos clave segun la tabla:
	 `lotes`: `cod_catas`, `cod_mz`, `num_lote`, `sector`.
	 `manzanas`: `cod_mz`, `sector`.
5. Guarda edicion en QGIS.
6. Recarga el frontend en el navegador.

No necesitas regenerar GeoJSON locales para este flujo.

## Importar una capa nueva completa

Si tienes otro GeoJSON con poligonos y quieres agregarlo como una capa nueva en PostGIS, GeoServer y frontend:

```powershell
powershell -ExecutionPolicy Bypass -File .\import-geojson-layer.ps1 `
	-LayerName "equipamientos" `
	-GeoJsonFile ".\data\equipamientos.geojson" `
	-PublishToGeoServer `
	-AddToFrontend `
	-FrontendLabel "Equipamientos"
```

Ese flujo hace lo siguiente:

1. Crea o reemplaza la tabla `geoportal.equipamientos`.
2. Importa las features del GeoJSON.
3. Publica la capa en GeoServer como `geoportal:equipamientos`.
4. Registra la capa en `layer-config.json` para que el frontend la cargue como overlay adicional.

Notas operativas:

- Usa `-Append` solo si quieres anexar registros a una tabla ya existente.
- El frontend mantiene `lotes` y `manzanas` como capas principales; las capas nuevas se muestran como overlays extra.
- Para quitar una capa extra del frontend, elimina su entrada en `layer-config.json`.

## Proxima fase recomendada

- Definir el modelo de datos de lotes y manzanas en PostGIS.
- Decidir si el frontend seguira leyendo GeoJSON local o pasara a consumir WMS/WFS/WMTS de GeoServer.
- Dividir `app.js` por modulos funcionales.

Mas detalle en `docs/architecture.md`.