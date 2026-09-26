import { keyScopeChips } from "./mcpPermissions";

/** The permission chips of one MCP key in Settings; scopes the key cannot use right now show as inactive. */
export function McpKeyScopeChips({ name, scopes, effectiveScopes }: { name: string; scopes: readonly string[]; effectiveScopes?: readonly string[] }) {
  return <ul className="scope-chips" aria-label={`Permissions for ${name}`}>{keyScopeChips(scopes, effectiveScopes).map((chip) =>
    <li key={chip.scope} className={chip.active ? undefined : "inactive"}>{chip.label}</li>)}</ul>;
}
