import { useEffect } from 'react';
import { isEditableTarget } from '../car/input';
import { gameState } from '../state/store';

/** Discrete actions behind the hotkeys; the on-screen touch buttons (hud/TouchControls.tsx) run the same ones. */
export type HotkeyAction = 'respawn' | 'restart' | 'camera' | 'physics' | 'help';

/** R respawn, Backspace/T restart, C camera, P physics panel, H help (the HUD extras on touch devices). */
const KEY_ACTIONS: Readonly<Record<string, HotkeyAction>> = {
  KeyR: 'respawn',
  KeyT: 'restart',
  Backspace: 'restart',
  KeyC: 'camera',
  KeyP: 'physics',
  KeyH: 'help',
};

export function runHotkeyAction(action: HotkeyAction): void {
  const s = gameState();
  switch (action) {
    case 'respawn':
      s.respawn('manual');
      break;
    case 'restart':
      s.restart();
      break;
    case 'camera':
      s.cycleCamera();
      break;
    case 'physics':
      s.togglePhysicsPanel();
      break;
    case 'help':
      s.toggleHelp();
      break;
  }
}

/** Discrete hotkeys: R respawn, Backspace/T restart, C camera, P physics panel, H help. */
export function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      if (action === 'restart') e.preventDefault();
      runHotkeyAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
