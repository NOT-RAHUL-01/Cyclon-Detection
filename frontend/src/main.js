import { api } from "./services/api.js?v=20260930-3";

const $ = id => document.getElementById(id);
const state = { cyclones: [], event: null, frames: [], history: [], prediction: null, classification: null, detection: null, index: 0, frameRequest: 0, cycloneRequest: 0, playing: false, timer: null, map: null, base: null, paths: null, fitNext: true, weather: { mode: "temperature", opacity: 0.88, overlay: null, legend: null, panel: null, info: null, range: null, samples: [], key: null } };
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const classes = ["Depression", "Deep Depression", "Tropical Storm", "Cyclonic Storm", "Severe Cyclonic Storm", "Very Severe Cyclonic Storm", "Extremely Severe Cyclonic Storm"];
const rank = value => Math.max(0, classes.indexOf(value));
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value ?? "—"; };

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
const weatherPalette = [[37, 111, 224], [139, 74, 190], [43, 172, 119], [239, 220, 63], [245, 143, 54], [218, 47, 55]];
function interpolationColor(value, min, max, palette = weatherPalette) {
  if (!Number.isFinite(value) || max <= min) return palette[0];
  const t = clamp((value - min) / (max - min), 0, 1);
  const segments = palette.length - 1;
  const index = Math.min(segments - 1, Math.floor(t * segments));
  const localT = (t * segments) - index;
  const a = palette[index];
  const b = palette[Math.min(palette.length - 1, index + 1)];
  const interp = (from, to) => Math.round(from + (to - from) * localT);
  return `rgb(${interp(a[0], b[0])}, ${interp(a[1], b[1])}, ${interp(a[2], b[2])})`;
}
function getWeatherSamples() {
  return state.weather.samples.map((point) => ({
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    temperature: Number(point.temperature),
    rainfall: Number(point.rainfall),
    wind_speed: Number(point.wind_speed),
    cloud_top_temperature: Number(point.cloud_top_temperature),
  })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}
function getWeatherValue(sample, mode) {
  if (mode === "temperature") return sample.temperature;
  if (mode === "rainfall") return sample.rainfall;
  if (mode === "wind") return sample.wind_speed;
  if (mode === "cloud") return sample.cloud_top_temperature;
  return sample.temperature;
}
function buildWeatherSurface() {
  const samples = getWeatherSamples();
  const mode = state.weather.mode || "temperature";
  const usableSamples = samples.filter((sample) => Number.isFinite(getWeatherValue(sample, mode)));
  if (!usableSamples.length) return null;
  const values = usableSamples.map((sample) => getWeatherValue(sample, mode));
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const bounds = L.latLngBounds([[5, 55], [32, 105]]);
  const rows = 112;
  const cols = 180;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  const image = context.createImageData(cols, rows);
  const mercatorY = (latitude) => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI / 180) / 2));
  const topY = mercatorY(bounds.getNorth());
  const bottomY = mercatorY(bounds.getSouth());
  for (let row = 0; row < rows; row += 1) {
    const mercator = topY + ((bottomY - topY) * row) / (rows - 1);
    const lat = (2 * Math.atan(Math.exp(mercator)) - Math.PI / 2) * 180 / Math.PI;
    for (let col = 0; col < cols; col += 1) {
      const lon = bounds.getWest() + ((bounds.getEast() - bounds.getWest()) * col) / (cols - 1);
      let totalWeight = 0;
      let totalValue = 0;
      for (const sample of usableSamples) {
        const dLat = lat - sample.latitude;
        const dLon = (lon - sample.longitude) * Math.cos(lat * Math.PI / 180);
        const distanceSq = dLat * dLat + dLon * dLon + 0.0001;
        const weight = 1 / distanceSq;
        totalWeight += weight;
        totalValue += getWeatherValue(sample, mode) * weight;
      }
      const cellValue = totalValue / totalWeight;
      const color = interpolationColor(cellValue, minValue, maxValue).match(/\d+/g).map(Number);
      const offset = (row * cols + col) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return { url: canvas.toDataURL(), bounds, min: minValue, max: maxValue };
}
function toast(message, error = false, retry = null) { const el = $("toast"); el.replaceChildren(document.createTextNode(message)); el.classList.toggle("error", error); if(retry){const button=document.createElement("button");button.className="retry-button";button.textContent="Retry";button.addEventListener("click",()=>{el.classList.remove("show");retry();},{once:true});el.append(" ",button);}el.classList.add("show"); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove("show"), 5200); }
function setApi(online) { setText("apiState", online ? "System online" : "Backend unavailable"); $("systemDot").classList.toggle("offline", !online); }
function fmtTime(value, dateOnly = false) { return new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"short", hour:dateOnly?undefined:"2-digit", minute:dateOnly?undefined:"2-digit", hour12:false, timeZone:"UTC" }).format(new Date(value)) + (dateOnly ? "" : " UTC"); }
function coords(lat, lon) { return `${Math.abs(Number(lat)).toFixed(2)}°${Number(lat) >= 0 ? "N" : "S"} ${Math.abs(Number(lon)).toFixed(2)}°${Number(lon) >= 0 ? "E" : "W"}`; }

function injectMapEnhancements() {
  if (document.getElementById("dravit-map-overrides")) return;
  const style = document.createElement("style");
  style.id = "dravit-map-overrides";
  style.textContent = `
    .leaflet-container { background: #06161a; }
    .leaflet-control-zoom, .leaflet-control-scale, .leaflet-control-attribution { border: 1px solid rgba(127, 155, 160, 0.35) !important; box-shadow: 0 10px 22px rgba(3, 12, 17, 0.45) !important; }
    .leaflet-control-zoom a, .leaflet-control-scale-line, .leaflet-control-attribution { background: rgba(12, 22, 28, 0.8) !important; color: #ebf7f7 !important; }
    .leaflet-control-zoom a:hover { background: rgba(18, 31, 37, 0.9) !important; }
    .leaflet-control-scale-line { border-color: rgba(165, 202, 209, 0.45) !important; }
    .weather-layer-panel { position:absolute; top:12px; right:12px; z-index:500; border:1px solid rgba(137, 180, 181, 0.35); border-radius:12px; background:rgba(8,18,23,0.78); backdrop-filter: blur(8px); box-shadow:0 12px 28px rgba(0,0,0,.28); padding:10px 10px 8px; min-width:170px; }
    .weather-layer-title { font: 700 9px/1.2 var(--mono,monospace); letter-spacing:1.2px; color:#a9d8d7; text-transform:uppercase; margin:0 0 8px; }
    .weather-layer-options { display:flex; flex-wrap:wrap; gap:6px; }
    .weather-layer-button { border:1px solid rgba(146, 176, 175, 0.25); background: rgba(29, 42, 45, 0.76); color:#dfe7e6; border-radius:999px; padding:5px 9px; font:700 9px var(--mono,monospace); letter-spacing:.7px; cursor:pointer; }
    .weather-layer-button.active { background: linear-gradient(135deg, rgba(95, 173, 171, 0.3), rgba(78, 114, 132, 0.25)); border-color: rgba(141, 222, 219, 0.6); color: #f6fffe; box-shadow: inset 0 0 0 1px rgba(113, 220, 220, 0.18); }
    .weather-layer-slider { margin-top:10px; display:flex; align-items:center; gap:8px; }
    .weather-layer-slider label { font:700 8px var(--mono,monospace); letter-spacing:1px; color:#abb7b6; text-transform:uppercase; }
    .weather-layer-slider input[type="range"] { flex:1; accent-color: #7bd8d0; }
    .weather-legend { position:absolute; left:12px; bottom:12px; z-index:500; min-width:200px; padding:8px 10px 10px; border:1px solid rgba(137,180,181,.35); border-radius:12px; background:rgba(8,18,23,0.8); box-shadow:0 10px 22px rgba(0,0,0,.22); }
    .weather-legend-header { display:flex; justify-content:space-between; gap:8px; margin-bottom:8px; font:700 9px var(--mono,monospace); letter-spacing:1.2px; text-transform:uppercase; color:#b7d9d7; }
    .weather-legend-bar { height:10px; border-radius:999px; background: linear-gradient(90deg, rgb(36,77,168), rgb(77,160,142), rgb(147,209,88), rgb(231,210,80), rgb(231,128,55), rgb(205,62,43), rgb(163,19,42)); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.15); }
    .weather-legend-scale { display:flex; justify-content:space-between; margin-top:6px; font:700 8px var(--mono,monospace); color:#d8ece9; }
    .weather-current { position:absolute; left:12px; top:12px; z-index:500; min-width:160px; padding:10px 12px 9px; border:1px solid rgba(137,180,181,.35); border-radius:12px; background:rgba(8,18,23,0.8); box-shadow:0 12px 28px rgba(0,0,0,.26); }
    .weather-current .label { font:700 9px var(--mono,monospace); letter-spacing:1.2px; color:#a9d8d7; text-transform:uppercase; margin-bottom:8px; }
    .weather-current .row { display:flex; justify-content:space-between; gap:10px; font:700 11px var(--sans,sans-serif); color:#edf6f5; padding:2px 0; }
    .weather-current .row span { color:#a4b8b8; font:700 8px var(--mono,monospace); letter-spacing:0.6px; text-transform:uppercase; }
    .leaflet-zoom-animated { filter: saturate(0.8) contrast(1.1) brightness(0.92); }
    .leaflet-interactive { transition: opacity 180ms ease; }
  `;
  document.head.appendChild(style);
}
function updateWeatherControls() {
  const panel = state.weather.panel;
  if (!panel) return;
  [...panel.querySelectorAll(".weather-layer-button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.weather.mode);
  });
  const slider = panel.querySelector("input[type='range']");
  if (slider) slider.value = String(Math.round(state.weather.opacity * 100));
  const legend = state.weather.legend;
  if (legend && state.weather.range) {
    const { min, max, unit } = state.weather.range;
    legend.innerHTML = `<div class="weather-legend-header"><span>${state.weather.mode.toUpperCase()}</span><strong>${Number(min).toFixed(1)}${unit} — ${Number(max).toFixed(1)}${unit}</strong></div><div class="weather-legend-bar"></div><div class="weather-legend-scale"><span>${Number(min).toFixed(1)}${unit}</span><span>${Number((min + max) / 2).toFixed(1)}${unit}</span><span>${Number(max).toFixed(1)}${unit}</span></div>`;
  }
}
function openWeatherControls() {
  const wrap = document.querySelector(".map-wrap");
  if (!wrap || wrap.querySelector(".weather-layer-panel")) return;
  const panel = document.createElement("div");
  panel.className = "weather-layer-panel";
  panel.innerHTML = `
    <div class="weather-layer-title">Weather</div>
    <div class="weather-layer-options">
      <button type="button" class="weather-layer-button active" data-mode="temperature">Temperature</button>
      <button type="button" class="weather-layer-button" data-mode="rainfall">Rainfall</button>
      <button type="button" class="weather-layer-button" data-mode="wind">Wind</button>
      <button type="button" class="weather-layer-button" data-mode="cloud">Cloud</button>
    </div>
    <div class="weather-layer-slider">
      <label>Opacity</label>
      <input type="range" min="20" max="100" value="88" aria-label="Weather layer opacity">
    </div>
  `;
  panel.querySelectorAll(".weather-layer-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.weather.mode = button.dataset.mode;
      state.weather.range = null;
      renderWeatherLayer();
      updateWeatherControls();
    });
  });
  panel.querySelector("input[type='range']").addEventListener("input", (event) => {
    state.weather.opacity = Number(event.target.value) / 100;
    renderWeatherLayer();
  });
  state.weather.panel = panel;
  wrap.appendChild(panel);
  updateWeatherControls();
}
function openWeatherLegend() {
  const wrap = document.querySelector(".map-wrap");
  if (!wrap || wrap.querySelector(".weather-legend")) return;
  const legend = document.createElement("div");
  legend.className = "weather-legend";
  state.weather.legend = legend;
  wrap.appendChild(legend);
  updateWeatherControls();
}
function openCurrentWeatherInfo() {
  const wrap = document.querySelector(".map-wrap");
  if (!wrap || wrap.querySelector(".weather-current")) return;
  const info = document.createElement("div");
  info.className = "weather-current";
  state.weather.info = info;
  wrap.appendChild(info);
  updateWeatherInfo();
}
function updateWeatherInfo() {
  const info = state.weather.info;
  const frame = state.frames[state.index];
  if (!info || !frame) return;
  const entries = [
    ["Temperature", `${Number(frame.temperature ?? "").toFixed(1) || "—"}°C`],
    ["Wind", `${Number(frame.wind_speed ?? "").toFixed(0) || "—"} km/h`],
    ["Pressure", `${Number(frame.central_pressure ?? "").toFixed(1) || "—"} hPa`],
    ["Humidity", `${Number(frame.humidity ?? "").toFixed(0) || "—"}%`],
  ];
  info.innerHTML = `<div class="label">Current weather</div>${entries.map(([label, value]) => `<div class="row"><span>${label}</span><strong>${value}</strong></div>`).join("")}`;
}
function renderWeatherLayer() {
  if (!state.map || !state.weather.samples.length) return;
  const mode = state.weather.mode || "temperature";
  const key = `${mode}:${state.weather.samples.length}`;
  if (state.weather.overlay && state.weather.key === key) {
    state.weather.overlay.setOpacity(state.weather.opacity);
    return;
  }
  if (state.weather.overlay) state.map.removeLayer(state.weather.overlay);
  const surface = buildWeatherSurface();
  if (!surface) return;
  const modeMeta = { unit: mode === "wind" ? "km/h" : mode === "rainfall" ? "mm/h" : "°C" };
  state.weather.range = { min: surface.min, max: surface.max, unit: modeMeta.unit };
  state.weather.overlay = L.imageOverlay(surface.url, surface.bounds, { opacity: state.weather.opacity, pane: "weatherPane", interactive: false }).addTo(state.map);
  state.weather.key = key;
  updateWeatherControls();
}

function initMap() {
  state.map = L.map("map", { zoomControl:true, preferCanvas:false, scrollWheelZoom:true, minZoom:3, maxZoom:9 }).setView([18, 79], 4);
  const landPane = state.map.createPane("countryLandPane");
  landPane.style.zIndex = "250";
  const gridPane = state.map.createPane("gridPane");
  gridPane.style.zIndex = "300";
  const weatherPane = state.map.createPane("weatherPane");
  weatherPane.style.zIndex = "350";
  weatherPane.style.pointerEvents = "none";
  const indiaPane = state.map.createPane("indiaOuterPane");
  indiaPane.style.zIndex = "410";
  const statePane = state.map.createPane("indiaStatePane");
  statePane.style.zIndex = "420";
  const neighborPane = state.map.createPane("neighborBoundaryPane");
  neighborPane.style.zIndex = "430";
  state.map.getPane("overlayPane").style.zIndex = "650";
  new ResizeObserver(()=>state.map?.invalidateSize({pan:false})).observe($("map"));
  state.map.attributionControl.setPrefix("Leaflet");
  state.map.attributionControl.addAttribution("India outline: DataMeet india-soi (Survey of India State Map) · States/UTs: DataMeet Admin2 · Neighbours: Natural Earth 1:50m (India excluded)");
  injectMapEnhancements();
  openWeatherControls();
  openWeatherLegend();
  openCurrentWeatherInfo();
  L.control.scale({ imperial:false, position:"bottomleft" }).addTo(state.map);
  const grid = L.layerGroup();
  for (let lat = -10; lat <= 40; lat += 5) L.polyline([[lat, 40], [lat, 105]], { pane:"gridPane", color:"#eee7cd", weight:.7, opacity:.34, interactive:false, dashArray:"2 7" }).addTo(grid);
  for (let lon = 40; lon <= 105; lon += 5) L.polyline([[-10, lon], [40, lon]], { pane:"gridPane", color:"#eee7cd", weight:.7, opacity:.34, interactive:false, dashArray:"2 7" }).addTo(grid);
  grid.addTo(state.map);
  [["Arabian Sea",14,63],["Bay of Bengal",13,88],["Laccadive Sea",8,73],["Andaman Sea",11,96]].forEach(([name,lat,lon]) => L.marker([lat,lon], { interactive:false, icon:L.divIcon({ className:"sea-label", html:name, iconSize:[120,18], iconAnchor:[60,9] }) }).addTo(state.map));
  [["India",22.5,79.2],["Pakistan",27.4,69.1],["Bangladesh",24.0,90.1],["Nepal",28.3,84.4],["Myanmar",21.2,95.2],["Sri Lanka",7.1,80.7]].forEach(([name,lat,lon])=>L.marker([lat,lon],{interactive:false,icon:L.divIcon({className:"country-label",html:name,iconSize:[90,16],iconAnchor:[45,8]})}).addTo(state.map));
  Promise.all([api.basemap(), api.indiaBoundary(), api.indiaStates()]).then(([world, india, states]) => {
    const countryFeatures = world.features.filter(feature => feature.properties?.ADMIN !== "India");
    const neighborBoundaryCountries = new Set(["Nepal", "Bhutan", "Bangladesh", "Myanmar", "Sri Lanka"]);
    const neighborFeatures = countryFeatures.filter(feature => neighborBoundaryCountries.has(feature.properties?.ADMIN));
    const baseLand = L.geoJSON({ type:"FeatureCollection", features:countryFeatures }, { pane:"countryLandPane", interactive:false, style:() => ({ stroke:false, fillColor:"#18313d", fillOpacity:.18 }) });
    const stateBoundaries = L.geoJSON(states, { pane:"indiaStatePane", interactive:false, style:() => ({ color:"#b9c9c7", weight:.7, opacity:.72, fill:false }), onEachFeature:(feature, layer) => { if (feature.properties?.ST_NM) layer.bindTooltip(esc(feature.properties.ST_NM), { sticky:true }); } });
    const neighborBoundaries = L.geoJSON({ type:"FeatureCollection", features:neighborFeatures }, { pane:"neighborBoundaryPane", interactive:false, style:() => ({ color:"#91a3a3", weight:.55, opacity:.58, fill:false }) });
    const indiaBoundary = L.geoJSON(india, { pane:"indiaOuterPane", interactive:false, style:() => ({ color:"#f2d69d", weight:1.8, opacity:1, fill:false }) });
    state.base = L.layerGroup([baseLand, stateBoundaries, neighborBoundaries, indiaBoundary]).addTo(state.map);
    if (state.history.length) renderMap(true);
  }).catch(error => toast(`Offline boundary data unavailable: ${error.message}`, true));
}
function mapIcon(kind) { return L.divIcon({ className:"marker-shell", html:`<span class="map-marker ${kind}"></span>`, iconSize:[22,22], iconAnchor:[11,11] }); }
function distanceKm(a,b) { const rad=x=>x*Math.PI/180, dLat=rad(b[0]-a[0]), dLon=rad(b[1]-a[1]); const q=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2; return 6371*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)); }
function coastForRegion(region) { if (region.includes("Odisha")) return {name:"Odisha coast",point:[20.2,86.5]}; if (region.includes("Andhra")) return {name:"Andhra Pradesh coast",point:[16.5,82.5]}; if (region.includes("Gujarat")) return {name:"Gujarat coast",point:[22.5,69]}; if (region.includes("Tamil")) return {name:"Tamil Nadu coast",point:[11.5,80.3]}; return {name:"Indian coastline",point:[20,88]}; }
function uncertaintyPolygon(points) {
  if (points.length < 2) return [];
  const left=[], right=[];
  points.forEach((p,i) => {
    const prev=points[Math.max(0,i-1)], next=points[Math.min(points.length-1,i+1)];
    const dy=next[0]-prev[0], dx=(next[1]-prev[1])*Math.cos(p[0]*Math.PI/180), length=Math.hypot(dx,dy)||1;
    const width=0.35 + i*0.17; // Degrees, widening with lead time to visualize forecast spread.
    const offLat=(dx/length)*width, offLon=(-(dy/length)*width)/Math.max(.35,Math.cos(p[0]*Math.PI/180));
    left.push([p[0]+offLat,p[1]+offLon]); right.push([p[0]-offLat,p[1]-offLon]);
  });
  return [...left,...right.reverse()];
}
function renderMap(forceFit = false) {
  if (!state.map || !state.history.length || !state.prediction) return;
  renderWeatherLayer();
  if (state.paths) state.map.removeLayer(state.paths);
  state.paths = L.layerGroup().addTo(state.map);
  const observed=state.history.slice(0,state.index+1), histCoords=observed.map(p=>[p.latitude,p.longitude]);
  const current=observed.at(-1), future=state.prediction.predicted_path||[], forecastCoords=[[current.latitude,current.longitude],...future.map(p=>[p.latitude,p.longitude])];
  if (histCoords.length>1) L.polyline(histCoords,{color:"#eee0ae",weight:3,opacity:.98,lineJoin:"round"}).addTo(state.paths);
  observed.forEach((p,i)=>L.circleMarker([p.latitude,p.longitude],{radius:i===observed.length-1?4:3,color:"#1b2423",weight:1,fillColor:"#e8ddb0",fillOpacity:1}).bindPopup(`<b>Observed position</b><br>${fmtTime(p.timestamp)}<br>${coords(p.latitude,p.longitude)}<br>Wind ${p.wind_speed} km/h`).addTo(state.paths));
  if(future.length){
    const cone=uncertaintyPolygon(forecastCoords); if(cone.length) L.polygon(cone,{color:"#ef846e",weight:1,opacity:.55,fillColor:"#ef846e",fillOpacity:.17,interactive:false}).addTo(state.paths);
    L.polyline(forecastCoords,{color:"#ef846e",weight:3,dashArray:"8 7",opacity:.98,lineCap:"round"}).addTo(state.paths);
    future.forEach(p=>L.circleMarker([p.latitude,p.longitude],{radius:5,color:"#ffb19b",weight:2,fillColor:"#532f2c",fillOpacity:1}).bindPopup(`<b>Forecast +${p.hours}h</b><br>${coords(p.latitude,p.longitude)}<br>Wind ${p.wind_speed} km/h<br>Confidence ${Math.round(p.confidence*100)}%`).addTo(state.paths));
    const end=future.at(-1);L.circleMarker([end.latitude,end.longitude],{radius:8,color:"#fff0d0",weight:2,fillColor:"#c76754",fillOpacity:.95}).bindTooltip(`Forecast end · +${end.hours}h`).addTo(state.paths);
  }
  L.marker([current.latitude,current.longitude],{icon:mapIcon("current-marker"),zIndexOffset:1000}).bindPopup(`<b>${esc(state.event.name)}</b><br>Current observation · ${fmtTime(current.timestamp)}<br>${coords(current.latitude,current.longitude)}`).addTo(state.paths);
  const start=state.history[0]; L.circleMarker([start.latitude,start.longitude],{radius:5,color:"#f4f1df",weight:2,fillColor:"#596b5a",fillOpacity:1}).bindTooltip("Track start").addTo(state.paths);
  if(future.length){
    const coast=coastForRegion(state.event.region), nearest=future.reduce((best,p)=>{const d=distanceKm([p.latitude,p.longitude],coast.point);return d<best.distance?{point:p,distance:d}:best;},{distance:Infinity});
    L.marker([nearest.point.latitude,nearest.point.longitude],{icon:L.divIcon({className:"impact-pin",html:"◆",iconSize:[14,14],iconAnchor:[7,7]})}).bindPopup(`<b>Closest approach estimate</b><br>+${nearest.point.hours}h · ${Math.round(nearest.distance)} km from ${esc(coast.name)}`).addTo(state.paths);
  }
  const bounds=L.latLngBounds([...histCoords,...forecastCoords.slice(1),[5,60],[38,98]]);
  if(forceFit||state.fitNext){if(bounds.isValid())state.map.fitBounds(bounds.pad(.04),{maxZoom:5,animate:false});state.fitNext=false;}
  else state.map.panTo([current.latitude,current.longitude],{animate:false});
  setText("mapCenter",`Current center  ${coords(current.latitude,current.longitude)}`);
}

function renderMetrics(frame, result, detection) {
  const category=result.class||frame.intensity_class;
  setText("cycloneName",state.event.name);setText("regionName",`${state.event.basin} · ${state.event.region}`);setText("basinLabel",state.event.basin);
  setText("classification",category);setText("confidenceText",`${Math.round(result.confidence*100)}%`);$("confidenceBar").style.width=`${Math.round(result.confidence*100)}%`;
  setText("windSpeed",frame.wind_speed);setText("pressure",frame.central_pressure);setText("sst",frame.sea_surface_temperature);setText("rainfall",frame.rainfall);setText("humidity",frame.humidity);setText("movementSpeed",Number(frame.movement_speed).toFixed(1));setText("movementDirection",`${frame.movement_direction} direction`);setText("observationTime",fmtTime(frame.timestamp));
  const detected=detection?.cyclone_detected ?? Number(frame.wind_speed)>=34;
  setText("detectionLabel",detected?"Cyclone center detected":"No cyclone detected");setText("detectionConfidence",`Detection confidence ${Math.round((detection?.confidence??result.confidence)*100)}%`);
  setText("patternValue",result.pattern||"Spiral cloud field");setText("eyeValue",result.eye_detected?"Detected":"Not resolved");setText("convectionValue",result.convection_level||"Moderate");
  setText("satelliteTimestamp",fmtTime(frame.timestamp));setText("imagePosition",coords(frame.latitude,frame.longitude));
  updateWeatherInfo();
  renderImpact(state.prediction?.impact);
}
function renderImpact(impact) {
  if(!impact){setText("impactReason","Impact estimate is unavailable.");return;}
  setText("alertLevel",impact.alert_level);setText("impactRegion",impact.region);
  setText("impactDistance",`Closest forecast approach: ${impact.distance_km} km${impact.closest_approach_hours?` · +${impact.closest_approach_hours}h`:""}`);
  [["windRisk",impact.wind_risk],["rainRisk",impact.rainfall_risk],["coastRisk",impact.coastal_risk]].forEach(([key,value])=>{$(`${key}Bar`).style.width=`${value}%`;setText(`${key}Label`,value>=70?"High":value>=40?"Moderate":"Low");});
  setText("impactReason",`${impact.reason} ${impact.label}`);
}
function chart(series) {
  const svg=$("windChart"),w=560,h=180,left=43,right=13,top=14,bottom=28,n=series.length;
  if(!n){svg.innerHTML="";return;}
  const values=series.map(p=>Number(p.wind_speed));let min=Math.min(0,...values),max=Math.max(...values);if(max===min)max=min+1;
  const pad=(max-min)*.12;min=Math.max(0,min-pad);max+=pad;const x=i=>left+(i/Math.max(1,n-1))*(w-left-right),y=v=>top+(max-v)/(max-min)*(h-top-bottom);
  const path=values.map((v,i)=>`${i?"L":"M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  svg.innerHTML=`${[0,1,2,3].map(i=>{const yy=top+i*(h-top-bottom)/3,v=max-i*(max-min)/3;return `<line class="chart-gridline" x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}"/><text class="chart-y" x="${left-7}" y="${yy+3}" text-anchor="end">${Math.round(v)}</text>`}).join("")}<path d="${path}" fill="none" stroke="#79d8d0" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/>${series.map((p,i)=>`<circle cx="${x(i)}" cy="${y(values[i])}" r="${i===state.index?5:3.5}" fill="#f0b36e" stroke="#182124" stroke-width="2"><title>${esc(fmtTime(p.timestamp))} · ${values[i]} km/h · ${esc(p.intensity_class)}</title></circle>`).join("")}${series.map((_,i)=>`<text class="chart-x" x="${x(i)}" y="${h-7}" text-anchor="middle">T+${String(i*6).padStart(2,"0")}</text>`).join("")}`;
}
function renderForecast() {
  const points=state.prediction?.predicted_path||[];
  if(!points.length){$("forecastRows").innerHTML='<tr><td colspan="5" class="empty-row">No forecast points available</td></tr>';return;}
  $("forecastRows").innerHTML=points.map(p=>`<tr><td>+${p.hours}h</td><td>${coords(p.latitude,p.longitude)}</td><td>${p.wind_speed} km/h</td><td>${p.central_pressure??"—"} hPa</td><td>${fmtTime(p.timestamp)}</td></tr>`).join("");
  const confidence=points.at(-1)?.confidence;setText("forecastConfidence",`48h confidence ${confidence==null?"—":`${Math.round(confidence*100)}%`}`);
}
function renderTimeline() {
  const frame=state.frames[state.index];if(!frame)return;
  const offset=frame.offset_hours;setText("imageStamp",`T+${String(offset).padStart(2,"0")}`);setText("timelineTime",`T+${String(offset).padStart(2,"0")}`);setText("timelineDate",fmtTime(frame.timestamp));setText("timelineIndex",`${String(state.index+1).padStart(2,"0")} / ${String(state.frames.length).padStart(2,"0")}`);
  $("timeline").value=state.index;$("timeline").max=state.frames.length-1;
  $("timelineLabels").innerHTML=state.frames.map((f,i)=>`<button class="tick ${i===state.index?"selected":""}" data-index="${i}" aria-label="Observation at T plus ${f.offset_hours} hours">T+${String(f.offset_hours).padStart(2,"0")}</button>`).join("");
  $("timelineLabels").querySelectorAll("button").forEach(button=>button.addEventListener("click",()=>goTo(Number(button.dataset.index))));
  const image=$("satelliteImage"),loader=$("imageLoading");loader.classList.remove("hidden");loader.textContent="Loading satellite frame…";image.onload=()=>loader.classList.add("hidden");image.onerror=()=>{loader.textContent="Unable to load satellite frame";};image.src=`${api.imageUrl(frame.image_url)}?v=20260930-3`;
}
async function goTo(index) {
  if(!state.event||!state.frames.length)return;
  state.index=Math.max(0,Math.min(state.frames.length-1,index));const requestId=++state.frameRequest,frame=state.frames[state.index];renderTimeline();chart(state.frames);
  try {
    const observation={cyclone_id:state.event.id,wind_speed:frame.wind_speed,central_pressure:frame.central_pressure,temperature:frame.temperature,humidity:frame.humidity,sea_surface_temperature:frame.sea_surface_temperature,cloud_top_temperature:frame.cloud_top_temperature,rainfall:frame.rainfall,movement_speed:frame.movement_speed,image_path:frame.image_path,latitude:frame.latitude,longitude:frame.longitude,timestamp:frame.timestamp};
    const detectionRequest=typeof api.detection==="function"?api.detection(observation):Promise.resolve({cyclone_detected:Number(frame.wind_speed)>=34,confidence:.7});
    const [classification,prediction,detection]=await Promise.all([api.classify(observation),api.prediction(state.event.id,state.index),detectionRequest]);
    if(requestId!==state.frameRequest)return;
    state.classification=classification;state.prediction=prediction;state.detection=detection;renderMetrics(frame,classification,detection);renderForecast();renderMap();setApi(true);
  } catch(error) { if(requestId===state.frameRequest){setApi(false);toast(`Unable to load cyclone analysis: ${error.message}`,true,()=>goTo(state.index));} }
}
async function selectCyclone(id) {
  stopPlay();const requestId=++state.cycloneRequest;state.frameRequest++;state.fitNext=true;setApi(true);setText("frameSummary","Loading observations…");
  state.event=null;state.frames=[];state.history=[];state.prediction=null;state.classification=null;state.detection=null;if(state.paths)state.paths.clearLayers();
  ["cycloneName","regionName","classification","windSpeed","pressure","sst","rainfall","humidity","movementSpeed","movementDirection","imagePosition","satelliteTimestamp","impactRegion","impactDistance","confidenceText","forecastConfidence","alertLevel"].forEach(id=>setText(id,"—"));
  $("confidenceBar").style.width="0";$("forecastRows").innerHTML='<tr><td colspan="5" class="empty-row">Loading forecast…</td></tr>';$("satelliteImage").removeAttribute("src");$("imageLoading").classList.remove("hidden");$("imageLoading").textContent="Loading observations…";setText("mapCenter","Loading selected track…");
  try {
    const [event,images,track]=await Promise.all([api.detail(id),api.images(id),api.track(id)]);if(requestId!==state.cycloneRequest)return;
    state.event=event;state.frames=images.images;state.history=track.historical_track;state.index=0;
    setText("frameSummary",`${event.observation_count||state.frames.length} observations · ${event.data_label||"Simulation data"}`);chart(state.frames);await goTo(0);
  } catch(error) { if(requestId===state.cycloneRequest){setApi(false);setText("frameSummary","Unable to load selected cyclone");toast(error.message,true,()=>selectCyclone(id));} }
}
function renderSources(sources) {
  const labels=["Satellite imagery","Meteorological observations","Sea surface temperature","Atmospheric parameters","Historical cyclone tracks","GIS coastline and terrain"];
  const available=sources.sources.some(source=>source.data_available);
  $("sourceList").innerHTML=labels.map(label=>`<div class="source-item"><span>${label}<small>Local generated dataset</small></span><b class="source-state">${available?"Simulated":"Unavailable"}</b></div>`).join("");
}
function loadWeatherSamples() {
  Promise.all(state.cyclones.map((cyclone) => api.images(cyclone.id).catch(() => null))).then((results) => {
    state.weather.samples = results.flatMap((result) => result?.images || []);
    state.weather.key = null;
    renderWeatherLayer();
  });
}
function stopPlay(){state.playing=false;if(state.timer)clearInterval(state.timer);state.timer=null;$("play").textContent="▶";$("play").title="Play time-lapse";$("play").classList.remove("is-playing");}
function togglePlay(){if(state.playing){stopPlay();return;}state.playing=true;$("play").textContent="Ⅱ";$("play").title="Pause time-lapse";$("play").classList.add("is-playing");state.timer=setInterval(()=>{if(state.index>=state.frames.length-1){stopPlay();return;}goTo(state.index+1);},1300);}
async function start(){
  try {
    setApi(true);const [health,items,sources]=await Promise.all([api.health(),api.cyclones(),api.sources()]);setApi(health.status==="ok");state.cyclones=items.cyclones;
    if(!state.cyclones.length)throw new Error("No cyclone scenarios are available.");
    $("cycloneSelect").innerHTML=state.cyclones.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.basin)}</option>`).join("");renderSources(sources);loadWeatherSamples();
    setText("frameSummary",`${state.cyclones.length} available scenarios`);await selectCyclone(state.cyclones[0].id);
  } catch(error) { setApi(false);setText("frameSummary","Unable to load cyclone scenarios");toast(error.message,true); }
}

$("cycloneSelect").addEventListener("change",event=>selectCyclone(event.target.value));$("timeline").addEventListener("input",event=>goTo(Number(event.target.value)));
$("previous").addEventListener("click",()=>goTo(state.index-1));$("next").addEventListener("click",()=>goTo(state.index+1));$("play").addEventListener("click",togglePlay);
$("centerCyclone").addEventListener("click",()=>{const point=state.history[state.index];if(point)state.map.setView([point.latitude,point.longitude],Math.max(5,state.map.getZoom()),{animate:true});});
$("fitTrack").addEventListener("click",()=>{state.fitNext=true;renderMap(true);});$("indiaView").addEventListener("click",()=>state.map.fitBounds([[5,60],[38,98]],{maxZoom:4,animate:true}));
setInterval(()=>setText("clock",new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())+" IST"),1000);
initMap();start();
