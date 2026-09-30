// One API base for all calls; set window.CYCLONE_API_BASE before main.js if deployed elsewhere.
export const API_BASE = window.CYCLONE_API_BASE || `${location.protocol}//${location.hostname}:8000/api`;
export const apiOrigin = API_BASE.replace(/\/api\/?$/, "");

async function request(path, options = {}) {
  let response;
  try { response=await fetch(`${API_BASE}${path}`,{headers:{"Content-Type":"application/json"},...options}); }
  catch { throw new Error("Backend unavailable. Start the local API server and retry."); }
  const data=await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}

export const api={
  health:()=>request("/health"), dashboard:(id)=>request(`/dashboard${id?`?cyclone_id=${encodeURIComponent(id)}`:""}`),
  cyclones:()=>request("/cyclones"), detail:id=>request(`/cyclones/${encodeURIComponent(id)}`),
  images:id=>request(`/cyclones/${encodeURIComponent(id)}/images`), track:id=>request(`/cyclones/${encodeURIComponent(id)}/track`),
  prediction:(id,index)=>request(`/cyclones/${encodeURIComponent(id)}/prediction?index=${index}`),
  classify:observation=>request("/classify",{method:"POST",body:JSON.stringify(observation)}),
  sources:()=>request("/data/sources"), basemap:()=>request("/map/indian-ocean"),
  imageUrl:path=>`${apiOrigin}${path}`
};
