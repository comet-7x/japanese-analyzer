'use client';

import { useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getClientLocale } from '../i18n';
import type { MachineTranslationProviderId, TranslationServiceSettings } from '../lib/translationServices';
import { LatestRequest } from '../utils/latestRequest';

export default function TranslationServicesSettings({ value, onChange }: {
  value: TranslationServiceSettings; onChange: (value: TranslationServiceSettings) => void;
}) {
  const { t, errorText } = useLanguage();
  const [testing, setTesting] = useState<MachineTranslationProviderId | null>(null);
  const [status, setStatus] = useState<Record<string, string>>({});
  const request = useRef(new LatestRequest());
  const test = async (provider: MachineTranslationProviderId) => {
    const ticket = request.current.start(); setTesting(provider); setStatus(previous => ({ ...previous, [provider]: '' }));
    const translationKey = provider === 'google' ? value.google.apiKey : value.baidu.secret;
    const translationAppId = provider === 'baidu' ? value.baidu.appId : '';
    try {
      const response = await fetch('/api/machine-translate', {
        method: 'POST', signal: ticket.signal,
        headers: {
          'Content-Type': 'application/json', 'X-App-Locale': getClientLocale(),
          'X-Translation-Api-Key': translationKey,
          ...(provider === 'baidu' ? { 'X-Translation-App-Id': translationAppId } : {}),
        }, body: JSON.stringify({ provider, text: '駅' }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
      if (ticket.isCurrent()) setStatus(previous => ({ ...previous, [provider]: t('连接成功') }));
    } catch (error) {
      if (ticket.isCurrent()) setStatus(previous => ({ ...previous, [provider]: errorText(error instanceof Error ? error.message : '连接失败') }));
    } finally { if (ticket.isCurrent()) setTesting(null); }
  };
  return <section className="dictionary-settings translation-service-settings">
    <h3>{t('翻译服务')}</h3>
    <p className="tool-note">{t('当前模型可直接翻译；Google 和百度使用官方 API，并可再交给当前模型复核。')}</p>
    <label>{t('默认翻译来源')}<select className="learning-input" value={value.preferredProvider}
      onChange={event => onChange({ ...value, preferredProvider: event.target.value as TranslationServiceSettings['preferredProvider'] })}>
      <option value="model">{t('当前模型')}</option><option value="google">Google</option><option value="baidu">{t('百度')}</option>
    </select></label>
    <details><summary>Google Cloud Translation</summary><div className="learning-fields">
      <label>API Key<input className="learning-input" type="password" autoComplete="off" value={value.google.apiKey}
        onChange={event => onChange({ ...value, google: { apiKey: event.target.value } })} /></label>
      <div className="learning-actions"><button type="button" className="nd-ghost-btn" disabled={testing !== null}
        onClick={() => void test('google')}>{t(testing === 'google' ? '测试中…' : '测试连接')}</button></div>
      {status.google && <p role="status">{status.google}</p>}
    </div></details>
    <details><summary>{t('百度翻译')}</summary><div className="learning-fields">
      <label>AppID<input className="learning-input" autoComplete="off" value={value.baidu.appId}
        onChange={event => onChange({ ...value, baidu: { ...value.baidu, appId: event.target.value } })} /></label>
      <label>{t('密钥')}<input className="learning-input" type="password" autoComplete="off" value={value.baidu.secret}
        onChange={event => onChange({ ...value, baidu: { ...value.baidu, secret: event.target.value } })} /></label>
      <div className="learning-actions"><button type="button" className="nd-ghost-btn" disabled={testing !== null}
        onClick={() => void test('baidu')}>{t(testing === 'baidu' ? '测试中…' : '测试连接')}</button></div>
      {status.baidu && <p role="status">{status.baidu}</p>}
    </div></details>
  </section>;
}
