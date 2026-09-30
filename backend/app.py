"""Offline JSON and PNG API backed by the generated synthetic cyclone dataset."""
import csv
import json
import mimetypes
import re
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from backend.models.cyclone_classification import CycloneClassificationModel
from backend.models.cyclone_detection import CycloneDetectionModel
from ml.path_prediction import CycloneTrackPredictionModel

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/"data"
EVENTS=json.loads((DATA/"cyclone_events.json").read_text(encoding="utf-8"))
TRACKS=json.loads((DATA/"cyclone_tracks.json").read_text(encoding="utf-8"))
PREDICTIONS=json.loads((DATA/"cyclone_predictions.json").read_text(encoding="utf-8"))
SOURCES={"sources":[{"name":"INSAT","status":"DEMO","data_available":True},{"name":"NOAA","status":"DEMO","data_available":True},{"name":"NASA","status":"DEMO","data_available":True},{"name":"Meteorological","status":"DEMO","data_available":True},{"name":"Synthetic history","status":"DEMO","data_available":True}]}
CLASSIFIER=CycloneClassificationModel(); TRACK_MODEL=CycloneTrackPredictionModel(); DETECTOR=CycloneDetectionModel()


def event_by_id(cyclone_id):
    return next((event for event in EVENTS if event["id"]==cyclone_id),None)


def prediction_for(event,index):
    observations=event["observations"]
    index=max(1,min(len(observations),index+1))-1
    history=[{k:obs[k] for k in ("timestamp","latitude","longitude","wind_speed","intensity_class")} for obs in observations[:index+1]]
    if index==len(observations)-1:
        return PREDICTIONS[event["id"]]
    model_history=[{**p,"intensity":p["intensity_class"]} for p in history]
    if len(model_history)==1:
        current=model_history[0]; next_obs=observations[1]
        model_history.insert(0,{"timestamp":(datetime.fromisoformat(current["timestamp"].replace("Z","+00:00"))-timedelta(hours=6)).isoformat().replace("+00:00","Z"),"latitude":current["latitude"]-(next_obs["latitude"]-current["latitude"]),"longitude":current["longitude"]-(next_obs["longitude"]-current["longitude"]),"wind_speed":current["wind_speed"],"intensity":current["intensity_class"]})
    result=TRACK_MODEL.predict(model_history,(6,12,24,48))
    forecasts=[]
    current=observations[index]
    for point in result["predicted_path"]:
        forecasts.append({**point,"central_pressure":round(current["central_pressure"]-max(0,point["wind_speed"]-current["wind_speed"])*1.3,1)})
    return {"current_position":result["current_position"],"predicted_path":forecasts}


def validate_classification(payload):
    if "wind_speed" not in payload: raise ValueError("Missing required field: wind_speed")
    try: wind=float(payload["wind_speed"]); pressure=float(payload.get("central_pressure",1000))
    except (TypeError,ValueError): raise ValueError("wind_speed and central_pressure must be numbers")
    if not 0<=wind<=300: raise ValueError("wind_speed must be between 0 and 300 km/h")
    if not 800<=pressure<=1100: raise ValueError("central_pressure must be between 800 and 1100 hPa")
    return {**payload,"wind_speed":wind,"central_pressure":pressure}


def validate_position(payload):
    missing=[field for field in ("latitude","longitude") if field not in payload]
    if missing: raise ValueError("Missing required fields: "+", ".join(missing))
    try: lat,lon=float(payload["latitude"]),float(payload["longitude"])
    except (TypeError,ValueError): raise ValueError("latitude and longitude must be numbers")
    if not -90<=lat<=90 or not -180<=lon<=180: raise ValueError("latitude or longitude is outside valid bounds")
    return lat,lon


def dashboard(cyclone_id=None):
    event=event_by_id(cyclone_id or EVENTS[0]["id"]) or EVENTS[0]
    observation=event["observations"][-1]
    return {"mode":"DEMO / SYNTHETIC DATA","cyclones":[{"id":e["id"],"name":e["name"],"basin":e["basin"],"region":e["region"],"current":e["observations"][-1]} for e in EVENTS],
            "cyclone":event,"observation":observation,"classification":CLASSIFIER.predict(observation,DATA/"cyclone_images"),
            "track":{"historical_track":TRACKS[event["id"]],**PREDICTIONS[event["id"]]},"sources":SOURCES["sources"]}


class Handler(BaseHTTPRequestHandler):
    def send_json(self,status,value):
        body=json.dumps(value,allow_nan=False).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(body))); self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","Content-Type"); self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.end_headers(); self.wfile.write(body)

    def send_file(self,path):
        body=path.read_bytes(); self.send_response(200); self.send_header("Content-Type",mimetypes.guess_type(path.name)[0] or "application/octet-stream")
        self.send_header("Content-Length",str(len(body))); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers(); self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204); self.send_header("Access-Control-Allow-Origin","*"); self.send_header("Access-Control-Allow-Headers","Content-Type")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS"); self.end_headers()

    def do_GET(self):
        parsed=urlparse(self.path); path=parsed.path; query=parse_qs(parsed.query)
        if path=="/api/health": return self.send_json(200,{"status":"ok","mode":"DEMO / SYNTHETIC DATA"})
        if path=="/api/cyclones":
            return self.send_json(200,{"cyclones":[{"id":e["id"],"name":e["name"],"basin":e["basin"],"region":e["region"],"data_label":e["data_label"],"observation_count":len(e["observations"]),"current":e["observations"][-1]} for e in EVENTS]})
        if path=="/api/dashboard": return self.send_json(200,dashboard(query.get("cyclone_id",[None])[0]))
        if path=="/api/data/sources": return self.send_json(200,SOURCES)
        if path=="/api/map/indian-ocean": return self.send_file(DATA/"maps"/"indian_ocean.geojson")
        match=re.fullmatch(r"/api/images/([A-Za-z0-9_-]+\.png)",path)
        if match:
            image=DATA/"cyclone_images"/match.group(1)
            return self.send_file(image) if image.is_file() else self.send_json(404,{"error":"Image not found"})
        match=re.fullmatch(r"/api/cyclones/([^/]+)/images",path)
        if match:
            event=event_by_id(match.group(1))
            if not event: return self.send_json(404,{"error":"Cyclone not found"})
            frames=[{**o,"image_url":"/api/images/"+Path(o["image_path"]).name,"offset_hours":i*6} for i,o in enumerate(event["observations"])]
            return self.send_json(200,{"cyclone_id":event["id"],"images":frames})
        match=re.fullmatch(r"/api/cyclones/([^/]+)/track",path)
        if match:
            event=event_by_id(match.group(1))
            return self.send_json(200,{"historical_track":TRACKS[event["id"]]}) if event else self.send_json(404,{"error":"Cyclone not found"})
        match=re.fullmatch(r"/api/cyclones/([^/]+)/prediction",path)
        if match:
            event=event_by_id(match.group(1))
            if not event: return self.send_json(404,{"error":"Cyclone not found"})
            try: index=int(query.get("index",[len(event["observations"])-1])[0])
            except ValueError: return self.send_json(400,{"error":"index must be an integer"})
            result=prediction_for(event,index)
            result["cyclone_id"]=event["id"]; result["forecast_label"]="Synthetic forecast"
            return self.send_json(200,result)
        match=re.fullmatch(r"/api/cyclones/([^/]+)",path)
        if match:
            event=event_by_id(match.group(1))
            return self.send_json(200,event) if event else self.send_json(404,{"error":"Cyclone not found"})
        match=re.fullmatch(r"/api/cyclone/([^/]+)/track",path)
        if match:
            event=event_by_id(match.group(1))
            if not event: return self.send_json(404,{"error":"Cyclone not found"})
            return self.send_json(200,{"historical_track":TRACKS[event["id"]],"predicted_track":PREDICTIONS[event["id"]]["predicted_path"]})
        return self.send_json(404,{"error":"Endpoint not found"})

    def do_POST(self):
        path=urlparse(self.path).path
        try:
            payload=json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))))
            if not isinstance(payload,dict): raise ValueError("JSON request body must be an object")
            if path in ("/api/classify","/api/cyclone/classify"):
                observation=validate_classification(payload)
                return self.send_json(200,CLASSIFIER.predict(observation,DATA/"cyclone_images"))
            if path=="/api/cyclone/predict-track":
                history=payload.get("historical_track")
                if not isinstance(history,list) or len(history)<2: raise ValueError("historical_track must contain at least two points")
                for point in history:
                    if not isinstance(point,dict) or not all(key in point for key in ("timestamp","latitude","longitude")): raise ValueError("Each point requires timestamp, latitude and longitude")
                    try:
                        point["latitude"]=float(point["latitude"]);point["longitude"]=float(point["longitude"])
                        datetime.fromisoformat(point["timestamp"].replace("Z","+00:00"))
                    except (ValueError,TypeError,AttributeError): raise ValueError("Track points must contain valid coordinates and ISO timestamps")
                    if not -90<=point["latitude"]<=90 or not -180<=point["longitude"]<=180: raise ValueError("Track coordinates are outside valid bounds")
                prediction=TRACK_MODEL.predict(history,(6,12,24,48))
                return self.send_json(200,{**prediction,"historical_track":history,"predicted_track":prediction["predicted_path"]})
            if path=="/api/cyclone/detect":
                observation=validate_classification(payload)
                lat,lon=validate_position(payload)
                result=DETECTOR.predict({"latitude":lat,"longitude":lon,"wind_speed":observation["wind_speed"],"pressure":observation["central_pressure"],"timestamp":payload.get("timestamp",datetime.now(timezone.utc).isoformat().replace("+00:00","Z"))})
                result["classification"]=CLASSIFIER.predict({**observation,"image_path":payload.get("image_path")},DATA/"cyclone_images")
                event=event_by_id(payload.get("cyclone_id",EVENTS[0]["id"]))
                if event:
                    result["track"]={"historical_track":TRACKS[event["id"]],"predicted_track":PREDICTIONS[event["id"]]["predicted_path"]}
                result["data_mode"]="DEMO / SYNTHETIC DATA"
                return self.send_json(200,result)
            return self.send_json(404,{"error":"Endpoint not found"})
        except (ValueError,json.JSONDecodeError,TypeError) as error:
            return self.send_json(400,{"error":str(error)})

    def log_message(self,fmt,*args): print("%s - %s"%(self.address_string(),fmt%args))


if __name__=="__main__":
    print("Cyclone offline demo API listening on http://127.0.0.1:8000")
    ThreadingHTTPServer(("127.0.0.1",8000),Handler).serve_forever()
