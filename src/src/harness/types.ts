export type HarnessPattern =
  | 'producer-reviewer'
  | 'fan-out-fan-in'
  | 'supervisor'
  | 'pipeline'
  | 'hierarchical-delegation';

export interface HarnessGeneratedAgent {
  name: string;
  role: string;
  filePath: string;
}

export interface HarnessGeneratedSkill {
  name: string;
  filePath: string;
}

export interface HarnessTeam {
  name: string;
  pattern: HarnessPattern;
  summary: string;
  recommendedExecutor: string;
  generatedAt: string;
  generationMode?: 'model-assisted' | 'deterministic-fallback';
  modelUsed?: string;
  generationWarning?: string;
  agents: HarnessGeneratedAgent[];
  skills: HarnessGeneratedSkill[];
}
