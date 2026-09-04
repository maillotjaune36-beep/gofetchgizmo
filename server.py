"""
Go Fetch, Gizmo! - Unified Customer Generation & In-House CRM Server
FastAPI Webhooks, Instant Photo Estimator, Telegram Dispatch, and CRM Command Center.
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

import os
import shutil
from pathlib import Path
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Request, File, UploadFile, Form, BackgroundTasks, Response
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

from config import BASE_DIR, TARGET_ZIPS, PRICING_TIERS
from data.db import (
    save_lead,
    get_all_leads,
    get_jobs_by_status,
    get_single_job,
    update_job,
    delete_job,
    complete_job,
    get_all_customers,
    get_customer_jobs,
    update_customer,
    get_inbox_threads,
    get_all_reviews,
    get_all_b2b_prospects,
    get_single_b2b_prospect,
    save_b2b_prospect,
    update_b2b_prospect,
    get_crm_stats,
    log_review_request,
    get_classified_signals,
    save_classified_signal,
    update_classified_signal_status
)
from engine.classifieds_scout import scout_all_signals
from engine.vision_estimator import estimate_junk_volume, async_estimate_junk_volume
from engine.sms_handler import send_outbound_sms
from engine.telegram_bot import notify_new_lead, send_telegram_message
from engine.b2b_dispatcher import run_b2b_campaign, send_b2b_email
from engine.b2b_copywriter import generate_b2b_pitch
from engine.reviews import send_review_request, send_review_email
from config import SUPABASE_URL, SUPABASE_ANON_KEY

app = FastAPI(title="Go Fetch Gizmo - Customer & CRM Pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = BASE_DIR / "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount uploads directory
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Host-based Subdomain Routing Middleware for crm.gofetchgizmo.com
@app.middleware("http")
async def subdomain_middleware(request: Request, call_next):
    host = request.headers.get("host", "").lower()
    if (host.startswith("crm.gofetchgizmo.com") or host.startswith("crm.localhost")) and request.url.path == "/":
        crm_index = BASE_DIR / "app" / "crm" / "index.html"
        return FileResponse(crm_index)
    return await call_next(request)

# ----------------- STATIC & WEB PAGES ----------------- #

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    index_file = BASE_DIR / "app" / "index.html"
    return FileResponse(index_file)

@app.get("/estimator.css")
async def serve_estimator_css():
    return FileResponse(BASE_DIR / "app" / "estimator.css")

@app.get("/estimator.js")
async def serve_estimator_js():
    return FileResponse(BASE_DIR / "app" / "estimator.js")

@app.get("/crm", response_class=HTMLResponse)
async def serve_crm():
    crm_index = BASE_DIR / "app" / "crm" / "index.html"
    return FileResponse(crm_index)

@app.get("/crm.css")
async def serve_crm_css():
    return FileResponse(BASE_DIR / "app" / "crm" / "crm.css")

@app.get("/crm.js")
async def serve_crm_js():
    return FileResponse(BASE_DIR / "app" / "crm" / "crm.js")

# ----------------- PUBLIC ESTIMATOR & INBOUND ----------------- #

@app.post("/api/estimate")
async def estimate_photos(images: List[UploadFile] = File(...)):
    saved_paths = []
    for file in images:
        file_path = UPLOAD_DIR / file.filename
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_paths.append(str(file_path))

    estimate = await async_estimate_junk_volume(saved_paths)
    estimate["uploaded_files"] = [f"/uploads/{os.path.basename(p)}" for p in saved_paths]
    return JSONResponse(content=estimate)

class BookingRequest(BaseModel):
    name: str
    phone: str
    zip_code: str
    preferred_date: Optional[str] = None
    standby_opt_in: bool = True
    estimated_tier: str = "retriever"
    estimated_price_min: int = 150
    estimated_price_max: int = 180
    summary: Optional[str] = "Web photo quote"
    special_notes: Optional[str] = ""

@app.post("/api/book")
async def book_lead(booking: BookingRequest, background_tasks: BackgroundTasks):
    lead_dict = booking.model_dump()
    lead_dict["status"] = "new"
    lead_dict["source"] = "web"
    
    tier_info = PRICING_TIERS.get(booking.estimated_tier.lower(), PRICING_TIERS["retriever"])
    lead_dict["tier_name"] = tier_info["name"]
    lead_dict["tier_emoji"] = tier_info["emoji"]

    lead_id = save_lead(lead_dict)
    lead_dict["id"] = lead_id

    # 1. Notify Brandon via Telegram alert
    background_tasks.add_task(notify_new_lead, lead_dict)

    # 2. Send instant confirmation SMS to client
    confirm_text = (
        f"Hi {booking.name}! Brandon here from Go Fetch, Gizmo! 🐾 "
        f"We have your reservation saved for {booking.preferred_date or 'this week'}. "
        f"Estimated rate: ${booking.estimated_price_min} - ${booking.estimated_price_max} "
        f"{'(with $20 Standby Discount)' if booking.standby_opt_in else ''}. "
        f"I'll text you shortly to finalize your arrival time window!"
    )
    background_tasks.add_task(send_outbound_sms, booking.phone, confirm_text)

    return {"status": "success", "lead_id": lead_id, "message": "Booking received!"}

# ----------------- AUTH & CONFIG API ----------------- #

@app.get("/api/auth/config")
async def get_auth_config():
    return {
        "supabase_url": SUPABASE_URL,
        "supabase_anon_key": SUPABASE_ANON_KEY,
        "auth_enabled": bool(SUPABASE_URL and SUPABASE_ANON_KEY)
    }

# ----------------- CRM REST API ----------------- #

@app.get("/api/crm/stats")
async def get_stats():
    return get_crm_stats()

@app.get("/api/crm/jobs")
@app.get("/api/leads")
async def list_jobs(status: Optional[str] = "all"):
    return get_jobs_by_status(status)

@app.get("/api/crm/jobs/{job_id}")
async def get_job_detail(job_id: int):
    job = get_single_job(job_id)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job not found"})
    return job

class ManualJobCreate(BaseModel):
    name: str
    phone: str
    zip_code: Optional[str] = "Citrus Heights"
    address: Optional[str] = ""
    status: Optional[str] = "new"
    estimated_tier: Optional[str] = "retriever"
    estimated_price_min: Optional[int] = 150
    estimated_price_max: Optional[int] = 180
    standby_opt_in: Optional[bool] = False
    preferred_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    special_notes: Optional[str] = ""

@app.post("/api/crm/jobs")
async def create_job_endpoint(payload: ManualJobCreate, background_tasks: BackgroundTasks):
    job_dict = payload.model_dump()
    tier_info = PRICING_TIERS.get(payload.estimated_tier.lower(), PRICING_TIERS["retriever"])
    job_dict["tier_name"] = tier_info["name"]
    job_dict["tier_emoji"] = tier_info["emoji"]
    job_dict["source"] = "dispatch_manual"

    job_id = save_lead(job_dict)
    job_dict["id"] = job_id

    # Alert on Telegram
    background_tasks.add_task(notify_new_lead, job_dict)

    return {"status": "success", "job_id": job_id, "job": job_dict}

class JobUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    final_price: Optional[int] = None
    estimated_price_min: Optional[int] = None
    estimated_price_max: Optional[int] = None
    estimated_tier: Optional[str] = None
    standby_opt_in: Optional[bool] = None
    preferred_date: Optional[str] = None
    scheduled_time: Optional[str] = None
    address: Optional[str] = None
    zip_code: Optional[str] = None
    special_notes: Optional[str] = None

@app.patch("/api/crm/jobs/{job_id}")
async def patch_job(job_id: int, updates: JobUpdate):
    data = {k: v for k, v in updates.model_dump().items() if v is not None}
    update_job(job_id, data)
    return {"status": "success", "job_id": job_id}

@app.delete("/api/crm/jobs/{job_id}")
async def delete_job_endpoint(job_id: int):
    delete_job(job_id)
    return {"status": "deleted", "job_id": job_id}

class CompleteJobRequest(BaseModel):
    final_price: int

@app.post("/api/crm/jobs/{job_id}/complete")
async def crm_complete_job(job_id: int, payload: CompleteJobRequest, background_tasks: BackgroundTasks):
    job = complete_job(job_id, payload.final_price)
    if not job:
        return JSONResponse(status_code=404, content={"error": "Job not found"})

    # Trigger automated Google Review request SMS
    background_tasks.add_task(send_review_request, job)
    return {"status": "success", "job": job}

@app.post("/api/crm/jobs/{job_id}/en-route")
async def crm_en_route_job(job_id: int):
    update_job(job_id, {"status": "en_route"})
    conn_jobs = get_jobs_by_status("all")
    job = next((j for j in conn_jobs if j["id"] == job_id), None)
    if job:
        cust_name = job.get("name") or "Neighbor"
        phone = job.get("phone") or "N/A"
        msg = (
            f"🚚 <b>EN ROUTE ALERT DISPATCHED!</b> 🐾\n\n"
            f"👤 <b>Customer:</b> {cust_name}\n"
            f"📞 <b>Phone:</b> <code>{phone}</code>\n"
            f"⏱ <b>ETA:</b> ~15 minutes\n"
            f"📍 <b>Status:</b> Truck is rolling!"
        )
        send_telegram_message(msg)
    return {"status": "success", "new_status": "en_route"}

@app.get("/api/crm/customers")
async def list_customers():
    return get_all_customers()

@app.get("/api/crm/customers/{customer_id}/jobs")
async def customer_job_history(customer_id: int):
    return get_customer_jobs(customer_id)

class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    zip_code: Optional[str] = None
    gate_code: Optional[str] = None
    notes: Optional[str] = None
    customer_type: Optional[str] = None

@app.patch("/api/crm/customers/{customer_id}")
async def update_customer_endpoint(customer_id: int, updates: CustomerUpdate):
    data = {k: v for k, v in updates.model_dump().items() if v is not None}
    update_customer(customer_id, data)
    return {"status": "success", "customer_id": customer_id}

@app.get("/api/crm/inbox")
async def get_inbox():
    return get_inbox_threads()

class SendSMSRequest(BaseModel):
    phone: str
    body: str

@app.post("/api/crm/inbox/send")
async def send_chat_sms(payload: SendSMSRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(send_outbound_sms, payload.phone, payload.body)
    return {"status": "queued"}

@app.get("/api/crm/reviews")
async def list_reviews():
    return get_all_reviews()

class ManualReviewRequest(BaseModel):
    phone: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = "Neighbor"
    job_id: Optional[int] = None
    customer_id: Optional[int] = None
    review_url: Optional[str] = None

@app.post("/api/crm/reviews/send")
async def manual_send_review(payload: ManualReviewRequest, background_tasks: BackgroundTasks):
    job_data = {
        "id": payload.job_id,
        "customer_id": payload.customer_id,
        "name": payload.name,
        "phone": payload.phone,
        "email": payload.email,
        "review_url": payload.review_url
    }
    if payload.email:
        background_tasks.add_task(send_review_email, job_data)
    if payload.phone:
        background_tasks.add_task(send_review_request, job_data)
    return {
        "status": "sent",
        "phone": payload.phone,
        "email": payload.email,
        "from": "gofetchgizmo@gmail.com"
    }

@app.get("/api/crm/b2b")
async def list_b2b():
    return get_all_b2b_prospects()

class B2BCampaignRequest(BaseModel):
    category: Optional[str] = "all"
    dry_run: Optional[bool] = True
    limit: Optional[int] = 10

@app.post("/api/b2b/campaign")
async def trigger_b2b_campaign(
    payload: B2BCampaignRequest,
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    background_tasks.add_task(run_b2b_campaign, payload.category, payload.dry_run, payload.limit)
    return {
        "status": "started",
        "category": payload.category,
        "mode": "dry_run" if payload.dry_run else "live",
        "limit": payload.limit
    }

class B2BPitchPreviewRequest(BaseModel):
    prospect_id: int

@app.post("/api/b2b/pitch")
async def preview_b2b_pitch(payload: B2BPitchPreviewRequest):
    prospect = get_single_b2b_prospect(payload.prospect_id)
    if not prospect:
        return JSONResponse(status_code=404, content={"error": "Prospect not found"})
    pitch = generate_b2b_pitch(prospect)
    return {"status": "success", "prospect": prospect, "pitch": pitch}

class B2BSendOneRequest(BaseModel):
    prospect_id: int
    subject: str
    body: str
    email: Optional[str] = None

@app.post("/api/b2b/send-one")
async def send_b2b_single(payload: B2BSendOneRequest):
    prospect = get_single_b2b_prospect(payload.prospect_id)
    target_email = payload.email or (prospect["email"] if prospect else "")
    if not target_email and not prospect:
        return JSONResponse(status_code=404, content={"error": "Prospect not found"})
    
    success = send_b2b_email(target_email, payload.subject, payload.body)
    if success and payload.prospect_id:
        update_b2b_prospect(payload.prospect_id, {"status": "emailed"})

    # Send Telegram notification beam
    try:
        tele_msg = (
            f"🚀 <b>B2B OUTREACH DISPATCHED!</b> 🐾\n\n"
            f"✉️ <b>From:</b> <code>gofetchgizmo@gmail.com</code>\n"
            f"🎯 <b>To:</b> <code>{target_email}</code>\n"
            f"📋 <b>Subject:</b> {payload.subject}\n"
            f"📍 <b>Status:</b> Pitched"
        )
        send_telegram_message(tele_msg)
    except Exception:
        pass

    return {
        "status": "sent" if success else "failed",
        "email": target_email,
        "from": "gofetchgizmo@gmail.com"
    }

class NewB2BProspect(BaseModel):
    company_name: str
    contact_name: Optional[str] = "Property Manager"
    email: str
    phone: Optional[str] = ""
    category: Optional[str] = "Property Management"
    address: Optional[str] = ""
    city: Optional[str] = "Citrus Heights"
    notes: Optional[str] = ""

@app.post("/api/crm/b2b")
async def add_b2b_prospect_endpoint(payload: NewB2BProspect):
    pid = save_b2b_prospect(payload.model_dump())
    return {"status": "created", "prospect_id": pid}

# ----------------- CLASSIFIED SIGNALS (CRISIS & CURB ALERT SNIPER) ----------------- #

@app.get("/api/crm/signals")
async def list_classified_signals(
    category: Optional[str] = "all",
    status: Optional[str] = "all",
    limit: Optional[int] = 60
):
    signals = get_classified_signals(category=category, status=status, limit=limit)
    if not signals:
        scout_all_signals(save_to_db=True, max_per_cat=10)
        signals = get_classified_signals(category=category, status=status, limit=limit)
    return signals

class SignalScanRequest(BaseModel):
    max_per_cat: Optional[int] = 10

@app.post("/api/crm/signals/scan")
async def scan_classified_signals(payload: SignalScanRequest = SignalScanRequest()):
    new_signals = scout_all_signals(save_to_db=True, max_per_cat=payload.max_per_cat)
    return {
        "status": "success",
        "new_count": len(new_signals),
        "signals": new_signals
    }

class SignalStatusUpdate(BaseModel):
    status: str

@app.patch("/api/crm/signals/{signal_id}")
async def update_signal_status_endpoint(signal_id: int, payload: SignalStatusUpdate):
    success = update_classified_signal_status(signal_id, payload.status)
    return {"status": "updated" if success else "failed", "id": signal_id, "new_status": payload.status}

class SignalDispatchRequest(BaseModel):
    method: str = "sms"  # 'sms' or 'email'
    contact: str = ""
    pitch: str = ""
    subject: Optional[str] = "Go Fetch, Gizmo! - Junk Hauling & Cleanouts 🐾"

@app.post("/api/crm/signals/{signal_id}/dispatch")
async def dispatch_signal_endpoint(signal_id: int, payload: SignalDispatchRequest):
    update_classified_signal_status(signal_id, "contacted")
    if payload.method == "email" and "@" in payload.contact:
        try:
            from engine.b2b_dispatcher import send_b2b_email
            send_b2b_email(payload.contact, payload.subject, payload.pitch)
        except Exception as e:
            print(f"[Signal Dispatch Error] Email send failed: {e}")

    try:
        tele_msg = (
            f"🎯 <b>CLASSIFIED OUTREACH DISPATCHED!</b> 🐾\n\n"
            f"👤 <b>Contact:</b> <code>{payload.contact or 'Direct'}</code>\n"
            f"✉️ <b>From:</b> <code>gofetchgizmo@gmail.com</code>\n"
            f"📱 <b>Method:</b> {payload.method.upper()}\n\n"
            f"💬 <b>Pitch:</b>\n<code>{payload.pitch}</code>"
        )
        send_telegram_message(tele_msg)
    except Exception:
        pass

    return {
        "status": "dispatched",
        "id": signal_id,
        "method": payload.method,
        "contact": payload.contact,
        "from": "gofetchgizmo@gmail.com",
        "new_status": "contacted"
    }

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"🐾 Go Fetch, Gizmo! CRM & Dispatch starting at http://{host}:{port}/crm")
    uvicorn.run("server:app", host=host, port=port, reload=True)
