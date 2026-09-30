import { api } from "./services/api.js";

const $ = id => document.getElementById(id);
const state = { cyclones: [], event: null, frames: [], history: [], prediction: null, classification: null, detection: null, index: 0, frameRequest: 0, cycloneRequest: 0, playing: false, timer: null, map: null, base: null, paths: null, fitNext: true };
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const classes = ["Depression", "Deep Depression", "Tropical Storm", "Cyclonic Storm", "Severe Cyclonic Storm", "Very Severe Cyclonic Storm", "Extremely Severe Cyclonic Storm"];
const rank = value => Math.max(0, classes.indexOf(value));
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value ?? "—"; };
function toast(message, error = false, retry = null) { const el = $("toast"); el.replaceChildren(document.createTextNode(message)); el.classList.toggle("error", error); if(retry){const button=document.createElement("button");button.className="retry-button";button.textContent="Retry";button.addEventListener("click",()=>{el.classList.remove("show");retry();},{once:true});el.append(" ",button);}el.classList.add("show"); clearTimeout(el._timer); el._timer = setTimeout(() => el.classList.remove("show"), 5200); }
function setApi(online) { setText("apiState", online ? "System online" : "Backend unavailable"); $("systemDot").classList.toggle("offline", !online); }
function fmtTime(value, dateOnly = false) { return new Intl.DateTimeFormat("en-GB", { day:"2-digit", month:"short", hour:dateOnly?undefined:"2-digit", minute:dateOnly?undefined:"2-digit", hour12:false, timeZone:"UTC" }).format(new Date(value)) + (dateOnly ? "" : " UTC"); }
function coords(lat, lon) { return `${Math.abs(Number(lat)).toFixed(2)}°${Number(lat) >= 0 ? "N" : "S"} ${Math.abs(Number(lon)).toFixed(2)}°${Number(lon) >= 0 ? "E" : "W"}`; }

function initMap() {
  state.map = L.map("map", { zoomControl:true, preferCanvas:false, scrollWheelZoom:true, minZoom:3, maxZoom:9 }).setView([18, 79], 4);
  new ResizeObserver(()=>state.map?.invalidateSize({pan:false})).observe($("map"));
  state.map.attributionControl.setPrefix("Leaflet");
  state.map.attributionControl.addAttribution("Illustrative offline coastlines · WGS84");
  L.control.scale({ imperial:false, position:"bottomleft" }).addTo(state.map);
  const grid = L.layerGroup();
  for (let lat = -10; lat <= 35; lat += 5) L.polyline([[lat, 40], [lat, 105]], { color:"#eee7cd", weight:.7, opacity:.34, interactive:false, dashArray:"2 7" }).addTo(grid);
  for (let lon = 40; lon <= 105; lon += 5) L.polyline([[-10, lon], [35, lon]], { color:"#eee7cd", weight:.7, opacity:.34, interactive:false, dashArray:"2 7" }).addTo(grid);
  grid.addTo(state.map);
  [["Arabian Sea",14,63],["Bay of Bengal",13,88],["Laccadive Sea",8,73],["Andaman Sea",11,96]].forEach(([name,lat,lon]) => L.marker([lat,lon], { interactive:false, icon:L.divIcon({ className:"sea-label", html:name, iconSize:[120,18], iconAnchor:[60,9] }) }).addTo(state.map));
  [["India",22.5,79.2],["Pakistan",27.4,69.1],["Bangladesh",24.0,90.1],["Nepal",28.3,84.4],["Myanmar",21.2,95.2],["Sri Lanka",7.1,80.7]].forEach(([name,lat,lon])=>L.marker([lat,lon],{interactive:false,icon:L.divIcon({className:"country-label",html:name,iconSize:[90,16],iconAnchor:[45,8]})}).addTo(state.map));
  api.basemap().then(geo => {
    state.base = L.geoJSON(geo, { style:() => ({ color:"#596e54", weight:1.35, opacity:.98, fillColor:"#c3cda9", fillOpacity:.96 }), pointToLayer:(_, point) => L.circleMarker(point,{radius:2,color:"#596e54",weight:1,fillColor:"#e0dfba",fillOpacity:1}), onEachFeature:(feature,layer) => { if (feature.properties?.name) layer.bindTooltip(esc(feature.properties.name), { sticky:true }); } }).addTo(state.map);
    if (state.history.length) renderMap(true);
  }).catch(error => toast(`Offline basemap unavailable: ${error.message}`, true));
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
  const bounds=L.latLngBounds([...histCoords,...forecastCoords.slice(1),[6,61],[30,96]]);
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
  const image=$("satelliteImage"),loader=$("imageLoading");loader.classList.remove("hidden");loader.textContent="Loading satellite frame…";image.onload=()=>loader.classList.add("hidden");image.onerror=()=>{loader.textContent="Unable to load satellite frame";};image.src=api.imageUrl(frame.image_url);
}
async function goTo(index) {
  if(!state.event||!state.frames.length)return;
  state.index=Math.max(0,Math.min(state.frames.length-1,index));const requestId=++state.frameRequest,frame=state.frames[state.index];renderTimeline();chart(state.frames);
  try {
    const observation={cyclone_id:state.event.id,wind_speed:frame.wind_speed,central_pressure:frame.central_pressure,temperature:frame.temperature,humidity:frame.humidity,sea_surface_temperature:frame.sea_surface_temperature,cloud_top_temperature:frame.cloud_top_temperature,rainfall:frame.rainfall,movement_speed:frame.movement_speed,image_path:frame.image_path,latitude:frame.latitude,longitude:frame.longitude,timestamp:frame.timestamp};
    const [classification,prediction,detection]=await Promise.all([api.classify(observation),api.prediction(state.event.id,state.index),api.detect(observation)]);
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
function stopPlay(){state.playing=false;if(state.timer)clearInterval(state.timer);state.timer=null;$("play").textContent="▶";$("play").title="Play time-lapse";$("play").classList.remove("is-playing");}
function togglePlay(){if(state.playing){stopPlay();return;}state.playing=true;$("play").textContent="Ⅱ";$("play").title="Pause time-lapse";$("play").classList.add("is-playing");state.timer=setInterval(()=>{if(state.index>=state.frames.length-1){stopPlay();return;}goTo(state.index+1);},1300);}
async function start(){
  try {
    setApi(true);const [health,items,sources]=await Promise.all([api.health(),api.cyclones(),api.sources()]);setApi(health.status==="ok");state.cyclones=items.cyclones;
    if(!state.cyclones.length)throw new Error("No cyclone scenarios are available.");
    $("cycloneSelect").innerHTML=state.cyclones.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.basin)}</option>`).join("");renderSources(sources);
    setText("frameSummary",`${state.cyclones.length} available scenarios`);await selectCyclone(state.cyclones[0].id);
  } catch(error) { setApi(false);setText("frameSummary","Unable to load cyclone scenarios");toast(error.message,true); }
}

$("cycloneSelect").addEventListener("change",event=>selectCyclone(event.target.value));$("timeline").addEventListener("input",event=>goTo(Number(event.target.value)));
$("previous").addEventListener("click",()=>goTo(state.index-1));$("next").addEventListener("click",()=>goTo(state.index+1));$("play").addEventListener("click",togglePlay);
$("centerCyclone").addEventListener("click",()=>{const point=state.history[state.index];if(point)state.map.setView([point.latitude,point.longitude],Math.max(5,state.map.getZoom()),{animate:true});});
$("fitTrack").addEventListener("click",()=>{state.fitNext=true;renderMap(true);});$("indiaView").addEventListener("click",()=>state.map.fitBounds([[5,60],[31,96]],{maxZoom:4,animate:true}));
setInterval(()=>setText("clock",new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())+" IST"),1000);
initMap();start();
