"""
Go Fetch, Gizmo! - Automated 5-Star Google Review Harvester & Reputation Engine
Dispatches review links post-job completion with the Gizmo treat hook.
"""
import os
from typing import Dict, Any, Optional
from engine.sms_handler import send_outbound_sms
from data.db import log_review_request, get_all_reviews

# Direct Google Review link (place ID or shortlink for Go Fetch, Gizmo!)
GOOGLE_REVIEW_URL = os.getenv("GOOGLE_REVIEW_URL", "https://share.google/COJZkVik8pvPZPqWj")

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

def send_review_email(job_data: Dict[str, Any]) -> bool:
    """
    Fires the post-completion review request email from gofetchgizmo@gmail.com.
    """
    email = job_data.get("email")
    name = job_data.get("name", "Neighbor").split()[0]
    job_id = job_data.get("id")
    customer_id = job_data.get("customer_id")
    phone = job_data.get("phone", "")

    if not email:
        return False

    subject = f"🐾 Quick favor from Brandon & Gizmo!"
    review_body = (
        f"Hey {name}!\n\n"
        f"Brandon here from Go Fetch, Gizmo! 🐾 Hope you're loving all that cleared-out space!\n\n"
        f"If you have 15 seconds, could you drop Gizmo a quick 5-star Google review?\n"
        f"⭐⭐⭐⭐⭐ {GOOGLE_REVIEW_URL}\n\n"
        f"(Gizmo gets an extra bacon treat for every 5-star review! 🐶🥓)\n\n"
        f"Thank you so much for supporting our local business,\n"
        f"Brandon & Gizmo\n"
        f"Go Fetch, Gizmo! Hauling & Cleanouts\n"
        f"(916) 546-8537 | gofetchgizmo@gmail.com"
    )

    try:
        from engine.b2b_dispatcher import send_b2b_email
        send_b2b_email(to_email=email, subject=subject, body=review_body)
    except Exception as e:
        print(f"[Review Email Error] {e}")

    log_review_request(
        lead_id=job_id,
        customer_id=customer_id,
        customer_name=name,
        phone=phone or email
    )

    return True

if __name__ == "__main__":
    sample_job = {
        "id": 1,
        "customer_id": 1,
        "name": "Sarah Miller",
        "phone": "+19165550192"
    }
    print("Testing Review Request Dispatch...")
    send_review_request(sample_job)
