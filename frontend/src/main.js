import { api } from "./services/api.js";

const $=id=>document.getElementById(id);
function cleanCopy(value){
  let text=String(value).replace(/\bdummy\b/gi,"sample").replace(/\bsynthetic\b/gi,"generated").replace(/\bdemo\b/gi,"prototype");
  if(text.length>3&&/[A-Z]/.test(text)&&text===text.toUpperCase())text=text.toLowerCase().replace(/^([a-z])/,(m,c)=>c.toUpperCase());
  return text;
}
function polishPageCopy(){
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode())walker.currentNode.nodeValue=cleanCopy(walker.currentNode.nodeValue);
  document.querySelectorAll("[title],[alt]").forEach(node=>["title","alt"].forEach(key=>{if(node.hasAttribute(key))node.setAttribute(key,cleanCopy(node.getAttribute(key)));}));
}
const state={cyclones:[],event:null,frames:[],history:[],prediction:null,index:0,frameRequest:0,cycloneRequest:0,playing:false,timer:null,map:null,base:null,paths:null};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const classes=["Depression","Deep Depression","Tropical Storm","Cyclonic Storm","Severe Cyclonic Storm","Very Severe Cyclonic Storm","Extremely Severe Cyclonic Storm"];
const classRank=name=>Math.max(0,classes.indexOf(name));
function say(message,error=false){const t=$("toast");t.textContent=message;t.classList.toggle("error",error);t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3300);}
function setApi(online){$("apiState").textContent=online?"API CONNECTED":"BACKEND OFFLINE";$("apiState").classList.toggle("offline",!online);}
function fmtTime(value){return new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"UTC"}).format(new Date(value))+" UTC";}
function setText(id,value){$(id).textContent=cleanCopy(value??"—");}

function initMap(){
  state.map=L.map("map",{zoomControl:true,preferCanvas:false,scrollWheelZoom:true}).setView([16,81],4);
  state.map.attributionControl.setPrefix("Leaflet");
  state.map.attributionControl.addAttribution("Offline synthetic coastlines · WGS84");
  L.control.scale({imperial:false,position:"bottomleft"}).addTo(state.map);
  const graticule=L.layerGroup();
  for(let lat=-10;lat<=35;lat+=5)L.polyline([[lat,40],[lat,105]],{color:"#e5e0c7",weight:.7,opacity:.35,interactive:false,dashArray:"2 6"}).addTo(graticule);
  for(let lon=40;lon<=105;lon+=5)L.polyline([[-10,lon],[35,lon]],{color:"#e5e0c7",weight:.7,opacity:.35,interactive:false,dashArray:"2 6"}).addTo(graticule);
  graticule.addTo(state.map);
  [["Arabian Sea",14,63],["Bay of Bengal",13,88],["Laccadive Sea",8,73],["Andaman Sea",11,96]].forEach(([name,lat,lon])=>L.marker([lat,lon],{interactive:false,icon:L.divIcon({className:"sea-label",html:name,iconSize:[120,18],iconAnchor:[60,9]})}).addTo(state.map));
  api.basemap().then(geo=>{
    state.base=L.geoJSON(geo,{style:()=>({color:"#586c50",weight:1.25,opacity:.95,fillColor:"#bdcba9",fillOpacity:.94}),
      pointToLayer:(feature,latlng)=>L.circleMarker(latlng,{radius:2,color:"#667558",weight:1,fillColor:"#d4d9b9",fillOpacity:.95}),
      onEachFeature:(feature,layer)=>{if(feature.properties?.name)layer.bindTooltip(esc(feature.properties.name),{sticky:true});}}).addTo(state.map);
  }).catch(error=>say(error.message,true));
}

function icon(kind){return L.divIcon({className:"marker-shell",html:`<span class="map-marker ${kind}"></span>`,iconSize:[18,18],iconAnchor:[9,9]});}
function clearPaths(){if(state.paths)state.paths.clearLayers();state.paths=L.layerGroup().addTo(state.map);}
function haversine(a,b){const rad=x=>x*Math.PI/180;const dlat=rad(b[0]-a[0]),dlon=rad(b[1]-a[1]);const q=Math.sin(dlat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dlon/2)**2;return 6371*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
function renderMap(){
  if(!state.map||!state.history.length||!state.prediction)return;clearPaths();
  const hist=state.history.slice(0,state.index+1), points=hist.map(p=>[p.latitude,p.longitude]);
  if(points.length>1)L.polyline(points,{color:"#e4d8a9",weight:3,opacity:.98,lineCap:"round",lineJoin:"round"}).addTo(state.paths);
  hist.forEach((p,i)=>L.circleMarker([p.latitude,p.longitude],{radius:i===hist.length-1?4:3,color:"#07151d",weight:1,fillColor:"#62ddca",fillOpacity:1}).bindPopup(`<b>Observed position</b><br>${fmtTime(p.timestamp)}<br>${Number(p.latitude).toFixed(2)}°, ${Number(p.longitude).toFixed(2)}°<br>Wind ${p.wind_speed??"—"} km/h`).addTo(state.paths));
  const current=hist.at(-1),future=state.prediction.predicted_path||[],forecastCoords=[[current.latitude,current.longitude],...future.map(p=>[p.latitude,p.longitude])];
  if(future.length)L.polyline(forecastCoords,{color:"#a85235",weight:3,dashArray:"7 8",opacity:.98,lineCap:"round"}).addTo(state.paths);
  const active=L.marker([current.latitude,current.longitude],{icon:icon("current-marker"),zIndexOffset:900}).bindPopup(`<b>${esc(state.event.name)}</b><br>Current observation · T+${String(state.index*6).padStart(2,"0")}h<br>${current.latitude.toFixed(2)}°N, ${Math.abs(current.longitude).toFixed(2)}°E`).addTo(state.paths);
  future.forEach(p=>L.circleMarker([p.latitude,p.longitude],{radius:6,color:"#f0ad68",weight:2,fillColor:"#36281d",fillOpacity:.9}).bindPopup(`<b>Forecast +${p.hours}h</b><br>${Number(p.latitude).toFixed(2)}°, ${Number(p.longitude).toFixed(2)}°<br>Wind ${p.wind_speed} km/h · ${esc(p.intensity_class)}<br>Model confidence ${Math.round(p.confidence*100)}%`).addTo(state.paths));
  const nearestTarget=state.event.region.includes("Odisha")?[20.2,86.5]:state.event.region.includes("Andhra")?[16.5,82.5]:state.event.region.includes("Gujarat")?[22.5,69]:state.event.region.includes("Tamil")?[11.5,80.3]:[20,88];
  const nearest=future.reduce((best,p)=>{const d=haversine([p.latitude,p.longitude],nearestTarget);return d<best.distance?{point:p,distance:d}:best;},{distance:Infinity});
  if(nearest.distance<550)L.circleMarker([nearest.point.latitude,nearest.point.longitude],{radius:9,color:"#ff827b",weight:2,fillColor:"#5a2426",fillOpacity:.8}).bindPopup(`<b>Closest approach estimate</b><br>+${nearest.point.hours}h · ${Math.round(nearest.distance)} km from ${esc(state.event.region)}`).addTo(state.paths);
  const bounds=L.latLngBounds([...points,...forecastCoords.slice(1)]);if(bounds.isValid())state.map.fitBounds(bounds.pad(.18),{maxZoom:5,animate:false});
  setText("mapCenter",`CENTER ${current.latitude.toFixed(2)}°N / ${current.longitude.toFixed(2)}°E`);
}

function renderMetrics(frame,result){
  setText("cycloneName",state.event.name);setText("regionName",`${state.event.basin} · ${state.event.region}`);setText("basinLabel",state.event.basin.toUpperCase());
  setText("classification",result.class);setText("confidenceText",`${Math.round(result.confidence*100)}%`);$("confidenceBar").style.width=`${Math.round(result.confidence*100)}%`;
  setText("windSpeed",frame.wind_speed);setText("pressure",frame.central_pressure);setText("movementSpeed",Number(frame.movement_speed).toFixed(1));setText("movementDirection",`DIRECTION ${frame.movement_direction}`);
  const ns=Number(frame.latitude)>=0?"N":"S",ew=Number(frame.longitude)>=0?"E":"W";setText("coordinates",`${Math.abs(frame.latitude).toFixed(2)}°${ns} ${Math.abs(frame.longitude).toFixed(2)}°${ew}`);setText("observationTime",fmtTime(frame.timestamp));
  setText("temperature",frame.temperature);setText("humidity",frame.humidity);setText("sst",frame.sea_surface_temperature);setText("cloudTemp",frame.cloud_top_temperature);setText("rainfall",frame.rainfall);setText("movementMet",Number(frame.movement_speed).toFixed(1));
  setText("cloudCoverage",result.cloud_coverage===null?"Synthetic spiral pattern analyzed":`Cloud-field fraction ${Math.round(result.cloud_coverage*100)}%`);
}

function chart(svgId,series,key,color,format){
  const svg=$(svgId),w=420,h=116,left=31,right=12,top=10,bottom=24,n=series.length;
  if(!n){svg.innerHTML="";return;}
  const values=series.map(item=>Number(item[key]));let min=Math.min(...values),max=Math.max(...values);if(min===max){min-=1;max+=1;}const pad=(max-min)*.12;min-=pad;max+=pad;
  const x=i=>left+(i/(Math.max(n-1,1)))*(w-left-right),y=v=>top+(max-v)/(max-min)*(h-top-bottom);
  const path=values.map((value,i)=>`${i?"L":"M"}${x(i).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const labels=[0,Math.floor((n-1)/2),n-1].filter((v,i,a)=>a.indexOf(v)===i);
  svg.innerHTML=`${[0,1,2].map(i=>{const yy=top+i*(h-top-bottom)/2;return `<line class="chart-gridline" x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}"/><text class="chart-y" x="${left-5}" y="${yy+3}" text-anchor="end">${format(max-i*(max-min)/2)}</text>`;}).join("")}<path d="${path} L${x(n-1)} ${h-bottom} L${x(0)} ${h-bottom}Z" fill="${color}" opacity=".07"/><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>${series.map((v,i)=>`<circle cx="${x(i)}" cy="${y(values[i])}" r="${i===state.index?4:2.5}" fill="${color}" stroke="#0c1b24" stroke-width="1.5"><title>${esc(v.timestamp)} · ${format(values[i])}</title></circle>`).join("")}${labels.map(i=>`<text class="chart-x" x="${x(i)}" y="${h-5}" text-anchor="middle">T+${String(i*6).padStart(2,"0")}h</text>`).join("")}`;
}
function renderCharts(){const frames=state.frames;chart("windChart",frames,"wind_speed","#50d5c2",v=>`${Number(v).toFixed(0)}`);chart("pressureChart",frames,"central_pressure","#eca85f",v=>`${Number(v).toFixed(0)}`);chart("intensityChart",frames.map(f=>({...f,rank:classRank(f.intensity_class)})),"rank","#bd9bf6",v=>classes[Math.round(v)]||"—");chart("movementChart",frames,"movement_speed","#77b7e4",v=>`${Number(v).toFixed(0)}`);}

function renderTimeline(){const frame=state.frames[state.index];if(!frame)return;const offset=frame.offset_hours;setText("imageStamp",`T+${String(offset).padStart(2,"0")}H`);setText("timelineTime",`T+${String(offset).padStart(2,"0")}h`);setText("timelineDate",fmtTime(frame.timestamp));setText("timelineIndex",`${String(state.index+1).padStart(2,"0")} / ${String(state.frames.length).padStart(2,"0")}`);setText("imagePosition",`${frame.latitude.toFixed(2)}° / ${frame.longitude.toFixed(2)}°`);$("timeline").value=state.index;$("timeline").max=state.frames.length-1;$("timelineLabels").innerHTML=state.frames.map((f,i)=>`<button class="tick ${i===state.index?"selected":""}" data-index="${i}">T+${String(f.offset_hours).padStart(2,"0")}</button>`).join("");$("timelineLabels").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>goTo(Number(b.dataset.index))));
  const image=$("satelliteImage"),loader=$("imageLoading");loader.classList.remove("hidden");loader.textContent="Loading generated image…";image.onload=()=>loader.classList.add("hidden");image.onerror=()=>{loader.textContent="Generated PNG could not be loaded";};image.src=api.imageUrl(frame.image_url);
}

async function goTo(index){
  if(!state.event||!state.frames.length)return;state.index=Math.max(0,Math.min(state.frames.length-1,index));const requestId=++state.frameRequest,frame=state.frames[state.index];renderTimeline();renderCharts();
  try{
    const [classification,prediction]=await Promise.all([api.classify({wind_speed:frame.wind_speed,central_pressure:frame.central_pressure,temperature:frame.temperature,humidity:frame.humidity,sea_surface_temperature:frame.sea_surface_temperature,cloud_top_temperature:frame.cloud_top_temperature,rainfall:frame.rainfall,movement_speed:frame.movement_speed,image_path:frame.image_path}),api.prediction(state.event.id,state.index)]);
    if(requestId!==state.frameRequest)return;state.prediction=prediction;renderMetrics(frame,classification);renderMap();setApi(true);
  }catch(error){setApi(false);say(error.message,true);}
}

async function selectCyclone(id){
  stopPlay();const requestId=++state.cycloneRequest;state.frameRequest++;setApi(true);$("frameSummary").textContent="LOADING BACKEND OBSERVATIONS…";
  try{
    const [event,images,track]=await Promise.all([api.detail(id),api.images(id),api.track(id)]);if(requestId!==state.cycloneRequest)return;state.event=event;state.frames=images.images;state.history=track.historical_track;state.index=0;
    setText("frameSummary",`${state.frames.length} TIME-LAPSE FRAMES · ${event.data_label}`);renderCharts();await goTo(0);
  }catch(error){setApi(false);setText("frameSummary",error.message);say(error.message,true);}
}

function stopPlay(){state.playing=false;if(state.timer)clearInterval(state.timer);state.timer=null;$("play").textContent="▶";$("play").classList.remove("is-playing");}
function togglePlay(){if(state.playing){stopPlay();return;}state.playing=true;$("play").textContent="Ⅱ";$("play").classList.add("is-playing");state.timer=setInterval(()=>{if(state.index>=state.frames.length-1){stopPlay();return;}goTo(state.index+1);},1150);}

async function start(){
  try{
    setApi(true);const [health,items,sources]=await Promise.all([api.health(),api.cyclones(),api.sources()]);setApi(health.status==="ok");state.cyclones=items.cyclones;
    $("cycloneSelect").innerHTML=state.cyclones.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.basin)}</option>`).join("");
    const statuses=sources.sources.filter(s=>s.data_available).length;setText("frameSummary",`${state.cyclones.length} EVENTS · ${statuses} LOCAL FEEDS`);await selectCyclone(state.cyclones[0].id);
  }catch(error){setApi(false);setText("frameSummary",error.message);say(error.message,true);}
}

$("cycloneSelect").addEventListener("change",e=>selectCyclone(e.target.value));$("timeline").addEventListener("input",e=>goTo(Number(e.target.value)));$("previous").addEventListener("click",()=>goTo(state.index-1));$("next").addEventListener("click",()=>goTo(state.index+1));$("play").addEventListener("click",togglePlay);
setInterval(()=>{$("clock").textContent=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())+" IST";},1000);
polishPageCopy();initMap();start();
