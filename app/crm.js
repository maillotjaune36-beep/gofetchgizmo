let supabaseClient = null;
let currentAuthUser = null;
let activeThreadPhone = null;

document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initKanbanDragAndDrop();
    initEventListeners();
    initCustomPopupHandlers();
    initAuthListeners();
    await initSupabaseAuth();
    loadDashboard();
    
    // Auto-poll every 6 seconds for real-time dispatch and SMS updates
    setInterval(loadDashboard, 6000);
});

// ─── 0. SUPABASE AUTHENTICATION SYSTEM ─────────────────
async function initSupabaseAuth() {
    try {
        const res = await fetch('/api/auth/config');
        const config = await res.json();
        
        if (config.auth_enabled && window.supabase) {
            supabaseClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
            
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session?.user) {
                setAuthenticatedUser(session.user);
            } else {
                showAuthModal();
            }

            supabaseClient.auth.onAuthStateChange((event, session) => {
                if (session?.user) {
                    setAuthenticatedUser(session.user);
                } else {
                    setUnauthenticatedUser();
                }
            });
        }
    } catch (e) {
        console.log("Supabase Auth offline, running in local mode.");
    }
}

function setAuthenticatedUser(user) {
    currentAuthUser = user;
    closeModal('modalSupabaseAuth');
    const profileBox = document.getElementById('authProfileBox');
    const emailSpan = document.getElementById('authUserEmail');
    if (profileBox && emailSpan) {
        emailSpan.innerText = user.email || 'Admin';
        profileBox.style.display = 'flex';
    }
}

function setUnauthenticatedUser() {
    currentAuthUser = null;
    const profileBox = document.getElementById('authProfileBox');
    if (profileBox) profileBox.style.display = 'none';
    if (supabaseClient) showAuthModal();
}

function showAuthModal() {
    const modal = document.getElementById('modalSupabaseAuth');
    if (modal) modal.style.display = 'flex';
}

function initAuthListeners() {
    const formAuth = document.getElementById('formSupabaseAuth');
    const btnMagic = document.getElementById('btnAuthMagicLink');
    const btnLogout = document.getElementById('btnAuthLogout');
    const statusMsg = document.getElementById('authStatusMsg');

    if (formAuth) {
        formAuth.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!supabaseClient) return;

            const email = document.getElementById('authEmail').value.trim();
            const password = document.getElementById('authPassword').value;
            statusMsg.style.display = 'block';
            statusMsg.innerText = 'Authenticating with Supabase...';

            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                statusMsg.innerText = `⚠️ ${error.message}`;
            } else {
                statusMsg.style.display = 'none';
                showToast('Welcome back, Brandon! 🐾', 'success');
            }
        });
    }

    if (btnMagic) {
        btnMagic.addEventListener('click', async () => {
            if (!supabaseClient) return;
            const email = document.getElementById('authEmail').value.trim();
            if (!email) {
                statusMsg.style.display = 'block';
                statusMsg.innerText = 'Please enter your email above.';
                return;
            }

            statusMsg.style.display = 'block';
            statusMsg.innerText = 'Sending magic login link...';

            const { error } = await supabaseClient.auth.signInWithOtp({ email });
            if (error) {
                statusMsg.innerText = `⚠️ ${error.message}`;
            } else {
                statusMsg.innerText = '✉️ Magic link sent to your email!';
            }
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            if (supabaseClient) {
                await supabaseClient.auth.signOut();
                showToast('Logged out of CRM.', 'info');
            }
        });
    }
}

// ─── 1. CUSTOM POPUP DIALOGS & TOAST SYSTEM ────────────
function showConfirm({ title = 'Confirm Action', message = 'Are you sure you want to proceed?', icon = '🐾', confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false }) {
    return new Promise((resolve) => {
        confirmResolve = resolve;

        const modal = document.getElementById('customConfirmModal');
        const box = document.getElementById('confirmDialogBox');
        const iconEl = document.getElementById('confirmDialogIcon');
        const titleEl = document.getElementById('confirmDialogTitle');
        const msgEl = document.getElementById('confirmDialogMsg');
        const btnOk = document.getElementById('confirmBtnOk');
        const btnCancel = document.getElementById('confirmBtnCancel');

        iconEl.innerText = icon;
        titleEl.innerText = title;
        msgEl.innerText = message;
        btnOk.innerText = confirmText;
        btnCancel.innerText = cancelText;

        if (isDanger) {
            box.classList.add('danger');
            btnOk.style.background = '#DC2626';
            btnOk.style.borderColor = '#DC2626';
        } else {
            box.classList.remove('danger');
            btnOk.style.background = 'var(--orange)';
            btnOk.style.borderColor = 'var(--orange)';
        }

        modal.style.display = 'flex';
    });
}

function showAlert({ title = 'Notice', message = 'Action completed.', icon = '🎉', btnText = 'Got It 🐾', type = 'info' }) {
    return new Promise((resolve) => {
        alertResolve = resolve;

        const modal = document.getElementById('customAlertModal');
        const box = document.getElementById('alertDialogBox');
        const iconEl = document.getElementById('alertDialogIcon');
        const titleEl = document.getElementById('alertDialogTitle');
        const msgEl = document.getElementById('alertDialogMsg');
        const btnOk = document.getElementById('alertBtnOk');

        iconEl.innerText = icon;
        titleEl.innerText = title;
        msgEl.innerText = message;
        btnOk.innerText = btnText;

        if (type === 'danger' || type === 'error') {
            box.classList.add('danger');
            box.classList.remove('success');
            btnOk.style.background = '#DC2626';
            btnOk.style.borderColor = '#DC2626';
        } else if (type === 'success') {
            box.classList.add('success');
            box.classList.remove('danger');
            btnOk.style.background = '#16A34A';
            btnOk.style.borderColor = '#16A34A';
        } else {
            box.classList.remove('danger', 'success');
            btnOk.style.background = 'var(--orange)';
            btnOk.style.borderColor = 'var(--orange)';
        }

        modal.style.display = 'flex';
    });
}

function showToast(message, type = 'success', customIcon = null) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `crm-toast ${type}`;

    let icon = customIcon;
    if (!icon) {
        if (type === 'success') icon = '✅';
        else if (type === 'error') icon = '⚠️';
        else if (type === 'gold') icon = '⭐';
        else icon = '🐾';
    }

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
    }, 3600);
}

function initCustomPopupHandlers() {
    const btnConfirmOk = document.getElementById('confirmBtnOk');
    const btnConfirmCancel = document.getElementById('confirmBtnCancel');
    const modalConfirm = document.getElementById('customConfirmModal');

    if (btnConfirmOk) {
        btnConfirmOk.addEventListener('click', () => {
            modalConfirm.style.display = 'none';
            if (confirmResolve) confirmResolve(true);
        });
    }

    if (btnConfirmCancel) {
        btnConfirmCancel.addEventListener('click', () => {
            modalConfirm.style.display = 'none';
            if (confirmResolve) confirmResolve(false);
        });
    }

    const btnAlertOk = document.getElementById('alertBtnOk');
    const modalAlert = document.getElementById('customAlertModal');

    if (btnAlertOk) {
        btnAlertOk.addEventListener('click', () => {
            modalAlert.style.display = 'none';
            if (alertResolve) alertResolve();
        });
    }
}

// ─── 2. NAVIGATION TABS ─────────────────────────────────
function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            const targetId = btn.dataset.tab;
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');
        });
    });
}

// ─── 3. EVENT LISTENERS INITIALIZER ────────────────────
function initEventListeners() {
    // Dispatch Board
    const btnManualLead = document.getElementById('btnManualLead');
    if (btnManualLead) btnManualLead.addEventListener('click', () => openModal('modalManualJob'));
    
    const formManualJob = document.getElementById('formManualJob');
    if (formManualJob) formManualJob.addEventListener('submit', handleCreateManualJob);

    const formEditJob = document.getElementById('formEditJob');
    if (formEditJob) formEditJob.addEventListener('submit', handleSaveJobEdit);

    const formCompleteJob = document.getElementById('formCompleteJob');
    if (formCompleteJob) formCompleteJob.addEventListener('submit', handleConfirmComplete);

    // SMS Inbox
    const chatComposer = document.getElementById('chatComposer');
    if (chatComposer) chatComposer.addEventListener('submit', handleSendSMS);

    const btnNewThread = document.getElementById('btnNewThread');
    if (btnNewThread) btnNewThread.addEventListener('click', () => openModal('modalNewThread'));

    const formNewThread = document.getElementById('formNewThread');
    if (formNewThread) formNewThread.addEventListener('submit', handleStartNewThread);

    // Customer Directory
    const custSearch = document.getElementById('custSearch');
    if (custSearch) custSearch.addEventListener('input', handleCustomerSearch);

    const formCustomerNotes = document.getElementById('formCustomerNotes');
    if (formCustomerNotes) formCustomerNotes.addEventListener('submit', handleSaveCustomerNotes);

    // Reviews
    const btnSaveReviewUrl = document.getElementById('btnSaveReviewUrl');
    if (btnSaveReviewUrl) {
        btnSaveReviewUrl.addEventListener('click', () => {
            const input = document.getElementById('cfgGoogleReviewUrl');
            const val = input ? input.value.trim() : '';
            if (val) {
                setGoogleReviewUrl(val);
                const fb = document.getElementById('reviewUrlFeedback');
                if (fb) {
                    fb.style.display = 'block';
                    setTimeout(() => { fb.style.display = 'none'; }, 4000);
                }
                showToast('Google Business review URL saved! ⭐', 'success');
            }
        });
    }

    const btnManualReview = document.getElementById('btnManualReview');
    if (btnManualReview) btnManualReview.addEventListener('click', () => openModal('modalSendReview'));

    const formSendReview = document.getElementById('formSendReview');
    if (formSendReview) formSendReview.addEventListener('submit', handleSendManualReview);

    const btnSendReviewEmail = document.getElementById('btnSendReviewEmail');
    if (btnSendReviewEmail) {
        btnSendReviewEmail.addEventListener('click', () => {
            const name = document.getElementById('srName').value.trim();
            const email = document.getElementById('srEmail') ? document.getElementById('srEmail').value.trim() : '';
            if (!email) {
                showToast('Please enter an email address for 1-Click Gmail dispatch', 'error');
                return;
            }
            const reviewUrl = getGoogleReviewUrl();
            closeModal('modalSendReview');
            sendReviewEmailDirect(name, email, reviewUrl);

            try {
                fetch('/api/crm/reviews/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name, email: email, review_url: reviewUrl })
                });
                fetchReviews();
                fetchStats();
            } catch (e) {}
        });
    }

    // B2B Whale Engine
    const btnLaunchB2B = document.getElementById('btnLaunchB2B');
    if (btnLaunchB2B) btnLaunchB2B.addEventListener('click', launchB2BOutbound);

    const btnAddB2B = document.getElementById('btnAddB2B');
    if (btnAddB2B) btnAddB2B.addEventListener('click', () => openModal('modalNewB2B'));

    const formNewB2B = document.getElementById('formNewB2B');
    if (formNewB2B) formNewB2B.addEventListener('submit', handleCreateB2B);

    const formSendB2BPitch = document.getElementById('formSendB2BPitch');
    if (formSendB2BPitch) formSendB2BPitch.addEventListener('submit', handleSendSingleB2BPitch);

    // Signal Sniper (Craigslist / Classifieds)
    const btnScanSignals = document.getElementById('btnScanSignals');
    if (btnScanSignals) btnScanSignals.addEventListener('click', handleScanSignals);

    const catFilterContainer = document.getElementById('signalCategoryFilters');
    if (catFilterContainer) {
        catFilterContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            catFilterContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeSignalCategory = btn.getAttribute('data-cat') || 'all';
            fetchSignals();
        });
    }

    const statusFilter = document.getElementById('signalStatusFilter');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            activeSignalStatus = e.target.value;
            fetchSignals();
        });
    }

    const signalSearch = document.getElementById('signalSearchInput');
    if (signalSearch) {
        signalSearch.addEventListener('input', () => {
            renderSignalsTable(cachedSignals);
        });
    }
}

// ─── 4. MASTER DASHBOARD LOADER ────────────────────────
async function loadDashboard() {
    await Promise.allSettled([
        fetchStats(),
        fetchJobs(),
        fetchInbox(),
        fetchCustomers(),
        fetchReviews(),
        fetchB2B(),
        fetchSignals()
    ]);
}

// ─── 5. KPI STATS ──────────────────────────────────────
async function fetchStats() {
    try {
        const res = await fetch('/api/crm/stats');
        const stats = await res.json();
        
        const elRev = document.getElementById('kpiRevenue');
        if (elRev) elRev.innerText = `$${(stats.total_revenue || 0).toLocaleString()}`;
        
        const elAct = document.getElementById('kpiActive');
        if (elAct) elAct.innerText = stats.active_jobs || 0;
        
        const elComp = document.getElementById('kpiCompleted');
        if (elComp) elComp.innerText = stats.completed_jobs || 0;
        
        const elAvg = document.getElementById('kpiAvgTicket');
        if (elAvg) elAvg.innerText = `$${stats.avg_ticket || 165}`;
        
        const elSb = document.getElementById('kpiStandby');
        if (elSb) elSb.innerText = stats.standby_jobs || 0;
        
        const elTreats = document.getElementById('kpiTreats');
        if (elTreats) elTreats.innerText = `🐶 ${stats.gizmo_treats_earned || 0}`;
        
        const elRevTreats = document.getElementById('revTreatsCount');
        if (elRevTreats) elRevTreats.innerText = `${stats.gizmo_treats_earned || 0} treats earned`;
    } catch (e) {
        console.error("Failed to load stats", e);
    }
}

// ─── 6. KANBAN DISPATCH PIPELINE & DRAG AND DROP ──────
function initKanbanDragAndDrop() {
    document.querySelectorAll('.kanban-col').forEach(col => {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            col.classList.add('drag-over');
        });

        col.addEventListener('dragleave', () => {
            col.classList.remove('drag-over');
        });

        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            col.classList.remove('drag-over');
            const targetStatus = col.dataset.status;
            
            if (draggedJobId && targetStatus) {
                if (targetStatus === 'completed') {
                    openCompleteModal(draggedJobId, 150);
                } else {
                    await updateJobStatus(draggedJobId, targetStatus);
                }
                draggedJobId = null;
            }
        });
    });
}

async function fetchJobs() {
    try {
        const res = await fetch('/api/crm/jobs');
        const jobs = await res.json();

        const statuses = ['new', 'quoted', 'scheduled', 'en_route', 'completed'];
        const counts = { new: 0, quoted: 0, scheduled: 0, en_route: 0, completed: 0 };
        const lists = {};

        statuses.forEach(s => {
            lists[s] = document.getElementById(`list-${s}`);
            if (lists[s]) lists[s].innerHTML = '';
        });

        jobs.forEach(job => {
            const st = job.status || 'new';
            if (counts[st] !== undefined) counts[st]++;

            if (lists[st]) {
                const card = createJobCard(job);
                lists[st].appendChild(card);
            }
        });

        statuses.forEach(s => {
            const countEl = document.getElementById(`count-${s}`);
            if (countEl) countEl.innerText = counts[s];
        });

    } catch (e) {
        console.error("Failed to load jobs", e);
    }
}

function createJobCard(job) {
    const el = document.createElement('div');
    el.className = 'job-card';
    el.setAttribute('draggable', 'true');

    el.addEventListener('dragstart', () => {
        draggedJobId = job.id;
    });

    const cleanPhone = (job.phone || '').replace(/\D/g, '');
    const priceDisplay = job.status === 'completed' 
        ? `$${job.final_price || job.estimated_price_min || 150}` 
        : `$${job.estimated_price_min || 150} - $${job.estimated_price_max || 180}`;

    const standbyHtml = job.standby_opt_in 
        ? `<span class="standby-tag">⚡ Standby ($20 Off)</span>` 
        : ``;

    let photosHtml = '';
    if (job.photos && job.photos.length > 0) {
        photosHtml = `<div class="card-photos">` + 
            job.photos.map(p => `<img src="${p}" class="card-thumb" onclick="event.stopPropagation(); openPhotoViewer('${p}')">`).join('') + 
            `</div>`;
    }

    // Action buttons depending on status
    let actionButtons = '';
    if (job.status === 'new') {
        actionButtons = `
            <button class="btn-card primary" onclick="event.stopPropagation(); updateJobStatus(${job.id}, 'quoted')">Quote</button>
            <button class="btn-card green" onclick="event.stopPropagation(); updateJobStatus(${job.id}, 'scheduled')">Schedule</button>
        `;
    } else if (job.status === 'quoted') {
        actionButtons = `
            <button class="btn-card primary" onclick="event.stopPropagation(); sendEnRouteSMS(${job.id}, '${job.phone}', '${(job.name || 'Neighbor').replace(/'/g, "\\'")}')">En Route 🚚</button>
            <button class="btn-card green" onclick="event.stopPropagation(); updateJobStatus(${job.id}, 'scheduled')">Schedule 📅</button>
        `;
    } else if (job.status === 'scheduled') {
        actionButtons = `
            <button class="btn-card primary" onclick="event.stopPropagation(); sendEnRouteSMS(${job.id}, '${job.phone}', '${(job.name || 'Neighbor').replace(/'/g, "\\'")}')">En Route 🚚</button>
            <button class="btn-card green" onclick="event.stopPropagation(); openCompleteModal(${job.id}, ${job.estimated_price_min || 150})">Complete ✅</button>
        `;
    } else if (job.status === 'en_route') {
        actionButtons = `
            <button class="btn-card green" onclick="event.stopPropagation(); openCompleteModal(${job.id}, ${job.estimated_price_min || 150})">Complete & Review ⭐</button>
        `;
    } else if (job.status === 'completed') {
        actionButtons = `
            <span style="font-size:0.75rem;color:var(--green);font-weight:700;display:block;text-align:center;width:100%">✅ Completed & Review Sent</span>
        `;
    }

    el.innerHTML = `
        <div class="job-card-top">
            <span class="job-customer-name">${job.name || 'Neighbor'}</span>
            <span class="job-tier-badge">${job.estimated_tier || 'The Retriever'}</span>
        </div>
        <div class="job-phone">
            📞 <a href="tel:${cleanPhone}" onclick="event.stopPropagation()" style="color:var(--text-muted);text-decoration:none">${job.phone}</a>
            <span style="margin-left:auto;cursor:pointer;color:var(--orange-light)" onclick="event.stopPropagation(); openNativeSMS('${job.phone}', 'Hey ${(job.name || 'Neighbor').split(' ')[0]}! Brandon here from Go Fetch, Gizmo! 🐾 ')">💬 Text</span>
        </div>
        <div class="job-loc">📍 ${job.address || job.zip_code || 'Citrus Heights / Sacramento'}</div>
        ${photosHtml}
        <div class="job-price-row">
            <span class="job-price">${priceDisplay}</span>
            ${standbyHtml}
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem">
            ${job.preferred_date ? `📅 ${job.preferred_date}` : ''} ${job.scheduled_time ? `⏰ ${job.scheduled_time}` : ''}
            ${job.special_notes ? `<div style="margin-top:2px;font-style:italic">"${job.special_notes}"</div>` : ''}
        </div>
        <div class="card-actions">
            ${actionButtons}
            <button class="btn-card" style="flex:0.6" onclick="event.stopPropagation(); openEditJobModal(${job.id})">Edit ⚙️</button>
        </div>
    `;

    el.addEventListener('click', () => openEditJobModal(job.id));

    return el;
}

function openNativeSMS(phone, message) {
    if (!phone) return;
    const cleanPhone = phone.replace(/\D/g, '');
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const separator = isIOS ? '&' : '?';
    const smsUrl = `sms:${cleanPhone}${separator}body=${encodeURIComponent(message || '')}`;

    // 1. Always copy text to clipboard as universal fallback
    if (navigator.clipboard) {
        navigator.clipboard.writeText(message || '').catch(() => {});
    }

    // 2. On Mobile, launch native SMS
    if (isMobile) {
        const a = document.createElement('a');
        a.href = smsUrl;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 400);
        return;
    }

    // 3. On Desktop: Windows doesn't always have a default 'sms:' protocol handler
    // Show Desktop SMS Hub prompt with 1-click options
    showDesktopSMSPrompt(cleanPhone, message);
}

function showDesktopSMSPrompt(phone, message) {
    const formattedPhone = phone.length === 10 ? `(${phone.slice(0,3)}) ${phone.slice(3,6)}-${phone.slice(6)}` : phone;

    showAlert({
        title: 'Outreach Beamed to Your Phone! 📲',
        message: `Your pitch for ${formattedPhone} was beamed directly to your Telegram bot and copied to your clipboard!\n\nOptions to send from PC:\n• Windows Phone Link: Search "Phone Link" on Windows\n• Google Messages Web: messages.google.com/web\n• Or open Telegram on your phone to tap & send instantly!`,
        icon: '📱',
        type: 'info'
    });
}

// ─── 7. UNIVERSAL 1-CLICK EMAIL DISPATCHER (gofetchgizmo@gmail.com) ───
const GIZMO_OUTREACH_EMAIL = 'gofetchgizmo@gmail.com';

function openOneClickEmail({ to, subject, body }) {
    if (!to) {
        showToast('Please provide a recipient email address', 'error');
        return false;
    }
    const cleanTo = to.trim();
    const encodedTo = encodeURIComponent(cleanTo);
    const encodedSubject = encodeURIComponent(subject || '');
    const encodedBody = encodeURIComponent(body || '');

    // Web Gmail Compose URL (direct 1-click in browser from gofetchgizmo@gmail.com)
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`;
    const mailtoUrl = `mailto:${encodedTo}?subject=${encodedSubject}&body=${encodedBody}`;

    // Try opening Gmail Web Compose in a new tab
    const win = window.open(gmailUrl, '_blank');
    if (!win || win.closed || typeof win.closed === 'undefined') {
        // Fallback to mailto if browser blocked popups
        window.location.href = mailtoUrl;
    }
    return true;
}

async function updateJobStatus(jobId, newStatus) {
    try {
        await fetch(`/api/crm/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        showToast(`Job status updated to ${newStatus.toUpperCase()}`, 'info');
        loadDashboard();
    } catch (e) {
        console.error(e);
    }
}

async function sendEnRouteSMS(jobId, phone, name) {
    const custName = (name || 'Neighbor').split(' ')[0];
    const textMsg = `Hey ${custName}! Brandon & Gizmo are en route in the truck 🚚🐾 We should arrive in approximately 15 minutes!`;

    const confirmed = await showConfirm({
        title: 'Dispatch En Route Alert?',
        message: `Advance job to "En Route" and open your Messages app with the 15-min text pre-filled for ${phone}?`,
        icon: '🚚',
        confirmText: 'Send Text 🚚',
        cancelText: 'Cancel'
    });
    
    if (!confirmed) return;

    try {
        // 1. Advance job status directly to 'en_route' in Supabase
        await fetch(`/api/crm/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'en_route' })
        });

        // 2. Dispatch Telegram alert to Brandon
        await fetch(`/api/crm/jobs/${jobId}/en-route`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, name: custName })
        });

        // 3. Trigger 1-Tap Native SMS
        openNativeSMS(phone, textMsg);

        showToast(`🚚 Opened Messages app for ${phone}!`, 'success');
        await loadDashboard();
    } catch (e) {
        showToast("Error dispatching en-route", "error");
    }
}

// ─── 8. MANUAL JOB CREATION & EDITING ──────────────────
async function handleCreateManualJob(e) {
    e.preventDefault();
    const payload = {
        name: document.getElementById('mjName').value.trim(),
        phone: document.getElementById('mjPhone').value.trim(),
        address: document.getElementById('mjAddress').value.trim(),
        zip_code: document.getElementById('mjZip').value.trim(),
        estimated_tier: document.getElementById('mjTier').value,
        estimated_price_min: parseInt(document.getElementById('mjPriceMin').value, 10),
        estimated_price_max: parseInt(document.getElementById('mjPriceMax').value, 10),
        preferred_date: document.getElementById('mjDate').value,
        scheduled_time: document.getElementById('mjTime').value.trim(),
        special_notes: document.getElementById('mjNotes').value.trim(),
        standby_opt_in: document.getElementById('mjStandby').checked,
        status: 'new'
    };

    try {
        const res = await fetch('/api/crm/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            closeModal('modalManualJob');
            document.getElementById('formManualJob').reset();
            showToast(`🐾 New hauling job created for ${payload.name}!`, 'success');
            loadDashboard();
        } else {
            showAlert({ title: 'Creation Failed', message: 'Could not create manual job record.', icon: '⚠️', type: 'error' });
        }
    } catch (err) {
        showAlert({ title: 'Network Error', message: 'Failed to connect to server.', icon: '⚠️', type: 'error' });
    }
}

async function openEditJobModal(jobId) {
    try {
        const res = await fetch(`/api/crm/jobs/${jobId}`);
        const job = await res.json();
        
        document.getElementById('editJobId').value = job.id;
        document.getElementById('ejName').value = job.name || '';
        document.getElementById('ejPhone').value = job.phone || '';
        document.getElementById('ejStatus').value = job.status || 'new';
        document.getElementById('ejAddress').value = job.address || job.zip_code || '';
        document.getElementById('ejTime').value = job.scheduled_time || '';
        document.getElementById('ejDate').value = job.preferred_date || '';
        document.getElementById('ejNotes').value = job.special_notes || '';

        const photosBox = document.getElementById('ejPhotosContainer');
        const photosList = document.getElementById('ejPhotosList');
        if (job.photos && job.photos.length > 0) {
            photosBox.style.display = 'block';
            photosList.innerHTML = job.photos.map(p => `
                <img src="${p}" style="width:70px;height:70px;border-radius:6px;object-fit:cover;cursor:pointer;border:1px solid var(--border)" onclick="openPhotoViewer('${p}')">
            `).join('');
        } else {
            photosBox.style.display = 'none';
        }

        openModal('modalEditJob');
    } catch (e) {
        console.error("Error opening edit modal", e);
    }
}

async function handleSaveJobEdit(e) {
    e.preventDefault();
    const jobId = document.getElementById('editJobId').value;
    const updates = {
        name: document.getElementById('ejName').value.trim(),
        phone: document.getElementById('ejPhone').value.trim(),
        status: document.getElementById('ejStatus').value,
        address: document.getElementById('ejAddress').value.trim(),
        scheduled_time: document.getElementById('ejTime').value.trim(),
        preferred_date: document.getElementById('ejDate').value,
        special_notes: document.getElementById('ejNotes').value.trim()
    };

    try {
        await fetch(`/api/crm/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        closeModal('modalEditJob');
        showToast('Job details updated successfully! ✅', 'success');
        loadDashboard();
    } catch (e) {
        showAlert({ title: 'Save Failed', message: 'Could not save job edits.', icon: '⚠️', type: 'error' });
    }
}

async function handleDeleteJob() {
    const jobId = document.getElementById('editJobId').value;
    const confirmed = await showConfirm({
        title: 'Delete Hauling Job?',
        message: 'Are you sure you want to permanently delete this job from the dispatch board?',
        icon: '🗑',
        confirmText: 'Yes, Delete',
        cancelText: 'Cancel',
        isDanger: true
    });

    if (!confirmed) return;

    try {
        await fetch(`/api/crm/jobs/${jobId}`, { method: 'DELETE' });
        closeModal('modalEditJob');
        showToast('Job removed from dispatch.', 'info');
        loadDashboard();
    } catch (e) {
        showAlert({ title: 'Delete Failed', message: 'Could not delete job record.', icon: '⚠️', type: 'error' });
    }
}

// ─── 9. JOB COMPLETION & REVIEW DISPATCH ───────────────
function openCompleteModal(jobId, defaultPrice) {
    document.getElementById('completeJobId').value = jobId;
    document.getElementById('finalPriceInput').value = defaultPrice || 150;
    openModal('modalComplete');
}

async function handleConfirmComplete(e) {
    e.preventDefault();
    const jobId = document.getElementById('completeJobId').value;
    const finalPrice = parseInt(document.getElementById('finalPriceInput').value, 10);

    try {
        await fetch(`/api/crm/jobs/${jobId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ final_price: finalPrice })
        });
        closeModal('modalComplete');

        const job = allJobs.find(j => String(j.id) === String(jobId));
        const custName = job && job.name ? job.name.split(' ')[0] : 'Neighbor';
        const custPhone = job ? job.phone : '';

        const sendReview = await showConfirm({
            title: 'Job Completed! 🎉',
            message: `Revenue logged ($${finalPrice})! Open your Messages app with the 5-Star Google Review text pre-filled for ${custName} (${custPhone})?`,
            icon: '🐕',
            confirmText: 'Send Review Text ⭐',
            cancelText: 'Done'
        });

        if (sendReview && custPhone) {
            const reviewUrl = getGoogleReviewUrl();
            const reviewMsg = `Hey ${custName}! Brandon here from Go Fetch, Gizmo! 🐾 Hope you're loving all that cleared-out space! If you have 15 seconds, could you drop Gizmo a quick 5-star Google review? ⭐⭐⭐⭐⭐ ${reviewUrl} (Gizmo gets an extra bacon treat for every 5-star review! 🐶🥓) Thanks again!`;
            openNativeSMS(custPhone, reviewMsg);

            // Log review request to database & Telegram
            try {
                fetch('/api/crm/reviews/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: custName, phone: custPhone, review_url: reviewUrl })
                });
            } catch (e) {}
        }

        loadDashboard();
    } catch (e) {
        showAlert({ title: 'Error Completing Job', message: 'Could not complete job record.', icon: '⚠️', type: 'error' });
    }
}

// ─── 10. 2-WAY LIVE SMS INBOX ──────────────────────────
async function fetchInbox() {
    try {
        const res = await fetch('/api/crm/inbox');
        const threads = await res.json();
        const listEl = document.getElementById('threadList');

        if (!listEl) return;

        if (threads.length === 0 && !activeThreadPhone) {
            listEl.innerHTML = '<div style="padding:1rem;color:var(--text-muted);text-align:center">No active SMS threads</div>';
            return;
        }

        listEl.innerHTML = '';
        threads.forEach(t => {
            const item = document.createElement('div');
            item.className = `thread-item ${activeThreadPhone === t.phone_number ? 'active' : ''}`;
            const custName = t.customer ? t.customer.name : 'Neighbor / Prospect';
            const lastMsg = t.messages.length > 0 ? t.messages[t.messages.length - 1].body : 'Photo or text';

            item.innerHTML = `
                <div class="thread-phone">${custName} (${t.phone_number})</div>
                <div class="thread-snippet">${lastMsg}</div>
            `;
            item.addEventListener('click', () => {
                activeThreadPhone = t.phone_number;
                renderChatThread(t);
                document.querySelectorAll('.thread-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
            });
            listEl.appendChild(item);
        });

        // Update active chat view if open
        if (activeThreadPhone) {
            const active = threads.find(t => t.phone_number === activeThreadPhone);
            if (active) {
                renderChatThread(active);
            }
        }
    } catch (e) {
        console.error("Inbox load error", e);
    }
}

function renderChatThread(thread) {
    const custName = thread.customer ? thread.customer.name : 'Prospect';
    document.getElementById('chatActiveContact').innerText = `${custName} (${thread.phone_number})`;
    document.getElementById('chatActivePhone').innerText = `Location: ${thread.customer ? thread.customer.zip_code || thread.customer.address : 'Citrus Heights / Sacramento'}`;

    const chatActions = document.getElementById('chatActions');
    chatActions.innerHTML = `
        <a href="tel:${thread.phone_number}" class="btn-card" style="padding:4px 10px;font-size:0.75rem">📞 Call</a>
    `;

    const bodyEl = document.getElementById('chatMessages');
    bodyEl.innerHTML = '';

    (thread.messages || []).forEach(m => {
        const bubble = document.createElement('div');
        bubble.className = `msg-bubble ${m.direction}`;

        let mediaHtml = '';
        if (m.media_urls && m.media_urls.length > 0) {
            mediaHtml = m.media_urls.map(url => `<img src="${url}" onclick="openPhotoViewer('${url}')" style="cursor:pointer">`).join('');
        }

        bubble.innerHTML = `
            <div>${m.body || ''}</div>
            ${mediaHtml}
        `;
        bodyEl.appendChild(bubble);
    });

    bodyEl.scrollTop = bodyEl.scrollHeight;
}

function applyPreset(text) {
    const input = document.getElementById('composerText');
    if (input) {
        input.value = text;
        input.focus();
    }
}

async function handleSendSMS(e) {
    e.preventDefault();
    if (!activeThreadPhone) {
        showToast('Please select or start a conversation thread first.', 'error');
        return;
    }
    const input = document.getElementById('composerText');
    const text = input.value.trim();
    if (!text) return;

    try {
        await fetch('/api/crm/inbox/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: activeThreadPhone, body: text })
        });
        openNativeSMS(activeThreadPhone, text);
        input.value = '';
        showToast('Opening Messages app... 💬', 'success');
        fetchInbox();
    } catch (e) {
        showToast('Failed to send SMS message.', 'error');
    }
}

function startChatWithCustomer(phone) {
    activeThreadPhone = phone;
    document.querySelector('.nav-tab[data-tab="tab-inbox"]').click();
    fetchInbox();
}

async function handleStartNewThread(e) {
    e.preventDefault();
    const phone = document.getElementById('ntPhone').value.trim();
    const body = document.getElementById('ntBody').value.trim();

    try {
        await fetch('/api/crm/inbox/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: phone, body: body })
        });
        closeModal('modalNewThread');
        document.getElementById('formNewThread').reset();
        showToast(`SMS sent to ${phone}! 🐾`, 'success');
        startChatWithCustomer(phone);
    } catch (e) {
        showAlert({ title: 'Failed to Send', message: 'Could not send initial SMS message.', icon: '⚠️', type: 'error' });
    }
}

// ─── 11. CUSTOMER DIRECTORY & LTV 360 ──────────────────
async function fetchCustomers() {
    try {
        const res = await fetch('/api/crm/customers');
        cachedCustomers = await res.json();

        // Automatic fallback aggregation from loaded jobs if database is syncing
        if ((!cachedCustomers || cachedCustomers.length === 0) && cachedJobs && cachedJobs.length > 0) {
            const custMap = new Map();
            cachedJobs.forEach(job => {
                if (!job.phone) return;
                const clean = job.phone.replace(/\D/g, '');
                if (!custMap.has(clean)) {
                    custMap.set(clean, {
                        id: job.customer_id || job.id,
                        name: job.name && job.name !== 'Neighbor' ? job.name : 'Neighbor',
                        phone: job.phone,
                        address: job.address || '',
                        zip_code: job.zip_code || '95841',
                        customer_type: 'residential',
                        total_jobs: 0,
                        total_revenue: 0,
                        notes: job.special_notes || ''
                    });
                }
                const c = custMap.get(clean);
                c.total_jobs++;
                if (job.status === 'completed') {
                    c.total_revenue += Number(job.final_price || job.estimated_price_min || 150);
                }
            });
            cachedCustomers = Array.from(custMap.values()).sort((a, b) => (b.total_revenue || 0) - (a.total_revenue || 0));
        }

        renderCustomerTable(cachedCustomers);
    } catch (e) {
        console.error("Customer fetch error", e);
    }
}

function renderCustomerTable(customers) {
    const tbody = document.getElementById('customersTableBody');
    if (!tbody) return;

    if (customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">No customers recorded yet.</td></tr>';
        return;
    }

    tbody.innerHTML = customers.map(c => {
        const typeBadge = (c.customer_type || '').includes('b2b') 
            ? `<span class="badge-type b2b">B2B Partner</span>` 
            : `<span class="badge-type residential">Residential</span>`;

        return `
            <tr style="cursor:pointer" onclick="openCustomerModal(${c.id})">
                <td><strong>${c.name}</strong></td>
                <td><a href="tel:${c.phone}" onclick="event.stopPropagation()" style="color:var(--text-muted);text-decoration:none">${c.phone}</a></td>
                <td>${c.address || c.zip_code || 'Citrus Heights'}</td>
                <td>${typeBadge}</td>
                <td>${c.total_jobs} hauls</td>
                <td style="color:var(--green);font-weight:700">$${c.total_revenue || 0}</td>
                <td>${c.gate_code || c.notes || 'None'}</td>
                <td>
                    <div style="display:flex;gap:4px">
                        ${c.email ? `<button class="btn-card" style="padding:4px 8px;font-size:0.75rem;background:#2563EB;border-color:#2563EB;color:#FFF" onclick="event.stopPropagation(); openCustomerEmail('${c.email}', '${(c.name || 'Neighbor').replace(/'/g, "\\'")}')" title="1-Click Email from gofetchgizmo@gmail.com">✉️</button>` : ''}
                        <button class="btn-card" onclick="event.stopPropagation(); startChatWithCustomer('${c.phone}')">💬 Text</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function openCustomerEmail(email, name) {
    if (!email) return;
    const custName = (name || 'Neighbor').split(' ')[0];
    const subject = `Go Fetch, Gizmo! - Junk Hauling & Cleanouts 🐾`;
    const body = `Hi ${custName},\n\nBrandon here from Go Fetch, Gizmo! 🐾 Following up regarding your hauling and cleanout needs.\n\nLet me know if you need any items hauled away or have any questions!\n\nBest,\nBrandon & Gizmo\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo@gmail.com`;

    openOneClickEmail({ to: email, subject, body });
    showToast(`✉️ Gmail opened from gofetchgizmo@gmail.com for ${email}! 🐾`, 'success');
}

function handleCustomerSearch(e) {
    const q = e.target.value.toLowerCase();
    const filtered = cachedCustomers.filter(c => 
        (c.name || '').toLowerCase().includes(q) ||
        (c.phone || '').includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q)
    );
    renderCustomerTable(filtered);
}

async function openCustomerModal(customerId) {
    const customer = cachedCustomers.find(c => c.id === customerId);
    if (!customer) return;

    document.getElementById('cdCustomerId').value = customer.id;
    document.getElementById('cdName').innerText = customer.name;
    document.getElementById('cdPhone').innerText = `Phone: ${customer.phone} · ${customer.address || customer.zip_code || 'Citrus Heights'}`;
    document.getElementById('cdLtvBadge').innerText = `LTV: $${customer.total_revenue || 0}`;
    document.getElementById('cdGateCode').value = customer.gate_code || '';
    document.getElementById('cdType').value = customer.customer_type || 'residential';
    document.getElementById('cdNotes').value = customer.notes || '';

    const btnText = document.getElementById('cdBtnText');
    btnText.onclick = () => {
        closeModal('modalCustomerDetail');
        startChatWithCustomer(customer.phone);
    };

    const btnEmail = document.getElementById('cdBtnEmail');
    if (btnEmail) {
        if (customer.email) {
            btnEmail.style.display = 'inline-flex';
            btnEmail.onclick = () => {
                closeModal('modalCustomerDetail');
                openCustomerEmail(customer.email, customer.name);
            };
        } else {
            btnEmail.style.display = 'none';
        }
    }

    // Load past job history
    const histContainer = document.getElementById('cdJobHistory');
    histContainer.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Loading job records...</div>';

    try {
        let jobs = [];
        const res = await fetch(`/api/crm/customers/${customerId}/jobs`);
        if (res.ok) jobs = await res.json();

        // Fallback search in cachedJobs by customer phone if endpoint returned empty
        if ((!jobs || jobs.length === 0) && cachedJobs && customer.phone) {
            const clean = customer.phone.replace(/\D/g, '');
            jobs = cachedJobs.filter(j => (j.phone || '').replace(/\D/g, '') === clean);
        }

        if (jobs.length === 0) {
            histContainer.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">No previous jobs recorded for this customer.</div>';
        } else {
            histContainer.innerHTML = jobs.map(j => `
                <div style="background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-weight:700;font-size:0.9rem">${j.estimated_tier || 'Haul'} · <span style="color:var(--orange-light)">${(j.status || 'NEW').toUpperCase()}</span></div>
                        <div style="font-size:0.75rem;color:var(--text-muted)">${j.preferred_date || (j.created_at ? new Date(j.created_at).toLocaleDateString() : 'Recent')} ${j.special_notes ? `· "${j.special_notes}"` : ''}</div>
                    </div>
                    <div style="font-family:var(--font-heading);font-size:1.1rem;color:var(--green);font-weight:800">
                        $${j.final_price || j.estimated_price_min || 150}
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {
        histContainer.innerHTML = '<div style="color:var(--text-muted)">Could not load history.</div>';
    }

    openModal('modalCustomerDetail');
}

async function handleSaveCustomerNotes(e) {
    e.preventDefault();
    const customerId = document.getElementById('cdCustomerId').value;
    const updates = {
        gate_code: document.getElementById('cdGateCode').value.trim(),
        customer_type: document.getElementById('cdType').value,
        notes: document.getElementById('cdNotes').value.trim()
    };

    try {
        await fetch(`/api/crm/customers/${customerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        showToast('Customer profile & gate code saved! 📝', 'success');
        fetchCustomers();
    } catch (e) {
        showAlert({ title: 'Save Failed', message: 'Could not save customer notes.', icon: '⚠️', type: 'error' });
    }
}

// Google Review URL Helper
const DEFAULT_GOOGLE_REVIEW_URL = 'https://share.google/COJZkVik8pvPZPqWj';

function getGoogleReviewUrl() {
    const saved = localStorage.getItem('gizmo_google_review_url');
    if (saved && !saved.includes('gofetchgizmo/review')) {
        return saved;
    }
    return DEFAULT_GOOGLE_REVIEW_URL;
}

function setGoogleReviewUrl(url) {
    if (!url) return;
    localStorage.setItem('gizmo_google_review_url', url.trim());
    updateGoogleReviewUI();
}

function updateGoogleReviewUI() {
    const currentUrl = getGoogleReviewUrl();
    const input = document.getElementById('cfgGoogleReviewUrl');
    if (input) input.value = currentUrl;
    const linkBtn = document.getElementById('btnLiveReviewLink');
    if (linkBtn) linkBtn.href = currentUrl;
}

// ─── 12. 5-STAR GOOGLE REVIEW ENGINE ───────────────────
async function fetchReviews() {
    try {
        updateGoogleReviewUI();
        const res = await fetch('/api/crm/reviews');
        const reviews = await res.json();
        const tbody = document.getElementById('reviewsTableBody');
        const treatSpan = document.getElementById('revTreatsCount');
        if (treatSpan) {
            treatSpan.innerText = `${reviews.length} treats earned`;
        }

        if (!tbody) return;

        if (reviews.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">No review requests sent yet. Complete a job to trigger automatically!</td></tr>';
            return;
        }

        tbody.innerHTML = reviews.map(r => `
            <tr>
                <td><strong>${r.customer_name || 'Customer'}</strong></td>
                <td><a href="tel:${r.phone_number}" style="color:var(--text-muted);text-decoration:none">${r.phone_number}</a></td>
                <td>${r.sent_at ? new Date(r.sent_at).toLocaleDateString() : 'Recent'}</td>
                <td><span style="color:var(--green);font-weight:700">Dispatched 💬</span></td>
                <td>⭐⭐⭐⭐⭐</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error(e);
    }
}

function sendReviewEmailDirect(name, email, reviewUrl) {
    if (!email) return;
    const custName = (name || 'Neighbor').split(' ')[0];
    const url = reviewUrl || getGoogleReviewUrl();
    const subject = `🐾 Quick favor from Brandon & Gizmo!`;
    const body = `Hey ${custName}!\n\nBrandon here from Go Fetch, Gizmo! 🐾 Hope you're loving all that cleared-out space!\n\nIf you have 15 seconds, could you drop Gizmo a quick 5-star Google review?\n⭐⭐⭐⭐⭐ ${url}\n\n(Gizmo gets an extra bacon treat for every 5-star review! 🐶🥓)\n\nThank you so much for supporting our local business,\nBrandon & Gizmo\nGo Fetch, Gizmo! Hauling & Cleanouts\n(916) 546-8537 | gofetchgizmo@gmail.com`;

    openOneClickEmail({ to: email, subject, body });
    showToast(`✉️ Review email composer opened from gofetchgizmo@gmail.com for ${email}! ⭐`, 'success');
}

async function handleSendManualReview(e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = document.getElementById('srName').value.trim();
    const phone = document.getElementById('srPhone').value.trim();
    const email = document.getElementById('srEmail') ? document.getElementById('srEmail').value.trim() : '';
    const reviewUrl = getGoogleReviewUrl();

    if (!phone && !email) {
        showToast('Please provide either a phone number or email address', 'error');
        return;
    }

    try {
        await fetch('/api/crm/reviews/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, phone: phone, email: email, review_url: reviewUrl })
        });
        closeModal('modalSendReview');
        document.getElementById('formSendReview').reset();
        
        if (phone) {
            const reviewMsg = `Hey ${name.split(' ')[0] || 'Neighbor'}! Brandon here from Go Fetch, Gizmo! 🐾 Hope you're loving all that cleared-out space! If you have 15 seconds, could you drop Gizmo a quick 5-star Google review? ⭐⭐⭐⭐⭐ ${reviewUrl} (Gizmo gets an extra bacon treat for every 5-star review! 🐶🥓) Thanks again!`;
            openNativeSMS(phone, reviewMsg);
            showToast(`Messages app opened with 5-Star review text for ${name}! ⭐`, 'success');
        }

        if (email) {
            sendReviewEmailDirect(name, email, reviewUrl);
        }

        fetchReviews();
        fetchStats();
    } catch (e) {
        showAlert({ title: 'Send Failed', message: 'Failed to dispatch review request.', icon: '⚠️', type: 'error' });
    }
}

// ─── 13. B2B WHALE ENGINE ──────────────────────────────
async function fetchB2B() {
    try {
        const res = await fetch('/api/crm/b2b');
        cachedB2B = await res.json();
        renderB2BTable();
    } catch (e) {
        console.error(e);
    }
}

function renderB2BTable() {
    const tbody = document.getElementById('b2bTableBody');
    if (!tbody) return;

    if (!cachedB2B || cachedB2B.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">No B2B accounts found. Click Launch Outbound to harvest leads.</td></tr>';
        return;
    }

    tbody.innerHTML = cachedB2B.map(p => `
        <tr>
            <td><strong>${p.company_name}</strong></td>
            <td>${p.contact_name || 'Manager'}</td>
            <td><span class="badge-type b2b">${p.category}</span></td>
            <td>${p.city}</td>
            <td><a href="javascript:void(0)" onclick="quickEmailB2B(${p.id})" style="color:var(--orange-light);text-decoration:none;font-weight:600" title="1-Click Send via Gmail (gofetchgizmo@gmail.com)">✉️ ${p.email}</a></td>
            <td>${p.phone || 'N/A'}</td>
            <td><span style="color:${p.status === 'emailed' || p.status === 'pitched' ? 'var(--gold)' : 'var(--blue)'};font-weight:700">${(p.status || 'scouted').toUpperCase()}</span></td>
            <td>
                <div style="display:flex;gap:4px">
                    <button class="btn-card primary" style="padding:4px 8px;font-size:0.75rem;background:#2563EB;border-color:#2563EB" onclick="quickEmailB2B(${p.id})" title="1-Click Send via Gmail (gofetchgizmo@gmail.com)">✉️ 1-Click</button>
                    <button class="btn-card" style="padding:4px 8px;font-size:0.75rem" onclick="openB2BPitchModal(${p.id})">Preview ↗</button>
                </div>
            </td>
        </tr>
    `).join('');
}

async function quickEmailB2B(prospectId) {
    const prospect = (cachedB2B || []).find(p => String(p.id) === String(prospectId));
    if (!prospect || !prospect.email) {
        showToast('No prospect email available', 'error');
        return;
    }
    const pitch = generateB2BPitchClient(prospect);
    
    // 1. Open 1-Click Gmail Compose from gofetchgizmo@gmail.com
    openOneClickEmail({ to: prospect.email, subject: pitch.subject, body: pitch.body });

    // 2. Log dispatch via API
    try {
        await fetch('/api/b2b/send-one', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospect_id: prospectId,
                subject: pitch.subject,
                body: pitch.body,
                email: prospect.email
            })
        });
        prospect.status = 'pitched';
        renderB2BTable();
        showToast(`✉️ 1-Click Gmail opened from gofetchgizmo@gmail.com for ${prospect.company_name}! 🚀`, 'success');
    } catch (e) {
        showToast(`Gmail opened for ${prospect.email}`, 'info');
    }
}

function generateB2BPitchClient(prospect) {
    if (!prospect) return { subject: 'Local Commercial Partnership', body: '' };
    const company = prospect.company_name || "your team";
    const contact = (prospect.contact_name || "there").split(" ")[0];
    const category = (prospect.category || "Property Management").toLowerCase();
    const city = prospect.city || "Citrus Heights";

    let subject = "";
    let body = "";

    if (category.includes("property") || category.includes("rental") || category.includes("hoa")) {
        subject = `Same-day unit turnover cleanouts for ${company} (${city})`;
        body = `Hi ${contact},\n\nI’m Brandon, owner of Go Fetch, Gizmo! — a top-rated, local hauling and property cleanout service based right here in ${city}.\n\nWhen tenants vacate and leave couches, mattresses, or bulk trash behind, we handle same-day unit turnovers and garage cleanouts at flat rates roughly 30–40% below franchise haulers, complete with before/after photos for your security deposit deductions.\n\nDo you have any units currently in turnover or evictions needing a fast haul-away this week?\n\nBest,\nBrandon (& Gizmo 🐾)\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo.com`;
    } else if (category.includes("real estate") || category.includes("realtor") || category.includes("broker")) {
        subject = `Pre-listing cleanouts & estate junk removal in ${city} (Go Fetch, Gizmo!)`;
        body = `Hi ${contact},\n\nI’m Brandon, a local resident and owner of Go Fetch, Gizmo! hauling in ${city}.\n\nWe work with local listing agents to clear out cluttered garages, estate cleanouts, and bulky furniture before photography and open houses — often with same-day dispatch and guaranteed flat pricing.\n\nIf you have any upcoming listings that need quick de-cluttering before hitting the MLS, could I send you our 1-page vendor rate card?\n\nBest,\nBrandon (& Gizmo 🐾)\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo.com`;
    } else if (category.includes("storage")) {
        subject = `Abandoned locker cleanouts & fast sweep-outs for ${company}`;
        body = `Hi ${contact},\n\nI run Go Fetch, Gizmo! hauling based here in ${city}.\n\nWhen auction buyers leave remnant trash behind or you have abandoned delinquent units that need fast clearing, we clear and sweep them out same-day so you can get them relisted and earning rent immediately.\n\nWould it help to keep us on standby as your reliable local cleanout vendor?\n\nBest,\nBrandon (& Gizmo 🐾)\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo.com`;
    } else if (category.includes("attorney") || category.includes("eviction") || category.includes("legal")) {
        subject = `Sheriff eviction cleanout & lock-out hauling support in ${city}`;
        body = `Hi ${contact},\n\nI’m Brandon, owner of Go Fetch, Gizmo! hauling in ${city}.\n\nWe partner with local real estate and eviction attorneys to handle post-writ lock-out cleanouts, staging curbside removal, and documentation inventory with speed and discretion.\n\nCould we assist on any eviction turnarounds or estate proceedings you're currently handling?\n\nBest,\nBrandon (& Gizmo 🐾)\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo.com`;
    } else if (category.includes("contractor") || category.includes("remodel") || category.includes("roofing")) {
        subject = `Jobsite debris & remodel trash haul-away in ${city}`;
        body = `Hi ${contact},\n\nI’m Brandon, owner of Go Fetch, Gizmo! hauling in ${city}.\n\nWe provide local general contractors and remodelers with fast jobsite debris haul-off, scrap removal, and broom-clean finishes so your crew stays focused on building.\n\nDo you have any active remodels or demo jobs in ${city} needing a quick dump run?\n\nBest,\nBrandon (& Gizmo 🐾)\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo.com`;
    } else {
        subject = `Reliable local hauling & commercial cleanout support in ${city}`;
        body = `Hi ${contact},\n\nI’m Brandon, owner of Go Fetch, Gizmo! — a top-rated local hauling service in ${city}.\n\nWe provide local businesses with fast, flat-rate junk removal, bulk disposal, and cleanouts with same-day turnaround and priority commercial scheduling.\n\nIf your team ever needs bulky items or cleanout work handled quickly, feel free to text a photo to (916) 546-8537 for an instant quote.\n\nBest,\nBrandon (& Gizmo 🐾)\nGo Fetch, Gizmo! | (916) 546-8537\ngofetchgizmo.com`;
    }

    return { subject, body };
}

async function openB2BPitchModal(prospectId) {
    const prospect = (cachedB2B || []).find(p => String(p.id) === String(prospectId));
    if (!prospect) {
        showToast('Prospect record not found', 'error');
        return;
    }

    // 1. Generate client-side pitch tailored to this exact prospect immediately
    const clientPitch = generateB2BPitchClient(prospect);

    document.getElementById('bpProspectId').value = prospectId;
    document.getElementById('bpTitle').innerText = `Pitch: ${prospect.company_name}`;
    document.getElementById('bpSubtitle').innerText = `Contact: ${prospect.contact_name || 'Manager'} · ${prospect.email}`;
    document.getElementById('bpSubject').value = clientPitch.subject;
    document.getElementById('bpBody').value = clientPitch.body;

    openModal('modalB2BPitch');

    // 2. Sync with backend
    try {
        const res = await fetch('/api/b2b/pitch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospect_id: prospectId,
                prospect: prospect
            })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.pitch && data.pitch.subject) {
                document.getElementById('bpSubject').value = data.pitch.subject;
                document.getElementById('bpBody').value = data.pitch.body;
            }
        }
    } catch (e) {}
}

async function handleSendSingleB2BPitch(e) {
    if (e && e.preventDefault) e.preventDefault();
    const prospectId = parseInt(document.getElementById('bpProspectId').value, 10);
    const subject = document.getElementById('bpSubject').value.trim();
    const body = document.getElementById('bpBody').value.trim();
    const prospect = (cachedB2B || []).find(p => String(p.id) === String(prospectId));
    const targetEmail = prospect ? prospect.email : '';

    if (!targetEmail) {
        showToast('No recipient email available', 'error');
        return;
    }

    try {
        // 1. Open 1-Click Gmail Web Compose pre-filled from gofetchgizmo@gmail.com
        openOneClickEmail({ to: targetEmail, subject, body });
        closeModal('modalB2BPitch');

        // 2. Track & log dispatch via backend API
        await fetch('/api/b2b/send-one', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prospect_id: prospectId,
                subject: subject,
                body: body,
                email: targetEmail
            })
        });

        if (prospect) prospect.status = 'pitched';
        renderB2BTable();

        showToast(`✉️ Gmail opened from gofetchgizmo@gmail.com for ${targetEmail}! Marked as Pitched 🚀`, 'success');
        fetchB2B();
    } catch (e) {
        showToast(`Gmail opened for ${targetEmail}`, 'info');
    }
}

async function handleCreateB2B(e) {
    e.preventDefault();
    const payload = {
        company_name: document.getElementById('nbCompany').value.trim(),
        contact_name: document.getElementById('nbContact').value.trim(),
        email: document.getElementById('nbEmail').value.trim(),
        phone: document.getElementById('nbPhone').value.trim(),
        category: document.getElementById('nbCategory').value,
        city: 'Citrus Heights'
    };

    try {
        await fetch('/api/crm/b2b', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        closeModal('modalNewB2B');
        document.getElementById('formNewB2B').reset();
        showToast(`Commercial partner ${payload.company_name} saved! 💼`, 'success');
        fetchB2B();
    } catch (e) {
        showAlert({ title: 'Save Failed', message: 'Could not save commercial B2B lead.', icon: '⚠️', type: 'error' });
    }
}

async function launchB2BOutbound() {
    const confirmed = await showConfirm({
        title: 'Launch B2B Sequence? 🚀',
        message: 'Start automated cold outreach sequence to Sacramento Property Managers, Realtors, and Storage Facilities?',
        icon: '🚀',
        confirmText: 'Launch Sequence 🚀',
        cancelText: 'Cancel'
    });

    if (!confirmed) return;

    try {
        await fetch('/api/b2b/campaign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: 'all', dry_run: true })
        });
        showToast('🚀 B2B Outreach campaign queued! Logs visible in console.', 'success');
        fetchB2B();
    } catch (e) {
        showAlert({ title: 'Campaign Error', message: 'Failed to trigger B2B campaign.', icon: '⚠️', type: 'error' });
    }
}

// ─── 14. REAL-TIME SIGNAL SNIPER (CRAIGSLIST & CLASSIFIEDS) ───
let cachedSignals = [];
let activeSignalCategory = 'all';
let activeSignalStatus = 'all';
let activeSignalId = null;

async function fetchSignals() {
    try {
        let url = '/api/crm/signals';
        const params = new URLSearchParams();
        if (activeSignalCategory !== 'all') params.append('category', activeSignalCategory);
        if (activeSignalStatus !== 'all') params.append('status', activeSignalStatus);
        const q = params.toString();
        if (q) url += `?${q}`;

        const res = await fetch(url);
        cachedSignals = await res.json();
        renderSignalsTable(cachedSignals);
    } catch (e) {
        console.error("Signal fetch error:", e);
    }
}

function renderSignalsTable(signals) {
    const tbody = document.getElementById('signalsTableBody');
    if (!tbody) return;

    let filtered = signals || [];
    const searchVal = (document.getElementById('signalSearchInput')?.value || '').toLowerCase().trim();
    if (searchVal) {
        filtered = filtered.filter(s => 
            (s.title || '').toLowerCase().includes(searchVal) ||
            (s.location || '').toLowerCase().includes(searchVal) ||
            (s.snippet || '').toLowerCase().includes(searchVal) ||
            (s.suggested_pitch || '').toLowerCase().includes(searchVal)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No signals matching filters. Click "⚡ Scan Feeds Now" to refresh Sacramento Craigslist!</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(s => {
        let catBadge = '';
        if (s.category === 'curb_alert') {
            catBadge = '<span class="badge-type" style="background:rgba(245,158,11,0.15);color:var(--gold);border:1px solid var(--gold)">🛋️ Curb Alert</span>';
        } else if (s.category === 'landlord_vacancy') {
            catBadge = '<span class="badge-type b2b">🏢 Landlord</span>';
        } else {
            catBadge = '<span class="badge-type residential">🚚 Hauling Gig</span>';
        }

        let statusBadge = '';
        if (s.status === 'converted') {
            statusBadge = '<span style="color:var(--green);font-weight:700">⭐ Booked</span>';
        } else if (s.status === 'contacted') {
            statusBadge = '<span style="color:var(--orange-light);font-weight:700">💬 Contacted</span>';
        } else if (s.status === 'dismissed') {
            statusBadge = '<span style="color:var(--text-muted)">❌ Dismissed</span>';
        } else {
            statusBadge = '<span style="color:var(--green);font-weight:600">🟢 New</span>';
        }

        const safePitch = (s.suggested_pitch || '').replace(/"/g, '&quot;');
        const detectedPhone = s.contact_phone || extractPhoneFromText(s.title + ' ' + (s.location || '') + ' ' + (s.snippet || ''));
        const detectedEmail = s.contact_email || extractEmailFromText(s.title + ' ' + (s.location || '') + ' ' + (s.snippet || ''));

        let quickActionBtn = '';
        if (detectedPhone) {
            quickActionBtn = `<button class="btn-card primary" style="padding:4px 8px;font-size:0.75rem;background:#10b981;border-color:#10b981" title="1-Tap Text ${detectedPhone}" onclick="event.stopPropagation(); directSendSignalSMS(${s.id}, '${detectedPhone}')">💬 Text</button>`;
        } else if (detectedEmail) {
            quickActionBtn = `<button class="btn-card primary" style="padding:4px 8px;font-size:0.75rem;background:#3b82f6;border-color:#3b82f6" title="Send Email to ${detectedEmail}" onclick="event.stopPropagation(); directSendSignalEmail(${s.id}, '${detectedEmail}')">✉️ Email</button>`;
        }

        return `
            <tr>
                <td>${catBadge}</td>
                <td>
                    <strong>${s.title}</strong>
                    <div style="font-size:0.75rem;margin-top:3px">
                        <a href="${s.url}" target="_blank" style="color:var(--orange-light);text-decoration:none">View Post on Craigslist ↗</a>
                    </div>
                </td>
                <td><span style="font-size:0.85rem;color:var(--text-muted)">📍 ${s.location || 'Citrus Heights'}</span></td>
                <td>
                    <div style="font-size:0.82rem;color:#e2e8f0;background:rgba(255,255,255,0.03);padding:6px 10px;border-radius:6px;border:1px solid var(--border);max-height:75px;overflow:hidden;text-overflow:ellipsis;cursor:pointer" title="Click to view outreach dispatcher" onclick="openSignalModal(${s.id})">
                        ${s.suggested_pitch || 'No pitch generated'}
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap">
                        ${quickActionBtn}
                        <button class="btn-card primary" style="padding:4px 8px;font-size:0.75rem" onclick="openSignalModal(${s.id})">🎯 Pitch & Send</button>
                        <button class="btn-card" style="padding:4px 6px;font-size:0.75rem" title="Dismiss" onclick="handleSignalStatus(${s.id}, 'dismissed')">✕</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function extractPhoneFromText(str) {
    if (!str) return '';
    const m = str.match(/(?:(?:\+?1\s*(?:[.-]\s*)?)?(?:\(\s*([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9])\s*\)|([2-9]1[02-9]|[2-9][02-8]1|[2-9][02-8][02-9]))\s*(?:[.-]\s*)?)?([2-9]1[02-9]|[2-9][02-9]1|[2-9][02-9]{2})\s*(?:[.-]\s*)?([0-9]{4})/);
    return m ? m[0].trim() : '';
}

function extractEmailFromText(str) {
    if (!str) return '';
    const m = str.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    return m ? m[0].trim() : '';
}

async function directSendSignalSMS(sigId, phone, customPitch) {
    const signal = cachedSignals.find(s => s.id === sigId);
    const pitch = customPitch || (signal ? signal.suggested_pitch : '');

    if (!phone) {
        showToast('Please enter a valid phone number', 'error');
        return;
    }

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // 1. Mark contacted & notify Telegram via backend FIRST
    try {
        await fetch(`/api/crm/signals/${sigId}/dispatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'sms', contact: phone, pitch: pitch })
        });
    } catch (e) {}

    if (signal) signal.status = 'contacted';
    renderSignalsTable(cachedSignals);

    // 2. Launch 1-tap native SMS (mobile) or desktop hub
    openNativeSMS(phone, pitch);

    if (isMobile) {
        showToast(`1-Tap SMS opened for ${phone}! Signal marked as Contacted 🐾`, 'success');
    } else {
        showToast(`📲 Beamed to Telegram & copied to clipboard! Marked as Contacted 🐾`, 'success');
    }
}

async function directSendSignalEmail(sigId, email, customPitch) {
    const signal = cachedSignals.find(s => s.id === sigId);
    const pitch = customPitch || (signal ? signal.suggested_pitch : '');
    const subject = `Go Fetch, Gizmo! - Junk Hauling & Cleanouts 🐾`;

    if (!email || !email.includes('@')) {
        showToast('Please enter a valid email address', 'error');
        return;
    }

    // 1. Open 1-Click Gmail Web Compose pre-filled from gofetchgizmo@gmail.com
    openOneClickEmail({ to: email, subject: subject, body: pitch });

    // 2. Mark contacted & log via backend API
    try {
        await fetch(`/api/crm/signals/${sigId}/dispatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'email', contact: email, pitch: pitch, subject: subject })
        });
    } catch (e) {}

    if (signal) signal.status = 'contacted';
    renderSignalsTable(cachedSignals);
    showToast(`✉️ Gmail opened from gofetchgizmo@gmail.com for ${email}! Marked as Contacted 🎯`, 'success');
}

function copySignalPitchText(text) {
    if (!text) return;
    const clean = text.replace(/&quot;/g, '"');
    navigator.clipboard.writeText(clean).then(() => {
        showToast('Pitch copied to clipboard! 📋', 'success');
    }).catch(() => {
        showToast('Pitch copied! 📋', 'success');
    });
}

async function handleScanSignals() {
    const spinner = document.getElementById('scanSpinner');
    const btn = document.getElementById('btnScanSignals');
    if (spinner) spinner.style.display = 'inline-block';
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/crm/signals/scan', { method: 'POST' });
        const data = await res.json();
        showToast(`Scout scan complete! Found ${data.new_count || 0} signals 🎯`, 'success');
        await fetchSignals();
    } catch (e) {
        showAlert({ title: 'Scan Error', message: 'Could not complete classifieds scan.', icon: '⚠️', type: 'error' });
    } finally {
        if (spinner) spinner.style.display = 'none';
        if (btn) btn.disabled = false;
    }
}

async function handleSignalStatus(sigId, newStatus) {
    try {
        await fetch(`/api/crm/signals/${sigId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        const match = cachedSignals.find(s => s.id === sigId);
        if (match) match.status = newStatus;
        renderSignalsTable(cachedSignals);
        showToast(`Signal marked as ${newStatus}! 👍`, 'success');
    } catch (e) {
        showToast('Failed to update signal status', 'error');
    }
}

function openSignalModal(sigId) {
    const signal = cachedSignals.find(s => s.id === sigId);
    if (!signal) return;

    activeSignalId = sigId;
    document.getElementById('spModalTitle').innerText = `🎯 Dispatch Outreach: ${signal.title.substring(0, 32)}...`;
    document.getElementById('spCategoryBadge').innerText = signal.category.toUpperCase().replace('_', ' ');
    document.getElementById('spPostTitle').innerText = signal.title;
    document.getElementById('spLocation').innerText = `📍 ${signal.location || 'Citrus Heights / Sacramento'}`;
    document.getElementById('spPostUrl').href = signal.url;
    document.getElementById('spPitchText').value = signal.suggested_pitch || '';

    // Contact detection & pre-fill
    const detectedPhone = signal.contact_phone || extractPhoneFromText(signal.title + ' ' + (signal.location || '') + ' ' + (signal.snippet || ''));
    const detectedEmail = signal.contact_email || extractEmailFromText(signal.title + ' ' + (signal.location || '') + ' ' + (signal.snippet || ''));
    
    const contactInput = document.getElementById('spContactInput');
    const detectedBadge = document.getElementById('spContactDetectedBadge');
    const btnCheckReply = document.getElementById('spBtnCheckReply');

    if (btnCheckReply) btnCheckReply.href = signal.url;

    if (detectedPhone) {
        contactInput.value = detectedPhone;
        detectedBadge.innerText = '📞 Phone detected from listing';
        detectedBadge.style.color = 'var(--green)';
    } else if (detectedEmail) {
        contactInput.value = detectedEmail;
        detectedBadge.innerText = '✉️ Email detected from listing';
        detectedBadge.style.color = '#60a5fa';
    } else {
        contactInput.value = '';
        detectedBadge.innerText = '💡 Click "Check Reply ↗" to view phone/email on Craigslist';
        detectedBadge.style.color = 'var(--gold)';
    }

    document.getElementById('btnCopySignalPitch').onclick = () => {
        const text = document.getElementById('spPitchText').value;
        copySignalPitchText(text);
    };

    document.getElementById('btnSendSignalSMS').onclick = async () => {
        const contact = contactInput.value.trim();
        const pitch = document.getElementById('spPitchText').value.trim();
        if (!contact) {
            showAlert({
                title: 'Recipient Required',
                message: 'Please enter a phone number or click "Check Reply ↗" on the Craigslist post to get their number.',
                icon: '📱',
                type: 'warning'
            });
            return;
        }
        await directSendSignalSMS(sigId, contact, pitch);
        closeModal('modalSignalPitch');
    };

    document.getElementById('btnSendSignalEmail').onclick = async () => {
        const contact = contactInput.value.trim();
        const pitch = document.getElementById('spPitchText').value.trim();
        if (!contact || !contact.includes('@')) {
            showAlert({
                title: 'Email Address Required',
                message: 'Please enter a valid email address or Craigslist relay email.',
                icon: '✉️',
                type: 'warning'
            });
            return;
        }
        await directSendSignalEmail(sigId, contact, pitch);
        closeModal('modalSignalPitch');
    };

    openModal('modalSignalPitch');
}

// ─── 15. MODALS & LIGHTBOX HELPERS ─────────────────────
function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
}

function openPhotoViewer(url) {
    const img = document.getElementById('photoViewerImg');
    if (img) img.src = url;
    openModal('modalPhotoViewer');
}
