// Evidencia de checkouts REALES de Reap (no simulados). Se guarda en disco para sobrevivir reinicios del servidor.
import "server-only";
import fs from "fs";
import path from "path";

export interface Evidence {
  subId: string; merchant: string; orderId: string; checkoutId: string; enrollmentId?: string;
  status: "COMPLETED"; finalAmount: number; currency: string; at: string;
}

const FILE = path.join(process.cwd(), "data", "evidence.json");

export function readEvidence(): Evidence[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return []; }
}

export function addEvidence(e: Evidence) {
  const all = readEvidence().filter((x) => x.checkoutId !== e.checkoutId);
  all.unshift(e);
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(all, null, 2)); } catch { /* solo evidencia */ }
}
