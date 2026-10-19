import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { LanguageProvider } from '../app/contexts/LanguageContext';
import AnalysisEngineControl, { LOCAL_CONFIRMED_KEY } from '../app/components/AnalysisEngineControl';
import { browserStorage } from '../app/utils/storage';

import ReactDOM from 'react-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
try {
  Object.defineProperty(ReactDOM, 'createPortal', { configurable: true, value: (children: React.ReactNode) => children });
} catch {}

if (typeof document === 'undefined') {
  const fakeBody = { nodeType: 1, appendChild() {}, removeChild() {}, children: [], style: { overflow: '' } };
  (globalThis as unknown as { document: unknown }).document = {
    documentElement: { lang: '' },
    body: fakeBody,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
}
if (typeof window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = {
    location: { href: 'http://localhost' },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
}
if (typeof localStorage === 'undefined') {
  (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}

import { test } from 'node:test';

test('AnalysisEngineControl confirmation persistence', async () => {
  const store = new Map<string, string>();
  browserStorage.getItem = (key: string) => store.get(key) ?? null;
  browserStorage.setItem = (key: string, value: string) => { store.set(key, value); };
  browserStorage.removeItem = (key: string) => { store.delete(key); };

  let currentEngine: 'model' | 'local' = 'model';
  let cleared = false;
  let renderer: ReactTestRenderer | undefined;

  const renderComponent = async () => {
    await act(async () => {
      if (renderer) renderer.unmount();
      renderer = create(
        <LanguageProvider>
          <AnalysisEngineControl
            value={currentEngine}
            disabled={false}
            onChange={(val) => { currentEngine = val; }}
            onClear={() => { cleared = true; }}
          />
        </LanguageProvider>
      );
    });
  };

  // 1. Initial state: model, unconfirmed
  await renderComponent();
  assert.equal(store.get(LOCAL_CONFIRMED_KEY), undefined);

  // 2. Select 'local': should pop up confirmation modal because unconfirmed & uncached
  const select = renderer!.root.findByType('select');
  await act(async () => {
    await select.props.onChange({ target: { value: 'local' } });
  });

  // Modal should be open
  const dialog = renderer!.root.findAllByProps({ role: 'dialog' });
  assert.equal(dialog.length, 1, 'Confirm modal should appear for first-time switch');

  // 3. Click confirm button inside modal
  const confirmBtn = renderer!.root.findByProps({ className: 'nd-primary-btn' });
  await act(async () => {
    confirmBtn.props.onClick();
  });

  assert.equal(currentEngine, 'local', 'Engine should change to local upon confirm');
  assert.equal(store.get(LOCAL_CONFIRMED_KEY), 'true', 'Confirmation should be saved in browser storage');

  // Re-render with value='local'
  await renderComponent();
  assert.equal(renderer!.root.findAllByProps({ role: 'dialog' }).length, 0, 'Modal should be closed');

  // 4. Switch from local to model
  currentEngine = 'model';
  await renderComponent();

  // 5. Switch back from model to local: should NOT show modal again!
  const selectAgain = renderer!.root.findByType('select');
  await act(async () => {
    await selectAgain.props.onChange({ target: { value: 'local' } });
  });

  assert.equal(currentEngine, 'local', 'Engine should switch directly to local');
  assert.equal(renderer!.root.findAllByProps({ role: 'dialog' }).length, 0, 'Modal must NOT appear again when already confirmed');

  // 6. Test onClear: clearing cache removes confirmation
  await renderComponent();
  const clearBtn = renderer!.root.findByProps({ className: 'nd-ghost-btn text-xs' });
  await act(async () => {
    clearBtn.props.onClick();
  });
  assert.equal(cleared, true);
  assert.equal(store.get(LOCAL_CONFIRMED_KEY), undefined, 'Confirmation key should be removed when cache is cleared');

  await act(async () => { renderer!.unmount(); });
  console.log('AnalysisEngineControl test passed: no repeated confirmation modal once confirmed');
});
