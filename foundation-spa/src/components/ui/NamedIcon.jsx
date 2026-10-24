import {
  Activity, AlertTriangle, Ban, BarChart2, BookOpen, Calendar, CalendarDays, CheckSquare, Check,
  ClipboardList, Clock, Compass, Construction, FileText, Flag, FlaskConical, FolderOpen, GraduationCap,
  Grid2X2, Heart, Home, Hand, Inbox, LifeBuoy, Lock, Mail, Megaphone, MessageSquare, MousePointerClick,
  Package, Pencil, Radio, RefreshCw, Ruler, School, Search, Smartphone, Sprout, Square, Trophy, User, Users,
  Bell,
} from 'lucide-react';

// Line icons for the names used across the SPA. Replaces decorative emoji, so
// every icon follows the design system's stroke, size and colour tokens.
const ICONS = {
  activity: Activity,
  alert: AlertTriangle,
  ban: Ban,
  bell: Bell,
  book: BookOpen,
  calendar: Calendar,
  'calendar-days': CalendarDays,
  check: Check,
  chart: BarChart2,
  clipboard: ClipboardList,
  clock: Clock,
  compass: Compass,
  construction: Construction,
  file: FileText,
  flag: Flag,
  flask: FlaskConical,
  folder: FolderOpen,
  graduation: GraduationCap,
  grid: Grid2X2,
  hand: Hand,
  heart: Heart,
  home: Home,
  inbox: Inbox,
  lifebuoy: LifeBuoy,
  lock: Lock,
  mail: Mail,
  megaphone: Megaphone,
  message: MessageSquare,
  package: Package,
  phone: Smartphone,
  pencil: Pencil,
  pointer: MousePointerClick,
  radio: Radio,
  refresh: RefreshCw,
  ruler: Ruler,
  school: School,
  search: Search,
  sprout: Sprout,
  square: Square,
  checkbox: CheckSquare,
  trophy: Trophy,
  user: User,
  users: Users,
};

export default function NamedIcon({ name, size = 18, className = '', ...props }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return <Icon size={size} aria-hidden="true" className={className || undefined} {...props} />;
}
