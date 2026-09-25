import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUpDown,
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  FilePlus2,
  Folder as FolderIcon,
  FolderPlus,
  History,
  Info,
  KeyRound,
  Lock,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  Share2,
  Smartphone,
  Sparkles,
  Trash2,
  Users,
  X
} from "lucide-react";
import QRCode from "qrcode";
import { api, ApiError, setCsrfToken } from "./api";
import { AppHome, AppPlaceholder } from "./AppShell";
import { NoteEditor } from "./editor/NoteEditor";
import { createHistoryState, isMobileViewport, readHistorySnapshot, sameSnapshot, type FolderSelection, type MobileNavigationSnapshot, type MobilePanel } from "./mobileNavigation";
import { createAppHistoryState, readHistoryDepth, resolveAppHistorySection, startupRouteState, withHistoryDepth, type AppSection } from "./appShellNavigation";
import { finalizeOpenNote } from "./noteFinalization";
import { formatRoute, parseRoute, type Route } from "./router";
import { noteInFolder, notesRoute, resolveNotesPanel, resolveNotesRoute, type NotesRoute } from "./notesRoute";
import type { Folder, NoteDetail, NoteSummary, User, Version } from "./types";

type TotpState = { enabled: boolean; required: boolean; setupRequired: boolean };
type SessionResponse = { user: User; csrfToken: string; totp: TotpState };
type NoteSort = "updated-desc" | "updated-asc" | "created-desc" | "created-asc" | "title-asc" | "title-desc";
type McpApiKey = { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null };

const noteSortOptions: Array<{ value: NoteSort; label: string }> = [
  { value: "updated-desc", label: "Recently edited" },
  { value: "updated-asc", label: "Oldest edited" },
  { value: "created-desc", label: "Recently added" },
  { value: "created-asc", label: "Oldest added" },
  { value: "title-asc", label: "Title A–Z" },
  { value: "title-desc", label: "Title Z–A" }
];

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (session: SessionResponse) => void }) {
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const payload = registering
        ? { email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") }
        : {
          email: form.get("email"),
          password: form.get("password"),
          ...(needsTotp ? useRecoveryCode ? { recoveryCode: form.get("recoveryCode") } : { totpCode: form.get("totpCode") } : {})
        };
      const session = await api<SessionResponse>(registering ? "/auth/register" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setCsrfToken(session.csrfToken);
      onAuthenticated(session);
    } catch (reason) {
      if (!registering && reason instanceof ApiError && (reason.payload as { requiresTotp?: boolean } | undefined)?.requiresTotp) {
        setNeedsTotp(true);
      }
      setError(reason instanceof Error ? reason.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark"><Sparkles aria-hidden="true" /></div>
        <div className="auth-heading">
          <span className="eyebrow">MyNotes</span>
          <h1>{registering ? "Create your account" : "Welcome back"}</h1>
          <p>Your private workspace for ideas, passwords, and configuration notes.</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          {registering && <label>Name<input name="displayName" autoComplete="name" required maxLength={80} /></label>}
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <div className="auth-password-group">
            <label htmlFor="auth-password">Password</label>
            <span className="password-field">
              <input id="auth-password" name="password" type={passwordVisible ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 12 : 1} />
              <button
                type="button"
                className="password-visibility-toggle"
                aria-label={passwordVisible ? "Hide password" : "Show password"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((visible) => !visible)}
              >
                {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </span>
          </div>
          {!registering && needsTotp && (useRecoveryCode
            ? <label>Recovery code<input name="recoveryCode" autoComplete="one-time-code" placeholder="ABCDE-FGHIJ-KLMNO" minLength={10} maxLength={32} required autoFocus /><small>Enter one complete backup recovery code. Each code works once.</small></label>
            : <label>Six-digit authentication code<input name="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required autoFocus /><small>Enter the current six-digit number shown in Google Authenticator—not the grouped setup key.</small></label>)}
          {!registering && needsTotp && <button type="button" className="inline-auth-switch" onClick={() => { setUseRecoveryCode((value) => !value); setError(""); }}>{useRecoveryCode ? "Use Google Authenticator instead" : "Use a recovery code"}</button>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
        </form>
        <button className="text-button" onClick={() => { setRegistering(!registering); setNeedsTotp(false); setUseRecoveryCode(false); setPasswordVisible(false); setError(""); }}>
          {registering ? "Already have an account? Sign in" : "Setting up MyNotes? Create the first account"}
        </button>
        <p className="security-note"><Lock /> Your notes stay on this machine.</p>
      </section>
    </main>
  );
}

function McpSettings({ onPendingChange, totpEnabled }: { onPendingChange: (pending: boolean) => void; totpEnabled: boolean }) {
  const [keys, setKeys] = useState<McpApiKey[]>([]);
  const [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const endpoint = `${window.location.origin}/mcp`;
  const displayToken = newToken || "<YOUR_API_KEY>";
  const configText = JSON.stringify({
    mcpServers: {
      mynotes: {
        type: "streamable-http",
        url: endpoint,
        headers: { Authorization: `Bearer ${displayToken}` }
      }
    }
  }, null, 2);

  const loadKeys = useCallback(() => {
    api<{ keys: McpApiKey[] }>("/mcp/keys").then(({ keys: items }) => setKeys(items)).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load API keys"));
  }, []);

  useEffect(loadKeys, [loadKeys]);
  useEffect(() => {
    onPendingChange(Boolean(newToken));
    return () => onPendingChange(false);
  }, [newToken, onPendingChange]);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await api<{ key: McpApiKey & { token: string } }>("/mcp/keys", { method: "POST", body: JSON.stringify({ name: form.get("name"), password: form.get("password"), ...(totpEnabled ? { totpCode: form.get("totpCode") } : {}) }) });
      setNewToken(result.key.token);
      event.currentTarget.reset();
      loadKeys();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create API key");
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(key: McpApiKey) {
    if (!window.confirm(`Revoke “${key.name}”? Connected MCP clients using it will stop working.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/mcp/keys/${key.id}`, { method: "DELETE", body: "{}" });
      loadKeys();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not revoke API key");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Automatic copy is unavailable here. Select the value and copy it manually.");
    }
  }

  return <section className="settings-content mcp-settings" aria-labelledby="mcp-heading">
    <div className="settings-section-heading"><span className="settings-icon"><Plug /></span><div><h3 id="mcp-heading">MCP server</h3><p>Connect trusted AI clients over Streamable HTTP. MyNotes exposes only published notes you can already read; drafts and write operations are not available.</p></div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="mcp-endpoint"><div><span>Transport</span><strong>Streamable HTTP</strong></div><div><span>Endpoint</span><code>{endpoint}</code><button type="button" className="icon-button" onClick={() => copy(endpoint, "endpoint")} aria-label="Copy MCP endpoint"><Copy /></button></div></div>
    <div className="mcp-card">
      <div><h4>API keys</h4><p>Create a separate key for each client. The full key is shown once and stored only as a SHA-256 hash.</p></div>
      {!newToken && <form className="mcp-key-form" onSubmit={createKey}><label>Key name<input name="name" maxLength={80} placeholder="Personal laptop" required /></label><label>Confirm password<input name="password" type="password" autoComplete="current-password" required /></label>{totpEnabled && <label>Fresh six-digit code<input name="totpCode" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required /></label>}<button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create API key"}</button></form>}
      {newToken && <div className="new-api-key" role="status"><strong>Copy this key now</strong><p>It cannot be shown again after you leave this screen. You can select the text manually if automatic copy is unavailable.</p><textarea readOnly value={newToken} aria-label="New MCP API key" onFocus={(event) => event.currentTarget.select()} /><div><button type="button" className="secondary-button" onClick={() => copy(newToken, "token")}><Copy />{copied === "token" ? "Copied key" : "Copy key"}</button><button type="button" className="text-button" onClick={() => setNewToken("")}>I saved this key</button></div></div>}
      <div className="mcp-key-list">{keys.map((key) => <div key={key.id}><span className="key-icon"><KeyRound /></span><div><strong>{key.name}</strong><small><code>{key.key_prefix}…</code> · Created {relativeTime(key.created_at)}{key.last_used_at ? ` · Used ${relativeTime(key.last_used_at)}` : " · Never used"}</small></div><button type="button" className="text-danger" disabled={busy} onClick={() => revokeKey(key)}>Revoke</button></div>)}{!keys.length && <p>No active API keys.</p>}</div>
    </div>
    <div className="mcp-card mcp-config"><div><h4 id="mcp-config-heading">JSON client configuration</h4><p>This common JSON shape is supported by many Streamable HTTP clients; check your client's documentation because config formats differ. Replace the placeholder if you have not just created a key.</p></div><pre aria-labelledby="mcp-config-heading"><code>{configText}</code></pre><button type="button" className="secondary-button" onClick={() => copy(configText, "config")}><Copy />{copied === "config" ? "Copied config" : "Copy config"}</button></div>
  </section>;
}

function SettingsDialog({ session, onClose, onSecurityChanged }: { session: SessionResponse; onClose: () => void; onSecurityChanged: (state: TotpState) => void }) {
  const [section, setSection] = useState<"security" | "mcp" | "about">("security");
  const [appInfo, setAppInfo] = useState({ version: "0.2.3", gitSha: "development" });
  const [state, setState] = useState<TotpState>(session.totp);
  const [secret, setSecret] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [mcpKeyPending, setMcpKeyPending] = useState(false);

  const guardedClose = useCallback(() => {
    if (mcpKeyPending && !window.confirm("This API key is shown only once. Close settings without saving it?")) return;
    onClose();
  }, [mcpKeyPending, onClose]);

  function selectSection(next: "security" | "mcp" | "about") {
    if (next !== "mcp" && mcpKeyPending && !window.confirm("This API key is shown only once. Leave this section without saving it?")) return;
    setSection(next);
  }

  useEffect(() => {
    api<TotpState>("/auth/totp/status").then(setState).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load security settings"));
    api<{ version: string; gitSha: string }>("/about").then(setAppInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (state.setupRequired) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") guardedClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [guardedClose, state.setupRequired]);

  useEffect(() => { if (state.setupRequired) setSection("security"); }, [state.setupRequired]);

  async function beginSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const setup = await api<{ secret: string; uri: string }>("/auth/totp/setup", { method: "POST", body: JSON.stringify({ password: form.get("password") }) });
      setSecret(setup.secret);
      setQrCode(await QRCode.toDataURL(setup.uri, { width: 220, margin: 2, color: { dark: "#151515", light: "#ffffff" } }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start two-factor setup");
    } finally {
      setBusy(false);
    }
  }

  async function enable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const next = await api<TotpState & { recoveryCodes: string[] }>("/auth/totp/enable", { method: "POST", body: JSON.stringify({ code: form.get("code") }) });
      setSecret("");
      setQrCode("");
      setRecoveryCodes(next.recoveryCodes);
      setState(next);
      onSecurityChanged(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not enable two-factor authentication");
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Disable two-factor authentication for this account?")) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const next = await api<TotpState>("/auth/totp", { method: "DELETE", body: JSON.stringify({ password: form.get("password"), code: form.get("code") }) });
      setState(next);
      onSecurityChanged(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not disable two-factor authentication");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function revealRecoveryCodes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await api<{ recoveryCodes: string[] }>("/auth/totp/recovery-codes", { method: "POST", body: JSON.stringify({ password: form.get("password"), code: form.get("code") }) });
      setRecoveryCodes(result.recoveryCodes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reveal recovery codes");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateRecoveryCodes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryCodes.length && !window.confirm("Generate new recovery codes? Every previous recovery code will stop working.")) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await api<{ recoveryCodes: string[] }>("/auth/totp/recovery-codes/regenerate", { method: "POST", body: JSON.stringify({ password: form.get("password"), code: form.get("code") }) });
      setRecoveryCodes(result.recoveryCodes);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not generate recovery codes");
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section id="account-settings-dialog" className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header">
        <div><span className="eyebrow">Account</span><h2 id="settings-title">Settings</h2></div>
        {!state.setupRequired && <button className="icon-button" onClick={guardedClose} aria-label="Close settings"><X /></button>}
      </header>
      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections"><button className={section === "security" ? "active" : ""} aria-current={section === "security" ? "page" : undefined} onClick={() => selectSection("security")}><ShieldCheck />Security</button>{!state.setupRequired && <><button className={section === "mcp" ? "active" : ""} aria-current={section === "mcp" ? "page" : undefined} onClick={() => selectSection("mcp")}><Plug />MCP server</button><button className={section === "about" ? "active" : ""} aria-current={section === "about" ? "page" : undefined} onClick={() => selectSection("about")}><Info />About</button></>}</nav>
        {section === "security" ? <section className="settings-content" aria-labelledby="security-heading">
          <div className="settings-section-heading"><span className="settings-icon"><Smartphone /></span><div><h3 id="security-heading">Two-factor authentication</h3><p>Protect your account with a six-digit code from Google Authenticator or another TOTP app.</p></div></div>
          {state.setupRequired && <div className="settings-warning"><Lock />Two-factor authentication is required before you can use your notes.</div>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {state.enabled ? <div className="security-card enabled-card">
            <div className="security-status"><span><Check /></span><div><strong>Authenticator enabled</strong><small>Your account requires your password and an authentication code at sign in.</small></div></div>
            {recoveryCodes.length ? <div className="recovery-codes"><div><h4>Recovery codes</h4><p>Save each complete grouped code somewhere safe. A whole recovery code replaces the six-digit Authenticator number once.</p></div><div className="recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div><button className="secondary-button" onClick={copyRecoveryCodes}>{copied ? "Copied" : "Copy all codes"}</button></div> : <form className="view-recovery-form" onSubmit={revealRecoveryCodes}><h4>View recovery codes</h4><p>Re-enter your password and a fresh, unused six-digit Authenticator code to reveal the remaining backup codes.</p><div><input name="password" type="password" autoComplete="current-password" placeholder="Password" required /><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" required /><button className="secondary-button" disabled={busy}>View codes</button></div></form>}
            <details className="regenerate-recovery"><summary>{recoveryCodes.length ? "Replace recovery codes" : "No codes available? Generate recovery codes"}</summary><form onSubmit={regenerateRecoveryCodes}><p>This invalidates every previous recovery code. Confirm with your password and a fresh six-digit Authenticator code.</p><div><input name="password" type="password" autoComplete="current-password" placeholder="Password" required /><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" required /><button className="secondary-button" disabled={busy}>Generate new codes</button></div></form></details>
            {state.required ? <p className="policy-copy">This service requires two-factor authentication, so it cannot be disabled.</p> : <form className="disable-totp-form" onSubmit={disable}>
              <h4>Disable authenticator</h4><p>Confirm your password and a current code.</p>
              <div><input name="password" type="password" autoComplete="current-password" placeholder="Password" required /><input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code" required /><button className="secondary-button" disabled={busy}>Disable</button></div>
            </form>}
          </div> : !secret ? <form className="security-card setup-intro" onSubmit={beginSetup}>
            <strong>Authenticator not configured</strong>
            <p>Use Google Authenticator to scan a QR code, then verify one code to finish setup.</p>
            <label>Confirm your password<input name="password" type="password" autoComplete="current-password" required /></label>
            <button className="primary-button" disabled={busy}>{busy ? "Preparing…" : "Set up authenticator"}</button>
          </form> : <div className="security-card enrollment-card">
            <div className="enrollment-grid">
              <div className="qr-frame"><img src={qrCode} alt="QR code for MyNotes two-factor authentication" /></div>
              <div><span className="step-label">1 · Scan the code</span><h4>Add MyNotes to Google Authenticator</h4><p>If you cannot scan it, enter the entire setup key manually in Google Authenticator. The groups of four are only for readability; copying removes all spaces. This key is not entered when signing in.</p><button className="secret-copy" onClick={copySecret}><code>{secret.match(/.{1,4}/g)?.join(" ")}</code><span>{copied ? <><Check />Copied</> : "Copy setup key without spaces"}</span></button></div>
            </div>
            <form className="verify-totp-form" onSubmit={enable}><span className="step-label">2 · Verify setup</span><label>Authentication code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" required autoFocus /></label><button className="primary-button" disabled={busy}>{busy ? "Verifying…" : "Enable two-factor authentication"}</button></form>
          </div>}
        </section> : section === "mcp" ? <McpSettings onPendingChange={setMcpKeyPending} totpEnabled={state.enabled} /> : <section className="settings-content about-settings" aria-labelledby="about-heading"><div className="settings-section-heading"><span className="settings-icon"><Info /></span><div><h3 id="about-heading">About MyNotes</h3><p>A private, self-hosted place for notes, configuration, and ideas.</p></div></div><div className="about-card"><div className="brand-mark"><Sparkles /></div><div><h4>MyNotes</h4><p>Built by Pankaj</p></div><dl><div><dt>Version</dt><dd>{appInfo.version}</dd></div><div><dt>Git SHA</dt><dd><code>{appInfo.gitSha}</code></dd></div></dl><a href="https://github.com/pankajsoni19" target="_blank" rel="noopener noreferrer">github.com/pankajsoni19</a></div></section>}
      </div>
    </section>
  );
}

function lineDiff(previous: string, current: string) {
  const before = previous.split("\n");
  const after = current.split("\n");
  const rows = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0)) as number[][];
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) rows[i][j] = before[i] === after[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  }
  const output: Array<{ kind: "same" | "add" | "remove"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      output.push({ kind: "same", text: before[i] }); i += 1; j += 1;
    } else if (j < after.length && (i === before.length || rows[i][j + 1] >= rows[i + 1][j])) {
      output.push({ kind: "add", text: after[j] }); j += 1;
    } else {
      output.push({ kind: "remove", text: before[i] }); i += 1;
    }
  }
  return output;
}

function HistoryPanel({ note, onClose, onRestored }: { note: NoteDetail; onClose: () => void; onRestored: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [currentContent, setCurrentContent] = useState("");
  const [previousContent, setPreviousContent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ versions: Version[] }>(`/notes/${note.id}/versions`).then(({ versions: items }) => {
      setVersions(items);
      setSelected(items[0]?.version_number ?? null);
    });
  }, [note.id]);

  useEffect(() => {
    if (selected === null) return;
    const index = versions.findIndex((version) => version.version_number === selected);
    Promise.all([
      api<{ markdown: string }>(`/notes/${note.id}/versions/${selected}`),
      index >= 0 && versions[index + 1]
        ? api<{ markdown: string }>(`/notes/${note.id}/versions/${versions[index + 1].version_number}`)
        : Promise.resolve({ markdown: "" })
    ]).then(([current, previous]) => {
      setCurrentContent(current.markdown);
      setPreviousContent(previous.markdown);
    });
  }, [note.id, selected, versions]);

  const diff = useMemo(() => lineDiff(previousContent, currentContent), [previousContent, currentContent]);

  async function restore() {
    if (selected === null) return;
    setBusy(true);
    await api(`/notes/${note.id}/versions/${selected}/restore`, { method: "POST", body: "{}" });
    setBusy(false);
    onRestored();
  }

  return (
    <aside className="side-panel history-panel">
      <header><div><span className="eyebrow">Timeline</span><h2>Version history</h2></div><button className="icon-button" onClick={onClose} aria-label="Close history"><X /></button></header>
      <div className="version-list">
        {versions.map((version) => (
          <button key={version.id} className={selected === version.version_number ? "selected" : ""} onClick={() => setSelected(version.version_number)}>
            <span>Version {version.version_number}</span>
            <small>{version.author_name} · {relativeTime(version.created_at)}</small>
          </button>
        ))}
        {!versions.length && <p className="empty-copy">Publish a draft to create the first version.</p>}
      </div>
      {selected !== null && <>
        <div className="diff-heading"><span>Changes in v{selected}</span><span><i className="diff-add" /> Added <i className="diff-remove" /> Removed</span></div>
        <pre className="diff-view">{diff.map((line, index) => <span key={`${index}-${line.kind}`} className={line.kind}>{line.kind === "add" ? "+ " : line.kind === "remove" ? "− " : "  "}{line.text || " "}</span>)}</pre>
        {note.isOwner && <button className="secondary-button restore-button" disabled={busy} onClick={restore}>Restore as draft</button>}
      </>}
    </aside>
  );
}

function SharePanel({ note, onClose, onChanged }: { note: NoteDetail; onClose: () => void; onChanged: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<"inherit" | "private" | "selected" | "all_users">("inherit");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ users: User[] }>("/users"),
      api<{ visibility: typeof visibility; users: Array<{ id: string }> }>(`/notes/${note.id}/sharing`)
    ]).then(([allUsers, sharing]) => {
      setUsers(allUsers.users);
      setVisibility(sharing.visibility);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    });
  }, [note.id]);

  async function save() {
    setBusy(true);
    await api(`/notes/${note.id}/sharing`, { method: "PUT", body: JSON.stringify({ visibility, userIds: visibility === "selected" ? selected : [] }) });
    setBusy(false);
    onChanged();
  }

  return (
    <aside className="side-panel share-panel">
      <header><div><span className="eyebrow">Access</span><h2>Share note</h2></div><button className="icon-button" onClick={onClose} aria-label="Close sharing"><X /></button></header>
      <div className="share-options">
        <label><input type="radio" checked={visibility === "inherit"} onChange={() => setVisibility("inherit")} /><span><FolderIcon />Use folder access<small>Inherit this note’s folder sharing</small></span></label>
        <label><input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span><Lock />Private<small>Only you can open this note</small></span></label>
        <label><input type="radio" checked={visibility === "selected"} onChange={() => setVisibility("selected")} /><span><Users />Selected people<small>Choose registered users below</small></span></label>
        <label><input type="radio" checked={visibility === "all_users"} onChange={() => setVisibility("all_users")} /><span><Share2 />Everyone here<small>All signed-in users, never public</small></span></label>
      </div>
      {visibility === "selected" && <div className="user-picker">
        {users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={() => setSelected((items) => items.includes(user.id) ? items.filter((id) => id !== user.id) : [...items, user.id])} /><span>{user.displayName}{user.email && <small>{user.email}</small>}</span></label>)}
        {!users.length && <p className="empty-copy">Create another account before sharing with selected people.</p>}
      </div>}
      <button className="primary-button share-save" onClick={save} disabled={busy || (visibility === "selected" && !selected.length)}>Save access</button>
    </aside>
  );
}

function FolderSharePanel({ folder, onClose, onChanged }: { folder: Folder; onClose: () => void; onChanged: () => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [visibility, setVisibility] = useState<"private" | "selected" | "all_users">(folder.visibility);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ users: User[] }>("/users"),
      api<{ visibility: typeof visibility; users: Array<{ id: string }> }>(`/folders/${folder.id}/sharing`)
    ]).then(([allUsers, sharing]) => {
      setUsers(allUsers.users);
      setVisibility(sharing.visibility);
      setSelected(sharing.users.map((user) => user.id));
      setBusy(false);
    });
  }, [folder.id]);

  async function save() {
    setBusy(true);
    await api(`/folders/${folder.id}/sharing`, { method: "PUT", body: JSON.stringify({ visibility, userIds: visibility === "selected" ? selected : [] }) });
    setBusy(false);
    onChanged();
  }

  return (
    <aside className="side-panel share-panel">
      <header><div><span className="eyebrow">Folder access</span><h2>{folder.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close folder sharing"><X /></button></header>
      <div className="share-options">
        <label><input type="radio" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span><Lock />Private<small>Only you can open this folder’s notes</small></span></label>
        <label><input type="radio" checked={visibility === "selected"} onChange={() => setVisibility("selected")} /><span><Users />Selected people<small>Share inherited notes with chosen users</small></span></label>
        <label><input type="radio" checked={visibility === "all_users"} onChange={() => setVisibility("all_users")} /><span><Share2 />Everyone here<small>All signed-in allowlisted users</small></span></label>
      </div>
      {visibility === "selected" && <div className="user-picker">
        {users.map((user) => <label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} onChange={() => setSelected((items) => items.includes(user.id) ? items.filter((id) => id !== user.id) : [...items, user.id])} /><span>{user.displayName}</span></label>)}
        {!users.length && <p className="empty-copy">Another signed-in user is needed before sharing this folder.</p>}
      </div>}
      <button className="primary-button share-save" onClick={save} disabled={busy || (visibility === "selected" && !selected.length)}>Save folder access</button>
    </aside>
  );
}

function historyStateFor(userId: string, route: Route, panel: MobilePanel) {
  const notesState = route.app === "notes" ? createHistoryState(userId, { panel, folder: route.folder, noteId: route.noteId }, null) : null;
  return createAppHistoryState(userId, route.app, notesState);
}

// The URL carries the app, folder, and item; the state payload adds the phone panel hint (and the
// folder a note was opened from). A change that keeps the URL is a pure panel step: phones get a Back
// entry for it, desktops just update the current entry.
function writeHistory(userId: string, route: Route, panel: MobilePanel, mode: "push" | "replace" = "push") {
  const url = formatRoute(route);
  const current: unknown = window.history.state;
  const samePath = url === window.location.pathname;
  const currentSnapshot = readHistorySnapshot(current, userId);
  const sameEntry = samePath && resolveAppHistorySection(current, userId) === route.app
    && (route.app !== "notes" || (currentSnapshot !== null && sameSnapshot(currentSnapshot, { panel, folder: route.folder, noteId: route.noteId })));
  if (sameEntry && mode === "push") return;
  const depth = readHistoryDepth(current);
  if (mode === "push" && !(samePath && !isMobileViewport())) window.history.pushState(withHistoryDepth(historyStateFor(userId, route, panel), depth + 1), "", url);
  else window.history.replaceState(withHistoryDepth(historyStateFor(userId, route, panel), depth), "", url);
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [checking, setChecking] = useState(true);
  const [activeApp, setActiveApp] = useState<AppSection>(() => parseRoute(window.location.pathname).app);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("folders");
  const [panel, setPanel] = useState<"history" | "share" | null>(null);
  const [mobileActions, setMobileActions] = useState(false);
  const [sharingFolder, setSharingFolder] = useState<Folder | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteSort, setNoteSort] = useState<NoteSort>("updated-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [toast, setToast] = useState("");
  const [selectionOwner, setSelectionOwner] = useState<string | null>(null);
  const [leavingNotes, setLeavingNotes] = useState(false);
  const sessionUserRef = useRef<string | null>(null);
  const noteLoadGenerationRef = useRef(0);
  const revisionRef = useRef<number | null>(null);
  const loadedRef = useRef("");
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);
  const switchingRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  // The route requested before the workspace was ready (deep link, or the URL shown on the login page).
  const pendingRouteRef = useRef<Route | null>(parseRoute(window.location.pathname));
  const routeAppliedUserRef = useRef<string | null>(null);
  // Set when the first data load for a user failed, so the next route change retries it.
  const startupFailedUserRef = useRef<string | null>(null);
  const [startupRetry, setStartupRetry] = useState(0);
  const newlyCreatedNoteIdRef = useRef<string | null>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadNavigation = useCallback(async (expectedUserId = sessionUserRef.current) => {
    const [{ folders: folderRows }, { notes: noteRows }] = await Promise.all([
      api<{ folders: Folder[] }>("/folders"),
      api<{ notes: NoteSummary[] }>("/notes")
    ]);
    if (!expectedUserId || sessionUserRef.current !== expectedUserId) return { folders: [] as Folder[], notes: [] as NoteSummary[], stale: true };
    setFolders(folderRows);
    setNotes(noteRows);
    return { folders: folderRows, notes: noteRows, stale: false };
  }, []);

  const loadNote = useCallback(async (id: string) => {
    const expectedUserId = sessionUserRef.current;
    const generation = ++noteLoadGenerationRef.current;
    const { note: detail } = await api<{ note: NoteDetail }>(`/notes/${id}`);
    if (!expectedUserId || sessionUserRef.current !== expectedUserId || generation !== noteLoadGenerationRef.current) return;
    setNote(detail);
    setMarkdown(detail.markdown);
    revisionRef.current = detail.draft_revision;
    loadedRef.current = detail.markdown;
    setSaveState("saved");
  }, []);

  useEffect(() => {
    api<SessionResponse>("/auth/me")
      .then((result) => { sessionUserRef.current = result.user.id; setCsrfToken(result.csrfToken); setSession(result); })
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!session) return;
    if (session.totp.setupRequired) setSettingsOpen(true);
    else {
      const userId = session.user.id;
      // Later session updates (for example a two-factor change) only refresh data; the route was already applied.
      const applyRoute = routeAppliedUserRef.current !== userId;
      loadNavigation(userId).then(({ folders: folderRows, notes: noteRows, stale }) => {
        if (stale || sessionUserRef.current !== userId || !applyRoute) return;
        const route = pendingRouteRef.current ?? parseRoute(window.location.pathname);
        pendingRouteRef.current = null;
        routeAppliedUserRef.current = userId;
        startupFailedUserRef.current = null;
        const snapshot = readHistorySnapshot(window.history.state, userId);
        let selection: { folder: FolderSelection; noteId: string | null };
        let panel: MobilePanel = "folders";
        if (route.app === "notes" && (route.noteId || route.folder !== "all")) {
          const resolved = resolveNotesRoute(route, { folders: folderRows, notes: noteRows }, { snapshot, lastFolder: "all" });
          if (resolved.missing) flash(resolved.missing === "note" ? "Note not found" : "Folder not found");
          selection = resolved;
          panel = resolveNotesPanel(resolved, snapshot);
        } else {
          // Resume the last folder and note only when the URL does not name one.
          let remembered: { folder?: string; noteId?: string } = {};
          try { remembered = JSON.parse(localStorage.getItem(`mynotes:last:${userId}`) ?? "{}"); } catch { /* use defaults */ }
          const folder = remembered.folder;
          const restoredFolder = folder && (folder === "all" || folder === "shared" || folderRows.some((item) => item.id === folder)) ? folder : "all";
          const restoredNote = remembered.noteId ? noteRows.find((item) => item.id === remembered.noteId) : undefined;
          selection = { folder: restoredFolder, noteId: restoredNote && noteInFolder(restoredNote, restoredFolder) ? restoredNote.id : null };
          if (snapshot && snapshot.folder === selection.folder && snapshot.noteId === selection.noteId) panel = snapshot.panel === "editor" && !selection.noteId ? "notes" : snapshot.panel;
        }
        setSelectedFolder(selection.folder);
        setSelectedNoteId(selection.noteId);
        setSelectionOwner(userId);
        setMobilePanel(panel);
        setActiveApp(route.app);
        const target: Route = route.app === "notes" ? notesRoute(selection.folder, selection.noteId) : route;
        writeHistory(userId, target, panel, "replace");
      }).catch((reason) => {
        if (applyRoute && sessionUserRef.current === userId && routeAppliedUserRef.current !== userId) startupFailedUserRef.current = userId;
        flash(reason instanceof Error ? reason.message : "Could not open your notes");
      });
    }
  }, [flash, session, loadNavigation, startupRetry]);
  useEffect(() => {
    if (!session || selectionOwner !== session.user.id) return;
    localStorage.setItem(`mynotes:last:${session.user.id}`, JSON.stringify({ folder: selectedFolder, noteId: selectedNoteId }));
  }, [activeApp, selectedFolder, selectedNoteId, selectionOwner, session]);
  useEffect(() => {
    if (selectedNoteId) loadNote(selectedNoteId);
    else {
      noteLoadGenerationRef.current += 1;
      setNote(null);
    }
  }, [selectedNoteId, loadNote]);
  useEffect(() => {
    if (!sortOpen) return;
    const closeSort = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && event.target instanceof Element && event.target.closest(".sort-control")) return;
      setSortOpen(false);
    };
    window.addEventListener("click", closeSort);
    window.addEventListener("keydown", closeSort);
    return () => { window.removeEventListener("click", closeSort); window.removeEventListener("keydown", closeSort); };
  }, [sortOpen]);

  const saveDraft = useCallback(async () => {
    if (savingPromiseRef.current) await savingPromiseRef.current;
    if (!note?.isOwner || markdown === loadedRef.current) return note?.hasDelta ?? false;
    const noteId = note.id;
    const draftMarkdown = markdown;
    const revision = revisionRef.current;
    const task = (async () => {
      setSaveState("saving");
      const result = await api<{ revision: number; title: string; hasDelta: boolean }>(`/notes/${noteId}/draft`, {
        method: "PUT",
        body: JSON.stringify({ markdown: draftMarkdown, revision })
      });
      revisionRef.current = result.revision;
      loadedRef.current = draftMarkdown;
      setNote((current) => current?.id === noteId ? {
        ...current,
        title: result.title,
        markdown: draftMarkdown,
        hasDraft: true,
        hasDelta: result.hasDelta,
        draft_revision: result.revision
      } : current);
      setSaveState("saved");
      await loadNavigation();
      return result.hasDelta;
    })();
    savingPromiseRef.current = task;
    try {
      return await task;
    } catch (reason) {
      setSaveState(reason instanceof ApiError && reason.status === 409 ? "conflict" : "error");
      throw reason;
    } finally {
      if (savingPromiseRef.current === task) savingPromiseRef.current = null;
    }
  }, [loadNavigation, markdown, note]);

  useEffect(() => {
    if (!note?.isOwner || markdown === loadedRef.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => saveDraft().catch(() => undefined), 900);
    autosaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autosaveTimerRef.current === timer) autosaveTimerRef.current = null;
    };
  }, [markdown, note?.id, note?.isOwner, saveDraft]);

  const visibleNotes = useMemo(() => notes.filter((item) => {
    const inSection = selectedFolder === "all" ? true : selectedFolder === "shared" ? item.is_owner === 0 : item.folder_id === selectedFolder;
    return inSection && item.title.toLowerCase().includes(query.toLowerCase());
  }).sort((left, right) => {
    if (noteSort === "title-asc") return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
    if (noteSort === "title-desc") return right.title.localeCompare(left.title, undefined, { sensitivity: "base" });
    const field = noteSort.startsWith("created") ? "created_at" : "updated_at";
    const delta = new Date(left[field]).getTime() - new Date(right[field]).getTime();
    return noteSort.endsWith("desc") ? -delta : delta;
  }), [noteSort, notes, query, selectedFolder]);

  const hasPublishableDelta = Boolean(note?.isOwner && (note.hasDelta || markdown !== loadedRef.current));

  function cancelPendingAutosave() {
    if (autosaveTimerRef.current !== null) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }

  function navigate(route: Route, options: { replace?: boolean; panel?: MobilePanel } = {}) {
    if (!session) return;
    writeHistory(session.user.id, route, options.panel ?? mobilePanel, options.replace ? "replace" : "push");
    if (startupRouteState(session.user.id, routeAppliedUserRef.current, startupFailedUserRef.current) === "retry") retryStartup(route);
  }

  // The first load failed: reload the workspace data and apply this route once it arrives.
  function retryStartup(route: Route) {
    pendingRouteRef.current = route;
    startupFailedUserRef.current = null;
    setStartupRetry((attempt) => attempt + 1);
  }

  function currentNotesRoute(): NotesRoute {
    return notesRoute(selectedFolder, selectedNoteId);
  }

  function showMobilePanel(panel: MobilePanel, mode: "push" | "replace" = "push") {
    const current = session ? readHistorySnapshot(window.history.state, session.user.id) : null;
    if (panel === "editor" && current?.panel === "folders" && selectedNoteId) {
      navigate(currentNotesRoute(), { panel: "notes" });
    }
    setMobilePanel(panel);
    navigate(currentNotesRoute(), { panel, replace: mode === "replace" });
  }

  async function removeEmptyNewNote() {
    const unloadedNewNote = selectedNoteId !== null && selectedNoteId === newlyCreatedNoteIdRef.current;
    const emptyUnpublishedNote = note?.isOwner && note.current_version === 0;
    if ((!emptyUnpublishedNote && !unloadedNewNote) || markdown.trim() !== "") return false;
    cancelPendingAutosave();
    if (savingPromiseRef.current) await savingPromiseRef.current;
    const noteId = note?.id ?? selectedNoteId;
    if (!noteId) return false;
    await api(`/notes/${noteId}`, { method: "DELETE", body: "{}" });
    if (newlyCreatedNoteIdRef.current === noteId) newlyCreatedNoteIdRef.current = null;
    revisionRef.current = null;
    loadedRef.current = "";
    setNote(null);
    await loadNavigation();
    return true;
  }

  function finalizeCurrentNote(reloadCurrent = false) {
    return finalizeOpenNote({ removeEmptyNewNote, hasPublishableDelta, publish: () => publish(reloadCurrent) });
  }

  async function createFolder() {
    const name = window.prompt("Folder name");
    if (!name?.trim()) return;
    await api("/folders", { method: "POST", body: JSON.stringify({ name: name.trim(), parentId: null }) });
    await loadNavigation();
  }

  async function createNote() {
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      const finalized = await finalizeCurrentNote();
      const selected = folders.find((folder) => folder.id === selectedFolder);
      const folderId = selected?.is_owner === 1 ? selected.id : null;
      const { note: created } = await api<{ note: { id: string } }>("/notes", { method: "POST", body: JSON.stringify({ folderId }) });
      await loadNavigation();
      setSelectedNoteId(created.id);
      newlyCreatedNoteIdRef.current = created.id;
      setMobilePanel("editor");
      // A blank note that was just removed should not stay behind as a Back target.
      navigate(notesRoute(selectedFolder, created.id), { panel: "editor", replace: finalized === "removed-empty" });
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not create note");
    } finally {
      switchingRef.current = false;
    }
  }

  async function moveNote(noteId: string, folder: Folder) {
    await api(`/notes/${noteId}`, { method: "PATCH", body: JSON.stringify({ folderId: folder.id }) });
    setNote((current) => current?.id === noteId ? { ...current, folder_id: folder.id } : current);
    if (selectedNoteId === noteId) setSelectedFolder(folder.id);
    setDraggingNoteId(null);
    setDropFolderId(null);
    await loadNavigation();
    if (selectedNoteId === noteId) navigate(notesRoute(folder.id, noteId), { replace: true });
    flash(`Moved to ${folder.name}`);
  }

  async function deleteNote(noteId: string, title: string) {
    if (!window.confirm(`Delete “${title}”? This removes the note and its version history.`)) return;
    if (noteId === selectedNoteId) {
      cancelPendingAutosave();
      if (savingPromiseRef.current) await savingPromiseRef.current;
    }
    await api(`/notes/${noteId}`, { method: "DELETE", body: "{}" });
    if (noteId === selectedNoteId) {
      setSelectedNoteId(null);
      setNote(null);
      setMarkdown("");
      revisionRef.current = null;
      loadedRef.current = "";
      if (newlyCreatedNoteIdRef.current === noteId) newlyCreatedNoteIdRef.current = null;
      setMobilePanel("notes");
      navigate(notesRoute(selectedFolder, null), { panel: "notes", replace: true });
    }
    await loadNavigation();
    flash("Note deleted");
  }

  async function publish(reloadCurrent = true) {
    if (!note) return false;
    const hasDelta = await saveDraft();
    if (!hasDelta) return false;
    await api(`/notes/${note.id}/publish`, { method: "POST", body: "{}" });
    if (reloadCurrent) await Promise.all([loadNote(note.id), loadNavigation()]);
    else await loadNavigation();
    flash("New version published");
    return true;
  }

  async function selectNote(nextId: string) {
    if (nextId === selectedNoteId) {
      setMobilePanel("editor");
      navigate(notesRoute(selectedFolder, nextId), { panel: "editor" });
      return;
    }
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      const finalized = await finalizeCurrentNote();
      setSelectedNoteId(nextId);
      setMobilePanel("editor");
      navigate(notesRoute(selectedFolder, nextId), { panel: "editor", replace: finalized === "removed-empty" });
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not switch notes");
    } finally {
      switchingRef.current = false;
    }
  }

  async function selectFolder(nextFolder: FolderSelection) {
    if (nextFolder === selectedFolder) {
      // Same folder: only the phone panel changes; an open note stays open (and in the URL).
      setMobilePanel("notes");
      navigate(notesRoute(nextFolder, selectedNoteId), { panel: "notes" });
      return;
    }
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      const finalized = await finalizeCurrentNote();
      setSelectedFolder(nextFolder);
      setSelectedNoteId(null);
      setNote(null);
      setMarkdown("");
      revisionRef.current = null;
      loadedRef.current = "";
      setMobilePanel("notes");
      navigate(notesRoute(nextFolder, null), { panel: "notes", replace: finalized === "removed-empty" });
    } catch (reason) {
      flash(reason instanceof Error ? reason.message : "Could not switch folders");
    } finally {
      switchingRef.current = false;
    }
  }

  async function discard() {
    if (!note || !window.confirm("Discard this draft and return to the published version?")) return;
    const removesNote = note.current_version === 0;
    await api(`/notes/${note.id}/draft`, { method: "DELETE", body: "{}" });
    if (removesNote) {
      if (newlyCreatedNoteIdRef.current === note.id) newlyCreatedNoteIdRef.current = null;
      setSelectedNoteId(null);
      setNote(null);
      setMarkdown("");
      revisionRef.current = null;
      loadedRef.current = "";
      await loadNavigation();
      setMobilePanel("notes");
      navigate(notesRoute(selectedFolder, null), { panel: "notes", replace: true });
      flash("Unpublished note removed");
    } else {
      await Promise.all([loadNote(note.id), loadNavigation()]);
      flash("Draft discarded");
    }
  }

  // Applies a Notes URL reached through Back/Forward. The browser has already moved, so on failure
  // the entry is rewritten to the note that is still open.
  async function restoreNotesRoute(route: NotesRoute, snapshot: MobileNavigationSnapshot | null) {
    if (!session) return;
    if (switchingRef.current) {
      navigate(routeForApp(activeApp), { replace: true });
      return;
    }
    const resolved = resolveNotesRoute(route, { folders, notes }, { snapshot, lastFolder: selectedFolder });
    const targetPanel = resolveNotesPanel(resolved, snapshot);
    const selectionChanged = resolved.folder !== selectedFolder || resolved.noteId !== selectedNoteId;
    switchingRef.current = true;
    try {
      if (selectionChanged) {
        await finalizeCurrentNote();
        setSelectedFolder(resolved.folder);
        setSelectedNoteId(resolved.noteId);
        if (!resolved.noteId) {
          setNote(null);
          setMarkdown("");
          revisionRef.current = null;
          loadedRef.current = "";
        }
      }
      setMobilePanel(targetPanel);
      setActiveApp("notes");
      if (resolved.missing) flash(resolved.missing === "note" ? "Note not found" : "Folder not found");
      if (resolved.missing || formatRoute(notesRoute(resolved.folder, resolved.noteId)) !== window.location.pathname) {
        navigate(notesRoute(resolved.folder, resolved.noteId), { panel: targetPanel, replace: true });
      }
    } catch (reason) {
      flash(`${reason instanceof Error ? reason.message : "Could not save this note"}. Your note is still open.`);
      navigate(routeForApp(activeApp), { replace: true });
    } finally {
      switchingRef.current = false;
    }
  }

  function routeForApp(section: AppSection): Route {
    if (section === "notes") return currentNotesRoute();
    if (section === "files") return { app: "files", folder: "all", documentId: null };
    return { app: section };
  }

  async function leaveNotes() {
    if (switchingRef.current) return false;
    switchingRef.current = true;
    // Lock the editor so keystrokes cannot land between the save and the post-publish reload.
    setLeavingNotes(true);
    try {
      // The note stays selected for when Notes reopens, so a published note is reloaded to clear its draft state.
      if (await finalizeCurrentNote(true) === "removed-empty") {
        setSelectedNoteId(null);
        setMarkdown("");
      }
      setPanel(null);
      setSharingFolder(null);
      setMobileActions(false);
      return true;
    } catch (reason) {
      flash(`${reason instanceof Error ? reason.message : "Could not save this note"}. Your note is still open.`);
      return false;
    } finally {
      switchingRef.current = false;
      setLeavingNotes(false);
    }
  }

  async function openApp(section: AppSection) {
    if (!session || section === activeApp) return;
    if (activeApp === "notes" && !await leaveNotes()) return;
    if (section === "notes") {
      setMobilePanel("folders");
      navigate(currentNotesRoute(), { panel: "folders" });
    } else {
      navigate(routeForApp(section));
    }
    setActiveApp(section);
  }

  function openHome() {
    return openApp("home");
  }

  async function leaveNotesFromHistory(route: Route) {
    if (!session) return;
    if (await leaveNotes()) {
      setActiveApp(route.app);
      if (formatRoute(route) !== window.location.pathname) navigate(route, { replace: true });
      return;
    }
    // Browser Back already moved off the note; rewrite this entry so the URL matches the open note.
    navigate(currentNotesRoute(), { replace: true });
  }

  function mobileBack(fallback: MobilePanel) {
    // Only step back through entries this visit pushed, so the in-app Back never leaves MyNotes.
    if (session && isMobileViewport() && readHistoryDepth(window.history.state) > 0 && readHistorySnapshot(window.history.state, session.user.id)) {
      window.history.back();
      return;
    }
    showMobilePanel(fallback, "replace");
  }

  // Re-registered every render so the handler never finalizes a note from a stale editor snapshot.
  useEffect(() => {
    if (!session) return;
    const onPopState = (event: PopStateEvent) => {
      const route = parseRoute(window.location.pathname);
      if (session.totp.setupRequired) return;
      const startup = startupRouteState(session.user.id, routeAppliedUserRef.current, startupFailedUserRef.current);
      if (startup === "retry") {
        retryStartup(route);
        return;
      }
      if (startup === "loading") {
        // The workspace is still loading; apply the newest URL once it is ready.
        pendingRouteRef.current = route;
        return;
      }
      if (route.app !== "notes") {
        if (activeApp === "notes") {
          void leaveNotesFromHistory(route);
          return;
        }
        setActiveApp(route.app);
        if (formatRoute(route) !== window.location.pathname) navigate(route, { replace: true });
        return;
      }
      void restoreNotesRoute(route, readHistorySnapshot(event.state, session.user.id));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  });

  function openSettings() {
    setPanel(null);
    setSharingFolder(null);
    setSettingsOpen(true);
  }

  function signOut() {
    logout().catch((reason) => flash(reason instanceof Error ? reason.message : "Could not sign out"));
  }

  async function logout() {
    await api("/auth/logout", { method: "POST", body: "{}" });
    sessionUserRef.current = null;
    noteLoadGenerationRef.current += 1;
    setCsrfToken("");
    cancelPendingAutosave();
    setSelectedFolder("all");
    setSelectedNoteId(null);
    setNote(null);
    setMarkdown("");
    setFolders([]);
    setNotes([]);
    setSelectionOwner(null);
    revisionRef.current = null;
    loadedRef.current = "";
    newlyCreatedNoteIdRef.current = null;
    routeAppliedUserRef.current = null;
    startupFailedUserRef.current = null;
    pendingRouteRef.current = { app: "home" };
    window.history.replaceState(null, "", "/");
    setActiveApp("home");
    setSession(null);
  }

  if (checking) return <main className="loading-page"><div className="brand-mark"><Sparkles /></div><span>Opening MyNotes…</span></main>;
  if (!session) return <AuthScreen onAuthenticated={(result) => {
    sessionUserRef.current = result.user.id;
    noteLoadGenerationRef.current += 1;
    cancelPendingAutosave();
    setSelectedFolder("all");
    setSelectedNoteId(null);
    setNote(null);
    setMarkdown("");
    setFolders([]);
    setNotes([]);
    setSelectionOwner(null);
    revisionRef.current = null;
    loadedRef.current = "";
    newlyCreatedNoteIdRef.current = null;
    routeAppliedUserRef.current = null;
    // Land on the URL that was requested before signing in (kept in memory only).
    setActiveApp((pendingRouteRef.current ?? parseRoute(window.location.pathname)).app);
    setSession(result);
    setChecking(false);
  }} />;

  const settingsDialog = settingsOpen && <SettingsDialog session={session} onClose={() => { if (!session.totp.setupRequired) setSettingsOpen(false); }} onSecurityChanged={(totp) => {
    setSession((current) => current ? { ...current, totp } : current);
    if (!totp.setupRequired) setSettingsOpen(false);
  }} />;
  const toastStatus = toast && <div className="toast" role="status">{toast}</div>;
  const account = { displayName: session.user.displayName, onSettings: openSettings, onSignOut: signOut };

  if (activeApp !== "notes" && !session.totp.setupRequired) return <>
    {activeApp === "home" ? <AppHome {...account} onOpen={openApp} /> : <AppPlaceholder {...account} section={activeApp} onHome={() => { void openHome(); }} onOpenNotes={() => openApp("notes")} />}
    {settingsDialog}
    {settingsOpen && <button className="panel-scrim" onClick={() => setSettingsOpen(false)} aria-label="Close panel" />}
    {toastStatus}
  </>;

  return (
    <main className={`workspace ${collapsed ? "nav-collapsed" : ""}`} data-mobile-panel={mobilePanel}>
      <aside className="folder-pane" id="note-folders">
        <header className="sidebar-header">
          <button className="sidebar-brand sidebar-home-button" onClick={() => { void openHome(); }} aria-label="Open MyNotes home"><span className="brand-dot"><Sparkles /></span><strong>MyNotes</strong></button>
          <button className="icon-button desktop-only" onClick={() => setCollapsed(true)} aria-label="Collapse folders sidebar" aria-controls="note-folders" aria-expanded={!collapsed} title="Collapse folders"><PanelLeftClose /></button>
        </header>
        <nav className="folder-nav" aria-label="Note folders">
          <button className={selectedFolder === "all" ? "active" : ""} onClick={() => { void selectFolder("all"); }}><Archive /><span>All notes</span><b>{notes.length}</b></button>
          <button className={selectedFolder === "shared" ? "active" : ""} onClick={() => { void selectFolder("shared"); }}><Users /><span>Shared with me</span><b>{notes.filter((item) => item.is_owner === 0).length}</b></button>
          <div className="nav-label"><span>Folders</span><button onClick={createFolder} aria-label="New folder"><FolderPlus /></button></div>
          {folders.map((folder) => <div className="folder-entry" key={folder.id}>
            <button
              className={`folder-link${selectedFolder === folder.id ? " active" : ""}${dropFolderId === folder.id ? " drop-target" : ""}`}
              onClick={() => { void selectFolder(folder.id); }}
              onDragEnter={(event) => { if (draggingNoteId && folder.is_owner === 1) { event.preventDefault(); setDropFolderId(folder.id); } }}
              onDragOver={(event) => { if (draggingNoteId && folder.is_owner === 1) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderId((current) => current === folder.id ? null : current); }}
              onDrop={(event) => {
                event.preventDefault();
                if (folder.is_owner !== 1) return;
                const noteId = event.dataTransfer.getData("application/x-mynotes-note") || draggingNoteId;
                if (noteId) moveNote(noteId, folder).catch((reason) => flash(reason instanceof Error ? reason.message : "Could not move note"));
              }}
            >
              <FolderIcon />
              <span className="folder-copy">{folder.name}{folder.is_owner !== 1 && <small>{folder.owner_name}</small>}</span>
              <b>{notes.filter((item) => item.folder_id === folder.id).length}</b>
            </button>
            {folder.is_owner === 1 && <button className="folder-share-button" onClick={() => setSharingFolder(folder)} aria-label={`Share ${folder.name}`}><Share2 /></button>}
          </div>)}
          {!folders.length && <p className="nav-empty">Create a folder to organize your notes.</p>}
        </nav>
        <footer className="sidebar-footer">
          <button className="footer-settings" title={session.user.displayName} onClick={openSettings} aria-haspopup="dialog" aria-controls="account-settings-dialog" aria-label={`Open settings for ${session.user.displayName}`}>
            <strong>{session.user.displayName}</strong>
            <span><Settings />Settings</span>
          </button>
          <button className="footer-signout" onClick={signOut}><LogOut />Sign out</button>
        </footer>
      </aside>

      <section className="note-pane">
        <header className="note-pane-header">
          <button className="icon-button collapsed-trigger collapsed-sidebar-toggle" onClick={() => setCollapsed(false)} aria-label="Open folders sidebar" aria-controls="note-folders" aria-expanded={!collapsed} title="Open folders"><PanelLeftOpen /><span>Folders</span></button>
          <div className="mobile-header"><button className="icon-button" onClick={() => mobileBack("folders")} aria-label="Back to folders"><ChevronLeft /></button><strong>Notes</strong></div>
          <div className="note-heading"><span className="eyebrow">{selectedFolder === "shared" ? "Shared" : "Library"}</span><h1>{selectedFolder === "all" ? "All notes" : selectedFolder === "shared" ? "Shared with me" : folders.find((folder) => folder.id === selectedFolder)?.name}</h1></div>
          <div className="note-header-actions">
            <div className="sort-control">
              <button className="icon-button" onClick={() => setSortOpen((open) => !open)} aria-label="Sort notes" aria-expanded={sortOpen}><ArrowUpDown /></button>
              {sortOpen && <div className="sort-menu" role="menu" aria-label="Sort notes">
                {noteSortOptions.map((option) => <button key={option.value} className={noteSort === option.value ? "active" : ""} onClick={() => { setNoteSort(option.value); setSortOpen(false); }} role="menuitem"><span>{option.label}</span>{noteSort === option.value && <Check />}</button>)}
              </div>}
            </div>
            <button className="icon-button new-note-button" onClick={createNote} aria-label="New note"><FilePlus2 /></button>
          </div>
          <label className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" /></label>
        </header>
        <div className="note-list">
          {visibleNotes.map((item) => <article
            key={item.id}
            className={`note-card${selectedNoteId === item.id ? " selected" : ""}${draggingNoteId === item.id ? " dragging" : ""}`}
            draggable={item.is_owner === 1}
            onDragStart={(event) => {
              if (item.is_owner !== 1) return;
              setDraggingNoteId(item.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-mynotes-note", item.id);
              event.dataTransfer.setData("text/plain", item.id);
            }}
            onDragEnd={() => { setDraggingNoteId(null); setDropFolderId(null); }}
          >
            <button className="note-card-select" onClick={() => { void selectNote(item.id); }}>
              <span className="note-title">{item.title}</span>
              <span className="note-meta"><time>{relativeTime(item.updated_at)}</time>{item.draft_revision !== null && item.is_owner === 1 ? <em>Draft</em> : item.visibility !== "private" ? <em><Users /> Shared</em> : null}</span>
              {item.is_owner === 0 && <span className="note-owner">by {item.owner_name}</span>}
            </button>
            {item.is_owner === 1 && <button className="note-delete-button" disabled={leavingNotes} onClick={() => { void deleteNote(item.id, item.title).catch((reason) => flash(reason instanceof Error ? reason.message : "Could not delete note")); }} aria-label={`Delete ${item.title}`} title="Delete note"><Trash2 /></button>}
          </article>)}
          {!visibleNotes.length && <div className="empty-state"><div><FilePlus2 /></div><h2>No notes here</h2><p>{query ? "Try another search." : selectedFolder === "shared" ? "Notes shared with you will appear here." : "Create a note and start writing."}</p>{!query && selectedFolder !== "shared" && <button onClick={createNote}>New note</button>}</div>}
        </div>
      </section>

      <section className="editor-pane">
        {!note ? <div className="editor-empty"><div className="empty-glyph"><Sparkles /></div><h2>Select a note</h2><p>Choose one from the list or create something new.</p></div> : <>
          <header className="editor-toolbar">
            <div className="mobile-editor-nav"><button className="icon-button" onClick={() => mobileBack("notes")} aria-label="Back to notes"><ChevronLeft /></button></div>
            <div className={`save-indicator ${saveState}`}><span />{saveState === "saving" ? "Saving…" : saveState === "conflict" ? "Save conflict" : saveState === "error" ? "Not saved" : note.hasDraft ? "Draft saved" : `Version ${note.current_version}`}</div>
            <div className="toolbar-actions">
              <button className="icon-button" onClick={() => setPanel("history")} aria-label="Version history"><History /></button>
              {note.isOwner && <button className="icon-button" onClick={() => setPanel("share")} aria-label="Share note"><Share2 /></button>}
              {note.isOwner && note.hasDraft && <button className="text-action" disabled={leavingNotes} onClick={discard}>Discard</button>}
              {hasPublishableDelta && <button className="publish-button" disabled={leavingNotes} onClick={() => { void publish(); }}>Publish version</button>}
              <button className="icon-button mobile-more" disabled={leavingNotes} onClick={() => setMobileActions((open) => !open)} aria-label="More actions"><MoreHorizontal /></button>
            </div>
            {mobileActions && <div className="mobile-actions-menu">
              <button onClick={() => { setPanel("history"); setMobileActions(false); }}><History />Version history</button>
              {note.isOwner && <button onClick={() => { setPanel("share"); setMobileActions(false); }}><Share2 />Share note</button>}
              {note.isOwner && note.hasDraft && <button disabled={leavingNotes} onClick={() => { setMobileActions(false); discard(); }}><X />Discard draft</button>}
              {hasPublishableDelta && <button disabled={leavingNotes} onClick={() => { setMobileActions(false); void publish(); }}><Sparkles />Publish version</button>}
            </div>}
          </header>
          <article className="document-shell">
            <div className="document-meta"><span>{note.isOwner ? "Private workspace" : `Shared by ${note.owner_name}`}</span><i /> <span>{markdown.trim().split(/\s+/).filter(Boolean).length} words</span></div>
            <NoteEditor key={note.id} markdown={markdown} editable={note.isOwner && !leavingNotes} onChange={setMarkdown} />
          </article>
        </>}
      </section>

      {panel === "history" && note && <HistoryPanel note={note} onClose={() => setPanel(null)} onRestored={async () => { setPanel(null); await loadNote(note.id); await loadNavigation(); flash("Version restored as a draft"); }} />}
      {panel === "share" && note && <SharePanel note={note} onClose={() => setPanel(null)} onChanged={async () => { setPanel(null); await loadNote(note.id); await loadNavigation(); flash("Sharing updated"); }} />}
      {sharingFolder && <FolderSharePanel folder={sharingFolder} onClose={() => setSharingFolder(null)} onChanged={async () => { setSharingFolder(null); await loadNavigation(); flash("Folder sharing updated"); }} />}
      {settingsDialog}
      {(panel || sharingFolder || settingsOpen) && (settingsOpen && session.totp.setupRequired
        ? <div className="panel-scrim" aria-hidden="true" />
        : <button className="panel-scrim" onClick={() => { setPanel(null); setSharingFolder(null); setSettingsOpen(false); }} aria-label="Close panel" />)}
      {toastStatus}
      <nav className="mobile-tabbar">
        <button className={mobilePanel === "folders" ? "active" : ""} onClick={() => showMobilePanel("folders")}><Menu />Folders</button>
        <button className={mobilePanel === "notes" ? "active" : ""} onClick={() => showMobilePanel("notes")}><Archive />Notes</button>
        <button className={mobilePanel === "editor" ? "active" : ""} disabled={!note} onClick={() => showMobilePanel("editor")}><Sparkles />Editor</button>
      </nav>
    </main>
  );
}
