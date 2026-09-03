"""
Go Fetch, Gizmo! - Classifieds Outreach Copy & Pitch Engine
Generates tailored, high-converting 1-click outreach messages for Craigslist signals.
"""
import re
from typing import Optional

BUSINESS_PHONE = "(916) 546-8537"
OWNER_NAME = "Brandon"
COMPANY_NAME = "Go Fetch, Gizmo!"

def extract_item_from_title(title: str) -> str:
    """Extracts a clean, concise item description from a Craigslist post title."""
    clean = title
    # Strip common prefixes
    clean = re.sub(r"(?i)\*+\s*curb\s*alert\s*\*+", "", clean)
    clean = re.sub(r"(?i)curb\s*alert[:!\-\s]*", "", clean)
    clean = re.sub(r"(?i)free[:!\-\s]*", "", clean)
    clean = re.sub(r"\$[\d,]+", "", clean)
    # Strip city suffixes
    clean = re.sub(r"(?i)(citrus heights|sacramento|roseville|carmichael|fair oaks|folsom|orangevale|antelope)$", "", clean)
    clean = re.sub(r"[^\w\s\-/]", "", clean).strip()
    return clean if len(clean) > 2 else "item on the curb"

def generate_pitch(category: str, title: str, location: Optional[str] = None, snippet: Optional[str] = None) -> str:
    """
    Generates a tailored 1-click outreach pitch based on signal category.
    
    Categories:
      - curb_alert: People giving away bulky items/trash on the curb
      - landlord_vacancy: Landlords & property managers with turnover cleanout needs
      - hauling_gig: People actively looking for someone with a truck/labor
    """
    loc = location or "Citrus Heights"
    clean_item = extract_item_from_title(title)

    if category == "curb_alert":
        return (
            f"Hey! If nobody grabs that {clean_item} off the curb by this evening and you just want "
            f"it gone so the city doesn't cite you, I can swing by in my truck and haul it straight "
            f"to the transfer station for a quick $60–$80 neighbor flat rate. Text {OWNER_NAME} at "
            f"{BUSINESS_PHONE} if you want it cleared!"
        )

    elif category == "landlord_vacancy":
        loc_str = f"in {loc}" if loc else "in the neighborhood"
        return (
            f"Hi! Saw your rental listing {loc_str}. If the previous tenant left behind any "
            f"abandoned furniture, mattresses, or bulk trash during turnover, I run {COMPANY_NAME} "
            f"hauling here in Citrus Heights. We do same-day cleanouts with before/after photos for "
            f"deposit deductions. Text or call {OWNER_NAME} at {BUSINESS_PHONE} if you need anything cleared!"
        )

    elif category == "hauling_gig":
        return (
            f"Hey neighbor! {OWNER_NAME} with {COMPANY_NAME} here in Citrus Heights 🐾 I have my "
            f"truck ready and can haul that for you today at a fair flat rate. Text a photo to "
            f"{BUSINESS_PHONE} or call me directly!"
        )

    else:
        return (
            f"Hey neighbor! {OWNER_NAME} with {COMPANY_NAME} here in Citrus Heights 🐾 I have my "
            f"truck ready and can haul any unwanted items or debris for you at a fair flat rate. "
            f"Text or call {BUSINESS_PHONE} anytime!"
        )
