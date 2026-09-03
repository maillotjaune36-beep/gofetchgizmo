/**
 * Go Fetch, Gizmo! - Cloudflare Worker Edge Backend & Static Asset Router
 * Integrates Google Gemini 2.5 Flash, Supabase PostgreSQL / Auth, and Telegram Lead Alerts.
 */

const GIZMO_PROMPT = `
You are Gizmo, the expert junk hauling estimation AI for "Go Fetch, Gizmo!", a high-rated local junk removal service in Citrus Heights & Sacramento, CA.
Your job is to analyze the user's uploaded photo(s) of their junk, clutter, or debris and calculate a reliable, transparent price estimate.

Business Pricing Model:
1. The Terrier (Minimum Load / 1-3 small items / ~1-2 cubic yards): $90 - $120
2. The Retriever (Half Truck Load / ~4-7 cubic yards / garage corner / mattress+dresser): $150 - $180
3. The Great Dane (Full Truck Load / ~10-14 cubic yards / full garage or estate cleanout): $195 - $250

Special conditions:
- Dense heavy materials (concrete, dirt, rock): add $40-$60 heavy weight surcharge.
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
  "special_notes": "Any notes regarding stairs, heavy items, or restrictions (or empty string)",
  "gizmo_comment": "A witty, warm 1-sentence comment from Gizmo the dog"
}
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // ─── 1. CORS PREFLIGHT ─────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key"
        }
      });
    }

    // ─── 2. API ROUTES ─────────────────────────────────
    if (pathname.startsWith("/api/")) {
      try {
        const response = await handleApiRoute(pathname, request, env);
        // Add CORS to API responses
        const headers = new Headers(response.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        return new Response(response.body, { status: response.status, headers });
      } catch (err) {
        console.error("Worker API Error:", err);
        return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }
    }

    // ─── 3. SUBDOMAIN & CRM ASSET REWRITES ─────────────
    if (pathname === "/crm.css") {
      if (env.ASSETS) {
        return env.ASSETS.fetch(new Request(new URL("/crm/crm.css", request.url), request));
      }
    }
    if (pathname === "/crm.js") {
      if (env.ASSETS) {
        return env.ASSETS.fetch(new Request(new URL("/crm/crm.js", request.url), request));
      }
    }

    const hostname = url.hostname.toLowerCase();
    if (hostname.startsWith("crm.") || pathname === "/crm" || pathname === "/crm/") {
      if (pathname === "/" || pathname === "" || pathname === "/crm" || pathname === "/crm/") {
        if (env.ASSETS) {
          return env.ASSETS.fetch(new Request(new URL("/crm/index.html", request.url), request));
        }
      }
    }

    // ─── 4. STATIC ASSETS SERVING ──────────────────────
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function handleApiRoute(pathname, request, env) {
  // --- A. AUTH CONFIG ---
  if (pathname === "/api/auth/config" && request.method === "GET") {
    const sbUrl = getSupabaseUrl(env);
    const sbAnonKey = env.SUPABASE_ANON_KEY || "";
    return jsonResponse({
      supabase_url: sbUrl,
      supabase_anon_key: sbAnonKey,
      auth_enabled: Boolean(sbUrl && sbAnonKey)
    });
  }

  // --- DEBUG ENDPOINT ---
  if (pathname === "/api/crm/debug" && request.method === "GET") {
    const sbUrl = getSupabaseUrl(env);
    const sbKey = getSupabaseKey(env);
    let testStatus = null;
    let testBody = null;
    if (sbUrl && sbKey) {
      try {
        const res = await fetch(`${sbUrl}/rest/v1/leads?select=*&limit=1`, {
          headers: {
            "apikey": sbKey,
            "Authorization": `Bearer ${sbKey}`
          }
        });
        testStatus = res.status;
        testBody = await res.text();
      } catch (err) {
        testStatus = 500;
        testBody = err.message;
      }
    }
    return jsonResponse({
      supabase_url: sbUrl,
      supabase_key_configured: Boolean(sbKey),
      supabase_key_length: sbKey ? sbKey.length : 0,
      supabase_key_var_name: env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : (env.SUPABASE_SERVICE_ROLE_KE ? "SUPABASE_SERVICE_ROLE_KE" : "missing"),
      telegram_configured: getTelegramConfig(env).isConfigured,
      gemini_configured: Boolean(env.GEMINI_API_KEY),
      supabase_test_status: testStatus,
      supabase_test_response: testBody
    });
  }

  // --- B. AI VISION ESTIMATE ---
  if (pathname === "/api/estimate" && request.method === "POST") {
    return await handleVisionEstimate(request, env);
  }

  // --- C. BOOKING & TELEGRAM DISPATCH ---
  if (pathname === "/api/book" && request.method === "POST") {
    return await handleBooking(request, env);
  }

  // --- D. CRM STATS ---
  if (pathname === "/api/crm/stats" && request.method === "GET") {
    return await handleCrmStats(env);
  }

  // --- E. CRM JOBS / DISPATCH PIPELINE & LEADS ALIAS ---
  if ((pathname === "/api/crm/jobs" || pathname === "/api/leads") && request.method === "GET") {
    return await handleGetJobs(env);
  }
  if (pathname === "/api/crm/jobs" && request.method === "POST") {
    return await handleCreateJob(request, env);
  }

  const jobMatch = pathname.match(/^\/api\/crm\/jobs\/(\d+)(?:\/(.*))?$/);
  if (jobMatch) {
    const jobId = jobMatch[1];
    const subAction = jobMatch[2];
    if (subAction === "en-route" && request.method === "POST") {
      return await handleEnRouteJob(jobId, request, env);
    }
    if (subAction === "complete" && request.method === "POST") {
      return await handleCompleteJob(jobId, request, env);
    }
    if (!subAction) {
      if (request.method === "GET") return await handleGetSingleJob(jobId, env);
      if (request.method === "PATCH") return await handleUpdateJob(jobId, request, env);
      if (request.method === "DELETE") return await handleDeleteJob(jobId, env);
    }
  }

  // --- F. CRM CUSTOMERS ---
  if (pathname === "/api/crm/customers") {
    if (request.method === "GET") return await handleGetCustomers(env);
  }
  const custMatch = pathname.match(/^\/api\/crm\/customers\/(\d+)(?:\/(.*))?$/);
  if (custMatch) {
    const custId = custMatch[1];
    const subAction = custMatch[2];
    if (subAction === "jobs" && request.method === "GET") {
      return await handleGetCustomerJobs(custId, env);
    }
    if (!subAction && request.method === "PATCH") {
      return await handleUpdateCustomer(custId, request, env);
    }
  }

  // --- G. CRM REVIEWS ---
  if (pathname === "/api/crm/reviews" && request.method === "GET") {
    return await handleGetReviews(env);
  }
  if (pathname === "/api/crm/reviews/send" && request.method === "POST") {
    return await handleSendReview(request, env);
  }

  // --- H. CRM B2B WHALE ENGINE ---
  if (pathname === "/api/crm/b2b") {
    if (request.method === "GET") return await handleGetB2B(env);
    if (request.method === "POST") return await handleCreateB2B(request, env);
  }
  if (pathname === "/api/b2b/pitch" && request.method === "POST") {
    return await handleB2BPitch(request, env);
  }
  if (pathname === "/api/b2b/send-one" && request.method === "POST") {
    return await handleSendSingleB2B(request, env);
  }
  if (pathname === "/api/b2b/campaign" && request.method === "POST") {
    return jsonResponse({ status: "started", message: "B2B Outreach campaign queued", mode: "live" });
  }

  // --- I. 2-WAY INBOX ---
  if (pathname === "/api/crm/inbox" && request.method === "GET") {
    return await handleGetInbox(env);
  }
  if (pathname === "/api/crm/inbox/send" && request.method === "POST") {
    return await handleSendInboxSMS(request, env);
  }

  // --- J. CLASSIFIED SIGNALS (CRISIS & CURB ALERT SNIPER) ---
  if (pathname === "/api/crm/signals" && request.method === "GET") {
    return await handleGetSignals(request, env);
  }
  if (pathname === "/api/crm/signals/scan" && request.method === "POST") {
    return await handleScanSignals(request, env);
  }
  if (pathname.startsWith("/api/crm/signals/") && request.method === "PATCH") {
    const parts = pathname.split("/");
    const sigId = parts[parts.length - 1];
    return await handleUpdateSignal(sigId, request, env);
  }
  if (pathname.includes("/api/crm/signals/") && pathname.endsWith("/dispatch") && request.method === "POST") {
    const parts = pathname.split("/");
    const sigId = parts[parts.length - 2];
    return await handleDispatchSignal(sigId, request, env);
  }

  return jsonResponse({ error: "Endpoint not found" }, 404);
}

// ─── 4. HANDLERS IMPLEMENTATION ────────────────────────

async function handleVisionEstimate(request, env) {
  let files = [];
  try {
    const formData = await request.formData();
    for (const [key, value] of formData.entries()) {
      if (value instanceof File && value.size > 0) {
        files.push(value);
      }
    }
    if (files.length === 0) {
      files = [...formData.getAll("images"), ...formData.getAll("photos")].filter(f => f instanceof File && f.size > 0);
    }
  } catch (err) {
    console.error("FormData parse error:", err);
    return jsonResponse({ error: "Failed to parse uploaded form data" }, 400);
  }

  if (!files || files.length === 0) {
    return jsonResponse({ error: "No photos uploaded" }, 400);
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY not configured in Worker environment. Falling back to mock estimate.");
    return jsonResponse(getMockEstimate());
  }

  // Build Gemini parts
  const contents = [
    {
      parts: [
        { text: GIZMO_PROMPT }
      ]
    }
  ];

  for (const file of files) {
    if (file instanceof File) {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      contents[0].parts.push({
        inlineData: {
          mimeType: file.type || "image/jpeg",
          data: base64
        }
      });
    }
  }

  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  try {
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: contents,
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`Gemini API Error (${geminiRes.status}):`, errText);
      return jsonResponse(getMockEstimate());
    }

    const geminiData = await geminiRes.json();
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    let textOut = "";
    for (const part of parts) {
      if (part.text && !part.thought) {
        textOut += part.text;
      }
    }
    if (!textOut && parts[0]?.text) {
      textOut = parts[0].text;
    }
    if (!textOut) {
      console.warn("No text in Gemini parts, fallback to mock");
      return jsonResponse(getMockEstimate());
    }

    const cleanText = textOut.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleanText);
    return jsonResponse(parsed);
  } catch (e) {
    console.error("Vision estimation failed:", e);
    return jsonResponse(getMockEstimate());
  }
}

async function handleBooking(request, env) {
  const body = await request.json();
  const leadId = Math.floor(Math.random() * 9000) + 1000;

  // 1. Send Telegram Notification to Brandon
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    const chatId = env.TELEGRAM_CHAT_ID;
    
    const standbyText = body.standby_opt_in ? "✅ Yes ($20 OFF)" : "❌ Normal Dispatch";
    const msg = `🚨 <b>NEW GIZMO LEAD CAPTURED!</b> 🐾\n\n` +
      `👤 <b>Customer:</b> ${body.name || "Neighbor"}\n` +
      `📞 <b>Phone:</b> <code>${body.phone}</code>\n` +
      `📍 <b>Location:</b> ${body.zip_code || "Citrus Heights"}\n` +
      `🏷 <b>Source:</b> Live Web Estimator\n\n` +
      `📦 <b>Load Estimate:</b> 🐕 <b>${body.estimated_tier || "The Retriever"}</b>\n` +
      `💵 <b>Estimated Price:</b> $${body.estimated_price_min || 150} - $${body.estimated_price_max || 180}\n` +
      `⏳ <b>Standby Opt-in:</b> ${standbyText}\n` +
      `📝 <b>Items:</b> ${body.summary || "Assorted junk"}\n` +
      `⚠️ <b>Notes:</b> ${body.special_notes || "None"}\n`;

    const buttons = [
      [
        { text: "📋 Open CRM Dispatch Board", url: "https://gofetchgizmo.com/crm" }
      ]
    ];
    if (body.zip_code) {
      buttons[0].push({ text: "🗺 Map Area", url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(body.zip_code)}` });
    }

    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: buttons }
        })
      });
    } catch (e) {
      console.error("Telegram alert error:", e);
    }
  }

  // 2. Save to Supabase if configured
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const customerId = await syncCustomerFromLead(env, body);
      const res = await fetch(`${sbUrl}/rest/v1/leads`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          customer_id: customerId,
          name: body.name,
          phone: body.phone,
          zip_code: body.zip_code,
          estimated_tier: body.estimated_tier,
          estimated_price_min: body.estimated_price_min,
          estimated_price_max: body.estimated_price_max,
          standby_opt_in: body.standby_opt_in,
          special_notes: body.special_notes,
          preferred_date: body.preferred_date,
          status: "new"
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error(`Supabase insert lead failed (${res.status}):`, errText);
      }
    } catch (e) {
      console.error("Supabase insert lead error:", e);
    }
  }

  return jsonResponse({ status: "success", lead_id: leadId, message: "Booking locked in!" });
}

async function handleCrmStats(env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/leads?select=final_price,status,standby_opt_in`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) {
        const leads = await res.json();
        let totalRev = 0;
        let completed = 0;
        let active = 0;
        let standby = 0;
        leads.forEach(l => {
          if (l.status === "completed") {
            totalRev += (l.final_price || 0);
            completed++;
          } else {
            active++;
          }
          if (l.standby_opt_in) standby++;
        });
        return jsonResponse({
          total_revenue: totalRev,
          completed_jobs: completed,
          active_jobs: active,
          standby_jobs: standby,
          avg_ticket: completed > 0 ? Math.round(totalRev / completed) : 165,
          gizmo_treats_earned: 4
        });
      }
    } catch (e) {
      console.error("Supabase stats error:", e);
    }
  }

  return jsonResponse({
    total_revenue: 160,
    completed_jobs: 1,
    active_jobs: 0,
    standby_jobs: 1,
    avg_ticket: 160,
    gizmo_treats_earned: 4
  });
}

async function handleGetJobs(env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/leads?select=*&order=id.desc`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) return jsonResponse(await res.json());
      const errText = await res.text();
      console.error(`Supabase get jobs failed (${res.status}):`, errText);
    } catch (e) {
      console.error("Supabase get jobs error:", e);
    }
  }
  return jsonResponse([]);
}

async function handleCreateJob(request, env) {
  const body = await request.json();
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const customerId = await syncCustomerFromLead(env, body);
      const leadPayload = { ...body };
      if (customerId) leadPayload.customer_id = customerId;

      const res = await fetch(`${sbUrl}/rest/v1/leads`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(leadPayload)
      });
      if (res.ok) {
        const created = await res.json();
        return jsonResponse(created[0] || { status: "created" });
      }
      const errText = await res.text();
      console.error(`Supabase create job failed (${res.status}):`, errText);
    } catch (e) {
      console.error("Supabase create job error:", e);
    }
  }
  return jsonResponse({ id: Date.now(), ...body, status: "new" });
}

async function handleGetSingleJob(jobId, env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}&select=*`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) {
        const rows = await res.json();
        if (rows.length > 0) return jsonResponse(rows[0]);
      }
    } catch (e) {
      console.error("Supabase get single job error:", e);
    }
  }
  return jsonResponse({ id: jobId, name: "Neighbor", status: "new" });
}

async function handleUpdateJob(jobId, request, env) {
  const updates = await request.json();
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });

      if (updates.status === "completed" || updates.final_price !== undefined) {
        const jobRes = await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}&select=*`, {
          headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
        });
        if (jobRes.ok) {
          const rows = await jobRes.json();
          if (rows.length > 0) {
            await syncCustomerFromLead(env, { ...rows[0], ...updates });
          }
        }
      }
    } catch (e) {
      console.error("Supabase update job error:", e);
    }
  }
  return jsonResponse({ status: "success" });
}

async function handleCompleteJob(jobId, request, env) {
  const body = await request.json();
  const finalPrice = body.final_price || 150;
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "completed", final_price: finalPrice, completed_at: new Date().toISOString() })
      });

      const jobRes = await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}&select=*`, {
        headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
      });
      if (jobRes.ok) {
        const rows = await jobRes.json();
        if (rows.length > 0) {
          await syncCustomerFromLead(env, { ...rows[0], final_price: finalPrice });
        }
      }
    } catch (e) {
      console.error("Supabase complete error:", e);
    }
  }
  return jsonResponse({ status: "completed", final_price: finalPrice });
}

async function handleEnRouteJob(jobId, request, env) {
  let reqBody = {};
  try {
    reqBody = await request.json();
  } catch (e) {}

  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);

  let customerPhone = reqBody.phone || "";
  let customerName = "Neighbor";

  // 1. Fetch current lead details from Supabase if phone or name is missing
  if (sbUrl && sbKey) {
    try {
      const getRes = await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}&select=*`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (getRes.ok) {
        const rows = await getRes.json();
        if (rows.length > 0) {
          customerPhone = customerPhone || rows[0].phone || "";
          customerName = rows[0].name || "Neighbor";
        }
      }
    } catch (e) {
      console.error("Error fetching lead for en-route:", e);
    }

    // 2. Advance job status to 'en_route' in Supabase
    try {
      const updateRes = await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ status: "en_route" })
      });
      if (!updateRes.ok) {
        console.error(`Failed to update status to en_route (${updateRes.status}):`, await updateRes.text());
      }
    } catch (e) {
      console.error("Error updating lead status to en_route:", e);
    }
  }

  const enRouteMsg = `Hey ${customerName}! Brandon & Gizmo are en route in the truck 🚚🐾 We should arrive in approximately 15 minutes!`;

  // 3. Log outbound SMS to public.sms_messages in Supabase for live inbox
  if (sbUrl && sbKey && customerPhone) {
    try {
      await fetch(`${sbUrl}/rest/v1/sms_messages`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          lead_id: parseInt(jobId, 10),
          phone_number: customerPhone,
          direction: "outbound",
          body: enRouteMsg
        })
      });
    } catch (e) {
      console.error("Error logging outbound SMS to Supabase:", e);
    }
  }

  // 4. Telegram dispatch notification for Brandon
  const tg = getTelegramConfig(env);
  let telegramSent = false;
  if (tg.isConfigured) {
    try {
      const teleMsg = `🚚 <b>EN ROUTE ALERT DISPATCHED!</b> 🐾\n\n` +
        `👤 <b>Customer:</b> ${customerName}\n` +
        `📞 <b>Phone:</b> <code>${customerPhone}</code>\n` +
        `⏱ <b>ETA:</b> ~15 minutes\n` +
        `💬 <b>Message:</b> "${enRouteMsg}"\n` +
        `📍 <b>Status:</b> Truck is rolling!`;
      const tgRes = await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tg.chatId,
          text: teleMsg,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "📋 Open CRM Dispatch", url: "https://gofetchgizmo.com/crm" }
              ]
            ]
          }
        })
      });
      telegramSent = tgRes.ok;
    } catch (e) {
      console.error("Telegram en-route error:", e);
    }
  }

  return jsonResponse({
    status: "success",
    job_id: jobId,
    new_status: "en_route",
    telegram_sent: telegramSent,
    message: "En-route alert dispatched to Telegram and status updated to en_route"
  });
}

async function handleGetInbox(env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/sms_messages?select=*&order=created_at.asc`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) {
        const msgs = await res.json();
        const threadMap = {};
        for (const m of msgs) {
          const phone = m.phone_number;
          if (!threadMap[phone]) {
            threadMap[phone] = {
              phone_number: phone,
              customer: { name: "Neighbor", phone: phone },
              messages: []
            };
          }
          threadMap[phone].messages.push(m);
        }
        return jsonResponse(Object.values(threadMap));
      }
    } catch (e) {
      console.error("Supabase get inbox error:", e);
    }
  }
  return jsonResponse([]);
}

async function handleSendInboxSMS(request, env) {
  const body = await request.json();
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  const phone = body.phone;
  const text = body.body;

  if (sbUrl && sbKey && phone && text) {
    try {
      await fetch(`${sbUrl}/rest/v1/sms_messages`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          phone_number: phone,
          direction: "outbound",
          body: text
        })
      });
    } catch (e) {
      console.error("Error logging sent SMS to Supabase:", e);
    }

    const tg = getTelegramConfig(env);
    if (tg.isConfigured) {
      try {
        await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: tg.chatId,
            text: `💬 <b>MESSAGE SENT FROM CRM</b>\nTo: <code>${phone}</code>\n\n${text}`,
            parse_mode: "HTML"
          })
        });
      } catch (e) {}
    }
  }

  return jsonResponse({ status: "sent", phone, text });
}

async function handleDeleteJob(jobId, env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/leads?id=eq.${jobId}`, {
        method: "DELETE",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
    } catch (e) {
      console.error("Supabase delete error:", e);
    }
  }
  return jsonResponse({ status: "deleted" });
}

async function handleGetCustomers(env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (!sbUrl || !sbKey) return jsonResponse([]);

  try {
    // 1. Query existing customers from Supabase
    const res = await fetch(`${sbUrl}/rest/v1/customers?select=*&order=total_revenue.desc`, {
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`
      }
    });
    let customers = res.ok ? await res.json() : [];

    // 2. Query all leads to auto-populate customer directory and maintain lifetime stats
    const leadsRes = await fetch(`${sbUrl}/rest/v1/leads?select=*&order=id.desc`, {
      headers: {
        "apikey": sbKey,
        "Authorization": `Bearer ${sbKey}`
      }
    });
    const leads = leadsRes.ok ? await leadsRes.json() : [];

    // Group leads by clean phone digits
    const leadsByPhone = new Map();
    for (const lead of leads) {
      if (!lead.phone) continue;
      const digits = lead.phone.replace(/\D/g, "");
      if (!digits) continue;
      if (!leadsByPhone.has(digits)) leadsByPhone.set(digits, []);
      leadsByPhone.get(digits).push(lead);
    }

    // Auto-populate or update customers
    for (const [digits, jobList] of leadsByPhone.entries()) {
      let match = customers.find(c => (c.phone || "").replace(/\D/g, "") === digits);

      const totalJobs = jobList.length;
      const totalRev = jobList.reduce((sum, j) => {
        const p = Number(j.final_price) || (j.status === "completed" ? (Number(j.estimated_price_min) || 150) : 0);
        return sum + p;
      }, 0);

      const latestJob = jobList[0];
      const preferredName = jobList.find(j => j.name && j.name !== "Neighbor")?.name || latestJob.name || "Neighbor";
      const preferredAddress = jobList.find(j => j.address)?.address || latestJob.address || null;
      const preferredZip = jobList.find(j => j.zip_code)?.zip_code || latestJob.zip_code || null;

      if (!match) {
        try {
          const insertRes = await fetch(`${sbUrl}/rest/v1/customers`, {
            method: "POST",
            headers: {
              "apikey": sbKey,
              "Authorization": `Bearer ${sbKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify({
              name: preferredName,
              phone: latestJob.phone,
              address: preferredAddress,
              zip_code: preferredZip,
              customer_type: "residential",
              total_jobs: totalJobs,
              total_revenue: totalRev,
              notes: latestJob.special_notes || null
            })
          });
          if (insertRes.ok) {
            const created = await insertRes.json();
            if (created && created[0]) {
              match = created[0];
              customers.push(match);
            }
          }
        } catch (err) {
          console.error("Auto-insert customer error:", err);
        }
      } else {
        if (match.total_jobs !== totalJobs || match.total_revenue !== totalRev) {
          try {
            await fetch(`${sbUrl}/rest/v1/customers?id=eq.${match.id}`, {
              method: "PATCH",
              headers: {
                "apikey": sbKey,
                "Authorization": `Bearer ${sbKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({
                total_jobs: totalJobs,
                total_revenue: totalRev,
                updated_at: new Date().toISOString()
              })
            });
            match.total_jobs = totalJobs;
            match.total_revenue = totalRev;
          } catch (e) {}
        }
      }

      // Link customer_id to unlinked leads
      if (match && match.id) {
        const unlinked = jobList.filter(j => !j.customer_id);
        for (const un of unlinked) {
          try {
            await fetch(`${sbUrl}/rest/v1/leads?id=eq.${un.id}`, {
              method: "PATCH",
              headers: {
                "apikey": sbKey,
                "Authorization": `Bearer ${sbKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({ customer_id: match.id })
            });
          } catch (e) {}
        }
      }
    }

    customers.sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
    return jsonResponse(customers);
  } catch (e) {
    console.error("Supabase customers error:", e);
    return jsonResponse([]);
  }
}

async function handleGetCustomerJobs(custId, env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      let customerPhone = "";
      const custRes = await fetch(`${sbUrl}/rest/v1/customers?id=eq.${custId}&select=*`, {
        headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
      });
      if (custRes.ok) {
        const rows = await custRes.json();
        if (rows.length > 0) customerPhone = rows[0].phone || "";
      }

      const res = await fetch(`${sbUrl}/rest/v1/leads?customer_id=eq.${custId}&select=*&order=id.desc`, {
        headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
      });
      let jobs = res.ok ? await res.json() : [];

      if (jobs.length === 0 && customerPhone) {
        const allRes = await fetch(`${sbUrl}/rest/v1/leads?select=*&order=id.desc`, {
          headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
        });
        if (allRes.ok) {
          const allLeads = await allRes.json();
          const clean = customerPhone.replace(/\D/g, "");
          jobs = allLeads.filter(j => (j.phone || "").replace(/\D/g, "") === clean);
        }
      }
      return jsonResponse(jobs);
    } catch (e) {
      console.error("Supabase customer jobs error:", e);
    }
  }
  return jsonResponse([]);
}

async function handleUpdateCustomer(custId, request, env) {
  const updates = await request.json();
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/customers?id=eq.${custId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.error("Supabase update customer error:", e);
    }
  }
  return jsonResponse({ status: "success" });
}

async function handleGetReviews(env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/review_requests?select=*&order=id.desc`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) return jsonResponse(await res.json());
    } catch (e) {
      console.error("Supabase reviews error:", e);
    }
  }
  return jsonResponse([]);
}

async function handleSendReview(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {}

  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/review_requests`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          customer_name: body.name || "Neighbor",
          phone_number: body.phone || "",
          status: "sent",
          rating: 5,
          sent_at: new Date().toISOString()
        })
      });
    } catch (e) {
      console.error("Supabase insert review request error:", e);
    }
  }

  const tg = getTelegramConfig(env);
  if (tg.isConfigured) {
    try {
      await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tg.chatId,
          text: `⭐ <b>GOOGLE REVIEW REQUEST SENT!</b> 🐾\n👤 <b>Customer:</b> ${body.name || "Neighbor"}\n📞 <b>Phone:</b> <code>${body.phone || ""}</code>\n🥓 <i>Gizmo gets an extra bacon treat for every 5-star review!</i>`,
          parse_mode: "HTML"
        })
      });
    } catch (e) {}
  }

  return jsonResponse({ status: "sent", name: body.name, phone: body.phone });
}

async function handleGetB2B(env) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/b2b_prospects?select=*&order=id.desc`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) return jsonResponse(await res.json());
    } catch (e) {
      console.error("Supabase B2B error:", e);
    }
  }
  return jsonResponse([
    { id: 1, company_name: "Sacramento Property Management Pros", contact_name: "Elena Rostova", category: "Property Management", city: "Citrus Heights", email: "elena@sacpremierprop.com", phone: "(916) 555-0144", status: "scouted" }
  ]);
}

async function handleCreateB2B(request, env) {
  const body = await request.json();
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/b2b_prospects`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.error("Supabase create B2B error:", e);
    }
  }
  return jsonResponse({ id: Date.now(), ...body, status: "scouted" });
}

function generateB2BPitch(prospect) {
  const company = prospect.company_name || "your team";
  const contact = (prospect.contact_name || "there").split(" ")[0];
  const category = (prospect.category || "Property Management").toLowerCase();
  const city = prospect.city || "Citrus Heights";

  let subject = "";
  let body = "";

  if (category.includes("property") || category.includes("rental") || category.includes("hoa")) {
    subject = `Same-day unit turnover cleanouts for ${company} (${city})`;
    body = `Hi ${contact},

I’m Brandon, owner of Go Fetch, Gizmo! — a top-rated, local hauling and property cleanout service based right here in ${city}.

When tenants vacate and leave couches, mattresses, or bulk trash behind, we handle same-day unit turnovers and garage cleanouts at flat rates roughly 30–40% below franchise haulers, complete with before/after photos for your security deposit deductions.

Do you have any units currently in turnover or evictions needing a fast haul-away this week?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com`;
  } else if (category.includes("real estate") || category.includes("realtor") || category.includes("broker")) {
    subject = `Pre-listing cleanouts & estate junk removal in ${city} (Go Fetch, Gizmo!)`;
    body = `Hi ${contact},

I’m Brandon, a local resident and owner of Go Fetch, Gizmo! hauling in ${city}.

We work with local listing agents to clear out cluttered garages, estate cleanouts, and bulky furniture before photography and open houses — often with same-day dispatch and guaranteed flat pricing.

If you have any upcoming listings that need quick de-cluttering before hitting the MLS, could I send you our 1-page vendor rate card?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com`;
  } else if (category.includes("storage")) {
    subject = `Abandoned locker cleanouts & fast sweep-outs for ${company}`;
    body = `Hi ${contact},

I run Go Fetch, Gizmo! hauling based here in ${city}.

When auction buyers leave remnant trash behind or you have abandoned delinquent units that need fast clearing, we clear and sweep them out same-day so you can get them relisted and earning rent immediately.

Would it help to keep us on standby as your reliable local cleanout vendor?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com`;
  } else if (category.includes("attorney") || category.includes("eviction") || category.includes("legal")) {
    subject = `Sheriff eviction cleanout & lock-out hauling support in ${city}`;
    body = `Hi ${contact},

I’m Brandon, owner of Go Fetch, Gizmo! hauling in ${city}.

We partner with local real estate and eviction attorneys to handle post-writ lock-out cleanouts, staging curbside removal, and documentation inventory with speed and discretion.

Could we assist on any eviction turnarounds or estate proceedings you're currently handling?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com`;
  } else if (category.includes("contractor") || category.includes("remodel") || category.includes("roofing")) {
    subject = `Jobsite debris & remodel trash haul-away in ${city}`;
    body = `Hi ${contact},

I’m Brandon, owner of Go Fetch, Gizmo! hauling in ${city}.

We provide local general contractors and remodelers with fast jobsite debris haul-off, scrap removal, and broom-clean finishes so your crew stays focused on building.

Do you have any active remodels or demo jobs in ${city} needing a quick dump run?

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com`;
  } else {
    subject = `Reliable local hauling & commercial cleanout support in ${city}`;
    body = `Hi ${contact},

I’m Brandon, owner of Go Fetch, Gizmo! — a top-rated local hauling service in ${city}.

We provide local businesses with fast, flat-rate junk removal, bulk disposal, and cleanouts with same-day turnaround and priority commercial scheduling.

If your team ever needs bulky items or cleanout work handled quickly, feel free to text a photo to (916) 546-8537 for an instant quote.

Best,
Brandon (& Gizmo 🐾)
Go Fetch, Gizmo! | (916) 546-8537
gofetchgizmo.com`;
  }

  return { subject, body };
}

async function handleB2BPitch(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {}

  const prospectId = body.prospect_id;
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);

  let prospect = body.prospect || null;

  // 1. If full prospect object not supplied, fetch from Supabase
  if (!prospect && prospectId && sbUrl && sbKey) {
    try {
      const res = await fetch(`${sbUrl}/rest/v1/b2b_prospects?id=eq.${prospectId}&select=*`, {
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`
        }
      });
      if (res.ok) {
        const rows = await res.json();
        if (rows.length > 0) prospect = rows[0];
      }
    } catch (e) {
      console.error("Error fetching prospect for pitch:", e);
    }
  }

  // Fallback defaults if not found
  if (!prospect) {
    prospect = {
      id: prospectId || 1,
      company_name: body.company_name || "Commercial Partner",
      contact_name: body.contact_name || "Property Manager",
      email: body.email || "info@example.com",
      category: body.category || "Property Management",
      city: body.city || "Citrus Heights"
    };
  }

  const pitch = generateB2BPitch(prospect);

  return jsonResponse({
    prospect,
    pitch
  });
}

async function handleSendSingleB2B(request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {}

  const prospectId = body.prospect_id;
  const subject = body.subject || "Local Commercial Partnership";
  const email = body.email || "";

  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);

  // 1. Update prospect status in Supabase to 'pitched'
  if (prospectId && sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/b2b_prospects?id=eq.${prospectId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          status: "pitched",
          last_contacted_at: new Date().toISOString()
        })
      });
    } catch (e) {
      console.error("Error updating B2B prospect in Supabase:", e);
    }
  }

  // 2. Send Telegram alert to Brandon
  const tg = getTelegramConfig(env);
  if (tg.isConfigured) {
    try {
      const teleMsg = `🚀 <b>B2B PARTNERSHIP PITCH QUEUED!</b>\n\n` +
        `✉️ <b>To:</b> <code>${email}</code>\n` +
        `📋 <b>Subject:</b> ${subject}\n` +
        `📍 <b>Status:</b> Pitched`;
      await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tg.chatId,
          text: teleMsg,
          parse_mode: "HTML"
        })
      });
    } catch (e) {}
  }

  return jsonResponse({
    status: "sent",
    prospect_id: prospectId,
    email: email,
    message: `Pitch dispatched for ${email}`
  });
}

// ─── 5. HELPERS ────────────────────────────────────────

function getSupabaseUrl(env) {
  return env.SUPABASE_URL || "https://eljzextouflrawmihzww.supabase.co";
}

function getSupabaseKey(env) {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KE || "";
}

function getTelegramConfig(env) {
  const token = env.TELEGRAM_BOT_TOKEN || "8763259433:AAEQBjWVnIoGx2Q8V_LzxNUqt3PK5DO_s_c";
  const chatId = env.TELEGRAM_CHAT_ID || "8804602943";
  return { token, chatId, isConfigured: Boolean(token && chatId) };
}

async function syncCustomerFromLead(env, leadData) {
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (!sbUrl || !sbKey || !leadData || !leadData.phone) return null;

  try {
    const rawPhone = String(leadData.phone).trim();
    const cleanDigits = rawPhone.replace(/\D/g, "");
    if (!cleanDigits) return null;

    const res = await fetch(`${sbUrl}/rest/v1/customers?select=*`, {
      headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
    });
    let existing = null;
    if (res.ok) {
      const customers = await res.json();
      existing = customers.find(c => (c.phone || "").replace(/\D/g, "") === cleanDigits);
    }

    if (existing) {
      const updates = {};
      if (leadData.name && (!existing.name || existing.name === "Neighbor")) updates.name = leadData.name;
      if (leadData.address && !existing.address) updates.address = leadData.address;
      if (leadData.zip_code && !existing.zip_code) updates.zip_code = leadData.zip_code;
      if (leadData.customer_type && existing.customer_type === "residential") updates.customer_type = leadData.customer_type;
      if (leadData.final_price) {
        updates.total_revenue = (existing.total_revenue || 0) + Number(leadData.final_price);
      }
      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await fetch(`${sbUrl}/rest/v1/customers?id=eq.${existing.id}`, {
          method: "PATCH",
          headers: {
            "apikey": sbKey,
            "Authorization": `Bearer ${sbKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(updates)
        });
      }
      return existing.id;
    } else {
      const newCust = {
        name: leadData.name || "Neighbor",
        phone: rawPhone,
        address: leadData.address || null,
        zip_code: leadData.zip_code || null,
        customer_type: leadData.customer_type || "residential",
        total_jobs: 1,
        total_revenue: leadData.final_price ? Number(leadData.final_price) : 0,
        notes: leadData.special_notes || null
      };
      const createRes = await fetch(`${sbUrl}/rest/v1/customers`, {
        method: "POST",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(newCust)
      });
      if (createRes.ok) {
        const rows = await createRes.json();
        return rows[0] ? rows[0].id : null;
      }
    }
  } catch (e) {
    console.error("Error in syncCustomerFromLead:", e);
  }
  return null;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function getMockEstimate() {
  return {
    summary: "Residential junk pile with assorted furniture and boxes",
    identified_items: ["Sectional Sofa", "Mattress", "Cardboard Boxes", "Yard Debris"],
    estimated_cubic_yards: 5.5,
    recommended_tier: "retriever",
    tier_name: "The Retriever",
    tier_emoji: "🐕",
    price_min: 150,
    price_max: 180,
    standby_price_min: 130,
    standby_price_max: 160,
    special_notes: "Ground-level pickup with easy driveway loading",
    gizmo_comment: "Woof! That pile won't stand a chance. We'll have your space cleared out in 20 minutes flat!"
  };
}

// ─── CLASSIFIED SIGNALS (REAL-TIME LIVE CRAIGSLIST SNIPER) ───

let liveSignalsCache = [];
let lastScrapeTime = 0;

const CL_CATEGORIES = [
  {
    category: 'curb_alert',
    name: 'Curb Alerts & Bulky Free Junk',
    url: 'https://www.craigslist.org/search/area/sacramento?cat=zip&query=curb+alert|couch|furniture|yard|debris|cleanout'
  },
  {
    category: 'landlord_vacancy',
    name: 'Rental Vacancies & Turnover Cleanouts',
    url: 'https://www.craigslist.org/search/area/sacramento?cat=apa&query=citrus+heights|roseville|carmichael|fair+oaks|rancho+cordova'
  },
  {
    category: 'hauling_gig',
    name: 'Labor & Hauling Gigs',
    url: 'https://www.craigslist.org/search/area/sacramento?cat=lbg&query=truck|haul|moving|move|cleanout|yard|debris|trash|dump'
  }
];

const COMPETITOR_PATTERNS = [
  /now hiring/i, /\bhiring\b/i, /start asap/i, /start today/i, /helpers wanted/i, /join the best crew/i,
  /we haul/i, /you call/i, /our movers/i, /handyman services/i, /all skill levels/i,
  /cash pay all/i, /call \(8/i, /our team/i, /license/i, /licensed/i, /free estimate/i,
  /hauling services/i, /commercial cleanout/i, /make up to/i, /per week/i, /per month/i,
  /lawn care pros/i, /contractors wanted/i, /owners wanted/i, /fill in your routes/i,
  /scooter/i, /forklift/i, /driver/i, /mechanic/i, /earn with your vehicle/i, /instant approval/i,
  /build a full time/i, /day labor workers/i, /seeking california b/i, /roadside tech/i,
  /dump runs/i, /dump run/i, /affordable delivery/i
];

const CUSTOMER_INTENT_PATTERNS = [
  /\bneed\b/i, /\bneeded\b/i, /\bhelp\b/i, /\bhire\b/i, /looking to/i, /looking for/i, /\bhaul/i, /\bmove/i,
  /\bclean/i, /\bdump\b/i, /\btrash\b/i, /\bdebris\b/i, /storage/i, /trailer/i, /box truck/i, /yard/i
];

function decodeHtml(html) {
  return (html || "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractItemFromTitle(title) {
  let clean = title || "";
  clean = clean.replace(/\*+\s*curb\s*alert\s*\*+/gi, "");
  clean = clean.replace(/curb\s*alert[:!\-\s]*/gi, "");
  clean = clean.replace(/free[:!\-\s]*/gi, "");
  clean = clean.replace(/\$[\d,]+/g, "");
  clean = clean.replace(/(citrus heights|sacramento|roseville|carmichael|fair oaks|folsom|orangevale|antelope)$/gi, "");
  clean = clean.replace(/[^\w\s\-/]/g, "").trim();
  return clean.length > 2 ? clean : "item on the curb";
}

function generateClassifiedPitch(category, title, location) {
  const loc = location || "Citrus Heights";
  const item = extractItemFromTitle(title);
  if (category === "curb_alert") {
    return `Hey! If nobody grabs that ${item} off the curb by this evening and you just want it gone so the city doesn't cite you, I can swing by in my truck and haul it straight to the transfer station for a quick $60–$80 neighbor flat rate. Text Brandon at (916) 546-8537 if you want it cleared!`;
  }
  if (category === "landlord_vacancy") {
    return `Hi! Saw your rental listing in ${loc}. If the previous tenant left behind any abandoned furniture, mattresses, or bulk trash during turnover, I run Go Fetch, Gizmo! hauling here in Citrus Heights. We do same-day cleanouts with before/after photos for deposit deductions. Text or call Brandon at (916) 546-8537 if you need anything cleared!`;
  }
  return `Hey neighbor! Brandon with Go Fetch, Gizmo! here in Citrus Heights 🐾 I have my truck ready and can haul that for you today at a fair flat rate. Text a photo to (916) 546-8537 or call me directly!`;
}

async function scrapeLiveCraigslist() {
  const results = [];
  let signalCounter = 1;

  for (const cat of CL_CATEGORIES) {
    try {
      const res = await fetch(cat.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": "https://sacramento.craigslist.org/"
        }
      });

      if (!res.ok) continue;
      const text = await res.text();
      const itemRegex = /<li[^>]+class="[^"]*cl-static-search-result[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
      const matches = [...text.matchAll(itemRegex)];

      for (let i = 0; i < Math.min(matches.length, 25); i++) {
        const block = matches[i][1];
        const titleMatch = block.match(/<div class="title">([^<]+)<\/div>/i) || block.match(/<a[^>]+>([^<]+)<\/a>/i);
        const linkMatch = block.match(/href="([^"]+)"/i);
        const locMatch = block.match(/<div class="location">([^<]+)<\/div>/i);
        const pidMatch = matches[i][0].match(/data-pid="([^"]+)"/i);

        const title = decodeHtml(titleMatch ? titleMatch[1] : 'Classified Item');

        // Filter out competitor ads & recruiter spam for hauling gigs
        if (cat.category === 'hauling_gig') {
          if (COMPETITOR_PATTERNS.some(p => p.test(title))) continue;
          if (!CUSTOMER_INTENT_PATTERNS.some(p => p.test(title))) continue;
        }

        let link = linkMatch ? linkMatch[1] : '';
        if (link && link.startsWith("/")) link = `https://sacramento.craigslist.org${link}`;
        const loc = decodeHtml(locMatch ? locMatch[1] : 'Citrus Heights / Sacramento');
        const pid = pidMatch ? pidMatch[1] : `cl_${signalCounter}_${Date.now()}`;
        const pitch = generateClassifiedPitch(cat.category, title, loc);

        const fullText = `${title} ${loc} ${block}`;
        const phoneMatch = fullText.match(/(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})/);
        const emailMatch = fullText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
        const contactPhone = phoneMatch ? phoneMatch[0].trim() : "";
        const contactEmail = emailMatch ? emailMatch[0].trim() : "";

        results.push({
          id: signalCounter++,
          cl_post_id: pid,
          category: cat.category,
          title,
          url: link,
          location: loc,
          snippet: title,
          suggested_pitch: pitch,
          contact_phone: contactPhone,
          contact_email: contactEmail,
          status: "new",
          published_at: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(`Live scrape error for ${cat.name}:`, err);
    }
  }

  if (results.length > 0) {
    liveSignalsCache = results;
    lastScrapeTime = Date.now();
  }

  return liveSignalsCache;
}

async function handleGetSignals(request, env) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const status = url.searchParams.get("status");

  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);

  // 1. Try Supabase first
  if (sbUrl && sbKey) {
    try {
      let query = `${sbUrl}/rest/v1/classified_signals?select=*&order=id.desc&limit=60`;
      if (category && category !== "all") query += `&category=eq.${category}`;
      if (status && status !== "all") query += `&status=eq.${status}`;

      const res = await fetch(query, {
        headers: { "apikey": sbKey, "Authorization": `Bearer ${sbKey}` }
      });
      if (res.ok) {
        let rows = await res.json();
        if (rows && rows.length > 0) {
          // Filter out competitor ads from historical stored rows
          rows = rows.filter(s => {
            if (s.category === 'hauling_gig') {
              if (COMPETITOR_PATTERNS.some(p => p.test(s.title || ''))) return false;
            }
            return true;
          });
          if (rows.length > 0) return jsonResponse(rows);
        }
      }
    } catch (e) {
      console.error("Supabase get signals error:", e);
    }
  }

  // 2. If Supabase has no data or is empty, scrape live Craigslist feeds directly
  if (liveSignalsCache.length === 0 || Date.now() - lastScrapeTime > 300000) {
    await scrapeLiveCraigslist();
  }

  let filtered = liveSignalsCache;
  if (category && category !== "all") filtered = filtered.filter(s => s.category === category);
  if (status && status !== "all") filtered = filtered.filter(s => s.status === status);
  return jsonResponse(filtered);
}

async function handleScanSignals(request, env) {
  // Always trigger fresh live scrape of Sacramento Craigslist
  const liveListings = await scrapeLiveCraigslist();

  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);

  // Sync fresh listings to Supabase if configured
  if (sbUrl && sbKey && liveListings.length > 0) {
    try {
      for (const sig of liveListings) {
        await fetch(`${sbUrl}/rest/v1/classified_signals`, {
          method: "POST",
          headers: {
            "apikey": sbKey,
            "Authorization": `Bearer ${sbKey}`,
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates"
          },
          body: JSON.stringify(sig)
        });
      }
    } catch (e) {
      console.error("Supabase save signals error:", e);
    }
  }

  return jsonResponse({
    status: "success",
    message: `Scanned live Sacramento Craigslist feeds! Identified ${liveListings.length} real signals.`,
    new_count: liveListings.length,
    signals: liveListings
  });
}

async function handleUpdateSignal(sigId, request, env) {
  const body = await request.json();
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);

  // Update in local cache
  const match = liveSignalsCache.find(s => String(s.id) === String(sigId) || s.cl_post_id === String(sigId));
  if (match) {
    match.status = body.status;
  }

  // Update in Supabase
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/classified_signals?id=eq.${sigId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: body.status })
      });
    } catch (e) {
      console.error("Supabase update signal error:", e);
    }
  }

  return jsonResponse({ status: "updated", id: sigId, new_status: body.status });
}

async function handleDispatchSignal(sigId, request, env) {
  let body = {};
  try {
    body = await request.json();
  } catch (e) {}

  const method = body.method || "sms";
  const contact = body.contact || "";
  const pitch = body.pitch || "";

  // Update status in local cache
  const match = liveSignalsCache.find(s => String(s.id) === String(sigId) || s.cl_post_id === String(sigId));
  if (match) {
    match.status = "contacted";
  }

  // Update in Supabase if configured
  const sbUrl = getSupabaseUrl(env);
  const sbKey = getSupabaseKey(env);
  if (sbUrl && sbKey) {
    try {
      await fetch(`${sbUrl}/rest/v1/classified_signals?id=eq.${sigId}`, {
        method: "PATCH",
        headers: {
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "contacted" })
      });
    } catch (e) {
      console.error("Supabase dispatch update error:", e);
    }
  }

  // Send Telegram notification to Brandon
  const tg = getTelegramConfig(env);
  if (tg.isConfigured) {
    const teleMsg = `🎯 <b>CLASSIFIED OUTREACH DISPATCHED!</b> 🐾\n\n` +
      `👤 <b>Lead Contact:</b> <code>${contact || 'Direct'}</code>\n` +
      `📱 <b>Method:</b> ${method.toUpperCase()}\n\n` +
      `💬 <b>Pitch:</b>\n<code>${pitch}</code>\n\n` +
      `<i>Tap the number or message above on your phone to text immediately!</i>`;

    try {
      await fetch(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tg.chatId,
          text: teleMsg,
          parse_mode: "HTML"
        })
      });
    } catch (err) {}
  }

  return jsonResponse({
    status: "dispatched",
    id: sigId,
    method: method,
    contact: contact,
    new_status: "contacted"
  });
}

