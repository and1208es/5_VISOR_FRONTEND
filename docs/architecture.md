# Arquitectura del Geoportal

## Objetivo

Separar responsabilidades para que el proyecto pueda crecer sin mezclar interfaz, publicacion geoespacial y persistencia de datos.

## Mapa de capas

### 1. Base de datos

Responsabilidad:

- almacenar lotes, manzanas y atributos catastrales;
- mantener integridad espacial y alfanumerica;
- servir como fuente oficial para publicacion.

Componentes actuales:

- PostGIS en `docker-compose.yml`;
- scripts SQL en `deploy/postgis/init/`;
- datos fuente en `data/`.

Entregables de esta capa:

- tablas y claves definidas;
- SRID unificado;
- indices espaciales;
- reglas de carga y actualizacion.

### 2. Backend geoespacial

Responsabilidad:

- conectar PostGIS con servicios de mapas y entidades;
- publicar capas y estilos;
- exponer endpoints para consumo interno y externo.

Componentes actuales:

- GeoServer en `docker-compose.yml`;
- proxy Nginx en `deploy/nginx/default.conf` y `deploy/nginx/prod.conf`;
- automatizacion REST en `setup-geoserver-rest.ps1`.

Entregables de esta capa:

- workspace y datastore configurados;
- capas publicadas;
- servicios WMS, WFS o WMTS verificados;
- politica clara de nombres y estilos.

### 3. Frontend

Responsabilidad:

- visualizar capas;
- filtrar y consultar predios;
- mostrar atributos;
- exportar vistas y operar herramientas de usuario.

Componentes actuales:

- `index.html`;
- `app.js`;
- `styles.css`.

Entregables de esta capa:

- consumo estable del backend;
- interfaz responsive;
- codigo modular por responsabilidades;
- estados de error y carga controlados.

## Flujo recomendado

```text
PostGIS -> GeoServer -> Nginx -> Frontend Leaflet
```

## Regla operativa

El frontend no debe depender de archivos fuente manuales cuando el backend geoespacial ya este estabilizado. La meta es que consulte servicios publicados, no datasets sueltos del repositorio.

## Orden de ejecucion del trabajo

### Fase 1. Datos

- definir tablas base;
- decidir origen oficial de lotes y manzanas;
- preparar carga inicial.

### Fase 2. Publicacion

- crear workspace;
- crear datastore PostGIS;
- publicar capas;
- verificar acceso por proxy.

### Fase 3. Integracion frontend

- reemplazar fuentes locales por servicios;
- desacoplar logica del mapa;
- ordenar filtros, seleccion y exportacion.

### Fase 4. Produccion

- cerrar variables de entorno;
- ajustar dominio y HTTPS;
- revisar persistencia, backups y seguridad.

## Riesgos actuales observados

- El frontend parece concentrar demasiada logica en un solo archivo `app.js`.
- Los datos fuente aun conviven con la aplicacion web, lo que dificulta separar origen oficial y consumo.
- No existe una documentacion base del sistema en el repositorio.

## Criterio profesional a seguir

- una sola fuente oficial de datos;
- backend geoespacial reproducible por Docker;
- frontend desacoplado del dataset crudo;
- documentacion minima para operar sin conocimiento tribal.