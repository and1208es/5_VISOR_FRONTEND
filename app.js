var todayEl = document.getElementById("today-date");
var selectionPanelEl = document.getElementById("selection-panel");
var filterPanelEl = document.getElementById("filter-panel");
var mobileBackdropEl = document.getElementById("mobile-backdrop");
var fieldsEl = document.getElementById("sel-fields");
var btnMobileFilter = document.getElementById("btn-mobile-filter");
var btnMobileInfo = document.getElementById("btn-mobile-info");
var btnCloseFilter = document.getElementById("btn-close-filter");
var btnCloseInfo = document.getElementById("btn-close-info");
var measurementDisplayEl = document.getElementById("measurement-display");
var measurementReadoutDisplayEl = document.getElementById("measurement-readout");

todayEl.textContent = new Date().toLocaleDateString("es-PE", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
});

var STREETS_MAX_ZOOM = 22;
var SATELLITE_MAX_ZOOM = 22;

var map = L.map("map", {
  maxZoom: STREETS_MAX_ZOOM,
  minZoom: 14,
  preferCanvas: true,
  inertia: true,
  inertiaDeceleration: 2500,
  inertiaMaxSpeed: 1500,
  bounceAtZoomLimits: false,
  zoomAnimation: true,
  fadeAnimation: false,
  markerZoomAnimation: false,
  wheelDebounceTime: 18,
  wheelPxPerZoomLevel: 90,
  maxBoundsViscosity: 0.15,
  zoomSnap: 0.5,
  zoomDelta: 0.5
}).setView([-12.520928727075642, -73.83971998253236], 17);

var lotesBounds = L.latLngBounds(
  [-12.522877757847823, -73.9776522848367],
  [-12.168404765620012, -73.8211851939101]
);

var osmStandardLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors",
  maxZoom: STREETS_MAX_ZOOM,
  crossOrigin: true
});

var osmHumanitarianLayer = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors, HOT",
  maxZoom: STREETS_MAX_ZOOM,
  crossOrigin: true
});

var osmFranceLayer = L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors, OSM France",
  maxZoom: STREETS_MAX_ZOOM,
  crossOrigin: true
});

var satelliteBaseLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  maxZoom: SATELLITE_MAX_ZOOM,
  maxNativeZoom: 17,
  crossOrigin: true
});

var baseLayerCatalog = {
  osm: osmStandardLayer,
  osm_hot: osmHumanitarianLayer,
  osm_fr: osmFranceLayer,
  satelital: satelliteBaseLayer
};

var currentBaseLayer = baseLayerCatalog.osm.addTo(map);

function syncOverlayOrder() {
  if (manzanasLayer && map.hasLayer(manzanasLayer)) manzanasLayer.bringToFront();
  extraOverlayLayers.forEach(function (entry) {
    if (entry.layer && map.hasLayer(entry.layer)) entry.layer.bringToFront();
  });
  if (lotesLayer && map.hasLayer(lotesLayer)) lotesLayer.bringToFront();
  if (selectedLayer) selectedLayer.bringToFront();
}

function switchBaseLayer(baseName) {
  var nextBaseLayer = baseLayerCatalog[baseName] || baseLayerCatalog.osm;

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

var EXTRA_LAYER_COLOR_PALETTE = [
  { color: "#8a5a0b", fillColor: "#f5c879" },
  { color: "#0d6a4f", fillColor: "#8adfbc" },
  { color: "#6e275c", fillColor: "#e7a9d7" },
  { color: "#4b4fc9", fillColor: "#a9b5ff" }
];

var manzanasLayer = null;
var lotesLayer    = null;
var lotesRawData  = null;
var extraOverlayLayers = [];

var selectedLayer = null;
var suppressNextMapClick = false;
var dataSourceState = {
  mode: "geoserver",
  workspace: "geoportal",
  lotesTypeName: "geoportal:lotes",
  manzanasTypeName: "geoportal:manzanas",
  fallbackToLocal: true,
  resolvedSource: null
};
var layerConfigState = {
  extraLayers: [],
  hiddenFields: [],
  visibleFields: []
};
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

var mapToolsState = {
  panelEl: null,
  sections: {},
  buttons: {},
  activeSection: null,
  extraLayersContainerEl: null
};

function activateMapToolsSection(sectionName) {
  var isMeasuringActive = measurementState.active && sectionName === "measure";
  
  if (!isMeasuringActive) {
    mapToolsState.activeSection = mapToolsState.activeSection === sectionName ? null : sectionName;
  } else {
    mapToolsState.activeSection = "measure";
  }

  if (mapToolsState.panelEl) {
    mapToolsState.panelEl.classList.toggle("collapsed", !mapToolsState.activeSection);
  }

  Object.keys(mapToolsState.sections).forEach(function (key) {
    mapToolsState.sections[key].style.display = mapToolsState.activeSection === key ? "flex" : "none";
  });

  Object.keys(mapToolsState.buttons).forEach(function (key) {
    mapToolsState.buttons[key].classList.toggle("active", mapToolsState.activeSection === key);
  });
}

function toggleExtraLayerVisibility(layerId) {
  var entry = extraOverlayLayers.find(function (candidate) {
    return candidate.id === layerId;
  });
  if (!entry || !entry.layer) return;

  if (map.hasLayer(entry.layer)) {
    map.removeLayer(entry.layer);
  } else {
    entry.layer.addTo(map);
    syncOverlayOrder();
  }

  renderExtraLayerToggles();
}

function renderExtraLayerToggles() {
  if (!mapToolsState.extraLayersContainerEl) return;

  var container = mapToolsState.extraLayersContainerEl;
  container.innerHTML = "";

  if (!extraOverlayLayers.length) {
    var emptyState = document.createElement("div");
    emptyState.className = "map-tools__extra-empty";
    emptyState.textContent = "No hay capas adicionales.";
    container.appendChild(emptyState);
    return;
  }

  extraOverlayLayers.forEach(function (entry) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "map-tools__extra-toggle";

    var isVisible = Boolean(entry.layer && map.hasLayer(entry.layer));
    btn.classList.toggle("active", isVisible);
    btn.textContent = (isVisible ? "Ocultar" : "Mostrar") + " " + entry.label;

    btn.addEventListener("click", function (event) {
      event.preventDefault();
      toggleExtraLayerVisibility(entry.id);
    });

    container.appendChild(btn);
  });
}

function setExportStatus(message, type) {
  if (!mapToolsState.exportStatusEl) return;
  mapToolsState.exportStatusEl.textContent = message || "";
  mapToolsState.exportStatusEl.className = "export-status" + (type ? " " + type : "");
}

function exportMapToPDF() {
  var mapEl = document.getElementById("map");
  if (!mapEl) return;

  if (typeof html2canvas !== "function" || !window.jspdf || !window.jspdf.jsPDF) {
    setExportStatus("No se pudo cargar el generador PDF.", "error");
    return;
  }

  setExportStatus("Generando PDF...", "");

  requestAnimationFrame(function () {
    html2canvas(mapEl, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      scale: 2,
      logging: false
    }).then(function (canvas) {
      var pdf = new window.jspdf.jsPDF({
        orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
        unit: "mm",
        format: "a4"
      });

      var pageWidth = pdf.internal.pageSize.getWidth();
      var pageHeight = pdf.internal.pageSize.getHeight();
      var margin = 10;
      var headerY = 12;
      var contentTop = 24;
      var maxWidth = pageWidth - (margin * 2);
      var maxHeight = pageHeight - contentTop - margin;
      var ratio = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      var imgWidth = canvas.width * ratio;
      var imgHeight = canvas.height * ratio;
      var fileName = "geoportal-pichari-" + new Date().toISOString().slice(0, 10) + ".pdf";

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.text("Geoportal Municipalidad de Pichari", margin, headerY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text("Vista actual del mapa", margin, headerY + 6);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", margin, contentTop, imgWidth, imgHeight);
      pdf.save(fileName);

      setExportStatus("PDF descargado correctamente.", "success");
    }).catch(function (error) {
      console.error("Error al exportar PDF:", error);
      setExportStatus("No se pudo generar el PDF. Reintenta.", "error");
    });
  });
}

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

function getOuterRingLatLngs(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) return [];

  if (geometry.type === "Polygon" && geometry.coordinates[0]) {
    return geometry.coordinates[0].map(function (coord) {
      return L.latLng(coord[1], coord[0]);
    });
  }

  if (geometry.type === "MultiPolygon" && geometry.coordinates[0] && geometry.coordinates[0][0]) {
    return geometry.coordinates[0][0].map(function (coord) {
      return L.latLng(coord[1], coord[0]);
    });
  }

  return [];
}

function calculateGeometryPerimeter(geometry) {
  var latlngs = getOuterRingLatLngs(geometry);
  if (!latlngs || latlngs.length < 2) return 0;

  var totalMeters = 0;
  for (var i = 1; i < latlngs.length; i++) {
    totalMeters += map.distance(latlngs[i - 1], latlngs[i]);
  }

  var firstPoint = latlngs[0];
  var lastPoint = latlngs[latlngs.length - 1];
  if (firstPoint.lat !== lastPoint.lat || firstPoint.lng !== lastPoint.lng) {
    totalMeters += map.distance(lastPoint, firstPoint);
  }

  return totalMeters;
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
      measurementState.hintEl.textContent = "Sigue agregando vértices. Haz clic nuevamente en el botón de modo para nueva medición, o usa 'Limpiar medición' para terminar.";
    } else if (measurementState.points.length === 0) {
      measurementState.hintEl.textContent = "Haz clic en el mapa para iniciar la medición.";
    } else {
      measurementState.hintEl.textContent = "Sigue haciendo clic. Haz clic nuevamente en el botón de modo para nueva medición.";
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

  if (measurementReadoutDisplayEl) {
    if (measurementState.active) {
      if (measurementState.mode === "area") {
        measurementReadoutDisplayEl.textContent = "Área: " + formatArea(measurementState.totalArea) + " · Perímetro: " + formatDistance(measurementState.totalMeters);
      } else {
        measurementReadoutDisplayEl.textContent = "Distancia: " + formatDistance(measurementState.totalMeters);
      }
      if (measurementDisplayEl) {
        measurementDisplayEl.classList.remove("measurement-display--hidden");
      }
    } else {
      if (measurementDisplayEl) {
        measurementDisplayEl.classList.add("measurement-display--hidden");
      }
    }
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

function stopMeasurementMode(closePanel) {
  clearMeasurement();
  measurementState.active = false;
  measurementState.mode = null;
  map.getContainer().classList.remove("is-measuring");
  if (closePanel) {
    activateMapToolsSection(null);
  }
  updateMeasurementUI();
}

function setMeasurementMode(nextMode) {
  var isSameModeActive = measurementState.active && measurementState.mode === nextMode;

  if (isSameModeActive) {
    clearMeasurement();
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
  { key: "Codigo", aliases: ["codigo", "CODIGO", "catastro_cod", "CAT_COD"] },
  { key: "Codigo catastral", aliases: ["cod_catas", "COD_CATAS", "cod_catastral", "COD_CATASTRAL"] },
  { key: "Numero de lote", aliases: ["num_lote", "NUM_LOTE", "lote", "LOTE", "numero_lote", "NUMERO_LOTE"] },
  { key: "ID del lote", aliases: ["lote_id", "LOTE_ID"] },
  { key: "Manzana", aliases: ["cod_mz", "COD_MZ", "manzana", "MANZANA", "cod_manzana", "COD_MANZANA"] },
  { key: "Sector", aliases: ["sector", "SECTOR", "nom_sector", "NOM_SECTOR", "zona", "ZONA"] },
  { key: "Area (m2)", aliases: ["area", "AREA", "area_m2", "AREA_M2", "Shape_Area", "shape_area"] },
  { key: "Perimetro (m)", aliases: ["perimetro", "PERIMETRO", "perimetro_m", "PERIMETRO_M", "perimeter", "PERIMETER", "Shape_Leng", "shape_leng"] },
  { key: "Propietario", aliases: ["propietario", "PROPIETARIO"] },
  { key: "Direccion", aliases: ["direccion", "DIRECCION"] },
  { key: "Uso", aliases: ["uso", "USO"] },
  { key: "Estado", aliases: ["estado", "ESTADO"] },
  { key: "Condicion", aliases: ["condicion", "CONDICION"] },
  { key: "Identificador", aliases: ["id", "ID", "gid", "GID", "fid", "FID"] }
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

function normalizeHiddenFieldName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeVisibleFieldName(value) {
  return String(value || "").trim().toLowerCase();
}

function hasVisibleFieldsFilter() {
  return Array.isArray(layerConfigState.visibleFields) && layerConfigState.visibleFields.length > 0;
}

function isVisibleField(fieldName) {
  var normalizedName = normalizeVisibleFieldName(fieldName);
  if (!normalizedName) return false;
  return layerConfigState.visibleFields.indexOf(normalizedName) !== -1;
}

function isHiddenField(fieldName) {
  var normalizedName = normalizeHiddenFieldName(fieldName);
  if (!normalizedName) return false;
  return layerConfigState.hiddenFields.indexOf(normalizedName) !== -1;
}

function updateAllFields(props, geometry) {
  var incomingProps = props || {};
  var incomingKeys  = Object.keys(incomingProps);
  var usedKeys = {};
  var rows = "";
  var derivedPerimeter = calculateGeometryPerimeter(geometry);

  for (var e = 0; e < ORDERED_FIELDS.length; e++) {
    var field      = ORDERED_FIELDS[e];
    var showOrderedField = !hasVisibleFieldsFilter() || isVisibleField(field.key) || field.aliases.some(function (alias) {
      return isVisibleField(alias);
    });
    if (!showOrderedField) continue;
    var hideOrderedField = isHiddenField(field.key) || field.aliases.some(function (alias) {
      return isHiddenField(alias);
    });
    if (hideOrderedField) continue;
    var matchedKey = findPropKey(incomingProps, field.aliases);
    var value      = matchedKey ? incomingProps[matchedKey] : undefined;
    if ((field.aliases.indexOf("perimetro") !== -1 || field.aliases.indexOf("PERIMETRO") !== -1) && (value === null || value === undefined || value === "") && derivedPerimeter > 0) {
      value = derivedPerimeter;
    }
    var isEmpty    = value === null || value === undefined || value === "";
    var rawValue   = isEmpty ? "Vacio" : formatFieldValue(value);
    rows += "<div class='field-row'><span class='field-key'>" + escapeHtml(field.key) + "</span><span class='field-value'>" + escapeHtml(rawValue) + "</span></div>";
    if (matchedKey) usedKeys[matchedKey] = true;
  }

  for (var i = 0; i < incomingKeys.length; i++) {
    var inKey = incomingKeys[i];
    if (hasVisibleFieldsFilter() && !isVisibleField(inKey)) continue;
    if (isHiddenField(inKey)) continue;
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
  return window.innerWidth <= 1100;
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
        updateAllFields(props, feature.geometry);
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

function normalizeLayerConfig(rawConfig) {
  if (!rawConfig || !Array.isArray(rawConfig.extraLayers)) {
    return [];
  }

  return rawConfig.extraLayers.filter(function (entry) {
    if (!entry || !entry.id) return false;
    var sourceType = String(entry.sourceType || "wfs").toLowerCase();
    if (sourceType === "wms") {
      return Boolean(entry.wmsLayers || entry.typeName);
    }
    if (sourceType === "arcgis-rest") {
      return Boolean(entry.arcgisUrl);
    }
    return Boolean(entry.typeName);
  }).map(function (entry) {
    var sourceType = String(entry.sourceType || "wfs").toLowerCase();
    var defaultWmsUrl = "/geoserver/" + dataSourceState.workspace + "/wms";
    return {
      id: String(entry.id),
      label: entry.label ? String(entry.label) : String(entry.id),
      sourceType: sourceType === "wms" ? "wms" : (sourceType === "arcgis-rest" ? "arcgis-rest" : "wfs"),
      typeName: entry.typeName ? String(entry.typeName) : null,
      fallbackPath: entry.fallbackPath ? String(entry.fallbackPath) : null,
      visible: entry.visible !== false,
      style: entry.style || {},
      labelField: entry.labelField ? String(entry.labelField) : null,
      wmsUrl: entry.wmsUrl ? String(entry.wmsUrl) : defaultWmsUrl,
      wmsLayers: entry.wmsLayers ? String(entry.wmsLayers) : (entry.typeName ? String(entry.typeName) : null),
      wmsFormat: entry.wmsFormat ? String(entry.wmsFormat) : "image/png",
      wmsTransparent: entry.wmsTransparent !== false,
      wmsVersion: entry.wmsVersion ? String(entry.wmsVersion) : "1.1.1",
      wmsStyles: entry.wmsStyles ? String(entry.wmsStyles) : "",
      wmsCrs: entry.wmsCrs ? String(entry.wmsCrs) : "EPSG:4326",
      wmsOpacity: entry.wmsOpacity !== undefined ? Number(entry.wmsOpacity) : 1,
      wmsAttribution: entry.wmsAttribution ? String(entry.wmsAttribution) : "",
      wmsTiled: entry.wmsTiled === true,
      wmsExtraParams: entry.wmsExtraParams && typeof entry.wmsExtraParams === "object" ? entry.wmsExtraParams : {},
      arcgisUrl: entry.arcgisUrl ? String(entry.arcgisUrl) : null,
      arcgisLayers: entry.arcgisLayers ? String(entry.arcgisLayers) : (entry.arcgisLayerId !== undefined ? "show:" + String(entry.arcgisLayerId) : "show:0"),
      arcgisFormat: entry.arcgisFormat ? String(entry.arcgisFormat) : "png32",
      arcgisTransparent: entry.arcgisTransparent !== false,
      arcgisOpacity: entry.arcgisOpacity !== undefined ? Number(entry.arcgisOpacity) : 1,
      arcgisAttribution: entry.arcgisAttribution ? String(entry.arcgisAttribution) : "",
      arcgisSpatialReference: entry.arcgisSpatialReference ? String(entry.arcgisSpatialReference) : "3857",
      arcgisMaxImageSize: entry.arcgisMaxImageSize !== undefined ? Number(entry.arcgisMaxImageSize) : 1200,
      arcgisUseDevicePixelRatio: entry.arcgisUseDevicePixelRatio !== false,
      arcgisUseCors: entry.arcgisUseCors !== false,
      arcgisExtraParams: entry.arcgisExtraParams && typeof entry.arcgisExtraParams === "object" ? entry.arcgisExtraParams : {}
    };
  });
}

function loadLayerConfig() {
  return fetch("layer-config.json", { cache: "no-store" }).then(function (response) {
    if (!response.ok) {
      return { extraLayers: [], hiddenFields: [], visibleFields: [] };
    }
    return response.json();
  }).catch(function () {
    return { extraLayers: [], hiddenFields: [], visibleFields: [] };
  });
}

function normalizeHiddenFields(rawConfig) {
  if (!rawConfig || !Array.isArray(rawConfig.hiddenFields)) return [];
  return rawConfig.hiddenFields
    .map(normalizeHiddenFieldName)
    .filter(function (value, index, list) {
      return value && list.indexOf(value) === index;
    });
}

function normalizeVisibleFields(rawConfig) {
  if (!rawConfig || !Array.isArray(rawConfig.visibleFields)) return [];
  return rawConfig.visibleFields
    .map(normalizeVisibleFieldName)
    .filter(function (value, index, list) {
      return value && list.indexOf(value) === index;
    });
}

function getExtraLayerStyle(layerDefinition, index) {
  var palette = EXTRA_LAYER_COLOR_PALETTE[index % EXTRA_LAYER_COLOR_PALETTE.length];
  return {
    fill: true,
    weight: layerDefinition.style.weight || 2,
    color: layerDefinition.style.color || palette.color,
    fillColor: layerDefinition.style.fillColor || palette.fillColor,
    fillOpacity: layerDefinition.style.fillOpacity !== undefined ? layerDefinition.style.fillOpacity : 0.22
  };
}

function createExtraOverlayLayer(geojson, layerDefinition, index) {
  var layerStyle = getExtraLayerStyle(layerDefinition, index);

  return L.geoJSON(geojson, {
    style: function () { return layerStyle; },
    onEachFeature: function (feature, layer) {
      if (!layerDefinition.labelField) return;
      var props = feature.properties || {};
      if (!Object.prototype.hasOwnProperty.call(props, layerDefinition.labelField)) return;
      var labelValue = props[layerDefinition.labelField];
      if (labelValue === null || labelValue === undefined || labelValue === "") return;
      layer.bindTooltip(String(labelValue), {
        direction: "top",
        sticky: true,
        opacity: 0.95
      });
    }
  });
}

function createExtraWmsLayer(layerDefinition) {
  var configuredCrs = String(layerDefinition.wmsCrs || "EPSG:4326").toUpperCase();
  var leafletCrs = configuredCrs === "EPSG:3857" ? L.CRS.EPSG3857 : L.CRS.EPSG4326;
  var baseOptions = {
    layers: layerDefinition.wmsLayers,
    format: layerDefinition.wmsFormat,
    transparent: layerDefinition.wmsTransparent,
    styles: layerDefinition.wmsStyles,
    crs: leafletCrs,
    uppercase: true,
    crossOrigin: true,
    opacity: Math.max(0, Math.min(1, layerDefinition.wmsOpacity)),
    attribution: layerDefinition.wmsAttribution,
    tiled: layerDefinition.wmsTiled,
    updateWhenIdle: true,
    keepBuffer: 1
  };

  Object.keys(layerDefinition.wmsExtraParams || {}).forEach(function (key) {
    baseOptions[key] = layerDefinition.wmsExtraParams[key];
  });

  var primaryVersion = String(layerDefinition.wmsVersion || "1.1.1");
  var fallbackVersion = primaryVersion === "1.3.0" ? "1.1.1" : "1.3.0";
  var tileErrorCount = 0;
  var didFallback = false;
  var hostLayer = L.layerGroup();
  var currentLayer = null;

  function mountLayer(version) {
    var layerOptions = Object.assign({}, baseOptions, { version: version });
    var nextLayer = L.tileLayer.wms(layerDefinition.wmsUrl, layerOptions);

    nextLayer.on("tileload", function () {
      tileErrorCount = 0;
    });

    nextLayer.on("tileerror", function () {
      tileErrorCount += 1;
      if (!didFallback && tileErrorCount >= 3) {
        didFallback = true;
        tileErrorCount = 0;
        console.warn("WMS " + layerDefinition.label + " presento errores de carga. Reintentando con version " + fallbackVersion + ".");
        hostLayer.removeLayer(nextLayer);
        currentLayer = mountLayer(fallbackVersion);
        hostLayer.addLayer(currentLayer);
      }
    });

    return nextLayer;
  }

  currentLayer = mountLayer(primaryVersion);
  hostLayer.addLayer(currentLayer);
  return hostLayer;
}

function createExtraArcGisRestLayer(layerDefinition) {
  var hostLayer = L.layerGroup();
  var mapInstance = null;
  var imageOverlay = null;
  var requestToken = 0;
  var redrawTimer = null;
  var spatialReference = String(layerDefinition.arcgisSpatialReference || "3857");
  var useCors = layerDefinition.arcgisUseCors !== false;
  var pendingImage = null;
  var lastRequestUrl = null;

  function getBoundsCoordinates(bounds) {
    if (spatialReference === "4326") {
      return {
        southWest: bounds.getSouthWest(),
        northEast: bounds.getNorthEast()
      };
    }

    return {
      southWest: mapInstance.options.crs.project(bounds.getSouthWest()),
      northEast: mapInstance.options.crs.project(bounds.getNorthEast())
    };
  }

  function buildExportUrl(bounds, size) {
    var projectedBounds = getBoundsCoordinates(bounds);
    var pixelRatio = layerDefinition.arcgisUseDevicePixelRatio
      ? Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      : 1;
    var imageSize = {
      x: Math.max(1, Math.round(size.x * pixelRatio)),
      y: Math.max(1, Math.round(size.y * pixelRatio))
    };
    var maxImageSize = Number(layerDefinition.arcgisMaxImageSize);
    if (Number.isFinite(maxImageSize) && maxImageSize > 0) {
      var maxCurrentSize = Math.max(imageSize.x, imageSize.y);
      if (maxCurrentSize > maxImageSize) {
        var scale = maxImageSize / maxCurrentSize;
        imageSize.x = Math.max(1, Math.round(imageSize.x * scale));
        imageSize.y = Math.max(1, Math.round(imageSize.y * scale));
      }
    }
    var exportUrl = String(layerDefinition.arcgisUrl || "").replace(/\/+$/, "") + "/export";
    var params = new URLSearchParams({
      bbox: spatialReference === "4326"
        ? [projectedBounds.southWest.lng, projectedBounds.southWest.lat, projectedBounds.northEast.lng, projectedBounds.northEast.lat].join(",")
        : [projectedBounds.southWest.x, projectedBounds.southWest.y, projectedBounds.northEast.x, projectedBounds.northEast.y].join(","),
      bboxSR: spatialReference,
      imageSR: spatialReference,
      size: String(imageSize.x) + "," + String(imageSize.y),
      format: String(layerDefinition.arcgisFormat || "png32"),
      transparent: layerDefinition.arcgisTransparent ? "true" : "false",
      f: "image"
    });

    if (layerDefinition.arcgisLayers) {
      params.set("layers", layerDefinition.arcgisLayers);
    }

    Object.keys(layerDefinition.arcgisExtraParams || {}).forEach(function (key) {
      params.set(key, layerDefinition.arcgisExtraParams[key]);
    });

    return exportUrl + "?" + params.toString();
  }

  function clearCurrentOverlay() {
    if (imageOverlay && mapInstance && mapInstance.hasLayer(imageOverlay)) {
      mapInstance.removeLayer(imageOverlay);
    }
    imageOverlay = null;
  }

  function redraw() {
    if (!mapInstance) return;

    var bounds = mapInstance.getBounds();
    var size = mapInstance.getSize();
    var url = buildExportUrl(bounds, size);
    if (url === lastRequestUrl) {
      return;
    }
    var previousPendingImage = pendingImage;
    lastRequestUrl = url;
    var currentToken = ++requestToken;
    var preload = new Image();
    pendingImage = preload;

    if (useCors) {
      preload.crossOrigin = "anonymous";
    }
    preload.onload = function () {
      if (currentToken !== requestToken || !mapInstance) return;
      pendingImage = null;
      clearCurrentOverlay();
      var overlayOptions = {
        opacity: Math.max(0, Math.min(1, layerDefinition.arcgisOpacity)),
        interactive: false
      };
      if (useCors) {
        overlayOptions.crossOrigin = true;
      }
      imageOverlay = L.imageOverlay(url, bounds, overlayOptions);
      imageOverlay.addTo(mapInstance);
    };

    preload.onerror = function () {
      if (currentToken !== requestToken) return;
      pendingImage = null;
      lastRequestUrl = null;
      if (mapInstance && mapInstance.hasLayer(hostLayer)) {
        mapInstance.removeLayer(hostLayer);
        renderExtraLayerToggles();
      }
      console.warn("No se pudo cargar la capa ArcGIS REST " + layerDefinition.label + ".");
    };

    if (previousPendingImage && previousPendingImage !== preload) {
      previousPendingImage.onload = null;
      previousPendingImage.onerror = null;
      previousPendingImage.src = "";
    }

    preload.src = url;
  }

  function scheduleRedraw() {
    if (!mapInstance) return;
    if (redrawTimer) {
      clearTimeout(redrawTimer);
    }
    redrawTimer = setTimeout(redraw, 220);
  }

  hostLayer.onAdd = function (addedMap) {
    mapInstance = addedMap;
    mapInstance.on("moveend zoomend resize", scheduleRedraw);
    scheduleRedraw();
  };

  hostLayer.onRemove = function () {
    if (redrawTimer) {
      clearTimeout(redrawTimer);
      redrawTimer = null;
    }
    if (pendingImage) {
      pendingImage.onload = null;
      pendingImage.onerror = null;
      pendingImage.src = "";
      pendingImage = null;
    }
    if (mapInstance) {
      mapInstance.off("moveend zoomend resize", scheduleRedraw);
    }
    clearCurrentOverlay();
    lastRequestUrl = null;
    mapInstance = null;
  };

  hostLayer.redraw = redraw;
  hostLayer.bringToFront = function () {
    if (imageOverlay && imageOverlay.bringToFront) {
      imageOverlay.bringToFront();
    }
    return hostLayer;
  };
  hostLayer.bringToBack = function () {
    if (imageOverlay && imageOverlay.bringToBack) {
      imageOverlay.bringToBack();
    }
    return hostLayer;
  };

  return hostLayer;
}

function buildGeoServerWfsUrl(typeName) {
  return "/geoserver/" + dataSourceState.workspace + "/ows" +
    "?service=WFS" +
    "&version=1.0.0" +
    "&request=GetFeature" +
    "&typeName=" + encodeURIComponent(typeName) +
    "&outputFormat=" + encodeURIComponent("application/json") +
    "&srsName=EPSG:4326";
}

function fetchGeoJson(url, sourceLabel) {
  return fetch(url, { cache: "no-store" }).then(function (response) {
    if (!response.ok) {
      throw new Error(sourceLabel + " no disponible (HTTP " + response.status + ")");
    }
    return response.arrayBuffer();
  }).then(function (buffer) {
    var bytes = new Uint8Array(buffer);
    var decoder;

    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      decoder = new TextDecoder("utf-16le");
      return JSON.parse(decoder.decode(bytes.subarray(2)));
    }

    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      decoder = new TextDecoder("utf-16be");
      return JSON.parse(decoder.decode(bytes.subarray(2)));
    }

    decoder = new TextDecoder("utf-8");
    return JSON.parse(decoder.decode(bytes).replace(/^\uFEFF/, ""));
  });
}

function fetchLayerCollection(geoServerTypeName, fallbackPath, fallbackLabel) {
  var geoServerUrl = buildGeoServerWfsUrl(geoServerTypeName);

  if (dataSourceState.mode === "local") {
    return fetchGeoJson(fallbackPath, fallbackLabel).then(function (geojson) {
      return { geojson: geojson, source: "local" };
    });
  }

  return fetchGeoJson(geoServerUrl, geoServerTypeName).then(function (geojson) {
    return { geojson: geojson, source: "geoserver" };
  }).catch(function (error) {
    if (!dataSourceState.fallbackToLocal || !fallbackPath) {
      throw error;
    }

    console.warn("No se pudo cargar " + geoServerTypeName + " desde GeoServer. Se usara el archivo local.", error);
    return fetchGeoJson(fallbackPath, fallbackLabel).then(function (geojson) {
      return { geojson: geojson, source: "local" };
    });
  });
}

function clearExtraOverlayLayers() {
  extraOverlayLayers.forEach(function (entry) {
    if (entry.layer && map.hasLayer(entry.layer)) {
      map.removeLayer(entry.layer);
    }
  });
  extraOverlayLayers = [];
  renderExtraLayerToggles();
}

function loadConfiguredExtraLayers() {
  return Promise.all(layerConfigState.extraLayers.map(function (layerDefinition, index) {
    if (layerDefinition.sourceType === "wms") {
      return Promise.resolve({
        definition: layerDefinition,
        source: layerDefinition.wmsUrl.indexOf("/geoserver/") !== -1 ? "geoserver" : "remote-wms",
        index: index,
        mode: "wms"
      });
    }

    if (layerDefinition.sourceType === "arcgis-rest") {
      return Promise.resolve({
        definition: layerDefinition,
        source: "arcgis-rest",
        index: index,
        mode: "arcgis-rest"
      });
    }

    return fetchLayerCollection(
      layerDefinition.typeName,
      layerDefinition.fallbackPath,
      layerDefinition.label
    ).then(function (result) {
      return {
        definition: layerDefinition,
        geojson: result.geojson,
        source: result.source,
        index: index,
        mode: "wfs"
      };
    }).catch(function (error) {
      console.warn("No se pudo cargar la capa extra " + layerDefinition.label + ". Se omitira.", error);
      return null;
    });
  })).then(function (entries) {
    return entries.filter(function (entry) { return entry !== null; });
  });
}

function loadLayers() {
  var statusEl = document.getElementById("filter-status");
  if (statusEl) {
    statusEl.textContent = "";
    statusEl.style.display = "none";
  }

  loadLayerConfig().then(function (rawConfig) {
    layerConfigState.extraLayers = normalizeLayerConfig(rawConfig);
    layerConfigState.hiddenFields = normalizeHiddenFields(rawConfig);
    layerConfigState.visibleFields = normalizeVisibleFields(rawConfig);

    return Promise.all([
      fetchLayerCollection(dataSourceState.lotesTypeName, "data/capa_lotes.geojson", "capa_lotes.geojson"),
      fetchLayerCollection(dataSourceState.manzanasTypeName, "data/capa_manzanas.geojson", "capa_manzanas.geojson"),
      loadConfiguredExtraLayers()
    ]);
  }).then(function (results) {
    clearExtraOverlayLayers();

    var lotesResult = results[0];
    var manzanasResult = results[1];
    var extraLayerEntries = Array.isArray(results[2]) ? results[2] : [];

    lotesRawData  = lotesResult.geojson;
    manzanasLayer = createManzanasLayer(manzanasResult.geojson).addTo(map);
    lotesLayer    = createLotesLayer(lotesRawData).addTo(map);

    extraOverlayLayers = extraLayerEntries.map(function (entry) {
      var leafletLayer = entry.mode === "wms"
        ? createExtraWmsLayer(entry.definition)
        : entry.mode === "arcgis-rest"
          ? createExtraArcGisRestLayer(entry.definition)
        : createExtraOverlayLayer(entry.geojson, entry.definition, entry.index);
      if (entry.definition.visible) {
        leafletLayer.addTo(map);
      }
      return {
        id: entry.definition.id,
        label: entry.definition.label,
        source: entry.source,
        layer: leafletLayer
      };
    });

    renderExtraLayerToggles();

    var allSources = [lotesResult.source, manzanasResult.source];
    extraOverlayLayers.forEach(function (entry) { allSources.push(entry.source); });
    dataSourceState.resolvedSource = allSources.every(function (source) { return source === "geoserver"; }) ? "geoserver" : "local";

    syncOverlayOrder();
    populateSectorOptions(lotesRawData);
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "filter-status";
      statusEl.style.display = "none";
    }
  }).catch(function (err) {
    console.error("Error cargando capas:", err);
    if (statusEl) {
      statusEl.textContent = "Error: " + err.message;
      statusEl.className = "filter-status error";
      statusEl.style.display = "";
    }
  });
}

loadLayers();

var MapToolsControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd: function () {
    var shell = L.DomUtil.create("div", "map-tools-shell");
    var sidebar = L.DomUtil.create("div", "leaflet-bar map-tools-sidebar", shell);
    var panel = L.DomUtil.create("div", "leaflet-bar map-tools-panel", shell);
    var title = L.DomUtil.create("div", "map-tools__title", panel);
    var layersSection = L.DomUtil.create("div", "map-tools__section", panel);
    var layerLabel = L.DomUtil.create("div", "map-tools__label", layersSection);
    var layerSelect = L.DomUtil.create("select", "map-tools__select", layersSection);
    var extraLayerLabel = L.DomUtil.create("div", "map-tools__label map-tools__label--sub", layersSection);
    var extraLayersContainer = L.DomUtil.create("div", "map-tools__extra-layers", layersSection);
    var measureSection = L.DomUtil.create("div", "map-tools__section", panel);
    var measureLabel = L.DomUtil.create("div", "map-tools__label", measureSection);
    var modeGroup = L.DomUtil.create("div", "measure-control__modes", measureSection);
    var distanceButton = L.DomUtil.create("button", "measure-control__button", modeGroup);
    var areaButton = L.DomUtil.create("button", "measure-control__button", modeGroup);
    var readout = L.DomUtil.create("div", "measure-control__readout", measureSection);
    var hint = L.DomUtil.create("div", "measure-control__hint", measureSection);
    var clearButton = L.DomUtil.create("button", "measure-control__clear", measureSection);
    var exportSection = L.DomUtil.create("div", "map-tools__section", panel);
    var exportLabel = L.DomUtil.create("div", "map-tools__label", exportSection);
    var exportButton = L.DomUtil.create("button", "measure-control__button export-action-btn", exportSection);
    var exportStatus = L.DomUtil.create("div", "export-status", exportSection);

    function createIconButton(icon, label, titleText) {
      var btn = L.DomUtil.create("button", "map-tools__icon-btn", sidebar);
      btn.type = "button";
      btn.title = titleText;
      btn.setAttribute("aria-label", label);
      btn.innerHTML = "<span class='map-tools__icon'>" + icon + "</span><span class='map-tools__icon-label'>" + label + "</span>";
      return btn;
    }

    var homeBtn = createIconButton("⌂", "Inicio", "Volver a la vista principal del geoportal");
    var layersBtn = createIconButton("☷", "Capas", "Cambiar capas visibles");
    var measureBtn = createIconButton("⌖", "Medir", "Abrir herramientas de distancia y área");
    var printBtn = createIconButton("⎙", "PDF", "Descargar una captura del mapa en PDF");
    var cleanBtn = createIconButton("✕", "Limpiar", "Limpiar selección y medición");

    title.textContent = "Herramientas";

    layerLabel.textContent = "Capas visibles";
    layerSelect.innerHTML = "<option value='ambas'>Lotes y manzanas</option><option value='lotes'>Solo lotes</option><option value='manzanas'>Solo manzanas</option>";
    extraLayerLabel.textContent = "Capas adicionales";

    measureLabel.textContent = "Medición";
    distanceButton.type = "button";
    distanceButton.textContent = "Distancia";
    areaButton.type = "button";
    areaButton.textContent = "Área";
    readout.textContent = "Selecciona una herramienta";
    hint.textContent = "Activa distancia o área para medir sobre el mapa.";
    clearButton.type = "button";
    clearButton.textContent = "Limpiar medición";

    exportLabel.textContent = "Impresión";
    exportButton.type = "button";
    exportButton.textContent = "Descargar PDF";
    exportStatus.textContent = "Genera una captura de la vista actual del mapa.";

    L.DomEvent.disableClickPropagation(shell);

    L.DomEvent.on(homeBtn, "click", function (e) {
      L.DomEvent.stop(e);
      map.fitBounds(lotesBounds);
      clearSelection();
      if (isMobileView()) closeMobilePanels();
    });

    L.DomEvent.on(layersBtn, "click", function (e) {
      L.DomEvent.stop(e);
      activateMapToolsSection("layers");
    });

    L.DomEvent.on(measureBtn, "click", function (e) {
      L.DomEvent.stop(e);
      activateMapToolsSection("measure");
    });

    L.DomEvent.on(printBtn, "click", function (e) {
      L.DomEvent.stop(e);
      activateMapToolsSection("print");
      exportMapToPDF();
    });

    L.DomEvent.on(cleanBtn, "click", function (e) {
      L.DomEvent.stop(e);
      stopMeasurementMode(false);
      clearSelection();
      setExportStatus("Genera una captura de la vista actual del mapa.", "");
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
      activateMapToolsSection("measure");
      setMeasurementMode("distance");
    });

    L.DomEvent.on(areaButton, "click", function (e) {
      L.DomEvent.stop(e);
      activateMapToolsSection("measure");
      setMeasurementMode("area");
    });

    L.DomEvent.on(clearButton, "click", function (e) {
      L.DomEvent.stop(e);
      stopMeasurementMode(true);
    });

    L.DomEvent.on(exportButton, "click", function (e) {
      L.DomEvent.stop(e);
      activateMapToolsSection("print");
      exportMapToPDF();
    });

    mapToolsState.panelEl = panel;
    mapToolsState.sections = { layers: layersSection, measure: measureSection, print: exportSection };
    mapToolsState.buttons = { layers: layersBtn, measure: measureBtn, print: printBtn };
    mapToolsState.exportStatusEl = exportStatus;
    mapToolsState.extraLayersContainerEl = extraLayersContainer;

    measurementState.readoutEl = readout;
    measurementState.hintEl = hint;
    measurementState.distanceButtonEl = distanceButton;
    measurementState.areaButtonEl = areaButton;
    measurementState.clearButtonEl = clearButton;

    activateMapToolsSection("layers");
    renderExtraLayerToggles();
    updateMeasurementUI();

    return shell;
  }
});

map.addControl(new MapToolsControl());

var BaseMapControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd: function () {
    var shell = L.DomUtil.create("div", "leaflet-bar base-map-control");
    var label = L.DomUtil.create("label", "base-map-control__label", shell);
    var select = L.DomUtil.create("select", "base-map-control__select", shell);

    label.textContent = "Mapa base";
    label.setAttribute("for", "base-map-selector");

    select.id = "base-map-selector";
    select.innerHTML = [
      "<option value='osm'>OpenStreetMap Estándar</option>",
      "<option value='osm_hot'>OpenStreetMap Humanitario</option>",
      "<option value='osm_fr'>OpenStreetMap Francia</option>",
      "<option value='satelital'>Satelital</option>"
    ].join("");
    select.value = "osm";

    L.DomEvent.disableClickPropagation(shell);
    L.DomEvent.on(select, "change", function () {
      switchBaseLayer(select.value);
    });

    return shell;
  }
});

map.addControl(new BaseMapControl());

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

function normalizeSectorValue(value) {
  return String(value || "").trim();
}

function appendSectorOption(sectorValue) {
  var normalized = normalizeSectorValue(sectorValue);
  if (!normalized || !filterSector) return;

  var targetKey = normalized.toLowerCase();
  for (var i = 0; i < filterSector.options.length; i++) {
    var existing = normalizeSectorValue(filterSector.options[i].value).toLowerCase();
    if (existing === targetKey) return;
  }

  var opt = document.createElement("option");
  opt.value = normalized;
  opt.textContent = normalized;
  filterSector.appendChild(opt);
}

function populateSectorOptions(geojson) {
  if (!geojson || !geojson.features || !filterSector) return;

  var selectedValue = filterSector.value;
  filterSector.innerHTML = "<option value=''>— Todos —</option>";

  var seen = {};
  var values = [];
  geojson.features.forEach(function (f) {
    var rawSector = f.properties && pickFirstProp(f.properties, ["sector", "SECTOR", "nom_sector", "NOM_SECTOR", "zona", "ZONA"]);
    var normalized = normalizeSectorValue(rawSector);
    var key = normalized.toLowerCase();
    if (normalized && !seen[key]) {
      seen[key] = true;
      values.push(normalized);
    }
  });

  values.sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
  values.forEach(function (val) {
    appendSectorOption(val);
  });

  if (selectedValue) {
    appendSectorOption(selectedValue);
    filterSector.value = normalizeSectorValue(selectedValue);
  }
}

function setFilterStatus(msg, type) {
  filterStatusEl.textContent = msg;
  filterStatusEl.className   = "filter-status" + (type ? " " + type : "");
  filterStatusEl.style.display = msg ? "" : "none";
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
  if (sector)   {
    var v3 = normalizeSectorValue(pickFirstProp(p, ["sector","SECTOR","nom_sector","NOM_SECTOR","zona","ZONA"]));
    if (v3.toLowerCase() !== normalizeSectorValue(sector).toLowerCase()) return false;
  }
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
  updateAllFields(match.properties || {}, match.geometry);
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
