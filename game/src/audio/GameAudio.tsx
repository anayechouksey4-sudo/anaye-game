/**
 * Sound and haptics root, mounted once by App.tsx outside the Canvas. Renders nothing: the
 * AudioSystem (audioSystem.ts) owns the AudioContext, the synthesized engine / tyre / wind /
 * effect sounds and navigator.vibrate feedback, driven by car/runtime.ts, game events and the
 * selection settings. Everything is torn down on unmount (StrictMode's double mount included).
 */
import { useEffect } from 'react';
import { AudioSystem } from './audioSystem';

export function GameAudio() {
  useEffect(() => {
    const system = new AudioSystem();
    return () => system.dispose();
  }, []);
  return null;
}
