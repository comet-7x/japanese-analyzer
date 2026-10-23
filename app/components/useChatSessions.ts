'use client';

import { useCallback, useState, type SetStateAction } from 'react';
import type { ChatMode } from '../lib/chatMessages';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  welcome?: boolean;
  error?: boolean;
  image?: { name: string; data: string };
}
interface Session { messages: ChatMessage[]; input: string; image?: ChatMessage['image'] }
const EMPTY: Session = { messages: [], input: '' };

/** Sentence histories are scoped to the committed source; free chat keeps its own draft and attachment. */
export function useChatSessions(sentence?: string) {
  const [selectedMode, setMode] = useState<ChatMode | null>(null);
  const mode: ChatMode = selectedMode === 'free' || !sentence ? 'free' : 'sentence';
  const key = mode === 'free' ? 'free' : `sentence:${sentence}`;
  const [sessions, setSessions] = useState<Record<string, Session>>({});
  const session = sessions[key] ?? EMPTY;
  const update = useCallback(<K extends keyof Session>(field: K, action: SetStateAction<Session[K]>) => {
    setSessions(current => {
      const previous = current[key] ?? EMPTY;
      const value = typeof action === 'function'
        ? (action as (value: Session[K]) => Session[K])(previous[field]) : action;
      return { ...current, [key]: { ...previous, [field]: value } };
    });
  }, [key]);
  const setMessages = useCallback((value: SetStateAction<ChatMessage[]>) => update('messages', value), [update]);
  const setInputValue = useCallback((value: SetStateAction<string>) => update('input', value), [update]);
  const setImage = useCallback((value: SetStateAction<ChatMessage['image']>) => update('image', value), [update]);
  return { key, mode, setMode, messages: session.messages, setMessages, inputValue: session.input, setInputValue, image: session.image, setImage };
}
