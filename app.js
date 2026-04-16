var todayEl = document.getElementById("today-date");
var selectionPanelEl = document.getElementById("selection-panel");
var filterPanelEl = document.getElementById("filter-panel");
var mobileBackdropEl = document.getElementById("mobile-backdrop");
var fieldsEl = document.getElementById("sel-fields");
var btnMobileFilter = document.getElementById("btn-mobile-filter");
var btnMobileInfo = document.getElementById("btn-mobile-info");
var btnCloseFilter = document.getElementById("btn-close-filter");
var btnCloseInfo = document.getElementById("btn-close-info");

todayEl.textContent = new Date().toLocaleDateString("es-PE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
});

var STREETS_MAX_ZOOM = 22;
var SATELLITE_MAX_ZOOM = 22;

var map = L.map("map", { maxZoom: STREETS_MAX_ZOOM }).setView([-12.520928727075642, -73.83971998253236], 17);

var lotesBounds = L.latLngBounds(
  [-12.522877757847823, -73.9776522848367],
  [-12.168404765620012, -73.8211851939101]
);

map.setMaxBounds(lotesBounds.pad(0.02));

var osmBaseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap",
  maxZoom: STREETS_MAX_ZOOM
});

var satelliteBaseLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  maxZoom: SATELLITE_MAX_ZOOM,
  maxNativeZoom: 17
});

var currentBaseLayer = osmBaseLayer.addTo(map);

function syncOverlayOrder() {
  if (manzanasLayer && map.hasLayer(manzanasLayer)) manzanasLayer.bringToFront();
  if (lotesLayer && map.hasLayer(lotesLayer)) lotesLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
}

function switchBaseLayer(baseName) {
  var nextBaseLayer = baseName === "satelital" ? satelliteBaseLayer : osmBaseLayer;

  if (currentBaseLayer !== nextBaseLayer) {
    if (currentBaseLayer && map.hasLayer(currentBaseLayer)) map.removeLayer(currentBaseLayer);
    currentBaseLayer = nextBaseLayer;
    currentBaseLayer.addTo(map);
  }
}

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
  fillOpacity: 0.18,
  interactive: false
};

var manzanasLayer = null;
var lotesLayer    = null;
var lotesRawData  = null;

var selectedLayer = null;
var suppressNextMapClick = false;
var measurementState = {
  active: false,
  mode: null,
  points: [],
  markers: [],
  line: null,
  polygon: null,
  totalMeters: 0,
  totalArea: 0,
  readoutEl: null,
  hintEl: null,
  distanceButtonEl: null,
  areaButtonEl: null,
  clearButtonEl: null
};

function formatDistance(meters) {
  if (!meters || meters <= 0) return "0 m";
  if (meters < 1000) {
    return meters.toLocaleString("es-PE", { maximumFractionDigits: 2 }) + " m";
  }
  return (meters / 1000).toLocaleString("es-PE", { maximumFractionDigits: 3 }) + " km";
}

function formatArea(squareMeters) {
  if (!squareMeters || squareMeters <= 0) return "0 m²";
  if (squareMeters < 1000000) {
    return squareMeters.toLocaleString("es-PE", { maximumFractionDigits: 2 }) + " m²";
  }
  return (squareMeters / 1000000).toLocaleString("es-PE", { maximumFractionDigits: 3 }) + " km²";
}

function calculatePolygonArea(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  var area = 0;
  var d2r = Math.PI / 180;
  var earthRadius = 6378137.0;

  for (var i = 0; i < latlngs.length; i++) {
    var p1 = latlngs[i];
    var p2 = latlngs[(i + 1) % latlngs.length];
    area += ((p2.lng - p1.lng) * d2r) * (2 + Math.sin(p1.lat * d2r) + Math.sin(p2.lat * d2r));
  }

  return Math.abs(area * earthRadius * earthRadius / 2.0);
}

function updateMeasurementUI() {
  if (measurementState.readoutEl) {
    if (!measurementState.mode) {
      measurementState.readoutEl.textContent = "Selecciona una herramienta";
    } else if (measurementState.mode === "area") {
      measurementState.readoutEl.textContent = "Área: " + formatArea(measurementState.totalArea) + " · Perímetro: " + formatDistance(measurementState.totalMeters);
    } else {
      measurementState.readoutEl.textContent = "Distancia: " + formatDistance(measurementState.totalMeters);
    }
  }

  if (measurementState.hintEl) {
    if (!measurementState.active) {
      measurementState.hintEl.textContent = "Activa distancia o área para medir sobre el mapa.";
    } else if (measurementState.mode === "area" && measurementState.points.length < 3) {
      measurementState.hintEl.textContent = "Marca al menos 3 puntos para calcular el área.";
    } else if (measurementState.mode === "area") {
      measurementState.hintEl.textContent = "Sigue agregando vértices para refinar el polígono.";
    } else if (measurementState.points.length === 0) {
      measurementState.hintEl.textContent = "Haz clic en el mapa para iniciar la medición.";
    } else {
      measurementState.hintEl.textContent = "Sigue haciendo clic para sumar más tramos.";
    }
  }

  if (measurementState.distanceButtonEl) {
    measurementState.distanceButtonEl.classList.toggle("active", measurementState.active && measurementState.mode === "distance");
    measurementState.distanceButtonEl.setAttribute("aria-pressed", measurementState.active && measurementState.mode === "distance" ? "true" : "false");
  }

  if (measurementState.areaButtonEl) {
    measurementState.areaButtonEl.classList.toggle("active", measurementState.active && measurementState.mode === "area");
    measurementState.areaButtonEl.setAttribute("aria-pressed", measurementState.active && measurementState.mode === "area" ? "true" : "false");
  }

  if (measurementState.clearButtonEl) {
    measurementState.clearButtonEl.disabled = measurementState.points.length === 0;
  }
}

function clearMeasurement() {
  measurementState.points = [];
  measurementState.totalMeters = 0;
  measurementState.totalArea = 0;

  measurementState.markers.forEach(function (marker) {
    map.removeLayer(marker);
  });
  measurementState.markers = [];

  if (measurementState.line) {
    map.removeLayer(measurementState.line);
    measurementState.line = null;
  }

  if (measurementState.polygon) {
    map.removeLayer(measurementState.polygon);
    measurementState.polygon = null;
  }

  updateMeasurementUI();
}

function setMeasurementMode(nextMode) {
  var isSameModeActive = measurementState.active && measurementState.mode === nextMode;

  if (isSameModeActive) {
    measurementState.active = false;
    measurementState.mode = null;
    map.getContainer().classList.remove("is-measuring");
    updateMeasurementUI();
    return;
  }

  if (measurementState.mode !== nextMode) {
    clearMeasurement();
  }

  measurementState.active = true;
  measurementState.mode = nextMode;
  map.getContainer().classList.add("is-measuring");
  updateMeasurementUI();
}

function addMeasurementPoint(latlng) {
  if (!measurementState.active || !latlng || !measurementState.mode) return;

  var lastPoint = measurementState.points.length ? measurementState.points[measurementState.points.length - 1] : null;
  measurementState.points.push(latlng);

  var marker = L.circleMarker(latlng, {
    radius: 5,
    weight: 2,
    color: "#0a5aa7",
    fillColor: "#ffffff",
    fillOpacity: 1
  }).addTo(map);

  measurementState.markers.push(marker);

  if (lastPoint) {
    measurementState.totalMeters += map.distance(lastPoint, latlng);
  }

  if (measurementState.mode === "distance") {
    if (measurementState.line) {
      measurementState.line.setLatLngs(measurementState.points);
    } else {
      measurementState.line = L.polyline(measurementState.points, {
        color: "#0f7fd6",
        weight: 3,
        dashArray: "8, 6"
      }).addTo(map);
    }
  }

  if (measurementState.mode === "area") {
    if (measurementState.line) {
      measurementState.line.setLatLngs(measurementState.points);
    } else {
      measurementState.line = L.polyline(measurementState.points, {
        color: "#0f7fd6",
        weight: 2,
        dashArray: "6, 4"
      }).addTo(map);
    }

    if (measurementState.points.length >= 3) {
      measurementState.totalArea = calculatePolygonArea(measurementState.points);
      measurementState.totalMeters = 0;
      for (var i = 1; i < measurementState.points.length; i++) {
        measurementState.totalMeters += map.distance(measurementState.points[i - 1], measurementState.points[i]);
      }
      measurementState.totalMeters += map.distance(measurementState.points[measurementState.points.length - 1], measurementState.points[0]);

      if (measurementState.polygon) {
        measurementState.polygon.setLatLngs(measurementState.points);
      } else {
        measurementState.polygon = L.polygon(measurementState.points, {
          color: "#0a5aa7",
          weight: 2,
          fillColor: "#3ea7ff",
          fillOpacity: 0.18
        }).addTo(map);
      }
    }
  }

  updateMeasurementUI();
}

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

var ORDERED_FIELDS = [
  { key: "id",          aliases: ["id", "ID", "gid", "GID", "fid", "FID"] },
  { key: "codigo",      aliases: ["codigo", "CODIGO", "catastro_cod", "CAT_COD"] },
  { key: "cod_catas",   aliases: ["cod_catas", "COD_CATAS", "cod_catastral", "COD_CATASTRAL"] },
  { key: "num_lote",    aliases: ["num_lote", "NUM_LOTE", "lote", "LOTE", "numero_lote", "NUMERO_LOTE"] },
  { key: "cod_mz",      aliases: ["cod_mz", "COD_MZ", "manzana", "MANZANA", "cod_manzana", "COD_MANZANA"] },
  { key: "sector",      aliases: ["sector", "SECTOR", "nom_sector", "NOM_SECTOR", "zona", "ZONA"] },
  { key: "area",        aliases: ["area", "AREA", "area_m2", "AREA_M2", "Shape_Area", "shape_area"] },
  { key: "perimetro",   aliases: ["perimetro", "PERIMETRO", "perimeter", "PERIMETER", "Shape_Leng", "shape_leng"] },
  { key: "propietario", aliases: ["propietario", "PROPIETARIO"] },
  { key: "direccion",   aliases: ["direccion", "DIRECCION"] },
  { key: "uso",         aliases: ["uso", "USO"] },
  { key: "estado",      aliases: ["estado", "ESTADO"] }
];

function findPropKey(props, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    if (Object.prototype.hasOwnProperty.call(props, aliases[i])) return aliases[i];
  }
  return null;
}

function formatFieldValue(value) {
  if (value === null || value === undefined || value === "") return "No disponible";
  if (typeof value === "number") return value.toLocaleString("es-PE", { maximumFractionDigits: 6 });
  if (typeof value === "object") {
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  return String(value);
}

function updateAllFields(props) {
  var incomingProps = props || {};
  var incomingKeys  = Object.keys(incomingProps);
  var usedKeys = {};
  var rows = "";

  for (var e = 0; e < ORDERED_FIELDS.length; e++) {
    var field      = ORDERED_FIELDS[e];
    var matchedKey = findPropKey(incomingProps, field.aliases);
    var value      = matchedKey ? incomingProps[matchedKey] : undefined;
    var isEmpty    = value === null || value === undefined || value === "";
    var rawValue   = isEmpty ? "Vacio" : formatFieldValue(value);
    rows += "<div class='field-row'><span class='field-key'>" + escapeHtml(field.key) + "</span><span class='field-value'>" + escapeHtml(rawValue) + "</span></div>";
    if (matchedKey) usedKeys[matchedKey] = true;
  }

  for (var i = 0; i < incomingKeys.length; i++) {
    var inKey = incomingKeys[i];
    if (!usedKeys[inKey]) {
      var extraValue = incomingProps[inKey];
      var extraIsEmpty = extraValue === null || extraValue === undefined || extraValue === "";
      var extraRaw = extraIsEmpty ? "Vacio" : formatFieldValue(extraValue);
      rows += "<div class='field-row'><span class='field-key'>" + escapeHtml(inKey) + "</span><span class='field-value'>" + escapeHtml(extraRaw) + "</span></div>";
    }
  }

  if (rows === "") {
    fieldsEl.innerHTML = "<div class='field-row'><span class='field-key'>Estado</span><span class='field-value'>No hay atributos disponibles</span></div>";
    return;
  }
  fieldsEl.innerHTML = rows;
}

function setPanelCompact(isCompact) {
  if (isCompact) { selectionPanelEl.classList.add("compact"); }
  else { selectionPanelEl.classList.remove("compact"); }
}

function clearSelection() {
  if (selectedLayer !== null) {
    selectedLayer.setStyle(DEFAULT_STYLE);
    selectedLayer = null;
  }
  setPanelCompact(true);
  fieldsEl.innerHTML = "<div class='field-row'><span class='field-key'>Estado</span><span class='field-value'>Seleccione un polígono en el mapa</span></div>";
}

function isMobileView() {
  return window.innerWidth <= 860;
}

function closeMobilePanels() {
  filterPanelEl.classList.remove("mobile-open");
  selectionPanelEl.classList.remove("mobile-open");
  if (mobileBackdropEl) mobileBackdropEl.classList.remove("active");
}

function openMobilePanel(panelName) {
  if (!isMobileView()) return;
  closeMobilePanels();
  if (panelName === "filter") filterPanelEl.classList.add("mobile-open");
  if (panelName === "info") selectionPanelEl.classList.add("mobile-open");
  if (mobileBackdropEl) mobileBackdropEl.classList.add("active");
}

setPanelCompact(true);

map.on("click", function (e) {
  if (measurementState.active) {
    addMeasurementPoint(e.latlng);
    return;
  }
  if (suppressNextMapClick) { suppressNextMapClick = false; return; }
  clearSelection();
  if (isMobileView()) closeMobilePanels();
});

function createLotesLayer(geojson) {
  return L.geoJSON(geojson, {
    style: function () { return DEFAULT_STYLE; },
    onEachFeature: function (feature, layer) {
      var props = feature.properties || {};
      var lote = pickFirstProp(props, ["num_lote", "NUM_LOTE", "lote", "LOTE", "numero_lote", "NUMERO_LOTE"]) || "No disponible";
      var manzana = pickFirstProp(props, ["cod_mz", "COD_MZ", "manzana", "MANZANA", "cod_manzana", "COD_MANZANA"]) || "No disponible";
      var sector = pickFirstProp(props, ["sector", "SECTOR", "nom_sector", "NOM_SECTOR", "zona", "ZONA"]) || "No disponible";

      layer.bindTooltip(
        "<div class='parcel-tooltip'>" +
          "<div class='parcel-tooltip__title'>Información rápida</div>" +
          "<div class='parcel-tooltip__row'><span class='parcel-tooltip__label'>Manzana</span><span class='parcel-tooltip__value'>" + escapeHtml(manzana) + "</span></div>" +
          "<div class='parcel-tooltip__row'><span class='parcel-tooltip__label'>Lote</span><span class='parcel-tooltip__value'>" + escapeHtml(lote) + "</span></div>" +
          "<div class='parcel-tooltip__row'><span class='parcel-tooltip__label'>Sector</span><span class='parcel-tooltip__value'>" + escapeHtml(sector) + "</span></div>" +
        "</div>",
        {
          direction: "top",
          sticky: true,
          opacity: 1,
          className: "leaflet-parcel-tooltip"
        }
      );

      layer.on("click", function (e) {
        L.DomEvent.stopPropagation(e);

        if (measurementState.active) {
          addMeasurementPoint(e.latlng || layer.getBounds().getCenter());
          return;
        }

        suppressNextMapClick = true;
        if (selectedLayer !== null) { selectedLayer.setStyle(DEFAULT_STYLE); }
        selectedLayer = layer;
        layer.setStyle(SELECTED_STYLE);
        layer.bringToFront();
        setPanelCompact(false);
        updateAllFields(props);
        if (isMobileView()) openMobilePanel("info");
      });
    }
  });
}

function createManzanasLayer(geojson) {
  return L.geoJSON(geojson, {
    style: function () { return MANZANAS_STYLE; },
    interactive: false
  });
}

function loadLayers() {
  var statusEl = document.getElementById("filter-status");
  if (statusEl) { statusEl.textContent = "Cargando capas..."; }

  Promise.all([
    fetch("data/capa_lotes.geojson").then(function (r) {
      if (!r.ok) throw new Error("capa_lotes.geojson no encontrado (HTTP " + r.status + ")");
      return r.json();
    }),
    fetch("data/capa_manzanas.geojson").then(function (r) {
      if (!r.ok) throw new Error("capa_manzanas.geojson no encontrado (HTTP " + r.status + ")");
      return r.json();
    })
  ]).then(function (results) {
    lotesRawData  = results[0];
    manzanasLayer = createManzanasLayer(results[1]).addTo(map);
    lotesLayer    = createLotesLayer(lotesRawData).addTo(map);
    syncOverlayOrder();
    populateSectorOptions(lotesRawData);
    if (statusEl) { statusEl.textContent = ""; }
  }).catch(function (err) {
    console.error("Error cargando GeoJSON:", err);
    if (statusEl) {
      statusEl.textContent = "Error: " + err.message;
      statusEl.className = "filter-status error";
    }
  });
}

loadLayers();

var MapToolsControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd: function () {
    var container = L.DomUtil.create("div", "leaflet-bar map-tools-control");
    var title = L.DomUtil.create("div", "map-tools__title", container);
    var baseSection = L.DomUtil.create("div", "map-tools__section", container);
    var baseLabel = L.DomUtil.create("div", "map-tools__label", baseSection);
    var baseSelect = L.DomUtil.create("select", "map-tools__select", baseSection);
    var layerSection = L.DomUtil.create("div", "map-tools__section", container);
    var layerLabel = L.DomUtil.create("div", "map-tools__label", layerSection);
    var layerSelect = L.DomUtil.create("select", "map-tools__select", layerSection);
    var measureSection = L.DomUtil.create("div", "map-tools__section", container);
    var measureLabel = L.DomUtil.create("div", "map-tools__label", measureSection);
    var modeGroup = L.DomUtil.create("div", "measure-control__modes", measureSection);
    var distanceButton = L.DomUtil.create("button", "measure-control__button", modeGroup);
    var areaButton = L.DomUtil.create("button", "measure-control__button", modeGroup);
    var readout = L.DomUtil.create("div", "measure-control__readout", measureSection);
    var hint = L.DomUtil.create("div", "measure-control__hint", measureSection);
    var clearButton = L.DomUtil.create("button", "measure-control__clear", measureSection);

    title.textContent = "Herramientas del mapa";

    baseLabel.textContent = "Mapa base";
    baseSelect.innerHTML = "<option value='osm'>Calles y mapa</option><option value='satelital'>Vista satelital</option>";
    baseSelect.title = "Cambia entre cartografía de calles y vista satelital.";

    layerLabel.textContent = "Capas visibles";
    layerSelect.innerHTML = "<option value='ambas'>Lotes y manzanas</option><option value='lotes'>Solo lotes</option><option value='manzanas'>Solo manzanas</option>";

    measureLabel.textContent = "Medición";
    distanceButton.type = "button";
    distanceButton.textContent = "Distancia";
    distanceButton.title = "Mide una ruta por tramos haciendo clic sobre el mapa.";

    areaButton.type = "button";
    areaButton.textContent = "Área";
    areaButton.title = "Delimita un polígono para calcular superficie y perímetro.";

    readout.textContent = "Selecciona una herramienta";
    hint.textContent = "Activa distancia o área para medir sobre el mapa.";

    clearButton.type = "button";
    clearButton.textContent = "Limpiar";

    L.DomEvent.disableClickPropagation(container);

    L.DomEvent.on(baseSelect, "change", function () {
      switchBaseLayer(baseSelect.value);
    });

    L.DomEvent.on(layerSelect, "change", function () {
      if (!lotesLayer || !manzanasLayer) return;
      var value = layerSelect.value;
      if (value === "lotes") { lotesLayer.addTo(map); map.removeLayer(manzanasLayer); syncOverlayOrder(); return; }
      if (value === "manzanas") { map.removeLayer(lotesLayer); manzanasLayer.addTo(map); clearSelection(); syncOverlayOrder(); return; }
      lotesLayer.addTo(map);
      manzanasLayer.addTo(map);
      syncOverlayOrder();
    });

    L.DomEvent.on(distanceButton, "click", function (e) {
      L.DomEvent.stop(e);
      setMeasurementMode("distance");
    });

    L.DomEvent.on(areaButton, "click", function (e) {
      L.DomEvent.stop(e);
      setMeasurementMode("area");
    });

    L.DomEvent.on(clearButton, "click", function (e) {
      L.DomEvent.stop(e);
      clearMeasurement();
    });

    measurementState.readoutEl = readout;
    measurementState.hintEl = hint;
    measurementState.distanceButtonEl = distanceButton;
    measurementState.areaButtonEl = areaButton;
    measurementState.clearButtonEl = clearButton;
    updateMeasurementUI();

    return container;
  }
});

map.addControl(new MapToolsControl());

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && measurementState.active) {
    measurementState.active = false;
    measurementState.mode = null;
    map.getContainer().classList.remove("is-measuring");
    updateMeasurementUI();
  }
});

var filterNumLote  = document.getElementById("f-num-lote");
var filterCodMz    = document.getElementById("f-cod-mz");
var filterSector   = document.getElementById("f-sector");
var filterCodCatas = document.getElementById("f-cod-catas");
var filterStatusEl = document.getElementById("filter-status");
var btnSearch      = document.getElementById("btn-filter-search");
var btnClear       = document.getElementById("btn-filter-clear");

function populateSectorOptions(geojson) {
  if (!geojson || !geojson.features) return;
  var seen = {};
  var values = [];
  geojson.features.forEach(function (f) {
    var v = f.properties && pickFirstProp(f.properties, ["sector", "SECTOR", "nom_sector", "NOM_SECTOR"]);
    if (v !== null && v !== undefined && v !== "" && !seen[v]) { seen[v] = true; values.push(String(v)); }
  });
  values.sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
  values.forEach(function (val) {
    var opt = document.createElement("option");
    opt.value = val;
    opt.textContent = val;
    filterSector.appendChild(opt);
  });
}

function setFilterStatus(msg, type) {
  filterStatusEl.textContent = msg;
  filterStatusEl.className   = "filter-status" + (type ? " " + type : "");
}

function getGeometryCenter(geometry) {
  if (!geometry) return null;
  var coords = [];
  function collect(geom) {
    if (geom.type === "Point") { coords.push(geom.coordinates); }
    else if (geom.type === "LineString" || geom.type === "MultiPoint") { coords = coords.concat(geom.coordinates); }
    else if (geom.type === "Polygon") { coords = coords.concat(geom.coordinates[0]); }
    else if (geom.type === "MultiPolygon") { geom.coordinates.forEach(function (p) { coords = coords.concat(p[0]); }); }
    else if (geom.type === "MultiLineString") { geom.coordinates.forEach(function (l) { coords = coords.concat(l); }); }
  }
  collect(geometry);
  if (coords.length === 0) return null;
  var minLon = coords[0][0], maxLon = coords[0][0], minLat = coords[0][1], maxLat = coords[0][1];
  coords.forEach(function (c) {
    if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
    if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
  });
  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

function matchFilter(props, numLote, codMz, sector, codCatas) {
  var p = props || {};
  if (numLote)  { var v  = String(pickFirstProp(p, ["num_lote","NUM_LOTE","lote","LOTE"]) || "").toLowerCase(); if (v.indexOf(numLote.toLowerCase()) === -1) return false; }
  if (codMz)    { var v2 = String(pickFirstProp(p, ["cod_mz","COD_MZ","manzana","MANZANA"]) || "").toLowerCase(); if (v2.indexOf(codMz.toLowerCase()) === -1) return false; }
  if (sector)   { var v3 = String(pickFirstProp(p, ["sector","SECTOR"]) || ""); if (v3 !== sector) return false; }
  if (codCatas) { var v4 = String(pickFirstProp(p, ["cod_catas","COD_CATAS","cod_catastral"]) || "").toLowerCase(); if (v4.indexOf(codCatas.toLowerCase()) === -1) return false; }
  return true;
}

function searchFeatures() {
  var numLote  = filterNumLote.value.trim();
  var codMz    = filterCodMz.value.trim();
  var sector   = filterSector.value.trim();
  var codCatas = filterCodCatas.value.trim();

  if (!numLote && !codMz && !sector && !codCatas) { setFilterStatus("Ingresa al menos un criterio de búsqueda.", "error"); return; }
  if (!lotesRawData) { setFilterStatus("Las capas aún no han terminado de cargar.", "error"); return; }

  var match = null;
  var features = lotesRawData.features || [];
  for (var i = 0; i < features.length; i++) {
    if (matchFilter(features[i].properties, numLote, codMz, sector, codCatas)) { match = features[i]; break; }
  }

  if (!match) { setFilterStatus("No se encontraron predios con esos criterios.", "error"); return; }

  var matchLeaflet = null;
  if (lotesLayer) { lotesLayer.eachLayer(function (layer) { if (!matchLeaflet && layer.feature === match) matchLeaflet = layer; }); }

  var center = getGeometryCenter(match.geometry);
  if (!center) { setFilterStatus("Predio encontrado pero sin geometría.", "error"); return; }

  map.flyTo(center, 20, { duration: 1.2 });

  if (selectedLayer !== null) { selectedLayer.setStyle(DEFAULT_STYLE); selectedLayer = null; }
  if (matchLeaflet) { selectedLayer = matchLeaflet; matchLeaflet.setStyle(SELECTED_STYLE); matchLeaflet.bringToFront(); }

  setPanelCompact(false);
  updateAllFields(match.properties || {});
  setFilterStatus("Predio encontrado.", "success");
  if (isMobileView()) openMobilePanel("info");
}

btnSearch.addEventListener("click", function () { searchFeatures(); });

[filterNumLote, filterCodMz, filterCodCatas].forEach(function (input) {
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") searchFeatures(); });
});

if (btnMobileFilter && btnMobileInfo) {
  btnMobileFilter.addEventListener("click", function () {
    if (filterPanelEl.classList.contains("mobile-open")) closeMobilePanels();
    else openMobilePanel("filter");
  });

  btnMobileInfo.addEventListener("click", function () {
    if (selectionPanelEl.classList.contains("mobile-open")) closeMobilePanels();
    else openMobilePanel("info");
  });

  if (btnCloseFilter) btnCloseFilter.addEventListener("click", closeMobilePanels);
  if (btnCloseInfo) btnCloseInfo.addEventListener("click", closeMobilePanels);
  if (mobileBackdropEl) mobileBackdropEl.addEventListener("click", closeMobilePanels);

  function updateMobilePanelState() {
    if (isMobileView()) {
      closeMobilePanels();
    } else {
      filterPanelEl.classList.remove("mobile-open");
      selectionPanelEl.classList.remove("mobile-open");
      if (mobileBackdropEl) mobileBackdropEl.classList.remove("active");
    }
  }

  updateMobilePanelState();
  window.addEventListener("resize", updateMobilePanelState);
}

btnClear.addEventListener("click", function () {
  filterNumLote.value = "";
  filterCodMz.value   = "";
  filterSector.selectedIndex = 0;
  filterCodCatas.value = "";
  setFilterStatus("");
  clearSelection();
});
