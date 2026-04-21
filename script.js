// ══════════════════════════════════════
//  1. LOGIN SECURITY CHECK
// ══════════════════════════════════════
function redirectIfLoggedOut() {
    const isLoggedIn = localStorage.getItem("rrr_logged_in");
    if (isLoggedIn !== "true") {
        try { window.location.replace("login.html"); } catch(e) {}
        return true;
    }
    return false;
}
redirectIfLoggedOut();
window.addEventListener("pageshow", redirectIfLoggedOut);

// ══════════════════════════════════════
//  CONFIG & STATE
// ══════════════════════════════════════
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx_xCWWCoBc3wj-trWKYt4wYx18Od6DVOUYCgGYITooQt8d_9Mckv6dJlu_SfjnblugfA/exec";
const LS_KEY = "RRR_DB_v1";
const SAMPLE_DATA_KEY = "RRR_SAMPLE_DATA_v1";
const CLOUD_TIMEOUT_MS = 90000;

let DB = { cases:[], history:[], actions:[], comms:[], docs:[], timeline:[], studyControl:[], sampleData:[], auditLogs:[] };

function normalizeDBShape() {
    DB = DB || {};
    ["cases","history","actions","comms","docs","timeline","studyControl","sampleData","auditLogs"].forEach(key => {
        if (!Array.isArray(DB[key])) DB[key] = [];
    });
}

// ══════════════════════════════════════
//  SAMPLE DATA BACKUP
// ══════════════════════════════════════
function loadSampleDataBackup() {
    try {
        const raw = localStorage.getItem(SAMPLE_DATA_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch(e) { return []; }
}
function persistSampleDataBackup() {
    try { localStorage.setItem(SAMPLE_DATA_KEY, JSON.stringify(Array.isArray(DB.sampleData) ? DB.sampleData : [])); } catch(e) {}
}
function restoreSampleDataFromBackup() {
    normalizeDBShape();
    if (DB.sampleData.length) { persistSampleDataBackup(); return; }
    const backup = loadSampleDataBackup();
    if (backup.length) DB.sampleData = backup;
}

// ══════════════════════════════════════
//  DB LOAD — non-blocking
// ══════════════════════════════════════
// ── 1. LOAD DATA FROM CLOUD ONLY ──
async function loadDB() {
    console.log("Fetching from Cloud...");
    toast("Cloud se data load ho raha hai...", "info");

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);

        // Fetch direct from Google Script
        const res = await fetch(SCRIPT_URL + "?t=" + Date.now(), { 
            signal: controller.signal 
        });
        
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.cases)) {
                DB = data; // Data RAM mein load ho gaya
                normalizeDBShape();
                refreshAllUI(); // Saari tables ek saath refresh
                console.log("✅ Cloud Data Loaded Successfully");
            }
        } else {
            throw new Error("Server response not ok");
        }
    } catch(e) {
        console.error("Cloud load failed:", e.message);
        toast("Internet Slow hai! Refresh karein.", "error");
        
        // Fallback: Agar cloud fail ho jaye, tabhi local se uthao (sirf safety ke liye)
        const local = localStorage.getItem(LS_KEY);
        if (local) {
            DB = JSON.parse(local);
            normalizeDBShape();
            refreshAllUI();
        }
    }
}

// ── 2. SAVE DATA TO CLOUD ONLY ──
async function saveDB() {
    console.log("🔄 Syncing to Google Sheets...");

    // RAM data ko local storage mein sirf temporary backup rakhte hain 
    // taaki browser crash ho to data na jaye, par main storage Sheet hi rahegi
    try { 
        localStorage.setItem(LS_KEY, JSON.stringify(DB)); 
    } catch(e) { console.warn("Local storage full, using cloud only."); }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CLOUD_TIMEOUT_MS);

        await fetch(SCRIPT_URL, { 
            method: "POST", 
            body: JSON.stringify(DB), 
            mode: "no-cors", 
            signal: controller.signal 
        });

        clearTimeout(timeoutId);
        console.log("✅ Cloud Sync successfully triggered.");
        
    } catch(e) {
        if (e.name === "AbortError") {
            console.warn("Sync slow hai, backend mein process ho raha hoga.");
        } else {
            console.error("Cloud sync error:", e);
            toast("Cloud Sync Fail! Internet check karein.", "error");
        }
    }
}

function refreshAllUI() {
    updateDashboard();
    refreshDropdowns();
    refreshNavCount();
    renderCaseMaster();
    renderHistoryTable();
    renderActionTable();
    renderCommTable();
    renderDocIndex();
    renderTimeline();
    renderStudyControl();
    renderRefundApprovals();
    renderRefundDashboard();
    applyPermissions();
}

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════
function nowIST() { return new Date().toLocaleString("en-IN", { timeZone:"Asia/Kolkata" }); }
function todayDate() { return new Date().toLocaleDateString("en-IN", { timeZone:"Asia/Kolkata" }); }
function uid(prefix) { return prefix + "-" + Date.now() + "-" + Math.floor(Math.random()*1000); }

function generateCaseId() {
    const yr = new Date().getFullYear();
    const nums = DB.cases.map(c => { const p=(c.caseId+"").split("-"); return p.length>2?parseInt(p[2]):0; });
    const next = nums.length ? Math.max(...nums)+1 : 1;
    return `CASE-${yr}-${String(next).padStart(4,"0")}`;
}

function toast(msg, type="info") {
    const t = document.getElementById("toast");
    const el = document.createElement("div");
    el.className = "toast-msg"+(type==="success"?" success":type==="error"?" error":"");
    el.textContent = (type==="success"?"✅ ":type==="error"?"❌ ":"ℹ️ ")+msg;
    t.appendChild(el);
    setTimeout(()=>{ el.style.opacity="0"; setTimeout(()=>el.remove(),400); }, 3500);
}

function refreshNavCount() {
    const el = document.getElementById("navbar-case-count");
    if (el) el.textContent = (DB.cases?DB.cases.length:0)+" case"+(DB.cases.length!==1?"s":"");
}

function refreshDropdowns() {
    const ids = ["hu-caseid","al-caseid","cl-caseid","cs-caseid","tl-filter","di-caseid","rr-caseid"];
    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = id==="tl-filter" ? `<option value="">-- All Cases --</option>` : `<option value="">-- Select Case --</option>`;
        DB.cases.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.caseId;
            opt.textContent = `${c.caseId} - ${c.clientName}`;
            if (c.caseId===cur) opt.selected = true;
            sel.appendChild(opt);
        });
    });
}

// Clock
setInterval(()=>{ const el=document.getElementById("clock"); if(el) el.textContent=new Date().toLocaleTimeString("en-IN",{timeZone:"Asia/Kolkata"}); }, 1000);

// ══════════════════════════════════════
//  *** TAB SWITCHER — THE CORE FIX ***
// ══════════════════════════════════════
document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
        const tabName = tab.dataset.tab;

        // Step 1: Remove active from all tabs
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));

        // Step 2: FORCE HIDE all sections (override any CSS)
        document.querySelectorAll(".section").forEach(s => {
            s.classList.remove("active");
            s.style.setProperty("display", "none", "important");
        });

        // Step 3: Activate clicked tab
        tab.classList.add("active");

        // Step 4: FORCE SHOW target section
        const target = document.getElementById("tab-" + tabName);
        if (target) {
            target.classList.add("active");
            target.style.setProperty("display", "block", "important");
            window.scrollTo(0, 0);
        } else {
            console.error("Section not found: tab-" + tabName);
            return;
        }

        // Step 5: Refresh dropdowns always
        refreshDropdowns();

        // Step 6: Tab-specific render
        const safe = (fn) => { try { if(typeof window[fn]==="function") window[fn](); } catch(e){ console.error(fn+":",e); } };
        if (tabName==="dashboard") safe("updateDashboard");
        else if (tabName==="case-master") safe("renderCaseMaster");
        else if (tabName==="history") safe("renderHistoryTable");
        else if (tabName==="action-log") safe("renderActionTable");
        else if (tabName==="comm-log") safe("renderCommTable");
        else if (tabName==="timeline") safe("renderTimeline");
        else if (tabName==="doc-index") safe("renderDocIndex");
        else if (tabName==="case-study") safe("renderStudyControl");
        else if (tabName==="admin-panel") { safe("renderRefundApprovals"); safe("setupUserRoleOptions"); }
        else if (tabName==="internal-search") safe("renderSampleSearch");
    });
});

// ══════════════════════════════════════
//  LOGOUT
// ══════════════════════════════════════
window.logout = function() {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem("rrr_logged_in");
        localStorage.removeItem("rrr_user_role");
        localStorage.removeItem("rrr_user_email");
        try { window.location.replace("login.html"); } catch(e) {}
    }
};

// ══════════════════════════════════════
//  ROLE HELPERS
// ══════════════════════════════════════
function normalizeRole(role) {
    const r = (role||"").toString().trim().toLowerCase();
    if (r==="admin") return "Admin";
    if (r==="operations"||r==="operation") return "Operations";
    return "Staff";
}
function currentRole() { return normalizeRole(localStorage.getItem("rrr_user_role")); }
function currentUserEmail() { return (localStorage.getItem("rrr_user_email")||"").trim().toLowerCase(); }
function isAdmin() { return currentRole()==="Admin"; }
function isOperations() { return currentRole()==="Operations"; }
function canRaiseRefundRequest() { return isAdmin()||isOperations(); }

function formatRefundStatus(status) {
    const s = status||"Pending Approval";
    const cls = s==="Approved"?"badge-closed":s==="Rejected"?"badge-high":"badge-pending";
    return `<span class="badge ${cls}">${s}</span>`;
}

// ══════════════════════════════════════
//  BADGE HELPERS
// ══════════════════════════════════════
function statusBadge(s) {
    const map = {"Open":"open","Closed":"closed","Settled":"settled","In Progress":"pending","Pending Response":"pending","Refund Pending Approval":"pending","Refund Approved":"closed"};
    return `<span class="badge badge-${map[s]||'open'}">${s||'Open'}</span>`;
}
function priorityBadge(p) {
    const map = {"High":"high","Medium":"medium","Low":"low"};
    return `<span class="badge badge-${map[p]||'medium'}">${p||'Medium'}</span>`;
}

// ══════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════
function updateDashboard() {
    normalizeDBShape();
    document.getElementById("stat-total").textContent = DB.cases.length;
    document.getElementById("stat-open").textContent = DB.cases.filter(c=>c.currentStatus==="Open").length;
    renderRefundDashboard();
    const body = document.getElementById("dash-recent-body");
    if (!body) return;
    const recent = DB.cases.slice(-5).reverse();
    if (!recent.length) { body.innerHTML=`<tr><td colspan="6" class="empty-state">No cases yet</td></tr>`; return; }
    body.innerHTML = recent.map(c=>`
        <tr>
          <td><span class="case-id-display">${c.caseId}</span></td>
          <td>${c.clientName}</td>
          <td>${priorityBadge(c.priority)}</td>
          <td>${statusBadge(c.currentStatus)}</td>
          <td>${c.lastUpdateDate}</td>
          <td>${c.nextActionDate||"-"}</td>
        </tr>`).join("");
}

function runDailyChecker() {
    const today = new Date();
    const twoDays = new Date(); twoDays.setDate(today.getDate()+2);
    let overdue=[], dueSoon=[];
    DB.cases.forEach(c=>{
        if (!c.nextActionDate||c.currentStatus==="Closed"||c.currentStatus==="Settled") return;
        const nd = new Date(c.nextActionDate);
        if (nd<today) overdue.push(c);
        else if (nd<=twoDays) dueSoon.push(c);
    });
    document.getElementById("stat-overdue").textContent = overdue.length;
    document.getElementById("stat-duesoon").textContent = dueSoon.length;
    document.getElementById("stat-settled").textContent = DB.cases.filter(c=>c.currentStatus==="Settled"||c.currentStatus==="Closed").length;
    document.getElementById("stat-high").textContent = DB.cases.filter(c=>c.priority==="High").length;
    const od = document.getElementById("dash-overdue");
    od.innerHTML = overdue.length ? overdue.map(c=>`<div style="padding:8px 0;border-bottom:1px solid var(--gray-border)">
        <span class="case-id-display">${c.caseId}</span> — <strong>${c.clientName}</strong>
        <span class="overdue" style="float:right">${c.nextActionDate}</span></div>`).join("") :
        `<div class="empty-state"><span class="emoji">✅</span>No overdue actions</div>`;
    const ds = document.getElementById("dash-duesoon");
    ds.innerHTML = dueSoon.length ? dueSoon.map(c=>`<div style="padding:8px 0;border-bottom:1px solid var(--gray-border)">
        <span class="case-id-display">${c.caseId}</span> — <strong>${c.clientName}</strong>
        <span class="due-soon" style="float:right">${c.nextActionDate}</span></div>`).join("") :
        `<div class="empty-state"><span class="emoji">✅</span>Nothing due soon</div>`;
    document.getElementById("dash-last-check").textContent = "Last checked: "+nowIST();
    toast("Daily checker complete!", "success");
}

// ══════════════════════════════════════
//  NEW CASE
// ══════════════════════════════════════
async function submitNewCase() {
    const get = id => { const el=document.getElementById(id); return el?el.value.trim():""; };
    if (!get("nc-company")||!get("nc-title")||!get("nc-client")||!get("nc-summary")) {
        toast("Required fields missing! (Company, Title, Client, Summary)", "error"); return;
    }
    try {
        const serviceRows = document.querySelectorAll(".service-row");
        let servicesData=[];
        serviceRows.forEach(row=>{
            const name=row.querySelector(".s-name")?row.querySelector(".s-name").value:"";
            const status=row.querySelector(".s-status")?row.querySelector(".s-status").value:"";
            const amt=row.querySelector(".s-amt")?row.querySelector(".s-amt").value:"0";
            if (name) servicesData.push(`${name} [₹${amt}] (${status})`);
        });
        const ackInputs = document.querySelectorAll(".ack-input");
        const capturedAcks = Array.from(ackInputs).map(i=>i.value.trim()).filter(v=>v).join(", ");
        const caseId = generateCaseId();
        const createdDate = nowIST();
        const row = {
            caseId, createdDate,
            companyName:get("nc-company"), caseTitle:get("nc-title"), priority:get("nc-priority"),
            sourceOfComplaint:get("nc-business"), typeOfComplaint:get("nc-complaint-type"),
            servicesSold:servicesData.join(", "), engagementNote:get("nc-engagement-note"),
            cyberAckNumbers:capturedAcks, firNumber:get("nc-fir-num"),
            firFileLink:document.getElementById("nc-fir-file-data")?document.getElementById("nc-fir-file-data").value:"",
            grievanceNumber:get("nc-grievance-num"),
            clientName:get("nc-client"), clientMobile:get("nc-mobile"), clientEmail:get("nc-email"),
            state:get("nc-state"), totalAmtPaid:get("nc-amtpaid")||"0", mouSigned:get("nc-mou"),
            totalMouValue:get("nc-mouval")||"0", amtInDispute:get("nc-dispute")||"0",
            smRisk:get("nc-smrisk"), complaint:get("nc-complaint"), policeThreat:get("nc-police"),
            caseSummary:get("nc-summary"), clientAllegation:get("nc-allegation"),
            proofCallRec:get("nc-call-rec"), proofWaChat:get("nc-wa-chat"),
            proofVideoCall:get("nc-v-call"), proofFundingEmail:get("nc-funding-email"),
            initiatedBy:get("nc-lead"), accountable:get("nc-negotiator"),
            legalOfficer:get("nc-legal"), accounts:get("nc-accounts"),
            currentStatus:"Open", lastUpdateDate:createdDate
        };
        DB.cases.push(row);
        logActivity("CASE_CREATION", `Created new case for ${row.clientName}`, caseId);
        addTimelineEntry(caseId, createdDate, "CASE_CREATION", "Case Created", `New Case Registered (${row.typeOfComplaint})`);
        refreshAllUI();
        document.querySelector('[data-tab="case-master"]').click();
        toast("Case Created! Syncing...", "success");
        clearNewCaseForm();
        await saveDB();
    } catch(error) {
        console.error("Submission Error:", error);
        toast("Error: "+error.message, "error");
    }
}

function clearNewCaseForm() {
    document.querySelectorAll("#tab-new-case input, #tab-new-case textarea").forEach(i=>i.value="");
    document.querySelectorAll("#tab-new-case select").forEach(s=>s.selectedIndex=0);
    toggleServiceMode();
    const chip=document.getElementById("nc-fir-file-chip"); if(chip) chip.innerHTML="";
    const fd=document.getElementById("nc-fir-file-data"); if(fd) fd.value="";
}

// ══════════════════════════════════════
//  CASE MASTER
// ══════════════════════════════════════
function renderCaseMaster() {
    const q=(document.getElementById("cm-search")?document.getElementById("cm-search").value:"").toLowerCase();
    const status=document.getElementById("cm-filter-status")?document.getElementById("cm-filter-status").value:"";
    const prio=document.getElementById("cm-filter-priority")?document.getElementById("cm-filter-priority").value:"";
    const body=document.getElementById("cm-body");
    if (!body) return;
    let filtered = DB.cases.filter(c=>{
        const matchQ=!q||JSON.stringify(c).toLowerCase().includes(q);
        const matchSt=!status||c.currentStatus===status;
        const matchPr=!prio||c.priority===prio;
        return matchQ&&matchSt&&matchPr;
    }).slice().reverse();
    if (!filtered.length) { body.innerHTML=`<tr><td colspan="12"><div class="empty-state"><span class="emoji">📂</span>No cases match your filter.</div></td></tr>`; return; }
    body.innerHTML = filtered.map(c=>`<tr>
        <td><span class="case-id-display" style="cursor:pointer;color:var(--blue)" onclick="showCaseDetail('${c.caseId}')">${c.caseId}</span></td>
        <td>${c.createdDate}</td>
        <td>${c.clientName}<br><span class="text-muted" style="font-size:11px">${c.clientMobile}</span></td>
        <td>${c.companyName}</td>
        <td>${c.servicesSold||"-"}</td>
        <td>₹${Number(c.totalAmtPaid||0).toLocaleString("en-IN")}</td>
        <td>${priorityBadge(c.priority)}</td>
        <td>${statusBadge(c.currentStatus)}</td>
        <td>${c.initiatedBy||"-"}</td>
        <td>${c.lastUpdateDate}</td>
        <td>${c.nextActionDate||"-"}</td>
        <td><button class="btn btn-outline btn-sm" onclick="showCaseDetail('${c.caseId}')">👁 View</button></td>
    </tr>`).join("");
}

function exportCaseMaster() {
    if (!DB.cases.length) { toast("No cases to export.", "error"); return; }
    const headers = ["caseId","createdDate","companyName","caseTitle","priority","sourceOfComplaint","typeOfComplaint","servicesSold","clientName","clientMobile","clientEmail","state","totalAmtPaid","mouSigned","totalMouValue","amtInDispute","smRisk","complaint","policeThreat","caseSummary","clientAllegation","proofCallRec","proofWaChat","proofVideoCall","proofFundingEmail","initiatedBy","accountable","legalOfficer","accounts","currentStatus","lastUpdateDate","nextActionDate","cyberAckNumbers","firNumber","firFileLink","grievanceNumber"];
    const csv = [headers.join(","), ...DB.cases.map(c=>headers.map(h=>`"${(c[h]||"").toString().replace(/"/g,'""')}"`).join(","))].join("\n");
    const a=document.createElement("a");
    a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
    a.download="CaseMaster_"+Date.now()+".csv";
    a.click();
    toast("CSV exported!", "success");
}

// ══════════════════════════════════════
//  CASE DETAIL MODAL
// ══════════════════════════════════════
function showCaseDetail(caseId) {
    const c = DB.cases.find(x=>x.caseId===caseId);
    if (!c) { toast("Case not found!", "error"); return; }
    const tl = DB.timeline.filter(t=>t.caseId===caseId).sort((a,b)=>new Date(b.logTimestamp)-new Date(a.logTimestamp));
    document.getElementById("modal-case-id-title").textContent = "📋 "+caseId+" — "+c.clientName;
    document.getElementById("modal-body").innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:16px">
          <div><span class="text-muted">Company:</span> <strong>${c.companyName}</strong></div>
          <div><span class="text-muted">Case Title:</span> ${c.caseTitle}</div>
          <div><span class="text-muted">Mobile:</span> ${c.clientMobile}</div>
          <div><span class="text-muted">Email:</span> ${c.clientEmail||"-"}</div>
          <div><span class="text-muted">Priority:</span> ${priorityBadge(c.priority)}</div>
          <div><span class="text-muted">Status:</span> ${statusBadge(c.currentStatus)}</div>
          <div><span class="text-muted">Amt Paid:</span> ₹${Number(c.totalAmtPaid||0).toLocaleString("en-IN")}</div>
          <div><span class="text-muted">Initiated By:</span> ${c.initiatedBy||"-"}</div>
        </div>
        <hr class="divider"/>
        <div style="font-weight:600;margin-bottom:8px">Case Summary</div>
        <div style="font-size:13px;background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:16px">${c.caseSummary||"No summary available."}</div>
        <div style="font-weight:600;margin-bottom:8px">Timeline (${tl.length} entries)</div>
        ${tl.length?`<ul class="timeline">${tl.map(t=>`<li><div class="tl-meta">${t.logTimestamp}</div><div class="tl-event">${t.eventType}: ${t.summary}</div></li>`).join("")}</ul>`:`<div class="text-muted" style="font-size:13px">No timeline entries yet.</div>`}
        <hr class="divider"/>
        <div class="btn-row"><button class="btn btn-outline btn-sm" onclick="closeModal()">Close</button></div>`;
    document.getElementById("case-modal").classList.add("open");
}
function closeModal() { document.getElementById("case-modal").classList.remove("open"); }
window.onclick = function(e) { if (e.target==document.getElementById("case-modal")) closeModal(); };

// ══════════════════════════════════════
//  VALIDATION & FILE HELPERS
// ══════════════════════════════════════
function validateCaseId(id) {
    const val=document.getElementById(id).value;
    if (val&&!DB.cases.find(c=>c.caseId===val)) { toast("Invalid Case ID!", "error"); document.getElementById(id).value=""; }
}
function handleDragOver(e,zoneId) { e.preventDefault(); document.getElementById(zoneId).classList.add("dragover"); }
function handleDragLeave(e,zoneId) { document.getElementById(zoneId).classList.remove("dragover"); }
function handleDrop(e,zoneId,dataId,chipId) { e.preventDefault(); document.getElementById(zoneId).classList.remove("dragover"); const f=e.dataTransfer.files[0]; if(f) processFile(f,zoneId,dataId,chipId); }
function handleFileSelect(e,zoneId,dataId,chipId) { const f=e.target.files[0]; if(f) processFile(f,zoneId,dataId,chipId); }
function processFile(file,zoneId,dataId,chipId) {
    const reader=new FileReader();
    reader.onload=ev=>{
        document.getElementById(dataId).value=ev.target.result;
        const chipEl=document.getElementById(chipId);
        const isImg=file.type.startsWith("image/");
        chipEl.innerHTML=`<div class="file-chip"><span>${isImg?"🖼️":"📄"} <strong>${file.name}</strong></span><span class="remove-file" onclick="clearFileUpload('${chipId}','${dataId}','${zoneId}')">✕</span></div>`;
    };
    reader.readAsDataURL(file);
}
function clearFileUpload(chipId,dataId,zoneId) {
    document.getElementById(chipId).innerHTML=""; document.getElementById(dataId).value="";
    const inp=document.getElementById(zoneId)?document.getElementById(zoneId).querySelector("input[type=file]"):null;
    if(inp) inp.value="";
}
function resolveFileLink(dataId,urlInputId) {
    const data=document.getElementById(dataId)?document.getElementById(dataId).value:"";
    const url=document.getElementById(urlInputId)?document.getElementById(urlInputId).value.trim():"";
    return data||url;
}
function updateCaseMasterField(caseId,field,value) {
    const c=DB.cases.find(x=>x.caseId===caseId); if(c){c[field]=value;return true;} return false;
}
function getFilePreviewHTML(link) {
    if (!link||link==="-") return '<span style="color:#ccc">No File</span>';
    if (link.startsWith("http")) return `<a href="${link}" target="_blank" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;">👁️ View</a>`;
    return `<button onclick="openBase64InNewTab(this.getAttribute('data-b64'))" data-b64="${link}" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;">👁️ View</button>`;
}
function openBase64InNewTab(base64) {
    try { const w=window.open(); w.document.write(`<iframe src="${base64}" frameborder="0" style="width:100%;height:100%;border:0;"></iframe>`); }
    catch(e) { alert("Could not preview file."); }
}

// ══════════════════════════════════════
//  TIMELINE
// ══════════════════════════════════════
function addTimelineEntry(caseId,eventDate,source,eventType,summary) {
    DB.timeline.push({ id:uid("TL"), caseId, eventDate, source, eventType, summary, logTimestamp:nowIST() });
}
function renderTimeline() {
    const filter=document.getElementById("tl-filter")?document.getElementById("tl-filter").value:"";
    const container=document.getElementById("timeline-container");
    if (!container) return;
    const entries=DB.timeline.filter(e=>!filter||e.caseId===filter).sort((a,b)=>new Date(b.logTimestamp)-new Date(a.logTimestamp));
    if (!entries.length) { container.innerHTML=`<div class="empty-state"><span class="emoji">🕒</span>No timeline entries yet.</div>`; return; }
    const sc={CASE_CREATION:"background:#e8f0fe;color:#1a73e8",HISTORY:"background:#fef7e0;color:#e65100",ACTION:"background:#e6f4ea;color:#1e7e34",COMMUNICATION:"background:#f3e8ff;color:#7c3aed"};
    container.innerHTML=`<ul class="timeline">${entries.map(e=>`<li>
        <div class="tl-meta"><strong>${e.logTimestamp}</strong> | <span class="case-id-display">${e.caseId}</span> | <span class="badge" style="${sc[e.source]||''}">${e.source}</span></div>
        <div class="tl-event"><strong>${e.eventType}:</strong> ${e.summary}</div>
    </li>`).join("")}</ul>`;
}

// ══════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════
async function submitHistory() {
    const get=id=>document.getElementById(id)?document.getElementById(id).value.trim():"";
    const caseId=get("hu-caseid"),eventDate=get("hu-date"),summary=get("hu-summary");
    if (!caseId||!eventDate||!summary) { toast("Fill required fields (Case, Date, Summary)", "error"); return; }
    const row={histId:uid("HIST"),caseId,eventDate,histType:document.getElementById("hu-type").value,summary,notes:get("hu-notes"),fileLink:resolveFileLink("hu-file-data","hu-file"),source:get("hu-source"),enteredBy:get("hu-enteredby"),timestamp:nowIST()};
    DB.history.push(row);
    addTimelineEntry(caseId,eventDate,"HISTORY",row.histType,summary);
    renderHistoryTable();
    toast("History saved! Syncing...", "success");
    ["hu-summary","hu-notes","hu-file","hu-source","hu-enteredby","hu-file-data"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    const chip=document.getElementById("hu-file-chip"); if(chip) chip.innerHTML="";
    await saveDB();
}
function renderHistoryTable() {
    const body=document.getElementById("hist-body");
    if (!body) return;
    if (!DB.history.length) { body.innerHTML=`<tr><td colspan="7"><div class="empty-state">No history entries yet.</div></td></tr>`; return; }
    body.innerHTML=DB.history.slice().reverse().map(h=>`<tr>
        <td><span class="case-id-display">${h.histId}</span></td>
        <td><span class="case-id-display">${h.caseId}</span></td>
        <td>${h.eventDate}</td><td>${h.histType}</td><td>${h.summary}</td>
        <td>${getFilePreviewHTML(h.fileLink)}</td>
        <td>${h.enteredBy||"-"}</td>
    </tr>`).join("");
}

// ══════════════════════════════════════
//  ACTION LOG
// ══════════════════════════════════════
async function submitAction() {
    const get=id=>document.getElementById(id)?document.getElementById(id).value.trim():"";
    const caseId=get("al-caseid"),summary=get("al-summary");
    if (!caseId||!summary) { toast("Select Case ID and enter Action Summary", "error"); return; }
    const actionType=document.getElementById("al-type").value;
    if (actionType==="Refund Request"&&!canRaiseRefundRequest()) { toast("Only Admin or Operations can raise a refund request.", "error"); return; }
    const row={
        actionId:uid("ACT"),caseId,dateTime:nowIST(),dept:document.getElementById("al-dept").value,
        doneBy:get("al-doneby")||currentUserEmail(),actionType,summary,notes:get("al-notes"),
        clientResp:get("al-clientresp"),observation:get("al-obs"),nextAction:get("al-nextaction"),
        nextActionBy:get("al-nextby"),nextActionDate:get("al-nextdate"),fileLink:resolveFileLink("al-file-data","al-file")
    };
    if (actionType==="Refund Request") {
        row.status="Pending Approval"; row.refundStatus="Pending Approval";
        row.requestedByEmail=currentUserEmail(); row.requestedByRole=currentRole(); row.requestedAt=nowIST();
    }
    DB.actions.push(row);
    logActivity("ACTION_LOG",`Performed ${row.actionType}: ${summary}`,caseId);
    addTimelineEntry(caseId,row.dateTime,"ACTION",row.actionType,summary);
    updateCaseMasterField(caseId,"lastUpdateDate",nowIST());
    updateCaseMasterField(caseId,"nextActionDate",row.nextActionDate);
    updateCaseMasterField(caseId,"lastActionSummary",summary);
    const ns=document.getElementById("al-status").value;
    if (actionType==="Refund Request") updateCaseMasterField(caseId,"currentStatus","Refund Pending Approval");
    else if (ns) updateCaseMasterField(caseId,"currentStatus",ns);
    renderActionTable(); renderRefundApprovals(); renderRefundDashboard();
    toast(actionType==="Refund Request"?"Refund request sent for approval!":"Action logged! Syncing...", "success");
    ["al-doneby","al-nextby","al-summary","al-notes","al-clientresp","al-obs","al-nextaction","al-nextdate","al-file","al-file-data"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    const chip=document.getElementById("al-file-chip"); if(chip) chip.innerHTML="";
    document.getElementById("al-status").value="";
    await saveDB();
}
function renderActionTable() {
    const body=document.getElementById("action-body");
    if (!body) return;
    if (!DB.actions.length) { body.innerHTML=`<tr><td colspan="10"><div class="empty-state">No actions logged yet.</div></td></tr>`; return; }
    body.innerHTML=DB.actions.slice().reverse().map(a=>`<tr>
        <td><span class="case-id-display">${a.actionId}</span></td>
        <td><span class="case-id-display">${a.caseId}</span></td>
        <td>${a.dateTime}</td><td>${a.actionType}</td><td>${a.dept}</td>
        <td>${a.doneBy||"-"}</td><td>${a.summary}</td>
        <td>${getFilePreviewHTML(a.fileLink)}</td>
        <td>${a.actionType==="Refund Request"?formatRefundStatus(a.refundStatus||a.status):"-"}</td>
        <td>${a.nextActionDate||"-"}</td>
    </tr>`).join("");
}

// ══════════════════════════════════════
//  COMM LOG
// ══════════════════════════════════════
async function submitCommLog() {
    const get=id=>document.getElementById(id)?document.getElementById(id).value.trim():"";
    const caseId=get("cl-caseid"),summary=get("cl-summary");
    if (!caseId||!summary) { toast("Select Case ID and enter Summary", "error"); return; }
    const row={commId:uid("COMM"),caseId,dateTime:get("cl-datetime")||nowIST(),mode:document.getElementById("cl-mode").value,direction:document.getElementById("cl-dir").value,fromTo:get("cl-fromto"),summary,exactDemand:get("cl-exact"),refundDemanded:get("cl-refund"),legalThreat:document.getElementById("cl-legal").value,smMentioned:document.getElementById("cl-sm").value,fileLink:resolveFileLink("cl-file-data","cl-file"),loggedBy:get("cl-loggedby"),timestamp:nowIST()};
    DB.comms.push(row);
    addTimelineEntry(caseId,row.dateTime,"COMMUNICATION",`${row.mode} ${row.direction}`,summary);
    updateCaseMasterField(caseId,"lastUpdateDate",nowIST());
    renderCommTable();
    toast("Communication logged! Syncing...", "success");
    ["cl-fromto","cl-summary","cl-exact","cl-refund","cl-file","cl-file-data","cl-loggedby","cl-datetime"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    const chip=document.getElementById("cl-file-chip"); if(chip) chip.innerHTML="";
    await saveDB();
}
function renderCommTable() {
    const body=document.getElementById("comm-body");
    if (!body) return;
    if (!DB.comms.length) { body.innerHTML=`<tr><td colspan="9"><div class="empty-state">No communications logged yet.</div></td></tr>`; return; }
    body.innerHTML=DB.comms.slice().reverse().map(c=>`<tr>
        <td><span class="case-id-display">${c.commId}</span></td>
        <td><span class="case-id-display">${c.caseId}</span></td>
        <td>${c.dateTime}</td><td>${c.mode}</td><td>${c.direction}</td>
        <td>${c.fromTo||"-"}</td><td>${c.summary}</td>
        <td>${getFilePreviewHTML(c.fileLink)}</td>
        <td>${c.legalThreat!=="No"?"⚠️ Yes":"No"}</td>
    </tr>`).join("");
}

// ══════════════════════════════════════
//  DOCUMENT INDEX
// ══════════════════════════════════════
async function submitDocUpload() {
    const get=id=>document.getElementById(id)?document.getElementById(id).value.trim():"";
    const caseId=get("di-caseid"),fileLink=resolveFileLink("di-file-data","di-file-url");
    if (!caseId||!fileLink) { toast("Select Case ID and attach a file!", "error"); return; }
    const docRow={docId:uid("DOC"),caseId,uploadDate:nowIST(),sourceForm:"MANUAL_UPLOAD",docType:get("di-doctype"),fileSummary:get("di-summary")||get("di-doctype"),fileLink,uploadedBy:get("di-uploadedby"),remarks:get("di-remarks")};
    DB.docs.push(docRow);
    addTimelineEntry(caseId,nowIST(),"DOCUMENT",docRow.docType,"Manual Upload: "+docRow.fileSummary);
    renderDocIndex();
    toast("Document indexed! Syncing...", "success");
    ["di-summary","di-uploadedby","di-remarks","di-file-url","di-file-data"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    const chip=document.getElementById("di-file-chip"); if(chip) chip.innerHTML="";
    document.getElementById("di-caseid").value="";
    await saveDB();
}
function renderDocIndex() {
    const q=(document.getElementById("di-search")?document.getElementById("di-search").value:"").toLowerCase();
    const body=document.getElementById("doc-body");
    if (!body) return;
    const filtered=DB.docs.filter(d=>!q||JSON.stringify(d).toLowerCase().includes(q));
    if (!filtered.length) { body.innerHTML=`<tr><td colspan="8"><div class="empty-state"><span class="emoji">📁</span>No documents indexed yet.</div></td></tr>`; return; }
    body.innerHTML=filtered.slice().reverse().map(d=>`<tr>
        <td><span class="case-id-display">${d.docId}</span></td>
        <td><span class="case-id-display">${d.caseId}</span></td>
        <td>${d.uploadDate}</td>
        <td><span class="badge badge-pending" style="font-size:10px">${d.sourceForm}</span></td>
        <td>${d.docType}</td><td>${d.fileSummary}</td>
        <td>${renderDocLink(d.fileLink,d.fileSummary)}</td>
        <td>${d.uploadedBy||"-"}</td>
    </tr>`).join("");
}
function renderDocLink(link,fileName) {
    if (!link) return "-";
    if (link.startsWith("https://drive.google.com")) return `<a href="${link}" target="_blank" style="color:var(--blue);font-weight:600;">🔗 Drive</a>`;
    if (link.startsWith("data:")) return `<a href="${link}" download="${fileName||'file'}" style="color:var(--green);">⬇ Download</a>`;
    return `<a href="${link}" target="_blank">🔗 View</a>`;
}

// ══════════════════════════════════════
//  CASE STUDY
// ══════════════════════════════════════
function renderStudyControl() {
    const body=document.getElementById("study-control-body");
    if (!body) return;
    if (!DB.studyControl||!DB.studyControl.length) { body.innerHTML=`<tr><td colspan="3"><div class="empty-state text-muted">No entries</div></td></tr>`; return; }
    body.innerHTML=DB.studyControl.map(s=>`<tr>
        <td><span class="case-id-display">${s.caseId}</span></td>
        <td><span class="badge ${s.status==='Study Generated'?'badge-closed':'badge-pending'}">${s.status}</span></td>
        <td>${s.lastRefreshDate||"-"}</td>
    </tr>`).join("");
}

async function generateCaseStudy() {
    const caseId=document.getElementById("cs-caseid").value;
    if (!caseId) { toast("Select a Case ID first.", "error"); return; }
    const c=DB.cases.find(x=>x.caseId===caseId);
    if (!c) { toast("Case data not found.", "error"); return; }
    let sc=DB.studyControl.find(s=>s.caseId===caseId);
    if (sc) { sc.lastRefreshDate=nowIST(); sc.status="Study Generated"; }
    else DB.studyControl.push({caseId,status:"Study Generated",lastRefreshDate:nowIST()});
    renderStudyControl();
    const tl=DB.timeline.filter(t=>t.caseId===caseId).sort((a,b)=>new Date(a.eventDate)-new Date(b.eventDate));
    const actions=DB.actions.filter(a=>a.caseId===caseId).sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));
    const comms=DB.comms.filter(cm=>cm.caseId===caseId).sort((a,b)=>new Date(a.dateTime)-new Date(b.dateTime));
    document.getElementById("cs-empty").style.display="none";
    const preview=document.getElementById("case-study-preview"); preview.style.display="block";
    document.getElementById("cs-preview-title").textContent="📄 Case Study – "+caseId;
    const css=`<style>.cs-table{width:100%;border-collapse:collapse;margin-bottom:20px}.cs-table th{background:#1a73e8;color:white;padding:10px;text-align:left;text-transform:uppercase;font-size:13px}.cs-table td{padding:8px 12px;border:1px solid #dadce0;font-size:13px;color:#3c4043}.cs-label{font-weight:600;background:#f8f9fa;width:30%}</style>`;
    document.getElementById("cs-preview-content").innerHTML=css+`
        <table class="cs-table"><tr><th colspan="2">CASE OVERVIEW</th></tr>
          <tr><td class="cs-label">Case ID</td><td>${c.caseId}</td></tr>
          <tr><td class="cs-label">Created</td><td>${c.createdDate}</td></tr>
          <tr><td class="cs-label">Company</td><td>${c.companyName}</td></tr>
          <tr><td class="cs-label">Case Title</td><td>${c.caseTitle}</td></tr>
          <tr><td class="cs-label">Client</td><td>${c.clientName}</td></tr>
          <tr><td class="cs-label">Mobile</td><td>${c.clientMobile}</td></tr>
          <tr><td class="cs-label">Email</td><td>${c.clientEmail||"-"}</td></tr>
          <tr><td class="cs-label">State</td><td>${c.state||"-"}</td></tr>
          <tr><td class="cs-label">Services</td><td>${c.servicesSold||"-"}</td></tr>
          <tr><td class="cs-label">Amount Paid</td><td>₹${Number(c.totalAmtPaid||0).toLocaleString("en-IN")}</td></tr>
          <tr><td class="cs-label">Amount in Dispute</td><td>₹${Number(c.amtInDispute||0).toLocaleString("en-IN")}</td></tr>
          <tr><td class="cs-label">MOU Signed</td><td>${c.mouSigned}</td></tr>
          <tr><td class="cs-label">Priority</td><td>${c.priority}</td></tr>
          <tr><td class="cs-label">Status</td><td>${c.currentStatus}</td></tr>
        </table>
        <table class="cs-table"><tr><th colspan="2">RISK PROFILE</th></tr>
          <tr><td class="cs-label">Social Media Risk</td><td>${c.smRisk}</td></tr>
          <tr><td class="cs-label">Consumer Complaint</td><td>${c.complaint}</td></tr>
          <tr><td class="cs-label">Police/Cyber Threat</td><td>${c.policeThreat}</td></tr>
        </table>
        <table class="cs-table"><tr><th colspan="2">CASE NARRATIVE</th></tr>
          <tr><td class="cs-label">Summary</td><td>${c.caseSummary||"-"}</td></tr>
          <tr><td class="cs-label">Allegation</td><td>${c.clientAllegation||"-"}</td></tr>
        </table>
        <table class="cs-table"><tr><th colspan="2">TEAM</th></tr>
          <tr><td class="cs-label">Initiated By</td><td>${c.initiatedBy||"-"}</td></tr>
          <tr><td class="cs-label">Accountable</td><td>${c.accountable||"-"}</td></tr>
          <tr><td class="cs-label">Legal Officer</td><td>${c.legalOfficer||"-"}</td></tr>
          <tr><td class="cs-label">Accounts</td><td>${c.accounts||"-"}</td></tr>
        </table>
        <table class="cs-table"><tr><th colspan="4">TIMELINE (${tl.length})</th></tr>
          <tr style="background:#f1f3f4;font-weight:bold"><td>Date</td><td>Source</td><td>Type</td><td>Summary</td></tr>
          ${tl.map(t=>`<tr><td>${t.eventDate}</td><td>${t.source}</td><td>${t.eventType}</td><td>${t.summary}</td></tr>`).join("")||"<tr><td colspan='4'>No entries</td></tr>"}
        </table>
        <table class="cs-table"><tr><th colspan="4">ACTIONS (${actions.length})</th></tr>
          <tr style="background:#f1f3f4;font-weight:bold"><td>Date</td><td>Type</td><td>Done By</td><td>Summary</td></tr>
          ${actions.map(a=>`<tr><td>${a.dateTime}</td><td>${a.actionType}</td><td>${a.doneBy||"-"}</td><td>${a.summary}</td></tr>`).join("")||"<tr><td colspan='4'>No actions</td></tr>"}
        </table>
        <table class="cs-table"><tr><th colspan="4">COMMUNICATIONS (${comms.length})</th></tr>
          <tr style="background:#f1f3f4;font-weight:bold"><td>Date</td><td>Mode</td><td>Direction</td><td>Summary</td></tr>
          ${comms.map(cm=>`<tr><td>${cm.dateTime}</td><td>${cm.mode}</td><td>${cm.direction}</td><td>${cm.summary}</td></tr>`).join("")||"<tr><td colspan='4'>No communications</td></tr>"}
        </table>
        <div style="font-size:11px;color:#5f6368;text-align:center;margin-top:20px">Generated: ${nowIST()}</div>`;
    document.getElementById("cs-download-container").style.display="block";
    toast("Case Study compiled!", "success");
    await saveDB();
}

function downloadPDF() {
    const element=document.getElementById('cs-preview-content');
    const caseId=document.getElementById("cs-caseid").value;
    if (!element||!caseId) { toast("No data to download!", "error"); return; }
    const opt={margin:[10,10,10,10],filename:`Case_Study_${caseId}.pdf`,image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}};
    toast("Generating PDF...", "info");
    html2pdf().set(opt).from(element).save().then(()=>toast("PDF Downloaded!", "success"));
}

// ══════════════════════════════════════
//  SERVICES DYNAMIC
// ══════════════════════════════════════
function updateEngagementNote() {
    const mouAmtInput=document.getElementById("nc-mouval");
    const noteArea=document.getElementById("nc-engagement-note");
    if (!mouAmtInput||!noteArea) return;
    const val=mouAmtInput.value||"0";
    const formattedAmt=Number(val).toLocaleString('en-IN');
    noteArea.value=`This is a multi-stage consultancy and execution support engagement. ₹${formattedAmt} was formalized under the initial MOU, while the remaining amount was received towards extended scope, third-party facilitation, and stage-wise execution.`;
}
function toggleServiceMode() {
    const mode=document.getElementById("nc-service-mode")?document.getElementById("nc-service-mode").value:"single";
    const container=document.getElementById("services-container");
    const addBtnWrap=document.getElementById("add-service-btn-wrap");
    if (!container) return;
    container.innerHTML="";
    addServiceRow();
    if (addBtnWrap) addBtnWrap.style.display=mode==="multiple"?"block":"none";
    updateEngagementNote();
}
function addServiceRow() {
    const container=document.getElementById("services-container");
    if (!container) return;
    const mode=document.getElementById("nc-service-mode")?document.getElementById("nc-service-mode").value:"single";
    const rowCount=container.querySelectorAll('.service-row').length;
    const row=document.createElement("div");
    row.className="service-row";
    row.innerHTML=`
        ${mode==="multiple"&&rowCount>0?`<div class="remove-service" onclick="this.parentElement.remove()">✕</div>`:""}
        <div class="field"><label>Service Name</label><input class="s-name" placeholder="Enter service"></div>
        <div class="field"><label>Service Amount</label><input type="number" class="s-amt" placeholder="0"></div>
        <div class="field"><label>MOU Signed</label><select class="s-mou"><option>No</option><option>Yes</option></select></div>
        <div class="field"><label>Signed MOU Amount</label><input type="number" class="s-mou-amt" placeholder="0"></div>
        <div class="field"><label>Work Status</label>
            <select class="s-status">
                <option>Not Initiated</option><option>In Progress</option><option>Work in Progress</option>
                <option>Completed</option><option>Escalated</option><option>Hold</option>
                <option>File Not Eligible</option><option>QA Not Approved</option><option>Service Converted</option><option>NA</option>
            </select>
        </div>
        <div class="field"><label>BDA</label><input class="s-bda" placeholder="Name"></div>
        <div class="field"><label>Department</label>
            <select class="s-dept"><option>Operations</option><option>Loan</option><option>Digital Marketing</option></select>
        </div>`;
    container.appendChild(row);
}

// ══════════════════════════════════════
//  CONDITIONAL COMPLAINT FIELDS
// ══════════════════════════════════════
function handleComplaintTypeChange(val) {
    document.getElementById("cyber-extra").style.display=val==="Cyber Complaint"?"block":"none";
    document.getElementById("fir-extra").style.display=val==="FIR"?"block":"none";
    document.getElementById("consumer-extra").style.display=val==="Consumer Complaint"?"block":"none";
}
function addAckField() {
    const container=document.getElementById("ack-container");
    if (!container) return;
    const div=document.createElement("div");
    div.style="display:flex;gap:10px;margin-bottom:5px;";
    div.innerHTML=`<input class="ack-input" placeholder="Enter Acknowledgment Number" style="flex:1;"><button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>`;
    container.appendChild(div);
}

// ══════════════════════════════════════
//  AUTO TITLE GENERATOR
// ══════════════════════════════════════
function autoGenerateTitle() {
    const company=document.getElementById("nc-company").value.trim();
    const complaintType=document.getElementById("nc-complaint-type").value;
    const titleField=document.getElementById("nc-title");
    if (company&&complaintType&&complaintType!=="") titleField.value=`${complaintType} - ${company}`;
    else if (company) titleField.value=company;
    else titleField.value="";
}

// ══════════════════════════════════════
//  PERMISSIONS
// ══════════════════════════════════════
function allowedTabsForRole(role) {
    if (role==="Admin") return ["dashboard","new-case","case-master","history","action-log","comm-log","timeline","doc-index","case-study","admin-panel","internal-search"];
    if (role==="Operations") return ["dashboard","new-case","case-master","history","action-log","comm-log","timeline","doc-index","case-study","admin-panel","internal-search"];
    return ["new-case","history","action-log","comm-log","doc-index","internal-search"];
}
function applyPermissions() {
    const role=currentRole();
    const allowed=allowedTabsForRole(role);
    document.querySelectorAll(".tab").forEach(tab=>{ tab.style.display=allowed.includes(tab.dataset.tab)?"":" none"; });
    const refundCard=document.getElementById("refund-dashboard-card"); if(refundCard) refundCard.style.display=role==="Staff"?"none":"";
    const refundRequestCard=document.getElementById("refund-request-card"); if(refundRequestCard) refundRequestCard.style.display=canRaiseRefundRequest()?"":" none";
    const adminRefundCard=document.getElementById("admin-refund-card"); if(adminRefundCard) adminRefundCard.style.display=role==="Admin"?"":" none";
    const adminTab=document.querySelector('[data-tab="admin-panel"]'); if(adminTab) adminTab.textContent=role==="Admin"?"⚙️ Admin Panel":"⚙️ User Panel";
    const adminTitle=document.getElementById("admin-panel-title"); if(adminTitle) adminTitle.textContent=role==="Admin"?"Admin Panel":"Operations User Panel";
    const adminSub=document.getElementById("admin-panel-subtitle"); if(adminSub) adminSub.textContent=role==="Admin"?"Approve refunds and create users":"Create staff users and track refund requests";
    setupUserRoleOptions();
    applyActionTypePermissions();
}
function applyActionTypePermissions() {
    const select=document.getElementById("al-type"); if(!select) return;
    Array.from(select.options).forEach(opt=>{ if(opt.value==="Refund Request"){opt.hidden=!canRaiseRefundRequest();opt.disabled=!canRaiseRefundRequest();} });
    if (!canRaiseRefundRequest()&&select.value==="Refund Request") select.value="Negotiation Call";
}
function setupUserRoleOptions() {
    const roleSelect=document.getElementById("new-user-role");
    const title=document.getElementById("user-create-title");
    if (!roleSelect) return;
    if (isAdmin()) { roleSelect.innerHTML=`<option>Admin</option><option>Operations</option><option>Staff</option>`; if(title) title.textContent="👤 Create New User"; }
    else if (isOperations()) { roleSelect.innerHTML=`<option>Staff</option>`; if(title) title.textContent="👤 Create New Staff User"; }
}

// ══════════════════════════════════════
//  REFUND SYSTEM
// ══════════════════════════════════════
function refundRequesterLabel(action) { return action.doneBy||action.requestedByEmail||action.requestedByRole||"-"; }
function refundAmountSummary(action) {
    const amount=Number(action.refundAmount||0);
    const amountText=amount?`Rs. ${amount.toLocaleString("en-IN")}`:"";
    const summary=action.notes||action.summary||"-";
    if (!amountText) return summary;
    return `${amountText}<br><span class="text-muted" style="font-size:11px">${summary}</span>`;
}
async function submitRefundRequest() {
    if (!canRaiseRefundRequest()) { toast("Only Admin or Operations can raise a refund request.", "error"); return; }
    const caseId=document.getElementById("rr-caseid").value;
    const amount=document.getElementById("rr-amount").value.trim();
    const summary=document.getElementById("rr-summary").value.trim();
    const requestedBy=document.getElementById("rr-requestedby").value.trim()||currentUserEmail();
    if (!caseId||!amount||!summary) { toast("Please select Case ID, enter refund amount, and write summary.", "error"); return; }
    if (Number(amount)<=0) { toast("Refund amount must be greater than 0.", "error"); return; }
    normalizeDBShape();
    const createdAt=nowIST();
    const formattedAmount=Number(amount).toLocaleString("en-IN");
    const row={actionId:uid("ACT"),caseId,dateTime:createdAt,dept:"Operations",doneBy:requestedBy,actionType:"Refund Request",summary:`Refund request for Rs. ${formattedAmount}`,notes:summary,refundAmount:amount,clientResp:"",observation:"",nextAction:"Admin approval required",nextActionBy:"Admin",nextActionDate:"",fileLink:"",status:"Pending Approval",refundStatus:"Pending Approval",requestedByEmail:currentUserEmail(),requestedByRole:currentRole(),requestedAt:createdAt};
    DB.actions.push(row);
    addTimelineEntry(caseId,createdAt,"ACTION","Refund Request",`Refund request submitted: Rs. ${formattedAmount} - ${summary}`);
    logActivity("REFUND",`Refund request submitted for Rs. ${formattedAmount}`,caseId);
    updateCaseMasterField(caseId,"lastUpdateDate",createdAt);
    updateCaseMasterField(caseId,"currentStatus","Refund Pending Approval");
    renderActionTable(); renderRefundApprovals(); renderRefundDashboard(); updateDashboard();
    ["rr-amount","rr-summary","rr-requestedby"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    document.getElementById("rr-caseid").value="";
    toast("Refund request sent to Admin for approval.", "success");
    await saveDB();
}
function renderRefundApprovals() {
    const body=document.getElementById("refund-body"); if(!body) return;
    if (!isAdmin()) { body.innerHTML=`<tr><td colspan="5"><div class="empty-state">Only Admin can approve refunds.</div></td></tr>`; return; }
    normalizeDBShape();
    const pending=DB.actions.filter(a=>a.actionType==="Refund Request"&&(a.refundStatus||a.status||"Pending Approval")!=="Approved");
    if (!pending.length) { body.innerHTML=`<tr><td colspan="5"><div class="empty-state">No pending refund approvals.</div></td></tr>`; return; }
    body.innerHTML=pending.slice().reverse().map(a=>`<tr>
        <td><span class="case-id-display">${a.caseId}</span></td>
        <td>${refundAmountSummary(a)}</td>
        <td>${refundRequesterLabel(a)}</td>
        <td>${a.requestedAt||a.dateTime||"-"}</td>
        <td><button class="btn btn-success btn-sm" onclick="approveRefund('${a.actionId}')">Approve</button></td>
    </tr>`).join("");
}
function renderRefundDashboard() {
    const body=document.getElementById("refund-dashboard-body"); if(!body) return;
    normalizeDBShape();
    const email=currentUserEmail(),role=currentRole();
    let rows=DB.actions.filter(a=>a.actionType==="Refund Request");
    if (role==="Staff") rows=[];
    else if (role==="Operations") rows=rows.filter(a=>!a.requestedByEmail||a.requestedByEmail===email);
    if (!rows.length) { body.innerHTML=`<tr><td colspan="5"><div class="empty-state">No refund requests yet.</div></td></tr>`; return; }
    body.innerHTML=rows.slice().reverse().map(a=>`<tr>
        <td><span class="case-id-display">${a.caseId}</span></td>
        <td>${refundAmountSummary(a)}</td>
        <td>${refundRequesterLabel(a)}</td>
        <td>${formatRefundStatus(a.refundStatus||a.status)}</td>
        <td>${a.approvedAt?`Approved by ${a.approvedBy||"Admin"} on ${a.approvedAt}`:"Waiting for Admin approval"}</td>
    </tr>`).join("");
}
async function approveRefund(actionId) {
    if (!isAdmin()) { toast("Only Admin can approve refunds.", "error"); return; }
    const action=DB.actions.find(a=>a.actionId===actionId);
    if (!action) { toast("Refund request not found.", "error"); return; }
    action.status="Approved"; action.refundStatus="Approved";
    action.approvedBy=currentUserEmail()||"Admin"; action.approvedAt=nowIST();
    updateCaseMasterField(action.caseId,"currentStatus","Refund Approved");
    addTimelineEntry(action.caseId,action.approvedAt,"ACTION","Refund Approved",`Refund approved by ${action.approvedBy}`);
    logActivity("REFUND","Refund approved by Admin",action.caseId);
    toast("Refund Approved!", "success");
    renderRefundApprovals(); renderRefundDashboard(); renderActionTable(); updateDashboard();
    await saveDB();
}
async function createNewUser() {
    if (!isAdmin()&&!isOperations()) { toast("No permission to create users.", "error"); return; }
    const email=document.getElementById("new-user-email").value.trim();
    const pass=document.getElementById("new-user-pass").value.trim();
    const role=document.getElementById("new-user-role").value;
    if (!email||!pass) { toast("Email and password are required.", "error"); return; }
    if (isOperations()&&role!=="Staff") { toast("Operations can create Staff users only.", "error"); return; }
    await fetch(SCRIPT_URL,{method:"POST",body:JSON.stringify({action:"createUser",email,pass,role}),mode:"no-cors"});
    document.getElementById("new-user-email").value=""; document.getElementById("new-user-pass").value="";
    toast("User Created Successfully!", "success");
}

// ══════════════════════════════════════
//  AUDIT LOG
// ══════════════════════════════════════
function logActivity(category,description,caseId="N/A") {
    if (!DB.auditLogs) DB.auditLogs=[];
    DB.auditLogs.push({id:uid("LOG"),timestamp:nowIST(),user:localStorage.getItem("rrr_user_email")||"Unknown",role:localStorage.getItem("rrr_user_role")||"Unknown",category,description,caseId});
}

// ══════════════════════════════════════
//  BULK IMPORT CSV
// ══════════════════════════════════════
async function importCasesCSV(event) {
    const file=event.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async function(e){
        const lines=e.target.result.split(/\r?\n/);
        let count=0;
        for (let i=1;i<lines.length;i++){
            if (!lines[i].trim()) continue;
            const col=lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const clean=v=>v?v.replace(/^"|"$/g,"").trim():"";
            const row={caseId:clean(col[0])||generateCaseId(),createdDate:clean(col[1])||nowIST(),companyName:clean(col[2]),caseTitle:clean(col[3]),priority:clean(col[4]),sourceOfComplaint:clean(col[5]),typeOfComplaint:clean(col[6]),servicesSold:clean(col[7]),clientName:clean(col[8]),clientMobile:clean(col[9]),clientEmail:clean(col[10]),state:clean(col[11]),totalAmtPaid:clean(col[12])||"0",mouSigned:clean(col[13]),totalMouValue:clean(col[14])||"0",amtInDispute:clean(col[15])||"0",smRisk:clean(col[16]),complaint:clean(col[17]),policeThreat:clean(col[18]),caseSummary:clean(col[19]),clientAllegation:clean(col[20]),proofCallRec:clean(col[21]),proofWaChat:clean(col[22]),proofVideoCall:clean(col[23]),proofFundingEmail:clean(col[24]),initiatedBy:clean(col[25]),accountable:clean(col[26]),legalOfficer:clean(col[27]),accounts:clean(col[28]),currentStatus:clean(col[29])||"Open",lastUpdateDate:clean(col[30])||nowIST(),nextActionDate:clean(col[31]),cyberAckNumbers:clean(col[32]),firNumber:clean(col[33]),firFileLink:clean(col[34]),grievanceNumber:clean(col[35])};
            DB.cases.push(row);
            addTimelineEntry(row.caseId,row.createdDate,"CASE_CREATION","Imported","Bulk import via CSV");
            count++;
        }
        if (count>0) { refreshAllUI(); toast(`${count} cases imported! Syncing...`,"success"); await saveDB(); }
        else toast("No valid data in CSV.","error");
    };
    reader.readAsText(file);
    event.target.value="";
}

// ══════════════════════════════════════
//  DATA SEARCH (SAMPLE CSV)
// ══════════════════════════════════════
// ── 1. IMPORT SAMPLE CSV (Cloud Ready) ──
async function importSampleCSV(event) {
    const file = event.target.files[0]; 
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);
        
        // RAM data clear karein aur naya bharo
        DB.sampleData = []; 

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            // Regex use kiya taaki Company Name ke andar wale commas block na karein
            const col = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const clean = (val) => val ? val.replace(/^"|"$/g, "").trim() : "";

            // Mapping (A to L columns)
            DB.sampleData.push({
                date:    clean(col[0]),  // Date
                company: clean(col[1]),  // Company Name
                person:  clean(col[2]),  // Contact Person
                contact: clean(col[3]),  // Phone
                email:   clean(col[4]),  // Email
                service: clean(col[5]),  // Service
                bde:     clean(col[6]),  // BDE
                total:   clean(col[7]),  // Total Amount
                net:     clean(col[8]),  // Amt without GST
                status:  clean(col[9]),  // Work Status
                dept:    clean(col[10]), // Department
                mou:     clean(col[11])  // MOU Status
            });
        }

        toast(`${DB.sampleData.length} Records Uploaded Successfully!`, "success");
        
        // Frontend refresh karein
        renderSampleSearch(); 
        
        // Seedha Cloud par save karein (No localStorage needed)
        await saveDB(); 
    };
    reader.readAsText(file);
    event.target.value = ""; // Input clear karein agli file ke liye
}
function normalizeSampleSearchValue(v) { return (v||"").toString().toLowerCase().replace(/\s+/g," ").trim(); }
function renderSampleSearch() {
    const searchInput = document.getElementById("sample-search-input");
    const body = document.getElementById("sample-search-body");
    
    if (!body) return;

    // Data check
    if (!DB.sampleData || !DB.sampleData.length) { 
        body.innerHTML = `<tr><td colspan="12" class="empty-state">No data available in Cloud. Please upload CSV.</td></tr>`; 
        return; 
    }

    // Search query ko normalize karein
    const query = searchInput ? searchInput.value.toLowerCase().trim() : "";

    // Filtering Logic (Saari fields mein search karega)
    const filtered = !query ? DB.sampleData : DB.sampleData.filter(d => {
        return Object.values(d).some(val => 
            String(val).toLowerCase().includes(query)
        );
    });

    if (!filtered.length) { 
        body.innerHTML = `<tr><td colspan="12" class="empty-state">No matching results found for "${query}"</td></tr>`; 
        return; 
    }

    // Table rows generate karein (12 Columns)
    body.innerHTML = filtered.map(d => `
        <tr>
            <td style="white-space:nowrap">${d.date || "-"}</td>
            <td><strong>${d.company || "-"}</strong></td>
            <td>${d.person || "-"}</td>
            <td>${d.contact || "-"}</td>
            <td>${d.email || "-"}</td>
            <td>${d.service || "-"}</td>
            <td>${d.bde || "-"}</td>
            <td style="font-weight:bold; color:var(--green)">₹${d.total || "0"}</td>
            <td>₹${d.net || "0"}</td>
            <td><span class="badge ${d.status === 'Completed' ? 'badge-closed' : 'badge-pending'}">${d.status || "Pending"}</span></td>
            <td>${d.dept || "-"}</td>
            <td>${d.mou || "No"}</td>
        </tr>
    `).join("");
}

// ── 3. SEARCH INPUT HELPER (Optional but recommended) ──
// Ise Tab Switcher ya Initializer mein add karein
function setupSearchListener() {
    const input = document.getElementById("sample-search-input");
    if (input) {
        input.addEventListener("input", renderSampleSearch);
    }
}

// ══════════════════════════════════════
//  INIT
// ══════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    toggleServiceMode();
    updateEngagementNote();

    // On page load: make sure only dashboard shows, all others hidden
    document.querySelectorAll(".section").forEach(s => {
        s.style.setProperty("display", "none", "important");
    });
    const dash = document.getElementById("tab-dashboard");
    if (dash) dash.style.setProperty("display", "block", "important");

    if (!redirectIfLoggedOut()) {
        loadDB();
        applyPermissions();
    }
});