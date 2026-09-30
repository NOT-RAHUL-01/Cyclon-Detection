"""Compatibility adapter around the ML-ready synthetic trajectory model."""
from ml.path_prediction import CycloneTrackPredictionModel as Baseline


class CycloneTrackPredictionModel:
    def __init__(self): self.model=Baseline()

    def predict(self, history, hours=24):
        steps=tuple(range(6,hours+1,6))
        result=self.model.predict(history,steps)
        return {"historical_track":history,"predicted_track":result["predicted_path"],**result}
