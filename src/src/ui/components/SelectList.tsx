/**
 * Reusable keyboard-navigable select list.
 * Used by command palette, model picker, agent picker, session picker.
 */
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

export interface SelectItem {
  id: string;
  label: string;
  sublabel?: string;
  description?: string;
  badge?: string;
  separator?: boolean;
}

interface SelectListProps {
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  onCancel: () => void;
  title?: string;
  maxVisible?: number;
  width?: number;
  filterQuery?: string;
}

export function SelectList({
  items,
  onSelect,
  onCancel,
  title,
  maxVisible = 8,
  width = 60,
  filterQuery = '',
}: SelectListProps) {
  const [index, setIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const filtered = filterQuery
    ? items.filter(
        (item) =>
          item.separator ||
          item.label.toLowerCase().includes(filterQuery.toLowerCase()) ||
          item.description?.toLowerCase().includes(filterQuery.toLowerCase()),
      )
    : items;

  const total = filtered.length;
  const visible = filtered.slice(scrollOffset, scrollOffset + maxVisible);

  useEffect(() => {
    if (index < scrollOffset) {
      setScrollOffset(index);
    } else if (index >= scrollOffset + maxVisible) {
      setScrollOffset(index - maxVisible + 1);
    }
  }, [index, maxVisible, scrollOffset]);

  useEffect(() => {
    let start = 0;
    while (filtered[start]?.separator && start < filtered.length - 1) start++;
    setIndex(start);
    setScrollOffset(0);
  }, [filterQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input: string, key: import('ink').Key) => {
    if (key.upArrow) {
      setIndex((i) => {
        let next = i > 0 ? i - 1 : total - 1;
        let guard = 0;
        while (filtered[next]?.separator && guard++ < total) {
          next = next > 0 ? next - 1 : total - 1;
        }
        return next;
      });
    } else if (key.downArrow) {
      setIndex((i) => {
        let next = i < total - 1 ? i + 1 : 0;
        let guard = 0;
        while (filtered[next]?.separator && guard++ < total) {
          next = next < total - 1 ? next + 1 : 0;
        }
        return next;
      });
    } else if (key.return) {
      if (filtered[index] && !filtered[index].separator) onSelect(filtered[index]);
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel();
    }
  });

  if (total === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="gray"
        width={width}
        paddingX={1}
      >
        {title && <Text bold color="cyan">{title}</Text>}
        <Text color="gray" dimColor>  No matches</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      width={width}
    >
      {title && (
        <Box paddingX={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
          <Text bold color="cyan">{title}</Text>
          <Box flexGrow={1} />
          <Text color="gray" dimColor>up/down Enter Esc</Text>
        </Box>
      )}

      {visible.map((item, i) => {
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === index;

        if (item.separator) {
          return (
            <Box key={item.id} paddingX={1}>
              <Text color="gray" dimColor>{'─'.repeat(Math.max(4, width - 4))}</Text>
            </Box>
          );
        }

        return (
          <Box key={item.id} paddingX={1} gap={1}>
            <Text color={isSelected ? 'cyan' : 'gray'}>
              {isSelected ? '>' : ' '}
            </Text>
            <Box flexDirection="column" flexGrow={1}>
              <Box gap={1}>
                <Text
                  bold={isSelected}
                  color={isSelected ? 'white' : 'white'}
                  dimColor={!isSelected}
                >
                  {item.label}
                </Text>
                {item.badge && (
                  <Text color={item.badge.includes('active') ? 'green' : 'yellow'} dimColor>
                    {item.badge}
                  </Text>
                )}
              </Box>
              {item.description && (
                <Text color="gray" dimColor wrap="wrap">
                  {item.description.slice(0, width - 6)}
                </Text>
              )}
            </Box>
          </Box>
        );
      })}

      {total > maxVisible && (
        <Box paddingX={2} justifyContent="center">
          <Text color="gray" dimColor>
            {scrollOffset + 1}-{Math.min(scrollOffset + maxVisible, total)} of {total}
          </Text>
        </Box>
      )}
    </Box>
  );
}
