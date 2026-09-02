"""
Go Fetch, Gizmo! - Automated 5-Star Google Review Harvester & Reputation Engine
Dispatches review links post-job completion with the Gizmo treat hook.
"""
from typing import Dict, Any, Optional
from engine.sms_handler import send_outbound_sms
from data.db import log_review_request, get_all_reviews

# Direct Google Review link (place ID or shortlink for Go Fetch, Gizmo!)
GOOGLE_REVIEW_URL = "https://g.page/r/gofetchgizmo/review"

def send_review_request(job_data: Dict[str, Any]) -> bool:
    """
    Fires the post-completion review request SMS to the customer.
    """
    phone = job_data.get("phone")
    name = job_data.get("name", "Neighbor").split()[0] # first name
    job_id = job_data.get("id")
    customer_id = job_data.get("customer_id")

    if not phone:
        return False

    review_sms = (
        f"Hey {name}! Brandon here from Go Fetch, Gizmo! 🐾\n\n"
        f"Hope you're loving all that cleared-out space! If you have 15 seconds, "
        f"could you drop Gizmo a quick 5-star Google review? ⭐⭐⭐⭐⭐\n\n"
        f"{GOOGLE_REVIEW_URL}\n\n"
        f"(Gizmo gets an extra bacon treat for every 5-star review! 🐶🥓) Thanks again!"
    )

    # 1. Send SMS
    success = send_outbound_sms(to_phone=phone, body=review_sms)

    # 2. Log review request in DB
    log_review_request(
        lead_id=job_id,
        customer_id=customer_id,
        customer_name=name,
        phone=phone
    )

    return success

if __name__ == "__main__":
    sample_job = {
        "id": 1,
        "customer_id": 1,
        "name": "Sarah Miller",
        "phone": "+19165550192"
    }
    print("Testing Review Request Dispatch...")
    send_review_request(sample_job)
