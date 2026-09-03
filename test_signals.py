"""
Unit and Integration Test for Classified Signals Sniper
"""
import sys
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from engine.classifieds_copy import generate_pitch, extract_item_from_title
from data.db import (
    init_db,
    save_classified_signal,
    get_classified_signals,
    update_classified_signal_status,
    signal_exists
)
from server import app

class TestClassifiedSignals(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)

    def test_extract_item_and_pitch(self):
        title = "CURB ALERT - Free Leather Sectional Couch (Fair Oaks)"
        item = extract_item_from_title(title)
        self.assertIn("Sectional Couch", item)

        pitch_curb = generate_pitch("curb_alert", title, "Fair Oaks")
        self.assertIn("Sectional Couch", pitch_curb)
        self.assertIn("$60–$80", pitch_curb)
        self.assertIn("Brandon", pitch_curb)

        pitch_landlord = generate_pitch("landlord_vacancy", "3 Bed 2 Bath Rental", "Citrus Heights")
        self.assertIn("tenant", pitch_landlord)
        self.assertIn("Citrus Heights", pitch_landlord)

        pitch_gig = generate_pitch("hauling_gig", "Need junk hauled from driveway", "Sacramento")
        self.assertIn("truck ready", pitch_gig)

    def test_db_signal_persistence(self):
        pid = "test_cl_unique_9999"
        sig_data = {
            "cl_post_id": pid,
            "category": "curb_alert",
            "title": "Free Washer & Dryer on Curb",
            "url": "https://sacramento.craigslist.org/zip/9999",
            "location": "Citrus Heights",
            "snippet": "Working dryer, broken washer on street.",
            "suggested_pitch": "Hey! Can haul today.",
            "status": "new"
        }
        sig_id = save_classified_signal(sig_data)
        self.assertTrue(sig_id > 0)
        self.assertTrue(signal_exists(pid))

        signals = get_classified_signals(category="curb_alert")
        matched = [s for s in signals if s.get("cl_post_id") == pid]
        self.assertTrue(len(matched) > 0)

        update_classified_signal_status(sig_id, "contacted")
        contacted = get_classified_signals(status="contacted")
        self.assertTrue(any(s.get("cl_post_id") == pid for s in contacted))

    def test_api_endpoints(self):
        # 1. GET /api/crm/signals
        res = self.client.get("/api/crm/signals")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIsInstance(data, list)

        # 2. PATCH /api/crm/signals/{id}
        if data:
            target_id = data[0]["id"]
            patch_res = self.client.patch(f"/api/crm/signals/{target_id}", json={"status": "converted"})
            self.assertEqual(patch_res.status_code, 200)
            self.assertEqual(patch_res.json()["new_status"], "converted")

if __name__ == "__main__":
    unittest.main()
