'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { TokenData } from '../services/api';
import { applyTokenEdit, sourceRange, withEditHistory, type EditState } from '../utils/analysisEditing';
import type { PhraseRange } from '../utils/phraseRange';
import type { AnalysisProgress } from '../utils/analysisSession';

export type AnalysisVariantId = 'model' | 'local' | 'local-corrected';
export type AnalysisVariantStatus = 'running' | 'complete' | 'incomplete' | 'failed';
export interface AnalysisVariant {
  id: AnalysisVariantId;
  editing: EditState;
  status: AnalysisVariantStatus;
  validated: boolean;
  sourceRevision?: number;
  sourceKey?: string;
  model?: string;
  progress?: AnalysisProgress | null;
  fromCache?: boolean;
}
export interface AnalysisWorkspace {
  source: string;
  activeVariant: AnalysisVariantId;
  variants: Partial<Record<AnalysisVariantId, AnalysisVariant>>;
}

const initialState = (taskId = 0): EditState => ({ tokens: [], initial: [], groups: [], taskId, revision: 0, history: [] });
const initialVariant = (id: AnalysisVariantId, taskId = 0): AnalysisVariant => ({ id, editing: initialState(taskId), status: 'complete', validated: false });

export function useAnalysisEditing() {
  const [workspace, setWorkspace] = useState<AnalysisWorkspace>({ source: '', activeVariant: 'model', variants: { model: initialVariant('model') } });
  const taskCounter = useRef(0);
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const active = workspace.variants[workspace.activeVariant] ?? initialVariant(workspace.activeVariant);
  const state = active.editing;
  const ref = useRef(state); ref.current = state;

  const updateWorkspace = useCallback((fn: (value: AnalysisWorkspace) => AnalysisWorkspace) => {
    setWorkspace(previous => { const next = fn(previous); workspaceRef.current = next; return next; });
  }, []);
  const updateEditing = useCallback((fn: (value: EditState) => EditState) => updateWorkspace(value => {
    const id = value.activeVariant; const variant = value.variants[id] ?? initialVariant(id, ++taskCounter.current);
    return { ...value, variants: { ...value.variants, [id]: { ...variant, editing: fn(variant.editing) } } };
  }), [updateWorkspace]);
  const nextEditing = useCallback((tokens: TokenData[]) => {
    const taskId = ++taskCounter.current;
    return { ...initialState(taskId), tokens, initial: tokens, revision: 1 };
  }, []);

  const startWorkspace = useCallback((source: string, id: AnalysisVariantId, tokens: TokenData[] = [], meta: Partial<Omit<AnalysisVariant, 'id' | 'editing'>> = {}) => {
    const variant: AnalysisVariant = { ...initialVariant(id), ...meta, id, editing: nextEditing(tokens) };
    updateWorkspace(() => ({ source, activeVariant: id, variants: { [id]: variant } }));
  }, [nextEditing, updateWorkspace]);
  const startVariant = useCallback((id: AnalysisVariantId, tokens: TokenData[], meta: Partial<Omit<AnalysisVariant, 'id' | 'editing'>> = {}, activate = true) => {
    updateWorkspace(value => ({ ...value, activeVariant: activate ? id : value.activeVariant, variants: {
      ...value.variants, [id]: { ...initialVariant(id), ...meta, id, editing: nextEditing(tokens) },
    } }));
  }, [nextEditing, updateWorkspace]);
  const selectVariant = useCallback((id: AnalysisVariantId) => updateWorkspace(value => value.variants[id] ? { ...value, activeVariant: id } : value), [updateWorkspace]);
  const updateVariant = useCallback((id: AnalysisVariantId, meta: Partial<Omit<AnalysisVariant, 'id' | 'editing'>>) => updateWorkspace(value => {
    const variant = value.variants[id]; if (!variant) return value;
    return { ...value, variants: { ...value.variants, [id]: { ...variant, ...meta } } };
  }), [updateWorkspace]);
  const setVariantTokens = useCallback((id: AnalysisVariantId, tokens: TokenData[], resetInitial = false) => updateWorkspace(value => {
    const variant = value.variants[id]; if (!variant) return value;
    const editing = resetInitial ? nextEditing(tokens) : { ...variant.editing, tokens, revision: variant.editing.revision + 1 };
    return { ...value, variants: { ...value.variants, [id]: { ...variant, editing } } };
  }), [nextEditing, updateWorkspace]);
  const clearWorkspace = useCallback(() => startWorkspace('', 'model', [], { status: 'complete', validated: false }), [startWorkspace]);

  const setTokens = useCallback((value: TokenData[] | ((tokens: TokenData[]) => TokenData[])) => updateEditing(s => {
    const tokens = typeof value === 'function' ? value(s.tokens) : value;
    return { ...s, tokens, initial: tokens, history: [], groups: [], taskId: tokens.length === 0 ? ++taskCounter.current : s.taskId, revision: s.revision + 1 };
  }), [updateEditing]);
  const startTask = useCallback((tokens: TokenData[]) => updateEditing(() => nextEditing(tokens)), [nextEditing, updateEditing]);
  const edit = useCallback((range: PhraseRange, tokens: TokenData[], taskId: number, revision: number) => updateEditing(s => s.taskId === taskId && s.revision === revision ? applyTokenEdit(s, range, tokens) : s), [updateEditing]);
  const undo = useCallback(() => updateEditing(s => { const previous = s.history.at(-1); return previous ? { ...s, ...previous, history: s.history.slice(0, -1), revision: s.revision + 1 } : s; }), [updateEditing]);
  const restore = useCallback(() => updateEditing(s => ({ ...s, tokens: s.initial, groups: [], history: [], revision: s.revision + 1 })), [updateEditing]);
  const group = useCallback((range: PhraseRange) => updateEditing(s => { const selected = sourceRange(s.tokens, range); return withEditHistory(s, s.tokens, [...s.groups.filter(g => g.end <= selected.start || g.start >= selected.end), selected]); }), [updateEditing]);
  const ungroup = useCallback((range: PhraseRange) => updateEditing(s => { const selected = sourceRange(s.tokens, range); return withEditHistory(s, s.tokens, [...s.groups.filter(g => g.end <= selected.start || g.start >= selected.end), { ...selected, suppressed: true }]); }), [updateEditing]);
  const canRestore = state.groups.length > 0 || JSON.stringify(state.tokens) !== JSON.stringify(state.initial);
  const variants = workspace.variants;
  const variantList = useMemo(() => Object.values(variants).filter(Boolean) as AnalysisVariant[], [variants]);
  return { state, ref, setTokens, startTask, edit, undo, restore, group, ungroup, canRestore,
    workspace, workspaceRef, activeVariant: workspace.activeVariant, variant: active, variants, variantList,
    startWorkspace, startVariant, selectVariant, updateVariant, setVariantTokens, clearWorkspace };
}
