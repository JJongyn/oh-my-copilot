import React from 'react';
import { SelectList, type SelectItem } from './SelectList';
import { loadSkills } from '../../skills/skill-loader';
import type { SkillSource } from '../../skills/types';

interface SkillPickerProps {
  activeSkills: string[];
  onToggle: (skillName: string) => void;
  onCancel: () => void;
  width?: number;
}

const SOURCE_BADGE: Record<SkillSource, string> = {
  bundled: 'bundled',
  project: '.omc',
  'project-local': '.omc local',
  global: 'global',
};

export function SkillPicker({ activeSkills, onToggle, onCancel, width = 70 }: SkillPickerProps) {
  const skills = loadSkills(process.cwd());
  const active = new Set(activeSkills);

  const items: SelectItem[] = skills.map(skill => ({
    id: skill.name,
    label: skill.name,
    description: skill.description,
    badge: active.has(skill.name)
      ? '* active'
      : SOURCE_BADGE[skill.source],
  }));

  return (
    <SelectList
      items={items}
      onSelect={(item) => onToggle(item.id)}
      onCancel={onCancel}
      title={`Skills (${skills.length}) — Enter toggles current session`}
      maxVisible={12}
      width={width}
    />
  );
}
