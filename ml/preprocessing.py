"""Input preparation helpers shared by the demo model implementations."""

FEATURE_FIELDS = ("wind_speed", "central_pressure", "temperature", "humidity",
                  "sea_surface_temperature", "cloud_top_temperature", "rainfall",
                  "movement_speed")


def numeric_features(observation):
    """Return a stable numeric feature vector; missing optional values use safe defaults."""
    defaults = {"central_pressure": 1000.0, "temperature": 27.0, "humidity": 75.0, "sea_surface_temperature": 29.0,
                "cloud_top_temperature": -55.0, "rainfall": 15.0, "movement_speed": 16.0}
    values = {}
    for field in FEATURE_FIELDS:
        raw = observation.get(field, defaults.get(field))
        values[field] = float(raw)
    return values
