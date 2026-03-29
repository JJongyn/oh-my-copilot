import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
  models: string[];
}

export const BRIDGE_DIR = path.join(os.homedir(), '.oh-my-copilot');
export const BRIDGE_INFO_PATH = path.join(BRIDGE_DIR, 'bridge.json');

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function writeBridgeInfo(info: BridgeInfo): void {
  if (!fs.existsSync(BRIDGE_DIR)) {
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });
  }
  fs.writeFileSync(BRIDGE_INFO_PATH, JSON.stringify(info, null, 2), { mode: 0o600 });
}

export function clearBridgeInfo(): void {
  try {
    if (fs.existsSync(BRIDGE_INFO_PATH)) {
      fs.unlinkSync(BRIDGE_INFO_PATH);
    }
  } catch {
    // ignore
  }
}

export function readBridgeInfo(): BridgeInfo | null {
  try {
    if (!fs.existsSync(BRIDGE_INFO_PATH)) return null;
    return JSON.parse(fs.readFileSync(BRIDGE_INFO_PATH, 'utf-8'));
  } catch {
    return null;
  }
}
