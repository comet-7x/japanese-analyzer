'use client';
import type { AnalysisProgress } from '../utils/analysisSession';
import { useLanguage } from '../contexts/LanguageContext';

export default function AnalysisProgressView({ progress, onRetry }: { progress: AnalysisProgress; onRetry: () => void }) {
  const { t } = useLanguage();
  if (progress.status === 'complete' || progress.status === 'cancelled') return null;
  const complete = progress.chunks.filter(chunk => chunk.status === 'complete').length;
  const retrying = progress.chunks.filter(chunk => chunk.status === 'retrying' || (chunk.status === 'queued' && chunk.recovery)).length;
  const failed = progress.chunks.filter(chunk => chunk.status === 'failed').length;
  return <div className="learning-actions" aria-label={t('解析进度')}>
    <span className="tool-note" role="status">
      {t('已完成 {0}/{1} 段', complete, progress.chunks.length)}
      {retrying > 0 && ` · ${t('正在重试 {0} 段', retrying)}`}
      {failed > 0 && ` · ${t('{0} 段解析失败，已保留成功结果', failed)}`}
    </span>
    {progress.status === 'failed' && failed > 0 && <button className="nd-ghost-btn" onClick={onRetry}>{t('重试失败部分')}</button>}
  </div>;
}
