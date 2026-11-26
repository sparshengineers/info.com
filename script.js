// =====================================================================
// SPARSH CLIENT PORTAL
// Login (Supabase RPC) -> fetch client's Google Sheet (CSV) -> render
// =====================================================================

// ---------- 1. CONFIG: paste your own values ----------
// Supabase Dashboard > Project Settings > API
var CONFIG = {
  SUPABASE_URL: 'https://viurjmofpgjuciulkhwh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_3MNbb9gGPJSBxHYnC0UV5g_yl7R1SkC',   // the "anon / public" key, never the service_role key
  SESSION_MINUTES: 60                          // auto log-out after this long
};

var SESSION_KEY = 'sparsh_portal_session';

// ---------- 2. Element shortcuts ----------
var $ = function (id) { return document.getElementById(id); };

var loginView  = $('login-view');
var sheetView  = $('sheet-view');
var loginForm  = $('login-form');
var loginBtn   = $('login-btn');
var loginError = $('login-error');
var siteInput  = $('site-name');
var pwInput    = $('password');
var pwToggle   = $('pw-toggle');
var sheetTitle = $('sheet-title');
var sheetMeta  = $('sheet-meta');
var sheetStatus  = $('sheet-status');

var currentSession = null;

// ---------- 3. Session helpers (sessionStorage: cleared when the tab closes) ----------
function saveSession(s) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
}
function loadSession() {
  try {
    var raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    var s = JSON.parse(raw);
    if (!s || !s.sheetUrl || !s.siteName || Date.now() > s.expires) {
      clearSession();
      return null;
    }
    return s;
  } catch (e) { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
}

// ---------- 4. View switching ----------
function showLogin() {
  currentSession = null;
  sheetView.hidden = true;
  loginView.hidden = false;
  sheetStatus.textContent = '';
  pwInput.value = '';
  document.title = 'Client Site Portal | Sparsh Engineers and Consultants';
}

function showSheet(session) {
  currentSession = session;
  loginView.hidden = true;
  sheetView.hidden = false;
  sheetTitle.textContent = session.siteName;
  sheetMeta.textContent = 'Download a CSV copy of this site information sheet.';
  sheetStatus.textContent = '';
  document.title = session.siteName + ' | Site Information | Sparsh';
  window.scrollTo(0, 0);
  sheetTitle.focus();
}

// ---------- 5. Login ----------
function setLoginError(msg) {
  loginError.textContent = msg || '';
  loginError.hidden = !msg;
}

function setLoading(isLoading) {
  loginBtn.disabled = isLoading;
  loginBtn.querySelector('.btn-label').textContent =
    isLoading ? 'Checking…' : 'View site information';
}

async function callLogin(siteName, password) {
  var res = await fetch(CONFIG.SUPABASE_URL + '/rest/v1/rpc/portal_login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': CONFIG.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ p_site_name: siteName, p_password: password })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

loginForm.addEventListener('submit', async function (e) {
  e.preventDefault();
  setLoginError('');

  var siteName = siteInput.value.trim();
  var password = pwInput.value;

  if (!siteName || !password) {
    setLoginError('Enter both your site name and password.');
    return;
  }
  if (CONFIG.SUPABASE_URL.indexOf('YOUR-PROJECT-REF') !== -1) {
    setLoginError('Portal is not connected yet. Add your Supabase URL and anon key in portal.js.');
    return;
  }

  setLoading(true);
  try {
    var result = await callLogin(siteName, password);

    if (result && result.ok) {
      var session = {
        siteName: result.site_name,
        sheetUrl: result.sheet_url,
        expires: Date.now() + CONFIG.SESSION_MINUTES * 60 * 1000
      };
      saveSession(session);
      showSheet(session);
    } else if (result && result.reason === 'locked') {
      setLoginError('Too many wrong attempts for this site. Wait 15 minutes and try again, or contact us.');
    } else {
      setLoginError('Site name or password is incorrect. Check both and try again.');
    }
  } catch (err) {
    setLoginError('Could not reach the server. Check your internet connection and try again.');
  } finally {
    setLoading(false);
  }
});

pwToggle.addEventListener('click', function () {
  var show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  pwToggle.textContent = show ? 'Hide' : 'Show';
  pwToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
  pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

// ---------- 6. Google Sheet loading ----------
function getSheetCsvUrl(sheetUrl) {
  var url = new URL(sheetUrl);
  var match = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/edit\/?$/);
  if (!match || url.hostname !== 'docs.google.com') return sheetUrl;

  var csvUrl = new URL('https://docs.google.com/spreadsheets/d/' + match[1] + '/export');
  csvUrl.searchParams.set('format', 'csv');
  if (url.searchParams.has('gid')) csvUrl.searchParams.set('gid', url.searchParams.get('gid'));
  return csvUrl.toString();
}

async function downloadSheetCsv() {
  if (!currentSession) return;

  // Session timed out while the page was open
  if (Date.now() > currentSession.expires) {
    clearSession();
    showLogin();
    setLoginError('Your session expired. Log in again to continue.');
    return;
  }

  sheetStatus.className = 'sheet-status';
  sheetStatus.textContent = 'Preparing your CSV download…';

  try {
    var res = await fetch(getSheetCsvUrl(currentSession.sheetUrl), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();

    if (!text.trim()) {
      throw new Error('EMPTY_CSV');
    }

    if (/^\s*</.test(text)) throw new Error('NOT_PUBLISHED');

    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement('a');
    var filename = currentSession.siteName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'site-information';
    link.href = objectUrl;
    link.download = filename + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
    sheetStatus.textContent = 'Your CSV download has started.';
  } catch (err) {
    sheetStatus.className = 'sheet-status is-error';
    if (err.message === 'EMPTY_CSV') {
      sheetStatus.textContent = 'The CSV is empty. Check that the selected worksheet contains data.';
    } else if (err.message === 'NOT_PUBLISHED' || /^HTTP (401|403|404)$/.test(err.message)) {
      sheetStatus.textContent = 'This Google Sheet is private or its URL is not a published CSV. Publish the sheet as CSV and update its URL in Supabase.';
    } else if (err instanceof TypeError) {
      sheetStatus.textContent = 'Could not access the sheet CSV. Check that it is published and that your internet connection is working.';
    } else {
      sheetStatus.textContent = 'Could not download the CSV. Please try again.';
    }
  }
}

// ---------- 7. CSV parsing ----------
function parseCSV(text) {
  var rows = [], row = [], cell = '', inQuotes = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell); cell = '';
    } else if (c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else if (c !== '\r') {
      cell += c;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Drop fully empty rows and empty trailing columns
function cleanRows(rows) {
  rows = rows
    .map(function (r) { return r.map(function (v) { return v.trim(); }); })
    .filter(function (r) { return r.some(function (v) { return v !== ''; }); });

  var maxCol = 0;
  rows.forEach(function (r) {
    for (var i = r.length - 1; i >= 0; i--) {
      if (r[i] !== '') { maxCol = Math.max(maxCol, i + 1); break; }
    }
  });
  return rows.map(function (r) {
    var out = r.slice(0, maxCol);
    while (out.length < maxCol) out.push('');
    return out;
  });
}

// ---------- 8. Rendering (built with DOM methods, so sheet text can't inject HTML) ----------
function fillCell(el, value) {
  if (/^https?:\/\/\S+$/i.test(value)) {
    var a = document.createElement('a');
    a.href = value;
    a.textContent = value;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    el.appendChild(a);
  } else {
    el.textContent = value;
  }
}

// A section row has text in the first column only
function isSectionRow(r) {
  return r[0] !== '' && r.slice(1).every(function (v) { return v === ''; });
}

function renderSheet(rows) {
  sheetContent.textContent = '';
  var cols = rows[0].length;
  var header = rows[0];
  var body = rows.slice(1);

  if (cols <= 2) renderInfoList(header, body);
  else renderTable(header, body, cols);
}

// 2-column sheet (Field | Details): shown as info cards grouped by section
function renderInfoList(header, body) {
  var group = null;

  function newGroup(title) {
    var sec = document.createElement('section');
    sec.className = 'info-group';
    if (title) {
      var h = document.createElement('h2');
      h.textContent = title;
      sec.appendChild(h);
    }
    var dl = document.createElement('dl');
    sec.appendChild(dl);
    sheetContent.appendChild(sec);
    return dl;
  }

  body.forEach(function (r) {
    if (isSectionRow(r)) { group = newGroup(r[0]); return; }
    if (!group) group = newGroup('');
    var item = document.createElement('div');
    item.className = 'info-item';
    var dt = document.createElement('dt');
    dt.textContent = r[0];
    var dd = document.createElement('dd');
    fillCell(dd, r[1] || '—');
    item.appendChild(dt);
    item.appendChild(dd);
    group.appendChild(item);
  });
}

// 3+ column sheet: shown as a table (row 1 = column headings)
function renderTable(header, body, cols) {
  var wrap = document.createElement('div');
  wrap.className = 'table-scroll';
  var table = document.createElement('table');

  var thead = document.createElement('thead');
  var hr = document.createElement('tr');
  header.forEach(function (h) {
    var th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  body.forEach(function (r) {
    var tr = document.createElement('tr');
    if (isSectionRow(r)) {
      tr.className = 'section-row';
      var td = document.createElement('td');
      td.colSpan = cols;
      td.textContent = r[0];
      tr.appendChild(td);
    } else {
      r.forEach(function (v, i) {
        var td = document.createElement('td');
        td.setAttribute('data-label', header[i] || '');
        fillCell(td, v);
        tr.appendChild(td);
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  sheetContent.appendChild(wrap);
}

// ---------- 9. Toolbar buttons ----------
$('download-btn').addEventListener('click', downloadSheetCsv);
$('logout-btn').addEventListener('click', function () {
  clearSession();
  showLogin();
  siteInput.focus();
});

// ---------- 10. Start-up ----------
document.addEventListener('DOMContentLoaded', function () {
  var y = $('year');
  if (y) y.textContent = new Date().getFullYear();

  var existing = loadSession();
  if (existing) showSheet(existing);
});
