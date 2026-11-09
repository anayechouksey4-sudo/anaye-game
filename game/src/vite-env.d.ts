/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional relay URL baked in at build time, e.g. `ws://192.168.1.20:8787`. */
  readonly VITE_SQUAD_WS_URL?: string;
  /** Optional Google client id for a local test build (config.ts googleClientId; the real one goes in GOOGLE_CLIENT_ID). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
