"""
Go Fetch, Gizmo! - Autonomous Craigslist & Classifieds Signal Scout
Monitors Sacramento Craigslist for Curb Alerts, Rental Vacancies, and Hauling Gigs.
"""
import re
import sys
import time
import logging
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional
import requests
from bs4 import BeautifulSoup

# Ensure project root is in path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from engine.classifieds_copy import generate_pitch

logger = logging.getLogger("classifieds_scout")

# Target Local Suburbs & Zips for Go Fetch, Gizmo! (Citrus Heights base)
TARGET_LOCATIONS = [
    "citrus heights", "roseville", "carmichael", "fair oaks", "rancho cordova",
    "folsom", "sacramento", "orangevale", "antelope", "north highlands",
    "rocklin", "granite bay", "arden", "foothill farms"
]

TARGET_ZIPS = [
    "95610", "95621", "95628", "95608", "95670", "95661", "95678", 
    "95747", "95662", "95841", "95842", "95821", "95825", "95864"
]

SEARCH_CONFIGS = [
    {
        "category": "curb_alert",
        "name": "Curb Alerts & Bulky Free Junk",
        "url": "https://www.craigslist.org/search/area/sacramento?cat=zip&query=curb+alert|couch|furniture|yard|debris|cleanout",
        "fallback_rss": "https://sacramento.craigslist.org/search/zip?format=rss&query=curb+alert|couch|furniture|yard|debris|cleanout"
    },
    {
        "category": "landlord_vacancy",
        "name": "Rental Vacancies & Turnover Cleanouts",
        "url": "https://www.craigslist.org/search/area/sacramento?cat=apa&query=citrus+heights|roseville|carmichael|fair+oaks|rancho+cordova",
        "fallback_rss": "https://sacramento.craigslist.org/search/apa?format=rss&query=citrus+heights|roseville|carmichael|fair+oaks|rancho+cordova"
    },
    {
        "category": "hauling_gig",
        "name": "Labor & Hauling Gigs",
        "url": "https://www.craigslist.org/search/area/sacramento?cat=lbs&query=haul|junk|moving|trash|dump",
        "fallback_rss": "https://sacramento.craigslist.org/search/lbs?format=rss&query=haul|junk|moving|trash|dump"
    }
]

def get_scout_session() -> requests.Session:
    """Creates a browser-mimicking session with session cookies initialized."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://sacramento.craigslist.org/"
    })
    try:
        session.get("https://sacramento.craigslist.org/", timeout=8)
    except Exception as e:
        logger.warning(f"Could not initialize session cookies: {e}")
    return session

def is_local_signal(title: str, location: str, snippet: str = "") -> bool:
    """Checks if listing title, location, or snippet matches local service areas."""
    combined = f"{title} {location} {snippet}".lower()
    for loc in TARGET_LOCATIONS:
        if loc in combined:
            return True
    for zip_code in TARGET_ZIPS:
        if zip_code in combined:
            return True
    return True # Default to True for broader Sacramento catchment

def parse_html_search_results(html_text: str, category: str) -> List[Dict[str, Any]]:
    """Parses Craigslist search results HTML structure into normalized signal objects."""
    soup = BeautifulSoup(html_text, "html.parser")
    results = []

    listings = soup.select(".cl-search-result, .result-node, li.cl-static-search-result, li[data-pid]")
    for item in listings:
        title_el = item.select_one(".title, a.cl-app-anchor, a[href]")
        if not title_el:
            continue
            
        title = title_el.get_text(strip=True)
        link = title_el.get("href", "")
        if link.startswith("/"):
            link = f"https://sacramento.craigslist.org{link}"

        # Location extraction
        loc_el = item.select_one(".location, .meta, .supertitle")
        raw_loc = loc_el.get_text(strip=True) if loc_el else ""
        clean_loc = re.sub(r"^[(\s]+|[)\s]+$", "", raw_loc)
        if not clean_loc:
            # Infer location from title if present
            found_loc = next((loc.title() for loc in TARGET_LOCATIONS if loc in title.lower()), "Citrus Heights / Sacramento")
            clean_loc = found_loc

        # Unique Post ID
        pid = item.get("data-pid")
        if not pid and link:
            parts = link.rstrip("/").split("/")
            pid = parts[-1].replace(".html", "")
        if not pid:
            pid = f"cl_{abs(hash(link))}"

        # Clean snippet
        snippet_el = item.select_one(".snippet, .description")
        snippet = snippet_el.get_text(strip=True) if snippet_el else title

        # Generate Tailored 1-Click Pitch
        pitch = generate_pitch(category, title, clean_loc, snippet)

        results.append({
            "cl_post_id": str(pid),
            "category": category,
            "title": title,
            "url": link,
            "location": clean_loc,
            "snippet": snippet,
            "suggested_pitch": pitch,
            "status": "new",
            "published_at": datetime.now().isoformat()
        })

    return results

def scout_category(session: requests.Session, config: Dict[str, str], max_items: int = 20) -> List[Dict[str, Any]]:
    """Scouts a single Craigslist category feed."""
    cat = config["category"]
    url = config["url"]
    logger.info(f"Scouting {config['name']} at {url}")

    try:
        res = session.get(url, timeout=12)
        if res.status_code == 200:
            parsed = parse_html_search_results(res.text, cat)
            filtered = [s for s in parsed if is_local_signal(s["title"], s["location"], s["snippet"])]
            return filtered[:max_items]
        else:
            logger.warning(f"Craigslist returned status {res.status_code} for {url}")
    except Exception as e:
        logger.error(f"Error scouting category {cat}: {e}")

    return []

def scout_all_signals(save_to_db: bool = True, max_per_cat: int = 15) -> List[Dict[str, Any]]:
    """
    Runs the full classifieds scout across all 3 strategic categories:
      1. Curb Alerts
      2. Landlord Vacancies
      3. Hauling Gigs
    Deduplicates against the database and saves newly identified signals.
    """
    session = get_scout_session()
    all_new_signals = []

    # Import db helper lazily to prevent circular imports
    try:
        from data.db import signal_exists, save_classified_signal
    except ImportError:
        signal_exists = None
        save_classified_signal = None

    for config in SEARCH_CONFIGS:
        category_signals = scout_category(session, config, max_items=max_per_cat)
        
        for sig in category_signals:
            pid = sig["cl_post_id"]
            if signal_exists and signal_exists(pid):
                continue

            if save_to_db and save_classified_signal:
                sig_id = save_classified_signal(sig)
                sig["id"] = sig_id

            all_new_signals.append(sig)
        
        # Brief throttle between categories
        time.sleep(0.5)

    return all_new_signals

if __name__ == "__main__":
    import sys
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    print("🎯 Testing Craigslist Signal Scout for Go Fetch, Gizmo!...")
    signals = scout_all_signals(save_to_db=False, max_per_cat=3)
    print(f"✅ Scouted {len(signals)} local signals!")
    for s in signals:
        print(f"\n[{s['category'].upper()}] {s['title']}")
        print(f"📍 Location: {s['location']} | Link: {s['url']}")
        print(f"💬 Pitch: {s['suggested_pitch']}")
