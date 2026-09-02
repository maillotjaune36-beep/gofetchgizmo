"""
Go Fetch, Gizmo! - B2B Copywriter Engine
Crafts personalized, 3-sentence high-converting B2B partnership emails.
"""
from typing import Dict, Any

def generate_b2b_pitch(prospect: Dict[str, Any]) -> Dict[str, str]:
    """
    Generates subject line and email body tailored to the prospect's category.
    """
    company = prospect.get("company_name", "your team")
    contact = prospect.get("contact_name", "there")
    category = prospect.get("category", "property_manager")
    city = prospect.get("city", "Citrus Heights")

    if category == "property_manager":
        subject = f"Tenant turnover cleanouts for {company} (Same-Day / Local in {city})"
        body = f"""Hi {contact},

I run Go Fetch, Gizmo! — a local hauling and cleanout service based right here in {city}.

When tenants leave couches, mattresses, or bulk trash behind during turnover, we handle same-day clearouts at flat rates that are roughly 30–40% lower than 1-800-Got-Junk, with instant before/after photo invoices for deposit deductions.

Do you have any units currently in turnover that need a quick haul-away this week?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com
"""
    elif category == "realtor":
        subject = f"Pre-listing cleanouts & estate junk removal in {city} (Go Fetch Gizmo)"
        body = f"""Hi {contact},

I'm Brandon, a local resident and owner of Go Fetch, Gizmo! hauling in {city}.

We help local listing agents clear out cluttered garages, estate cleanouts, and bulky furniture before photos and open houses — often with same-day dispatch and flat rates.

If you have any upcoming listings that need quick de-cluttering before hitting the market, can I send you our 1-page vendor rate card?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com
"""
    elif category == "storage":
        subject = f"Abandoned locker cleanouts for {company}"
        body = f"""Hi {contact},

I run Go Fetch, Gizmo! local hauling in {city}.

When auction buyers leave remnant trash behind or you have abandoned delinquent units that need fast clearing, we clear and sweep them out same-day so you can get them rented immediately.

Would it help to have us on standby as your reliable local cleanout vendor?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com
"""
    else:
        subject = f"Reliable local hauling & cleanout support in {city}"
        body = f"""Hi {contact},

I run Go Fetch, Gizmo! hauling in {city}. We provide fast, flat-rate junk removal, yard waste, and debris hauling for local businesses with same-day turnaround.

If you ever need bulky items or cleanout work handled quickly, feel free to text a photo to (916) 546-8537 for an instant quote.

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo!
"""

    return {
        "subject": subject,
        "body": body
    }

if __name__ == "__main__":
    sample = {
        "company_name": "Sacramento PM Pros",
        "contact_name": "Dave",
        "category": "property_manager",
        "city": "Citrus Heights"
    }
    pitch = generate_b2b_pitch(sample)
    print("SUBJECT:", pitch["subject"])
    print("\nBODY:\n", pitch["body"])
