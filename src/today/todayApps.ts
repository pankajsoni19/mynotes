import { Archive, FileText, KanbanSquare, type LucideIcon } from "lucide-react";
import type { AppSection } from "../appShellNavigation";

export type TodayApp = { section: Exclude<AppSection, "home" | "bin">; label: string; href: string; icon: LucideIcon };

/**
 * The launcher row on Today (D50). Each installed app adds its entry here
 * (Collections and Calendar append theirs). The Bin is not a launcher item:
 * it stays in the account row and in each app's sidebar footer.
 */
export const TODAY_APPS: TodayApp[] = [
  { section: "notes", label: "Notes", href: "/notes", icon: Archive },
  { section: "files", label: "Files", href: "/files", icon: FileText },
  { section: "tasks", label: "Tasks", href: "/tasks", icon: KanbanSquare }
];
