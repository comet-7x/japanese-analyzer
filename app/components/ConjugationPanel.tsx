'use client';
import { useLanguage } from '../contexts/LanguageContext';
import type { useConjugation } from '../hooks/useConjugation';

export default function ConjugationPanel({ tool, onLoad, open, onOpenChange }: {
  tool: ReturnType<typeof useConjugation>;
  onLoad: () => Promise<unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, errorText } = useLanguage();
  const { result, loading, error } = tool;
  return <details className="detail-disclosure conjugation-tool" open={open} onToggle={event => {
    onOpenChange(event.currentTarget.open);
  }}><summary>{t('词形变化')}<span className="disclosure-hint">{t('原形 → 句中形式')}</span></summary>
    <p className="tool-note">{t('说明原形如何变成句中形式，以及否定、过去等变化带来的含义。')}</p>
    <p className="conjugation-example">{t('例如：食べる → 食べた（过去）。')}</p>
    <small className="tool-note">{t('AI 生成')}</small>
    {!result && <div className="learning-actions"><button className="nd-ghost-btn" disabled={loading} onClick={() => void onLoad()}>{t(loading ? '加载中…' : '查看变化过程')}</button></div>}
    {result && <div>{result.insufficient && <p>{t('信息不足，请选择完整的活用表达。')}</p>}{result.analyses.map((a, i) => <div key={i}><ol className="conjugation-chain">{a.steps.map((s, j) => <li key={j}><span lang="ja">{s.form}</span><small>{s.label}</small></li>)}</ol><p>{a.note}</p></div>)}</div>}
    {error && <p role="alert">{errorText(error)}</p>}
  </details>;
}
