import type { TokenData } from '../services/api';
export const LOCAL_INPUT_LIMIT = 12_000;
export type AnalysisEngine = 'model' | 'local';
export interface LocalProgress { stage: 'download' | 'load' | 'parse'; loaded: number; total: number; cached: number; }
export type LocalReply = { type: 'progress'; progress: LocalProgress } | { type: 'partial'; tokens: TokenData[] }
  | { type: 'complete'; tokens: TokenData[] } | { type: 'error'; message: string };
