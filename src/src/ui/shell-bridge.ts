/**
 * Module-level shell bridge.
 * launch.tsx registers a handler; useShell.ts calls it.
 * This lets the shell run after ink is fully unmounted.
 */
type ShellHandler = () => void;

let _handler: ShellHandler | null = null;

export function registerShellHandler(fn: ShellHandler): void {
  _handler = fn;
}

export function invokeShell(): void {
  if (_handler) {
    _handler();
  } else {
    // Fallback: no handler registered (shouldn't happen in normal flow)
    process.stderr.write('Shell handler not registered\n');
  }
}
