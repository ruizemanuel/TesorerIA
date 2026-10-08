/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PIMLICO_API_KEY?: string;
  readonly VITE_PIMLICO_SPONSORSHIP_POLICY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
