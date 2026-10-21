import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useChatSessions } from '../app/components/useChatSessions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let session: ReturnType<typeof useChatSessions>;
function Harness({ sentence }: { sentence?: string }) { session = useChatSessions(sentence); return null; }
async function main() {
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(<Harness sentence="猫がいる。" />); });
    assert.equal(session.mode, 'sentence');
    await act(async () => { session.setInputValue('猫是什么词性？'); session.setMessages([{ id: '1', role: 'user', content: '猫是什么词性？' }]); });
    const staleSentenceSetter = session.setMessages;
    await act(async () => { session.setMode('free'); });
    assert.equal(session.inputValue, ''); assert.deepEqual(session.messages, []);
    const image = { name: 'cat.png', data: 'data:image/png;base64,aGVsbG8=' };
    await act(async () => { session.setInputValue('图里是什么？'); session.setImage(image); });
    await act(async () => { session.setMode('sentence'); });
    assert.equal(session.inputValue, '猫是什么词性？'); assert.equal(session.image, undefined);
    await act(async () => { renderer!.update(<Harness sentence="犬がいる。" />); });
    assert.deepEqual(session.messages, []); assert.equal(session.inputValue, '');
    await act(async () => { staleSentenceSetter(messages => [...messages, { id: 'old', role: 'assistant', content: '迟到回复' }]); });
    assert.deepEqual(session.messages, [], 'A captured setter cannot modify another sentence session');
    await act(async () => { session.setMode('free'); });
    assert.equal(session.inputValue, '图里是什么？'); assert.deepEqual(session.image, image);
    await act(async () => { renderer!.update(<Harness />); });
    assert.equal(session.mode, 'free'); assert.equal(session.inputValue, '图里是什么？');
    console.log('Chat sessions passed: independent histories, drafts, attachments, sentence scope and stale updates.');
  } finally { if (renderer) await act(async () => { renderer!.unmount(); }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
