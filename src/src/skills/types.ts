export type SkillSource = 'bundled' | 'project' | 'project-local' | 'global';

export interface SkillMetadata {
  description?: string;
  preferredAgent?: string;
  recommendedMcpServers?: string[];
  recommendedTools?: string[];
  tags?: string[];
}

export interface SkillDefinition extends SkillMetadata {
  name: string;
  source: SkillSource;
  systemPrompt: string;
  filePath?: string;
}

export interface SkillStateFile {
  pinned?: string[];
}
