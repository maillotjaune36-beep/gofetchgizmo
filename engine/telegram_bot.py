"""
Go Fetch, Gizmo! - Telegram Lead Dispatcher & Command Center
Sends real-time lead alerts with 1-tap booking/call buttons directly to your phone.
"""
import requests
import json
import os
from typing import Dict, Any, Optional
from config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

def get_resolved_chat_id(bot_token: str) -> Optional[str]:
    """Auto-detect chat ID from recent bot updates if not configured as numeric ID"""
    chat_id = TELEGRAM_CHAT_ID or os.getenv("TELEGRAM_CHAT_ID", "")
    if chat_id and (chat_id.isdigit() or (chat_id.startswith("-") and chat_id[1:].isdigit())):
        return chat_id

    # Try fetching from getUpdates
    try:
        r = requests.get(f"https://api.telegram.org/bot{bot_token}/getUpdates", timeout=5)
        if r.status_code == 200:
            updates = r.json().get("result", [])
            for u in reversed(updates):
                msg = u.get("message") or u.get("channel_post") or u.get("my_chat_member")
                if msg and "chat" in msg:
                    return str(msg["chat"]["id"])
    except Exception as e:
        print(f"[TelegramBot] getUpdates error: {e}")

    return None

def send_telegram_message(
    text: str,
    reply_markup: Optional[Dict[str, Any]] = None,
    parse_mode: str = "HTML"
) -> bool:
    """Send text message via Telegram Bot API"""
    bot_token = TELEGRAM_BOT_TOKEN or os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not bot_token:
        print(f"[TelegramBot (Simulated)] {text}")
        return False

    chat_id = get_resolved_chat_id(bot_token)
    if not chat_id:
        print(f"[TelegramBot] Please open Telegram, search for your bot, and press 'Start' so it can send alerts to your chat ID!")
        print(f"[TelegramBot (Simulated)] {text}")
        return False

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup

    try:
        r = requests.post(url, json=payload, timeout=10)
        if r.status_code == 200:
            return True
        print(f"[TelegramBot Response {r.status_code}]: {r.text}")
        return False
    except Exception as e:
        print(f"[TelegramBot] Error sending alert: {e}")
        return False

def notify_new_lead(lead_data: Dict[str, Any]) -> bool:
    """Format and dispatch new inbound lead alert to Telegram"""
    name = lead_data.get("name", "Neighbor")
    phone = lead_data.get("phone", "N/A")
    zip_code = lead_data.get("zip_code", "Sacramento Area")
    tier_name = lead_data.get("tier_name", "The Retriever")
    tier_emoji = lead_data.get("tier_emoji", "🐕")
    price_min = lead_data.get("price_min", 150)
    price_max = lead_data.get("price_max", 180)
    standby = "✅ Yes ($20 OFF)" if lead_data.get("standby_opt_in") else "❌ Normal Dispatch"
    source = lead_data.get("source", "Web").upper()
    notes = lead_data.get("special_notes") or "None"
    summary = lead_data.get("summary") or "Assorted junk"

    msg = (
        f"🚨 <b>NEW GIZMO LEAD CAPTURED!</b> 🐾\n\n"
        f"👤 <b>Customer:</b> {name}\n"
        f"📞 <b>Phone:</b> <code>{phone}</code>\n"
        f"📍 <b>Location:</b> {zip_code}\n"
        f"🏷 <b>Source:</b> {source}\n\n"
        f"📦 <b>Load Estimate:</b> {tier_emoji} <b>{tier_name}</b>\n"
        f"💵 <b>Estimated Price:</b> ${price_min} - ${price_max}\n"
        f"⏳ <b>Standby Opt-in:</b> {standby}\n"
        f"📝 <b>Items:</b> {summary}\n"
        f"⚠️ <b>Notes:</b> {notes}\n"
    )

    clean_phone = "".join(filter(str.isdigit, phone))
    clean_zip = "".join(filter(str.isdigit, zip_code))

    buttons = [
        [
            {"text": "📋 Open CRM Dispatch Board", "url": "https://gofetchgizmo.com/crm"},
        ]
    ]

    if clean_zip:
        buttons[0].append({"text": "🗺 Map Area", "url": f"https://www.google.com/maps/search/?api=1&query={clean_zip}"})

    reply_markup = {"inline_keyboard": buttons}

    return send_telegram_message(msg, reply_markup=reply_markup)

def notify_b2b_reply(prospect: Dict[str, Any], reply_text: str) -> bool:
    """Notify when a Property Manager or Realtor replies to cold outreach"""
    company = prospect.get("company_name", "Unknown Company")
    contact = prospect.get("contact_name", "Contact")
    phone = prospect.get("phone", "N/A")
    email = prospect.get("email", "N/A")

    msg = (
        f"🎯 <b>B2B PARTNERSHIP REPLY RECEIVED!</b> 💼\n\n"
        f"🏢 <b>Company:</b> {company}\n"
        f"👤 <b>Contact:</b> {contact}\n"
        f"📧 <b>Email:</b> <code>{email}</code>\n"
        f"📞 <b>Phone:</b> <code>{phone}</code>\n\n"
        f"💬 <b>Reply Snippet:</b>\n"
        f"<i>\"{reply_text}\"</i>\n"
    )

    buttons = [
        [
            {"text": "📋 Open CRM", "url": "https://gofetchgizmo.com/crm"}
        ]
    ]
    if email and "@" in email:
        buttons[0].append({"text": "✉️ Email Partner", "url": f"https://mail.google.com/mail/?view=cm&fs=1&to={email}"})

    reply_markup = {"inline_keyboard": buttons}
    return send_telegram_message(msg, reply_markup=reply_markup)

if __name__ == "__main__":
    print("Testing Telegram Notification Dispatch:")
    sample_lead = {
        "name": "Sarah Miller",
        "phone": "(916) 555-0192",
        "zip_code": "95610 (Citrus Heights)",
        "tier_name": "The Retriever",
        "tier_emoji": "🐕",
        "price_min": 150,
        "price_max": 180,
        "standby_opt_in": True,
        "summary": "Old sectional sofa and broken treadmill in garage",
        "source": "Web Estimator"
    }
    notify_new_lead(sample_lead)
