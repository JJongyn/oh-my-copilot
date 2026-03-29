import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { StatusBar } from './components/Header';
import { MessageList } from './components/MessageList';
import { InputArea } from './components/InputArea';
import { CommandPalette, type Command } from './components/CommandPalette';
import { ModelPicker } from './components/ModelPicker';
import { AgentPicker } from './components/AgentPicker';
import { ModePicker } from './components/ModePicker';
import { SessionPicker } from './components/SessionPicker';
import { McpPicker } from './components/McpPicker';
import { BackgroundTaskPicker } from './components/BackgroundTaskPicker';
import { SkillPicker } from './components/SkillPicker';
import { HarnessPanel } from './components/HarnessPanel';
import { ToolApprovalDialog } from './components/ToolApprovalDialog';
import { ShellPanel } from './components/ShellPanel';
import { AutoSetPanel } from './components/AutoSetPanel';
import { useChat } from './hooks/useChat';
import type { CopilotMode } from './hooks/useChat';
import { CopilotBridgeProvider } from '../provider/copilot-bridge';
import { runInit } from '../cli/commands/init';
import { SessionManager } from '../session/session-manager';
import type { Session, SessionMeta } from '../session/session-manager';
import type { McpClientManager } from '../mcp/mcp-client';
import { listPrimaryAgents } from '../agents/builtin-agents';
import type { BridgeToolInfo } from '../provider/types';

// ─── UI Mode State Machine ────────────────────────────────────────────────────
type UIMode =
  | { type: 'chat' }
  | { type: 'command-palette'; query: string }
  | { type: 'model-picker' }
  | { type: 'agent-picker' }
  | { type: 'mode-picker' }
  | { type: 'session-picker'; sessions: SessionMeta[] }
  | { type: 'skill-picker' }
  | { type: 'harness-panel' }
  | { type: 'mcp-picker' }
  | { type: 'background-picker' }
  | { type: 'shell' }
  | { type: 'help' }
  | { type: 'auto-set' };

interface AppProps {
  provider: CopilotBridgeProvider;
  initialAgent: string;
  initialModel: string;
  initialSession?: Session;
  mcpClient?: McpClientManager;
  bridgeTools?: BridgeToolInfo[];
}

const HELP_LINES = [
  ['', 'oh-my-copilot -- keyboard guide'],
  ['Enter', 'Send message'],
  ['/', 'Open command palette'],
  ['/agent', 'Pick agent (sisyphus, prometheus, hephaestus, oracle...)'],
  ['/model', 'Pick model from bridge list'],
  ['/mode', 'Switch mode: ask / plan / agent'],
  ['/sessions', 'Browse sessions (search, delete, resume)'],
  ['/new', 'Start fresh session'],
  ['/clear', 'Clear & new session'],
  ['/stop', 'Stop current generation'],
  ['/ultrawork', 'Enable ultrawork mode (Oracle verification loop)'],
  ['/init', 'Analyze project and write oh-my-copilot context'],
  ['/harness', 'Generate a project-specific harness team and activate it'],
  ['/skills', 'View and toggle skills for the current session'],
  ['/auto_set', 'Configure agent/model/mode via natural language'],
  ['/mcp', 'View MCP servers & Copilot editor tools'],
  ['/background', 'View background agent tasks'],
  ['/shell', 'Open terminal shell'],
  ['Esc', 'Close palette / cancel'],
  ['Ctrl+C', 'Exit'],
];

function HelpScreen({ onClose }: { onClose: () => void }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      marginLeft={2}
    >
      <Text bold color="cyan">oh-my-copilot  keyboard guide</Text>
      <Text> </Text>
      {HELP_LINES.slice(1).map(([key, desc]) => (
        <Box key={key} gap={2}>
          <Text color="yellow" bold>{key!.padEnd(14)}</Text>
          <Text>{desc}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text color="gray" dimColor>Press Esc to close</Text>
    </Box>
  );
}

export function App({ provider, initialAgent, initialModel, initialSession, mcpClient, bridgeTools = [] }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [width, setWidth] = useState(stdout?.columns ?? 100);

  useEffect(() => {
    const onResize = () => setWidth(process.stdout.columns ?? 100);
    process.stdout.on('resize', onResize);
    return () => { process.stdout.off('resize', onResize); };
  }, []);

  const [inputValue, setInputValue] = useState('');
  const [mode, setMode] = useState<UIMode>({ type: 'chat' });
  const [notification, setNotification] = useState<string | null>(null);
  const sessionManagerRef = useRef(new SessionManager());
  const sessionManager = sessionManagerRef.current;
  const lastEscAtRef = useRef(0);

  const chat = useChat({ provider, initialAgent, initialModel, initialSession, mcpClient, bridgeTools });

  const notify = useCallback((msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  useInput((_input, key) => {
    if (!key.escape) return;
    if (mode.type !== 'chat') return;
    if (chat.status !== 'streaming') return;
    if (chat.pendingApproval) return;

    const now = Date.now();
    if (now - lastEscAtRef.current <= 1500) {
      lastEscAtRef.current = 0;
      chat.stopGeneration();
      notify('Generation stopped');
      return;
    }

    lastEscAtRef.current = now;
    notify('Press Esc again to stop generation');
  });

  const handleTabAgent = useCallback(() => {
    const agents = listPrimaryAgents();
    const currentIdx = agents.findIndex(a => a.name === chat.agentName);
    const nextIdx = (currentIdx + 1) % agents.length;
    const nextAgent = agents[nextIdx];
    chat.switchAgent(nextAgent.name);
    notify(`Agent: ${nextAgent.name}`);
  }, [chat.agentName, chat.switchAgent, notify]);

  const returnToChat = useCallback(() => {
    setMode({ type: 'chat' });
    setInputValue('');
  }, []);

  // ─── Input change handler — detect "/" to open palette ───────────────────
  const handleInputChange = useCallback((val: string) => {
    if (val !== '') {
      chat.dismissError();
    }
    if (val === '/' && mode.type === 'chat' && inputValue === '') {
      setMode({ type: 'command-palette', query: '' });
      setInputValue('');
      return;
    }
    if (mode.type === 'command-palette') {
      if (val === '') {
        returnToChat();
      } else {
        setMode({ type: 'command-palette', query: val });
        setInputValue(val);
      }
      return;
    }
    setInputValue(val);
  }, [chat, mode, returnToChat, inputValue]);

  // ─── Command palette selection ────────────────────────────────────────────
  const handleCommandSelect = useCallback(async (cmd: Command) => {
    chat.dismissError();
    setInputValue('');
    switch (cmd.id) {
      case 'agent':
        setMode({ type: 'agent-picker' });
        break;
      case 'mode':
        setMode({ type: 'mode-picker' });
        break;
      case 'skills':
        setMode({ type: 'skill-picker' });
        break;
      case 'harness':
        setMode({ type: 'harness-panel' });
        break;
      case 'model':
        setMode({ type: 'model-picker' });
        break;
      case 'sessions': {
        const sessions = sessionManager.listSessions().slice(0, 30);
        setMode({ type: 'session-picker', sessions });
        break;
      }
      case 'new':
      case 'clear':
        chat.newSession();
        notify('New session started');
        setMode({ type: 'chat' });
        break;
      case 'stop':
        chat.stopGeneration();
        notify('Generation stopped');
        setMode({ type: 'chat' });
        break;
      case 'ultrawork':
        chat.switchMode('ultrawork');
        notify('Ultrawork mode — Oracle verification enabled');
        setMode({ type: 'chat' });
        break;
      case 'init':
        setMode({ type: 'chat' });
        notify('Running project init...');
        try {
          await runInit();
          notify('Project init complete');
        } catch (err) {
          notify(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      case 'mcp':
        setMode({ type: 'mcp-picker' });
        break;
      case 'background':
        setMode({ type: 'background-picker' });
        break;
      case 'shell':
        setMode({ type: 'shell' });
        break;
      case 'help':
        setMode({ type: 'help' });
        break;
      case 'auto-set':
        setMode({ type: 'auto-set' });
        break;
      case 'exit':
        exit();
        break;
      default:
        setMode({ type: 'chat' });
    }
  }, [chat, exit, notify, sessionManager]);

  // ─── Submit (Enter on chat input) ─────────────────────────────────────────
  const handleSubmit = useCallback(async (val: string) => {
    if (mode.type === 'command-palette') return;

    const trimmed = val.trim();
    chat.dismissError();
    setInputValue('');

    if (!trimmed) return;

    // Manual slash commands
    if (trimmed.startsWith('/')) {
      const [cmd, ...args] = trimmed.slice(1).split(' ');
      switch (cmd) {
        case 'exit': case 'quit': exit(); return;
        case 'help': setMode({ type: 'help' }); return;
        case 'new': case 'clear':
          chat.newSession(); notify('New session started'); return;
        case 'stop':
          chat.stopGeneration(); notify('Generation stopped'); return;
        case 'ultrawork':
          chat.switchMode('ultrawork'); notify('Ultrawork mode — Oracle verification enabled'); return;
        case 'harness':
          if (args[0] === 'regenerate' || args[0] === 'refresh' || args[0] === 'rebuild') {
            notify('Regenerating harness team...');
            try {
              await chat.generateHarness();
              notify('Harness regenerated and activated');
            } catch (err) {
              notify(`Harness regeneration failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
          }
          setMode({ type: 'harness-panel' }); return;
        case 'init':
          notify('Running project init...');
          try {
            await runInit();
            notify('Project init complete');
          } catch (err) {
            notify(`Init failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        case 'background':
          setMode({ type: 'background-picker' }); return;
        case 'skills':
          setMode({ type: 'skill-picker' }); return;
        case 'skill': {
          const action = args[0];
          const skillName = args.slice(1).join(' ').trim();
          if (!action || action === 'list') {
            setMode({ type: 'skill-picker' });
            return;
          }
          if (!skillName) {
            notify('Usage: /skill enable|disable|pin|unpin|global-pin|global-unpin <name>');
            return;
          }
          if (action === 'enable') {
            if (chat.enableSkill(skillName)) notify(`Skill enabled: ${skillName}`);
            else notify(`Skill not found: ${skillName}`);
            return;
          }
          if (action === 'disable') {
            chat.disableSkill(skillName);
            notify(`Skill disabled: ${skillName}`);
            return;
          }
          if (action === 'pin') {
            if (chat.pinSkill(skillName)) notify(`Project-pinned skill: ${skillName}`);
            else notify(`Skill not found: ${skillName}`);
            return;
          }
          if (action === 'unpin') {
            chat.unpinSkill(skillName);
            notify(`Project unpinned: ${skillName}`);
            return;
          }
          if (action === 'global-pin') {
            if (chat.globalPinSkill(skillName)) notify(`Global-pinned skill: ${skillName}`);
            else notify(`Skill not found: ${skillName}`);
            return;
          }
          if (action === 'global-unpin') {
            chat.globalUnpinSkill(skillName);
            notify(`Global unpinned: ${skillName}`);
            return;
          }
          notify('Usage: /skill enable|disable|pin|unpin|global-pin|global-unpin <name>');
          return;
        }
        case 'agent':
          if (args[0]) { chat.switchAgent(args[0]); notify(`Agent: ${args[0]}`); }
          else setMode({ type: 'agent-picker' });
          return;
        case 'mode':
          if (args[0]) { chat.switchMode(args[0] as CopilotMode); notify(`Mode: ${args[0]}`); }
          else setMode({ type: 'mode-picker' });
          return;
        case 'model':
          if (args[0]) { chat.switchModel(args[0]); notify(`Model: ${args[0]}`); }
          else setMode({ type: 'model-picker' });
          return;
        case 'sessions': {
          const sessions = sessionManager.listSessions().slice(0, 30);
          setMode({ type: 'session-picker', sessions });
          return;
        }
        case 'mcp':
          setMode({ type: 'mcp-picker' });
          return;
        case 'shell':
          setMode({ type: 'shell' });
          return;
        case 'auto_set':
        case 'autoset':
          setMode({ type: 'auto-set' });
          return;
        default:
          notify(`Unknown: /${cmd}  (press / for commands)`);
          return;
      }
    }

    if (mode.type === 'help') setMode({ type: 'chat' });
    chat.sendMessage(trimmed);
  }, [chat, exit, notify, mode, sessionManager]);

  const paletteWidth = Math.min(width - 4, 70);

  // ─── Overlay rendering ────────────────────────────────────────────────────
  const renderOverlay = () => {
    switch (mode.type) {
      case 'command-palette':
        return (
          <Box marginLeft={2} marginBottom={0}>
            <CommandPalette
              query={mode.query}
              onSelect={handleCommandSelect}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'model-picker':
        return (
          <Box marginLeft={2}>
            <ModelPicker
              provider={provider}
              currentModel={chat.model}
              onSelect={(m) => { chat.switchModel(m); notify(`Model: ${m}`); returnToChat(); }}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'agent-picker':
        return (
          <Box marginLeft={2}>
            <AgentPicker
              currentAgent={chat.agentName}
              onSelect={(a) => { chat.switchAgent(a); notify(`Agent: ${a}`); returnToChat(); }}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'mode-picker':
        return (
          <Box marginLeft={2}>
            <ModePicker
              currentMode={chat.copilotMode}
              onSelect={(m) => { chat.switchMode(m); notify(`Mode: ${m}`); returnToChat(); }}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'session-picker':
        return (
          <Box marginLeft={2}>
            <SessionPicker
              sessions={mode.sessions}
              currentSessionId={chat.session.meta.id}
              onSelect={(id) => {
                const sm = new SessionManager();
                const loaded = sm.load(id);
                if (loaded) {
                  chat.resumeSession(loaded);
                  notify(`Resumed: ${loaded.meta.title?.slice(0, 40) ?? id.slice(0, 8)}`);
                } else {
                  notify('Session not found');
                }
                returnToChat();
              }}
              onDelete={(id) => {
                chat.deleteSession(id);
                const updated = sessionManager.listSessions().slice(0, 30);
                setMode({ type: 'session-picker', sessions: updated });
                notify('Session deleted');
              }}
              onDeleteAll={() => {
                const count = chat.deleteAllSessions();
                const updated = sessionManager.listSessions().slice(0, 30);
                setMode({ type: 'session-picker', sessions: updated });
                notify(`Deleted ${count} sessions`);
              }}
              onSearch={(query) => {
                return chat.searchSessions(query);
              }}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'skill-picker':
        return (
          <Box marginLeft={2}>
            <SkillPicker
              activeSkills={chat.activeSkills}
              onToggle={(name) => {
                if (chat.activeSkills.includes(name)) {
                  chat.disableSkill(name);
                  notify(`Skill disabled: ${name}`);
                } else {
                  chat.enableSkill(name);
                  notify(`Skill enabled: ${name}`);
                }
              }}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'harness-panel':
        return (
          <Box marginLeft={2}>
            <HarnessPanel
              team={chat.harnessTeam}
              onGenerate={async () => {
                returnToChat();
                notify(chat.harnessTeam ? 'Regenerating harness team...' : 'Generating harness team...');
                try {
                  await chat.generateHarness();
                  notify('Harness generated and activated');
                } catch (err) {
                  notify(`Harness generation failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
              onClose={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'mcp-picker':
        return (
          <Box marginLeft={2}>
            <McpPicker
              mcpClient={mcpClient}
              bridgeTools={bridgeTools}
              onClose={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'background-picker':
        return (
          <Box marginLeft={2}>
            <BackgroundTaskPicker
              manager={chat.backgroundAgents}
              onClose={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      case 'shell':
        return (
          <Box marginLeft={2}>
            <ShellPanel width={paletteWidth} onClose={returnToChat} />
          </Box>
        );
      case 'help':
        return (
          <Box marginLeft={2}>
            <HelpScreen onClose={returnToChat} />
          </Box>
        );
      case 'auto-set':
        return (
          <Box marginLeft={2}>
            <AutoSetPanel
              currentAgent={chat.agentName}
              currentModel={chat.model}
              currentMode={chat.copilotMode}
              availableModels={[]}
              onApply={(settings) => {
                if (settings.agent) { chat.switchAgent(settings.agent); }
                if (settings.model) { chat.switchModel(settings.model); }
                if (settings.mode) { chat.switchMode(settings.mode); }
                const parts: string[] = [];
                if (settings.agent) parts.push(`agent=${settings.agent}`);
                if (settings.model) parts.push(`model=${settings.model}`);
                if (settings.mode) parts.push(`mode=${settings.mode}`);
                notify(`Applied: ${parts.join(', ')}`);
                returnToChat();
              }}
              onCancel={returnToChat}
              width={paletteWidth}
            />
          </Box>
        );
      default:
        return null;
    }
  };

  const showInput = mode.type === 'chat' || mode.type === 'command-palette' || mode.type === 'help';

  return (
    <Box flexDirection="column" width={width}>
      <MessageList
        completedMessages={chat.completedMessages}
        streamingContent={chat.streamingContent}
        agentName={chat.agentName}
        width={width}
      />

      {notification && (
        <Box paddingX={2}>
          <Text color="yellow">! {notification}</Text>
        </Box>
      )}

      {chat.error && (
        <Box paddingX={2}>
          <Text color="red">x {chat.error}</Text>
        </Box>
      )}

      {renderOverlay()}

      {chat.pendingApproval && (
        <Box marginLeft={2}>
          <ToolApprovalDialog
            approval={chat.pendingApproval}
            onApprove={chat.approvePendingTool}
            onDeny={chat.denyPendingTool}
            width={paletteWidth}
          />
        </Box>
      )}

      <StatusBar
        agentName={chat.agentName}
        model={chat.model}
        copilotMode={chat.copilotMode}
        harnessTeamName={chat.harnessTeam?.name}
        sessionId={chat.session.meta.id}
        status={chat.status}
        agentIteration={chat.agentIteration}
        loopPhase={chat.loopPhase}
        mcpCount={mcpClient?.connectedServerCount() ?? 0}
        messageCount={chat.completedMessages.length}
        tokensUsed={chat.tokensUsed}
        modelMaxTokens={chat.modelMaxTokens}
        currentTool={(() => {
          if (chat.status !== 'streaming' || !chat.streamingContent) return undefined;
          const m = chat.streamingContent.match(/^\[(\d+)\] running:\s*(\S+)/);
          return m ? m[2] : undefined;
        })()}
        width={width}
      />

      {showInput && !chat.pendingApproval && (
        <InputArea
          value={inputValue}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          status={chat.status}
          width={width}
          paletteOpen={mode.type === 'command-palette'}
          onTabAgent={handleTabAgent}
        />
      )}
    </Box>
  );
}
