# SIH 2026 · Tropical Cyclone Intelligence Prototype

Offline-ready demonstration for PS 26070 / PS 70. Events, image sequences, weather observations, classifications and forecasts are synthetic. This is not an operational alert service and does not represent real historical cyclones or an evaluated AI model.

## Run the dashboard

Requirements: Python 3.10+, Pillow and NumPy (`python -m pip install -r requirements.txt` if needed). No internet connection is needed after dependencies are present; Leaflet, its icons, the synthetic data, PNGs and offline vector basemap are stored in this project.

From the project root, start two terminals:

1. Backend: `python -m backend.app`
2. Frontend: `python -m http.server 3000 --bind 127.0.0.1 --directory frontend`
3. Open `http://127.0.0.1:3000`.

Regenerate all local data and 40 PNG observations with `python scripts/generate_dummy_data.py`. Run API/data tests with `python -m unittest backend.tests.test_api -v`.

The browser check uses Microsoft Edge. In a third PowerShell terminal start headless Edge with a remote debugging port, then run the smoke script in another terminal:

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' --headless=new --disable-gpu --no-first-run --remote-debugging-port=9222 --user-data-dir=D:\cyclon\.edge-test http://127.0.0.1:3000
node scripts/browser_smoke.mjs
```

The browser smoke check covers the cyclone selector, locally served PNGs, timeline slider and previous/next/play controls, Leaflet basemap and track geometry, current and forecast marker popups, chart updates, frontend/backend communication, offline-only page resources and browser runtime errors.

## Data and model layout

- `data/cyclone_images/`: 40 generated, 420 × 420 PNG infrared-like cloud sequences.
- `data/cyclone_dataset.csv`: 40 timestamped observations, with weather, movement and intensity features.
- `data/cyclone_events.json`, `data/cyclone_tracks.json`, `data/cyclone_predictions.json`: event records, historical tracks and +6/+12/+24/+48 hour predictions.
- `data/maps/indian_ocean.geojson`: locally served simplified geographic land outlines for the Leaflet GIS map.
- `scripts/generate_dummy_data.py`: deterministic procedural image and data generator.
- `ml/preprocessing.py`, `ml/classification_model.py`, `ml/path_prediction.py`: replaceable feature, image/weather classification and smooth track-prediction interfaces.
- `ml/train.py`: trains a standardized nearest-centroid intensity classifier and a small track-motion regression from the synthetic dataset. Run `python -m ml.train` to regenerate `ml/artifacts/cyclone_classifier.json`.
- `backend/app.py`: HTTP API and static PNG serving. Compatibility detection/classification adapters are in `backend/models/`.
- `frontend/src/services/api.js`: centralized API base and fetch service. Override it by assigning `window.CYCLONE_API_BASE` before `src/main.js` loads.
- `frontend/vendor/leaflet/`: vendored Leaflet 1.9.4 distribution and MIT license. The map uses local GeoJSON, not remote tile services.

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and demo mode |
| GET | `/api/dashboard` | Overview payload |
| GET | `/api/cyclones` | Five synthetic events and current observations |
| GET | `/api/cyclones/{id}` | Event detail and its observations |
| GET | `/api/cyclones/{id}/images` | Eight timestamped images and observation values |
| GET | `/api/images/{filename}` | Actual generated PNG file |
| GET | `/api/cyclones/{id}/track` | Historical observations |
| GET | `/api/cyclones/{id}/prediction?index=0` | Forecast plus derived closest-approach and risk summary |
| POST | `/api/classify` | Synthetic image/weather classification |
| GET | `/api/data/sources` | Source coverage, explicitly labeled simulated or local |
| GET | `/api/map/indian-ocean` | Offline local GeoJSON basemap |

Example classification body:

```json
{"wind_speed":150,"central_pressure":950,"image_path":"data/cyclone_images/cyclone_003_t24.png"}
```

The response returns `class`, `confidence`, `confidence_label`, wind, pressure, image-derived cloud-field coverage and the model name. The prediction endpoint adds an `impact` object containing the nearest-coast estimate, wind/rain/coastal risk scores, alert level and a non-operational warning label. Invalid requests return HTTP 400 JSON errors; unknown event/image paths return 404.

## Production replacement points and limitations

Replace the procedural imagery and generated records with licensed satellite observations and quality-controlled meteorological feeds. Replace the deterministic classifier with an evaluated CNN/EfficientNet/ResNet/ViT implementation, and replace trajectory extrapolation with a validated sequence/trajectory model. The stable JSON APIs let the frontend remain unchanged.

The intensity classifier and motion fit are trained from generated records; they are not validated or calibrated against real observations. The offline basemap is an illustrative regional outline, not a detailed navigational chart. Forecast tracks, uncertainty corridor and closest-approach estimates are for simulation only. The browser uses plain JavaScript modules and vendored Leaflet; there is no `package.json` or React build step.
