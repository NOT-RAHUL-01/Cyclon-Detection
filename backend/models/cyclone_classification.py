"""Compatibility adapter around the ML-ready synthetic classification module."""
from ml.classification_model import CycloneClassificationModel as Baseline


class CycloneClassificationModel:
    def __init__(self): self.model = Baseline()

    def predict(self, observation, data_root=None):
        if isinstance(observation, (int, float)):
            observation = {"wind_speed":observation}
        result = self.model.predict(observation, data_root)
        return {**result, "classification":result["class"]}
