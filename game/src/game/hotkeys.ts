import { useEffect } from 'react';
import { isEditableTarget } from '../car/input';
import { gameState } from '../state/store';

/** Discrete hotkeys: R respawn, Backspace/T restart, C camera, P physics panel, H help. */
export function useGlobalHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isEditableTarget(e.target)) return;
      const s = gameState();
      switch (e.code) {
        case 'KeyR':
          s.respawn('manual');
          break;
        case 'KeyT':
        case 'Backspace':
          e.preventDefault();
          s.restart();
          break;
        case 'KeyC':
          s.cycleCamera();
          break;
        case 'KeyP':
          s.togglePhysicsPanel();
          break;
        case 'KeyH':
          s.toggleHelp();
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
