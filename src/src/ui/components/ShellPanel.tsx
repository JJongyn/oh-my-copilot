import React, { useState, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { execSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface ShellLine {
  type: 'cmd' | 'out' | 'err' | 'tab';
  text: string;
}

interface ShellPanelProps {
  width: number;
  onClose: () => void;
}

function commonPrefix(strs: string[]): string {
  if (!strs.length) return '';
  let prefix = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

function getCompletions(input: string, cwd: string): string[] {
  const parts = input.trimStart().split(/\s+/);
  const word = parts[parts.length - 1] ?? '';
  const isCommand = parts.length <= 1;
  try {
    const type = isCommand ? 'c' : 'f';
    const script = `compgen -${type} -- ${JSON.stringify(word)}`;
    const out = execSync(`bash -c ${JSON.stringify(script)}`, {
      encoding: 'utf8',
      timeout: 2000,
      cwd,
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Resolve a cd target path, handling ~, -, relative, absolute */
function resolveCd(arg: string, cwd: string, prevCwd: string): string | Error {
  if (!arg || arg === '~') return os.homedir();
  if (arg === '-') return prevCwd;
  const resolved = path.resolve(cwd, arg.replace(/^~/, os.homedir()));
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return new Error(`cd: not a directory: ${arg}`);
    return resolved;
  } catch {
    return new Error(`cd: no such file or directory: ${arg}`);
  }
}

function shortenPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function InputLine({ value, cursor, placeholder }: { value: string; cursor: number; placeholder?: string }) {
  if (!value && placeholder) {
    return (
      <Box>
        <Text inverse> </Text>
        <Text color="gray" dimColor>{placeholder}</Text>
      </Box>
    );
  }
  const chars = [...value];
  const before = chars.slice(0, cursor).join('');
  const at = chars[cursor];
  const after = chars.slice(cursor + 1).join('');
  return (
    <Box>
      {before ? <Text>{before}</Text> : null}
      <Text inverse>{at ?? ' '}</Text>
      {after ? <Text>{after}</Text> : null}
    </Box>
  );
}

export function ShellPanel({ width, onClose }: ShellPanelProps) {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [cwd, setCwd] = useState(process.cwd());
  const [prevCwd, setPrevCwd] = useState(process.cwd());
  const [lines, setLines] = useState<ShellLine[]>([
    { type: 'out', text: 'Shell — Esc: return · Tab: complete · ↑↓: history · exit: close' },
  ]);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const valueRef = useRef(value);
  const cursorRef = useRef(cursor);
  const cwdRef = useRef(cwd);
  const prevCwdRef = useRef(prevCwd);
  const historyRef = useRef(history);
  const histIdxRef = useRef(histIdx);
  valueRef.current = value;
  cursorRef.current = cursor;
  cwdRef.current = cwd;
  prevCwdRef.current = prevCwd;
  historyRef.current = history;
  histIdxRef.current = histIdx;

  const appendLines = useCallback((newLines: ShellLine[]) => {
    setLines(prev => [...prev, ...newLines].slice(-200));
  }, []);

  const runCommand = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    setValue('');
    setCursor(0);
    setHistIdx(-1);

    if (!trimmed) return;

    if (trimmed === 'exit' || trimmed === 'quit') {
      onClose();
      return;
    }

    setHistory(prev => [trimmed, ...prev].slice(0, 50));
    const curCwd = cwdRef.current;

    // Handle cd internally so cwd persists across commands
    if (trimmed === 'cd' || trimmed.startsWith('cd ') || trimmed.startsWith('cd\t')) {
      const arg = trimmed.slice(2).trim();
      const result = resolveCd(arg, curCwd, prevCwdRef.current);
      if (result instanceof Error) {
        appendLines([
          { type: 'cmd', text: `$ ${trimmed}` },
          { type: 'err', text: result.message },
        ]);
      } else {
        setPrevCwd(curCwd);
        setCwd(result);
        appendLines([{ type: 'cmd', text: `$ ${trimmed}` }]);
      }
      return;
    }

    const newLines: ShellLine[] = [{ type: 'cmd', text: `$ ${trimmed}` }];
    try {
      const out = execSync(trimmed, {
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        cwd: curCwd,           // ← use tracked cwd
        env: { ...process.env, PWD: curCwd },
        shell: process.env.SHELL ?? '/bin/zsh',
      });
      if (out) {
        out.trimEnd().split('\n').forEach(line => newLines.push({ type: 'out', text: line }));
      }
    } catch (e: unknown) {
      const err = e as { stderr?: string; stdout?: string; message?: string };
      const combined = [err.stdout, err.stderr].filter(Boolean).join('').trim()
        || err.message || String(e);
      combined.split('\n').forEach(line => newLines.push({ type: 'err', text: line }));
    }
    appendLines(newLines);
  }, [onClose, appendLines]);

  useInput((ch, key) => {
    const val = valueRef.current;
    const cur = cursorRef.current;
    const hist = historyRef.current;
    const hIdx = histIdxRef.current;
    const chars = [...val];

    if (key.escape) { onClose(); return; }

    if (key.upArrow) {
      const next = Math.min(hIdx + 1, hist.length - 1);
      if (next >= 0 && hist[next] !== undefined) {
        const v = hist[next];
        setHistIdx(next); setValue(v); setCursor([...v].length);
      }
      return;
    }
    if (key.downArrow) {
      const next = hIdx - 1;
      if (next < 0) { setHistIdx(-1); setValue(''); setCursor(0); }
      else { const v = hist[next] ?? ''; setHistIdx(next); setValue(v); setCursor([...v].length); }
      return;
    }
    if (key.leftArrow) { setCursor(Math.max(0, cur - 1)); return; }
    if (key.rightArrow) { setCursor(Math.min(chars.length, cur + 1)); return; }
    if (key.return) { runCommand(val); return; }

    if (key.tab) {
      const completions = getCompletions(val, cwdRef.current);
      if (!completions.length) return;
      const parts = val.trimStart().split(/\s+/);
      const word = parts[parts.length - 1] ?? '';
      const prefix = commonPrefix(completions);
      if (completions.length === 1) {
        const suffix = parts.length <= 1 ? completions[0] + ' ' : completions[0];
        const newVal = val.slice(0, val.length - word.length) + suffix;
        setValue(newVal); setCursor([...newVal].length);
      } else if (prefix.length > word.length) {
        const newVal = val.slice(0, val.length - word.length) + prefix;
        setValue(newVal); setCursor([...newVal].length);
      } else {
        const display = completions.slice(0, 30).join('  ');
        const more = completions.length > 30 ? `  … (+${completions.length - 30})` : '';
        appendLines([{ type: 'tab', text: display + more }]);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cur > 0) {
        chars.splice(cur - 1, 1);
        const newVal = chars.join('');
        setValue(newVal); setCursor(cur - 1);
      }
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      const inputChars = [...ch];
      chars.splice(cur, 0, ...inputChars);
      const newVal = chars.join('');
      setValue(newVal); setCursor(cur + inputChars.length);
    }
  });

  const innerWidth = width - 4;
  const promptPath = shortenPath(cwd);

  return (
    <Box flexDirection="column" width={width} borderStyle="single" borderColor="yellow" paddingX={1}>
      <Box>
        <Text bold color="yellow"> Shell </Text>
        <Text color="gray" dimColor>— Esc: return  ·  Tab: complete  ·  ↑↓: history  ·  exit: close</Text>
      </Box>

      <Box flexDirection="column" marginTop={0}>
        {lines.slice(-20).map((l, i) => (
          <Text
            key={i}
            color={l.type === 'cmd' ? 'cyan' : l.type === 'err' ? 'red' : l.type === 'tab' ? 'yellow' : 'white'}
            dimColor={l.type === 'out'}
            wrap="wrap"
          >
            {l.text.slice(0, innerWidth)}
          </Text>
        ))}
      </Box>

      <Box gap={1} marginTop={1}>
        <Text color="yellow" bold>{promptPath} $</Text>
        <InputLine value={value} cursor={cursor} placeholder="command…" />
      </Box>
    </Box>
  );
}
