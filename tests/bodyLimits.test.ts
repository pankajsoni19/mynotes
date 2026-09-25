import { describe, expect, test } from "bun:test";
import { createUser, origin, request, serverOptions } from "./support/harness";

const { createMcpApiKey } = await import("../server/mcp");
const JSON_LIMIT = 2_100_000;

/** A request body stream with no Content-Length, so Bun sends it chunked. */
function chunkedBody(prefix: string, totalBytes: number) {
  const head = new TextEncoder().encode(prefix);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === 0) {
        controller.enqueue(head);
        sent = head.byteLength;
        return;
      }
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(65_536, totalBytes - sent);
      controller.enqueue(new Uint8Array(size).fill(0x20));
      sent += size;
    }
  });
}

describe("bounded JSON and MCP request bodies", () => {
  test("Bun's transport cap is above the JSON limit in this run", () => {
    expect(serverOptions.maxRequestBodySize).toBeGreaterThan(JSON_LIMIT + 500_000);
  });

  test("a chunked JSON body within the limit is accepted", async () => {
    const owner = await createUser("Body limit owner");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;
    const response = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: chunkedBody(JSON.stringify({ markdown: "streamed", revision: 1 }), 2_000_000),
      duplex: "half"
    } as RequestInit, owner);
    expect(response.status).toBe(200);
  });

  test("a chunked JSON body over 2.1 MB is rejected by the bounded reader", async () => {
    const owner = await createUser("Body limit JSON");
    const created = await request("/notes", { method: "POST", body: JSON.stringify({ folderId: null }) }, owner);
    const noteId = ((await created.json()) as { note: { id: string } }).note.id;
    const body = chunkedBody(JSON.stringify({ markdown: "x", revision: 1 }), 2_300_000);
    const response = await request(`/notes/${noteId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half"
    } as RequestInit, owner);
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Request is too large" });
  });

  test("a chunked MCP body over 2.1 MB is rejected by the bounded reader", async () => {
    const owner = await createUser("Body limit MCP");
    const key = createMcpApiKey(owner.userId, "Body limit");
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: chunkedBody(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), 2_300_000),
      duplex: "half"
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request is too large" });
  });

  test("a chunked MCP body within the limit still reaches the MCP handler", async () => {
    const owner = await createUser("Body limit MCP ok");
    const key = createMcpApiKey(owner.userId, "Body limit ok");
    const response = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      body: chunkedBody(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }), 100_000),
      duplex: "half"
    } as RequestInit);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("\"nook\"");
  });
});
