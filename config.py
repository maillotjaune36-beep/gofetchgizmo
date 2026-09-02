"""
Go Fetch, Gizmo! - Core Configuration & Business Logic
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Base Directory
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Antigravity & AI Configuration
ANTIGRAVITY_VERTEX = os.getenv("ANTIGRAVITY_VERTEX", "true").lower() in ("true", "1", "yes")
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-west1")
ANTIGRAVITY_MODEL = os.getenv("ANTIGRAVITY_MODEL", "gemini-2.0-flash")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# Database & Supabase Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

# SMS Gateway Provider ('textbee' or 'twilio')
SMS_GATEWAY = os.getenv("SMS_GATEWAY", "textbee").lower()

# TextBee Android SMS Gateway Settings
TEXTBEE_API_KEY = os.getenv("TEXTBEE_API_KEY", "")
TEXTBEE_DEVICE_ID = os.getenv("TEXTBEE_DEVICE_ID", "")
TEXTBEE_BASE_URL = os.getenv("TEXTBEE_BASE_URL", "https://api.textbee.dev/api/v1")

# Twilio SMS / MMS Webhooks (Alternative Gateway)
TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.getenv("TWILIO_PHONE_NUMBER", "+19165468537")

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Business Contact Info
BUSINESS_NAME = "Go Fetch, Gizmo!"
BUSINESS_PHONE = "(916) 546-8537"
BUSINESS_EMAIL = "brandon@gofetchgizmo.com"
BUSINESS_LOCATION = "Citrus Heights, CA"
WEBSITE_URL = "https://gofetchgizmo.com"

# Service Areas (Sacramento & Placer County)
TARGET_ZIPS = {
    "95610": "Citrus Heights",
    "95621": "Citrus Heights",
    "95608": "Carmichael",
    "95628": "Fair Oaks",
    "95670": "Rancho Cordova",
    "95661": "Roseville",
    "95678": "Roseville",
    "95630": "Folsom",
    "95825": "Sacramento / Arden-Arcade",
    "95841": "Sacramento / Foothill Farms",
    "95842": "Sacramento / North Highlands",
    "95864": "Sacramento / Sierra Oaks",
}

# Pricing Tiers (Standard junk hauling load fractions)
PRICING_TIERS = {
    "terrier": {
        "name": "The Terrier",
        "emoji": "🐾",
        "subtitle": "Minimum Load / Single Items",
        "fraction": "1/4 Truck or Single Item",
        "min_price": 90,
        "max_price": 120,
        "description": "Single piece of furniture, a few boxes, or small yard debris pile.",
    },
    "retriever": {
        "name": "The Retriever",
        "emoji": "🐕",
        "subtitle": "Half Truck Load",
        "fraction": "1/2 Truck Load",
        "min_price": 150,
        "max_price": 180,
        "description": "Garage cleanout essentials, mattress + dresser, large yard waste pile.",
        "featured": True,
    },
    "great_dane": {
        "name": "The Great Dane",
        "emoji": "🦮",
        "subtitle": "Full Truck Load",
        "fraction": "Full Truck Load",
        "min_price": 195,
        "max_price": 250,
        "description": "Multi-room cleanouts, major hauls, estate junk, or massive pile.",
    },
}

# Standby Discount Policy
STANDBY_DISCOUNT_AMOUNT = 20  # $20 off for flexible route scheduling

# Special Item Surcharges (Disposal fees at Kiefer / transfer station)
SPECIAL_SURCHARGES = {
    "mattress": 30,      # Mattress recycling fee
    "refrigerator": 40,  # Freon extraction fee
    "tire": 15,          # Tire disposal fee
    "paint_hazardous": 0,# We do not take hazardous materials
    "concrete_dirt": 50, # Heavy dense material surcharge (weight limit)
}

# Vision AI Estimator Prompt
VISION_ESTIMATION_PROMPT = """
You are Gizmo, the expert junk hauling estimation AI for "Go Fetch, Gizmo!", a high-rated local junk removal service in Citrus Heights & Sacramento, CA.

Your job is to analyze the user's uploaded photo(s) of their junk, clutter, or debris and calculate a reliable, transparent price estimate.

Business Pricing Model:
1. The Terrier (Minimum Load / 1-3 small items / ~1-2 cubic yards): $90 - $120
2. The Retriever (Half Truck Load / ~4-7 cubic yards / garage corner / mattress+dresser): $150 - $180
3. The Great Dane (Full Truck Load / ~10-14 cubic yards / full garage or estate cleanout): $195 - $250

Special conditions to watch for:
- Dense heavy materials (concrete, dirt, rock, tile): add $40-$60 heavy weight surcharge.
- Refrigerators/Freezers (freon): add $40 disposal fee.
- Mattresses/Box springs: add $30 state recycling fee.
- Hazardous liquids/wet paint: state that we cannot haul hazardous waste.

Analyze the image(s) and return ONLY a valid JSON object matching this schema:
{
  "summary": "Short 1-sentence friendly description of what is seen in the photo",
  "identified_items": ["item 1", "item 2", "item 3"],
  "estimated_cubic_yards": float,
  "recommended_tier": "terrier" | "retriever" | "great_dane",
  "tier_name": "The Terrier" | "The Retriever" | "The Great Dane",
  "tier_emoji": "🐾" | "🐕" | "🦮",
  "price_min": int,
  "price_max": int,
  "standby_price_min": int,
  "standby_price_max": int,
  "special_notes": "Any notes regarding stairs, heavy items, or hazardous restrictions (or empty string)",
  "gizmo_comment": "A witty, warm 1-sentence comment from Gizmo the dog (e.g. 'Woof! That old recliner won\\'t stand a chance. We\\'ll have your garage cleared out in 20 minutes!')"
}
"""
