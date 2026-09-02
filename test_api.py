"""
API Endpoint Unit Tests for Go Fetch, Gizmo! FastAPI Server
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def test_api():
    print("Testing FastAPI Endpoints...")

    # 1. Test Index HTML
    res_index = client.get("/")
    assert res_index.status_code == 200
    assert "Snap & <span>Quote</span>" in res_index.text
    print("   [OK] GET / (Landing Page with AI Widget) -> 200 OK")

    # 1b. Test Photo Estimate API
    import io, base64
    valid_gif_bytes = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
    dummy_image = io.BytesIO(valid_gif_bytes)
    res_est = client.post(
        "/api/estimate",
        files=[("images", ("test_couch.gif", dummy_image, "image/gif"))]
    )
    assert res_est.status_code == 200
    est_data = res_est.json()
    assert "price_min" in est_data
    assert "tier_name" in est_data
    print(f"   [OK] POST /api/estimate -> 200 OK ({est_data.get('tier_name')})")

    # 2. Test Booking API
    res_book = client.post("/api/book", json={
        "name": "David Martinez",
        "phone": "+19165559876",
        "zip_code": "95628",
        "preferred_date": "2026-09-02",
        "standby_opt_in": True,
        "estimated_tier": "great_dane",
        "estimated_price_min": 195,
        "estimated_price_max": 230,
        "summary": "Full garage clearout of old furniture and boxes",
        "special_notes": "Ground floor driveway pickup"
    })
    assert res_book.status_code == 200
    book_data = res_book.json()
    assert book_data["status"] == "success"
    print(f"   [OK] POST /api/book -> 200 OK (Lead ID: {book_data['lead_id']})")

    # 3. Test Leads List API
    res_leads = client.get("/api/leads")
    assert res_leads.status_code == 200
    leads = res_leads.json()
    assert len(leads) >= 1
    print(f"   [OK] GET /api/leads -> 200 OK ({len(leads)} leads retrieved)")

    # 4. Test Twilio Inbound SMS Webhook
    res_sms = client.post(
        "/api/sms/inbound",
        data={"From": "+19165559876", "Body": "How much for a mattress in Fair Oaks?", "NumMedia": "0"},
        headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    assert res_sms.status_code == 200
    assert "<Response>" in res_sms.text
    print("   [OK] POST /api/sms/inbound (Twilio TwiML) -> 200 OK")

    # 5. Test TextBee Inbound JSON Webhook
    res_textbee = client.post(
        "/api/sms/textbee/inbound",
        json={
            "sender": "+19165559876",
            "message": "Yes I want to book tomorrow morning",
            "device_id": "test_device_123"
        }
    )
    assert res_textbee.status_code == 200
    assert res_textbee.json()["status"] == "success"
    print("   [OK] POST /api/sms/textbee/inbound (TextBee JSON) -> 200 OK")

    print("\nAPI Integration Tests Passed 100%!")

if __name__ == "__main__":
    test_api()
