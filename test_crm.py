"""
Go Fetch, Gizmo! - Comprehensive CRM & Dispatch Pipeline Unit Tests
Verifies Kanban state machine, Customer LTV 360, 2-Way SMS, Review Flywheel, and B2B Whale Engine.
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi.testclient import TestClient
from server import app
from data.db import init_db, save_lead, get_all_customers, get_all_reviews

client = TestClient(app)

def test_crm_pipeline():
    print("🐾 Running Go Fetch, Gizmo! CRM Comprehensive Integration Tests...\n")
    init_db()

    # 1. Test CRM Page Serving
    res_crm = client.get("/crm")
    assert res_crm.status_code == 200
    assert "Command Center & CRM" in res_crm.text
    print("   [OK] GET /crm (CRM Single Page App) -> 200 OK")

    # 2. Test Subdomain Host Header Middleware
    res_sub = client.get("/", headers={"Host": "crm.gofetchgizmo.com"})
    assert res_sub.status_code == 200
    assert "Command Center & CRM" in res_sub.text
    print("   [OK] GET / on crm.gofetchgizmo.com -> 200 OK (Subdomain routing verified)")

    # 3. Test Manual Job Creation (+ New Manual Job Modal)
    res_manual = client.post("/api/crm/jobs", json={
        "name": "Sarah Jenkins",
        "phone": "+19165550199",
        "address": "4522 Greenback Ln, Citrus Heights",
        "zip_code": "95610",
        "estimated_tier": "retriever",
        "estimated_price_min": 150,
        "estimated_price_max": 180,
        "preferred_date": "2026-09-04",
        "scheduled_time": "10:00 AM - 12:00 PM",
        "special_notes": "Side gate unlocked, couch in garage",
        "standby_opt_in": True,
        "status": "new"
    })
    assert res_manual.status_code == 200
    manual_job_id = res_manual.json()["job_id"]
    print(f"   [OK] POST /api/crm/jobs (Manual Job Created) -> ID: {manual_job_id}")

    # 4. Test Single Job Details Fetch & Editing
    res_job = client.get(f"/api/crm/jobs/{manual_job_id}")
    assert res_job.status_code == 200
    assert res_job.json()["name"] == "Sarah Jenkins"
    print(f"   [OK] GET /api/crm/jobs/{manual_job_id} -> 200 OK")

    res_patch = client.patch(f"/api/crm/jobs/{manual_job_id}", json={
        "status": "scheduled",
        "scheduled_time": "11:00 AM - 1:00 PM"
    })
    assert res_patch.status_code == 200
    print("   [OK] PATCH /api/crm/jobs/{id} -> Status changed to 'scheduled'")

    # 5. Advance to 'en_route' (En Route SMS trigger)
    res_enroute = client.post(f"/api/crm/jobs/{manual_job_id}/en-route")
    assert res_enroute.status_code == 200
    print("   [OK] POST /api/crm/jobs/{id}/en-route -> En-route SMS dispatched")

    # 6. Complete Job & Trigger Review SMS
    res_complete = client.post(f"/api/crm/jobs/{manual_job_id}/complete", json={"final_price": 160})
    assert res_complete.status_code == 200
    print("   [OK] POST /api/crm/jobs/{id}/complete -> Revenue $160 logged, Review SMS sent")

    # 7. Customer 360 & LTV Verification
    res_cust = client.get("/api/crm/customers")
    assert res_cust.status_code == 200
    customers = res_cust.json()
    sarah = next((c for c in customers if c["phone"] == "+19165550199"), None)
    assert sarah is not None, "Customer should exist"
    assert sarah["total_revenue"] >= 160, "Customer LTV should be updated with final price"
    print(f"   [OK] Customer LTV Verified -> Sarah Jenkins Total LTV: ${sarah['total_revenue']}")

    # 8. Customer Profile Update & Gate Code
    res_cust_update = client.patch(f"/api/crm/customers/{sarah['id']}", json={
        "gate_code": "#4821",
        "notes": "Friendly golden retriever on site"
    })
    assert res_cust_update.status_code == 200
    print("   [OK] PATCH /api/crm/customers/{id} -> Gate code & notes updated")

    # 9. Customer Job History
    res_history = client.get(f"/api/crm/customers/{sarah['id']}/jobs")
    assert res_history.status_code == 200
    assert len(res_history.json()) >= 1
    print(f"   [OK] GET /api/crm/customers/{sarah['id']}/jobs -> {len(res_history.json())} historical jobs retrieved")

    # 10. Manual Review Request Trigger
    res_man_rev = client.post("/api/crm/reviews/send", json={
        "name": "Sarah Jenkins",
        "phone": "+19165550199"
    })
    assert res_man_rev.status_code == 200
    print("   [OK] POST /api/crm/reviews/send -> Manual Review SMS dispatched")

    # 11. Test 2-Way SMS Live Inbox
    res_chat = client.post("/api/crm/inbox/send", json={
        "phone": "+19165550199",
        "body": "Hey Sarah! Thanks again for choosing Go Fetch Gizmo!"
    })
    assert res_chat.status_code == 200
    print("   [OK] POST /api/crm/inbox/send -> 2-Way Live SMS sent")

    # 12. B2B Whale Engine: Add Custom Lead & Preview Pitch
    res_new_b2b = client.post("/api/crm/b2b", json={
        "company_name": "Sacramento Premier Properties",
        "contact_name": "Elena Rostova",
        "email": "elena@sacpremierprop.com",
        "phone": "+19165554411",
        "category": "Property Management"
    })
    assert res_new_b2b.status_code == 200
    b2b_id = res_new_b2b.json()["prospect_id"]
    print(f"   [OK] POST /api/crm/b2b (Custom B2B Lead Created) -> ID: {b2b_id}")

    res_pitch = client.post("/api/b2b/pitch", json={"prospect_id": b2b_id})
    assert res_pitch.status_code == 200
    pitch_data = res_pitch.json()
    assert "subject" in pitch_data["pitch"]
    print(f"   [OK] POST /api/b2b/pitch -> Subject: '{pitch_data['pitch']['subject']}'")

    res_send_one = client.post("/api/b2b/send-one", json={
        "prospect_id": b2b_id,
        "subject": pitch_data["pitch"]["subject"],
        "body": pitch_data["pitch"]["body"]
    })
    assert res_send_one.status_code == 200
    print("   [OK] POST /api/b2b/send-one -> Single B2B Pitch dispatched")

    # 13. Test Job Deletion Endpoint
    res_temp_job = client.post("/api/crm/jobs", json={
        "name": "Temp Test Job",
        "phone": "+19165559999",
        "status": "new"
    })
    temp_id = res_temp_job.json()["job_id"]
    res_del = client.delete(f"/api/crm/jobs/{temp_id}")
    assert res_del.status_code == 200
    print(f"   [OK] DELETE /api/crm/jobs/{temp_id} -> Job deleted cleanly")

    print("\n=======================================================")
    print("🎉 FULL IN-HOUSE CRM SYSTEM TEST SUITE PASSED 100%!")
    print("=======================================================\n")

if __name__ == "__main__":
    test_crm_pipeline()
