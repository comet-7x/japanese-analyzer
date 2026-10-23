'use client';

import { useLanguage } from '../contexts/LanguageContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantModalPrimitive, TextMessagePartProvider } from '@assistant-ui/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { streamChat, ChatMessage as APIMessage } from '../services/api';
import type { EndpointPayload, ProviderProfile } from '../services/api';
import { Icon } from './Icons';
import { AutoAnimateHeight } from '@/components/ui/auto-animate-height';
import { MarkdownText } from '@/components/ui/markdown-text';
import { createRequestMetrics } from '../utils/analytics';
import { supportsImageInput } from '../lib/aiModels';
import { CHAT_BODY_LIMIT, CHAT_IMAGE_FILE_LIMIT, CHAT_IMAGE_TYPES } from '../lib/chatMessages';
import { useChatSessions, type ChatMessage } from './useChatSessions';
import CompanionCapsule, { type CompanionControls } from '../plugins/live2d/CompanionCapsule';

interface AIChatProps {
  hidden?: boolean;
  companion?: CompanionControls;
  userApiKey?: string;
  activeService: ProviderProfile | null;
  endpoint: EndpointPayload;
  currentSentence?: string;
}

export default function AIChat({ userApiKey, activeService, endpoint, currentSentence, hidden = false, companion }: AIChatProps) {
  const { t, locale, errorText } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { key: sessionKey, mode, setMode, messages, setMessages, inputValue, setInputValue, image, setImage } = useChatSessions(currentSentence);
  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const [isLoading, setIsLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageReadId = useRef(0);
  const canReadImages = supportsImageInput(endpoint.model, endpoint.caps);
  const imageBlocked = !canReadImages && !!(image || messages.some(message => message.image));
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    imageReadId.current++;
    setImageLoading(false);
    setImageError('');
    setMessages(current => current.filter(message => message.content || message.role === 'user'));
    return () => { requestRef.current?.abort(); };
  }, [locale, endpoint.model, endpoint.baseUrl, userApiKey, activeService?.id, sessionKey, setMessages]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const modalEase = [0.16, 1, 0.3, 1] as const;
  const panelInitial = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 0, scale: 0.9, y: 8 };
  const panelAnimate = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, scale: 1, y: 0 };
  const panelExit = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.9, y: 8 };
  const panelEnterTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: modalEase };
  const panelExitTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.15, ease: modalEase };
  const iconTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.15, ease: modalEase };

  const scrollToBottom = () => {
    const list = messagesScrollRef.current;
    if (list && followBottomRef.current) list.scrollTop = list.scrollHeight;
  };

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isOpen, isExpanded]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeContent = mode === 'sentence'
        ? "可以问我这句话的语法和用法。"
        : "想聊些什么？可以自由提问。";

      setMessages([{
        id: Date.now().toString(),
        role: 'assistant',
        welcome: true,
        content: welcomeContent
      }]);
    }
  }, [isOpen, messages.length, mode, t, setMessages]);

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && !image) || isLoading || imageLoading || imageBlocked || (mode === 'sentence' && image)) return;
    if (messages.length >= 196) { setImageError(t('会话过长，请清空聊天后重试。')); return; }
    followBottomRef.current = true;
    setImageError('');
    const controller = new AbortController();
    requestRef.current = controller;
    const isCurrent = () => requestRef.current === controller && sessionKeyRef.current === sessionKey && !controller.signal.aborted;
    const metrics = createRequestMetrics('chat', activeService?.id ?? '', endpoint.model, true, controller.signal);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      ...(image ? { image } : {}),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setImage(undefined);
    setIsLoading(true);

    const assistantMessageId = (Date.now() + 1).toString();
    const tempAssistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: ''
    };

    setMessages((prev) => [...prev, tempAssistantMessage]);

    try {
      const toApiMessage = (message: ChatMessage): APIMessage => ({
        role: message.role,
        content: message.image ? [
          { type: 'text', text: message.content || t('请看看这张图片。') },
          { type: 'image_url', image_url: { url: message.image.data } },
        ] : message.content,
      });
      const apiMessages: APIMessage[] = messages.filter(message => !message.welcome && !message.error && (message.content !== '' || message.image)).map(toApiMessage);
      apiMessages.push(toApiMessage(userMessage));
      if (new TextEncoder().encode(JSON.stringify(apiMessages)).length > CHAT_BODY_LIMIT - 4096) {
        throw new Error(t('会话图片过多，请清空聊天后重试。'));
      }

      await streamChat(
        apiMessages,
        (chunk, isDone) => {
          if (!isCurrent()) return;
          if (chunk.trim()) metrics.firstResult();
          setMessages((prev) => prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: chunk }
              : msg
          ));

          if (isDone) {
            metrics.succeed();
            setIsLoading(false);
          }
        },
        (error) => {
          if (!isCurrent()) return;
          metrics.fail(error);
          console.error('Chat error:', error);
          setMessages((prev) => prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, error: true, content: `抱歉，聊天时出现错误：${error.message}` }
              : msg
          ));
          setInputValue(value => value || userMessage.content);
          setImage(value => value ?? userMessage.image);
          setIsLoading(false);
        },
        userApiKey,
        endpoint,
        controller.signal,
        { chatMode: mode, sentenceContext: mode === 'sentence' ? currentSentence : undefined },
      );
    } catch (error) {
      if (!isCurrent()) return;
      metrics.fail(error);
      console.error('Chat error:', error);
      setMessages((prev) => prev.map((msg) =>
        msg.id === assistantMessageId
          ? { ...msg, error: true, content: `抱歉，聊天时出现错误：${error instanceof Error ? error.message : "未知错误"}` }
          : msg
      ));
      setInputValue(value => value || userMessage.content);
      setImage(value => value ?? userMessage.image);
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePopoverOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, []);

  const openExpanded = () => {
    setIsOpen(false);
    setIsExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const closeChat = () => {
    setIsOpen(false);
    setIsExpanded(false);
  };

  useEffect(() => () => { imageReadId.current++; }, []);
  const attachImage = async (file?: File) => {
    if (!file || mode !== 'free') return;
    const id = ++imageReadId.current;
    if (!canReadImages || !CHAT_IMAGE_TYPES.includes(file.type) || file.size > CHAT_IMAGE_FILE_LIMIT) {
      setImageLoading(false);
      setImageError(t('请使用支持图片的模型，并上传不超过 2 MB 的 PNG、JPEG 或 WebP 图片。'));
      return;
    }
    setImageLoading(true); setImageError('');
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error(t('无法读取图片，请重试。')));
        reader.readAsDataURL(file);
      });
      if (imageReadId.current === id) setImage({ name: file.name, data });
    } catch (error) { if (imageReadId.current === id) setImageError(error instanceof Error ? error.message : t('无法读取图片，请重试。')); }
    finally { if (imageReadId.current === id) setImageLoading(false); }
  };
  const renderComposer = (capsule = false) => <div className={capsule ? 'live2d-chat-composer' : 'chat-composer p-4'}>
    <div className="live2d-chat-context">
      <div className="live2d-chat-mode-switch" role="group" aria-label={t('聊天模式')}>
        <button type="button" aria-pressed={mode === 'sentence'} disabled={!currentSentence}
          title={!currentSentence ? t('先解析一句日语，再讨论当前句子。') : undefined} onClick={() => setMode('sentence')}>{t('当前句子')}</button>
        <button type="button" aria-pressed={mode === 'free'} onClick={() => setMode('free')}>{t('自由聊天')}</button>
      </div>
      {mode === 'sentence' ? <>
        <p className="live2d-chat-sentence" lang="ja" title={currentSentence}>{currentSentence}</p>
        <p className="live2d-chat-mode-hint">{t('可以问我这句话的语法和用法。')}</p>
      </> : <p className="live2d-chat-mode-hint">{t(!currentSentence ? '先解析一句日语，再讨论当前句子。' : '自由聊天不附带当前句子。')}{' '}{t(canReadImages ? '可附加图片，直接发送给模型。' : '当前模型仅支持文本聊天')}</p>}
    </div>
    {image && <div className="live2d-chat-attachment">
      {/* Inline user-selected raster image; no remote image fetch. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.data} alt={image.name} /><span>{image.name}</span>
      <button type="button" aria-label={t('删除图片')} onClick={() => setImage(undefined)}>{Icon.xSm}</button>
    </div>}
    {imageBlocked && <p className="status-error" role="alert">{t('此对话包含图片，请切换到支持图片的模型，或清空聊天并移除附件。')}</p>}
    {!!imageError && <p className="status-error" role="alert">{imageError}</p>}
    <div className={capsule ? 'live2d-chat-composer-field' : 'chat-composer-field flex items-end gap-2'}>
      {mode === 'free' && <>
        <button type="button" className="live2d-chat-attach" disabled={!canReadImages || isLoading || imageLoading}
          aria-label={t('上传图片')} title={t(canReadImages ? '上传图片' : '当前模型仅支持文本聊天')} onClick={() => imageInputRef.current?.click()}>{Icon.plus}</button>
        <input ref={imageInputRef} type="file" accept={CHAT_IMAGE_TYPES.join(',')} hidden onChange={event => { void attachImage(event.target.files?.[0]); event.target.value = ''; }} />
      </>}
      <textarea ref={inputRef} value={inputValue} onChange={event => setInputValue(event.target.value)} onKeyDown={handleKeyDown}
        aria-label={t(capsule ? '聊天消息' : '日语问题')} placeholder={t(mode === 'sentence' ? '问问这句话的语法和用法…' : '想聊些什么…')}
        className="chat-input min-w-0 flex-1 resize-none" rows={1} disabled={isLoading} />
      <button onClick={isLoading ? () => { requestRef.current?.abort(); requestRef.current = null; setIsLoading(false); } : handleSendMessage}
        disabled={!isLoading && ((!inputValue.trim() && !image) || imageLoading || imageBlocked)}
        className={capsule ? 'live2d-chat-send' : 'nd-primary-btn chat-send-button'} type="button" aria-label={t(isLoading ? '停止生成' : '发送')} title={t(isLoading ? '停止生成' : '发送')}>
        {isLoading ? Icon.stop : !capsule ? Icon.send : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>}
      </button>
    </div>
  </div>;

  const renderChatPanel = (expanded: boolean, externalComposer = false) => (
    <>
      <div
        className="chat-toolbar flex items-center gap-2 border-b px-4 py-3"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
          {Icon.chat}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-sm font-semibold" style={{ color: 'var(--ink)' }}>{t("AI 日语助手")}</h3>
          <p className="m-0 mt-0.5 truncate text-xs" style={{ color: 'var(--ink-3)' }}>
            {t(mode === 'sentence' ? "当前句子" : "自由聊天")}
          </p>
        </div>
        <button type="button" className="dictionary-icon-btn" title={t('清空聊天')} aria-label={t('清空聊天')}
          disabled={isLoading} onClick={() => { setMessages([]); setImageError(''); }}>{Icon.trash}</button>
        <button
          onClick={expanded ? () => {
            setIsExpanded(false);
            setIsOpen(true);
          } : openExpanded}
          className="dictionary-icon-btn"
          title={expanded ? t("收缩窗口") : t("展开窗口")}
          type="button"
        >
          {expanded ? Icon.compress : Icon.expand}
        </button>
        <button
          onClick={closeChat}
          className="dictionary-icon-btn"
          title={t("关闭聊天")}
          type="button"
        >
          {Icon.xSm}
        </button>
      </div>

      <div ref={messagesScrollRef} onScroll={event => { const list = event.currentTarget; followBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48; }} className={`chat-messages min-h-0 flex-1 space-y-4 overflow-y-auto ${expanded ? 'p-6' : 'p-4'}`}>
        {messages.map((message) => {
          const isUser = message.role === 'user';
          const isRunningAssistant =
            !isUser &&
            isLoading &&
            message.id === messages[messages.length - 1]?.id;

          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`chat-message ${isUser ? 'chat-message-user' : 'chat-message-assistant'} ${expanded ? 'max-w-[80%]' : 'max-w-[90%]'}`}
              >
                <AutoAnimateHeight duration={180} contentClassName="flow-root">
                  {isUser ? (
                    <div className="whitespace-pre-wrap">
                      {message.image && <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="live2d-chat-message-image" src={message.image.data} alt={message.image.name} />
                      </>}
                      {message.content}
                    </div>
                  ) : (
                    <div className="ai-chat-markdown max-w-none">
                      {message.error ? <p className="status-error" role="alert">{errorText(message.content)}</p> : (
                        <TextMessagePartProvider text={message.welcome ? t(message.content) : message.content} isRunning={isRunningAssistant}>
                          <MarkdownText />
                        </TextMessagePartProvider>
                      )}
                    </div>
                  )}
                </AutoAnimateHeight>
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {!externalComposer && renderComposer()}
    </>
  );

  if (hidden) return null;
  if (companion && !isExpanded) return <CompanionCapsule controls={companion} open={isOpen} onOpenChange={handlePopoverOpenChange}
    composer={renderComposer(true)} panel={renderChatPanel(false, true)} />;

  return (
    <>
      {isExpanded && (
        <div
          className="chat-backdrop fixed inset-0 z-40"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {isExpanded && (
        <div
          className="chat-expanded-panel fixed z-50 flex flex-col overflow-hidden rounded-2xl"
          style={{
            top: '50%',
            left: '50%',
            width: 'min(860px, calc(100vw - 32px))',
            height: 'min(720px, calc(100dvh - 48px))',
            transform: 'translate(-50%, -50%)',
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
          }}
        >
          {renderChatPanel(true)}
        </div>
      )}

      {!isExpanded && (
        <AssistantModalPrimitive.Root
          open={isOpen}
          onOpenChange={handlePopoverOpenChange}
          unstable_openOnRunStart={false}
        >
          <AssistantModalPrimitive.Anchor className="assistant-modal-anchor">
            <AssistantModalPrimitive.Trigger asChild>
              <button
                className="nd-fab assistant-modal-trigger"
                title={t("AI 日语助手")}
                type="button"
                aria-label={isOpen ? t("关闭 AI 日语助手") : t("打开 AI 日语助手")}
              >
                <AnimatePresence initial={false} mode="wait">
                  {isOpen ? (
                    <motion.span
                      key="close"
                      className="assistant-modal-trigger-icon"
                      initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, rotate: -90, scale: 0.5 }}
                      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: -90, scale: 0.5 }}
                      transition={iconTransition}
                    >
                      {Icon.x}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="chat"
                      className="assistant-modal-trigger-icon"
                      initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, rotate: 90, scale: 0.5 }}
                      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, rotate: 0, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, rotate: 90, scale: 0.5 }}
                      transition={iconTransition}
                    >
                      {Icon.chat}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            </AssistantModalPrimitive.Trigger>
          </AssistantModalPrimitive.Anchor>

          <AssistantModalPrimitive.Content
            forceMount
            side="top"
            align="end"
            sideOffset={12}
            avoidCollisions={false}
            dissmissOnInteractOutside
            className="assistant-modal-content-positioner"
          >
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="assistant-chat-panel"
                  className="assistant-modal-panel"
                  initial={panelInitial}
                  animate={panelAnimate}
                  exit={{ ...panelExit, transition: panelExitTransition }}
                  transition={panelEnterTransition}
                  style={{ transformOrigin: 'bottom right' }}
                >
                  {renderChatPanel(false)}
                </motion.div>
              )}
            </AnimatePresence>
          </AssistantModalPrimitive.Content>
        </AssistantModalPrimitive.Root>
      )}
    </>
  );
}
