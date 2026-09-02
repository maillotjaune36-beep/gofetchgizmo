"""
Go Fetch, Gizmo! - 24/7 SMS & MMS AI Auto-Quoter & Dispatch Gateway
Supports TextBee (Android Phone SMS Gateway) and Twilio with Speed-to-Lead AI Quoting.
"""
import requests
import os
import json
from typing import Dict, Any, Optional, Tuple
from twilio.twiml.messaging_response import MessagingResponse
from twilio.rest import Client
from config import (
    SMS_GATEWAY,
    TEXTBEE_API_KEY,
    TEXTBEE_DEVICE_ID,
    TEXTBEE_BASE_URL,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER,
    BUSINESS_PHONE
)
from engine.vision_estimator import estimate_junk_volume
from engine.telegram_bot import notify_new_lead
from data.db import (
    save_lead,
    get_lead_by_phone,
    update_lead_status,
    log_sms
)

def send_textbee_sms(to_phone: str, body: str) -> bool:
    """Send SMS via TextBee Android Gateway API"""
    api_key = TEXTBEE_API_KEY or os.getenv("TEXTBEE_API_KEY")
    device_id = TEXTBEE_DEVICE_ID or os.getenv("TEXTBEE_DEVICE_ID")
    base_url = TEXTBEE_BASE_URL or os.getenv("TEXTBEE_BASE_URL", "https://api.textbee.dev/api/v1")

    if not api_key or not device_id:
        return False

    url = f"{base_url.rstrip('/')}/gateway/devices/{device_id}/send-sms"
    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json"
    }
    payload = {
        "recipients": [to_phone],
        "message": body
    }

    try:
        r = requests.post(url, headers=headers, json=payload, timeout=12)
        if r.status_code in (200, 201):
            return True
        print(f"[TextBee Gateway Response {r.status_code}]: {r.text}")
        return False
    except Exception as e:
        print(f"[TextBee Gateway Error]: {e}")
        return False

def get_twilio_client() -> Optional[Client]:
    sid = TWILIO_ACCOUNT_SID or os.getenv("TWILIO_ACCOUNT_SID")
    token = TWILIO_AUTH_TOKEN or os.getenv("TWILIO_AUTH_TOKEN")
    if sid and token:
        try:
            return Client(sid, token)
        except Exception:
            return None
    return None

def send_outbound_sms(to_phone: str, body: str) -> bool:
    """Send SMS via configured Gateway (TextBee or Twilio)"""
    # 1. Log outbound SMS to database for 2-Way CRM history
    log_sms(phone=to_phone, direction="outbound", body=body)

    gateway = (SMS_GATEWAY or os.getenv("SMS_GATEWAY", "textbee")).lower()

    # Path A: TextBee Gateway (Using your Android Phone SIM)
    if gateway == "textbee" or (TEXTBEE_API_KEY and not TWILIO_ACCOUNT_SID):
        sent = send_textbee_sms(to_phone, body)
        if sent:
            return True
        elif not TEXTBEE_API_KEY or not TEXTBEE_DEVICE_ID:
            print(f"[TextBee SMS Outbound (Simulated) to {to_phone}]: {body}")
            return True

    # Path B: Twilio Gateway
    client = get_twilio_client()
    from_phone = TWILIO_PHONE_NUMBER or os.getenv("TWILIO_PHONE_NUMBER", "+19165468537")
    if client:
        try:
            client.messages.create(
                to=to_phone,
                from_=from_phone,
                body=body
            )
            return True
        except Exception as e:
            print(f"[Twilio Outbound Error]: {e}")
            return False

    print(f"[SMS Outbound (Simulated) to {to_phone}]: {body}")
    return True

def process_inbound_sms(payload_data: Dict[str, Any]) -> Tuple[str, str]:
    """
    Process incoming SMS payload from either TextBee Webhook or Twilio Webhook.
    Returns a tuple of (reply_text, twiml_xml_string).
    """
    # Normalize fields across TextBee and Twilio
    from_number = (
        payload_data.get("From") or 
        payload_data.get("sender") or 
        payload_data.get("phone") or 
        payload_data.get("from_number") or ""
    ).strip()

    body_text = (
        payload_data.get("Body") or 
        payload_data.get("message") or 
        payload_data.get("text") or 
        payload_data.get("body") or ""
    ).strip()

    media_urls = payload_data.get("media_urls", [])
    num_media = int(payload_data.get("NumMedia", 0))
    for i in range(num_media):
        m_url = payload_data.get(f"MediaUrl{i}")
        if m_url and m_url not in media_urls:
            media_urls.append(m_url)

    # Log inbound SMS
    log_sms(phone=from_number, direction="inbound", body=body_text, media_urls=media_urls)

    twiml = MessagingResponse()
    reply_msg = ""

    # Scenario 1: Media / Photos attached (MMS)
    if len(media_urls) > 0:
        image_bytes_list = []
        for url in media_urls:
            try:
                auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN else None
                r = requests.get(url, auth=auth, timeout=10)
                if r.status_code == 200:
                    image_bytes_list.append(r.content)
            except Exception as e:
                print(f"[SMS Handler] Error downloading media {url}: {e}")

        if image_bytes_list:
            estimate = estimate_junk_volume(image_bytes_list)
        else:
            estimate = estimate_junk_volume([media_urls[0]])

        lead_data = {
            "name": "SMS Prospect",
            "phone": from_number,
            "zip_code": "Sacramento Area",
            "status": "quoted",
            "estimated_tier": estimate["recommended_tier"],
            "estimated_price_min": estimate["price_min"],
            "estimated_price_max": estimate["price_max"],
            "special_notes": estimate["special_notes"],
            "photos": media_urls,
            "source": "sms",
            "summary": estimate["summary"]
        }
        lead_id = save_lead(lead_data)
        lead_data["id"] = lead_id
        lead_data["tier_name"] = estimate["tier_name"]
        lead_data["tier_emoji"] = estimate["tier_emoji"]

        # Alert Brandon on Telegram
        notify_new_lead(lead_data)

        reply_msg = (
            f"Woof! Brandon & Gizmo here 🐾\n\n"
            f"Thanks for the photo! Based on the load, that's {estimate['tier_emoji']} {estimate['tier_name']}.\n"
            f"💵 Estimated Flat Rate: ${estimate['price_min']} - ${estimate['price_max']}\n"
            f"🏷 Standby Rate: ${estimate['standby_price_min']} - ${estimate['standby_price_max']} (save $20 if timing is flexible)\n\n"
            f"We can haul this out as early as tomorrow! What day & neighborhood works best for you?"
        )
        twiml.message(reply_msg)
        log_sms(phone=from_number, direction="outbound", body=reply_msg, lead_id=lead_id)
        return reply_msg, str(twiml)

    # Scenario 2: Keyword Booking / Confirmation (e.g. YES, STANDBY, BOOK)
    lower_body = body_text.lower()
    existing_lead = get_lead_by_phone(from_number)

    if any(k in lower_body for k in ["yes", "book", "schedule", "tomorrow", "ready", "standby"]):
        is_standby = "standby" in lower_body
        if existing_lead:
            update_lead_status(existing_lead["id"], "booked")
        
        reply_msg = (
            f"Awesome! Brandon is setting your slot on the schedule right now. 🐾\n"
            f"{'You are locked in for the Standby Discount! ' if is_standby else ''}"
            f"What is your street address in Citrus Heights / Sacramento?"
        )
        twiml.message(reply_msg)
        log_sms(phone=from_number, direction="outbound", body=reply_msg)
        return reply_msg, str(twiml)

    # Scenario 3: General Text Inquiry without Photo
    reply_msg = (
        f"Hey there! Brandon with Go Fetch, Gizmo! here 🐾\n\n"
        f"Text me 1-2 quick photos of what you need hauled and your zip code, "
        f"and Gizmo and I will send you an exact flat-rate quote in under 60 seconds!"
    )
    twiml.message(reply_msg)
    log_sms(phone=from_number, direction="outbound", body=reply_msg)
    return reply_msg, str(twiml)
