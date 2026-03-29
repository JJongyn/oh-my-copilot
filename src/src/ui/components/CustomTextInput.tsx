import React from 'react';
import { Text, useInput } from 'ink';

interface CustomTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onTab?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
}

export function removeLastCodePoint(value: string): string {
  const chars = [...value];
  chars.pop();
  return chars.join('');
}

export function CustomTextInput({
  value,
  onChange,
  onSubmit,
  onTab,
  placeholder,
  focus = true,
}: CustomTextInputProps) {
  useInput((input, key) => {
    if (!focus) return;

    if (key.return) {
      onSubmit?.(value);
      return;
    }

    if (key.tab) {
      onTab?.(value);
      return;
    }

    if (key.backspace || key.delete) {
      if (value.length > 0) {
        onChange(removeLastCodePoint(value));
      }
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }

    if (input) {
      onChange(value + input);
    }
  }, { isActive: focus });

  if (!value) {
    return <Text color="gray" dimColor>{placeholder ?? ''}</Text>;
  }

  return <Text>{value}</Text>;
}
