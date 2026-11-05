/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional relay URL baked in at build time, e.g. `ws://192.168.1.20:8787`. */
  readonly VITE_SQUAD_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
