"""Smooth synthetic trajectory extrapolator. Replace with a trained sequence model later."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path


class CycloneTrackPredictionModel:
    def __init__(self, model_path=None):
        path = Path(model_path) if model_path else Path(__file__).resolve().parent / "artifacts" / "cyclone_classifier.json"
        try:
            self.motion_model = json.loads(path.read_text(encoding="utf-8")).get("motion_model")
        except (OSError, ValueError):
            self.motion_model = None

    def predict(self, history, hours=(6, 12, 24, 48)):
        if len(history) < 2:
            raise ValueError("At least two observations are required for path prediction")
        recent = history[-4:]
        points = []
        for a, b in zip(recent, recent[1:]):
            ta=datetime.fromisoformat(a["timestamp"].replace("Z","+00:00")); tb=datetime.fromisoformat(b["timestamp"].replace("Z","+00:00"))
            elapsed=max(1,(tb-ta).total_seconds()/3600)
            points.append(((b["latitude"]-a["latitude"])/elapsed,(b["longitude"]-a["longitude"])/elapsed))
        # Smooth the recent motion to reduce small synthetic observation jitter.
        vlat=sum(p[0] for p in points)/len(points); vlon=sum(p[1] for p in points)/len(points)
        if self.motion_model:
            vector = [1.0, vlat, vlon]
            coefficients = self.motion_model["velocity_coefficients"]
            vlat = sum(vector[i] * coefficients[i][0] for i in range(len(vector)))
            vlon = sum(vector[i] * coefficients[i][1] for i in range(len(vector)))
        current=history[-1]; base=datetime.fromisoformat(current["timestamp"].replace("Z","+00:00"))
        result=[]
        for hour in hours:
            curve=0.000012*hour*hour
            lat=current["latitude"]+vlat*hour+curve
            lon=current["longitude"]+vlon*hour-curve*.5
            wind=float(current.get("wind_speed",80))+min(hour,24)*.12-max(0,hour-24)*.22
            confidence=round(max(.52,.94-hour*.0068),2)
            result.append({"hours":hour,"timestamp":(base+timedelta(hours=hour)).astimezone(timezone.utc).isoformat().replace("+00:00","Z"),"latitude":round(lat,3),"longitude":round(lon,3),"wind_speed":round(wind,1),"intensity_class":current.get("intensity", "Cyclonic Storm"),"confidence":confidence})
        return {"current_position":{"latitude":current["latitude"],"longitude":current["longitude"]},"predicted_path":result}
