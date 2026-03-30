import * as vscode from 'vscode';
import * as net from 'net';
import * as http from 'http';
import { createServer } from './server';
import { generateToken, writeBridgeInfo, clearBridgeInfo, BRIDGE_INFO_PATH } from './bridge-info';

let statusBarItem: vscode.StatusBarItem;
let currentPort: number | null = null;
let currentToken: string | null = null;
let serverInstance: http.Server | null = null;

function getEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

async function getAvailableModels(): Promise<string[]> {
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return [...new Set(models.map(m => m.family || m.id))];
  } catch {
    return [];
  }
}

async function startServer(context: vscode.ExtensionContext): Promise<void> {
  if (serverInstance) {
    vscode.window.showInformationMessage('Oh My Copilot Bridge is already running.');
    return;
  }

  const config = vscode.workspace.getConfiguration('ohMyCopilotBridge');
  const preferredPort = config.get<number>('port', 0);
  const token = generateToken();

  try {
    const port = preferredPort === 0 ? await getEphemeralPort() : preferredPort;
    const server = createServer({ port, token });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });

    const actualPort = (server.address() as net.AddressInfo).port;
    serverInstance = server;
    currentPort = actualPort;
    currentToken = token;

    const models = await getAvailableModels();

    writeBridgeInfo({
      port: actualPort,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      models,
    });

    updateStatusBar(actualPort);

    context.subscriptions.push({
      dispose: () => stopServer(),
    });

    vscode.window.showInformationMessage(`Oh My Copilot Bridge started on port ${actualPort}`);
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to start Oh My Copilot Bridge: ${err}`);
  }
}

function stopServer(): void {
  if (!serverInstance) return;
  serverInstance.close();
  serverInstance = null;
  currentPort = null;
  currentToken = null;
  clearBridgeInfo();
  updateStatusBar(null);
}

function updateStatusBar(port: number | null): void {
  if (!statusBarItem) return;
  if (port !== null) {
    statusBarItem.text = `$(plug) Copilot Bridge :${port}`;
    statusBarItem.tooltip = `Oh My Copilot Bridge running on port ${port}\nClick for options`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(debug-disconnect) Copilot Bridge`;
    statusBarItem.tooltip = 'Oh My Copilot Bridge is stopped. Click to start.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'oh-my-copilot-bridge.status';
  context.subscriptions.push(statusBarItem);
  updateStatusBar(null);

  context.subscriptions.push(
    vscode.commands.registerCommand('oh-my-copilot-bridge.start', () => startServer(context)),

    vscode.commands.registerCommand('oh-my-copilot-bridge.stop', () => {
      stopServer();
      vscode.window.showInformationMessage('Oh My Copilot Bridge stopped.');
    }),

    vscode.commands.registerCommand('oh-my-copilot-bridge.status', async () => {
      if (currentPort && currentToken) {
        const choice = await vscode.window.showInformationMessage(
          `Oh My Copilot Bridge running on port ${currentPort}`,
          'Stop Bridge', 'Open Config'
        );
        if (choice === 'Stop Bridge') {
          stopServer();
          vscode.window.showInformationMessage('Bridge stopped.');
        } else if (choice === 'Open Config') {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(BRIDGE_INFO_PATH));
        }
      } else {
        const choice = await vscode.window.showWarningMessage(
          'Oh My Copilot Bridge is not running.',
          'Start Bridge'
        );
        if (choice === 'Start Bridge') {
          await startServer(context);
        }
      }
    }),
  );

  // Auto-start (delay to let Copilot extension init)
  const config = vscode.workspace.getConfiguration('ohMyCopilotBridge');
  if (config.get<boolean>('autoStart', true)) {
    setTimeout(() => startServer(context), 2500);
  }

  // Update models list when Copilot changes
  context.subscriptions.push(
    vscode.lm.onDidChangeChatModels(async () => {
      if (currentPort && currentToken) {
        const models = await getAvailableModels();
        writeBridgeInfo({
          port: currentPort,
          token: currentToken,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          models,
        });
      }
    })
  );
}

export function deactivate(): void {
  stopServer();
}
