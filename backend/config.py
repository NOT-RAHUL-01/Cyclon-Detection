"""Prototype cyclone thresholds. Replace with validated model configuration in production."""

INTENSITY_THRESHOLDS = [
    (30, "Depression"),
    (50, "Deep Depression"),
    (62, "Tropical Storm"),
    (88, "Cyclonic Storm"),
    (117, "Severe Cyclonic Storm"),
    (float("inf"), "Very Severe Cyclonic Storm"),
]
