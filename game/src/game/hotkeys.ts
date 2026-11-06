import { useEffect } from 'react';
import { isEditableTarget } from '../car/input';
import { selectionState } from '../state/selection';
import { gameState } from '../state/store';

/** Discrete actions behind the hotkeys; the on-screen buttons and the ☰ menu run the same ones. */
export type HotkeyAction = 'respawn' | 'restart' | 'camera' | 'physics' | 'help' | 'menu';

/**
 * R respawn, Backspace/T restart, C camera, P physics panel, H help (the HUD extras on touch
 * devices), Esc / M the ☰ menu (pause).
 */
const KEY_ACTIONS: Readonly<Record<string, HotkeyAction>> = {
  KeyR: 'respawn',
  KeyT: 'restart',
  Backspace: 'restart',
  KeyC: 'camera',
  KeyP: 'physics',
  KeyH: 'help',
  KeyM: 'menu',
  Escape: 'menu',
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
    case 'menu':
      selectionState().toggleMenu();
      break;
  }
}

/** Discrete hotkeys (see KEY_ACTIONS). While the ☰ menu is open only Esc / M work (they close it). */
export function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const action = KEY_ACTIONS[e.code];
      if (!action) return;
      // Esc leaves a focused slider too; every other key typed into a form control belongs to it.
      if (isEditableTarget(e.target) && e.code !== 'Escape') return;
      if (selectionState().menuOpen && action !== 'menu') return;
      if (action === 'restart' || action === 'menu') e.preventDefault();
      runHotkeyAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
