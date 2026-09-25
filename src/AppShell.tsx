import { useEffect, useState } from "react";
import { Archive, ArrowRight, FileText, KanbanSquare, LogOut, Settings, Sparkles, Trash2 } from "lucide-react";
import "./appShell.css";
import { listBin } from "./bin/binApi";
import type { AppSection } from "./appShellNavigation";

type AccountProps = {
  displayName: string;
  onSettings: () => void;
  onSignOut: () => void;
  /** Shown only where the Bin is a utility action (Home); the Bin app itself leaves it out. */
  onBin?: () => void;
  binCount?: number;
};

type ShellProps = AccountProps & {
  onOpen: (section: AppSection) => void;
};

export function AccountActions({ displayName, onSettings, onSignOut, onBin, binCount = 0 }: AccountProps) {
  const binLabel = binCount > 0 ? `Bin, ${binCount} item${binCount === 1 ? "" : "s"}` : "Bin";
  return <div className="app-account" role="group" aria-label="Account">
    <span className="app-home-user">{displayName}</span>
    <button className="app-account-button" onClick={onSettings} aria-haspopup="dialog" aria-controls="account-settings-dialog" aria-label={`Open settings for ${displayName}`} title="Settings"><Settings /><span className="app-account-label">Settings</span></button>
    {onBin && <button className="app-account-button app-account-bin" onClick={onBin} aria-label={binLabel} title="Bin"><Trash2 /><span className="app-account-label">Bin</span>{binCount > 0 && <span className="app-account-badge" aria-hidden="true">{binCount > 99 ? "99+" : binCount}</span>}</button>}
    <button className="app-account-button" onClick={onSignOut} title="Sign out"><LogOut /><span className="app-account-label">Sign out</span></button>
  </div>;
}

const cards: Array<{ section: Exclude<AppSection, "home" | "bin">; icon: typeof Archive; eyebrow: string; title: string; copy: string; status: string }> = [
  { section: "notes", icon: Archive, eyebrow: "Your workspace", title: "Notes", copy: "Write fluid Markdown notes, keep versions, and share with the people you choose.", status: "Open Notes" },
  { section: "files", icon: FileText, eyebrow: "Your workspace", title: "Files", copy: "Upload, preview, and organize documents next to your notes.", status: "Open Files" },
  { section: "tasks", icon: KanbanSquare, eyebrow: "Your workspace", title: "Tasks", copy: "Plan work on shared boards with draggable cards", status: "Open Tasks" }
];

export function AppHome({ displayName, onOpen, onSettings, onSignOut }: ShellProps) {
  const [binCount, setBinCount] = useState(0);
  // One lazy look when Home mounts, just for the badge; a failure leaves the plain Bin button.
  useEffect(() => {
    let live = true;
    listBin().then(({ items }) => { if (live) setBinCount(items.length); }, () => undefined);
    return () => { live = false; };
  }, []);
  return <main className="app-home">
    <header className="app-home-header">
      <div className="app-home-brand"><span className="brand-dot"><Sparkles /></span><span className="brand-text"><strong>Home</strong></span></div>
      <AccountActions displayName={displayName} onSettings={onSettings} onSignOut={onSignOut} onBin={() => onOpen("bin")} binCount={binCount} />
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
