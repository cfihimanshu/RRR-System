// ══════════════════════════════════════
//  1. LOGIN SECURITY CHECK
// ══════════════════════════════════════
function redirectIfLoggedOut() {
  const isLoggedIn = localStorage.getItem("rrr_logged_in");
  if (isLoggedIn !== "true") {
    try { window.location.replace("login.html"); } catch (e) { }
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

let DB = { cases: [], history: [], actions: [], comms: [], docs: [], timeline: [], studyControl: [], sampleData: [], auditLogs: [], refunds: [] };
let editingCaseId = null;

function normalizeDBShape() {
  DB = DB || {};
  ["cases", "history", "actions", "comms", "docs", "timeline", "studyControl", "sampleData", "auditLogs", "refunds"].forEach(key => {
    if (!Array.isArray(DB[key])) DB[key] = [];
  });
}

function loadLocalBackupDB() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (e) {
    return null;
  }
}

function mergeCollectionByKey(cloudItems, localItems, key) {
  const map = new Map((Array.isArray(cloudItems) ? cloudItems : []).map(item => [item[key], item]));
  (Array.isArray(localItems) ? localItems : []).forEach(localItem => {
    if (!localItem || !localItem[key]) return;
    const cloudItem = map.get(localItem[key]);
    if (!cloudItem) {
      map.set(localItem[key], localItem);
      return;
    }
    const cloudStamp = Number(cloudItem.lastStatusAtMs || cloudItem.updatedAtMs || 0);
    const localStamp = Number(localItem.lastStatusAtMs || localItem.updatedAtMs || 0);
    if (localStamp >= cloudStamp) map.set(localItem[key], { ...cloudItem, ...localItem });
  });
  return Array.from(map.values());
}

function mergeCollectionsWithLocalBackup() {
  const local = loadLocalBackupDB();
  if (!local) return;
  DB.cases = mergeCollectionByKey(DB.cases, local.cases, "caseId");
  DB.history = mergeCollectionByKey(DB.history, local.history, "histId");
  DB.actions = mergeCollectionByKey(DB.actions, local.actions, "actionId");
  DB.comms = mergeCollectionByKey(DB.comms, local.comms, "commId");
  DB.docs = mergeCollectionByKey(DB.docs, local.docs, "docId");
  DB.refunds = mergeCollectionByKey(DB.refunds, local.refunds, "reqId");
}

// ══════════════════════════════════════
//  SAMPLE DATA BACKUP
// ══════════════════════════════════════
function loadSampleDataBackup() {
  try {
    const raw = localStorage.getItem(SAMPLE_DATA_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) { return []; }
}
function persistSampleDataBackup() {
  try { localStorage.setItem(SAMPLE_DATA_KEY, JSON.stringify(Array.isArray(DB.sampleData) ? DB.sampleData : [])); } catch (e) { }
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
  toast("Loading data from cloud...", "info");

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
        mergeCollectionsWithLocalBackup();
        refreshAllUI(); // Saari tables ek saath refresh
        console.log("✅ Cloud Data Loaded Successfully");
      }
    } else {
      throw new Error("Server response not ok");
    }
  } catch (e) {
    console.error("Cloud load failed:", e.message);
    toast("Cloud load failed. Using local backup if available.", "error");

    // Fallback to local backup when cloud fetch fails
    const local = localStorage.getItem(LS_KEY);
    if (local) {
      DB = JSON.parse(local);
      normalizeDBShape();
      refreshAllUI();
    }
  }
}


async function saveDB(syncSampleData = false) {
  console.log("🔄 Syncing to Google Sheets (Cloud Mode)...");

  // 1. Local Storage ka bojh khatam karein
  // Hum sirf ek chota sa backup rakhenge bina 'sampleData' ke 
  // taaki localStorage kabhi bhare nahi (QuotaExceededError Fix)
  try {
    const backupData = { ...DB };
    delete backupData.sampleData; // Badi files local storage mein nahi dalenge
    localStorage.setItem(LS_KEY, JSON.stringify(backupData));
  } catch (e) {
    console.warn("Local backup skipped.");
  }

  // 2. Cloud Sync Logic
  try {
    const controller = new AbortController();
    // Bada data hone ki wajah se timeout 2 minute (120000ms) rakha hai
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    // Pura DB object (Cases + SampleData) Google Sheet ko bhej rahe hain
    const payload = { ...DB };
    if (!syncSampleData) delete payload.sampleData;
    await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify(payload),
      mode: "no-cors",
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log("✅ Data successfully pushed to Google Sheet tabs.");
    toast("Cloud Sync Success!", "success");

  } catch (e) {
    if (e.name === "AbortError") {
      // Agar request cancel ho jaye tab bhi sheet mein data save ho raha hota hai
      console.warn("Large data: Syncing in background...");
      toast("Syncing large data... Please wait.", "info");
    } else {
      console.error("Cloud sync error:", e);
      toast("Cloud sync failed. Please check your internet connection.", "error");
    }
  }
}

function refreshAllUI() {
  updateDashboard();
  refreshDropdowns();
  refreshAssigneeFilter();
  refreshNavCount();
  renderCaseMaster();
  renderHistoryTable();
  renderActionTable();
  renderCommTable();
  renderDocIndex();
  renderTimeline();
  renderStudyControl();
  renderRefundApprovals();
  renderReviewerDashboard();
  renderAccountantDashboard();
  renderSampleSearch(); // Sample Data search refresh karein
  renderRefundDashboard();
  applyPermissions();

  // Initialize Lucide Icons
  if (window.lucide) lucide.createIcons();
}

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════
function nowIST() { return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); }
function todayDate() { return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }); }

// ─ DATE FORMATTER UTILITY ─
function formatDate(dateInput) {
  if (!dateInput) return "-";

  try {
    let date;

    // Agar string hai toh parse karein
    if (typeof dateInput === "string") {
      date = new Date(dateInput);
    } else if (dateInput instanceof Date) {
      date = dateInput;
    } else {
      return String(dateInput);
    }

    // Agar invalid date hai
    if (isNaN(date.getTime())) return String(dateInput);

    // Format: DD/MM/YYYY (Simple aur professional)
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
  } catch (e) {
    return String(dateInput);
  }
}

function uid(prefix) { return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000); }

function getBrandCode(brandInput) {
  const cleaned = String(brandInput || "").trim().replace(/[^a-zA-Z0-9\s]/g, " ");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return "XX";
  if (words.length === 1) {
    const one = words[0].toUpperCase();
    return (one.slice(0, 2) || "XX").padEnd(2, "X");
  }
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

function generateCaseId(brandOverride = "") {
  const yr = new Date().getFullYear();
  const brand = brandOverride || (document.getElementById("nc-brand") ? document.getElementById("nc-brand").value.trim() : "");
  const code = getBrandCode(brand);
  const nums = DB.cases.map(c => {
    const p = (c.caseId + "").split("-");
    // Expected: RRR-<CODE>-<YYYY>-<####>
    if (p.length >= 4 && p[0] === "RRR" && String(p[2]) === String(yr)) return parseInt(p[3], 10) || 0;
    return 0;
  });
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `RRR-${code}-${yr}-${String(next).padStart(4, "0")}`;
}

function nextSerialForCase(collection, caseId, idField, prefix) {
  const rows = Array.isArray(collection) ? collection : [];
  let max = 0;
  rows.forEach(r => {
    if (!r || r.caseId !== caseId) return;
    const id = String(r[idField] || "");
    if (!id.startsWith(prefix)) return;
    const parts = id.split("-");
    const maybe = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(maybe)) max = Math.max(max, maybe);
  });
  return max + 1;
}

function toast(msg, type = "info") {
  const t = document.getElementById("toast");
  const el = document.createElement("div");
  el.className = "toast-msg" + (type === "success" ? " success" : type === "error" ? " error" : "");

  const icon = type === "success" ? "check-circle" : type === "error" ? "alert-circle" : "info";
  el.innerHTML = `<i data-lucide="${icon}" style="width:16px; height:16px; vertical-align: middle; margin-right: 8px;"></i><span>${msg}</span>`;

  t.appendChild(el);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, 3500);
}

// ── NOTIFICATION HELPER ──
const ADMIN_EMAIL = "himanshuakodiya19@gmail.com"; // Replace with actual admin email

async function sendNotification(to, subject, body) {
  if (!to || !SCRIPT_URL) return;
  try {
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify({ action: "notify", to, subject, body })
    });
    console.log(`Notification sent to ${to}: ${subject}`);
  } catch (e) {
    console.error("Notification failed:", e);
  }
}

function refreshNavCount() {
  const el = document.getElementById("navbar-case-count");
  if (el) el.textContent = (DB.cases ? DB.cases.length : 0) + " case" + (DB.cases.length !== 1 ? "s" : "");
  const side = document.getElementById("sidebar-case-count");
  if (side) side.textContent = (DB.cases ? DB.cases.length : 0) + " case" + (DB.cases.length !== 1 ? "s" : "");
}

function visibleCasesForCurrentUser() {
  const role = currentRole();
  const email = currentUserEmail();
  if (role === "Admin") return DB.cases.slice();
  return DB.cases.filter(c => ((c.assignedTo || c.initiatedBy || "").toLowerCase() === email));
}

let tomSelectInstances = {};

function refreshDropdowns() {
  const ids = ["hu-caseid", "al-caseid", "cl-caseid", "tl-filter", "di-caseid", "rr-caseid"];
  const visibleCases = visibleCasesForCurrentUser();
  ids.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;

    if (tomSelectInstances[id]) {
      tomSelectInstances[id].destroy();
      tomSelectInstances[id] = null;
    }

    sel.innerHTML = id === "tl-filter" ? `<option value="">-- All Cases --</option>` : `<option value="">-- Select Case --</option>`;
    visibleCases.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.caseId;
      opt.textContent = `${c.caseId} - ${c.clientName || "Unknown"} (${c.companyName || "-"})`;
      if (c.caseId === cur) opt.selected = true;
      sel.appendChild(opt);
    });

    if (window.TomSelect) {
      tomSelectInstances[id] = new TomSelect(sel, {
        create: false,
        sortField: { field: "text", direction: "asc" }
      });
    }
  });
  renderCaseStudyOptions();
}

function renderCaseStudyOptions() {
  const sel = document.getElementById("cs-caseid");
  if (!sel) return;
  const q = (document.getElementById("cs-search") ? document.getElementById("cs-search").value : "").toLowerCase().trim();
  const current = sel.value;
  const list = visibleCasesForCurrentUser().filter(c => !q || `${c.caseId} ${c.clientName || ""} ${c.companyName || ""}`.toLowerCase().includes(q));

  if (tomSelectInstances["cs-caseid"]) {
    tomSelectInstances["cs-caseid"].destroy();
    tomSelectInstances["cs-caseid"] = null;
  }

  sel.innerHTML = `<option value="">-- Select Case --</option>`;
  list.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.caseId;
    opt.textContent = `${c.caseId} - ${c.clientName || "Unknown"} (${c.companyName || "-"})`;
    if (c.caseId === current) opt.selected = true;
    sel.appendChild(opt);
  });

  if (window.TomSelect) {
    tomSelectInstances["cs-caseid"] = new TomSelect(sel, {
      create: false,
      sortField: { field: "text", direction: "asc" }
    });
  }
}

// Clock
setInterval(() => { const el = document.getElementById("clock"); if (el) el.textContent = new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }); }, 1000);

// ══════════════════════════════════════
//  *** TAB SWITCHER & HISTORY ***
// ══════════════════════════════════════
let tabHistory = ["dashboard"];

window.switchTab = function (tabName, skipHistory = false) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (!tab) return;

  // Track History
  const currentTab = document.querySelector(".tab.active")?.dataset.tab || "dashboard";
  if (!skipHistory && currentTab !== tabName) {
    tabHistory.push(currentTab);
  }

  // Show/Hide Back Button
  const backBtn = document.getElementById("nav-back-btn");
  if (backBtn) backBtn.style.display = tabHistory.length > 1 ? "flex" : "none";

  // Step 1: Remove active from all tabs
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));

  // Step 2: FORCE HIDE all sections
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
  }

  // Step 5: Refresh dropdowns
  refreshDropdowns();

  // Step 6: Tab-specific render
  const safe = (fn) => { try { if (typeof window[fn] === "function") window[fn](); } catch (e) { console.error(fn + ":", e); } };
  if (tabName === "dashboard") safe("updateDashboard");
  else if (tabName === "case-master") safe("renderCaseMaster");
  else if (tabName === "history") safe("renderHistoryTable");
  else if (tabName === "action-log") safe("renderActionTable");
  else if (tabName === "comm-log") safe("renderCommTable");
  else if (tabName === "timeline") safe("renderTimeline");
  else if (tabName === "doc-index") safe("renderDocIndex");
  else if (tabName === "case-study") safe("renderStudyControl");
  else if (tabName === "admin-panel") { safe("renderRefundApprovals"); safe("setupUserRoleOptions"); }
  else if (tabName === "internal-search") safe("renderSampleSearch");
  else if (tabName === "reviewer-panel") safe("renderReviewerDashboard");
  else if (tabName === "accountant-dashboard") safe("renderAccountantDashboard");

  if (window.innerWidth <= 1024) toggleSidebar(false);
  if (window.lucide) lucide.createIcons();
};

window.goBackTab = function () {
  if (tabHistory.length > 1) {
    const prev = tabHistory.pop();
    switchTab(prev, true);
  }
};

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    switchTab(tab.dataset.tab);
  });
});

window.toggleSidebar = function (openState) {
  const sidebar = document.getElementById("sidebar-tabs");
  const overlay = document.getElementById("sidebar-overlay");
  const main = document.querySelector(".main");
  if (!sidebar || !overlay || !main) return;

  if (window.innerWidth > 1024) {
    // Desktop: Mini Sidebar Toggle
    // openState true = Expanded, false = Collapsed
    let shouldCollapse;
    if (typeof openState === "boolean") {
      shouldCollapse = !openState;
    } else {
      shouldCollapse = !sidebar.classList.contains("collapsed");
    }

    sidebar.classList.toggle("collapsed", shouldCollapse);
    main.classList.toggle("sidebar-collapsed", shouldCollapse);
    localStorage.setItem("rrr_sidebar_collapsed", shouldCollapse);
  } else {
    // Mobile: Drawer Toggle
    const shouldOpen = typeof openState === "boolean" ? openState : !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", shouldOpen);
    overlay.classList.toggle("open", shouldOpen);
  }
};

// ══════════════════════════════════════
//  LOGOUT
// ══════════════════════════════════════
window.logout = function () {
  if (confirm("Are you sure you want to logout?")) {
    localStorage.removeItem("rrr_logged_in");
    localStorage.removeItem("rrr_user_role");
    localStorage.removeItem("rrr_user_email");
    try { window.location.replace("login.html"); } catch (e) { }
  }
};

// ── QUICK NAV TO CASE MASTER ──
window.goToCaseMaster = function (caseId) {
  // 1. Switch active tab class logic
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  const targetTab = document.querySelector('[data-tab="case-master"]');
  if (targetTab) targetTab.classList.add("active");

  // 2. Hide all sections, show case master
  document.querySelectorAll(".section").forEach(s => {
    s.classList.remove("active");
    s.style.display = "none";
  });
  const caseMasterSec = document.getElementById("tab-case-master");
  if (caseMasterSec) {
    caseMasterSec.classList.add("active");
    caseMasterSec.style.display = "block";
  }

  // 3. Set search query and render
  const searchInput = document.getElementById("cm-search");
  if (searchInput) {
    searchInput.value = caseId;
    renderCaseMaster();
  }
};

// ══════════════════════════════════════
//  ROLE HELPERS
// ══════════════════════════════════════
function normalizeRole(role) {
  const r = (role || "").toString().trim().toLowerCase();
  if (r === "admin") return "Admin";
  if (r === "approver" || r === "approval") return "Admin";
  if (r === "operations" || r === "operation") return "Operations";
  if (r === "reviewer") return "Reviewer";
  if (r === "accountant") return "Accountant";
  return "Staff";
}
function currentRole() { return normalizeRole(localStorage.getItem("rrr_user_role")); }
function currentUserEmail() { return (localStorage.getItem("rrr_user_email") || "").trim().toLowerCase(); }
function isAdmin() { return currentRole() === "Admin"; }
function isOperations() { return currentRole() === "Operations"; }
function isStaff() { return currentRole() === "Staff"; }
function isReviewer() { return currentRole() === "Reviewer"; }
function canRaiseRefundRequest() { return isAdmin() || isOperations() || isStaff(); }

function getRefundStatusClass(status) {
  if (status === "Approved" || status === "Refund Completed") return "badge-closed";
  if (status === "Pending Payment") return "badge-pending";
  if (status === "Rejected by Reviewer") return "badge-high";
  return "badge-pending";
}

function normalizeRefundStatus(status) {
  const s = (status || "").trim();
  if (s === "Pending Admin Approval") return "Pending Approval";
  if (s === "Sent Back by Reviewer") return "Rejected by Reviewer";
  return s || "Pending Review";
}

function formatRefundStatus(status) {
  const s = status || "Pending Approval";
  const cls = s === "Approved" ? "badge-closed" : s === "Rejected" ? "badge-high" : "badge-pending";
  return `<span class="badge ${cls}">${s}</span>`;
}

// ══════════════════════════════════════
//  BADGE HELPERS
// ══════════════════════════════════════
function statusBadge(s) {
  const map = { "New": "pending", "Open": "open", "Closed": "closed", "Settled": "settled", "In Progress": "pending", "Pending Response": "pending", "Refund Pending Approval": "pending", "Refund Approved": "closed" };
  return `<span class="badge badge-${map[s] || 'open'}">${s || 'Open'}</span>`;
}
function priorityBadge(p) {
  const map = { "High": "high", "Medium": "medium", "Low": "low" };
  return `<span class="badge badge-${map[p] || 'medium'}">${p || 'Medium'}</span>`;
}

// ══════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════
function updateDashboard() {
  normalizeDBShape();
  const role = currentRole();
  const email = currentUserEmail();
  const visibleCases = role === "Admin"
    ? DB.cases
    : DB.cases.filter(c => ((c.assignedTo || c.initiatedBy || "").toLowerCase() === email));

  document.getElementById("stat-total").textContent = visibleCases.length;

  // Status Stats based on Action Log dropdown
  document.getElementById("stat-new").textContent = visibleCases.filter(c => c.currentStatus === "New").length;
  document.getElementById("stat-open").textContent = visibleCases.filter(c => c.currentStatus === "Open").length;
  document.getElementById("stat-inprogress").textContent = visibleCases.filter(c => c.currentStatus === "In Progress").length;
  document.getElementById("stat-pendingresp").textContent = visibleCases.filter(c => c.currentStatus === "Pending Response").length;
  document.getElementById("stat-settled").textContent = visibleCases.filter(c => c.currentStatus === "Settled").length;
  document.getElementById("stat-closed").textContent = visibleCases.filter(c => c.currentStatus === "Closed").length;

  // Priority Stats
  document.getElementById("stat-high").textContent = visibleCases.filter(c => c.priority === "High").length;
  document.getElementById("stat-medium").textContent = visibleCases.filter(c => c.priority === "Medium").length;
  document.getElementById("stat-low").textContent = visibleCases.filter(c => c.priority === "Low").length;

  const today = new Date();
  const twoDays = new Date(); twoDays.setDate(today.getDate() + 2);
  let overdue = [], dueSoon = [];
  visibleCases.forEach(c => {
    if (!c.nextActionDate || c.currentStatus === "Closed" || c.currentStatus === "Settled") return;
    const nd = new Date(c.nextActionDate);
    if (nd < today) overdue.push(c);
    else if (nd <= twoDays) dueSoon.push(c);
  });
  const elOverdue = document.getElementById("stat-overdue"); if (elOverdue) elOverdue.textContent = overdue.length;
  const elDueSoon = document.getElementById("stat-duesoon"); if (elDueSoon) elDueSoon.textContent = dueSoon.length;

  const od = document.getElementById("dash-overdue");
  if (od) {
    od.innerHTML = overdue.length ? overdue.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--gray-border); cursor:pointer;" onclick="goToCaseMaster('${c.caseId}')">
          <span class="case-id-display">${c.caseId}</span> — <strong>${c.clientName}</strong>
          <span class="overdue" style="float:right">${c.nextActionDate}</span></div>`).join("") :
      `<div class="empty-state"><i data-lucide="check-circle" style="width:20px; height:20px; color:var(--green);"></i> No overdue actions</div>`;
  }
  const ds = document.getElementById("dash-duesoon");
  if (ds) {
    ds.innerHTML = dueSoon.length ? dueSoon.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--gray-border); cursor:pointer;" onclick="goToCaseMaster('${c.caseId}')">
          <span class="case-id-display">${c.caseId}</span> — <strong>${c.clientName}</strong>
          <span class="due-soon" style="float:right">${c.nextActionDate}</span></div>`).join("") :
      `<div class="empty-state"><i data-lucide="check-circle" style="width:20px; height:20px; color:var(--green);"></i> Nothing due soon</div>`;
  }
  const lc = document.getElementById("dash-last-check");
  if (lc) lc.textContent = `${currentRole()} Department | Last checked: ${nowIST()}`;

  renderRefundDashboard();
  const body = document.getElementById("dash-recent-body");
  if (!body) return;
  const recent = visibleCases.slice(-5).reverse();
  if (!recent.length) { body.innerHTML = `<tr><td colspan="6" class="empty-state">No cases yet</td></tr>`; return; }
  body.innerHTML = recent.map(c => `
        <tr>
          <td><span class="case-id-display" style="cursor:pointer; color:var(--blue); font-weight:bold; text-decoration:underline;" onclick="goToCaseMaster('${c.caseId}')">${c.caseId}</span></td>
          <td>${c.companyName || "-"}</td>
          <td>${c.clientName}</td>
          <td>${priorityBadge(c.priority)}</td>
          <td>${statusBadge(c.currentStatus)}</td>
          <td>${formatDate(c.lastUpdateDate)}</td>
        </tr>`).join("");
}

function runDailyChecker() {
  const today = new Date();
  const twoDays = new Date(); twoDays.setDate(today.getDate() + 2);
  let overdue = [], dueSoon = [];
  DB.cases.forEach(c => {
    if (!c.nextActionDate || c.currentStatus === "Closed" || c.currentStatus === "Settled") return;
    const nd = new Date(c.nextActionDate);
    if (nd < today) overdue.push(c);
    else if (nd <= twoDays) dueSoon.push(c);
  });
  document.getElementById("stat-overdue").textContent = overdue.length;
  document.getElementById("stat-duesoon").textContent = dueSoon.length;
  document.getElementById("stat-settled").textContent = DB.cases.filter(c => c.currentStatus === "Settled" || c.currentStatus === "Closed").length;
  document.getElementById("stat-high").textContent = DB.cases.filter(c => c.priority === "High").length;
  const od = document.getElementById("dash-overdue");
  od.innerHTML = overdue.length ? overdue.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--gray-border)">
        <span class="case-id-display">${c.caseId}</span> — <strong>${c.clientName}</strong>
        <span class="overdue" style="float:right">${c.nextActionDate}</span></div>`).join("") :
    `<div class="empty-state"><span class="emoji">✅</span>No overdue actions</div>`;
  const ds = document.getElementById("dash-duesoon");
  ds.innerHTML = dueSoon.length ? dueSoon.map(c => `<div style="padding:8px 0;border-bottom:1px solid var(--gray-border)">
        <span class="case-id-display">${c.caseId}</span> — <strong>${c.clientName}</strong>
        <span class="due-soon" style="float:right">${c.nextActionDate}</span></div>`).join("") :
    `<div class="empty-state"><span class="emoji">✅</span>Nothing due soon</div>`;
  document.getElementById("dash-last-check").textContent = `${currentRole()} Department | Last checked: ${nowIST()}`;
  toast("Daily checker complete!", "success");
}

// ══════════════════════════════════════
//  NEW CASE
// ══════════════════════════════════════
async function submitNewCase() {
  const get = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  if (!get("nc-company") || !get("nc-title") || !get("nc-client") || !get("nc-summary") || !get("nc-brand")) {
    toast("Required fields missing! (Company, Title, Brand, Client, Summary)", "error"); return;
  }
  try {
    const serviceRows = document.querySelectorAll(".service-row");
    let servicesData = [];
    serviceRows.forEach(row => {
      const name = row.querySelector(".s-name") ? row.querySelector(".s-name").value : "";
      const status = row.querySelector(".s-status") ? row.querySelector(".s-status").value : "";
      const amt = row.querySelector(".s-amt") ? row.querySelector(".s-amt").value : "0";
      if (name) servicesData.push(`${name} [₹${amt}] (${status})`);
    });
    const ackInputs = document.querySelectorAll(".ack-input");
    const capturedAcks = Array.from(ackInputs).map(i => i.value.trim()).filter(v => v).join(", ");
    const caseId = editingCaseId || generateCaseId(get("nc-brand"));
    const existing = editingCaseId ? DB.cases.find(c => c.caseId === editingCaseId) : null;
    const createdDate = existing ? existing.createdDate : nowIST();
    const row = {
      caseId, createdDate,
      companyName: get("nc-company"), caseTitle: get("nc-title"), priority: get("nc-priority"),
      sourceOfComplaint: get("nc-business"), typeOfComplaint: get("nc-complaint-type"),
      brandName: get("nc-brand"),
      servicesSold: servicesData.join(", "), engagementNote: get("nc-engagement-note"),
      cyberAckNumbers: capturedAcks, firNumber: get("nc-fir-num"),
      firFileLink: document.getElementById("nc-fir-file-data") ? document.getElementById("nc-fir-file-data").value : "",
      grievanceNumber: get("nc-grievance-num"),
      clientName: get("nc-client"), clientMobile: get("nc-mobile"), clientEmail: get("nc-email"),
      state: get("nc-state"), totalAmtPaid: get("nc-amtpaid") || "0", mouSigned: get("nc-mou"),
      totalMouValue: get("nc-mouval") || "0", amtInDispute: get("nc-dispute") || "0",
      smRisk: get("nc-smrisk"), complaint: get("nc-complaint"), policeThreat: get("nc-police"),
      caseSummary: get("nc-summary"), clientAllegation: get("nc-allegation"),
      proofCallRec: get("nc-call-rec"), proofWaChat: get("nc-wa-chat"),
      proofVideoCall: get("nc-v-call"), proofFundingEmail: get("nc-funding-email"),
      initiatedBy: get("nc-lead") || currentUserEmail(), accountable: get("nc-negotiator"),
      legalOfficer: get("nc-legal"), accounts: get("nc-accounts"),
      // Default assignment: whoever created the case can see it
      assignedTo: existing ? (existing.assignedTo || existing.assignedOps || "") : currentUserEmail(),
      assignedOps: existing ? existing.assignedOps || "" : "",
      assignedReviewer: existing ? existing.assignedReviewer || "" : "",
      assignedAccountant: existing ? existing.assignedAccountant || "" : "",
      updatedAtMs: Date.now(),
      caseCreatedSource: existing ? (existing.caseCreatedSource || "Form") : "Form",
      currentStatus: existing ? (existing.currentStatus || "New") : "New",
      lastUpdateDate: createdDate
    };
    if (existing) {
      const idx = DB.cases.findIndex(c => c.caseId === editingCaseId);
      DB.cases[idx] = { ...existing, ...row };
      logActivity("CASE_UPDATE", `Updated case for ${row.clientName}`, caseId);
      addTimelineEntry(caseId, nowIST(), "ACTION", "Case Updated", "Case details edited from New Case form");

      // Notify Admin about Case Update
      sendNotification(ADMIN_EMAIL, "Case Master Updated", `Hello Admin,\n\nA case has been updated.\n\nCase ID: ${caseId}\nUpdated By: ${currentUserEmail()}\nClient: ${row.clientName}\nStatus: ${row.currentStatus}\n\nPlease check the Case Master for latest details.`);
    } else {
      DB.cases.push(row);
      logActivity("CASE_CREATION", `Created new case for ${row.clientName}`, caseId);
      addTimelineEntry(caseId, createdDate, "CASE_CREATION", "Case Created", `New Case Registered (${row.typeOfComplaint})`);

      // Critical Case Alert to Admin
      const criticalTypes = ["Cyber Complaint", "FIR", "Legal Notice", "Consumer Complaint"];
      if (criticalTypes.includes(row.typeOfComplaint)) {
        sendNotification(ADMIN_EMAIL, "⚠️ CRITICAL CASE ALERT", `A new critical case has been registered.\n\nCase ID: ${caseId}\nType: ${row.typeOfComplaint}\nClient: ${row.clientName}\nCompany: ${row.companyName}\n\nPlease review immediately.`);
      }

      // Assignment Notification
      if (row.assignedTo && row.assignedTo !== currentUserEmail()) {
        sendNotification(row.assignedTo, "New Case Assigned", `Hello,\n\nA new case has been assigned to you.\n\nCase ID: ${caseId}\nClient: ${row.clientName}\nPriority: ${row.priority}\n\nPlease check your dashboard for details.`);
      }
    }
    refreshAllUI();
    document.querySelector('[data-tab="case-master"]').click();
    toast(existing ? "Case updated! Syncing..." : "Case created! Syncing...", "success");
    clearNewCaseForm();
    await saveDB();
  } catch (error) {
    console.error("Submission Error:", error);
    toast("Error: " + error.message, "error");
  }
}

function clearNewCaseForm() {
  document.querySelectorAll("#tab-new-case input, #tab-new-case textarea").forEach(i => i.value = "");
  document.querySelectorAll("#tab-new-case select").forEach(s => s.selectedIndex = 0);
  toggleServiceMode();
  const chip = document.getElementById("nc-fir-file-chip"); if (chip) chip.innerHTML = "";
  const fd = document.getElementById("nc-fir-file-data"); if (fd) fd.value = "";
  editingCaseId = null;
  const submitBtn = document.getElementById("nc-submit-btn"); if (submitBtn) submitBtn.textContent = "✅ Create Case & Generate Study";
  const cancelBtn = document.getElementById("nc-cancel-edit-btn"); if (cancelBtn) cancelBtn.style.display = "none";
  const titleEl = document.getElementById("new-case-section-title");
  if (titleEl) titleEl.textContent = "New Case Creation";
}

function startCaseEdit(caseId) {
  const c = DB.cases.find(x => x.caseId === caseId);
  if (!c) { toast("Case not found for edit.", "error"); return; }
  editingCaseId = caseId;
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ""; };
  set("nc-company", c.companyName); set("nc-title", c.caseTitle); set("nc-priority", c.priority);
  set("nc-business", c.sourceOfComplaint); set("nc-complaint-type", c.typeOfComplaint);
  set("nc-brand", c.brandName);
  set("nc-fir-num", c.firNumber); set("nc-grievance-num", c.grievanceNumber);
  set("nc-client", c.clientName); set("nc-mobile", c.clientMobile); set("nc-email", c.clientEmail); set("nc-state", c.state);
  set("nc-amtpaid", c.totalAmtPaid); set("nc-mou", c.mouSigned); set("nc-mouval", c.totalMouValue); set("nc-dispute", c.amtInDispute);
  set("nc-smrisk", c.smRisk); set("nc-complaint", c.complaint); set("nc-police", c.policeThreat);
  set("nc-summary", c.caseSummary); set("nc-allegation", c.clientAllegation);
  set("nc-call-rec", c.proofCallRec); set("nc-wa-chat", c.proofWaChat); set("nc-v-call", c.proofVideoCall); set("nc-funding-email", c.proofFundingEmail);
  set("nc-lead", c.initiatedBy); set("nc-negotiator", c.accountable); set("nc-legal", c.legalOfficer); set("nc-accounts", c.accounts);
  set("nc-engagement-note", c.engagementNote);

  // Pre-fill File Link
  const firData = document.getElementById("nc-fir-file-data");
  if (firData) firData.value = c.firFileLink || "";
  const firChip = document.getElementById("nc-fir-file-chip");
  if (firChip && c.firFileLink) firChip.innerHTML = `<div class="file-chip"><span><i data-lucide="file-text"></i> Attached File</span></div>`;

  handleComplaintTypeChange(c.typeOfComplaint || "");

  // Pre-fill Cyber Acks
  const ackContainer = document.getElementById("ack-container");
  if (ackContainer && c.cyberAckNumbers) {
    ackContainer.innerHTML = "";
    c.cyberAckNumbers.split(",").forEach(ack => {
      const val = ack.trim();
      if (!val) return;
      const div = document.createElement("div");
      div.style = "display:flex;gap:10px;margin-bottom:5px;";
      div.innerHTML = `<input class="ack-input" value="${val}" placeholder="Enter Acknowledgment Number" style="flex:1;"><button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>`;
      ackContainer.appendChild(div);
    });
    if (!ackContainer.children.length) addAckField();
  }

  // Pre-fill Services
  const servContainer = document.getElementById("services-container");
  if (servContainer) {
    servContainer.innerHTML = "";
    const items = (c.servicesSold || "").split(", ").filter(x => x.trim());

    if (items.length === 0) {
      // Fallback for cases with no services but have a total amount
      addServiceRow();
      const firstAmt = servContainer.querySelector(".s-amt");
      if (firstAmt) firstAmt.value = c.totalAmtPaid || "0";
    } else {
      items.forEach((item, idx) => {
        const match = item.match(/^(.*?)\s*\[₹([\d.]+)\]\s*\((.*?)\)$/);
        const mode = document.getElementById("nc-service-mode") ? document.getElementById("nc-service-mode").value : "single";
        const row = document.createElement("div");
        row.className = "service-row";

        let name = item, amt = "0", status = "Not Initiated";
        if (match) { name = match[1]; amt = match[2]; status = match[3]; }

        // CRITICAL: If this is the only service and amount is 0, but we have a payment, use it!
        if (items.length === 1 && (amt === "0" || !amt || amt === "undefined")) {
          amt = c.totalAmtPaid || c.totalMouValue || "0";
        }

        row.innerHTML = `
            ${mode === "multiple" && idx > 0 ? `<div class="remove-service" onclick="this.parentElement.remove(); calculateTotalServiceAmount();">✕</div>` : ""}
            <div class="field"><label>Service Name</label><input class="s-name" value="${name}" placeholder="Enter service"></div>
            <div class="field"><label>Service Amount</label><input type="number" class="s-amt" value="${amt}" placeholder="0" oninput="calculateTotalServiceAmount()"></div>
            <div class="field"><label>MOU Signed</label><select class="s-mou"><option ${c.mouSigned === "No" ? "selected" : ""}>No</option><option ${c.mouSigned === "Yes" ? "selected" : ""}>Yes</option></select></div>
            <div class="field"><label>Signed MOU Amount</label><input type="number" class="s-mou-amt" value="${c.mouSigned === "Yes" ? amt : "0"}" placeholder="0"></div>
            <div class="field"><label>Work Status</label>
                <select class="s-status">
                    <option ${status === "Not Initiated" ? "selected" : ""}>Not Initiated</option>
                    <option ${status === "In Progress" ? "selected" : ""}>In Progress</option>
                    <option ${status === "Work in Progress" ? "selected" : ""}>Work in Progress</option>
                    <option ${status === "Completed" ? "selected" : ""}>Completed</option>
                    <option ${status === "Escalated" ? "selected" : ""}>Escalated</option>
                    <option ${status === "Hold" ? "selected" : ""}>Hold</option>
                    <option ${status === "File Not Eligible" ? "selected" : ""}>File Not Eligible</option>
                    <option ${status === "QA Not Approved" ? "selected" : ""}>QA Not Approved</option>
                    <option ${status === "Service Converted" ? "selected" : ""}>Service Converted</option>
                    <option ${status === "NA" ? "selected" : ""}>NA</option>
                </select>
            </div>
            <div class="field"><label>BDA</label><input class="s-bda" placeholder="Name"></div>
            <div class="field"><label>Department</label>
                <select class="s-dept"><option>Operations</option><option>Loan</option><option>Digital Marketing</option></select>
            </div>`;
        servContainer.appendChild(row);
      });
    }
  }

  // Final fix: If MOU Signed is No, Total MOU Value must be 0
  if (c.mouSigned === "No") set("nc-mouval", "0");

  const submitBtn = document.getElementById("nc-submit-btn"); if (submitBtn) submitBtn.textContent = "💾 Update Case";
  const cancelBtn = document.getElementById("nc-cancel-edit-btn"); if (cancelBtn) cancelBtn.style.display = "inline-flex";

  const titleEl = document.getElementById("new-case-section-title");
  if (titleEl) titleEl.innerHTML = `<i data-lucide="pencil" style="width:18px;height:18px;vertical-align:middle;"></i> Editing Case: <span style="color:var(--blue)">${caseId}</span>`;

  switchTab("new-case");
  calculateTotalServiceAmount();

  // FINAL FORCE: If MOU Signed is No, Total MOU Value must be 0
  if (c.mouSigned === "No" || document.getElementById("nc-mou").value === "No") {
    set("nc-mouval", "0");
  }

  if (window.lucide) lucide.createIcons();
}

function calculateTotalServiceAmount() {
  const amts = document.querySelectorAll(".s-amt");
  let total = 0;
  amts.forEach(input => {
    total += parseFloat(input.value) || 0;
  });
  const totalField = document.getElementById("nc-amtpaid");
  if (totalField) totalField.value = total;
}
function cancelCaseEdit() { clearNewCaseForm(); }

// ══════════════════════════════════════
//  CASE MASTER
// ══════════════════════════════════════
function renderCaseMaster() {
  const q = (document.getElementById("cm-search") ? document.getElementById("cm-search").value : "").toLowerCase();
  const status = document.getElementById("cm-filter-status") ? document.getElementById("cm-filter-status").value : "";
  const prio = document.getElementById("cm-filter-priority") ? document.getElementById("cm-filter-priority").value : "";
  const assignee = document.getElementById("cm-filter-assignee") ? document.getElementById("cm-filter-assignee").value : "";
  const body = document.getElementById("cm-body");
  if (!body) return;
  const role = currentRole();
  const email = currentUserEmail();
  let filtered = DB.cases.filter(c => {
    const roleMatch = role === "Admin"
      ? true
      : ((c.assignedTo || c.initiatedBy || "").toLowerCase() === email);
    const matchQ = !q || JSON.stringify(c).toLowerCase().includes(q);
    const matchSt = !status || c.currentStatus === status;
    const matchPr = !prio || c.priority === prio;
    const matchAs = !assignee || (c.assignedTo || c.initiatedBy || "").toLowerCase() === assignee.toLowerCase();
    return roleMatch && matchQ && matchSt && matchPr && matchAs;
  }).slice().reverse();
  if (!filtered.length) { body.innerHTML = `<tr><td colspan="12"><div class="empty-state"><i data-lucide="folder-open" style="width:24px; height:24px; opacity:0.5;"></i> No cases match your filter.</div></td></tr>`; updateBulkActionVisibility(); return; }
  body.innerHTML = filtered.map(c => `<tr>
        <td><input type="checkbox" class="cm-row-select" data-id="${c.caseId}" onchange="updateBulkActionVisibility()"></td>
        <td><span class="case-id-display" style="cursor:pointer;color:var(--blue)" onclick="showCaseDetail('${c.caseId}')">${c.caseId}</span></td>
        <td>${formatDate(c.createdDate)}</td>
        <td>${c.companyName}</td>
        <td>${c.clientName}<br><span class="text-muted" style="font-size:11px">${c.clientMobile}</span></td>
        <td>${c.servicesSold || "-"}</td>
        <td>₹${Number(c.totalAmtPaid || 0).toLocaleString("en-IN")}</td>
        <td>${priorityBadge(c.priority)}</td>
        <td>${statusBadge(c.currentStatus)}</td>
        <td>${c.assignedTo || c.initiatedBy || "-"}</td>
        <td>${formatDate(c.lastUpdateDate)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="showCaseDetail('${c.caseId}')" title="View"><i data-lucide="eye"></i></button>
          <button class="btn btn-primary btn-sm" onclick="startCaseEdit('${c.caseId}')" title="Edit"><i data-lucide="pencil"></i></button>
          ${currentRole() === "Admin" ? `
          <div style="display:flex; gap:6px; margin-top:6px;">
            <input id="assign-${c.caseId}" placeholder="assign email" value="${c.assignedTo || ""}" style="min-width:150px; font-size:11px; padding:5px 7px;">
            <button class="btn btn-outline btn-sm" onclick="assignCaseToUser('${c.caseId}')">Assign</button>
          </div>` : ""}
        </td>
    </tr>`).join("");
  updateBulkActionVisibility();
}

function refreshAssigneeFilter() {
  const el = document.getElementById("cm-filter-assignee");
  if (!el) return;
  const emails = new Set();
  DB.cases.forEach(c => {
    if (c.assignedTo) emails.add(c.assignedTo.trim().toLowerCase());
    if (c.initiatedBy) emails.add(c.initiatedBy.trim().toLowerCase());
  });
  const currentVal = el.value;
  el.innerHTML = '<option value="">All Assignees</option>' + Array.from(emails).sort().map(e => `<option value="${e}">${e}</option>`).join("");
  el.value = currentVal;

  if (window.TomSelect) {
    if (tomSelectInstances["cm-filter-assignee"]) {
      tomSelectInstances["cm-filter-assignee"].destroy();
    }
    tomSelectInstances["cm-filter-assignee"] = new TomSelect(el, {
      create: false,
      sortField: { field: "text", direction: "asc" }
    });
  }
}

function toggleSelectAll(master) {
  const cbs = document.querySelectorAll(".cm-row-select");
  cbs.forEach(cb => cb.checked = master.checked);
  updateBulkActionVisibility();
}

function updateBulkActionVisibility() {
  const cbs = document.querySelectorAll(".cm-row-select:checked");
  const bar = document.getElementById("cm-bulk-bar");
  const countEl = document.getElementById("cm-selected-count");
  if (!bar || !countEl) return;
  if (cbs.length > 0) {
    bar.style.display = "block";
    countEl.textContent = `${cbs.length} case${cbs.length > 1 ? "s" : ""} selected`;
  } else {
    bar.style.display = "none";
    const master = document.getElementById("cm-select-all");
    if (master) master.checked = false;
  }
}

async function bulkAssignCases() {
  if (currentRole() !== "Admin") { toast("Only admin can bulk assign cases.", "error"); return; }
  const email = document.getElementById("cm-bulk-assign-email").value.trim().toLowerCase();
  if (!email) { toast("Enter staff email for assignment.", "error"); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) { toast("Enter a valid email.", "error"); return; }

  const cbs = document.querySelectorAll(".cm-row-select:checked");
  const ids = Array.from(cbs).map(cb => cb.getAttribute("data-id"));

  let count = 0;
  ids.forEach(id => {
    const c = DB.cases.find(x => x.caseId === id);
    if (c) {
      c.assignedTo = email;
      c.lastUpdateDate = nowIST();
      c.updatedAtMs = Date.now();
      addTimelineEntry(id, nowIST(), "ACTION", "Bulk Assigned", `Case bulk assigned to ${email}`);
      count++;
    }
  });

  toast(`Successfully assigned ${count} cases to ${email}`, "success");

  // Notification for assignment
  sendNotification(email, "Cases Assigned to You (Bulk)", `Hello,\n\n${count} new cases have been assigned to you via bulk assignment.\n\nPlease check your Case Master register for updates.`);

  document.getElementById("cm-bulk-assign-email").value = "";
  refreshAllUI();
  await saveDB();
}

async function assignCaseToUser(caseId) {
  if (currentRole() !== "Admin") { toast("Only admin can assign cases.", "error"); return; }
  const c = DB.cases.find(x => x.caseId === caseId);
  if (!c) { toast("Case not found.", "error"); return; }
  const emailInput = document.getElementById(`assign-${caseId}`);
  const assigned = (emailInput ? emailInput.value : "").trim().toLowerCase();
  if (!assigned) { toast("Please enter assignee email.", "error"); return; }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(assigned)) { toast("Please enter a valid email address.", "error"); return; }
  c.assignedTo = assigned;
  c.lastUpdateDate = nowIST();
  c.updatedAtMs = Date.now();
  addTimelineEntry(caseId, nowIST(), "ACTION", "Case Assigned", `Assigned to ${assigned}`);
  toast(`Case assigned to ${assigned}`, "success");

  // Notification for assignment
  sendNotification(assigned, "New Case Assigned", `Hello,\n\nCase ID ${caseId} has been assigned to you.\n\nPlease check your Case Master register for updates.`);

  refreshAllUI();
  await saveDB();
}

function exportCaseMaster() {
  if (!DB.cases.length) { toast("No cases to export.", "error"); return; }
  const headers = ["caseId", "createdDate", "companyName", "caseTitle", "priority", "sourceOfComplaint", "typeOfComplaint", "brandName", "servicesSold", "engagementNote", "clientName", "clientMobile", "clientEmail", "state", "totalAmtPaid", "mouSigned", "totalMouValue", "amtInDispute", "smRisk", "complaint", "policeThreat", "caseSummary", "clientAllegation", "proofCallRec", "proofWaChat", "proofVideoCall", "proofFundingEmail", "initiatedBy", "accountable", "legalOfficer", "accounts", "caseCreatedSource", "currentStatus", "lastUpdateDate", "nextActionDate", "cyberAckNumbers", "firNumber", "firFileLink", "grievanceNumber"];
  const csv = [headers.join(","), ...DB.cases.map(c => headers.map(h => `"${(c[h] || "").toString().replace(/"/g, '""')}"`).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = "CaseMaster_" + Date.now() + ".csv";
  a.click();
  toast("CSV exported!", "success");
}

// ══════════════════════════════════════
//  CASE DETAIL MODAL
// ══════════════════════════════════════
function showCaseDetail(caseId) {
  const c = DB.cases.find(x => x.caseId === caseId);
  if (!c) { toast("Case not found!", "error"); return; }
  const tl = DB.timeline.filter(t => t.caseId === caseId).sort((a, b) => new Date(b.logTimestamp) - new Date(a.logTimestamp));
  document.getElementById("modal-case-id-title").textContent = "📋 " + caseId + " — " + c.clientName;
  document.getElementById("modal-body").innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;margin-bottom:16px">
          <div><span class="text-muted">Company:</span> <strong>${c.companyName}</strong></div>
          <div><span class="text-muted">Case Title:</span> ${c.caseTitle}</div>
          <div><span class="text-muted">Mobile:</span> ${c.clientMobile}</div>
          <div><span class="text-muted">Email:</span> ${c.clientEmail || "-"}</div>
          <div><span class="text-muted">Priority:</span> ${priorityBadge(c.priority)}</div>
          <div><span class="text-muted">Status:</span> ${statusBadge(c.currentStatus)}</div>
          <div><span class="text-muted">Amt Paid:</span> ₹${Number(c.totalAmtPaid || 0).toLocaleString("en-IN")}</div>
          <div><span class="text-muted">Initiated By:</span> ${c.initiatedBy || "-"}</div>
          <div><span class="text-muted">Assigned To:</span> ${c.assignedTo || c.initiatedBy || "-"}</div>
        </div>
        <hr class="divider"/>
        <div style="font-weight:600;margin-bottom:8px">Case Summary</div>
        <div style="font-size:13px;background:#f8f9fa;padding:10px;border-radius:4px;margin-bottom:16px">${c.caseSummary || "No summary available."}</div>
        ${c.firFileLink ? `<div style="font-weight:600;margin-bottom:8px">Uploaded FIR / Image</div><div style="margin-bottom:16px">${getFilePreviewHTML(c.firFileLink, "FIR Copy")}</div>` : ""}
        ${isAdmin() ? `
          <div style="font-weight:600;margin-bottom:8px">Timeline (${tl.length} entries)</div>
          ${tl.length ? `<ul class="timeline">${tl.map(t => `<li><div class="tl-meta">${formatDate(t.logTimestamp)}</div><div class="tl-event">${t.eventType}: ${t.summary}</div></li>`).join("")}</ul>` : `<div class="text-muted" style="font-size:13px">No timeline entries yet.</div>`}
        ` : ""}
        <hr class="divider"/>
        <div class="btn-row"><button class="btn btn-outline btn-sm" onclick="closeModal()">Close</button></div>`;
  document.getElementById("case-modal").classList.add("open");
}
function closeModal() { document.getElementById("case-modal").classList.remove("open"); }
window.onclick = function (e) {
  if (e.target == document.getElementById("case-modal")) closeModal();
  if (e.target == document.getElementById("file-preview-modal")) closeFilePreview();
};

// ══════════════════════════════════════
//  VALIDATION & FILE HELPERS
// ══════════════════════════════════════
function validateCaseId(id) {
  const val = document.getElementById(id).value;
  if (val && !DB.cases.find(c => c.caseId === val)) { toast("Invalid Case ID!", "error"); document.getElementById(id).value = ""; }
}
function handleDragOver(e, zoneId) { e.preventDefault(); document.getElementById(zoneId).classList.add("dragover"); }
function handleDragLeave(e, zoneId) { document.getElementById(zoneId).classList.remove("dragover"); }
function handleDrop(e, zoneId, dataId, chipId) { e.preventDefault(); document.getElementById(zoneId).classList.remove("dragover"); const f = e.dataTransfer.files[0]; if (f) processFile(f, zoneId, dataId, chipId); }
function handleFileSelect(e, zoneId, dataId, chipId) { const f = e.target.files[0]; if (f) processFile(f, zoneId, dataId, chipId); }
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(ev.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function compressImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1600, maxH = 1600;
        let { width, height } = img;
        const ratio = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function processFile(file, zoneId, dataId, chipId) {
  try {
    let result = "";
    if (file.type.startsWith("image/")) result = await compressImageFile(file);
    else result = await fileToDataUrl(file);
    document.getElementById(dataId).value = result;
    const chipEl = document.getElementById(chipId);
    const isImg = file.type.startsWith("image/");
    chipEl.innerHTML = `<div class="file-chip"><span><i data-lucide="${isImg ? 'image' : 'file-text'}" style="width:14px; height:14px; vertical-align: middle;"></i> <strong>${file.name}</strong></span><span class="remove-file" onclick="clearFileUpload('${chipId}','${dataId}','${zoneId}')"><i data-lucide="x" style="width:14px; height:14px;"></i></span></div>`;
    toast(isImg ? "Image optimized and attached." : "File attached.", "success");
    if (window.lucide) lucide.createIcons();
  } catch (e) {
    console.error(e);
    toast("File upload process failed.", "error");
  }
}
function clearFileUpload(chipId, dataId, zoneId) {
  document.getElementById(chipId).innerHTML = ""; document.getElementById(dataId).value = "";
  const inp = document.getElementById(zoneId) ? document.getElementById(zoneId).querySelector("input[type=file]") : null;
  if (inp) inp.value = "";
}
function resolveFileLink(dataId, urlInputId) {
  const data = document.getElementById(dataId) ? document.getElementById(dataId).value : "";
  const url = document.getElementById(urlInputId) ? document.getElementById(urlInputId).value.trim() : "";
  return data || url;
}
function updateCaseMasterField(caseId, field, value) {
  const c = DB.cases.find(x => x.caseId === caseId); if (c) { c[field] = value; return true; } return false;
}
function getDriveFileId(link) {
  const match = (link || "").match(/[-\w]{25,}/);
  return match ? match[0] : "";
}
function getFilePreviewHTML(link, label = "View") {
  if (!link || link === "-") return '<span style="color:#ccc">No File</span>';
  const escaped = String(link).replace(/"/g, "&quot;");
  return `<button onclick="previewStoredFile(this.getAttribute('data-file'))" data-file="${escaped}" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;"><i data-lucide="eye" style="width:11px; height:11px; vertical-align: middle;"></i> ${label}</button>`;
}
function previewStoredFile(link) {
  const modal = document.getElementById("file-preview-modal");
  const body = document.getElementById("file-preview-body");
  const title = document.getElementById("file-preview-title");
  const downloadBtn = document.getElementById("file-preview-download");
  if (!modal || !body) return;
  title.textContent = "File Preview";
  const safeFilename = "file_" + Date.now();
  const setDownload = (href, filename = safeFilename) => {
    if (!downloadBtn) return;
    downloadBtn.href = href || "#";
    downloadBtn.setAttribute("download", filename);
    downloadBtn.style.pointerEvents = href ? "auto" : "none";
    downloadBtn.style.opacity = href ? "1" : "0.5";
  };

  let html = `<div class="preview-meta">Preview</div><div style="height:calc(92vh - 120px)">`;
  if ((link || "").startsWith("data:image/")) {
    setDownload(link, safeFilename + ".jpg");
    html += `<img class="preview-img" src="${link}" alt="Preview image">`;
  } else if ((link || "").startsWith("data:")) {
    setDownload(link, safeFilename);
    html += `<iframe class="preview-media" src="${link}"></iframe>`;
  } else if ((link || "").includes("drive.google.com")) {
    const fileId = getDriveFileId(link);
    setDownload(fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : "", safeFilename);
    html += fileId
      ? `<img class="preview-img" src="https://drive.google.com/thumbnail?id=${fileId}&sz=w1600" alt="Drive image preview" onerror="this.outerHTML='<iframe class=&quot;preview-media&quot; src=&quot;https://drive.google.com/file/d/${fileId}/preview&quot; allow=&quot;autoplay&quot;></iframe>';">`
      : `<div class="empty-state">Preview unavailable for this Drive file.</div>`;
  } else if ((link || "").match(/\.(png|jpg|jpeg|gif|webp|bmp)(\?|$)/i)) {
    setDownload(link, safeFilename);
    html += `<img class="preview-img" src="${link}" alt="Preview image">`;
  } else {
    setDownload(link, safeFilename);
    html += `<iframe class="preview-media" src="${link}"></iframe>`;
  }
  body.innerHTML = html + `</div>`;
  modal.classList.add("open");
}
function closeFilePreview() { document.getElementById("file-preview-modal").classList.remove("open"); }

// ══════════════════════════════════════
//  TIMELINE
// ══════════════════════════════════════
function addTimelineEntry(caseId, eventDate, source, eventType, summary) {
  DB.timeline.push({ id: uid("TL"), caseId, eventDate, source, eventType, summary, logTimestamp: nowIST() });
}
function renderTimeline() {
  const filter = document.getElementById("tl-filter") ? document.getElementById("tl-filter").value : "";
  const container = document.getElementById("timeline-container");
  if (!container) return;
  const entries = DB.timeline.filter(e => !filter || e.caseId === filter).sort((a, b) => new Date(b.logTimestamp) - new Date(a.logTimestamp));
  if (!entries.length) { container.innerHTML = `<div class="empty-state"><i data-lucide="clock" style="width:24px; height:24px; opacity:0.5;"></i> No timeline entries yet.</div>`; return; }
  const sc = { CASE_CREATION: "background:#e8f0fe;color:#1a73e8", HISTORY: "background:#fef7e0;color:#e65100", ACTION: "background:#e6f4ea;color:#1e7e34", COMMUNICATION: "background:#f3e8ff;color:#7c3aed" };
  container.innerHTML = `<ul class="timeline">${entries.map(e => `<li>
        <div class="tl-meta"><strong>${formatDate(e.logTimestamp)}</strong> | <span class="case-id-display">${e.caseId}</span> | <span class="badge" style="${sc[e.source] || ''}">${e.source}</span></div>
        <div class="tl-event"><strong>${e.eventType}:</strong> ${e.summary}</div>
    </li>`).join("")}</ul>`;
}

// ══════════════════════════════════════
//  HISTORY
// ══════════════════════════════════════
async function submitHistory() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  const caseId = get("hu-caseid"), eventDate = get("hu-date"), summary = get("hu-summary");
  if (!caseId || !eventDate || !summary) { toast("Fill required fields (Case, Date, Summary)", "error"); return; }
  const row = { histId: uid("HIST"), caseId, eventDate, histType: document.getElementById("hu-type").value, summary, notes: get("hu-notes"), fileLink: resolveFileLink("hu-file-data", "hu-file"), source: get("hu-source"), enteredBy: get("hu-enteredby"), timestamp: nowIST(), updatedAtMs: Date.now() };
  DB.history.push(row);
  addTimelineEntry(caseId, eventDate, "HISTORY", row.histType, summary);
  renderHistoryTable();
  toast("History saved! Syncing...", "success");
  ["hu-summary", "hu-notes", "hu-file", "hu-source", "hu-enteredby", "hu-file-data"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const chip = document.getElementById("hu-file-chip"); if (chip) chip.innerHTML = "";
  await saveDB();
}
function renderHistoryTable() {
  const body = document.getElementById("hist-body");
  if (!body) return;
  if (!DB.history.length) { body.innerHTML = `<tr><td colspan="7"><div class="empty-state">No history entries yet.</div></td></tr>`; return; }
  body.innerHTML = DB.history.slice().reverse().map(h => `<tr>
        <td><span class="case-id-display">${h.histId}</span></td>
        <td><span class="case-id-display">${h.caseId}</span></td>
        <td>${formatDate(h.eventDate)}</td><td>${h.histType}</td><td>${h.summary}</td>
        <td>${getFilePreviewHTML(h.fileLink)}</td>
        <td>${h.enteredBy || "-"}</td>
    </tr>`).join("");
}

// ══════════════════════════════════════
//  ACTION LOG
// ══════════════════════════════════════
async function submitAction() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  const caseId = get("al-caseid"), summary = get("al-summary");
  if (!caseId || !summary) { toast("Select Case ID and enter Action Summary", "error"); return; }
  const actionType = document.getElementById("al-type").value;
  if (actionType === "Refund Request" && !canRaiseRefundRequest()) { toast("Only Admin or Operations can raise a refund request.", "error"); return; }
  const row = {
    actionId: uid("ACT"), caseId, dateTime: nowIST(), dept: document.getElementById("al-dept").value,
    doneBy: get("al-doneby") || currentUserEmail(), actionType, summary, notes: get("al-notes"),
    clientResp: get("al-clientresp"), observation: get("al-obs"), nextAction: get("al-nextaction"),
    nextActionBy: get("al-nextby"), nextActionDate: get("al-nextdate"), fileLink: resolveFileLink("al-file-data", "al-file"), updatedAtMs: Date.now()
  };
  if (actionType === "Refund Request") {
    row.status = "Pending Approval"; row.refundStatus = "Pending Approval";
    row.requestedByEmail = currentUserEmail(); row.requestedByRole = currentRole(); row.requestedAt = nowIST();
  }
  DB.actions.push(row);
  logActivity("ACTION_LOG", `Performed ${row.actionType}: ${summary}`, caseId);
  addTimelineEntry(caseId, row.dateTime, "ACTION", row.actionType, summary);
  updateCaseMasterField(caseId, "lastUpdateDate", nowIST());
  updateCaseMasterField(caseId, "nextActionDate", row.nextActionDate);
  updateCaseMasterField(caseId, "lastActionSummary", summary);
  const ns = document.getElementById("al-status").value;
  if (actionType === "Refund Request") updateCaseMasterField(caseId, "currentStatus", "Refund Pending Approval");
  else if (ns) updateCaseMasterField(caseId, "currentStatus", ns);
  renderActionTable(); renderRefundApprovals(); renderRefundDashboard();
  toast(actionType === "Refund Request" ? "Refund request sent for approval!" : "Action logged! Syncing...", "success");
  ["al-doneby", "al-nextby", "al-summary", "al-notes", "al-clientresp", "al-obs", "al-nextaction", "al-nextdate", "al-file", "al-file-data"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const chip = document.getElementById("al-file-chip"); if (chip) chip.innerHTML = "";
  document.getElementById("al-status").value = "";
  await saveDB();
}
function renderActionTable() {
  const body = document.getElementById("action-body");
  if (!body) return;
  if (!DB.actions.length) { body.innerHTML = `<tr><td colspan="10"><div class="empty-state">No actions logged yet.</div></td></tr>`; return; }
  body.innerHTML = DB.actions.slice().reverse().map(a => `<tr>
        <td><span class="case-id-display">${a.actionId}</span></td>
        <td><span class="case-id-display">${a.caseId}</span></td>
        <td>${formatDate(a.dateTime)}</td><td>${a.actionType}</td><td>${a.dept}</td>
        <td>${a.doneBy || "-"}</td><td>${a.summary}</td>
        <td>${getFilePreviewHTML(a.fileLink)}</td>
        <td>${a.actionType === "Refund Request" ? formatRefundStatus(a.refundStatus || a.status) : "-"}</td>
        <td>${formatDate(a.nextActionDate) || "-"}</td>
    </tr>`).join("");
}

// ══════════════════════════════════════
//  COMM LOG
// ══════════════════════════════════════
async function submitCommLog() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  const caseId = get("cl-caseid"), summary = get("cl-summary");
  if (!caseId || !summary) { toast("Select Case ID and enter Summary", "error"); return; }
  const mode = document.getElementById("cl-mode").value;
  const modeSafe = String(mode || "Mode").replace(/\s+/g, "");
  const sr = nextSerialForCase(DB.comms, caseId, "commId", `COMM-${modeSafe}-RRR-${caseId}-`);
  const row = { commId: `COMM-${modeSafe}-${caseId}-${sr}`, caseId, dateTime: get("cl-datetime") || nowIST(), mode, direction: document.getElementById("cl-dir").value, fromTo: get("cl-fromto"), summary, exactDemand: get("cl-exact"), refundDemanded: get("cl-refund"), legalThreat: document.getElementById("cl-legal").value, smMentioned: document.getElementById("cl-sm").value, fileLink: resolveFileLink("cl-file-data", "cl-file"), loggedBy: get("cl-loggedby"), timestamp: nowIST(), updatedAtMs: Date.now() };
  DB.comms.push(row);
  addTimelineEntry(caseId, row.dateTime, "COMMUNICATION", `${row.mode} ${row.direction}`, summary);
  updateCaseMasterField(caseId, "lastUpdateDate", nowIST());
  renderCommTable();
  toast("Communication logged! Syncing...", "success");
  ["cl-fromto", "cl-summary", "cl-exact", "cl-refund", "cl-file", "cl-file-data", "cl-loggedby", "cl-datetime"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const chip = document.getElementById("cl-file-chip"); if (chip) chip.innerHTML = "";
  await saveDB();
}
function renderCommTable() {
  const body = document.getElementById("comm-body");
  if (!body) return;
  if (!DB.comms.length) { body.innerHTML = `<tr><td colspan="9"><div class="empty-state">No communications logged yet.</div></td></tr>`; return; }
  body.innerHTML = DB.comms.slice().reverse().map(c => `<tr>
        <td><span class="case-id-display">${c.commId}</span></td>
        <td><span class="case-id-display">${c.caseId}</span></td>
        <td>${formatDate(c.dateTime)}</td><td>${c.mode}</td><td>${c.direction}</td>
        <td>${c.fromTo || "-"}</td><td>${c.summary}</td>
        <td>${getFilePreviewHTML(c.fileLink)}</td>
        <td>${c.legalThreat !== "No" ? "⚠️ Yes" : "No"}</td>
    </tr>`).join("");
}

// ══════════════════════════════════════
//  DOCUMENT INDEX
// ══════════════════════════════════════
async function submitDocUpload() {
  const get = id => document.getElementById(id) ? document.getElementById(id).value.trim() : "";
  const caseId = get("di-caseid"), fileLink = resolveFileLink("di-file-data", "di-file-url");
  if (!caseId || !fileLink) { toast("Select Case ID and attach a file!", "error"); return; }
  const sr = nextSerialForCase(DB.docs, caseId, "docId", `DOC-${caseId}-`);
  const docRow = { docId: `DOC-${caseId}-${sr}`, caseId, uploadDate: nowIST(), sourceForm: "MANUAL_UPLOAD", docType: get("di-doctype"), fileSummary: get("di-summary") || get("di-doctype"), fileLink, uploadedBy: get("di-uploadedby"), remarks: get("di-remarks"), updatedAtMs: Date.now() };
  DB.docs.push(docRow);
  addTimelineEntry(caseId, nowIST(), "DOCUMENT", docRow.docType, "Manual Upload: " + docRow.fileSummary);
  renderDocIndex();
  toast("Document indexed! Syncing...", "success");
  ["di-summary", "di-uploadedby", "di-remarks", "di-file-url", "di-file-data"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  const chip = document.getElementById("di-file-chip"); if (chip) chip.innerHTML = "";
  document.getElementById("di-caseid").value = "";
  await saveDB();
}
function renderDocIndex() {
  const q = (document.getElementById("di-search") ? document.getElementById("di-search").value : "").toLowerCase();
  const body = document.getElementById("doc-body");
  if (!body) return;
  const filtered = DB.docs.filter(d => !q || JSON.stringify(d).toLowerCase().includes(q));
  if (!filtered.length) { body.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i data-lucide="folder" style="width:24px; height:24px; opacity:0.5;"></i> No documents indexed yet.</div></td></tr>`; return; }
  body.innerHTML = filtered.slice().reverse().map(d => `<tr>
        <td><span class="case-id-display">${d.docId}</span></td>
        <td><span class="case-id-display">${d.caseId}</span></td>
        <td>${d.uploadDate}</td>
        <td><span class="badge badge-pending" style="font-size:10px">${d.sourceForm}</span></td>
        <td>${d.docType}</td><td>${d.fileSummary}</td>
        <td>${renderDocLink(d.fileLink, d.fileSummary)}</td>
        <td>${d.uploadedBy || "-"}</td>
    </tr>`).join("");
}
function renderDocLink(link, fileName) {
  if (!link) return "-";
  return getFilePreviewHTML(link, fileName || "View");
}

// ══════════════════════════════════════
//  CASE STUDY
// ══════════════════════════════════════
function renderStudyControl() {
  const body = document.getElementById("study-control-body");
  if (!body) return;
  if (!DB.studyControl || !DB.studyControl.length) { body.innerHTML = `<tr><td colspan="3"><div class="empty-state text-muted">No entries</div></td></tr>`; return; }
  body.innerHTML = DB.studyControl.map(s => `<tr>
        <td><span class="case-id-display">${s.caseId}</span></td>
        <td><span class="badge ${s.status === 'Study Generated' ? 'badge-closed' : 'badge-pending'}">${s.status}</span></td>
        <td>${s.lastRefreshDate || "-"}</td>
    </tr>`).join("");
}

async function generateCaseStudy() {
  const caseId = document.getElementById("cs-caseid").value;
  if (!caseId) { toast("Select a Case ID first.", "error"); return; }
  const c = DB.cases.find(x => x.caseId === caseId);
  if (!c) { toast("Case data not found.", "error"); return; }
  let sc = DB.studyControl.find(s => s.caseId === caseId);
  if (sc) { sc.lastRefreshDate = nowIST(); sc.status = "Study Generated"; }
  else DB.studyControl.push({ caseId, status: "Study Generated", lastRefreshDate: nowIST() });
  renderStudyControl();
  const tl = DB.timeline.filter(t => t.caseId === caseId).sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));
  const actions = DB.actions.filter(a => a.caseId === caseId).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
  const comms = DB.comms.filter(cm => cm.caseId === caseId).sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
  document.getElementById("cs-empty").style.display = "none";
  const preview = document.getElementById("case-study-preview"); preview.style.display = "block";
  document.getElementById("cs-preview-title").textContent = "📄 Case Study – " + caseId;
  const css = `<style>.cs-table{width:100%;border-collapse:collapse;margin-bottom:20px}.cs-table th{background:#1a73e8;color:white;padding:10px;text-align:left;text-transform:uppercase;font-size:13px}.cs-table td{padding:8px 12px;border:1px solid #dadce0;font-size:13px;color:#3c4043}.cs-label{font-weight:600;background:#f8f9fa;width:30%}</style>`;
  document.getElementById("cs-preview-content").innerHTML = css + `
        <table class="cs-table"><tr><th colspan="2">CASE OVERVIEW</th></tr>
          <tr><td class="cs-label">Case ID</td><td>${c.caseId}</td></tr>
          <tr><td class="cs-label">Created</td><td>${c.createdDate}</td></tr>
          <tr><td class="cs-label">Brand Name</td><td>${c.brandName || "-"}</td></tr>
          <tr><td class="cs-label">Company</td><td>${c.companyName}</td></tr>
          <tr><td class="cs-label">Case Title</td><td>${c.caseTitle}</td></tr>
          <tr><td class="cs-label">Client</td><td>${c.clientName}</td></tr>
          <tr><td class="cs-label">Mobile</td><td>${c.clientMobile}</td></tr>
          <tr><td class="cs-label">Email</td><td>${c.clientEmail || "-"}</td></tr>
          <tr><td class="cs-label">State</td><td>${c.state || "-"}</td></tr>
          <tr><td class="cs-label">Services</td><td>${c.servicesSold || "-"}</td></tr>
          <tr><td class="cs-label">Engagement Note</td><td>${c.engagementNote || "-"}</td></tr>
          <tr><td class="cs-label">Amount Paid</td><td>₹${Number(c.totalAmtPaid || 0).toLocaleString("en-IN")}</td></tr>
          <tr><td class="cs-label">Amount in Dispute</td><td>₹${Number(c.amtInDispute || 0).toLocaleString("en-IN")}</td></tr>
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
          <tr><td class="cs-label">Summary</td><td>${c.caseSummary || "-"}</td></tr>
          <tr><td class="cs-label">Allegation</td><td>${c.clientAllegation || "-"}</td></tr>
        </table>
        <table class="cs-table"><tr><th colspan="2">TEAM</th></tr>
          <tr><td class="cs-label">Initiated By</td><td>${c.initiatedBy || "-"}</td></tr>
          <tr><td class="cs-label">Accountable</td><td>${c.accountable || "-"}</td></tr>
          <tr><td class="cs-label">Legal Officer</td><td>${c.legalOfficer || "-"}</td></tr>
          <tr><td class="cs-label">Accounts</td><td>${c.accounts || "-"}</td></tr>
        </table>
        <table class="cs-table"><tr><th colspan="4">TIMELINE (${tl.length})</th></tr>
          <tr style="background:#f1f3f4;font-weight:bold"><td>Date</td><td>Source</td><td>Type</td><td>Summary</td></tr>
          ${tl.map(t => `<tr><td>${t.eventDate}</td><td>${t.source}</td><td>${t.eventType}</td><td>${t.summary}</td></tr>`).join("") || "<tr><td colspan='4'>No entries</td></tr>"}
        </table>
        <table class="cs-table"><tr><th colspan="4">ACTIONS (${actions.length})</th></tr>
          <tr style="background:#f1f3f4;font-weight:bold"><td>Date</td><td>Type</td><td>Done By</td><td>Summary</td></tr>
          ${actions.map(a => `<tr><td>${a.dateTime}</td><td>${a.actionType}</td><td>${a.doneBy || "-"}</td><td>${a.summary}</td></tr>`).join("") || "<tr><td colspan='4'>No actions</td></tr>"}
        </table>
        <table class="cs-table"><tr><th colspan="4">COMMUNICATIONS (${comms.length})</th></tr>
          <tr style="background:#f1f3f4;font-weight:bold"><td>Date</td><td>Mode</td><td>Direction</td><td>Summary</td></tr>
          ${comms.map(cm => `<tr><td>${cm.dateTime}</td><td>${cm.mode}</td><td>${cm.direction}</td><td>${cm.summary}</td></tr>`).join("") || "<tr><td colspan='4'>No communications</td></tr>"}
        </table>
        <div style="font-size:11px;color:#5f6368;text-align:center;margin-top:20px">Generated: ${nowIST()}</div>`;
  document.getElementById("cs-download-container").style.display = "block";
  toast("Case Study compiled!", "success");
  await saveDB();
}

function downloadPDF() {
  const element = document.getElementById('cs-preview-content');
  const caseId = document.getElementById("cs-caseid").value;
  if (!element || !caseId) { toast("No data to download!", "error"); return; }
  const opt = { margin: [10, 10, 10, 10], filename: `Case_Study_${caseId}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
  toast("Generating PDF...", "info");
  html2pdf().set(opt).from(element).save().then(() => toast("PDF Downloaded!", "success"));
}

// ══════════════════════════════════════
//  SERVICES DYNAMIC
// ══════════════════════════════════════
function updateEngagementNote() {
  const mouAmtInput = document.getElementById("nc-mouval");
  const noteArea = document.getElementById("nc-engagement-note");
  if (!mouAmtInput || !noteArea) return;
  const val = mouAmtInput.value || "0";
  const formattedAmt = Number(val).toLocaleString('en-IN');
  noteArea.value = `This is a multi-stage consultancy and execution support engagement. ₹${formattedAmt} was formalized under the initial MOU, while the remaining amount was received towards extended scope, third-party facilitation, and stage-wise execution.`;
}
function toggleServiceMode() {
  const mode = document.getElementById("nc-service-mode") ? document.getElementById("nc-service-mode").value : "single";
  const container = document.getElementById("services-container");
  const addBtnWrap = document.getElementById("add-service-btn-wrap");
  if (!container) return;
  container.innerHTML = "";
  addServiceRow();
  if (addBtnWrap) addBtnWrap.style.display = mode === "multiple" ? "block" : "none";
  updateEngagementNote();
}
function addServiceRow() {
  const container = document.getElementById("services-container");
  if (!container) return;
  const mode = document.getElementById("nc-service-mode") ? document.getElementById("nc-service-mode").value : "single";
  const rowCount = container.querySelectorAll('.service-row').length;
  const row = document.createElement("div");
  row.className = "service-row";
  row.innerHTML = `
        ${mode === "multiple" && rowCount > 0 ? `<div class="remove-service" onclick="this.parentElement.remove(); calculateTotalServiceAmount();">✕</div>` : ""}
        <div class="field"><label>Service Name</label><input class="s-name" placeholder="Enter service"></div>
        <div class="field"><label>Service Amount</label><input type="number" class="s-amt" placeholder="0" oninput="calculateTotalServiceAmount()"></div>
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
  document.getElementById("cyber-extra").style.display = val === "Cyber Complaint" ? "block" : "none";
  document.getElementById("fir-extra").style.display = val === "FIR" ? "block" : "none";
  document.getElementById("consumer-extra").style.display = val === "Consumer Complaint" ? "block" : "none";
}
function addAckField() {
  const container = document.getElementById("ack-container");
  if (!container) return;
  const div = document.createElement("div");
  div.style = "display:flex;gap:10px;margin-bottom:5px;";
  div.innerHTML = `<input class="ack-input" placeholder="Enter Acknowledgment Number" style="flex:1;"><button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(div);
}

// ══════════════════════════════════════
//  AUTO TITLE GENERATOR
// ══════════════════════════════════════
function autoGenerateTitle() {
  const company = document.getElementById("nc-company").value.trim();
  const complaintType = document.getElementById("nc-complaint-type").value;
  const titleField = document.getElementById("nc-title");
  if (company && complaintType && complaintType !== "") titleField.value = `${complaintType} - ${company}`;
  else if (company) titleField.value = company;
  else titleField.value = "";
}

// ══════════════════════════════════════
//  PERMISSIONS
// ══════════════════════════════════════
function allowedTabsForRole(role) {
  if (role === "Admin") return ["dashboard", "new-case", "case-master", "history", "action-log", "comm-log", "timeline", "doc-index", "case-study", "admin-panel", "internal-search", "reviewer-panel", "accountant-dashboard", "agreement-module"];

  if (role === "Accountant") return ["dashboard", "accountant-dashboard", "internal-search",];

  if (role === "Reviewer") return ["dashboard", "reviewer-panel", "internal-search"];

  if (role === "Operations") return ["dashboard", "new-case", "case-master", "history", "action-log", "comm-log", "doc-index", "case-study", "internal-search", "agreement-module"];

  return ["dashboard", "new-case", "history", "action-log", "comm-log", "doc-index", "internal-search", "agreement-module"];
}
function applyPermissions() {
  const role = currentRole();
  const allowed = allowedTabsForRole(role);
  document.querySelectorAll(".tab").forEach(tab => { tab.style.display = allowed.includes(tab.dataset.tab) ? "" : " none"; });
  const refundCard = document.getElementById("refund-dashboard-card"); if (refundCard) refundCard.style.display = "";
  const refundRequestCard = document.getElementById("refund-request-card"); if (refundRequestCard) refundRequestCard.style.display = canRaiseRefundRequest() ? "" : " none";
  const adminRefundCard = document.getElementById("admin-refund-card"); if (adminRefundCard) adminRefundCard.style.display = role === "Admin" ? "" : " none";
  
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = role === "Admin" ? "" : "none";
  });

  const adminTab = document.querySelector('[data-tab="admin-panel"]');
  if (adminTab) {
    const span = adminTab.querySelector("span");
    if (span) span.textContent = role === "Admin" ? "Admin Panel" : "User Panel";
  }
  const adminTitle = document.getElementById("admin-panel-title"); if (adminTitle) adminTitle.textContent = role === "Admin" ? "Admin Panel" : "Operations User Panel";
  const adminSub = document.getElementById("admin-panel-subtitle"); if (adminSub) adminSub.textContent = role === "Admin" ? "Approve refunds and create users" : "Create staff users and track refund requests";
  const requestedBy = document.getElementById("rr-requestedby"); if (requestedBy) requestedBy.value = currentUserEmail();
  setupUserRoleOptions();
  applyActionTypePermissions();
}
function applyActionTypePermissions() {
  const select = document.getElementById("al-type"); if (!select) return;
  Array.from(select.options).forEach(opt => { if (opt.value === "Refund Request") { opt.hidden = !canRaiseRefundRequest(); opt.disabled = !canRaiseRefundRequest(); } });
  if (!canRaiseRefundRequest() && select.value === "Refund Request") select.value = "Negotiation Call";
}
function setupUserRoleOptions() {
  const roleSelect = document.getElementById("new-user-role");
  const title = document.getElementById("user-create-title");
  if (!roleSelect) return;
  if (isAdmin()) { roleSelect.innerHTML = `<option>Admin</option><option>Operations</option><option>Reviewer</option><option>Accountant</option><option>Staff</option>`; if (title) title.textContent = "👤 Create New User"; }
  else if (isOperations()) { roleSelect.innerHTML = `<option>Staff</option>`; if (title) title.textContent = "👤 Create New Staff User"; }
}

// Case Assignment Control removed (assignment shown via Initiated By in Case Master)

// ══════════════════════════════════════
//  REFUND SYSTEM
// ══════════════════════════════════════
function refundRequesterLabel(action) { return action.doneBy || action.requestedByEmail || action.requestedByRole || "-"; }
function refundAmountSummary(action) {
  const amount = Number(action.refundAmount || 0);
  const amountText = amount ? `Rs. ${amount.toLocaleString("en-IN")}` : "";
  const summary = action.notes || action.summary || "-";
  if (!amountText) return summary;
  return `${amountText}<br><span class="text-muted" style="font-size:11px">${summary}</span>`;
}


// 1. Submit Detailed Refund Request
async function submitRefundRequest() {
  if (!canRaiseRefundRequest()) { toast("You do not have permission to raise refund request.", "error"); return; }
  const get = id => document.getElementById(id).value.trim();
  if (!get("rr-caseid") || !get("rr-amount") || !get("rr-acc-num") || !get("rr-ifsc")) {
    toast("Please fill all mandatory bank details!", "error"); return;
  }

  const row = {
    reqId: uid("REF"),
    caseId: get("rr-caseid"),
    amount: get("rr-amount"),
    requestedBy: currentUserEmail(),
    summary: get("rr-summary"),
    ifsc: get("rr-ifsc"),
    accNum: get("rr-acc-num"),
    accHolder: get("rr-acc-name"),
    branch: get("rr-branch"),
    accType: get("rr-acc-type"),
    bankName: get("rr-bankname"),
    status: "Pending Review", // Initial Status
    reviewedBy: "",
    approvedBy: "",
    reviewerRemark: "",
    approvedAt: "",
    lastStatusAtMs: Date.now(),
    timestamp: nowIST()
  };

  if (!DB.refunds) DB.refunds = [];
  DB.refunds.push(row);

  updateCaseMasterField(row.caseId, "currentStatus", "Refund Under Review");
  logActivity("REFUND_RAISED", `Refund of ₹${row.amount} requested for ${row.caseId}`, row.caseId);

  await saveDB();
  toast("Refund request sent to reviewer.", "success");

  // Notify Admin about new refund request
  sendNotification(ADMIN_EMAIL, "New Refund Request Raised", `Hello Admin,\n\nA new refund request has been raised.\n\nCase ID: ${row.caseId}\nAmount: ₹${row.amount}\nRequested By: ${row.requestedBy}\nSummary: ${row.summary}\n\nPlease review the request in the Admin Panel.`);

  ["rr-amount", "rr-summary", "rr-ifsc", "rr-acc-num", "rr-acc-name", "rr-branch", "rr-bankname"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const caseEl = document.getElementById("rr-caseid");
  if (caseEl) caseEl.value = "";
  refreshAllUI();
}

// 2. Admin/Operations Panel mein Refund List dikhana
function renderRefundApprovals() {
  const body = document.getElementById("refund-body");
  if (!body) return;
  normalizeDBShape();

  if (!isAdmin()) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">Only approver can access this queue.</div></td></tr>`;
    return;
  }
  const pendingForApproval = DB.refunds.filter(r => normalizeRefundStatus(r.status) === "Pending Approval");
  if (!pendingForApproval.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No refund pending for approval.</div></td></tr>`;
    return;
  }

  body.innerHTML = pendingForApproval.slice().reverse().map(r => {
    return `
            <tr>
                <td>${r.caseId}<br><small>${r.reqId}</small></td>
                <td>₹${r.amount}<br><small>${r.bankName}</small></td>
                <td>${r.requestedBy}<br><small>${r.reviewedBy ? `Reviewed by: ${r.reviewedBy}` : "Waiting review metadata"}</small></td>
                <td><span class="badge ${getRefundStatusClass(normalizeRefundStatus(r.status))}">${normalizeRefundStatus(r.status)}</span></td>
                <td><button class="btn btn-success btn-sm" onclick="processRefundStep('${r.reqId}', 'approve')">Final Approve</button></td>
            </tr>
        `;
  }).join("");
}

// 3. Review aur Approve 
async function processRefundStep(reqId, step) {
  const ref = DB.refunds.find(x => x.reqId === reqId);
  if (!ref) { toast("Refund request not found.", "error"); return; }
  const user = localStorage.getItem("rrr_user_email");

  if (step === "approve") {
    ref.status = "Pending Payment";
    ref.approvedBy = user;
    ref.approvedAt = nowIST();
    ref.lastStatusAtMs = Date.now();
    updateCaseMasterField(ref.caseId, "currentStatus", "Refund Processed");
    addTimelineEntry(ref.caseId, ref.approvedAt, "ACTION", "Refund Approved", `Approved by ${user || "Approver"}`);
    toast("Refund approved successfully.", "success");
  }

  await saveDB();
  refreshAllUI();
}
function renderRefundDashboard() {
  const body = document.getElementById("refund-dashboard-body"); if (!body) return;
  normalizeDBShape();
  const email = currentUserEmail(), role = currentRole();
  let rows = DB.refunds.slice();
  if (role === "Staff" || role === "Operations") rows = rows.filter(r => (r.requestedBy || "").toLowerCase() === email);
  if (!rows.length) { body.innerHTML = `<tr><td colspan="5"><div class="empty-state">No refund requests yet.</div></td></tr>`; return; }
  body.innerHTML = rows.slice().reverse().map(r => `<tr>
        <td><span class="case-id-display">${r.caseId}</span></td>
        <td>Rs. ${Number(r.amount || 0).toLocaleString("en-IN")}<br><span class="text-muted" style="font-size:11px">${r.summary || "-"}</span></td>
        <td>${r.requestedBy || "-"}</td>
        <td><span class="badge ${getRefundStatusClass(normalizeRefundStatus(r.status))}">${normalizeRefundStatus(r.status)}</span></td>
        <td>${normalizeRefundStatus(r.status) === "Rejected by Reviewer" ? `Remark: ${r.reviewerRemark || "-"}` : (normalizeRefundStatus(r.status) === "Pending Payment" ? "Approved, waiting accountant payment" : (r.approvedAt ? `Approved by ${r.approvedBy || "Approver"} on ${r.approvedAt}` : (r.reviewedBy ? `Reviewed by ${r.reviewedBy}, pending approver` : "Pending reviewer")))}</td>
    </tr>`).join("");
}
async function approveRefund(actionId) {
  if (!isAdmin()) { toast("Only Admin can approve refunds.", "error"); return; }
  const action = DB.actions.find(a => a.actionId === actionId);
  if (!action) { toast("Refund request not found.", "error"); return; }
  action.status = "Approved"; action.refundStatus = "Approved";
  action.approvedBy = currentUserEmail() || "Admin"; action.approvedAt = nowIST();
  updateCaseMasterField(action.caseId, "currentStatus", "Refund Approved");
  addTimelineEntry(action.caseId, action.approvedAt, "ACTION", "Refund Approved", `Refund approved by ${action.approvedBy}`);
  logActivity("REFUND", "Refund approved by Admin", action.caseId);
  toast("Refund Approved!", "success");
  renderRefundApprovals(); renderRefundDashboard(); renderActionTable(); updateDashboard();
  await saveDB();
}
async function createNewUser() {
  if (!isAdmin() && !isOperations()) { toast("No permission to create users.", "error"); return; }
  const email = document.getElementById("new-user-email").value.trim();
  const pass = document.getElementById("new-user-pass").value.trim();
  const role = document.getElementById("new-user-role").value;
  if (!email || !pass) { toast("Email and password are required.", "error"); return; }
  if (isOperations() && role !== "Staff") { toast("Operations can create Staff users only.", "error"); return; }
  await fetch(SCRIPT_URL, { method: "POST", body: JSON.stringify({ action: "createUser", email, pass, role }), mode: "no-cors" });

  // Send Notifications
  sendNotification(ADMIN_EMAIL, "New User Created - RRR System", `A new user account has been created.\n\nEmail: ${email}\nRole: ${role}\nCreated By: ${currentUserEmail()}`);
  sendNotification(email, "Welcome to RRR System - Account Created", `Hello,\n\nYour account has been created on RRR System.\n\nRole: ${role}\nTemporary Password: ${pass}\n\nPlease login and change your password if required.\n\nRegards,\nRRR Team`);

  document.getElementById("new-user-email").value = ""; document.getElementById("new-user-pass").value = "";
  toast("User Created Successfully!", "success");
}

// ══════════════════════════════════════
//  AUDIT LOG
// ══════════════════════════════════════
function logActivity(category, description, caseId = "N/A") {
  if (!DB.auditLogs) DB.auditLogs = [];
  DB.auditLogs.push({ id: uid("LOG"), timestamp: nowIST(), user: localStorage.getItem("rrr_user_email") || "Unknown", role: localStorage.getItem("rrr_user_role") || "Unknown", category, description, caseId });
}

// ══════════════════════════════════════
//  BULK IMPORT CSV
// ══════════════════════════════════════
async function importCasesExcel(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (typeof XLSX === "undefined") { toast("Excel parser not loaded.", "error"); return; }

  const normalizeHeader = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const toNumberOrZero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "0";
  };

  try {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) { toast("Excel sheet is empty.", "error"); return; }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet], { header: 1, blankrows: false });
    if (!rows.length || rows.length < 2) { toast("Excel data rows not found.", "error"); return; }

    const headers = rows[0].map(normalizeHeader);
    const idx = {};
    headers.forEach((h, i) => { idx[h] = i; });
    const getCol = (cols, ...names) => {
      for (const n of names) {
        if (typeof idx[n] === "number") return String(cols[idx[n]] ?? "").trim();
      }
      return "";
    };

    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      const col = rows[i];
      if (!col || !col.length) continue;
      const sourceOfComplaint = getCol(col, "sourceofcomplaint", "source");
      const typeOfComplaint = getCol(col, "typeofcomplaint", "complainttype");
      const companyName = getCol(col, "companyname", "company");
      const brandName = getCol(col, "brandname", "brand");
      const initiatedBy = getCol(col, "initiatedby") || currentUserEmail();
      const row = {
        caseId: getCol(col, "caseid") || generateCaseId(brandName),
        createdDate: getCol(col, "createddate") || nowIST(),
        companyName,
        caseTitle: getCol(col, "casetitle") || `${typeOfComplaint || "Case"} - ${companyName || brandName || "Client"}`,
        priority: getCol(col, "priority") || "Medium",
        sourceOfComplaint,
        typeOfComplaint,
        brandName,
        servicesSold: getCol(col, "servicessold", "services"),
        engagementNote: getCol(col, "engagementnote"),
        clientName: getCol(col, "clientname"),
        clientMobile: getCol(col, "mobile", "clientmobile"),
        clientEmail: getCol(col, "email", "clientemail"),
        state: getCol(col, "state"),
        totalAmtPaid: toNumberOrZero(getCol(col, "amountpaid", "totalamtpaid")),
        mouSigned: getCol(col, "mousigned") || "No",
        totalMouValue: toNumberOrZero(getCol(col, "mouvalue", "totalmouvalue")),
        amtInDispute: toNumberOrZero(getCol(col, "disputeamount", "amtindispute")),
        smRisk: getCol(col, "smrisk"),
        complaint: getCol(col, "consumercomplaint", "complaint"),
        policeThreat: getCol(col, "policethreat"),
        caseSummary: getCol(col, "casesummary", "summary"),
        clientAllegation: getCol(col, "clientallegation"),
        proofCallRec: getCol(col, "proofcallrec"),
        proofWaChat: getCol(col, "proofwachat"),
        proofVideoCall: getCol(col, "proofvideocall"),
        proofFundingEmail: getCol(col, "prooffundingemail"),
        initiatedBy,
        accountable: getCol(col, "accountable"),
        legalOfficer: getCol(col, "legalofficer"),
        accounts: getCol(col, "accounts"),
        caseCreatedSource: "Excel",
        currentStatus: "New",
        lastUpdateDate: nowIST(),
        nextActionDate: getCol(col, "nextactiondate"),
        cyberAckNumbers: getCol(col, "cyberacknumbers"),
        firNumber: getCol(col, "firnumber"),
        firFileLink: getCol(col, "firfilelink"),
        grievanceNumber: getCol(col, "grievancenumber"),
        assignedTo: getCol(col, "assignedto") || initiatedBy,
        updatedAtMs: Date.now()
      };
      DB.cases.push(row);
      addTimelineEntry(row.caseId, row.createdDate, "CASE_CREATION", "Imported", "Bulk import via Excel");
      count++;
    }

    if (count > 0) {
      refreshAllUI();
      toast(`${count} cases imported from Excel. Syncing...`, "success");
      await saveDB();
    } else {
      toast("No valid data rows found in Excel.", "error");
    }
  } catch (err) {
    console.error(err);
    toast("Excel import failed. Check file format.", "error");
  }
  event.target.value = "";
}

function downloadCaseImportTemplate() {
  const headers = [
    "caseId", "companyName", "brandName", "typeOfComplaint", "sourceOfComplaint", "priority",
    "clientName", "mobile", "email", "state", "amountPaid", "mouSigned", "mouValue", "disputeAmount",
    "summary", "initiatedBy", "servicesSold", "engagementNote", "nextActionDate", "assignedTo"
  ];
  const sample = [
    "",
    "Startup Kare Pvt Ltd",
    "Startup Kare",
    "Legal Notice",
    "Call",
    "Medium",
    "Rohit Kumar",
    "9876543210",
    "rohit@example.com",
    "Rajasthan",
    "25000",
    "No",
    "0",
    "25000",
    "Client requested legal support regarding service dispute.",
    "",
    "Legal Advisory",
    "This is a stage-wise engagement.",
    "",
    ""
  ];
  const csv = [headers.join(","), sample.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")].join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = "Case_Import_Template.csv";
  a.click();
  toast("CSV template downloaded.", "success");
}

// ══════════════════════════════════════
//  DATA SEARCH (SAMPLE CSV)
// ══════════════════════════════════════
// ── 1. IMPORT SAMPLE CSV (Cloud Ready) ──
// ── 1. IMPORT SAMPLE EXCEL (Cloud Ready) ──
async function importSampleExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheet];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (rows.length < 2) {
        toast("No data found in the Excel file.", "error");
        return;
      }

      // RAM data clear karein aur naya bharo
      DB.sampleData = [];
      let successCount = 0;

      for (let i = 1; i < rows.length; i++) {
        const col = rows[i];
        if (!col || col.length === 0) continue;

        const clean = (val) => val != null ? String(val).trim() : "";

        const record = {
          date: col[0] || "",             // A: Date
          company: clean(col[1]),        // B: Company Name
          person: clean(col[2]),         // C: Contact Person
          contact: clean(col[3]),        // D: Contact
          email: clean(col[4]),          // E: Email ID
          service: clean(col[5]),        // F: Service
          bde: clean(col[6]),            // G: BDE
          total: clean(col[7]),          // H: Total Amount (With GST)
          net: clean(col[8]),            // I: Amt. without GST
          status: clean(col[9]),         // J: Work Status
          dept: clean(col[10]),          // K: Department
          mou: clean(col[11]),           // L: MOU Status
          remarks: clean(col[12]),       // M: Remarks
          mouSignedAmt: clean(col[13])   // N: MOU Signed Amount
        };

        DB.sampleData.push(record);
        successCount++;
      }

      console.log("✅ Parsed " + successCount + " records from Excel");
      toast(`✅ ${successCount} Records Uploaded Successfully! Saving to Cloud...`, "success");

      renderSampleSearch();

      try {
        await saveDB(true);
        console.log("✅ Sample data successfully synced to Cloud");
        toast("✅ Data saved to Cloud successfully!", "success");
      } catch (err) {
        console.error("❌ Cloud save failed:", err);
        toast("⚠️ Local save successful but cloud sync failed.", "error");
      }
    } catch (err) {
      console.error(err);
      toast("Excel parse failed. Check file format.", "error");
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = "";
}

window.clearAppCache = function () {
  const ok = confirm("Clear local cache and reload fresh data from cloud?");
  if (!ok) return;
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(SAMPLE_DATA_KEY);
  toast("Cache cleared. Reloading...", "success");
  setTimeout(() => window.location.reload(), 500);
};
function normalizeSampleSearchValue(v) { return (v || "").toString().toLowerCase().replace(/\s+/g, " ").trim(); }
function renderSampleSearch() {
  const searchInput = document.getElementById("sample-search-input");
  const body = document.getElementById("sample-search-body");

  if (!body) {
    console.warn("Sample search body element not found");
    return;
  }

  // Data check
  if (!DB || !DB.sampleData || !Array.isArray(DB.sampleData)) {
    console.warn("DB.sampleData is not initialized:", DB ? DB.sampleData : "DB missing");
    body.innerHTML = `<tr><td colspan="14" class="empty-state"><i data-lucide="alert-circle" style="width:24px; height:24px; color:var(--red);"></i> No data available. Please upload Excel first.</td></tr>`;
    return;
  }

  if (!DB.sampleData.length) {
    body.innerHTML = `<tr><td colspan="14" class="empty-state"><i data-lucide="file-spreadsheet" style="width:24px; height:24px; opacity:0.5;"></i> No records uploaded yet. Click 'Upload Sample Excel' to add data.</td></tr>`;
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
    body.innerHTML = `<tr><td colspan="14" class="empty-state">🔍 No matching results found for "${query}"</td></tr>`;
    return;
  }

  console.log("Rendering " + filtered.length + " records from sample data");

  // Table rows generate karein (12 Columns)
  body.innerHTML = filtered.map(d => `
        <tr>
            <td style="white-space:nowrap">${formatDate(d.date) || "-"}</td>
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
            <td>${d.remarks || "-"}</td>
            <td>₹${d.mouSignedAmt || "0"}</td>
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

function renderReviewerDashboard() {
  const body = document.getElementById("reviewer-refund-body");
  if (!body) return;
  normalizeDBShape();
  if (!isReviewer()) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">Only reviewer can access this queue.</td></tr>';
    return;
  }

  // Sirf wahi dikhao jo "Pending Review" hain
  const pending = DB.refunds.filter(r => normalizeRefundStatus(r.status) === "Pending Review");

  if (pending.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">No pending reviews</td></tr>';
    return;
  }

  body.innerHTML = pending.map(r => `
        <tr>
            <td><strong>${r.caseId}</strong></td>
            <td>₹${r.amount}</td>
            <td>${r.requestedBy}</td>
            <td>${r.summary}</td>
            <td>
                <button class="btn btn-success btn-sm" onclick="handleReview('${r.reqId}', 'approve')">Review ✅</button>
                <button class="btn btn-danger btn-sm" onclick="handleReview('${r.reqId}', 'reject')">Send Back ↩</button>
            </td>
        </tr>
    `).join("");
}

async function handleReview(reqId, action) {
  const ref = DB.refunds.find(x => x.reqId === reqId);
  if (!ref) { toast("Refund request not found.", "error"); return; }
  const user = currentUserEmail();

  if (action === 'approve') {
    ref.status = "Pending Approval";
    ref.reviewedBy = user;
    ref.reviewerRemark = "";
    ref.lastStatusAtMs = Date.now();
    updateCaseMasterField(ref.caseId, "currentStatus", "Reviewed - Pending Approval");
    addTimelineEntry(ref.caseId, nowIST(), "ACTION", "Refund Reviewed", `Reviewed by ${user}`);
    toast("Reviewed and moved to approver queue.", "success");
  } else {
    const remark = prompt("Enter remark/reason for sending back:");
    if (!remark) return; // Cancel agar remark nahi likha
    ref.status = "Rejected by Reviewer";
    ref.reviewerRemark = remark;
    ref.lastStatusAtMs = Date.now();
    updateCaseMasterField(ref.caseId, "currentStatus", "Refund Rejected by Reviewer");
    addTimelineEntry(ref.caseId, nowIST(), "ACTION", "Refund Rejected", `Rejected by reviewer: ${remark}`);
    toast("Rejected and returned to requester with remark.", "info");
  }

  await saveDB();
  refreshAllUI();
}

function renderAccountantDashboard() {
  const body = document.getElementById("accountant-refund-body");
  if (!body) return;
  normalizeDBShape();
  if (currentRole() !== "Accountant") {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">Only accountant can process payouts.</td></tr>';
    return;
  }

  // Sirf approved requests show
  const forPayment = DB.refunds.filter(r => {
    const status = normalizeRefundStatus(r.status);
    return status === "Pending Payment" || status === "Approved";
  });

  if (forPayment.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty-state">No pending payments</td></tr>';
    return;
  }

  body.innerHTML = forPayment.map(r => `
        <tr>
            <td><strong>${r.caseId}</strong><br><small>${r.reqId}</small></td>
            <td style="font-size:12px; line-height:1.5;">
                <b>Name:</b> ${r.accHolder}<br>
                <b>Bank:</b> ${r.bankName} (${r.accType})<br>
                <b>Branch:</b> ${r.branch || "-"}<br>
                <b>A/C:</b> ${r.accNum}<br>
                <b>IFSC:</b> ${r.ifsc}
            </td>
            <td style="color:var(--green); font-weight:bold;">₹${r.amount}</td>
            <td style="font-size:12px; line-height:1.5;">
                <b>Requested By:</b> ${r.requestedBy || "-"}<br>
                <b>Summary:</b> ${r.summary || "-"}<br>
                <b>Reviewed By:</b> ${r.reviewedBy || "-"}<br>
                <b>Approved By:</b> ${r.approvedBy || "-"}
            </td>
            <td>
                <button class="btn btn-success btn-sm" onclick="markAsPaid('${r.reqId}')">Mark as Paid 💸</button>
            </td>
        </tr>
    `).join("");
}

async function markAsPaid(reqId) {
  const txnId = prompt("Enter Transaction ID / UTR Number:");
  if (!txnId) return;

  const ref = DB.refunds.find(x => x.reqId === reqId);
  ref.status = "Refund Completed";
  ref.transactionId = txnId;
  ref.paymentDate = nowIST();
  ref.paidBy = currentUserEmail();
  ref.lastStatusAtMs = Date.now();

  updateCaseMasterField(ref.caseId, "currentStatus", "Refund Paid");
  addTimelineEntry(ref.caseId, ref.paymentDate, "ACTION", "Payment Processed", `Refund Paid via Txn: ${txnId}`);

  toast("Payment recorded successfully!", "success");
  await saveDB();
  renderAccountantDashboard();
}

// ══════════════════════════════════════
//  AGREEMENT MODULE
// ══════════════════════════════════════
function addAgreementInstallment() {
  const container = document.getElementById("am-installments-container");
  const div = document.createElement("div");
  div.className = "am-installment-row";
  div.style.cssText = "display:flex; gap:10px; margin-bottom:10px; align-items:center;";
  div.innerHTML = `
    <input type="number" class="am-inst-amount" placeholder="Amount (₹)" style="flex:1;">
    <input type="date" class="am-inst-date" style="flex:1;">
    <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" style="padding:8px 12px;"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
  `;
  container.appendChild(div);
  if (window.lucide) lucide.createIcons();
}

function clearAgreementForm() {
  document.querySelectorAll("#tab-agreement-module input:not(#am-template-id), #tab-agreement-module textarea").forEach(el => el.value = "");
  document.getElementById("am-installments-container").innerHTML = "";
  document.getElementById("am-result-container").style.display = "none";
}

async function generateAgreement() {
  const btn = document.getElementById("am-generate-btn");
  const origText = btn.innerHTML;
  
  const get = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  
  const templateId = get("am-template-id");
  const date = get("am-date");
  const company = get("am-company");
  const clientName = (document.getElementById("am-client-prefix")?.value || "") + get("am-client-name");
  const address = get("am-address");
  const pincode = get("am-pincode");
  const amount = get("am-amount");
  const amountWords = get("am-amount-words");
  const firstSig = get("am-first-signatory");
  const secondCompany = get("am-second-company");
  const secondSig = get("am-second-signatory");

  if (!templateId || !date || !company || !clientName || !amount || !amountWords || !firstSig || !secondCompany || !secondSig) {
    toast("Please fill all required fields", "error");
    return;
  }

  // Compile installments
  const instRows = document.querySelectorAll(".am-installment-row");
  let installmentsArr = [];
  instRows.forEach(row => {
    const amt = row.querySelector(".am-inst-amount").value.trim();
    const d = row.querySelector(".am-inst-date").value.trim();
    if (amt && d) {
      const dObj = new Date(d);
      const dStr = isNaN(dObj.getTime()) ? d : `${String(dObj.getDate()).padStart(2, '0')}/${String(dObj.getMonth()+1).padStart(2,'0')}/${dObj.getFullYear()}`;
      installmentsArr.push(`₹${Number(amt).toLocaleString('en-IN')} on ${dStr}`);
    }
  });
  
  const installmentsText = installmentsArr.length > 0 ? installmentsArr.join(", ") : "N/A";

  const payload = {
    date: formatDate(date),
    firstPartyCompany: company,
    secondPartyCompany: secondCompany,
    name: clientName,
    address: address,
    pincode: pincode,
    settleAmt: amount,
    amtWords: amountWords,
    installmentsText: installmentsText,
    firstPartySignatory: firstSig,
    secondPartySignatory: secondSig
  };

  btn.innerHTML = `<i data-lucide="loader" class="spin" style="width:16px;height:16px;vertical-align:middle;"></i> Generating...`;
  btn.disabled = true;

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "generateDoc", templateId: templateId, payload: payload })
    });
    
    const rawText = await res.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error("Backend error:", rawText);
      toast(rawText.substring(0, 100), "error"); // Show the actual backend error
      throw new Error(rawText);
    }
    
    if (data.status === "success") {
      document.getElementById("am-result-container").style.display = "block";
      
      // We expect the backend to return data.docId for the newly created document
      // If not, we fallback to the templateId (old behavior)
      const targetDocId = data.docId || templateId;
      
      const previewUrl = `https://docs.google.com/document/d/${targetDocId}/preview?t=${Date.now()}`;
      const pdfUrl = `https://docs.google.com/document/d/${targetDocId}/export?format=pdf`;
      
      document.getElementById("am-preview-frame").src = previewUrl;
      document.getElementById("am-result-download-pdf").href = pdfUrl;
      
      toast("Agreement generated successfully! Preview it below.", "success");
    } else {
      toast("Error generating agreement.", "error");
    }
  } catch (error) {
    console.error("Error generating doc:", error);
    if (error.message && error.message.startsWith("Error")) {
      // already handled
    } else {
      toast("Failed to generate document. It may have generated but the response was blocked by CORS.", "error");
    }
  } finally {
    btn.innerHTML = origText;
    btn.disabled = false;
    if (window.lucide) lucide.createIcons();
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
    const requestedBy = document.getElementById("rr-requestedby");
    if (requestedBy) requestedBy.value = currentUserEmail();

    // Restore Sidebar State
    if (window.innerWidth > 1024) {
      const isCollapsed = localStorage.getItem("rrr_sidebar_collapsed") === "true";
      if (isCollapsed) {
        const sidebar = document.getElementById("sidebar-tabs");
        const main = document.querySelector(".main");
        if (sidebar) sidebar.classList.add("collapsed");
        if (main) main.classList.add("sidebar-collapsed");
      }
    }
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1024) toggleSidebar(false);
});