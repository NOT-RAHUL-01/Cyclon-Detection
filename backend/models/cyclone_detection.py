import math


class CycloneDetectionModel:
    """Synthetic rule using wind and pressure, with bounded confidence."""

    def predict(self, payload):
        detected = payload["wind_speed"] >= 34 and payload["pressure"] <= 1005
        confidence = min(.97, .55 + max(0, payload["wind_speed"] - 30) / 300 + max(0, 1015 - payload["pressure"]) / 200)
        return {"cyclone_detected": detected, "confidence": round(confidence if detected else 1 - confidence, 2),
                "center": {"latitude": round(payload["latitude"] + .08 * math.sin(payload["longitude"]), 3),
                           "longitude": round(payload["longitude"] + .08 * math.cos(payload["latitude"]), 3)},
                "wind_speed": payload["wind_speed"], "pressure": payload["pressure"], "timestamp": payload["timestamp"]}
