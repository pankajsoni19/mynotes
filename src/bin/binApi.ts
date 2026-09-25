import { api } from "../api";
import type { BinItem, BinRestoreResult } from "../types";

const itemPath = (item: Pick<BinItem, "type" | "id">) => `/bin/${item.type}/${encodeURIComponent(item.id)}`;

export const listBin = () => api<{ items: BinItem[] }>("/bin");
export const restoreBinItem = (item: Pick<BinItem, "type" | "id">) => api<BinRestoreResult>(`${itemPath(item)}/restore`, { method: "POST", body: "{}" });
export const deleteBinItem = (item: Pick<BinItem, "type" | "id">) => api<{ ok: true; pending?: true }>(itemPath(item), { method: "DELETE", body: "{}" });
export const emptyBin = () => api<{ ok: true; purged: number; pending: number }>("/bin", { method: "DELETE", body: "{}" });
