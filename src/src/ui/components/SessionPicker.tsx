/**
 * Session picker — browse, search, delete, and manage sessions.
 * Enhanced with bulk delete, search, session stats, and keyboard shortcuts.
 */
import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { SessionMeta } from '../../session/session-manager';

interface SessionPickerProps {
  sessions: SessionMeta[];
  currentSessionId: string;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onDeleteAll: () => void;
  onSearch: (query: string) => SessionMeta[];
  onCancel: () => void;
  width?: number;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatSize(messages: number): string {
  if (messages === 0) return 'empty';
  return `${messages} msg${messages > 1 ? 's' : ''}`;
}

type PickerMode = 'browse' | 'search' | 'confirm-delete' | 'confirm-delete-all';

export function SessionPicker({
  sessions: initialSessions,
  currentSessionId,
  onSelect,
  onDelete,
  onDeleteAll,
  onSearch,
  onCancel,
  width = 70,
}: SessionPickerProps) {
  const [index, setIndex] = useState(0);
  const [pickerMode, setPickerMode] = useState<PickerMode>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [sessions, setSessions] = useState(initialSessions);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const maxVisible = 10;

  const indexRef = useRef(0);
  const sessionsRef = useRef(sessions);
  const pickerModeRef = useRef<PickerMode>('browse');
  const searchQueryRef = useRef('');
  const deleteTargetRef = useRef<string | null>(null);
  indexRef.current = index;
  sessionsRef.current = sessions;
  pickerModeRef.current = pickerMode;
  searchQueryRef.current = searchQuery;
  deleteTargetRef.current = deleteTargetId;

  const clampedIndex = Math.min(index, Math.max(0, sessions.length - 1));

  useInput((input, key) => {
    const curMode = pickerModeRef.current;
    const curSessions = sessionsRef.current;
    const curIndex = Math.min(indexRef.current, Math.max(0, curSessions.length - 1));

    // ─── Search mode ─────────────────────────────────────────────────
    if (curMode === 'search') {
      if (key.escape) {
        setPickerMode('browse');
        setSearchQuery('');
        setSessions(initialSessions);
        return;
      }
      if (key.return) {
        const s = curSessions[curIndex];
        if (s) onSelect(s.id);
        return;
      }
      if (key.backspace || key.delete) {
        const newQ = searchQueryRef.current.slice(0, -1);
        setSearchQuery(newQ);
        if (newQ) {
          setSessions(onSearch(newQ));
        } else {
          setSessions(initialSessions);
          setPickerMode('browse');
        }
        setIndex(0);
        return;
      }
      if (key.upArrow) { setIndex(i => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setIndex(i => Math.min(curSessions.length - 1, i + 1)); return; }
      if (input && !key.ctrl && !key.meta) {
        const newQ = searchQueryRef.current + input;
        setSearchQuery(newQ);
        setSessions(onSearch(newQ));
        setIndex(0);
      }
      return;
    }

    // ─── Confirm delete single ───────────────────────────────────────
    if (curMode === 'confirm-delete') {
      if (input === 'y' || input === 'Y' || key.return) {
        const target = deleteTargetRef.current;
        if (target) {
          onDelete(target);
          const updated = curSessions.filter(s => s.id !== target);
          setSessions(updated);
          setIndex(i => Math.min(i, Math.max(0, updated.length - 1)));
        }
        setPickerMode('browse');
        setDeleteTargetId(null);
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setPickerMode('browse');
        setDeleteTargetId(null);
        return;
      }
      return;
    }

    // ─── Confirm delete all ──────────────────────────────────────────
    if (curMode === 'confirm-delete-all') {
      if (input === 'y' || input === 'Y') {
        onDeleteAll();
        setSessions([]);
        setPickerMode('browse');
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setPickerMode('browse');
        return;
      }
      return;
    }

    // ─── Browse mode ─────────────────────────────────────────────────
    if (key.escape) { onCancel(); return; }
    if (key.upArrow) { setIndex(i => Math.max(0, i - 1)); return; }
    if (key.downArrow) { setIndex(i => Math.min(curSessions.length - 1, i + 1)); return; }
    if (key.return) {
      const s = curSessions[curIndex];
      if (s) onSelect(s.id);
      return;
    }

    // Keyboard shortcuts
    if (input === '/' || input === 's' || input === 'S') {
      setPickerMode('search');
      setSearchQuery('');
      return;
    }
    if (input === 'd' || input === 'D') {
      const s = curSessions[curIndex];
      if (s && s.id !== currentSessionId) {
        setDeleteTargetId(s.id);
        setPickerMode('confirm-delete');
      }
      return;
    }
    if (input === 'x' || input === 'X') {
      if (curSessions.length > 1) {
        setPickerMode('confirm-delete-all');
      }
      return;
    }
  });

  // ─── Empty state ─────────────────────────────────────────────────────────
  if (sessions.length === 0 && pickerMode !== 'search') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="gray" width={width} paddingX={1} paddingY={1}>
        <Text bold color="cyan">Sessions</Text>
        <Text color="gray" dimColor>  {searchQuery ? 'No sessions match your search' : 'No sessions yet'}</Text>
        <Text> </Text>
        <Text color="gray" dimColor>  Esc to close</Text>
      </Box>
    );
  }

  const scrollOffset = Math.max(0, clampedIndex - Math.floor(maxVisible / 2));
  const visible = sessions.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" width={width}>
      {/* Header */}
      <Box paddingX={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor="gray">
        <Text bold color="cyan">Sessions</Text>
        <Text color="gray" dimColor>  {sessions.length} total</Text>
        <Box flexGrow={1} />
        {pickerMode === 'search' ? (
          <Text color="yellow">/{searchQuery}<Text color="gray">|</Text></Text>
        ) : (
          <Text color="gray" dimColor>/ search  d del  x clear  Esc close</Text>
        )}
      </Box>

      {/* Confirmation dialogs */}
      {pickerMode === 'confirm-delete' && (
        <Box paddingX={2}>
          <Text color="red" bold>Delete this session? </Text>
          <Text color="yellow" bold>y</Text><Text color="gray">/</Text>
          <Text color="yellow" bold>n</Text>
        </Box>
      )}
      {pickerMode === 'confirm-delete-all' && (
        <Box paddingX={2}>
          <Text color="red" bold>Delete ALL sessions (except current)? </Text>
          <Text color="yellow" bold>y</Text><Text color="gray">/</Text>
          <Text color="yellow" bold>n</Text>
        </Box>
      )}

      {/* Session list */}
      {visible.map((s, i) => {
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === clampedIndex;
        const isCurrent = s.id === currentSessionId;
        const isDeleteTarget = s.id === deleteTargetId;
        const preview = s.title ?? '(new session)';
        const date = formatDate(s.updatedAt);
        const isDone = s.completed;

        return (
          <Box key={s.id} paddingX={1} gap={1}>
            <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '>' : ' '}</Text>
            <Box flexDirection="column" flexGrow={1}>
              <Box gap={1}>
                <Text
                  bold={isSelected}
                  color={isDeleteTarget ? 'red' : isSelected ? 'white' : 'white'}
                  dimColor={!isSelected}
                >
                  {preview.slice(0, width - 30)}{preview.length > width - 30 ? '...' : ''}
                </Text>
                <Box flexGrow={1} />
                {isCurrent && <Text color="green" bold>*</Text>}
                {isDone && <Text color="green" dimColor>done</Text>}
                <Text color="gray" dimColor>{date}</Text>
              </Box>
              <Box gap={1}>
                <Text color="magenta" dimColor>{s.agent}</Text>
                <Text color="gray" dimColor>|</Text>
                <Text color="blue" dimColor>{(s.model.split('/').pop() ?? s.model)}</Text>
                <Text color="gray" dimColor>|</Text>
                <Text color="gray" dimColor>{formatSize(s.messageCount)}</Text>
                <Text color="gray" dimColor>|</Text>
                <Text color="gray" dimColor>{s.id.slice(0, 8)}</Text>
              </Box>
            </Box>
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {sessions.length > maxVisible && (
        <Box paddingX={2} justifyContent="center">
          <Text color="gray" dimColor>
            {scrollOffset + 1}-{Math.min(scrollOffset + maxVisible, sessions.length)} of {sessions.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}
