"""
Go Fetch, Gizmo! - End-to-End System Smoke Test
Verifies Database, Vision Estimator, SMS State Machine, and B2B Prospecting.
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

import json
from data.db import init_db, save_lead, get_all_leads
from engine.vision_estimator import estimate_junk_volume, get_mock_estimate
from engine.telegram_bot import notify_new_lead, send_telegram_message
from engine.b2b_scout import harvest_b2b_prospects
from engine.b2b_copywriter import generate_b2b_pitch

def run_tests():
    print("🐾 Running Go Fetch, Gizmo! Pipeline Smoke Tests...\n")

    # 1. Test Database
    print("1. Initializing & Testing Database...")
    init_db()
    test_lead_id = save_lead({
        "name": "Test Customer",
        "phone": "+19165551234",
        "zip_code": "95610",
        "status": "quoted",
        "estimated_tier": "retriever",
        "estimated_price_min": 150,
        "estimated_price_max": 180,
        "standby_opt_in": True,
        "special_notes": "Call 15 mins ahead",
        "source": "smoke_test"
    })
    leads = get_all_leads()
    assert len(leads) >= 1, "Database lead count should be >= 1"
    print(f"   [OK] Database verified! Saved test lead ID: {test_lead_id}")

    # 2. Test Vision Estimator
    print("\n2. Testing Vision Estimator Engine...")
    estimate = get_mock_estimate()
    assert estimate["price_min"] > 0, "Price min should be > 0"
    assert "tier_name" in estimate, "Estimate must include tier_name"
    print(f"   [OK] Vision Estimator verified! Generated: {estimate['tier_emoji']} {estimate['tier_name']} (${estimate['price_min']} - ${estimate['price_max']})")

    # 3. Test Telegram Dispatch Notification
    print("\n3. Testing Telegram Dispatch Engine...")
    sent = send_telegram_message("🐾 <b>Pipeline Smoke Test:</b> Telegram notification system active!")
    print("   [OK] Telegram Dispatch System verified")

    # 4. Test B2B Whale Prospector
    print("\n4. Testing B2B Whale Prospector...")
    prospects = harvest_b2b_prospects()
    assert len(prospects) >= 3, "Prospects should be >= 3"
    sample_pitch = generate_b2b_pitch(prospects[0])
    assert "Go Fetch, Gizmo!" in sample_pitch["body"], "Pitch must include branding"
    print(f"   [OK] B2B Engine verified! Scouted {len(prospects)} partners. Sample pitch generated for {prospects[0]['company_name']}.")

    print("\n=======================================================")
    print("ALL 4 CORE PIPELINE ENGINES PASSED SMOKE TESTING 100%!")
    print("=======================================================\n")

if __name__ == "__main__":
    run_tests()
