"""
Go Fetch, Gizmo! - Message Dispatch Gateway
Pure Telegram Integration for Real-Time Dispatch Alerts.
"""
import os
from typing import Dict, Any, Optional
from engine.telegram_bot import notify_new_lead, send_telegram_message
from data.db import (
    save_lead,
    get_lead_by_phone,
    update_lead_status,
    log_sms
)

def send_outbound_sms(to_phone: str, body: str) -> bool:
    """Log outbound message and notify Brandon via Telegram"""
    log_sms(phone=to_phone, direction="outbound", body=body)
    msg = f"💬 <b>OUTBOUND MESSAGE LOGGED</b>\nTo: <code>{to_phone}</code>\n\n{body}"
    send_telegram_message(msg)
    return True
