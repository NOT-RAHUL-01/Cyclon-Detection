// Production backend
export const API_BASE = "https://cyclon-backend.onrender.com/api";
export const apiOrigin = "https://cyclon-backend.onrender.com";

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
      },
      ...options,
    });
  } catch {
    throw new Error("Backend unavailable.");
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

async function localGeoJSON(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) {
    throw new Error(`Map data request failed (${response.status})`);
  }
  return response.json();
}

const detect = (observation) =>
  request("/cyclone/detect", {
    method: "POST",
    body: JSON.stringify(observation),
  });

export const api = {
  health: () => request("/health"),

  dashboard: (id) =>
    request(
      `/dashboard${
        id ? `?cyclone_id=${encodeURIComponent(id)}` : ""
      }`
    ),

  cyclones: () => request("/cyclones"),

  detail: (id) =>
    request(`/cyclones/${encodeURIComponent(id)}`),

  images: (id) =>
    request(`/cyclones/${encodeURIComponent(id)}/images`),

  track: (id) =>
    request(`/cyclones/${encodeURIComponent(id)}/track`),

  prediction: (id, index) =>
    request(
      `/cyclones/${encodeURIComponent(id)}/prediction?index=${index}`
    ),

  classify: (observation) =>
    request("/classify", {
      method: "POST",
      body: JSON.stringify(observation),
    }),

  detect,
  detection: detect,
  detectr: detect,

  sources: () => request("/data/sources"),

  basemap: () => localGeoJSON("../../data/maps/natural-earth-50m-countries-no-india.geojson"),

  indiaBoundary: () => localGeoJSON("../../data/maps/india-soi.geojson"),

  indiaStates: () => localGeoJSON("../../data/maps/india-state-ut-soi.geojson"),

  imageUrl: (path) => `${apiOrigin}${path}`,
};