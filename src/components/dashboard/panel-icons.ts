import {
  BarChart3,
  Database,
  Download,
  FlaskConical,
  GraduationCap,
  HardDrive,
  History,
  Home,
  ImageIcon,
  MonitorPlay,
  School,
  ScrollText,
  SlidersHorizontal,
  Table,
  Tags,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * 面板导航图标映射（#361）：`panel-nav.ts` 只存 key/path/文案，图标留在这里，
 * 侧边栏与教师主页快捷入口都从同一张表取，新增 Tab 不会出现两套图标。
 */
export const PANEL_ICONS: Record<string, LucideIcon> = {
  home: Home,
  overview: BarChart3,
  screen: MonitorPlay,
  export: Download,
  submissions: History,
  profiles: Table,
  students: Users,
  teachers: GraduationCap,
  classes: School,
  grouping: UsersRound,
  tags: Tags,
  settings: Database,
  "profile-config": SlidersHorizontal,
  storage: HardDrive,
  media: ImageIcon,
  "audit-logs": ScrollText,
  demo: FlaskConical,
};
