var todayEl = document.getElementById("today-date");
var selectionPanelEl = document.getElementById("selection-panel");
var fieldsEl = document.getElementById("sel-fields");
var GEOSERVER_BASE_URL = window.GEOSERVER_BASE_URL || "/geoserver";

// Ajusta este valor cuando en GeoServer tengas seed/cache de MVT a mas zoom.
var DATA_MAX_ZOOM = 22;

todayEl.textContent = new Date().toLocaleDateString("es-PE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
});

// Crear mapa centrado en Ayacucho.
var map = L.map("map", {
  maxZoom: DATA_MAX_ZOOM
}).setView([-12.520928727075642, -73.83971998253236], 17);

// Extension real de la capa en WGS84 (tomada de WMTS GetCapabilities).
var lotesBounds = L.latLngBounds(
  [-12.522877757847823, -73.9776522848367],
  [-12.168404765620012, -73.8211851939101]
);

// Evita solicitar tiles fuera del rango valido de la capa.
map.setMaxBounds(lotesBounds.pad(0.02));

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap",
  maxNativeZoom: DATA_MAX_ZOOM,
  maxZoom: DATA_MAX_ZOOM
}).addTo(map);

var DEFAULT_STYLE = {
  fill: true,
  weight: 1,
  color: "black",
  fillColor: "yellow",
  fillOpacity: 0.6
};

var SELECTED_STYLE = {
  fill: true,
  weight: 3,
  color: "#0a5aa7",
  fillColor: "#ffe14d",
  fillOpacity: 0.88
};

var MANZANAS_STYLE = {
  fill: true,
  weight: 2,
  color: "#0b4f8a",
  fillColor: "#79b8f5",
  fillOpacity: 0.18
};

var selectedFeatureId = null;
var suppressNextMapClick = false;

var manzanasLayer = L.vectorGrid.protobuf(
  GEOSERVER_BASE_URL + "/gwc/service/wmts/rest/geoportal:capa_manzanas/polygon/WebMercatorQuad/{z}/{y}/{x}?format=application/vnd.mapbox-vector-tile",
  {
    vectorTileLayerStyles: {
      "geoportal:capa_manzanas": MANZANAS_STYLE,
      capa_manzanas: MANZANAS_STYLE
    },
    bounds: lotesBounds,
    maxNativeZoom: DATA_MAX_ZOOM,
    maxZoom: DATA_MAX_ZOOM,
    interactive: false
  }
).addTo(map);

manzanasLayer.on("tileerror", function (e) {
  console.error("Error cargando capa_manzanas:", e);
});

function resolveFeatureId(props) {
  var id = pickFirstProp(props || {}, [
    "id",
    "ID",
    "gid",
    "GID",
    "fid",
    "FID",
    "codigo",
    "CODIGO",
    "catastro_cod",
    "CAT_COD"
  ]);

  return id !== null ? String(id) : null;
}

var vtLayer = L.vectorGrid.protobuf(
  GEOSERVER_BASE_URL + "/gwc/service/wmts/rest/geoportal:capa_lotes/polygon/WebMercatorQuad/{z}/{y}/{x}?format=application/vnd.mapbox-vector-tile",
  {
    getFeatureId: function (feature) {
      return resolveFeatureId(feature && feature.properties ? feature.properties : {});
    },
    vectorTileLayerStyles: {
      "geoportal:capa_lotes": DEFAULT_STYLE,
      capa_lotes: DEFAULT_STYLE
    },
    bounds: lotesBounds,
    maxNativeZoom: DATA_MAX_ZOOM,
    maxZoom: DATA_MAX_ZOOM,
    interactive: true
  }
).addTo(map);

vtLayer.on("load", function () {
  if (typeof vtLayer.getDataLayerNames === "function") {
    console.log("Capas internas detectadas en el PBF:", vtLayer.getDataLayerNames());
  }
});

vtLayer.on("tileerror", function (e) {
  console.error("Error cargando tile vectorial:", e);
});

function pickFirstProp(props, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (props[key] !== undefined && props[key] !== null && props[key] !== "") {
      return props[key];
    }
  }
  return null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Agrega aqui las columnas que deseas mostrar siempre, aunque vengan vacias.
var ORDERED_FIELDS = [
  { key: "id", aliases: ["id", "ID", "gid", "GID", "fid", "FID"] },
  { key: "codigo", aliases: ["codigo", "CODIGO", "catastro_cod", "CAT_COD"] },
  { key: "cod_catas", aliases: ["cod_catas", "COD_CATAS", "cod_catastral", "COD_CATASTRAL"] },
  { key: "num_lote", aliases: ["num_lote", "NUM_LOTE", "lote", "LOTE", "numero_lote", "NUMERO_LOTE"] },
  { key: "cod_mz", aliases: ["cod_mz", "COD_MZ", "manzana", "MANZANA", "cod_manzana", "COD_MANZANA"] },
  { key: "sector", aliases: ["sector", "SECTOR", "nom_sector", "NOM_SECTOR", "zona", "ZONA"] },
  { key: "area", aliases: ["area", "AREA", "area_m2", "AREA_M2", "Shape_Area", "shape_area"] },
  { key: "perimetro", aliases: ["perimetro", "PERIMETRO", "perimeter", "PERIMETER", "Shape_Leng", "shape_leng"] },
  { key: "propietario", aliases: ["propietario", "PROPIETARIO"] },
  { key: "direccion", aliases: ["direccion", "DIRECCION"] },
  { key: "uso", aliases: ["uso", "USO"] },
  { key: "estado", aliases: ["estado", "ESTADO"] }
];

function findPropKey(props, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    var alias = aliases[i];
    if (Object.prototype.hasOwnProperty.call(props, alias)) {
      return alias;
    }
  }
  return null;
}

function formatFieldValue(value) {
  if (value === null || value === undefined || value === "") {
    return "No disponible";
  }
  if (typeof value === "number") {
    return value.toLocaleString("es-PE", { maximumFractionDigits: 6 });
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }
  return String(value);
}

function updateAllFields(props) {
  var incomingProps = props || {};
  var incomingKeys = Object.keys(incomingProps);
  var usedKeys = {};
  var rows = "";

  for (var e = 0; e < ORDERED_FIELDS.length; e++) {
    var field = ORDERED_FIELDS[e];
    var matchedKey = findPropKey(incomingProps, field.aliases);
    var value = matchedKey ? incomingProps[matchedKey] : undefined;
    var isEmpty = value === null || value === undefined || value === "";
    var rawValue = isEmpty ? "Vacio" : formatFieldValue(value);

    rows += ""
      + "<div class='field-row'>"
      + "<span class='field-key'>" + escapeHtml(field.key) + "</span>"
      + "<span class='field-value'>" + escapeHtml(rawValue) + "</span>"
      + "</div>";

    if (matchedKey) {
      usedKeys[matchedKey] = true;
    }
  }

  for (var i = 0; i < incomingKeys.length; i++) {
    var inKey = incomingKeys[i];
    if (!usedKeys[inKey]) {
      var extraValue = incomingProps[inKey];
      var extraIsEmpty = extraValue === null || extraValue === undefined || extraValue === "";
      var extraRawValue = extraIsEmpty ? "Vacio" : formatFieldValue(extraValue);
      rows += ""
        + "<div class='field-row'>"
        + "<span class='field-key'>" + escapeHtml(inKey) + "</span>"
        + "<span class='field-value'>" + escapeHtml(extraRawValue) + "</span>"
        + "</div>";
    }
  }

  if (rows === "") {
    fieldsEl.innerHTML = ""
      + "<div class='field-row'>"
      + "<span class='field-key'>Estado</span>"
      + "<span class='field-value'>No hay atributos disponibles</span>"
      + "</div>";
    return;
  }

  fieldsEl.innerHTML = rows;
}

function setPanelCompact(isCompact) {
  if (isCompact) {
    selectionPanelEl.classList.add("compact");
  } else {
    selectionPanelEl.classList.remove("compact");
  }
}

function clearSelection() {
  if (selectedFeatureId !== null) {
    vtLayer.resetFeatureStyle(selectedFeatureId);
    selectedFeatureId = null;
  }

  setPanelCompact(true);
  fieldsEl.innerHTML = ""
    + "<div class='field-row'>"
    + "<span class='field-key'>Estado</span>"
    + "<span class='field-value'>Seleccione un polígono en el mapa</span>"
    + "</div>";
}

setPanelCompact(true);

vtLayer.on("click", function (e) {
  suppressNextMapClick = true;
  var props = (e.layer && e.layer.properties) || {};
  var clickedId = resolveFeatureId(props);

  if (selectedFeatureId !== null) {
    vtLayer.resetFeatureStyle(selectedFeatureId);
    selectedFeatureId = null;
  }

  if (clickedId !== null) {
    selectedFeatureId = clickedId;
    vtLayer.setFeatureStyle(selectedFeatureId, SELECTED_STYLE);
  }

  setPanelCompact(false);
  updateAllFields(props);
});

map.on("click", function () {
  if (suppressNextMapClick) {
    suppressNextMapClick = false;
    return;
  }

  clearSelection();
});

var LayerSelectorControl = L.Control.extend({
  options: {
    position: "bottomleft"
  },

  onAdd: function () {
    var container = L.DomUtil.create("div", "leaflet-bar layer-selector-control");
    var select = L.DomUtil.create("select", "layer-selector-select", container);

    select.innerHTML = ""
      + "<option value='ambas'>Capas: Ambas</option>"
      + "<option value='lotes'>Capas: Solo Lotes</option>"
      + "<option value='manzanas'>Capas: Solo Manzanas</option>";

    L.DomEvent.disableClickPropagation(container);

    L.DomEvent.on(select, "change", function () {
      var value = select.value;

      if (value === "lotes") {
        if (!map.hasLayer(vtLayer)) map.addLayer(vtLayer);
        if (map.hasLayer(manzanasLayer)) map.removeLayer(manzanasLayer);
        return;
      }

      if (value === "manzanas") {
        if (map.hasLayer(vtLayer)) map.removeLayer(vtLayer);
        if (!map.hasLayer(manzanasLayer)) map.addLayer(manzanasLayer);
        clearSelection();
        return;
      }

      if (!map.hasLayer(vtLayer)) map.addLayer(vtLayer);
      if (!map.hasLayer(manzanasLayer)) map.addLayer(manzanasLayer);
    });

    return container;
  }
});

map.addControl(new LayerSelectorControl());

// ── Filter Panel ──────────────────────────────────────────────────────────────
var filterNumLote  = document.getElementById("f-num-lote");
var filterCodMz    = document.getElementById("f-cod-mz");
var filterSector   = document.getElementById("f-sector");
var filterCodCatas = document.getElementById("f-cod-catas");
var filterStatusEl = document.getElementById("filter-status");
var btnSearch      = document.getElementById("btn-filter-search");
var btnClear       = document.getElementById("btn-filter-clear");

var WFS_URL   = GEOSERVER_BASE_URL + "/ows";
var WFS_LAYER = "geoportal:capa_lotes";

// Carga los valores únicos de sector desde GeoServer y llena el <select>
function loadSectorOptions() {
  var params = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: WFS_LAYER,
    outputFormat: "application/json",
    propertyName: "sector",
    maxFeatures: "5000"
  });

  fetch(WFS_URL + "?" + params.toString())
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data.features) return;

      var seen = {};
      var values = [];
      data.features.forEach(function (f) {
        var v = f.properties && f.properties.sector;
        if (v !== null && v !== undefined && v !== "" && !seen[v]) {
          seen[v] = true;
          values.push(String(v));
        }
      });

      values.sort(function (a, b) {
        return a.localeCompare(b, "es", { numeric: true });
      });

      values.forEach(function (val) {
        var opt = document.createElement("option");
        opt.value = val;
        opt.textContent = val;
        filterSector.appendChild(opt);
      });
    })
    .catch(function () {
      // Si falla no interrumpe; el select queda con solo "— Todos —"
    });
}

loadSectorOptions();

function setFilterStatus(msg, type) {
  filterStatusEl.textContent = msg;
  filterStatusEl.className = "filter-status" + (type ? " " + type : "");
}

function buildCqlFilter() {
  var parts = [];
  var numLote  = filterNumLote.value.trim();
  var codMz    = filterCodMz.value.trim();
  var sector   = filterSector.value.trim();
  var codCatas = filterCodCatas.value.trim();

  if (numLote)   parts.push("num_lote ILIKE '%" + numLote.replace(/'/g, "''") + "%'");
  if (codMz)     parts.push("cod_mz ILIKE '%" + codMz.replace(/'/g, "''") + "%'");
  if (sector)    parts.push("sector = '" + sector.replace(/'/g, "''") + "'");
  if (codCatas)  parts.push("cod_catas ILIKE '%" + codCatas.replace(/'/g, "''") + "%'");

  return parts.length > 0 ? parts.join(" AND ") : null;
}

function getGeometryCenter(geometry) {
  if (!geometry) return null;
  var coords = [];

  function collect(geom) {
    if (geom.type === "Point") {
      coords.push(geom.coordinates);
    } else if (geom.type === "LineString" || geom.type === "MultiPoint") {
      coords = coords.concat(geom.coordinates);
    } else if (geom.type === "Polygon") {
      coords = coords.concat(geom.coordinates[0]);
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach(function (p) { coords = coords.concat(p[0]); });
    } else if (geom.type === "MultiLineString") {
      geom.coordinates.forEach(function (l) { coords = coords.concat(l); });
    }
  }

  collect(geometry);
  if (coords.length === 0) return null;

  var minLon = coords[0][0], maxLon = coords[0][0];
  var minLat = coords[0][1], maxLat = coords[0][1];
  coords.forEach(function (c) {
    if (c[0] < minLon) minLon = c[0];
    if (c[0] > maxLon) maxLon = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  });

  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

function searchFeatures() {
  var cql = buildCqlFilter();
  if (!cql) {
    setFilterStatus("Ingresa al menos un criterio de búsqueda.", "error");
    return;
  }

  setFilterStatus("Buscando...");

  var params = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: WFS_LAYER,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    maxFeatures: "1",
    CQL_FILTER: cql
  });

  fetch(WFS_URL + "?" + params.toString())
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      if (!data.features || data.features.length === 0) {
        setFilterStatus("No se encontraron predios con esos criterios.", "error");
        return;
      }

      var feature = data.features[0];
      var center  = getGeometryCenter(feature.geometry);

      if (!center) {
        setFilterStatus("Predio encontrado pero sin geometría.", "error");
        return;
      }

      map.flyTo(center, 20, { duration: 1.2 });

      var props = feature.properties || {};
      var fid   = resolveFeatureId(props);

      if (selectedFeatureId !== null) {
        vtLayer.resetFeatureStyle(selectedFeatureId);
        selectedFeatureId = null;
      }

      if (fid !== null) {
        selectedFeatureId = fid;
        vtLayer.setFeatureStyle(fid, SELECTED_STYLE);
      }

      setPanelCompact(false);
      updateAllFields(props);
      setFilterStatus("Predio encontrado.", "success");
    })
    .catch(function (err) {
      setFilterStatus("Error al consultar GeoServer: " + err.message, "error");
    });
}

btnSearch.addEventListener("click", function () { searchFeatures(); });

[filterNumLote, filterCodMz, filterCodCatas].forEach(function (input) {
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") searchFeatures();
  });
});

btnClear.addEventListener("click", function () {
  filterNumLote.value  = "";
  filterCodMz.value    = "";
  filterSector.selectedIndex = 0;
  filterCodCatas.value = "";
  setFilterStatus("");
  clearSelection();
});
