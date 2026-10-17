import { AnalysisSession, type AnalysisProgress } from '../utils/analysisSession';
import { correctionChunks, correctionRequestData, positionLocalTokens, splitCorrectionRecoveryChunk, validateLocalTokens } from '../lib/localCorrections';
import { postLearning, type LearningModel } from './learning';
import type { TokenData } from './api';
import { getLocalRomaji } from '../utils/romaji';
import { AnalysisValidationError } from '../utils/requestErrors';

export function createLocalCorrectionSession(source: string, input: TokenData[], model: LearningModel, options: {
  signal: AbortSignal; thinkingEnabled: boolean; onProgress: (progress: AnalysisProgress) => void;
}) {
  const tokens = validateLocalTokens(source, input);
  const positioned = positionLocalTokens(tokens);
  return new AnalysisSession(source, async (chunk, context, signal) => {
    const { draft, targetTokens, contextBefore, contextAfter } = correctionRequestData(source, positioned, chunk);
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    let abort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(deadline.reason);
      if (deadline.aborted) abort(); else deadline.addEventListener('abort', abort, { once: true });
    });
    try {
      const result = await Promise.race([postLearning<{ tokens: TokenData[] }>('/api/local-analyzer/correct', { source: chunk.text, tokens: draft,
        targetTokens, contextBefore, contextAfter,
        thinkingEnabled: options.thinkingEnabled, chunkContext: { start: chunk.start, end: chunk.end, index: context.rootIndex, attempt: context.attempt } }, deadline, model), aborted]);
      deadline.throwIfAborted();
      return validateLocalTokens(chunk.text, result.tokens).map(t => ({ ...t, romaji: getLocalRomaji(t.word, t.furigana ?? '', t.pos) }));
    } catch (error) {
      if (deadline.aborted && !signal.aborted) throw new AnalysisValidationError('timeout');
      throw error;
    } finally { deadline.removeEventListener('abort', abort); }
  }, { signal: options.signal, onProgress: options.onProgress, automaticRecovery: true,
    sourceChunks: correctionChunks(source, tokens), splitRecovery: chunk => splitCorrectionRecoveryChunk(positioned, chunk) });
}
