/* ============================================================
   ROCKSOLID OPS — shared sidebar nav
   Usage: <aside class="sidebar" id="rsNav"></aside>
          <body data-nav="dashboard"> ... <script src="rocksolid-nav.js"></script>
   ============================================================ */
(function () {
  var I = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
    cal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    doc: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/><path d="M9 14h6M9 17h4"/>',
    check: '<path d="M5 12l4 4 10-10"/><path d="M3 18h12"/>',
    calclock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M12 13v3l2 1"/>',
    trend: '<path d="M4 19V5M4 19h16"/><path d="M7 15l4-4 3 3 5-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 015 .3c0 1.8-2.5 1.8-2.5 3.5M12 17h.01"/>',
    chat: '<path d="M4 5h16v12H7l-3 3z"/>',
    bell: '<path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8z"/><path d="M10 21h4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    usercheck: '<circle cx="9" cy="8" r="4"/><path d="M3 20c0-4 3-6 6-6s6 2 6 6"/><path d="M16 11l2 2 4-4"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20c0-3.5 3-5.5 6.5-5.5"/><path d="M16 4.5a3.5 3.5 0 010 7"/><path d="M21.5 20c0-3-2-5-5-5.5"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    flag: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
    retry: '<path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 4v5h-5"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    book: '<path d="M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M5 16h14"/>',
    file: '<path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/><path d="M9 14h6M9 17h4"/>',
    award: '<circle cx="12" cy="9" r="5"/><path d="M9 13l-1 8 4-3 4 3-1-8"/>'
  };

  // key, label, href, icon, badge
  var groups = [
    { label: null, items: [
      ['dashboard', 'Dashboard', 'RockSolid Home.html', I.home],
      ['admin', 'Admin Portal', 'RockSolid Admin Portal.html', I.shield],
      ['batches', 'Batch Management', 'RockSolid Batches.html', I.cal],
      ['applicants', 'Applicants', 'RockSolid Review Queue.html', I.user, '7'],
      ['waitlist', 'Waiting Students', 'RockSolid Waiting Students.html', I.clock],
      ['classeditor', 'Class Editor', 'RockSolid Class Editor.html', I.grid],
      ['reports', 'Reports & Exports', 'RockSolid Reports.html', I.doc]
    ]},
    { label: 'Teaching', items: [
      ['teacherportal', 'Teacher Portal', 'RockSolid Teacher Portal.html', I.usercheck],
      ['attendance', 'Attendance', 'RockSolid Attendance.html', I.check],
      ['schedule', 'Schedule', 'RockSolid Schedule.html', I.calclock]
    ]},
    { label: 'Comms', items: [
      ['messages', 'Messages', 'RockSolid Messages.html', I.chat, '3'],
      ['notifications', 'Notifications', 'RockSolid Notifications.html', I.bell],
      ['campaigns', 'Email Campaigns', 'RockSolid Email Campaigns.html', I.mail]
    ]},
    { label: 'System', items: [
      ['teachers', 'Teachers', 'RockSolid Teachers.html', I.users],
      ['fellowships', 'Fellowships', 'RockSolid Fellowships.html', I.layers]
    ]},
    { label: 'Activity', items: [
      ['activity', 'Activity Log', 'RockSolid Activity Log.html', I.activity],
      ['roleaudit', 'Role Audit', 'RockSolid Role Audit.html', I.usercheck]
    ]},
    { label: 'Platform', items: [
      ['clickup', 'ClickUp Management', 'RockSolid ClickUp.html', I.flag],
      ['failedsync', 'Failed Syncs', 'RockSolid Failed Syncs.html', I.retry, '5'],
      ['health', 'System Health', 'RockSolid System Health.html', I.pulse],
      ['moodle', 'Moodle Settings', 'RockSolid Moodle Settings.html', I.book],
      ['audit', 'Audit Log', 'RockSolid Audit Log.html', I.file],
      ['milestones', 'Milestones', 'RockSolid Milestones.html', I.award],
      ['help', 'Help Guide', 'RockSolid Help Guide.html', I.help]
    ]}
  ];

  var active = (document.body.getAttribute('data-nav') || '').toLowerCase();

  var html = '' +
    '<div class="sb-logo">' +
      '<div class="sb-mark">R</div>' +
      '<div><div class="sb-name">RockSolid OPS</div><div class="sb-sub">Foundation School</div></div>' +
    '</div><nav class="sb-nav">';

  groups.forEach(function (g) {
    if (g.label) html += '<div class="sb-label">' + g.label + '</div>';
    g.items.forEach(function (it) {
      var key = it[0], label = it[1], href = it[2], icon = it[3], badge = it[4];
      var isActive = key === active;
      var hrefAttr = (href && href !== '#') ? (' href="' + href + '"') : ' href="#" data-stub="1"';
      html += '<a class="sb-link' + (isActive ? ' active' : '') + '"' + hrefAttr + '>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' + icon + '</svg> ' + label +
        (badge ? '<span class="sb-badge">' + badge + '</span>' : '') + '</a>';
    });
  });

  html += '</nav>' +
    '<div class="sb-footer"><div class="sb-user">' +
      '<div class="sb-av">AM</div>' +
      '<div><b>Amara D.</b><span>Superadmin</span></div>' +
      '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 10l4 4 4-4"/></svg>' +
    '</div></div>';

  var el = document.getElementById('rsNav');
  if (el) {
    el.innerHTML = html;
    el.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-stub]');
      if (a) { e.preventDefault(); }
    });
  }
})();
