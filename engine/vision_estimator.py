"""
Go Fetch, Gizmo! - AI Vision Estimator Engine
Analyzes junk photos using Google Antigravity SDK (Vertex AI / ADC keyless auth)
to calculate load volume, tier classification, and transparent flat-rate pricing.
"""
import os
import json
import base64
import asyncio
import concurrent.futures
import requests
from pathlib import Path
from typing import List, Dict, Any, Union, Optional
from pydantic import BaseModel, Field

from config import (
    GEMINI_API_KEY,
    ANTIGRAVITY_VERTEX,
    GOOGLE_CLOUD_PROJECT,
    GOOGLE_CLOUD_LOCATION,
    ANTIGRAVITY_MODEL,
    VISION_ESTIMATION_PROMPT,
    PRICING_TIERS,
    STANDBY_DISCOUNT_AMOUNT,
)

# Optional Antigravity SDK imports
try:
    from google.antigravity import Agent, LocalAgentConfig, from_file, from_bytes, Image
    ANTIGRAVITY_AVAILABLE = True
except ImportError:
    ANTIGRAVITY_AVAILABLE = False


class JunkEstimate(BaseModel):
    summary: str = Field(description="Short 1-sentence friendly description of what is seen in the photo")
    identified_items: List[str] = Field(description="List of identified junk and debris items")
    estimated_cubic_yards: float = Field(description="Estimated volume in cubic yards")
    recommended_tier: str = Field(description="Recommended tier: terrier, retriever, or great_dane")
    tier_name: str = Field(description="The Terrier, The Retriever, or The Great Dane")
    tier_emoji: str = Field(description="🐾, 🐕, or 🦮")
    price_min: int = Field(description="Estimated minimum price in USD")
    price_max: int = Field(description="Estimated maximum price in USD")
    standby_price_min: int = Field(description="Standby discount minimum price in USD")
    standby_price_max: int = Field(description="Standby discount maximum price in USD")
    special_notes: str = Field(default="", description="Notes regarding heavy weight, stairs, or hazardous restrictions")
    gizmo_comment: str = Field(description="A witty, warm 1-sentence comment from Gizmo the dog")


def encode_image_to_base64(image_path: Union[str, Path]) -> tuple[str, str]:
    """Read local file and return (mime_type, base64_string)"""
    path = Path(image_path)
    suffix = path.suffix.lower()
    mime_type = "image/jpeg"
    if suffix == ".png":
        mime_type = "image/png"
    elif suffix == ".webp":
        mime_type = "image/webp"
    elif suffix in [".heic", ".heif"]:
        mime_type = "image/heic"
        
    with open(path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return mime_type, data


async def async_estimate_junk_volume(
    image_inputs: List[Union[str, Path, bytes]],
    mime_types: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Asynchronous vision estimation using Antigravity SDK with keyless ADC / Vertex AI.
    Falls back gracefully to Gemini REST API or development heuristics.
    """
    # 1. Attempt Antigravity SDK estimation (Keyless ADC / Vertex AI or API key)
    if ANTIGRAVITY_AVAILABLE:
        try:
            return await _estimate_via_antigravity(image_inputs, mime_types)
        except Exception as e:
            print(f"[VisionEstimator] Antigravity SDK attempt note: {e}")

    # 2. Attempt Direct Gemini REST fallback if an API key is configured
    api_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    if api_key:
        try:
            return _estimate_via_gemini_rest(image_inputs, mime_types, api_key)
        except Exception as e:
            print(f"[VisionEstimator] Gemini REST fallback error: {e}")

    # 3. Development / Offline heuristic mock
    return get_mock_estimate()


async def _estimate_via_antigravity(
    image_inputs: List[Union[str, Path, bytes]],
    mime_types: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Internal runner using Google Antigravity Agent runtime"""
    media_objects = []
    
    for idx, item in enumerate(image_inputs):
        if isinstance(item, (str, Path)) and os.path.exists(str(item)):
            media_objects.append(from_file(str(item)))
        elif isinstance(item, bytes):
            mime = mime_types[idx] if mime_types and idx < len(mime_types) else "image/jpeg"
            media_objects.append(from_bytes(item, mime))
        elif isinstance(item, str) and item.startswith("data:image"):
            header, b64_str = item.split(",", 1)
            mime = header.split(";")[0].replace("data:", "")
            raw_bytes = base64.b64decode(b64_str)
            media_objects.append(from_bytes(raw_bytes, mime))

    if not media_objects:
        return get_mock_estimate()

    # Resolve GCP Project & Credentials
    gcp_project = GOOGLE_CLOUD_PROJECT or os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("GCP_PROJECT", "")
    api_key = GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "")
    model_name = ANTIGRAVITY_MODEL or os.getenv("ANTIGRAVITY_MODEL", "gemini-2.5-flash")

    if ANTIGRAVITY_VERTEX and gcp_project:
        config = LocalAgentConfig(
            system_instructions=VISION_ESTIMATION_PROMPT,
            vertex=True,
            project=gcp_project,
            location=GOOGLE_CLOUD_LOCATION,
            model=model_name
        )
    elif api_key:
        config = LocalAgentConfig(
            system_instructions=VISION_ESTIMATION_PROMPT,
            api_key=api_key,
            model=model_name
        )
    elif os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or gcp_project:
        config = LocalAgentConfig(
            system_instructions=VISION_ESTIMATION_PROMPT,
            vertex=True,
            project=gcp_project or None,
            location=GOOGLE_CLOUD_LOCATION,
            model=model_name
        )
    else:
        # If neither GCP project nor API key is configured yet, proceed to mock/fallback
        return get_mock_estimate()

    async with Agent(config) as agent:
        prompt_elements = [
            "Please analyze these junk load photos and return the structured estimation JSON directly.",
            *media_objects
        ]
        resp = await agent.chat(prompt_elements)
        full_text = ""
        async for token in resp:
            full_text += token

        # Clean markdown wrappers if present
        clean_text = full_text.strip()
        if "```json" in clean_text:
            clean_text = clean_text.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in clean_text:
            clean_text = clean_text.split("```", 1)[1].split("```", 1)[0]
        clean_text = clean_text.strip()

        try:
            data = json.loads(clean_text)
            return sanitize_estimation_result(data)
        except Exception as e:
            print(f"[VisionEstimator] JSON parsing error on live response: {e}")
            print(f"[VisionEstimator] Raw response was: {full_text[:300]}")
            return get_mock_estimate()


def _estimate_via_gemini_rest(
    image_inputs: List[Union[str, Path, bytes]],
    mime_types: Optional[List[str]],
    api_key: str
) -> Dict[str, Any]:
    """Direct REST fallback for standalone API keys"""
    parts = [{"text": VISION_ESTIMATION_PROMPT}]

    for idx, item in enumerate(image_inputs):
        if isinstance(item, (str, Path)) and os.path.exists(str(item)):
            mime, b64_str = encode_image_to_base64(item)
            parts.append({"inline_data": {"mime_type": mime, "data": b64_str}})
        elif isinstance(item, bytes):
            mime = mime_types[idx] if mime_types and idx < len(mime_types) else "image/jpeg"
            b64_str = base64.b64encode(item).decode("utf-8")
            parts.append({"inline_data": {"mime_type": mime, "data": b64_str}})
        elif isinstance(item, str) and item.startswith("data:image"):
            header, b64_str = item.split(",", 1)
            mime = header.split(";")[0].replace("data:", "")
            parts.append({"inline_data": {"mime_type": mime, "data": b64_str}})

    model_name = ANTIGRAVITY_MODEL or "gemini-2.0-flash"
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }

    response = requests.post(endpoint, json=payload, timeout=25)
    response.raise_for_status()
    data = response.json()
    raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
    result = json.loads(raw_text)
    return sanitize_estimation_result(result)


def estimate_junk_volume(
    image_inputs: List[Union[str, Path, bytes]],
    mime_types: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Synchronous estimation wrapper for webhooks, offline scripts, and CLI testing.
    Safely executes within or outside an active asyncio event loop.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor() as pool:
            return pool.submit(
                asyncio.run,
                async_estimate_junk_volume(image_inputs, mime_types)
            ).result()
    else:
        return asyncio.run(async_estimate_junk_volume(image_inputs, mime_types))


def sanitize_estimation_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    tier_key = str(raw.get("recommended_tier", "retriever")).lower().replace(" ", "_")
    if tier_key not in PRICING_TIERS:
        if "great" in tier_key or "dane" in tier_key or "full" in tier_key:
            tier_key = "great_dane"
        elif "terrier" in tier_key or "single" in tier_key or "min" in tier_key:
            tier_key = "terrier"
        else:
            tier_key = "retriever"
        
    tier_info = PRICING_TIERS[tier_key]
    
    price_min = raw.get("price_min", tier_info["min_price"])
    price_max = raw.get("price_max", tier_info["max_price"])
    
    standby_min = max(price_min - STANDBY_DISCOUNT_AMOUNT, 75)
    standby_max = max(price_max - STANDBY_DISCOUNT_AMOUNT, 90)

    return {
        "summary": raw.get("summary", "Household junk and clutter ready for removal."),
        "identified_items": raw.get("identified_items", ["Furniture / Household clutter"]),
        "estimated_cubic_yards": float(raw.get("estimated_cubic_yards", 5.0)),
        "recommended_tier": tier_key,
        "tier_name": tier_info["name"],
        "tier_emoji": tier_info["emoji"],
        "tier_subtitle": tier_info["subtitle"],
        "price_min": int(price_min),
        "price_max": int(price_max),
        "standby_price_min": int(standby_min),
        "standby_price_max": int(standby_max),
        "special_notes": raw.get("special_notes", ""),
        "gizmo_comment": raw.get("gizmo_comment", "Woof! We'll have this cleared out and swept clean before lunch! 🐾")
    }


def get_mock_estimate() -> Dict[str, Any]:
    """Realistic fallback estimate for testing and offline development"""
    tier_info = PRICING_TIERS["retriever"]
    return {
        "summary": "Assorted garage clutter, furniture piece, and boxed debris.",
        "identified_items": ["Old couch/armchair", "3x Cardboard moving boxes", "Wooden scrap items", "Plastic storage tote"],
        "estimated_cubic_yards": 4.5,
        "recommended_tier": "retriever",
        "tier_name": tier_info["name"],
        "tier_emoji": tier_info["emoji"],
        "tier_subtitle": tier_info["subtitle"],
        "price_min": 150,
        "price_max": 175,
        "standby_price_min": 130,
        "standby_price_max": 155,
        "special_notes": "Ground-level pickup assumed. Standby discount available for flexible scheduling.",
        "gizmo_comment": "Woof! Gizmo's sniffed it out: that's an easy half-truck load. We can fetch it today! 🐾"
    }


if __name__ == "__main__":
    print("Testing Vision Estimator Engine:")
    res = estimate_junk_volume([])
    print(json.dumps(res, indent=2))

