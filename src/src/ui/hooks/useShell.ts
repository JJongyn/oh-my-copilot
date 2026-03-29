import { useCallback } from 'react';
import { invokeShell } from '../shell-bridge';

export function useShell() {
  const openShell = useCallback(() => {
    invokeShell();
  }, []);

  return { openShell };
}
