import type { OhMyCopilotConfig } from './types';
export declare function loadConfig(cwd?: string): OhMyCopilotConfig;
export declare function writeConfig(config: OhMyCopilotConfig, targetDir?: string): string;
export declare function getGlobalConfigDir(): string;
export declare function ensureGlobalConfigDir(): void;
