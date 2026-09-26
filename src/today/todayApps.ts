import { Archive, CalendarDays, FileText, KanbanSquare, Table2, type LucideIcon } from "lucide-react";
import type { AppSection } from "../appShellNavigation";

export type TodayApp = { section: Exclude<AppSection, "home" | "bin" | "notifications" | "team">; label: string; href: string; icon: LucideIcon };

/**
 * The launcher row on Today (D50). Each installed app adds its entry here
 * (Calendar included). The Bin, Team, and notifications are not launcher items:
 * they stay in the account row and in each app's sidebar footer.
 */
export const TODAY_APPS: TodayApp[] = [
  { section: "notes", label: "Notes", href: "/notes", icon: Archive },
  { section: "files", label: "Files", href: "/files", icon: FileText },
  { section: "tasks", label: "Tasks", href: "/tasks", icon: KanbanSquare },
  { section: "collections", label: "Collections", href: "/collections", icon: Table2 },
  { section: "calendar", label: "Calendar", href: "/calendar", icon: CalendarDays }
];
