# Conexión QGIS a PostGIS y Carga de Datos

## Objetivo
Usar QGIS como herramienta para conectarse directamente a tu base de datos PostGIS y agregar/editar polígonos que se visualicen automáticamente en tu geoportal.

---

## 1. Instalación de QGIS
Si no lo tienes instalado, descárgalo desde: https://www.qgis.org/download/

---

## 2. Credenciales de tu Base de Datos PostGIS

Tus credenciales están en `.env`:

```
POSTGRES_DB=geoportal
POSTGRES_USER=geoportal_user
POSTGRES_PASSWORD=<usa_tu_valor_de_.env>
```

**HOST:** localhost (si PostGIS corre en Docker local) o IP de tu servidor  
**PUERTO:** 5433 si te conectas desde Windows/QGIS a tu Docker local  

Dentro del contenedor PostgreSQL sigue escuchando en 5432, pero en tu `docker-compose.yml` está publicado como `5433:5432`. Por eso, desde QGIS en tu PC debes usar `5433`.

---

## 3. Conectar QGIS a PostGIS

### Paso 1: Abrir QGIS

### Paso 2: Agregar conexión PostGIS
1. Ve a menú: **Layer** → **Add Layer** → **Add PostGIS Layer...**
   - O simplemente busca "PostGIS" en el navegador izquierdo

2. Click en **New** para crear nueva conexión

3. Completa los datos:
   - **Name:** geoportal_connection (o el nombre que prefieras)
   - **Host:** localhost
   - **Port:** 5433
   - **Database:** geoportal
   - **Username:** geoportal_user
   - **Password:** (tu valor de `POSTGRES_PASSWORD` en `.env`)
   - ✅ Marca **Store username/password** si quieres recordarla

4. Click en **Test Connection** para verificar

5. Si todo está bien, click en **OK**

---

## 4. Cargar Capas Existentes en QGIS

1. En el panel izquierdo, expande tu conexión PostGIS
2. Deberías ver las tablas existentes:
   - `lotes` (lotes catastrales)
   - `manzanas` (manzanas)
   - Otras capas que hayas subido

3. Selecciona una tabla y arrastrala al mapa para cargarla

---

## 5. Agregar Nuevos Polígonos

### Opción A: Digitalizar polígonos directamente en QGIS
1. Carga una capa desde PostGIS (ver paso 4)
2. Click derecho sobre la capa → **Toggle Editing**
3. Selecciona herramienta de digitalización (lápiz/polígono)
4. Dibuja nuevos polígonos en el mapa
5. Click derecho → **Finish editing** para terminar
6. File → **Save**
7. La capa se actualizará automáticamente en PostGIS

### Opción B: Importar desde archivo GeoJSON, Shapefile, etc.
1. Abre tu archivo (GeoJSON, ZIP SHP, KML, etc.)
2. Click derecho → **Export as**
3. Elige formato: **PostgreSQL**
4. Selecciona tu conexión PostGIS
5. Configura tabla destino
6. Click **OK**

### Opción C: Copiar/Pegar desde otra capa
1. Selecciona polígonos en otra capa
2. Edit → Copy
3. Abre la capa destino en PostGIS
4. Toggle Editing
5. Edit → Paste
6. Guardar cambios

---

## 6. Actualización Automática en el Geoportal

Una vez que hayas:
✅ Agregado/modificado datos en PostGIS desde QGIS  
✅ Guardado los cambios

Tu geoportal web se actualizará **automáticamente** porque:
- El backend carga las capas desde PostGIS en tiempo real
- Las queries del frontend consultan siempre las tablas más recientes

**No necesitas** volver a subir datos a la web.

---

## 7. Tablas Disponibles en tu Base de Datos

Ejecuta en QGIS o en un cliente SQL para ver todas las tablas:

```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'geoportal' 
AND table_type = 'BASE TABLE';
```

---

## 8. Crear Nueva Tabla desde Cero

Si quieres crear una nueva capa desde QGIS y guardarla en PostGIS:

1. **Layer** → **Create Layer** → **New GeoPackage Layer**
2. Define campos (ej: nombre, descripción, etc.)
3. Dibuja las geometrías
4. Guarda como GeoPackage
5. Importa a PostGIS (ver Opción B arriba)

---

## 9. Conectar Datos a tu Visualización Web

Después de agregar datos en QGIS/PostGIS:

- **Lotes catastrales:** Tabla `lotes` - mostrada en color **azul** en el mapa
- **Manzanas:** Tabla `manzanas` - mostrada en color **verde** en el mapa

El frontend busca automáticamente estas tablas. Para agregar nuevas capas visibles:

1. Agregar tabla a PostGIS desde QGIS
2. El backend necesita conocer la tabla (puede haber que actualizar las queries)

---

## 10. Diferencia: Administrar Capas (Removido) vs. QGIS

| Método | Ventaja | Desventaja |
|--------|---------|-----------|
| **Administrar Capas (Web)** | Rápido, desde el navegador | Limitado, subidas simples |
| **QGIS + PostGIS** | Control total, edición, digitalización | Requiere software local |

Ahora usas QGIS que es mucho más poderoso para edición geoespacial.

---

## 11. Troubleshooting

### Error: "No se puede conectar a la base de datos"
- Verifica que PostgreSQL/PostGIS está corriendo
- Comprueba credenciales en `.env`
- Asegúrate de que tu IP está permitida (firewall)

### Los cambios en QGIS no aparecen en el geoportal
- Guarda los cambios en QGIS (Ctrl+S)
- Recarga la página web del geoportal
- Limpia caché si es necesario

### ¿Cómo ver los datos en tiempo real?
- Abre el navegador dev (F12)
- Console → ejecuta `loadLayers()` para forzar recarga

---

## Contacto / Soporte

Para más info sobre QGIS PostGIS: https://docs.qgis.org/latest/en/docs/user_manual/managing_data_source/create_layers.html?#creating-a-new-postgis-layer-from-scratch
