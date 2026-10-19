import React from 'react';
import assert from 'node:assert/strict';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { usePhraseSelection } from '../app/hooks/usePhraseSelection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function main() {
  const names = ['window', 'document', 'Node', 'Element', 'ResizeObserver', 'MutationObserver'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const handlers = new Map<string, EventListener>();
  const observers: { callback: () => void; disconnected: boolean }[] = [];
  let reads = 0;
  class TestElement {
    constructor(readonly index: number | null, public left = 0) {}
    closest() { return this.index === null ? null : this; }
    getAttribute() { return String(this.index); }
    getBoundingClientRect() { reads++; return { left: this.left, right: this.left + 20, top: 0, bottom: 20, width: 20, height: 20 }; }
  }
  const tokens = [new TestElement(0, 0), new TestElement(1, 40)];
  const container = Object.assign(new TestElement(null), {
    contains: (target: unknown) => target === container || tokens.includes(target as TestElement),
    querySelectorAll: () => tokens,
  });
  class TestObserver {
    disconnected = false;
    constructor(readonly callback: () => void) { observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  const install = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, value });
  install('Node', TestElement); install('Element', TestElement);
  install('ResizeObserver', TestObserver); install('MutationObserver', TestObserver);
  install('window', { addEventListener: (type: string, listener: EventListener) => handlers.set(type, listener), removeEventListener: (type: string) => handlers.delete(type), setTimeout, clearTimeout });
  install('document', { elementsFromPoint: () => [new TestElement(99)] });
  const ranges: number[][] = [];
  const onRangeSelect = (a: number, b: number) => { ranges.push([a, b]); };
  const onPickAnchorChange = () => undefined;
  let selection!: ReturnType<typeof usePhraseSelection>;
  let renderer: ReactTestRenderer | undefined;
  function Harness() { selection = usePhraseSelection({ onRangeSelect, anchorIndex: null, pickAnchor: null, onPickAnchorChange }); return null; }
  const pointer = (target: TestElement, x: number, y = 10) => ({ target, currentTarget: container, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y, preventDefault() {} }) as unknown as React.PointerEvent;
  const move = async (x = 50, y = 10) => { await act(async () => { selection.containerProps.onPointerMove!(pointer(container, x, y)); }); };
  try {
    await act(async () => { renderer = create(<Harness />); });
    await act(async () => { selection.containerProps.onPointerDown!(pointer(tokens[0], 10)); });
    assert.equal(reads, 2);
    await move(); await move();
    assert.equal(reads, 2, 'Pointer moves reuse all cached token rectangles');
    assert.deepEqual(selection.preview, { start: 0, end: 1 });
    for (const event of ['scroll', 'resize']) {
      const before: number = reads; handlers.get(event)!(new Event(event));
      await move(); await move();
      assert.equal(reads - before, 2, `${event} invalidates once and then caches the rebuilt rectangles`);
    }
    for (const observer of observers) {
      const before: number = reads; observer.callback(); await move(); await move();
      assert.equal(reads - before, 2, 'Layout and text changes rebuild the cache once');
    }
    // A large blank gap and tokens from unrelated containers cannot change selection.
    await move(500, 200);
    assert.deepEqual(selection.preview, { start: 0, end: 1 });
    await act(async () => { handlers.get('pointercancel')!(new Event('pointercancel')); });
    assert.equal(ranges.length, 0, 'Pointer cancellation never commits a range');
    assert.equal(selection.preview, null);
    assert.ok(observers.every(observer => observer.disconnected));
    await act(async () => { selection.containerProps.onPointerDown!(pointer(tokens[0], 10)); });
    await move();
    await act(async () => { handlers.get('pointerup')!(new Event('pointerup')); });
    assert.deepEqual(ranges, [[0, 1]]);
    console.log('Phrase selection passed: cached geometry, invalidation, bounded snapping and cancellation.');
  } finally {
    if (renderer) await act(async () => { renderer!.unmount(); });
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
