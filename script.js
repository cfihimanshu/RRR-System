//  1. LOGIN SECURITY CHECK (Sabse upar)
function redirectIfLoggedOut() {
    const isLoggedIn = localStorage.getItem("rrr_logged_in");
    console.log("Login Status Check:", isLoggedIn); // Debugging ke liye

    // Agar user logged in nahi hai, toh login.html par bhej do
    if (isLoggedIn !== "true") {
        console.log("Not logged in, redirecting...");
        window.location.replace("login.html");
        return true;
    }
    return false;
}

redirectIfLoggedOut();
window.addEventListener("pageshow", redirectIfLoggedOut);


// ══════════════════════════════════════
//  STATE — Google Sheets Sync Configuration
// ══════════════════════════════════════
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx_xCWWCoBc3wj-trWKYt4wYx18Od6DVOUYCgGYITooQt8d_9Mckv6dJlu_SfjnblugfA/exec";
const LS_KEY = "RRR_DB_v1";


// Global Data Object
let DB = { cases:[], history:[], actions:[], comms:[], docs:[], timeline:[], studyControl:[] };

function normalizeDBShape() {
  DB = DB || {};
  ["cases","history","actions","comms","docs","timeline","studyControl"].forEach(key => {
    if (!Array.isArray(DB[key])) DB[key] = [];
  });
}


async function loadDB() {
  console.log("Fetching from Cloud...");
  try {
    // Redirect ko handle karne ke liye simple fetch
    const response = await fetch(SCRIPT_URL);
    if (!response.ok) throw new Error('Network response was not ok');
    
    const data = await response.json();
    if (data && data.cases) {
      DB = data;
      normalizeDBShape();
      console.log("Cloud Data Loaded");
      updateDashboard();
      refreshDropdowns();
      refreshNavCount();
      renderHistoryTable(); // History table refresh karein
      renderRefundApprovals();
      renderRefundDashboard();
      applyPermissions();
    }
  } catch (e) {
    console.error("Cloud load failed:", e);
    // Error aane par local storage load karein
    const localData = localStorage.getItem("RRR_DB_v1");
    if (localData) DB = JSON.parse(localData);
    normalizeDBShape();
    updateDashboard();
    renderRefundApprovals();
    renderRefundDashboard();
    applyPermissions();
  }
}

async function saveDB() {
  try {
    // 1. Cloud Sync (Pehle Google Sheet par bhejein)
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(DB),
      mode: "no-cors"
    });
    console.log("Synced to Cloud successfully");

    // 2. Local Storage Sync (Safe way)
    // Hum local storage mein sirf text data save karenge, files nahi taaki memory na bhare
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(DB));
    } catch (e) {
      console.warn("Local storage full, skipping local backup. Cloud is safe.");
    }
  } catch (e) {
    console.error("Sync failed", e);
    toast("Sync failed! Check internet.", "error");
  }
}

// ══════════════════════════════════════
//  SYSTEM HELPERS
// ══════════════════════════════════════

function nowIST() { return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); }
function todayDate() { return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }); }
function uid(prefix) { return prefix + "-" + Date.now() + "-" + Math.floor(Math.random()*1000); }

function generateCaseId() {
  const yr = new Date().getFullYear();
  const nums = DB.cases.map(c => {
    const parts = (c.caseId+"").split("-");
    return parts.length > 2 ? parseInt(parts[2]) : 0;
  });
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `CASE-${yr}-${String(next).padStart(4,"0")}`;
}

function toast(msg, type="info") {
  const t = document.getElementById("toast");
  const el = document.createElement("div");
  el.className = "toast-msg" + (type==="success"?" success":type==="error"?" error":"");
  el.textContent = (type==="success"?"✅ ":type==="error"?"❌ ":"ℹ️ ") + msg;
  t.appendChild(el);
  setTimeout(() => { el.style.opacity="0"; setTimeout(()=>el.remove(),400); }, 3000);
}

function normalizeRole(role) {
  const r = (role || "").toString().trim().toLowerCase();
  if (r === "admin") return "Admin";
  if (r === "operations" || r === "operation") return "Operations";
  if (r === "staff") return "Staff";
  return "Staff";
}

function currentRole() { return normalizeRole(localStorage.getItem("rrr_user_role")); }
function currentUserEmail() { return (localStorage.getItem("rrr_user_email") || "").trim().toLowerCase(); }
function isAdmin() { return currentRole() === "Admin"; }
function isOperations() { return currentRole() === "Operations"; }
function canRaiseRefundRequest() { return isAdmin() || isOperations(); }

function formatRefundStatus(status) {
  const s = status || "Pending Approval";
  const cls = s === "Approved" ? "badge-closed" : s === "Rejected" ? "badge-high" : "badge-pending";
  return `<span class="badge ${cls}">${s}</span>`;
}


document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    // 1. UI reset karein
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
    
    // 2. Clicked tab ko active karein
    tab.classList.add("active");
    const targetSection = document.getElementById("tab-" + tab.dataset.tab);
    if (targetSection) targetSection.classList.add("active");

    // 3. Dropdowns refresh karein (Case IDs populate karne ke liye)
    refreshDropdowns();
    
    // 4. Check karein kaunsa tab khula hai aur uska specific function chalaein
    const view = tab.dataset.tab;

    if (view === "dashboard") {
      updateDashboard();
    } 
    else if (view === "case-master") {
      if (typeof renderCaseMaster === "function") renderCaseMaster();
    } 
    else if (view === "timeline") {
      if (typeof renderTimeline === "function") renderTimeline();
    } 
    else if (view === "doc-index") {
      if (typeof renderDocIndex === "function") renderDocIndex();
    } 
    else if (view === "history") {
      if (typeof renderHistoryTable === "function") renderHistoryTable();
    } 
    else if (view === "action-log") {
      if (typeof renderActionTable === "function") renderActionTable();
    } 
    else if (view === "comm-log") {
      if (typeof renderCommTable === "function") renderCommTable();
    }
    else if (view === "case-study") {
      if (typeof renderStudyControl === "function") renderStudyControl();
    }
    else if (view === "admin-panel") {
      if (typeof renderRefundApprovals === "function") renderRefundApprovals();
      if (typeof setupUserRoleOptions === "function") setupUserRoleOptions();
    }
    else if (view === "internal-search") {
      if (typeof renderSampleSearch === "function") renderSampleSearch();
    }
  });
});

// 2. LOGOUT FUNCTION (Global scope mein)
window.logout = function() {
    if (confirm("Are you sure you want to logout?")) {
        localStorage.removeItem("rrr_logged_in");
        localStorage.removeItem("rrr_user_role");
        localStorage.removeItem("rrr_user_email");
        window.location.replace("login.html");
    }
};
// function refreshNavCount() {
//   document.getElementById("navbar-case-count").textContent = DB.cases.length + " cases";
// }

function refreshDropdowns() {
  const ids = ["hu-caseid","al-caseid","cl-caseid","cs-caseid","tl-filter","di-caseid","rr-caseid"];
  ids.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = id === "tl-filter" ? `<option value="">-- All Cases --</option>` : `<option value="">-- Select Case --</option>`;
    DB.cases.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.caseId;
      opt.textContent = `${c.caseId} - ${c.clientName}`;
      if (c.caseId === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}


async function submitNewCase() {
  const get = id => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
  };
  
  // Validation
  if (!get("nc-company") || !get("nc-title") || !get("nc-client") || !get("nc-summary")) {
    toast("Required fields missing! (Company, Title, Client, Summary)", "error");
    return;
  }

  try {
    // ─── DYNAMIC SERVICES LOGIC START (Existing) ───
    const serviceRows = document.querySelectorAll(".service-row");
    let servicesData = [];
    serviceRows.forEach(row => {
      const name = row.querySelector(".s-name") ? row.querySelector(".s-name").value : "";
      const status = row.querySelector(".s-status") ? row.querySelector(".s-status").value : "";
      const amt = row.querySelector(".s-amt") ? row.querySelector(".s-amt").value : "0";
      if (name) {
        servicesData.push(`${name} [₹${amt}] (${status})`);
      }
    });
    const capturedServices = servicesData.join(", ");
    // ─── DYNAMIC SERVICES LOGIC END ───

    // ─── NEW CONDITIONAL COMPLAINT FIELDS LOGIC START (ADDED) ───
    // 1. Cyber Acknowledgment Numbers (Multiple inputs)
    const ackInputs = document.querySelectorAll(".ack-input");
    const capturedAcks = Array.from(ackInputs).map(i => i.value.trim()).filter(v => v).join(", ");

    // 2. FIR Details
    const capturedFirNum = get("nc-fir-num");
    const capturedFirFile = document.getElementById("nc-fir-file-data") ? document.getElementById("nc-fir-file-data").value : "";

    // 3. Consumer Grievance
    const capturedGrievance = get("nc-grievance-num");
    // ─── NEW CONDITIONAL COMPLAINT FIELDS LOGIC END ───

    const caseId = generateCaseId();
    const createdDate = nowIST();

    const row = {
      caseId, 
      createdDate,
      companyName: get("nc-company"),
      caseTitle: get("nc-title"),
      priority: get("nc-priority"),
      sourceOfComplaint: get("nc-business"),
      typeOfComplaint: get("nc-complaint-type"),
      servicesSold: capturedServices || get("nc-services"), 

      // New Conditional Fields Mapping
      cyberAckNumbers: capturedAcks,
      firNumber: capturedFirNum,
      firFileLink: capturedFirFile,
      grievanceNumber: capturedGrievance,

      clientName: get("nc-client"),
      clientMobile: get("nc-mobile"),
      clientEmail: get("nc-email"),
      state: get("nc-state"),
      totalAmtPaid: get("nc-amtpaid") || "0",
      mouSigned: get("nc-mou"),
      totalMouValue: get("nc-mouval") || "0",
      amtInDispute: get("nc-dispute") || "0",
      smRisk: get("nc-smrisk"),
      complaint: get("nc-complaint"),
      policeThreat: get("nc-police"),
      caseSummary: get("nc-summary"),
      clientAllegation: get("nc-allegation"),
      proofCallRec: get("nc-call-rec"),
      proofWaChat: get("nc-wa-chat"),
      proofVideoCall: get("nc-v-call"),
      proofFundingEmail: get("nc-funding-email"),
      initiatedBy: get("nc-lead"),
      accountable: get("nc-negotiator"),
      legalOfficer: get("nc-legal"),
      accounts: get("nc-accounts"),
      currentStatus: "Open",
      lastUpdateDate: createdDate
    };

    if (!DB.cases) DB.cases = [];
    DB.cases.push(row);
    logActivity("CASE_CREATION", `Created new case for ${row.clientName}`, caseId);

    // Safe Call to Timeline
    if (typeof addTimelineEntry === "function") {
      addTimelineEntry(caseId, createdDate, "CASE_CREATION", "Case Created", `New Case Registered (${row.typeOfComplaint})`);
    }
    
    // UI Updates
    updateDashboard();
    if (typeof renderCaseMaster === "function") renderCaseMaster();
    refreshDropdowns();
    refreshNavCount();

    // Redirect
    const tab = document.querySelector('[data-tab="case-master"]');
    if (tab) tab.click();

    toast("Case Created! Syncing...", "success");
    clearNewCaseForm();
    saveDB(); // Cloud sync

  } catch (error) {
    console.error("Submission Error Details:", error);
    toast("Error: " + error.message, "error");
  }
}
// ══════════════════════════════════════
//  DASHBOARD & TABLES
// ══════════════════════════════════════

function updateDashboard() {
  normalizeDBShape();
  document.getElementById("stat-total").textContent = DB.cases.length;
  document.getElementById("stat-open").textContent = DB.cases.filter(c => c.currentStatus === "Open").length;
  renderRefundDashboard();
  
  const body = document.getElementById("dash-recent-body");
  const recent = DB.cases.slice(-5).reverse();
  if (!recent.length) {
    body.innerHTML = `<tr><td colspan="6" class="empty-state">No cases found</td></tr>`;
    return;
  }
  body.innerHTML = recent.map(c => `
    <tr>
      <td><span class="case-id-display">${c.caseId}</span></td>
      <td>${c.clientName}</td>
      <td>${c.priority}</td>
      <td>${c.currentStatus}</td>
      <td>${c.lastUpdateDate}</td>
      <td>${c.nextActionDate || "-"}</td>
    </tr>
  `).join("");
}

function clearNewCaseForm() {
  // Saare basic inputs clear karein
  document.querySelectorAll("#tab-new-case input, #tab-new-case textarea").forEach(i => i.value = "");
  
  // Saare dropdowns reset karein
  document.querySelectorAll("#tab-new-case select").forEach(s => s.selectedIndex = 0);
  
  // Dynamic Services reset karein
  toggleServiceMode(); 
  
  // Files reset karein
  if(document.getElementById("fir-file-chip")) document.getElementById("fir-file-chip").innerHTML = "";
  document.getElementById("nc-fir-file-data").value = "";
}

// Case detail modal logic
function closeModal() { document.getElementById("case-modal").classList.remove("open"); }

// Clock
setInterval(() => {
  const el = document.getElementById("clock");
  if(el) el.textContent = new Date().toLocaleTimeString("en-IN", {timeZone:"Asia/Kolkata"});
}, 1000);

function renderCaseMaster() {
  const q      = (document.getElementById("cm-search").value||"").toLowerCase();
  const status = document.getElementById("cm-filter-status").value;
  const prio   = document.getElementById("cm-filter-priority").value;
  const body   = document.getElementById("cm-body");

  if (!body) return; // Error handling

  let filtered = DB.cases.filter(c => {
    const matchQ  = !q || JSON.stringify(c).toLowerCase().includes(q);
    const matchSt = !status || c.currentStatus === status;
    const matchPr = !prio   || c.priority === prio;
    return matchQ && matchSt && matchPr;
  }).slice().reverse();

  if (!filtered.length) { 
    body.innerHTML = `<tr><td colspan="12"><div class="empty-state"><span class="emoji">📂</span>No cases match your filter.</div></td></tr>`; 
    return; 
  }

  body.innerHTML = filtered.map(c => {
    return `<tr>
      <td><span class="case-id-display" style="cursor:pointer;color:var(--blue)" onclick="showCaseDetail('${c.caseId}')">${c.caseId}</span></td>
      <td>${c.createdDate}</td>
      <td>${c.clientName}<br><span class="text-muted" style="font-size:11px">${c.clientMobile}</span></td>
      <td>${c.companyName}</td>
      <td>${c.servicesSold||"-"}</td>
      <td>₹${Number(c.totalAmtPaid||0).toLocaleString("en-IN")}</td>
      <td>${priorityBadge(c.priority)}</td>
      <td>${statusBadge(c.currentStatus)}</td>
      <td>${c.initiatedBy || "-"}</td>
      <td>${c.lastUpdateDate}</td>
      <td>${c.nextActionDate||"-"}</td>
      <td><button class="btn btn-outline btn-sm" onclick="showCaseDetail('${c.caseId}')">👁 View</button></td>
    </tr>`;
  }).join("");
}
// Ye function har table row mein use karein
function getFilePreviewIcon(link) {
  if (!link) return "-";
  // Agar Google Drive link hai ya base64 image hai
  return `<a href="${link}" target="_blank" title="View Document" style="text-decoration:none; font-size:18px;">👁️</a>`;
}



// ── Badge Helpers (Missing Functions) ──
function statusBadge(s) {
  const map = { 
    "Open": "open", 
    "Closed": "closed", 
    "Settled": "settled", 
    "In Progress": "pending", 
    "Pending Response": "pending",
    "Refund Pending Approval": "pending",
    "Refund Approved": "closed"
  };
  const cls = map[s] || "open";
  return `<span class="badge badge-${cls}">${s || 'Open'}</span>`;
}

function priorityBadge(p) {
  const map = { 
    "High": "high", 
    "Medium": "medium", 
    "Low": "low" 
  };
  const cls = map[p] || "medium";
  return `<span class="badge badge-${cls}">${p || 'Medium'}</span>`;
}

// ── Case Detail Modal Functions ──

function getCaseRow(caseId) {
  return DB.cases.find(c => c.caseId === caseId) || null;
}

function showCaseDetail(caseId) {
  const c = getCaseRow(caseId);
  if (!c) {
    toast("Case not found!", "error");
    return;
  }
  
  // Timeline entries filter karein
  const tl = DB.timeline.filter(t => t.caseId === caseId).sort((a,b) => new Date(b.logTimestamp) - new Date(a.logTimestamp));

  const modalTitle = document.getElementById("modal-case-id-title");
  const modalBody = document.getElementById("modal-body");
  
  if (modalTitle) modalTitle.textContent = "📋 " + caseId + " — " + c.clientName;
  
  if (modalBody) {
    modalBody.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:16px">
        <div><span class="text-muted">Company:</span> <strong>${c.companyName}</strong></div>
        <div><span class="text-muted">Case Title:</span> ${c.caseTitle}</div>
        <div><span class="text-muted">Mobile:</span> ${c.clientMobile}</div>
        <div><span class="text-muted">Email:</span> ${c.clientEmail||"-"}</div>
        <div><span class="text-muted">Priority:</span> ${priorityBadge(c.priority)}</div>
        <div><span class="text-muted">Status:</span> ${statusBadge(c.currentStatus)}</div>
        <div><span class="text-muted">Amt Paid:</span> ₹${Number(c.totalAmtPaid||0).toLocaleString("en-IN")}</div>
        <div><span class="text-muted">Team Lead:</span> ${c.teamLead||"-"}</div>
      </div>
      <hr class="divider"/>
      <div style="font-weight:600;margin-bottom:8px">Case Summary</div>
      <div style="font-size:13px;background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:16px">${c.caseSummary || "No summary available."}</div>
      
      <div style="font-weight:600;margin-bottom:8px">Timeline (${tl.length} entries)</div>
      ${tl.length ? `<ul class="timeline">${tl.map(t=>`<li>
        <div class="tl-meta">${t.logTimestamp}</div>
        <div class="tl-event">${t.eventType}: ${t.summary}</div>
      </li>`).join("")}</ul>` : `<div class="text-muted" style="font-size:13px">No timeline entries yet.</div>`}
      
      <hr class="divider"/>
      <div class="btn-row">
        <button class="btn btn-outline btn-sm" onclick="closeModal()">Close</button>
      </div>`;
  }

  const modal = document.getElementById("case-modal");
  if (modal) modal.classList.add("open");
}

function closeModal() {
  const modal = document.getElementById("case-modal");
  if (modal) modal.classList.remove("open");
}

// Modal ke bahar click karne par close ho jaye
window.onclick = function(event) {
  const modal = document.getElementById("case-modal");
  if (event.target == modal) {
    closeModal();
  }
}

// ── 1. Validation Helper ──
function validateCaseId(id) {
  const val = document.getElementById(id).value;
  const exists = DB.cases.find(c => c.caseId === val);
  if (val && !exists) {
    toast("Invalid Case ID selected!", "error");
    document.getElementById(id).value = "";
  }
}

// ── 2. File Upload & Drag-and-Drop Helpers ──
function handleDragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add("dragover");
}

function handleDragLeave(e, zoneId) {
  document.getElementById(zoneId).classList.remove("dragover");
}

function handleDrop(e, zoneId, dataId, chipId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) processFile(file, zoneId, dataId, chipId);
}

function handleFileSelect(e, zoneId, dataId, chipId) {
  const file = e.target.files[0];
  if (file) processFile(file, zoneId, dataId, chipId);
}

function processFile(file, zoneId, dataId, chipId) {
  const reader = new FileReader();
  reader.onload = function(ev) {
    document.getElementById(dataId).value = ev.target.result; // Base64 Data
    renderFileChip(file, chipId, dataId, zoneId);
  };
  reader.readAsDataURL(file);
}

function renderFileChip(file, chipId, dataId, zoneId) {
  const chipEl = document.getElementById(chipId);
  const isImage = file.type.startsWith("image/");
  chipEl.innerHTML = `
    <div class="file-chip">
      <span>${isImage ? "🖼️" : "📄"} <strong>${file.name}</strong></span>
      <span class="remove-file" onclick="clearFileUpload('${chipId}','${dataId}','${zoneId}')">✕</span>
    </div>`;
}

function clearFileUpload(chipId, dataId, zoneId) {
  document.getElementById(chipId).innerHTML = "";
  document.getElementById(dataId).value = "";
  const inp = document.getElementById(zoneId).querySelector("input[type=file]");
  if (inp) inp.value = "";
}

// ── 3. Resolve File Link Helper ──
function resolveFileLink(dataId, urlInputId) {
  const data = document.getElementById(dataId).value; // Uploaded file
  const url = document.getElementById(urlInputId) ? document.getElementById(urlInputId).value.trim() : ""; // Pasted link
  return data ? data : url; 
}

// ── Update Case Master Field Helper ──
function updateCaseMasterField(caseId, field, value) {
  const c = DB.cases.find(item => item.caseId === caseId);
  if (c) {
    c[field] = value;
    console.log(`Updated ${field} for ${caseId}`);
    return true;
  }
  return false;
}

// 2. addTimelineEntry function (Ye zaroori hai data ko Timeline mein daalne ke liye)
function addTimelineEntry(caseId, eventDate, source, eventType, summary) {
  const entry = {
    id: uid("TL"),
    caseId: caseId,
    eventDate: eventDate,
    source: source, 
    eventType: eventType,
    summary: summary,
    logTimestamp: nowIST()
  };
  DB.timeline.push(entry);
}

async function submitHistory() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  
  const caseId = get("hu-caseid");
  const eventDate = get("hu-date");
  const summary = get("hu-summary");

  // 1. Validation: Zaroori fields check karein
  if (!caseId || !eventDate || !summary) {
    toast("Please fill all required fields (Case ID, Date, and Summary)", "error");
    return;
  }

  // 2. Data Object taiyaar karein
  const row = {
    histId: uid("HIST"),
    caseId: caseId,
    eventDate: eventDate,
    histType: document.getElementById("hu-type").value,
    summary: summary,
    notes: get("hu-notes"),
    fileLink: typeof resolveFileLink === "function" ? resolveFileLink("hu-file-data", "hu-file") : get("hu-file"),
    source: get("hu-source"),
    enteredBy: get("hu-enteredby"),
    timestamp: nowIST()
  };

  // 3. Local Arrays update karein
  if (!DB.history) DB.history = []; // Safety check
  DB.history.push(row);
  
  // Timeline mein add karein taaki Modal mein dikhe
  if (typeof addTimelineEntry === "function") {
    addTimelineEntry(caseId, eventDate, "HISTORY", row.histType, summary);
  }

  // UI Table update karein
  renderHistoryTable();
  
  // 4. Google Sheets par Sync karein
  toast("Syncing with Google Sheets...", "info");
  
  try {
    await saveDB(); 
    toast("History Saved to Cloud!", "success");

    // 5. Form Clear (Success hone ke baad hi clear karein)
    ["hu-summary", "hu-notes", "hu-file", "hu-source", "hu-enteredby", "hu-file-data"].forEach(id => {
      const el = document.getElementById(id); 
      if (el) el.value = "";
    });
    
    // File chip/preview reset karein
    const chip = document.getElementById("hu-file-chip");
    if (chip) chip.innerHTML = "";
    
    // Optional: Date aur Case select ko waisa hi rehne dein ya reset karein
    // document.getElementById("hu-date").value = "";

  } catch (err) {
    console.error("Sync Error:", err);
    toast("Saved locally, but Cloud sync failed.", "error");
  }
}

function renderHistoryTable() {
  const body = document.getElementById("hist-body");
  if (!body) return;
  if (!DB.history || !DB.history.length) {
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state">No history entries yet.</div></td></tr>`;
    return;
  }
  body.innerHTML = DB.history.slice().reverse().map(h =>
    `<tr>
      <td><span class="case-id-display">${h.histId}</span></td>
      <td><span class="case-id-display">${h.caseId}</span></td>
      <td>${h.eventDate}</td>
      <td>${h.histType}</td>
      <td>${h.summary}</td>
      <td>${getFilePreviewHTML(h.fileLink)}</td> <!-- VIEW BUTTON -->
      <td>${h.enteredBy || "-"}</td>
    </tr>`
  ).join("");
}

// ── ACTION LOG FUNCTIONS ──

async function submitAction() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  
  const caseId = get("al-caseid");
  const summary = get("al-summary");

  // Validation
  if (!caseId || !summary) {
    toast("Please select Case ID and enter Action Summary", "error");
    return;
  }

  const actionId = uid("ACT");
  const fileLink = resolveFileLink("al-file-data", "al-file"); // File upload logic
  const actionType = document.getElementById("al-type").value;

  if (actionType === "Refund Request" && !canRaiseRefundRequest()) {
    toast("Only Admin or Operations can raise a refund request.", "error");
    return;
  }

  const row = {
    actionId: actionId,
    caseId: caseId,
    dateTime: nowIST(),
    dept: document.getElementById("al-dept").value,
    doneBy: get("al-doneby") || currentUserEmail(),
    actionType: actionType,
    summary: summary,
    notes: get("al-notes"),
    clientResp: get("al-clientresp"),
    observation: get("al-obs"),
    nextAction: get("al-nextaction"),
    nextActionBy: get("al-nextby"),
    nextActionDate: get("al-nextdate"),
    fileLink: fileLink
  };

  if (actionType === "Refund Request") {
    row.status = "Pending Approval";
    row.refundStatus = "Pending Approval";
    row.requestedByEmail = currentUserEmail();
    row.requestedByRole = currentRole();
    row.requestedAt = nowIST();
  }

  // 1. Local Arrays update karein
  if (!DB.actions) DB.actions = [];
  // submitAction ke andar:
logActivity("ACTION_LOG", `Performed ${row.actionType}: ${summary}`, caseId);
  DB.actions.push(row);
  

  // 2. Timeline mein entry daalein
  addTimelineEntry(caseId, row.dateTime, "ACTION", row.actionType, summary);

  // 3. Case Master update karein (Status aur Next Action Date)
  updateCaseMasterField(caseId, "lastUpdateDate", nowIST());
  updateCaseMasterField(caseId, "nextActionDate", row.nextActionDate);
  updateCaseMasterField(caseId, "lastActionSummary", summary);
  
  const newStatus = document.getElementById("al-status").value;
  if (actionType === "Refund Request") {
    updateCaseMasterField(caseId, "currentStatus", "Refund Pending Approval");
  } else if (newStatus) {
    updateCaseMasterField(caseId, "currentStatus", newStatus);
  }

  // 4. UI Refresh
  renderActionTable();
  renderRefundApprovals();
  renderRefundDashboard();
  toast(actionType === "Refund Request" ? "Refund request sent to Admin for approval..." : "Action logged! Syncing to Cloud...", "info");

  // 5. Cloud Sync (Google Sheet + Drive Folder)
  try {
    await saveDB();
    toast(actionType === "Refund Request" ? "Refund request saved and pending Admin approval!" : "Action & File saved to Cloud!", "success");

    // 6. Form Clear
    ["al-doneby", "al-nextby", "al-summary", "al-notes", "al-clientresp", "al-obs", "al-nextaction", "al-nextdate", "al-file", "al-file-data"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    if (document.getElementById("al-file-chip")) document.getElementById("al-file-chip").innerHTML = "";
    document.getElementById("al-status").value = "";

  } catch (err) {
    console.error("Sync Error:", err);
    toast("Saved locally, but Cloud sync failed.", "error");
  }
}

function renderActionTable() {
  const body = document.getElementById("action-body");
  if (!body) return;
  if (!DB.actions || !DB.actions.length) {
    body.innerHTML = `<tr><td colspan="10"><div class="empty-state">No actions logged yet.</div></td></tr>`;
    return;
  }
  body.innerHTML = DB.actions.slice().reverse().map(a =>
    `<tr>
      <td><span class="case-id-display">${a.actionId}</span></td>
      <td><span class="case-id-display">${a.caseId}</span></td>
      <td>${a.dateTime}</td>
      <td>${a.actionType}</td>
      <td>${a.dept}</td>
      <td>${a.doneBy || "-"}</td>
      <td>${a.summary}</td>
      <td>${getFilePreviewHTML(a.fileLink)}</td> <!-- VIEW BUTTON -->
      <td>${a.actionType === "Refund Request" ? formatRefundStatus(a.refundStatus || a.status) : "-"}</td>
      <td>${a.nextActionDate || "-"}</td>
    </tr>`
  ).join("");
}

// ── COMMUNICATION LOG FUNCTIONS ──

async function submitCommLog() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  
  const caseId = get("cl-caseid");
  const summary = get("cl-summary");

  // Validation
  if (!caseId || !summary) {
    toast("Please select Case ID and enter Summary", "error");
    return;
  }

  const commId = uid("COMM");
  const fileLink = resolveFileLink("cl-file-data", "cl-file"); // File upload logic

  const row = {
    commId: commId,
    caseId: caseId,
    dateTime: get("cl-datetime") || nowIST(),
    mode: document.getElementById("cl-mode").value,
    direction: document.getElementById("cl-dir").value,
    fromTo: get("cl-fromto"),
    summary: summary,
    exactDemand: get("cl-exact"),
    refundDemanded: get("cl-refund"),
    legalThreat: document.getElementById("cl-legal").value,
    smMentioned: document.getElementById("cl-sm").value,
    fileLink: fileLink,
    loggedBy: get("cl-loggedby"),
    timestamp: nowIST()
  };

  // 1. Local Arrays update karein
  if (!DB.comms) DB.comms = [];
  DB.comms.push(row);

  // 2. Timeline mein entry daalein
  addTimelineEntry(caseId, row.dateTime, "COMMUNICATION", `${row.mode} ${row.direction}`, summary);

  // 3. Case Master update karein
  updateCaseMasterField(caseId, "lastUpdateDate", nowIST());
  updateCaseMasterField(caseId, "lastCommSummary", `${row.mode}: ${summary}`);

  // 4. UI Refresh
  renderCommTable();
  toast("Communication logged! Syncing...", "info");

  // 5. Cloud Sync (Google Sheet + Drive Folder)
  try {
    await saveDB();
    toast("Communication & File saved to Cloud!", "success");

    // 6. Form Clear
    ["cl-fromto", "cl-summary", "cl-exact", "cl-refund", "cl-file", "cl-file-data", "cl-loggedby", "cl-datetime"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    if (document.getElementById("cl-file-chip")) document.getElementById("cl-file-chip").innerHTML = "";

  } catch (err) {
    console.error("Sync Error:", err);
    toast("Saved locally, but Cloud sync failed.", "error");
  }
}

function renderCommTable() {
  const body = document.getElementById("comm-body");
  if (!body) return;
  if (!DB.comms || !DB.comms.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state">No communications logged yet.</div></td></tr>`;
    return;
  }
  body.innerHTML = DB.comms.slice().reverse().map(c =>
    `<tr>
      <td><span class="case-id-display">${c.commId}</span></td>
      <td><span class="case-id-display">${c.caseId}</span></td>
      <td>${c.dateTime}</td>
      <td>${c.mode}</td>
      <td>${c.direction}</td>
      <td>${c.fromTo || "-"}</td>
      <td>${c.summary}</td>
      <td>${getFilePreviewHTML(c.fileLink)}</td> <!-- VIEW BUTTON -->
      <td>${c.legalThreat !== "No" ? "Yes" : "No"}</td>
    </tr>`
  ).join("");
}
// ── TIMELINE VIEW FUNCTION ──

function renderTimeline() {
  const filter = document.getElementById("tl-filter").value;
  const container = document.getElementById("timeline-container");
  
  if (!container) return;

  // Timeline entries ko filter aur sort karein (Newest first)
  const entries = DB.timeline
    .filter(e => !filter || e.caseId === filter)
    .sort((a, b) => new Date(b.logTimestamp) - new Date(a.logTimestamp));

  if (!entries.length) {
    container.innerHTML = `<div class="empty-state"><span class="emoji">🕒</span>No timeline entries yet for this case.</div>`;
    return;
  }

  // Source ke hisab se colors/badges set karein
  const sourceColor = { 
    CASE_CREATION: "background:#e8f0fe;color:#1a73e8", 
    HISTORY: "background:#fef7e0;color:#e65100", 
    ACTION: "background:#e6f4ea;color:#1e7e34", 
    COMMUNICATION: "background:#f3e8ff;color:#7c3aed" 
  };

  container.innerHTML = `<ul class="timeline">${entries.map(e => `
    <li>
      <div class="tl-meta">
        <strong>${e.logTimestamp}</strong> &nbsp;|&nbsp; 
        <span class="case-id-display">${e.caseId}</span> &nbsp;|&nbsp;
        <span class="badge" style="${sourceColor[e.source] || ''}">${e.source}</span>
      </div>
      <div class="tl-event"><strong>${e.eventType}:</strong> ${e.summary}</div>
      ${e.notes ? `<div class="tl-note">${e.notes}</div>` : ""}
      ${e.fileLink ? `<div class="tl-note"><a href="${e.fileLink}" target="_blank">📎 View Attachment (Drive)</a></div>` : ""}
    </li>
  `).join("")}</ul>`;
}

// ── DOCUMENT INDEX FUNCTIONS ──

function renderDocIndex() {
  const q = (document.getElementById("di-search") ? document.getElementById("di-search").value : "").toLowerCase();
  const body = document.getElementById("doc-body");
  
  if (!body) return;

  // Filter documents based on search
  const filtered = DB.docs.filter(d => 
    !q || JSON.stringify(d).toLowerCase().includes(q)
  );

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8"><div class="empty-state"><span class="emoji">📁</span>No documents indexed yet.</div></td></tr>`;
    return;
  }

  body.innerHTML = filtered.slice().reverse().map(d => `
    <tr>
      <td><span class="case-id-display">${d.docId}</span></td>
      <td><span class="case-id-display">${d.caseId}</span></td>
      <td>${d.uploadDate}</td>
      <td><span class="badge badge-pending" style="font-size:10px">${d.sourceForm}</span></td>
      <td>${d.docType}</td>
      <td>${d.fileSummary}</td>
      <td>${renderDocLink(d.fileLink, d.fileSummary)}</td>
      <td>${d.uploadedBy || "-"}</td>
    </tr>
  `).join("");
}

// Helper to show Drive link or Download button
function renderDocLink(link, fileName) {
  if (!link) return "-";
  if (link.startsWith("https://drive.google.com")) {
    return `<a href="${link}" target="_blank" style="color:var(--blue); font-weight:600;">🔗 View in Drive</a>`;
  }
  if (link.startsWith("data:")) {
    return `<a href="${link}" download="${fileName || 'file'}" style="color:var(--green);">⬇ Download</a>`;
  }
  return `<a href="${link}" target="_blank">🔗 View</a>`;
}

async function submitDocUpload() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  
  const caseId = get("di-caseid");
  const docType = get("di-doctype");
  const fileLink = resolveFileLink("di-file-data", "di-file-url");

  if (!caseId || !fileLink) {
    toast("Please select Case ID and attach a file!", "error");
    return;
  }

  const docId = uid("DOC");
  const summary = get("di-summary") || docType;
  const uploadedBy = get("di-uploadedby");
  const remarks = get("di-remarks");

  const docRow = {
    docId: docId,
    caseId: caseId,
    uploadDate: nowIST(),
    sourceForm: "MANUAL_UPLOAD",
    docType: docType,
    fileSummary: summary,
    fileLink: fileLink,
    uploadedBy: uploadedBy,
    remarks: remarks
  };

  // 1. Save to local DB
  if (!DB.docs) DB.docs = [];
  DB.docs.push(docRow);

  // 2. Add to Timeline also (so it shows in Timeline view)
  addTimelineEntry(caseId, nowIST(), "DOCUMENT", docType, `Manual Upload: ${summary}`);

  // 3. UI Refresh
  renderDocIndex();
  toast("Document indexed! Uploading to Drive...", "info");

  // 4. Cloud Sync (Google Drive + Sheet)
  try {
    await saveDB();
    toast("Document & File saved successfully!", "success");

    // 5. Form Clear
    ["di-summary", "di-uploadedby", "di-remarks", "di-file-url", "di-file-data"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    if (document.getElementById("di-file-chip")) document.getElementById("di-file-chip").innerHTML = "";
    document.getElementById("di-caseid").value = "";

  } catch (err) {
    console.error("Sync Error:", err);
    toast("Saved locally, cloud sync failed.", "error");
  }
}

// ── CASE STUDY GENERATOR FUNCTIONS ──

function renderStudyControl() {
  const body = document.getElementById("study-control-body");
  if (!body) return;
  
  if (!DB.studyControl || !DB.studyControl.length) {
    body.innerHTML = `<tr><td colspan="3"><div class="empty-state text-muted">No entries</div></td></tr>`;
    return;
  }
  
  body.innerHTML = DB.studyControl.map(s => `
    <tr>
      <td><span class="case-id-display">${s.caseId}</span></td>
      <td><span class="badge ${s.status === 'Study Generated' ? 'badge-closed' : 'badge-pending'}">${s.status}</span></td>
      <td>${s.lastRefreshDate || "-"}</td>
    </tr>
  `).join("");
}

function generateCaseStudyFor(caseId) {
  if (!DB.studyControl) DB.studyControl = [];
  
  let sc = DB.studyControl.find(s => s.caseId === caseId);
  if (sc) {
    sc.lastRefreshDate = nowIST();
    sc.status = "Study Generated";
  } else {
    DB.studyControl.push({
      caseId: caseId,
      status: "Study Generated",
      lastRefreshDate: nowIST()
    });
  }
  renderStudyControl();
}

async function generateCaseStudy() {
  const caseId = document.getElementById("cs-caseid").value;
  if (!caseId) {
    toast("Please select a Case ID first.", "error");
    return;
  }

  const c = DB.cases.find(item => item.caseId === caseId);
  if (!c) {
    toast("Case data not found.", "error");
    return;
  }

  // Update Status in Control Table
  generateCaseStudyFor(caseId);

  // Compile Data
  const tlEntries = DB.timeline.filter(t => t.caseId === caseId).sort((a,b) => new Date(a.eventDate) - new Date(b.eventDate));
  const actions = DB.actions ? DB.actions.filter(a => a.caseId === caseId).sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime)) : [];
  const comms = DB.comms ? DB.comms.filter(cm => cm.caseId === caseId).sort((a,b) => new Date(a.dateTime) - new Date(b.dateTime)) : [];

  // Show Preview
  document.getElementById("cs-empty").style.display = "none";
  const preview = document.getElementById("case-study-preview");
  preview.style.display = "block";
  
  document.getElementById("cs-preview-title").textContent = "📄 Case Study – " + caseId;
  
  // Design CSS for the Table
  const style = `
    <style>
      .cs-table { width:100%; border-collapse: collapse; margin-bottom: 20px; font-family: sans-serif; }
      .cs-table th { background: #1a73e8; color: white; padding: 10px; text-align: left; text-transform: uppercase; font-size: 13px; letter-spacing: 0.5px; }
      .cs-table td { padding: 8px 12px; border: 1px solid #dadce0; font-size: 13px; color: #3c4043; }
      .cs-label { font-weight: 600; background: #f8f9fa; width: 30%; }
      .cs-header-info { background: #e8f0fe; padding: 12px; border-radius: 4px; border-left: 4px solid #1a73e8; margin-bottom: 15px; font-size: 12px; color: #1967d2; }
    </style>
  `;

  document.getElementById("cs-preview-content").innerHTML = style + `
    
    
    <!-- I. CASE OVERVIEW -->
    <table class="cs-table">
      <tr><th colspan="2">CASE OVERVIEW</th></tr>
      <tr><td class="cs-label">Case ID</td><td>${c.caseId}</td></tr>
      <tr><td class="cs-label">Created Date</td><td>${c.createdDate}</td></tr>
      <tr><td class="cs-label">Company</td><td>${c.companyName}</td></tr>
      <tr><td class="cs-label">Case Title</td><td>${c.caseTitle}</td></tr>
      <tr><td class="cs-label">Client Name</td><td>${c.clientName}</td></tr>
      <tr><td class="cs-label">Mobile</td><td>${c.clientMobile}</td></tr>
      <tr><td class="cs-label">Email</td><td>${c.clientEmail || "-"}</td></tr>
      <tr><td class="cs-label">State</td><td>${c.state || "-"}</td></tr>
      <tr><td class="cs-label">Services Sold</td><td>${c.servicesSold || "-"}</td></tr>
      <tr><td class="cs-label">Total Amount Paid</td><td>₹${Number(c.totalAmtPaid||0).toLocaleString("en-IN")}</td></tr>
      <tr><td class="cs-label">Amount in Dispute</td><td>₹${Number(c.amtInDispute||0).toLocaleString("en-IN")}</td></tr>
      <tr><td class="cs-label">MOU Signed</td><td>${c.mouSigned}</td></tr>
      <tr><td class="cs-label">Priority</td><td>${c.priority}</td></tr>
      <tr><td class="cs-label">Current Status</td><td>${c.currentStatus}</td></tr>
    </table>

    <!-- II. RISK PROFILE -->
    <table class="cs-table">
      <tr><th colspan="2">RISK PROFILE</th></tr>
      <tr><td class="cs-label">Social Media Risk</td><td>${c.smRisk}</td></tr>
      <tr><td class="cs-label">Consumer Complaint</td><td>${c.complaint}</td></tr>
      <tr><td class="cs-label">Police / Cyber Threat</td><td>${c.policeThreat}</td></tr>
    </table>

    <!-- III. CASE NARRATIVE -->
    <table class="cs-table">
      <tr><th colspan="2">CASE NARRATIVE</th></tr>
      <tr><td class="cs-label">Case Summary</td><td>${c.caseSummary || "-"}</td></tr>
      <tr><td class="cs-label">Client Allegation</td><td>${c.clientAllegation || "-"}</td></tr>
      <tr><td class="cs-label">Company Position</td><td>${c.companyPosition || "-"}</td></tr>
    </table>

    <!-- IV. TEAM ASSIGNMENT -->
    <table class="cs-table">
      <tr><th colspan="2">TEAM ASSIGNMENT</th></tr>
      <tr><td class="cs-label">Initiated By</td><td>${c.initiatedBy || "-"}</td></tr>
      <tr><td class="cs-label">Negotiator</td><td>${c.negotiator || "-"}</td></tr>
      <tr><td class="cs-label">Legal Officer</td><td>${c.legalOfficer || "-"}</td></tr>
      <tr><td class="cs-label">Accounts Officer</td><td>${c.accountsOfficer || "-"}</td></tr>
    </table>

    <!-- V. TIMELINE -->
    <table class="cs-table">
      <tr><th colspan="4">TIMELINE (${tlEntries.length} ENTRIES)</th></tr>
      <tr style="background:#f1f3f4; font-weight:bold;">
        <td>DATE</td><td>SOURCE</td><td>TYPE</td><td>SUMMARY</td>
      </tr>
      ${tlEntries.map(t => `
        <tr>
          <td>${t.eventDate}</td>
          <td>${t.source}</td>
          <td>${t.eventType}</td>
          <td>${t.summary}</td>
        </tr>
      `).join("")}
    </table>

    <!-- VI. ACTIONS TAKEN -->
    <table class="cs-table">
      <tr><th colspan="4">ACTIONS TAKEN (${actions.length} ENTRIES)</th></tr>
      <tr style="background:#f1f3f4; font-weight:bold;">
        <td>DATE</td><td>TYPE</td><td>DONE BY</td><td>SUMMARY</td>
      </tr>
      ${actions.length ? actions.map(a => `
        <tr>
          <td>${a.dateTime}</td><td>${a.actionType}</td><td>${a.doneBy || "-"}</td><td>${a.summary}</td>
        </tr>
      `).join("") : "<tr><td colspan='4'>No actions logged yet.</td></tr>"}
    </table>

    <!-- VII. COMMUNICATIONS -->
    <table class="cs-table">
      <tr><th colspan="4">COMMUNICATIONS (${comms.length} ENTRIES)</th></tr>
      <tr style="background:#f1f3f4; font-weight:bold;">
        <td>DATE</td><td>MODE</td><td>DIRECTION</td><td>SUMMARY</td>
      </tr>
      ${comms.length ? comms.map(cm => `
        <tr>
          <td>${cm.dateTime}</td><td>${cm.mode}</td><td>${cm.direction}</td><td>${cm.summary}</td>
        </tr>
      `).join("") : "<tr><td colspan='4'>No communications logged yet.</td></tr>"}
    </table>

    <div style="font-size:11px; color:#5f6368; text-align:center; margin-top:20px;">
      Generated: ${nowIST()} | Template placeholders like {{CASE_ID}} are replaced with live data in the Google Doc version.
    </div>
  `;

  toast("Case Study compiled successfully!", "success");
  // generateCaseStudy function ke andar end mein ye dalein:
document.getElementById("cs-download-container").style.display = "block";
  await saveDB();
}
function refreshNavCount() {
  const el = document.getElementById("navbar-case-count");
  if (el) {
    el.textContent = (DB.cases ? DB.cases.length : 0) + " case" + (DB.cases.length !== 1 ? "s" : "");
  }
}

function downloadPDF() {
  const element = document.getElementById('cs-preview-content');
  const caseId = document.getElementById("cs-caseid").value;
  
  if (!element || !caseId) {
    toast("No data to download!", "error");
    return;
  }

  // PDF Configuration
  const opt = {
    margin:       [10, 10, 10, 10], // Top, Left, Bottom, Right
    filename:     `Case_Study_${caseId}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  toast("Generating PDF... Please wait", "info");

  // Generate and Download
  html2pdf().set(opt).from(element).save().then(() => {
    toast("PDF Downloaded Successfully!", "success");
  });
}
// ── SERVICES DYNAMIC LOGIC ──

// Page load par ek row dikhane ke liye
window.addEventListener('DOMContentLoaded', () => {
  toggleServiceMode(); 
});

function toggleServiceMode() {
  const mode = document.getElementById("nc-service-mode").value;
  const container = document.getElementById("services-container");
  const addBtnWrap = document.getElementById("add-service-btn-wrap");
  
  container.innerHTML = ""; // Pehle clear karein
  addServiceRow(); // Pehli row add karein

  if (mode === "multiple") {
    addBtnWrap.style.display = "block";
  } else {
    addBtnWrap.style.display = "none";
  }
}

function addServiceRow() {
  const container = document.getElementById("services-container");
  const mode = document.getElementById("nc-service-mode").value;
  const rowCount = container.querySelectorAll('.service-row').length;

  const row = document.createElement("div");
  row.className = "service-row";
  row.innerHTML = `
    ${mode === "multiple" && rowCount > 0 ? `<div class="remove-service" onclick="this.parentElement.remove()">✕</div>` : ""}
    
    <div class="field"><label>Service Name</label><input class="s-name" placeholder="Enter service"></div>
    <div class="field"><label>Service Amount</label><input type="number" class="s-amt" placeholder="0"></div>
    <div class="field"><label>MOU Signed</label>
      <select class="s-mou"><option>No</option><option>Yes</option></select>
    </div>
    <div class="field"><label>Signed MOU Amount</label><input type="number" class="s-mou-amt" placeholder="0"></div>
    <div class="field"><label>Work Status</label>
      <select class="s-status">
        <option>Not Initiated</option><option>In Progress</option><option>Work in Progress</option>
        <option>Completed</option><option>Escalated</option><option>Hold</option>
        <option>File Not Eligible</option><option>QA Not Approved</option>
        <option>Service Converted</option><option>NA</option>
      </select>
    </div>
    <div class="field"><label>BDA</label><input class="s-bda" placeholder="Name"></div>
    <div class="field"><label>Department</label>
      <select class="s-dept">
        <option>Operations</option><option>Loan</option><option>Digital Marketing</option>
      </select>
    </div>
  `;
  container.appendChild(row);
}
// 1. Dropdown change listener
document.getElementById("nc-complaint-type").addEventListener("change", function() {
  const val = this.value;
  document.getElementById("cyber-extra").style.display = (val === "Cyber Complaint") ? "block" : "none";
  document.getElementById("fir-extra").style.display = (val === "FIR") ? "block" : "none";
  document.getElementById("consumer-extra").style.display = (val === "Consumer Complaint") ? "block" : "none";
});

// 2. Cyber Acknowledgment fields add karne ke liye
function addAckField() {
  const container = document.getElementById("ack-container");
  const div = document.createElement("div");
  div.style = "display:flex; gap:10px; margin-bottom:5px;";
  div.innerHTML = `
    <input class="ack-input" placeholder="Enter Acknowledgment Number" style="flex:1;">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(div);
}

function getFilePreviewHTML(link) {
  if (!link || link === "" || link === "-" || link.includes("Error")) {
    return '<span style="color:#ccc">No File</span>';
  }

  // Agar Google Drive link hai toh seedha open karein
  if (link.startsWith("http")) {
    return `<a href="${link}" target="_blank" class="btn btn-outline btn-sm" style="padding: 2px 8px; font-size: 11px;">👁️ View</a>`;
  }

  // Agar Base64 image hai (Local upload), toh use blob mein convert karke dikhayein
  return `<button onclick="openBase64InNewTab('${link.replace(/'/g, "\\'")}')" class="btn btn-outline btn-sm" style="padding: 2px 8px; font-size: 11px;">👁️ View</button>`;
}

// Base64 file ko naye tab mein kholne ke liye helper function
function openBase64InNewTab(base64) {
  try {
    const win = window.open();
    win.document.write('<iframe src="' + base64 + '" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>');
  } catch (e) {
    alert("Could not open file preview. Please wait for Cloud Sync.");
  }
}
// ── BULK IMPORT FUNCTION (Matches 36 Headers) ──
async function importCasesCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split(/\r?\n/);
    let successCount = 0;

    // Line 0 headers hoti hain, i=1 se data start hota hai
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      // Split logic: Commas ko handle karega lekin quotes ke andar wale commas ko ignore karega
      const col = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      
      // Data clean karne ke liye helper
      const clean = (val) => val ? val.replace(/^"|"$/g, "").trim() : "";

      const caseId = clean(col[0]) || generateCaseId();
      const createdDate = clean(col[1]) || nowIST();

      const rowData = {
        caseId: caseId,
        createdDate: createdDate,
        companyName: clean(col[2]),
        caseTitle: clean(col[3]),
        priority: clean(col[4]),
        sourceOfComplaint: clean(col[5]),
        typeOfComplaint: clean(col[6]),
        servicesSold: clean(col[7]),
        clientName: clean(col[8]),
        clientMobile: clean(col[9]),
        clientEmail: clean(col[10]),
        state: clean(col[11]),
        totalAmtPaid: clean(col[12]) || "0",
        mouSigned: clean(col[13]),
        totalMouValue: clean(col[14]) || "0",
        amtInDispute: clean(col[15]) || "0",
        smRisk: clean(col[16]),
        complaint: clean(col[17]),
        policeThreat: clean(col[18]),
        caseSummary: clean(col[19]),
        clientAllegation: clean(col[20]),
        proofCallRec: clean(col[21]),
        proofWaChat: clean(col[22]),
        proofVideoCall: clean(col[23]),
        proofFundingEmail: clean(col[24]),
        initiatedBy: clean(col[25]),
        accountable: clean(col[26]),
        legalOfficer: clean(col[27]),
        accounts: clean(col[28]),
        currentStatus: clean(col[29]) || "Open",
        lastUpdateDate: clean(col[30]) || nowIST(),
        nextActionDate: clean(col[31]),
        cyberAckNumbers: clean(col[32]),
        firNumber: clean(col[33]),
        firFileLink: clean(col[34]),
        grievanceNumber: clean(col[35])
      };

      if (!DB.cases) DB.cases = [];
      DB.cases.push(rowData);
      
      // Timeline entry for each imported case
      addTimelineEntry(caseId, createdDate, "CASE_CREATION", "Imported", "Bulk import via CSV");
      successCount++;
    }

    if (successCount > 0) {
      toast(`${successCount} cases imported! Syncing with Cloud...`, "success");
      
      // UI update karein
      updateDashboard();
      if (typeof renderCaseMaster === "function") renderCaseMaster();
      refreshDropdowns();
      refreshNavCount();

      // Cloud (Google Sheets) par save karein
      await saveDB();
    } else {
      toast("No valid data found in CSV.", "error");
    }
  };

  reader.readAsText(file);
  event.target.value = ""; // Input clear karein
}

// ── AUTOMATIC CASE TITLE GENERATOR ──
function autoGenerateTitle() {
    const company = document.getElementById("nc-company").value.trim();
    const complaintType = document.getElementById("nc-complaint-type").value;
    const titleField = document.getElementById("nc-title");

    // Agar dono fields mein data hai, toh title format karein
    if (company && complaintType && complaintType !== "") {
        titleField.value = `${complaintType} - ${company}`;
    } 
    // Agar sirf company bhari hai, toh wahi dikhayein (optional)
    else if (company) {
        titleField.value = company;
    }
    else {
        titleField.value = "";
    }
}

function allowedTabsForRole(role) {
  if (role === "Admin") {
    return ["dashboard", "new-case", "case-master", "history", "action-log", "comm-log", "timeline", "doc-index", "case-study", "admin-panel","internal-search"];
  }
  if (role === "Operations") {
    return ["dashboard", "new-case", "case-master", "history", "action-log", "comm-log", "timeline", "doc-index", "case-study", "admin-panel", "internal-search"];
  }
  return ["new-case", "history", "action-log", "comm-log", "doc-index","internal-search"];
}

function applyPermissions() {
  const role = currentRole();
  const allowed = allowedTabsForRole(role);

  document.querySelectorAll(".tab").forEach(tab => {
    tab.style.display = allowed.includes(tab.dataset.tab) ? "" : "none";
  });

  document.querySelectorAll(".section").forEach(section => {
    if (!section.id || !section.id.startsWith("tab-")) return;
    const name = section.id.replace("tab-", "");
    if (!allowed.includes(name)) section.classList.remove("active");
  });

  const activeTab = document.querySelector(".tab.active");
  if (!activeTab || !allowed.includes(activeTab.dataset.tab)) {
    const fallback = document.querySelector(`[data-tab="${allowed[0]}"]`);
    if (fallback) fallback.click();
  }

  const refundCard = document.getElementById("refund-dashboard-card");
  if (refundCard) refundCard.style.display = role === "Staff" ? "none" : "";

  const refundRequestCard = document.getElementById("refund-request-card");
  if (refundRequestCard) refundRequestCard.style.display = canRaiseRefundRequest() ? "" : "none";

  const adminRefundCard = document.getElementById("admin-refund-card");
  if (adminRefundCard) adminRefundCard.style.display = role === "Admin" ? "" : "none";

  const adminTab = document.querySelector('[data-tab="admin-panel"]');
  if (adminTab) adminTab.textContent = role === "Admin" ? "⚙️ Admin Panel" : "⚙️ User Panel";

  const adminTitle = document.getElementById("admin-panel-title");
  const adminSub = document.getElementById("admin-panel-subtitle");
  if (adminTitle) adminTitle.textContent = role === "Admin" ? "Admin Panel" : "Operations User Panel";
  if (adminSub) adminSub.textContent = role === "Admin" ? "Approve refunds and create users" : "Create staff users and track your refund requests";

  setupUserRoleOptions();
  renderRefundApprovals();
  renderRefundDashboard();
  applyActionTypePermissions();
}

function applyActionTypePermissions() {
  const select = document.getElementById("al-type");
  if (!select) return;

  Array.from(select.options).forEach(option => {
    if (option.value === "Refund Request") {
      option.hidden = !canRaiseRefundRequest();
      option.disabled = !canRaiseRefundRequest();
    }
  });

  if (!canRaiseRefundRequest() && select.value === "Refund Request") {
    select.value = "Negotiation Call";
  }
}

function setupUserRoleOptions() {
  const roleSelect = document.getElementById("new-user-role");
  const title = document.getElementById("user-create-title");
  if (!roleSelect) return;

  if (isAdmin()) {
    roleSelect.innerHTML = `<option>Admin</option><option>Operations</option><option>Staff</option>`;
    if (title) title.textContent = "👤 Create New User";
  } else if (isOperations()) {
    roleSelect.innerHTML = `<option>Staff</option>`;
    if (title) title.textContent = "👤 Create New Staff User";
  }
}

function refundRequesterLabel(action) {
  return action.doneBy || action.requestedByEmail || action.requestedByRole || "-";
}

function refundAmountSummary(action) {
  const amount = Number(action.refundAmount || 0);
  const amountText = amount ? `Rs. ${amount.toLocaleString("en-IN")}` : "";
  const summary = action.notes || action.summary || "-";
  if (!amountText) return summary;
  return `${amountText}<br><span class="text-muted" style="font-size:11px">${summary}</span>`;
}

async function submitRefundRequest() {
  if (!canRaiseRefundRequest()) {
    toast("Only Admin or Operations can raise a refund request.", "error");
    return;
  }

  const caseId = document.getElementById("rr-caseid").value;
  const amount = document.getElementById("rr-amount").value.trim();
  const summary = document.getElementById("rr-summary").value.trim();
  const requestedBy = document.getElementById("rr-requestedby").value.trim() || currentUserEmail();

  if (!caseId || !amount || !summary) {
    toast("Please select Case ID, enter refund amount, and write summary.", "error");
    return;
  }

  if (Number(amount) <= 0) {
    toast("Refund amount must be greater than 0.", "error");
    return;
  }

  normalizeDBShape();
  const actionId = uid("ACT");
  const createdAt = nowIST();
  const formattedAmount = Number(amount).toLocaleString("en-IN");
  const row = {
    actionId: actionId,
    caseId: caseId,
    dateTime: createdAt,
    dept: "Operations",
    doneBy: requestedBy,
    actionType: "Refund Request",
    summary: `Refund request for Rs. ${formattedAmount}`,
    notes: summary,
    refundAmount: amount,
    clientResp: "",
    observation: "",
    nextAction: "Admin approval required",
    nextActionBy: "Admin",
    nextActionDate: "",
    fileLink: "",
    status: "Pending Approval",
    refundStatus: "Pending Approval",
    requestedByEmail: currentUserEmail(),
    requestedByRole: currentRole(),
    requestedAt: createdAt
  };

  DB.actions.push(row);
  addTimelineEntry(caseId, createdAt, "ACTION", "Refund Request", `Refund request submitted: Rs. ${formattedAmount} - ${summary}`);
  logActivity("REFUND", `Refund request submitted for Rs. ${formattedAmount}`, caseId);
  updateCaseMasterField(caseId, "lastUpdateDate", createdAt);
  updateCaseMasterField(caseId, "lastActionSummary", row.summary);
  updateCaseMasterField(caseId, "currentStatus", "Refund Pending Approval");

  renderActionTable();
  renderRefundApprovals();
  renderRefundDashboard();
  updateDashboard();

  ["rr-amount", "rr-summary", "rr-requestedby"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("rr-caseid").value = "";

  toast("Refund request sent to Admin for approval.", "success");
  await saveDB();
}

function renderRefundApprovals() {
  const body = document.getElementById("refund-body");
  if (!body) return;

  if (!isAdmin()) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">Only Admin can approve refunds.</div></td></tr>`;
    return;
  }

  normalizeDBShape();
  const pending = DB.actions.filter(a => a.actionType === "Refund Request" && (a.refundStatus || a.status || "Pending Approval") !== "Approved");

  if (!pending.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No pending refund approvals.</div></td></tr>`;
    return;
  }

  body.innerHTML = pending.slice().reverse().map(a => `
    <tr>
      <td><span class="case-id-display">${a.caseId}</span></td>
      <td>${refundAmountSummary(a)}</td>
      <td>${refundRequesterLabel(a)}</td>
      <td>${a.requestedAt || a.dateTime || "-"}</td>
      <td><button class="btn btn-success btn-sm" onclick="approveRefund('${a.actionId}')">Approve</button></td>
    </tr>
  `).join("");
}

function renderRefundDashboard() {
  const body = document.getElementById("refund-dashboard-body");
  if (!body) return;

  normalizeDBShape();
  const email = currentUserEmail();
  const role = currentRole();
  let rows = DB.actions.filter(a => a.actionType === "Refund Request");

  if (role === "Staff") {
    rows = [];
  } else if (role === "Operations") {
    rows = rows.filter(a => !a.requestedByEmail || a.requestedByEmail === email);
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No refund requests yet.</div></td></tr>`;
    return;
  }

  body.innerHTML = rows.slice().reverse().map(a => `
    <tr>
      <td><span class="case-id-display">${a.caseId}</span></td>
      <td>${refundAmountSummary(a)}</td>
      <td>${refundRequesterLabel(a)}</td>
      <td>${formatRefundStatus(a.refundStatus || a.status)}</td>
      <td>${a.approvedAt ? `Approved by ${a.approvedBy || "Admin"} on ${a.approvedAt}` : "Waiting for Admin approval"}</td>
    </tr>
  `).join("");
}

async function approveRefund(actionId) {
  if (!isAdmin()) {
    toast("Only Admin can approve refunds.", "error");
    return;
  }

  const action = DB.actions.find(a => a.actionId === actionId);

  if (!action) {
    toast("Refund request not found.", "error");
    return;
  }

  action.status = "Approved";
  action.refundStatus = "Approved";
  action.approvedBy = currentUserEmail() || "Admin";
  action.approvedAt = nowIST();

  updateCaseMasterField(action.caseId, "currentStatus", "Refund Approved");
  addTimelineEntry(action.caseId, action.approvedAt, "ACTION", "Refund Approved", `Refund request approved by ${action.approvedBy}`);
  logActivity("REFUND", "Refund approved by Admin", action.caseId);

  toast("Refund Approved! Operations dashboard par status update ho jayega.", "success");
  renderRefundApprovals();
  renderRefundDashboard();
  renderActionTable();
  updateDashboard();
  await saveDB();
}

async function createNewUser() {
  if (!isAdmin() && !isOperations()) {
    toast("You do not have permission to create users.", "error");
    return;
  }

  const email = document.getElementById("new-user-email").value.trim();
  const pass = document.getElementById("new-user-pass").value.trim();
  const role = document.getElementById("new-user-role").value;

  if (!email || !pass) {
    toast("Email and password are required.", "error");
    return;
  }

  if (isOperations() && role !== "Staff") {
    toast("Operations can create Staff users only.", "error");
    return;
  }

  await fetch(SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify({ action: "createUser", email, pass, role }),
    mode: "no-cors"
  });

  document.getElementById("new-user-email").value = "";
  document.getElementById("new-user-pass").value = "";
  toast("User Created Successfully!", "success");
}

// ── SYSTEM ACTIVITY LOGGER ──
function logActivity(category, description, caseId = "N/A") {
    if (!DB.auditLogs) DB.auditLogs = [];
    
    const logEntry = {
        id: uid("LOG"),
        timestamp: nowIST(),
        user: localStorage.getItem("rrr_user_email") || "Unknown",
        role: localStorage.getItem("rrr_user_role") || "Unknown",
        category: category,      // e.g., "CASE_CREATION", "ACTION_LOG", "REFUND"
        description: description, 
        caseId: caseId
    };
    
    DB.auditLogs.push(logEntry);
    console.log("Activity Logged:", logEntry);
}

// ── SAMPLE DATA SEARCH LOGIC ──

async function importSampleCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        const text = e.target.result;
        const lines = text.split(/\r?\n/);
        
        if (!DB.sampleData) DB.sampleData = [];
        DB.sampleData = []; 

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            // Quoted commas handle karne ke liye regex
            const col = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const clean = (val) => val ? val.replace(/^"|"$/g, "").trim() : "";

            // EXACT MAPPING FROM YOUR SHEET (A to L)
            DB.sampleData.push({
                date:    clean(col[0]),  // A: Date
                company: clean(col[1]),  // B: Company Name
                person:  clean(col[2]),  // C: Contact Person
                contact: clean(col[3]),  // D: Contact (Phone)
                email:   clean(col[4]),  // E: Email ID
                service: clean(col[5]),  // F: Service
                bde:     clean(col[6]),  // G: BDE
                total:   clean(col[7]),  // H: Total Amount
                net:     clean(col[8]),  // I: Amt. without GST
                status:  clean(col[9]),  // J: Work Status
                dept:    clean(col[10]), // K: Department
                mou:     clean(col[11])  // L: MOU Status
            });
        }

        toast(`${DB.sampleData.length} Records Uploaded Correctly!`, "success");
        renderSampleSearch();
        await saveDB(); 
    };
    reader.readAsText(file);
}


// 2. Real-time Search Function
function renderSampleSearch() {
    const query = document.getElementById("sample-search-input").value.toLowerCase();
    const body = document.getElementById("sample-search-body");
    
    if (!DB.sampleData || DB.sampleData.length === 0) {
        body.innerHTML = `<tr><td colspan="12" class="empty-state">No data available. Please upload CSV.</td></tr>`;
        return;
    }

    // Filter logic
    const filtered = DB.sampleData.filter(d => 
        (d.company && d.company.toLowerCase().includes(query)) || 
        (d.person && d.person.toLowerCase().includes(query)) || 
        (d.contact && d.contact.toLowerCase().includes(query)) || 
        (d.bde && d.bde.toLowerCase().includes(query)) ||
        (d.email && d.email.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        body.innerHTML = `<tr><td colspan="12" class="empty-state">No matching results found for "${query}"</td></tr>`;
        return;
    }

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
// Click karne par poori detail dikhane ke liye (Optional Alert)
function showFullRowDetails(companyName) {
    const d = DB.sampleData.find(item => item.company === companyName);
    alert(`
        Company: ${d.company}
        Contact: ${d.contact} (${d.person})
        Email: ${d.email}
        Service: ${d.service}
        BDE: ${d.bde}
        Status: ${d.status}
        Total Amount: ₹${d.total}
        Dept: ${d.dept}
    `);
}
// ══════════════════════════════════════
//  INITIALIZE SYSTEM
// ══════════════════════════════════════
window.onload = function() {
  if (!redirectIfLoggedOut()) {
    loadDB();
     applyPermissions(); 
  }
};