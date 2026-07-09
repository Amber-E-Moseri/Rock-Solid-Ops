// ── Config ────────────────────────────────────────────────────
import { supabase } from "../auth/auth-client.js"

const SUPABASE_URL = String(window.FS_CONFIG?.SUPABASE_URL || '').trim()
const SUPABASE_ANON_KEY = String(window.FS_CONFIG?.SUPABASE_ANON_KEY || '').trim()
const AdminUi = window.FSAdminUi
if (!AdminUi) {
  throw new Error('Missing shared admin module: ../js/admin-ui.js')
}

// ── State ─────────────────────────────────────────────────────
let db, currentUser, adminProfile
let suspendTarget    = null   // { type: 'teacher'|'availability', id, label }
let currentBatches   = []     // cached batch list for batch management
let batchModalMode   = 'create' // 'create' | 'edit'
let batchModalId     = null   // batch_id being edited
let moodleModalBatchId = null // batch_id open in Moodle config modal

// ── Init ──────────────────────────────────────────────────────
async function init() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[FS_CONFIG_ERROR] Missing runtime config: SUPABASE_URL/SUPABASE_ANON_KEY')
    showAccessDenied('Configuration is missing. Please set foundation/js/config.js before using the admin portal.')
    return
  }
  db = supabase

  try {
    const { data: { session } } = await db.auth.getSession()
    if (!session) { window.location.href = 'login.html'; return }

    const { data: { user }, error: uErr } = await db.auth.getUser()
    if (uErr || !user) { window.location.href = 'login.html'; return }
    currentUser = user

    const { data: profile, error: pErr } = await db
      .from('profiles')
      .select('user_id,email,full_name,role,is_active')
      .eq('user_id', user.id)
      .maybeSingle()

    if (pErr || !profile) {
      const msg = pErr?.code === '42P01'
        ? 'The profiles table does not exist yet. Please run the SQL migration first.'
        : 'No profile found for this account.'
      showAccessDenied(msg)
      return
    }

    const adminRoles = new Set(['superadmin','admin','subgroup_admin','pastor','principal','regional_secretary'])
    if (!adminRoles.has(String(profile.role || '').toLowerCase())) {
      showAccessDenied('Your account does not have admin access.')
      return
    }

    // Normalize to match what the rest of the file expects
    adminProfile = { ...profile, auth_user_id: user.id }
    renderPortal()
  } catch (e) {
    console.error('Init error:', e)
    showAccessDenied('Unexpected error loading portal: ' + e.message)
  }
}

async function logout() {
  try { await db.auth.signOut() } catch(e) { console.error(e) }
  window.location.href = 'login.html'
}

function showAccessDenied(msg) {
  document.getElementById('loading-screen').style.display = 'none'
  if (msg) document.getElementById('denied-msg').textContent = msg
  const el = document.getElementById('access-denied')
  el.style.display = 'flex'
}

function safeInvokeLoader(fnName, moduleName, targetSectionId) {
  const fn = window[fnName]
  if (typeof fn === 'function') {
    fn()
    return
  }
  const msg = `Portal module unavailable: ${moduleName}`
  console.error(msg)
  if (targetSectionId) {
    setError(targetSectionId, msg)
  } else {
    toast(msg, 'error')
  }
}

// ── Global error fallback ─────────────────────────────────────
window.addEventListener('unhandledrejection', (event) => {
  console.error('[UnhandledRejection]', event.reason)
  const message = event.reason?.message || String(event.reason) || 'An unexpected error occurred.'
  toast(`Error: ${message}`, 'error')
  event.preventDefault()
})

// ── Role helpers ──────────────────────────────────────────────
function isSuperadmin()    { return adminProfile?.role === 'superadmin' }
function isSubgroupAdmin() { return adminProfile?.role === 'subgroup_admin' }
function isPastor()        { return adminProfile?.role === 'pastor' }
function canApprove()      { return isSuperadmin() }
function canSuspend()      { return isSuperadmin() || isPastor() }

// Applies subgroup filter for non-superadmins
function scopeQuery(query, col) {
  col = col || 'subgroup_id'
  if (isSuperadmin()) return query
  const sg = adminProfile?.subgroups || []
  return sg.length ? query.in(col, sg) : query.in(col, ['__NONE__'])
}

// ── Hub icons (Lucide-style inline SVG) ───────────────────────
const _ico = {
  list:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r=".8" fill="currentColor" stroke="none"/></svg>`,
  calendar: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  clock:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  grid:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  check:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  userPlus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  msg:      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  refresh:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>`,
  pulse:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  mail:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  log:      `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
}

function apCard(iconName, iconColorClass, _unused, title, desc, href, access, badgeId) {
  const badge = badgeId
    ? `<span class="ap-card-badge" id="${badgeId}" style="display:none"></span>`
    : ''
  const isRestricted = access && access !== 'all'
  return `<a class="ap-card" href="${isRestricted ? '#' : href}"${isRestricted ? ` onclick="openPortalPage('${href}','${access}');return false"` : ''}>
    <div class="ap-card-icon ${iconColorClass}">${_ico[iconName] || ''}</div>
    <div class="ap-card-hd"><span class="ap-card-title">${title}</span>${badge}</div>
    <p class="ap-card-desc">${desc}</p>
    <span class="ap-card-open">Open <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
  </a>`
}

// ── Render portal ─────────────────────────────────────────────
function renderPortal() {
  document.getElementById('loading-screen').style.display = 'none'
  document.getElementById('portal').style.display = 'block'
  if (window.FSAdminShell && !document.getElementById('fs-admin-sb')) {
    window.FSAdminShell.mount({
      active: 'portal',
      pageTitle: 'Admin Portal',
      role: adminProfile.role || '',
      profileName: adminProfile.full_name || adminProfile.email || '',
      onLogout: logout
    })
  } else if (window.FSAdminShell) {
    window.FSAdminShell.setPageTitle('Admin Portal')
    window.FSAdminShell.setProfile({ profileName: adminProfile.full_name, role: adminProfile.role }, null)
  }

  const firstName = (adminProfile.full_name || '').split(' ')[0] || 'there'
  const h = new Date().getHours()
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const sa = isSuperadmin()

  document.getElementById('main').innerHTML = `
    <div class="ap-page">

      <div class="ap-head">
        <h1>Admin Portal</h1>
        <p>Your control center for Foundation School operations — everything an administrator manages, in one place.</p>
      </div>

      <div class="ap-hero">
        <div class="ap-hero-deco" aria-hidden="true"><div class="ap-deco-1"></div><div class="ap-deco-2"></div></div>
        <div class="ap-hero-content">
          <h2 class="ap-greeting">${greet}, ${esc(firstName)} 👋</h2>
          <p class="ap-hero-sub" id="ap-hero-sub">Loading your workspace…</p>
          <div class="ap-stats">
            <div class="ap-stat"><span class="ap-stat-val" id="stat-enrolled">—</span><span class="ap-stat-lbl">Enrolled</span></div>
            <div class="ap-stat"><span class="ap-stat-val" id="stat-batches">—</span><span class="ap-stat-lbl">Active Batches</span></div>
            <div class="ap-stat"><span class="ap-stat-val accent" id="stat-pending">—</span><span class="ap-stat-lbl">Pending Review</span></div>
            <div class="ap-stat"><span class="ap-stat-val" id="stat-teachers">—</span><span class="ap-stat-lbl">Teachers</span></div>
          </div>
        </div>
      </div>

      <p class="ap-sec-label">Registration &amp; Students</p>
      <div class="ap-card-grid">
        ${apCard('list',     '',      '','Review queue',     'Approve, assign or flag pending registrations.',        'applicant-directory.html','all',       'apb-pending')}
        ${apCard('calendar', 'navy',  '','Batch management', 'Cohorts, class rosters, capacity and Moodle mapping.',  'batch-management.html',  'superadmin', null)}
        ${apCard('clock',    'gold',  '','Waiting students', 'Promote waitlisted applicants into opened seats.',      'waitlist.html',          'all',        'apb-waitlist')}
        ${apCard('grid',     'navy',  '','Class editor',     'Build and edit classes, times, teachers and seats.',    'class-editor.html',      'all',        null)}
      </div>

      <p class="ap-sec-label">Teaching &amp; Engagement</p>
      <div class="ap-card-grid">
        ${apCard('check',    'green', '','Attendance',       'Track submission and mark class rosters.',              'dashboards.html',        'all',        null)}
        ${apCard('calendar', '',      '','Schedule',         'Weekly timetable and availability approvals.',          'teacher-schedule.html',  'all',        null)}
        ${apCard('userPlus', 'green', '','Teacher portal',   "The teacher's own view — classes, availability, students.",'teacher-management.html','all',     null)}
        ${apCard('msg',      '',      '','Messages',         'Conversations with teachers and applicants.',           'messages.html',          'all',        'apb-msgs')}
      </div>

      ${sa ? `
      <p class="ap-sec-label">System &amp; Ops</p>
      <div class="ap-card-grid">
        ${apCard('refresh',  'red',   '','Failed syncs',     'Retry center for failed Moodle sync operations.',       'failed-sync-retry-center.html','all',  'apb-failedsyncs')}
        ${apCard('pulse',    'green', '','System health',    'Monitor sync pipeline and integration status.',         'system-health.html',     'all',        null)}
        ${apCard('mail',     'gold',  '','Email campaigns',  'Manage and send bulk email communications.',            'email-campaigns.html',   'all',        null)}
        ${apCard('log',      '',      '','Audit log',        'Full history of admin actions and system events.',      'audit-log.html',         'superadmin', null)}
      </div>` : ''}

      <div class="ap-two">
        <div class="ap-panel">
          <div class="ap-panel-head">
            <h3>Recent activity</h3>
            <a href="admin-activity.html">Audit log →</a>
          </div>
          <div class="ap-panel-body" id="ap-activity">
            <div class="ap-feed-item"><div class="ap-feed-tx" style="color:var(--muted)">Loading…</div></div>
          </div>
        </div>
        <div class="ap-panel">
          <div class="ap-panel-head">
            <h3>System health</h3>
            <a href="system-health.html">Details →</a>
          </div>
          <div class="ap-panel-body" id="ap-health">
            <div class="ap-health-row"><span class="ap-hdot"></span><span class="ap-hn">Loading…</span></div>
          </div>
        </div>
      </div>

    </div>`

  loadPortalStats()
  loadPortalActivity()
}

async function loadPortalStats() {
  try {
    const [stuRes, batchRes, pendRes, tchRes] = await Promise.all([
      db.from('applicants').select('id', { count: 'exact', head: true }).not('status', 'in', '(Withdrawn,Rejected)'),
      db.from('batches').select('batch_id', { count: 'exact', head: true }).in('status', ['Active', 'Open']),
      db.from('applicants').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
      db.from('teachers').select('teacher_id', { count: 'exact', head: true }).eq('status', 'Active'),
    ])
    if (stuRes.error)   console.error('[portal] applicants count error:', stuRes.error)
    if (batchRes.error) console.error('[portal] batches count error:', batchRes.error)
    if (pendRes.error)  console.error('[portal] pending count error:', pendRes.error)
    if (tchRes.error)   console.error('[portal] teachers count error:', tchRes.error)
    const [enrolled, batches, pending, teachers] = [stuRes.count ?? 0, batchRes.count ?? 0, pendRes.count ?? 0, tchRes.count ?? 0]
    setStatEl('stat-enrolled', enrolled)
    setStatEl('stat-batches',  batches)
    setStatEl('stat-pending',  pending)
    setStatEl('stat-teachers', teachers)

    const sub = document.getElementById('ap-hero-sub')
    if (sub) {
      sub.textContent = pending > 0
        ? `You have ${pending} registration${pending !== 1 ? 's' : ''} to review.`
        : 'Everything is up to date — no pending actions.'
    }
    const pb = document.getElementById('apb-pending')
    if (pb && pending > 0) { pb.textContent = pending; pb.style.display = '' }
  } catch (e) {
    console.error('Portal stats error:', e)
    ;['stat-enrolled','stat-batches','stat-pending','stat-teachers'].forEach(id => setStatEl(id, '—'))
    const sub = document.getElementById('ap-hero-sub')
    if (sub) sub.textContent = 'Could not load stats — check your connection.'
  }
}

function setStatEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val }

async function loadPortalActivity() {
  try {
    const [logsRes, moodleRes, emailRes] = await Promise.all([
      db.from('audit_logs').select('actor_name, action, entity_type, created_at').order('created_at', { ascending: false }).limit(5),
      db.from('moodle_sync').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
      db.from('email_queue').select('id', { count: 'exact', head: true }).eq('status', 'Pending'),
    ])

    const actEl = document.getElementById('ap-activity')
    if (actEl) {
      const logs = logsRes.data ?? []
      if (!logs.length) {
        actEl.innerHTML = '<div class="ap-feed-item"><div class="ap-feed-tx" style="color:var(--muted)">No recent activity.</div></div>'
      } else {
        actEl.innerHTML = logs.map(l => {
          const initials = (l.actor_name || 'SY').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
          const isSys = !l.actor_name || l.actor_name.toLowerCase().includes('system')
          const ago = relativeTime(l.created_at)
          const label = esc(l.action || 'action').replace(/_/g, ' ')
          return `<div class="ap-feed-item">
            <div class="ap-av${isSys ? ' sys' : ''}">${initials}</div>
            <div class="ap-feed-tx">
              <span><b>${esc(l.actor_name || 'System')}</b> ${label} · ${esc(l.entity_type || '')}</span>
              <div class="t">${ago}</div>
            </div>
          </div>`
        }).join('')
      }
    }

    const healthEl = document.getElementById('ap-health')
    if (healthEl) {
      const failedMoodle = moodleRes.count ?? 0
      const pendingEmail = emailRes.count ?? 0
      const pb = document.getElementById('apb-failedsyncs')
      if (pb && failedMoodle > 0) { pb.textContent = failedMoodle; pb.style.display = '' }
      healthEl.innerHTML = `
        <div class="ap-health-row"><span class="ap-hdot ok"></span><span class="ap-hn">Email sender</span><span class="ap-hv">${pendingEmail} pending</span></div>
        <div class="ap-health-row"><span class="ap-hdot ${failedMoodle > 0 ? 'warn' : 'ok'}"></span><span class="ap-hn">Moodle sync</span><span class="ap-hv">${failedMoodle > 0 ? failedMoodle + ' failed' : 'OK'}</span></div>
        <div class="ap-health-row"><span class="ap-hdot ok"></span><span class="ap-hn">Registration processor</span><span class="ap-hv">active</span></div>
      `
    }
  } catch (e) {
    console.error('Activity load error:', e)
  }
}

function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 2) return 'just now'
  if (m < 60) return m + 'm ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  return Math.floor(h / 24) + 'd ago'
}

// ── Navigation ────────────────────────────────────────────────
function openPortalPage(path, accessLabel) {
  if (accessLabel && accessLabel !== 'all') {
    const role = adminProfile?.role || ''
    if (accessLabel === 'superadmin' && role !== 'superadmin') {
      toast('Your role does not have access to this section.', 'error')
      return
    }
  }
  window.location.href = path
}

async function openNotificationCenter() {
  window.location.href = 'notification-center.html'
}

const esc = (s) => AdminUi.esc(s)

window.openPortalPage = openPortalPage
window.openNotificationCenter = openNotificationCenter

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type) {
  type = type || 'success'
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  document.getElementById('toasts').appendChild(el)
  setTimeout(() => el.remove(), 4000)
}

// ── Boot ──────────────────────────────────────────────────────
init()

