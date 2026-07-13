import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  LayoutDashboard, Shield, Calendar, Users, Clock, BookOpen,
  BarChart2, CheckSquare, CalendarCheck, TrendingUp, HelpCircle,
  MessageSquare, Bell, Mail, FileText, Lock, GraduationCap,
  RefreshCw, Activity, Layers, ExternalLink, Search, Star,
  LogOut, ChevronLeft, ChevronRight, ChevronDown, Menu, X, Moon, Sun,
} from 'lucide-react';

// ── Nav structure (mirrors admin-shell.js NAV_SECTIONS) ──────────────────────

const OPERATIONAL_ROLES = ['regional_secretary', 'principal', 'subgroup_admin', 'pastor', 'admin', 'superadmin'];
const SYSTEM_ADMIN_ROLES = ['admin', 'superadmin'];
const TEACHER_MODE_ELIGIBLE = new Set(['regional_secretary', 'admin', 'superadmin']);
const TEACHER_KEYS = new Set(['attendance', 'schedule', 'progress', 'help']);

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard',    path: '/staff/dashboards',     Icon: LayoutDashboard, roles: OPERATIONAL_ROLES },
      { key: 'portal',    label: 'Admin Portal', path: '/staff/admin-portal',   Icon: Shield,          roles: SYSTEM_ADMIN_ROLES },
    ],
  },
  {
    label: 'Operations',
    items: [
      { key: 'batch',       label: 'Batch Management', path: '/staff/batch-management',    Icon: Calendar,  roles: OPERATIONAL_ROLES },
      { key: 'applicants',  label: 'Applicants',       path: '/staff/applicant-directory', Icon: Users,     roles: OPERATIONAL_ROLES },
      { key: 'waitlist',    label: 'Waiting Students', path: '/staff/waitlist',            Icon: Clock,     roles: OPERATIONAL_ROLES },
      { key: 'classeditor', label: 'Class Editor',     path: '/staff/class-editor',        Icon: BookOpen,  roles: OPERATIONAL_ROLES },
    ],
  },
  {
    label: 'Reports & Exports',
    items: [
      { key: 'reports', label: 'Reports & Exports', path: '/staff/reports', Icon: BarChart2, roles: OPERATIONAL_ROLES },
    ],
  },
  {
    label: 'Teaching',
    items: [
      { key: 'attendance',    label: 'Attendance',      path: '/teacher/attendance', Icon: CheckSquare },
      { key: 'schedule',      label: 'Schedule',        path: '/staff/teacher-schedule', Icon: CalendarCheck },
      { key: 'progress',      label: 'Student Progress', path: '/staff/student-progress', Icon: TrendingUp },
    ],
  },
  {
    label: 'Comms',
    items: [
      { key: 'help',          label: 'Help Guide',     path: '/staff/help-guide',            Icon: HelpCircle,    roles: OPERATIONAL_ROLES },
      { key: 'messages',      label: 'Messages',       path: '/staff/messages',              Icon: MessageSquare, roles: OPERATIONAL_ROLES },
      { key: 'notifications', label: 'Notifications',  path: '/staff/notification-center',   Icon: Bell,          roles: SYSTEM_ADMIN_ROLES },
      { key: 'email',         label: 'Email Campaigns', path: '/staff/email-campaigns',      Icon: Mail,          roles: SYSTEM_ADMIN_ROLES },
    ],
  },
  {
    label: 'Admin Tools',
    items: [
      { key: 'adminactivity', label: 'Activity Log', path: '/staff/admin-activity', Icon: FileText, roles: ['admin', 'superadmin'] },
      { key: 'roleaudit',     label: 'Role Audit',   path: '/staff/role-audit',     Icon: Lock,     roles: ['superadmin'] },
    ],
  },
  {
    label: 'System',
    items: [
      { key: 'teachers',      label: 'Teachers',         path: '/staff/teacher-management',       Icon: GraduationCap, roles: OPERATIONAL_ROLES },
      { key: 'trace',         label: 'Operational Trace', path: '/staff/operational-trace',        Icon: Activity,      roles: ['admin', 'superadmin', 'regional_secretary'] },
      { key: 'fellowships',   label: 'Fellowships',      path: '/staff/fellowship-management',    Icon: Layers,        roles: SYSTEM_ADMIN_ROLES },
      { key: 'nexusmapping',  label: 'Nexus Mapping',    path: '/staff/nexus-management',         Icon: ExternalLink,  roles: SYSTEM_ADMIN_ROLES },
      { key: 'failedsyncs',   label: 'Failed Syncs',     path: '/staff/failed-sync-retry-center', Icon: RefreshCw,     roles: SYSTEM_ADMIN_ROLES },
      { key: 'health',        label: 'System Health',    path: '/staff/system-health',            Icon: Activity,      roles: SYSTEM_ADMIN_ROLES },
      { key: 'moodlesettings',label: 'Moodle Settings',  path: '/staff/moodle-settings',          Icon: Search,        roles: SYSTEM_ADMIN_ROLES },
      { key: 'audit',         label: 'Audit Log',        path: '/staff/audit-log',                Icon: FileText,      roles: ['superadmin'] },
      { key: 'milestones',    label: 'Milestones',       path: '/staff/milestones',               Icon: Star,          roles: OPERATIONAL_ROLES },
    ],
  },
];

const THEME_KEY = 'fs_admin_theme';
const COLLAPSE_KEY = 'fs_admin_sidebar_collapsed';
const SECTION_COLLAPSE_KEY = 'fs_admin_nav_collapsed_sections';
const DEFAULT_COLLAPSED_SECTIONS = ['Admin Tools', 'System'];

// ── Shell ─────────────────────────────────────────────────────────────────────

export default function Shell({ children, pageTitle }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
  });
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = localStorage.getItem(SECTION_COLLAPSE_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set(DEFAULT_COLLAPSED_SECTIONS);
    } catch { return new Set(DEFAULT_COLLAPSED_SECTIONS); }
  });

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const toggleSection = useCallback((label) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try { localStorage.setItem(SECTION_COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOut();
    navigate('/auth/login');
  }, [signOut, navigate]);

  const role = profile?.role ?? '';
  const isTeacherRole = role === 'teacher';

  const visibleSections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (role === 'regional_secretary' && (item.key === 'notifications' || item.key === 'email')) return false;
      if (isTeacherRole) return TEACHER_KEYS.has(item.key);
      if (Array.isArray(item.roles) && item.roles.length > 0) return item.roles.includes(role);
      return true;
    }),
  })).filter((s) => s.items.length > 0);

  const profileName = profile?.full_name || profile?.email || 'Admin';
  const profileInitial = (profileName).trim().charAt(0).toUpperCase();
  const displayRole = role.replace(/_/g, ' ');

  return (
    <div className={`rso-layout${collapsed ? ' sidebar-collapsed' : ''}`}>
      {/* Mobile backdrop */}
      <div
        className={`rso-sidebar-backdrop${mobileOpen ? ' show' : ''}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside className={`rso-sidebar${collapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
        <div className="sb-logo">
          <div className="sb-mark">RS</div>
          {!collapsed && (
            <div className="sb-brand">
              <div className="sb-name">Rock Solid</div>
              <div className="sb-sub">Admin Portal</div>
            </div>
          )}
          <button
            className="icon-btn"
            onClick={toggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{ marginLeft: 'auto' }}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        <nav className="sb-nav" aria-label="Admin navigation">
          {visibleSections.map((section) => {
            const sectionCollapsed = !collapsed && collapsedSections.has(section.label);
            return (
              <div key={section.label}>
                {!collapsed && (
                  <button
                    type="button"
                    className="sb-section-label sb-section-toggle"
                    onClick={() => toggleSection(section.label)}
                    aria-expanded={!sectionCollapsed}
                  >
                    <span>{section.label}</span>
                    <ChevronDown size={12} className={`sb-section-chevron${sectionCollapsed ? ' collapsed' : ''}`} />
                  </button>
                )}
                {(collapsed || !sectionCollapsed) && section.items.map((item) => (
                  <NavLink
                    key={item.key}
                    to={item.path}
                    className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}
                    title={item.label}
                  >
                    <span className="sb-icon"><item.Icon size={16} /></span>
                    {!collapsed && <span className="sb-label-text">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sb-footer">
          <button className="sb-link" onClick={handleSignOut} style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span className="sb-icon"><LogOut size={16} /></span>
            {!collapsed && <span className="sb-label-text">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="rso-content">
        <header className="rso-topbar">
          <div className="topbar-left">
            <button className="icon-btn ham-btn" onClick={() => setMobileOpen((o) => !o)} aria-label="Toggle menu">
              {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
              <span>Admin</span>
              {pageTitle && (
                <>
                  <span className="sep">/</span>
                  <span className="topbar-page">{pageTitle}</span>
                </>
              )}
            </nav>
          </div>

          <div className="topbar-right">
            <button className="icon-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Light mode' : 'Dark mode'} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="user-chip">
              <div className="user-av">{profileInitial}</div>
              <div>
                <div className="user-name">{profileName}</div>
                <div className="user-role">{displayRole}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="rso-page">
          {children}
        </main>
      </div>
    </div>
  );
}
