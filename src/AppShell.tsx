import { useEffect, useState } from "react";
import { LogOut, Settings, Trash2 } from "lucide-react";
import "./appShell.css";
import { listBin } from "./bin/binApi";
import { useModuleEnabled } from "./modules";
import { NotificationBell } from "./notifications/NotificationBell";

type AccountProps = {
  displayName: string;
  onSettings: () => void;
  onSignOut: () => void;
  /** Shown only where the Bin is a utility action (Home, which is Today); the Bin app itself leaves it out. */
  onBin?: () => void;
  binCount?: number;
};

export function AccountActions({ displayName, onSettings, onSignOut, onBin, binCount = 0 }: AccountProps) {
  // Bin turned off (D92): no Bin button, whatever the app passes. Deleting still moves items to the Bin.
  const binEnabled = useModuleEnabled("bin");
  const binLabel = binCount > 0 ? `Bin, ${binCount} item${binCount === 1 ? "" : "s"}` : "Bin";
  // The bell sits beside the group (it renders only inside the signed-in shell).
  return <><div className="app-account" role="group" aria-label="Account">
    <span className="app-home-user">{displayName}</span>
    <button className="app-account-button" onClick={onSettings} aria-haspopup="dialog" aria-controls="account-settings-dialog" aria-label={`Open settings for ${displayName}`} title="Settings"><Settings /><span className="app-account-label">Settings</span></button>
    {onBin && binEnabled && <button className="app-account-button app-account-bin" onClick={onBin} aria-label={binLabel} title="Bin"><Trash2 /><span className="app-account-label">Bin</span>{binCount > 0 && <span className="app-account-badge" aria-hidden="true">{binCount > 99 ? "99+" : binCount}</span>}</button>}
    <button className="app-account-button" onClick={onSignOut} title="Sign out"><LogOut /><span className="app-account-label">Sign out</span></button>
  </div><NotificationBell /></>;
}

/**
 * The Bin badge count: one lazy look on mount (no polling); a failure leaves the plain Bin button.
 * `enabled` false skips the request where the header has no Bin button.
 */
export function useBinCount(enabled = true) {
  const [binCount, setBinCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    listBin().then(({ items }) => { if (live) setBinCount(items.length); }, () => undefined);
    return () => { live = false; };
  }, [enabled]);
  return binCount;
}
