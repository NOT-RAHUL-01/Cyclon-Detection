"""Train a small, deterministic classifier from the generated synthetic dataset."""
import csv
import json
from pathlib import Path

import numpy as np

from ml.preprocessing import FEATURE_FIELDS, numeric_features

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
MODEL_PATH = ROOT / "ml" / "artifacts" / "cyclone_classifier.json"


def train():
    with (DATA / "cyclone_dataset.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) < 2:
        raise ValueError("At least two synthetic observations are required for training")

    labels = sorted({row["intensity_class"] for row in rows})
    matrix = np.asarray([[numeric_features(row)[field] for field in FEATURE_FIELDS] for row in rows], dtype=float)
    mean = matrix.mean(axis=0)
    scale = matrix.std(axis=0)
    scale[scale < 1e-8] = 1.0
    normalized = (matrix - mean) / scale
    centroids = {label: normalized[np.asarray([r["intensity_class"] == label for r in rows])].mean(axis=0).tolist() for label in labels}
    artifact = {
        "model_type": "standardized-nearest-centroid",
        "training_data": "synthetic cyclone_dataset.csv",
        "sample_count": len(rows),
        "features": list(FEATURE_FIELDS),
        "labels": labels,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "centroids": centroids,
    }
    events = json.loads((DATA / "cyclone_events.json").read_text(encoding="utf-8"))
    motion_rows = []
    for event in events:
        track = event["observations"]
        for i in range(1, len(track) - 1):
            a, b, future = track[i - 1], track[i], track[i + 1]
            elapsed = 6.0
            vlat = (b["latitude"] - a["latitude"]) / elapsed
            vlon = (b["longitude"] - a["longitude"]) / elapsed
            motion_rows.append(([1.0, vlat, vlon], [(future["latitude"] - b["latitude"]) / elapsed, (future["longitude"] - b["longitude"]) / elapsed]))
    x = np.asarray([row[0] for row in motion_rows])
    y = np.asarray([row[1] for row in motion_rows])
    artifact["motion_model"] = {"feature_order": ["bias", "latitude_degrees_per_hour", "longitude_degrees_per_hour"],
                                "velocity_coefficients": np.linalg.lstsq(x, y, rcond=None)[0].tolist(),
                                "sample_count": len(motion_rows)}
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    return artifact


def main():
    artifact = train()
    print(f"Trained intensity classifier on {artifact['sample_count']} synthetic observations")
    print(f"Fitted track-motion model on {artifact['motion_model']['sample_count']} synthetic transitions")
    print(f"Classes: {', '.join(artifact['labels'])}")
    print(f"Saved model: {MODEL_PATH}")
    print("Synthetic demonstration model; this is not validated for operational forecasting.")


if __name__ == "__main__":
    main()
