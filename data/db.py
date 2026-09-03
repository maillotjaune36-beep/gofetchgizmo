"""
Go Fetch, Gizmo! - Universal Data Layer & CRM Database
Supports Netlify PostgreSQL (Production) and local SQLite (Fallback/Offline).
Manages Leads/Jobs, Customer 360 & LTV, 2-Way SMS Conversations, Reviews, and B2B Whales.
"""
import os
import sys
import json
import sqlite3
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Load environment
from dotenv import load_dotenv
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_PATH = Path(__file__).resolve().parent / "gizmo.db"

# Optional Postgres driver
try:
    import psycopg2
    import psycopg2.extras
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

def is_postgres() -> bool:
    return bool(DATABASE_URL and DATABASE_URL.startswith("postgres") and PSYCOPG2_AVAILABLE)

def get_connection():
    if is_postgres():
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn
    else:
        os.makedirs(DB_PATH.parent, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH))
        conn.row_factory = sqlite3.Row
        return conn

def execute_query(
    sql: str,
    params: tuple = (),
    fetch_one: bool = False,
    fetch_all: bool = False,
    commit: bool = False,
    return_id: bool = False
) -> Any:
    """Universal query runner with automatic placeholder & return ID adaptation"""
    conn = get_connection()
    cursor = conn.cursor()
    pg = is_postgres()

    # Adapt SQL placeholders for Postgres (%s) vs SQLite (?)
    adapted_sql = sql
    if pg:
        adapted_sql = sql.replace("?", "%s")
        # For Postgres INSERT with return_id, append RETURNING id
        if return_id and "RETURNING" not in adapted_sql.upper():
            adapted_sql = adapted_sql.rstrip().rstrip(";") + " RETURNING id"

    try:
        cursor.execute(adapted_sql, params)
        
        result = None
        if return_id:
            if pg:
                row = cursor.fetchone()
                result = row["id"] if row else None
            else:
                result = cursor.lastrowid
        elif fetch_one:
            row = cursor.fetchone()
            result = dict(row) if row else None
        elif fetch_all:
            rows = cursor.fetchall()
            result = [dict(r) for r in rows]

        if commit or return_id:
            conn.commit()

        return result
    except Exception as e:
        conn.rollback()
        print(f"[DB Error on query: {adapted_sql}]: {e}")
        raise e
    finally:
        cursor.close()
        conn.close()

def init_db():
    """Create tables on startup (PostgreSQL or SQLite)"""
    pg = is_postgres()
    print(f"[Gizmo DB] Initializing Go Fetch, Gizmo! Database ({'Netlify PostgreSQL' if pg else 'Local SQLite'})...")

    conn = get_connection()
    cursor = conn.cursor()

    if pg:
        # PostgreSQL Schema
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            email TEXT,
            address TEXT,
            zip_code TEXT,
            customer_type TEXT DEFAULT 'residential',
            total_jobs INTEGER DEFAULT 0,
            total_revenue INTEGER DEFAULT 0,
            gate_code TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS leads (
            id SERIAL PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            name TEXT,
            phone TEXT NOT NULL,
            zip_code TEXT,
            address TEXT,
            status TEXT DEFAULT 'new',
            estimated_tier TEXT,
            estimated_price_min INTEGER,
            estimated_price_max INTEGER,
            final_price INTEGER,
            standby_opt_in BOOLEAN DEFAULT FALSE,
            special_notes TEXT,
            photos_json TEXT,
            source TEXT DEFAULT 'web',
            preferred_date TEXT,
            scheduled_time TEXT,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sms_messages (
            id SERIAL PRIMARY KEY,
            lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            phone_number TEXT NOT NULL,
            direction TEXT NOT NULL,
            body TEXT,
            media_urls_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS review_requests (
            id SERIAL PRIMARY KEY,
            lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
            customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
            customer_name TEXT,
            phone_number TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'sent',
            rating INTEGER DEFAULT 5,
            review_text TEXT
        );

        CREATE TABLE IF NOT EXISTS b2b_prospects (
            id SERIAL PRIMARY KEY,
            company_name TEXT NOT NULL,
            contact_name TEXT,
            email TEXT,
            phone TEXT,
            category TEXT,
            address TEXT,
            city TEXT,
            status TEXT DEFAULT 'scouted',
            last_contacted_at TIMESTAMP,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS classified_signals (
            id SERIAL PRIMARY KEY,
            cl_post_id TEXT UNIQUE NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            location TEXT,
            snippet TEXT,
            suggested_pitch TEXT,
            status TEXT DEFAULT 'new',
            published_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        conn.commit()
    else:
        # SQLite Schema
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            email TEXT,
            address TEXT,
            zip_code TEXT,
            customer_type TEXT DEFAULT 'residential',
            total_jobs INTEGER DEFAULT 0,
            total_revenue INTEGER DEFAULT 0,
            gate_code TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER,
            name TEXT,
            phone TEXT NOT NULL,
            zip_code TEXT,
            address TEXT,
            status TEXT DEFAULT 'new',
            estimated_tier TEXT,
            estimated_price_min INTEGER,
            estimated_price_max INTEGER,
            final_price INTEGER,
            standby_opt_in BOOLEAN DEFAULT 0,
            special_notes TEXT,
            photos_json TEXT,
            source TEXT DEFAULT 'web',
            preferred_date TEXT,
            scheduled_time TEXT,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers (id)
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sms_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER,
            phone_number TEXT NOT NULL,
            direction TEXT NOT NULL,
            body TEXT,
            media_urls_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (lead_id) REFERENCES leads (id)
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS review_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER,
            customer_id INTEGER,
            customer_name TEXT,
            phone_number TEXT NOT NULL,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'sent',
            rating INTEGER DEFAULT 5,
            review_text TEXT,
            FOREIGN KEY (lead_id) REFERENCES leads (id),
            FOREIGN KEY (customer_id) REFERENCES customers (id)
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS b2b_prospects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            contact_name TEXT,
            email TEXT,
            phone TEXT,
            category TEXT,
            address TEXT,
            city TEXT,
            status TEXT DEFAULT 'scouted',
            last_contacted_at TIMESTAMP,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS classified_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cl_post_id TEXT UNIQUE NOT NULL,
            category TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            location TEXT,
            snippet TEXT,
            suggested_pitch TEXT,
            status TEXT DEFAULT 'new',
            published_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)
        conn.commit()

    cursor.close()
    conn.close()

    # Seed initial B2B prospects if table is empty
    seed_b2b_if_empty()

def seed_b2b_if_empty():
    prospects = execute_query("SELECT COUNT(*) as cnt FROM b2b_prospects", fetch_one=True)
    if prospects and prospects.get("cnt", 0) == 0:
        initial_partners = [
            ("Sacramento Property Management Pros", "Elena Rostova", "elena@sacpremierprop.com", "(916) 555-0144", "Property Management", "Citrus Heights"),
            ("Lyon Real Estate - Citrus Heights Group", "Mark Henderson", "mhenderson@golyon.com", "(916) 555-0188", "Real Estate", "Citrus Heights"),
            ("Greenback Self Storage", "Dave Clark", "manager@greenbackstorage.com", "(916) 555-0122", "Storage Facility", "Citrus Heights"),
            ("River City Rentals & HOA", "Amanda Cruz", "amanda@rivercityrentals.com", "(916) 555-0199", "Property Management", "Carmichael"),
            ("Fair Oaks Village Realty", "Tom Bennett", "tom@fairoaksrealty.com", "(916) 555-0177", "Real Estate", "Fair Oaks")
        ]
        for p in initial_partners:
            execute_query("""
            INSERT INTO b2b_prospects (company_name, contact_name, email, phone, category, city, status)
            VALUES (?, ?, ?, ?, ?, ?, 'scouted')
            """, p, commit=True)

# ----------------- CUSTOMER MANAGEMENT ----------------- #

def get_or_create_customer(name: str, phone: str, zip_code: str = "", address: str = "", customer_type: str = "residential") -> int:
    row = execute_query("SELECT id FROM customers WHERE phone = ?", (phone,), fetch_one=True)
    if row:
        cid = row["id"]
        execute_query("""
        UPDATE customers 
        SET name = COALESCE(NULLIF(?, ''), name), 
            zip_code = COALESCE(NULLIF(?, ''), zip_code), 
            address = COALESCE(NULLIF(?, ''), address) 
        WHERE id = ?
        """, (name, zip_code, address, cid), commit=True)
        return cid
    else:
        cid = execute_query("""
        INSERT INTO customers (name, phone, zip_code, address, customer_type)
        VALUES (?, ?, ?, ?, ?)
        """, (name or "Neighbor", phone, zip_code, address, customer_type), return_id=True)
        return cid

def get_all_customers() -> List[Dict[str, Any]]:
    return execute_query("SELECT * FROM customers ORDER BY total_revenue DESC, created_at DESC", fetch_all=True) or []

def update_customer(customer_id: int, updates: Dict[str, Any]) -> bool:
    fields = []
    values = []
    for k, v in updates.items():
        fields.append(f"{k} = ?")
        values.append(v)
    fields.append("updated_at = CURRENT_TIMESTAMP")
    values.append(customer_id)
    query = f"UPDATE customers SET {', '.join(fields)} WHERE id = ?"
    execute_query(query, tuple(values), commit=True)
    return True

def get_customer_jobs(customer_id: int) -> List[Dict[str, Any]]:
    rows = execute_query("SELECT * FROM leads WHERE customer_id = ? ORDER BY id DESC", (customer_id,), fetch_all=True) or []
    for r in rows:
        r["photos"] = json.loads(r.get("photos_json") or "[]")
    return rows

# ----------------- LEAD / JOB MANAGEMENT ----------------- #

def save_lead(data: Dict[str, Any]) -> int:
    phone = data.get("phone", "").strip()
    name = data.get("name", "Neighbor").strip()
    zip_code = data.get("zip_code", "").strip()
    address = data.get("address", "").strip()
    
    cid = get_or_create_customer(name, phone, zip_code, address)
    photos_json = json.dumps(data.get("photos", []))
    
    lead_id = execute_query("""
    INSERT INTO leads (
        customer_id, name, phone, zip_code, address, status,
        estimated_tier, estimated_price_min, estimated_price_max, final_price,
        standby_opt_in, special_notes, photos_json, source, preferred_date, scheduled_time
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        cid,
        name,
        phone,
        zip_code,
        address,
        data.get("status", "new"),
        data.get("estimated_tier"),
        data.get("estimated_price_min"),
        data.get("estimated_price_max"),
        data.get("final_price", data.get("estimated_price_min")),
        True if data.get("standby_opt_in") else False,
        data.get("special_notes", ""),
        photos_json,
        data.get("source", "web"),
        data.get("preferred_date", ""),
        data.get("scheduled_time", "")
    ), return_id=True)
    
    # Increment customer total jobs
    execute_query("UPDATE customers SET total_jobs = total_jobs + 1 WHERE id = ?", (cid,), commit=True)
    return lead_id

def update_job(job_id: int, updates: Dict[str, Any]) -> bool:
    fields = []
    values = []
    for k, v in updates.items():
        fields.append(f"{k} = ?")
        values.append(v)
    values.append(job_id)
    query = f"UPDATE leads SET {', '.join(fields)} WHERE id = ?"
    execute_query(query, tuple(values), commit=True)
    return True

def complete_job(job_id: int, final_price: int) -> Optional[Dict[str, Any]]:
    job = execute_query("SELECT * FROM leads WHERE id = ?", (job_id,), fetch_one=True)
    if not job:
        return None
        
    cid = job.get("customer_id")
    execute_query("""
    UPDATE leads 
    SET status = 'completed', final_price = ?, completed_at = CURRENT_TIMESTAMP 
    WHERE id = ?
    """, (final_price, job_id), commit=True)
    
    if cid:
        execute_query("""
        UPDATE customers 
        SET total_revenue = total_revenue + ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
        """, (final_price, cid), commit=True)
        
    job["final_price"] = final_price
    return job

def delete_job(job_id: int) -> bool:
    job = execute_query("SELECT customer_id FROM leads WHERE id = ?", (job_id,), fetch_one=True)
    if job and job.get("customer_id"):
        cid = job["customer_id"]
        execute_query("UPDATE customers SET total_jobs = GREATEST(0, total_jobs - 1) WHERE id = ?" if is_postgres() else "UPDATE customers SET total_jobs = MAX(0, total_jobs - 1) WHERE id = ?", (cid,), commit=True)
        
    execute_query("DELETE FROM leads WHERE id = ?", (job_id,), commit=True)
    execute_query("DELETE FROM sms_messages WHERE lead_id = ?", (job_id,), commit=True)
    execute_query("DELETE FROM review_requests WHERE lead_id = ?", (job_id,), commit=True)
    return True

def get_single_job(job_id: int) -> Optional[Dict[str, Any]]:
    job = execute_query("SELECT * FROM leads WHERE id = ?", (job_id,), fetch_one=True)
    if job:
        job["photos"] = json.loads(job.get("photos_json") or "[]")
        return job
    return None

def get_jobs_by_status(status: Optional[str] = None) -> List[Dict[str, Any]]:
    if status and status != "all":
        rows = execute_query("SELECT * FROM leads WHERE status = ? ORDER BY id DESC", (status,), fetch_all=True) or []
    else:
        rows = execute_query("SELECT * FROM leads ORDER BY id DESC", fetch_all=True) or []
        
    for r in rows:
        r["photos"] = json.loads(r.get("photos_json") or "[]")
    return rows

def get_all_leads() -> List[Dict[str, Any]]:
    return get_jobs_by_status("all")

def get_lead_by_phone(phone: str) -> Optional[Dict[str, Any]]:
    lead = execute_query("SELECT * FROM leads WHERE phone = ? ORDER BY id DESC LIMIT 1", (phone,), fetch_one=True)
    if lead:
        lead["photos"] = json.loads(lead.get("photos_json") or "[]")
        return lead
    return None

def update_lead_status(lead_id: int, status: str) -> bool:
    return update_job(lead_id, {"status": status})

# ----------------- REVIEWS & REPUTATION ----------------- #

def log_review_request(lead_id: int, customer_id: int, customer_name: str, phone: str) -> int:
    return execute_query("""
    INSERT INTO review_requests (lead_id, customer_id, customer_name, phone_number)
    VALUES (?, ?, ?, ?)
    """, (lead_id, customer_id, customer_name, phone), return_id=True)

def get_all_reviews() -> List[Dict[str, Any]]:
    return execute_query("SELECT * FROM review_requests ORDER BY sent_at DESC", fetch_all=True) or []

# ----------------- SMS / MMS INBOX ----------------- #

def log_sms(phone: str, direction: str, body: str, media_urls: Optional[List[str]] = None, lead_id: Optional[int] = None):
    execute_query("""
    INSERT INTO sms_messages (lead_id, phone_number, direction, body, media_urls_json)
    VALUES (?, ?, ?, ?, ?)
    """, (
        lead_id,
        phone,
        direction,
        body,
        json.dumps(media_urls or [])
    ), commit=True)

def get_inbox_threads() -> List[Dict[str, Any]]:
    threads = execute_query("""
    SELECT phone_number, MAX(created_at) as last_msg_time, COUNT(*) as msg_count
    FROM sms_messages
    GROUP BY phone_number
    ORDER BY last_msg_time DESC
    """, fetch_all=True) or []
    
    for t in threads:
        phone = t["phone_number"]
        msgs = execute_query("SELECT * FROM sms_messages WHERE phone_number = ? ORDER BY created_at ASC", (phone,), fetch_all=True) or []
        for m in msgs:
            m["media_urls"] = json.loads(m.get("media_urls_json") or "[]")
        t["messages"] = msgs
        
        cust = execute_query("SELECT * FROM customers WHERE phone = ?", (phone,), fetch_one=True)
        t["customer"] = cust
        
    return threads

# ----------------- B2B PROSPECTS ----------------- #

def save_b2b_prospect(prospect: Dict[str, Any]) -> int:
    return execute_query("""
    INSERT INTO b2b_prospects (company_name, contact_name, email, phone, category, address, city, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        prospect.get("company_name"),
        prospect.get("contact_name"),
        prospect.get("email"),
        prospect.get("phone"),
        prospect.get("category"),
        prospect.get("address"),
        prospect.get("city", "Citrus Heights"),
        prospect.get("status", "scouted"),
        prospect.get("notes", "")
    ), return_id=True)

def get_single_b2b_prospect(prospect_id: int) -> Optional[Dict[str, Any]]:
    return execute_query("SELECT * FROM b2b_prospects WHERE id = ?", (prospect_id,), fetch_one=True)

def update_b2b_prospect(prospect_id: int, updates: Dict[str, Any]) -> bool:
    fields = []
    values = []
    for k, v in updates.items():
        fields.append(f"{k} = ?")
        values.append(v)
    values.append(prospect_id)
    query = f"UPDATE b2b_prospects SET {', '.join(fields)} WHERE id = ?"
    execute_query(query, tuple(values), commit=True)
    return True

def get_all_b2b_prospects() -> List[Dict[str, Any]]:
    return execute_query("SELECT * FROM b2b_prospects ORDER BY id DESC", fetch_all=True) or []

# ----------------- CLASSIFIED SIGNALS ----------------- #

def signal_exists(cl_post_id: str) -> bool:
    row = execute_query("SELECT id FROM classified_signals WHERE cl_post_id = ?", (cl_post_id,), fetch_one=True)
    return bool(row)

def save_classified_signal(signal: Dict[str, Any]) -> int:
    pid = signal.get("cl_post_id")
    if signal_exists(pid):
        row = execute_query("SELECT id FROM classified_signals WHERE cl_post_id = ?", (pid,), fetch_one=True)
        return row.get("id") if row else 0

    return execute_query("""
    INSERT INTO classified_signals (cl_post_id, category, title, url, location, snippet, suggested_pitch, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        signal.get("cl_post_id"),
        signal.get("category"),
        signal.get("title"),
        signal.get("url"),
        signal.get("location"),
        signal.get("snippet"),
        signal.get("suggested_pitch"),
        signal.get("status", "new"),
        signal.get("published_at", datetime.now().isoformat())
    ), return_id=True)

def get_classified_signals(category: Optional[str] = None, status: Optional[str] = None, limit: int = 60) -> List[Dict[str, Any]]:
    conditions = []
    params = []
    if category and category != "all":
        conditions.append("category = ?")
        params.append(category)
    if status and status != "all":
        conditions.append("status = ?")
        params.append(status)
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"SELECT * FROM classified_signals {where_clause} ORDER BY id DESC LIMIT ?"
    params.append(limit)
    return execute_query(query, tuple(params), fetch_all=True) or []

def update_classified_signal_status(signal_id: int, status: str) -> bool:
    execute_query("UPDATE classified_signals SET status = ? WHERE id = ?", (status, signal_id), commit=True)
    return True

# ----------------- CRM STATS & ANALYTICS ----------------- #

def get_crm_stats() -> Dict[str, Any]:
    rev_row = execute_query("SELECT SUM(final_price) as total_rev, COUNT(*) as completed_count FROM leads WHERE status = 'completed'", fetch_one=True) or {}
    total_rev = rev_row.get("total_rev") or 0
    completed_count = rev_row.get("completed_count") or 0
    
    act_row = execute_query("SELECT COUNT(*) as active_count FROM leads WHERE status IN ('new', 'quoted', 'scheduled', 'en_route')", fetch_one=True) or {}
    active_count = act_row.get("active_count") or 0
    
    sb_row = execute_query("SELECT COUNT(*) as standby_count FROM leads WHERE standby_opt_in = TRUE" if is_postgres() else "SELECT COUNT(*) as standby_count FROM leads WHERE standby_opt_in = 1", fetch_one=True) or {}
    standby_count = sb_row.get("standby_count") or 0
    
    cust_row = execute_query("SELECT COUNT(*) as cust_count FROM customers", fetch_one=True) or {}
    cust_count = cust_row.get("cust_count") or 0
    
    rev_count_row = execute_query("SELECT COUNT(*) as review_count FROM review_requests", fetch_one=True) or {}
    review_count = rev_count_row.get("review_count") or 0
    
    avg_ticket = int(total_rev / completed_count) if completed_count > 0 else 165
    gizmo_treats = review_count * 2
    
    return {
        "total_revenue": total_rev,
        "completed_jobs": completed_count,
        "active_jobs": active_count,
        "total_customers": cust_count,
        "standby_jobs": standby_count,
        "avg_ticket": avg_ticket,
        "reviews_sent": review_count,
        "gizmo_treats_earned": gizmo_treats
    }

# Initialize tables on import
init_db()
