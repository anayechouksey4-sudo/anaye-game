import { createContext, useContext, type ReactNode } from 'react';

import { useStore, type Store } from '../state/store';
import type { ConnectionState, ControlsState, GameLinkState, SquadController, TelemetryState } from './controller';

interface SquadContextValue {
  controller: SquadController;
  /** URL to prefill: the saved one, else the best guess for this device. */
  initialUrl: string;
  /** Persist the URL the user connected to (and whether to auto-connect next launch). */
  rememberLink(url: string, autoConnect: boolean): void;
}

const SquadContext = createContext<SquadContextValue | null>(null);

export function SquadProvider({ value, children }: { value: SquadContextValue; children: ReactNode }) {
  return <SquadContext.Provider value={value}>{children}</SquadContext.Provider>;
}

export function useSquad(): SquadContextValue {
  const value = useContext(SquadContext);
  if (!value) throw new Error('useSquad must be used inside <SquadProvider>');
  return value;
}

function useSlice<T extends object, S>(pick: (c: SquadController) => Store<T>, selector: (state: T) => S): S {
  const { controller } = useSquad();
  return useStore(pick(controller), selector);
}

export const useControls = <S,>(selector: (s: ControlsState) => S): S => useSlice((c) => c.controls, selector);
export const useConnection = <S,>(selector: (s: ConnectionState) => S): S => useSlice((c) => c.connection, selector);
export const useGameLink = <S,>(selector: (s: GameLinkState) => S): S => useSlice((c) => c.game, selector);
export const useTelemetry = <S,>(selector: (s: TelemetryState) => S): S => useSlice((c) => c.telemetry, selector);
