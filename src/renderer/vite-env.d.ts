/// <reference types="vite/client" />

import type { SkillManagerApi } from "../../electron/preload";

declare global {
  interface Window {
    skillManager: SkillManagerApi;
  }
}
