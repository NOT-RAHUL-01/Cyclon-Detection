import json
import csv
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from backend.app import Handler
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls): cls.server.shutdown(); cls.server.server_close()

    def call(self, path, body=None):
        request = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None,
                          headers={"Content-Type":"application/json"})
        try:
            with urlopen(request) as response: return response.status, json.load(response)
        except HTTPError as error: return error.code, json.load(error)

    def test_health(self): self.assertEqual(self.call("/api/health")[0], 200)
    def test_classification(self): self.assertEqual(self.call("/api/cyclone/classify", {"wind_speed":128})[1]["classification"], "Very Severe Cyclonic Storm")
    def test_classify_uses_generated_image(self):
        filename="cyclone_003_t24.png"
        code,result=self.call("/api/classify",{"wind_speed":150,"central_pressure":950,"image_path":f"data/cyclone_images/{filename}"})
        self.assertEqual(code,200);self.assertEqual(result["class"],"Very Severe Cyclonic Storm");self.assertIsNotNone(result["cloud_coverage"])
    def test_detection(self): self.assertTrue(self.call("/api/cyclone/detect", {"latitude":15,"longitude":71,"wind_speed":128,"pressure":972})[1]["cyclone_detected"])
    def test_track_prediction(self): self.assertEqual(len(self.call("/api/cyclone/predict-track", {"historical_track":[{"timestamp":"2026-09-29T00:00:00Z","latitude":14,"longitude":70},{"timestamp":"2026-09-29T06:00:00Z","latitude":15,"longitude":71}]})[1]["predicted_track"]),4)
    def test_malformed_track_is_rejected(self):
        code, body = self.call("/api/cyclone/predict-track", {"historical_track":[{"timestamp":"bad","latitude":999,"longitude":70},{"timestamp":"bad","latitude":15,"longitude":71}]})
        self.assertEqual(code, 400); self.assertIn("error", body)
    def test_invalid_and_missing_input(self):
        self.assertEqual(self.call("/api/cyclone/detect", {"latitude":200,"longitude":71,"wind_speed":128,"pressure":972})[0], 400)
        self.assertEqual(self.call("/api/cyclone/detect", {"latitude":15})[0], 400)
    def test_dashboard_and_cyclones(self):
        self.assertGreaterEqual(len(self.call("/api/cyclones")[1]["cyclones"]), 5)
        self.assertIn("track", self.call("/api/dashboard")[1])
    def test_detail_images_tracks_prediction_and_basemap(self):
        base="/api/cyclones/CYCLONE-003"
        self.assertEqual(self.call(base)[0],200)
        frames=self.call(base+"/images")[1]["images"];self.assertEqual(len(frames),8)
        with urlopen(self.base+"/api/images/cyclone_003_t24.png") as response:
            self.assertEqual(response.status,200);self.assertEqual(response.headers.get_content_type(),"image/png");self.assertTrue(response.read(8).startswith(b"\x89PNG"))
        with Image.open(ROOT/"data"/"cyclone_images"/"cyclone_003_t24.png") as png:self.assertEqual(png.format,"PNG")
        self.assertEqual(len(self.call(base+"/track")[1]["historical_track"]),8)
        forecast=self.call(base+"/prediction?index=0")[1]["predicted_path"]
        self.assertEqual([p["hours"] for p in forecast],[6,12,24,48])
        prediction=self.call(base+"/prediction?index=0")[1]
        self.assertEqual(prediction["impact"]["region"],"Andhra Pradesh coast")
        self.assertIn(prediction["impact"]["alert_level"],["ELEVATED","WATCH","WARNING"])
        self.assertIn("features",self.call("/api/map/indian-ocean")[1])
    def test_generated_dataset_rows_and_images(self):
        with (ROOT/"data"/"cyclone_dataset.csv").open(encoding="utf-8",newline="") as f:rows=list(csv.DictReader(f))
        self.assertEqual(len(rows),40)
        for row in rows:
            image=ROOT/row["image_path"]
            self.assertTrue(image.is_file(),row["image_path"])
            with Image.open(image) as png:self.assertEqual(png.format,"PNG")


if __name__ == "__main__": unittest.main()
