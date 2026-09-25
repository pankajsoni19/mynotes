import { Archive, ArrowRight, FileText, House, LogOut, Settings, Sparkles, Trash2 } from "lucide-react";
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

function AccountActions({ displayName, onSettings, onSignOut }: AccountProps) {
  return <div className="app-account" role="group" aria-label="Account">
    <span className="app-home-user">{displayName}</span>
    <button className="app-account-button" onClick={onSettings} aria-haspopup="dialog" aria-controls="account-settings-dialog" aria-label={`Open settings for ${displayName}`} title="Settings"><Settings /><span className="app-account-label">Settings</span></button>
    <button className="app-account-button" onClick={onSignOut} title="Sign out"><LogOut /><span className="app-account-label">Sign out</span></button>
  </div>;
}

const cards: Array<{ section: Exclude<AppSection, "home">; icon: typeof Archive; eyebrow: string; title: string; copy: string; status: string }> = [
  { section: "notes", icon: Archive, eyebrow: "Your workspace", title: "Notes", copy: "Write fluid Markdown notes, keep versions, and share with the people you choose.", status: "Open Notes" },
  { section: "files", icon: FileText, eyebrow: "Coming next", title: "Files", copy: "Store supporting documents next to your note folders with secure previews and downloads.", status: "Preview" },
  { section: "bin", icon: Trash2, eyebrow: "Coming next", title: "Bin", copy: "Restore deleted notes and documents during their 30-day recovery window.", status: "Preview" }
];

export function AppHome({ displayName, onOpen, onSettings, onSignOut }: ShellProps) {
  return <main className="app-home">
    <header className="app-home-header">
      <div className="app-home-brand"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><small>MyNotes</small><strong>Home</strong></span></div>
      <AccountActions displayName={displayName} onSettings={onSettings} onSignOut={onSignOut} />
    </header>
    <section className="app-home-content" aria-labelledby="app-home-title">
      <span className="eyebrow">Workspace home</span>
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

export function AppPlaceholder({ section, onHome, onOpenNotes, ...account }: AccountProps & { section: Exclude<AppSection, "home" | "notes">; onHome: () => void; onOpenNotes: () => void }) {
  const title = section === "files" ? "Files" : "Bin";
  const detail = section === "files"
    ? "Document uploads, safe previews, downloads, and drag-to-folder organization are on their way."
    : "Deleted notes and documents will be recoverable here for 30 days once the shared Bin arrives.";
  const Icon = section === "files" ? FileText : Trash2;
  return <main className="app-placeholder">
    <header className="app-placeholder-header"><button className="app-home-button" onClick={onHome}><House />Home</button><span className="app-home-brand"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><small>MyNotes</small><strong>{title}</strong></span></span><AccountActions {...account} /></header>
    <section className="app-placeholder-content"><span className="app-placeholder-icon"><Icon /></span><span className="eyebrow">Foundation in progress</span><h1>{title}</h1><p>{detail}</p><button className="primary-button" onClick={onOpenNotes}>Open Notes</button></section>
  </main>;
}
