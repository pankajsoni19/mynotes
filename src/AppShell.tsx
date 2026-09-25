import { Archive, ArrowRight, FileText, KanbanSquare, LogOut, Settings, Sparkles, Trash2 } from "lucide-react";
import "./appShell.css";
import type { AppSection } from "./appShellNavigation";

type AccountProps = {
  displayName: string;
  onSettings: () => void;
  onSignOut: () => void;
};

type ShellProps = AccountProps & {
  onOpen: (section: AppSection) => void;
};

export function AccountActions({ displayName, onSettings, onSignOut }: AccountProps) {
  return <div className="app-account" role="group" aria-label="Account">
    <span className="app-home-user">{displayName}</span>
    <button className="app-account-button" onClick={onSettings} aria-haspopup="dialog" aria-controls="account-settings-dialog" aria-label={`Open settings for ${displayName}`} title="Settings"><Settings /><span className="app-account-label">Settings</span></button>
    <button className="app-account-button" onClick={onSignOut} title="Sign out"><LogOut /><span className="app-account-label">Sign out</span></button>
  </div>;
}

const cards: Array<{ section: Exclude<AppSection, "home">; icon: typeof Archive; eyebrow: string; title: string; copy: string; status: string }> = [
  { section: "notes", icon: Archive, eyebrow: "Your workspace", title: "Notes", copy: "Write fluid Markdown notes, keep versions, and share with the people you choose.", status: "Open Notes" },
  { section: "files", icon: FileText, eyebrow: "Your workspace", title: "Files", copy: "Upload, preview, and organize documents next to your notes.", status: "Open Files" },
  { section: "tasks", icon: KanbanSquare, eyebrow: "Your workspace", title: "Tasks", copy: "Plan work on shared boards with draggable cards", status: "Open Tasks" },
  { section: "bin", icon: Trash2, eyebrow: "Your workspace", title: "Bin", copy: "Restore deleted notes and files for 30 days", status: "Open Bin" }
];

export function AppHome({ displayName, onOpen, onSettings, onSignOut }: ShellProps) {
  return <main className="app-home">
    <header className="app-home-header">
      <div className="app-home-brand"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><strong>Home</strong></span></div>
      <AccountActions displayName={displayName} onSettings={onSettings} onSignOut={onSignOut} />
    </header>
    <section className="app-home-content" aria-labelledby="app-home-title">
      <span className="eyebrow">Nook home</span>
      <h1 id="app-home-title">Good to see you, {displayName.split(" ")[0] || displayName}.</h1>
      <p>Choose an app to continue. Everything stays private to your signed-in workspace.</p>
      <div className="app-card-grid">
        {cards.map(({ section, icon: Icon, eyebrow, title, copy, status }) => <button key={section} className={`app-card app-card-${section}`} onClick={() => onOpen(section)}>
          <span className="app-card-icon"><Icon /></span>
          <span className="app-card-copy"><small>{eyebrow}</small><strong>{title}</strong><span>{copy}</span></span>
          <span className="app-card-action">{status} <ArrowRight /></span>
        </button>)}
      </div>
    </section>
  </main>;
}
