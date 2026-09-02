"""
Go Fetch, Gizmo! - B2B Outreach Dispatcher
Sends throttled, compliant partnership emails to local property managers and agents.
"""
import smtplib
import time
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Dict, Any
from engine.b2b_scout import harvest_b2b_prospects
from engine.b2b_copywriter import generate_b2b_pitch
from data.db import get_connection

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Brandon @ Go Fetch, Gizmo!")

def send_b2b_email(to_email: str, subject: str, body: str) -> bool:
    """Send individual email via SMTP"""
    if not SMTP_USER or not SMTP_PASS:
        print(f"[Dispatcher Simulated] To: {to_email} | Subj: {subject}")
        return True

    msg = MIMEMultipart()
    msg["From"] = f"{SMTP_FROM_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        print(f"[Dispatcher Error] Failed to send email to {to_email}: {e}")
        return False

def run_b2b_campaign(category: str = "all", dry_run: bool = True, limit: int = 10):
    """
    Executes outbound campaign to staged B2B prospects.
    """
    prospects = harvest_b2b_prospects(category=category, save_to_database=True)
    print(f"\n=======================================================")
    print(f"🚀 GIZMO B2B OUTBOUND DISPATCHER ({'DRY RUN' if dry_run else 'LIVE'})")
    print(f"Targeting: {category.upper()} | Staged Prospects: {len(prospects)}")
    print(f"=======================================================\n")

    sent_count = 0
    for p in prospects[:limit]:
        pitch = generate_b2b_pitch(p)
        print(f"[{sent_count+1}/{min(len(prospects), limit)}] Target: {p['company_name']} ({p.get('city')})")
        print(f"    Email: {p.get('email')}")
        print(f"    Subject: {pitch['subject']}")
        print(f"    Body:\n{pitch['body']}")
        print("-" * 55)

        if not dry_run:
            success = send_b2b_email(p.get("email"), pitch["subject"], pitch["body"])
            if success:
                # Update status in DB
                conn = get_connection()
                cursor = conn.cursor()
                cursor.execute("UPDATE b2b_prospects SET status = 'emailed', last_contacted_at = CURRENT_TIMESTAMP WHERE id = ?", (p.get("id"),))
                conn.commit()
                conn.close()
                time.sleep(3) # safe delay between sends

        sent_count += 1

    print(f"\n✅ Finished campaign! {sent_count} B2B outreach messages processed.")

if __name__ == "__main__":
    import sys
    dry = "--live" not in sys.argv
    run_b2b_campaign(dry_run=dry)
