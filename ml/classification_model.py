"""Synthetic baseline classifier. Replace this class with a trained CNN/ViT adapter."""
import numpy as np
from PIL import Image
from pathlib import Path
import json

from ml.preprocessing import numeric_features

CLASSES = ((30, "Depression"), (50, "Deep Depression"), (62, "Tropical Storm"),
           (88, "Cyclonic Storm"), (117, "Severe Cyclonic Storm"),
           (float("inf"), "Very Severe Cyclonic Storm"))


class CycloneClassificationModel:
    def __init__(self, model_path=None):
        self.model_path = Path(model_path) if model_path else Path(__file__).resolve().parent / "artifacts" / "cyclone_classifier.json"
        try:
            self.artifact = json.loads(self.model_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.artifact = None

    def predict(self, observation, data_root=None):
        features = numeric_features(observation)
        wind = features["wind_speed"]
        if self.artifact:
            vector = np.asarray([features[field] for field in self.artifact["features"]], dtype=float)
            normalized = (vector - np.asarray(self.artifact["mean"])) / np.asarray(self.artifact["scale"])
            distances = {label: float(np.linalg.norm(normalized - centroid)) for label, centroid in self.artifact["centroids"].items()}
            label = min(distances, key=distances.get)
            ordered = sorted(distances.values())
            confidence = round(max(.50, min(.96, .58 + (ordered[1] - ordered[0]) / (ordered[1] + 1e-6) * .35)), 2) if len(ordered) > 1 else .75
        else:
            label = next(name for threshold, name in CLASSES if wind <= threshold)
            confidence = .72
        cloud_coverage = None
        image_path = observation.get("image_path") or observation.get("satellite_image")
        if image_path and data_root:
            candidate = (Path(data_root) / Path(image_path).name).resolve()
            if candidate.is_file():
                with Image.open(candidate) as image:
                    pixels=np.asarray(image.convert("RGB").resize((96,96)))
                    cloud_coverage=round(float((pixels.sum(axis=2)>230).mean()),3)
        # Demo confidence is a deterministic heuristic, not a calibrated probability.
        return {"class":label,"confidence":confidence,"confidence_label":"Demo confidence",
                "wind_speed":wind,"central_pressure":features["central_pressure"],
                "pattern_detected":bool(cloud_coverage is None or cloud_coverage > .015),
                "cloud_coverage":cloud_coverage,"model":"Synthetic trained nearest-centroid classifier" if self.artifact else "Synthetic rule-based fallback"}
