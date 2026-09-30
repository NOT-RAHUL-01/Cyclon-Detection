// End-to-end dashboard smoke check. Run while both local app servers and headless Edge are active.
import assert from "node:assert/strict";

const debug = "http://127.0.0.1:9222/json";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let pages;
for (let attempt=0;attempt<30;attempt++) {
  try { pages=await (await fetch(debug)).json(); break; } catch { await delay(250); }
}
const page=pages?.find(target=>target.type==="page"&&target.url.startsWith("http://127.0.0.1:3000"));
assert.ok(page,"Headless Edge dashboard page was not found on port 9222");
const ws=new WebSocket(page.webSocketDebuggerUrl),pending=new Map();let nextId=0;const pageErrors=[];
ws.addEventListener("message",event=>{const message=JSON.parse(event.data);if(message.method==="Runtime.exceptionThrown")pageErrors.push(message.params.exceptionDetails.text);if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
function command(method,params={}){const id=++nextId;ws.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{pending.set(id,message=>message.error?reject(new Error(message.error.message)):resolve(message.result));});}
async function evaluate(expression){const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);return result.result.value;}
async function waitFor(expression,label){for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(200);}const state=await evaluate("({title:document.title,name:document.querySelector('#cycloneName')?.textContent,api:document.querySelector('#apiState')?.textContent,image:document.querySelector('#satelliteImage')?.currentSrc,imageLoaded:document.querySelector('#satelliteImage')?.naturalWidth,map:!!document.querySelector('#map.leaflet-container'),geometry:document.querySelectorAll('#map .leaflet-overlay-pane path').length,frame:document.querySelector('#frameSummary')?.textContent,leaflet:window.L?.version,overlay:document.querySelector('#map .leaflet-overlay-pane')?.innerHTML.slice(0,300),toast:document.querySelector('#toast')?.textContent})");throw new Error(`Timed out waiting for ${label}: ${JSON.stringify({state,pageErrors})}`);}

try {
  await command("Page.enable");await command("Runtime.enable");await command("Page.reload",{ignoreCache:true});await delay(500);
  await waitFor("document.querySelector('#cycloneName')?.textContent.includes('001') && document.querySelector('#satelliteImage')?.naturalWidth===420 && document.querySelector('#map .leaflet-overlay-pane path')", "initial API-backed image and Leaflet geometry");
  const initial=await evaluate("({name:document.querySelector('#cycloneName').textContent,classification:document.querySelector('#classification').textContent,image:document.querySelector('#satelliteImage').currentSrc,loadedImageWidth:document.querySelector('#satelliteImage').naturalWidth,geoPaths:document.querySelectorAll('#map .leaflet-overlay-pane path').length,leaflet:!!document.querySelector('#map.leaflet-container'),forecastRows:document.querySelectorAll('#forecastRows tr').length,impact:document.querySelector('#alertLevel').textContent})");
  assert.match(initial.name,/001/);assert.equal(initial.loadedImageWidth,420);assert.ok(initial.geoPaths>=2);assert.ok(initial.leaflet);
  assert.equal(initial.forecastRows,4);assert.ok(["ELEVATED","WATCH","WARNING"].includes(initial.impact));
  const india=await evaluate("({label:[...document.querySelectorAll('#map .country-label')].some(x=>x.textContent==='India'),uncertainty:[...document.querySelectorAll('#map .leaflet-overlay-pane path')].some(x=>x.getAttribute('fill')==='#ef846e')})");assert.ok(india.label);assert.ok(india.uncertainty);
  await evaluate("(()=>{const s=document.querySelector('#cycloneSelect');s.value='CYCLONE-002';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  await waitFor("document.querySelector('#cycloneName')?.textContent.includes('002') && document.querySelector('#satelliteImage')?.currentSrc.includes('cyclone_002_t00.png') && document.querySelector('#satelliteImage')?.naturalWidth===420", "cyclone selector and image update");
  await evaluate("(()=>{const r=document.querySelector('#timeline');r.value='4';r.dispatchEvent(new Event('input',{bubbles:true}));return true})()");
  await waitFor("document.querySelector('#imageStamp')?.textContent==='T+24' && document.querySelector('#satelliteImage')?.currentSrc.includes('cyclone_002_t24.png') && document.querySelector('#satelliteImage')?.naturalWidth===420 && document.querySelector('#map .current-marker')", "timeline image, classification, and current map marker");
  const selected=await evaluate("({stamp:document.querySelector('#imageStamp').textContent,wind:document.querySelector('#windSpeed').textContent,classification:document.querySelector('#classification').textContent,position:document.querySelector('#imagePosition').textContent,vectorPaths:document.querySelectorAll('#map .leaflet-overlay-pane path.leaflet-interactive').length,chartPoints:document.querySelectorAll('#windChart circle').length,api:document.querySelector('#apiState').textContent,forecastRows:document.querySelectorAll('#forecastRows tr').length})");
  assert.equal(selected.stamp,"T+24");assert.ok(Number(selected.wind)>0);assert.ok(selected.vectorPaths>=9);assert.ok(selected.chartPoints>=8);assert.equal(selected.api,"System online");assert.equal(selected.forecastRows,4);
  await evaluate("document.querySelector('#map .current-marker').click()");
  await waitFor("document.querySelector('.leaflet-popup-content')?.textContent.includes('Current observation')", "interactive map marker popup");
  await evaluate("(()=>{const p=[...document.querySelectorAll('#map .leaflet-overlay-pane path')].find(x=>x.getAttribute('stroke')==='#ffb19b');if(!p)throw new Error('forecast point not found');p.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()");
  await waitFor("document.querySelector('.leaflet-popup-content')?.textContent.includes('Forecast +')", "forecast marker popup");
  await evaluate("document.querySelector('#next').click()");await waitFor("document.querySelector('#imageStamp')?.textContent==='T+30'", "next timeline control");
  await evaluate("document.querySelector('#previous').click()");await waitFor("document.querySelector('#imageStamp')?.textContent==='T+24'", "previous timeline control");
  await evaluate("document.querySelector('#play').click()");await waitFor("document.querySelector('#imageStamp')?.textContent==='T+30'", "play timeline control");await evaluate("document.querySelector('#play').click()");
  await evaluate("document.querySelector('#centerCyclone').click();document.querySelector('#fitTrack').click();document.querySelector('#indiaView').click()");
  await command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(250);
  const mobile=await evaluate("({width:innerWidth,documentWidth:document.documentElement.scrollWidth,mapWidth:Math.round(document.querySelector('#map').getBoundingClientRect().width),imageWidth:Math.round(document.querySelector('#satelliteImage').getBoundingClientRect().width)})");
  assert.ok(mobile.documentWidth<=mobile.width+1,`Horizontal overflow at mobile width: ${JSON.stringify(mobile)}`);assert.ok(mobile.mapWidth>0&&mobile.imageWidth>0);
  const resources=await evaluate("performance.getEntriesByType('resource').map(r=>r.name)");assert.ok(resources.every(url=>url.startsWith('http://127.0.0.1:3000/')||url.startsWith('http://127.0.0.1:8000/')),`Unexpected external resource request: ${resources.filter(url=>!url.startsWith('http://127.0.0.1:3000/')&&!url.startsWith('http://127.0.0.1:8000/')).join(', ')}`);
  assert.deepEqual(pageErrors,[],`Browser runtime errors: ${pageErrors.join("; ")}`);
  console.log(JSON.stringify({ok:true,initial,selected,mobile,offlineResources:true,controls:"selector, slider, previous, next, play, map view controls, impact and forecast popups"},null,2));
} finally { ws.close(); }
