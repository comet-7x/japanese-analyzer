"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
} from "react";
import type { Live2DModel, CubismInternalModel } from "untitled-pixi-live2d-engine/cubism";

import { sampleSpeechEnvelope, type SpeechEnvelope } from './audioEnvelope';
import type { SpeechPlaybackSnapshot } from '../../lib/speechPlaybackStore';
import { Live2DRuntime } from './runtime';
import { ExpressionQueue, smoothValue, type CompanionMood } from './companion';
import { ensureMaskResolution, planRenderQuality } from './renderQuality';
import { guardStageBackgroundSelection } from './selectionGuard';
import { visibleAlphaBounds, visibleBaseCenter } from './visualBounds';
import { type InteractionPart } from './interaction';
import { detectLive2DCapabilities, type Live2DCapabilities } from './capabilities';

import { idleResources, IdlePlaylist, automaticTargetAction } from './resourceConfig';
import { ExpressionLifecycle } from './expressionLifecycle';
import { emptyActionProfile, ActionCommandGate, resolveActionBinding, resolvePartAction, resolvePointerTarget, resolveShortcutAction, type ActionProfile, type ActionResolution } from './actionProfile';

export type ActionPlaybackState = { actionId: string | null; status: 'loading' | 'playing' | 'finished' | 'stopped' | 'error'; error?: string };
export type ModelProjection = { a: number; b: number; c: number; d: number; tx: number; ty: number };

const CORE_URL = "/live2d/core/live2dcubismcore.min.js";
const DEFAULT_MOUTH_PARAMETER = "ParamMouthOpenY";

let coreLoadPromise: Promise<void> | null = null;
let renderPipeRegistered = false;

type CoreWindow = Window & { Live2DCubismCore?: unknown };

function loadCubismCore(): Promise<void> {
  if ((window as CoreWindow).Live2DCubismCore) return Promise.resolve();
  if (coreLoadPromise) return coreLoadPromise;

  coreLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CORE_URL;
    script.async = true;
    script.dataset.live2dCore = "true";
    script.onload = () => {
      if ((window as CoreWindow).Live2DCubismCore) {
        resolve();
      } else {
        script.remove();
        reject(new Error("Live2D Cubism Core did not initialize."));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(
        new Error(
          `Live2D Cubism Core is unavailable at ${CORE_URL}. Obtain it from the official Cubism SDK for Web.`,
        ),
      );
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    coreLoadPromise = null;
    throw error;
  });

  return coreLoadPromise;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export type Live2DCanvasSource = string | File[] | null;

export interface Live2DCanvasProps {
  source: Live2DCanvasSource;
  onReady?: () => void;
  onVisualCenterChange?: (normalizedX: number) => void;
  interactionProfile?: ActionProfile;
  preview?: boolean;
  testBehaviors?: boolean;
  testCompanion?: boolean;
  repeatActionId?: string | null;
  onActionState?: (state: ActionPlaybackState) => void;
  onHitFeedback?: (target: string | null, resolution: ActionResolution, overlaps: number) => void;
  onError?: (error: Error) => void;
  trackPointer?: boolean;
  dragging?: boolean;
  pauseWhenIdle?: boolean;
  mood?: CompanionMood;
  speech?: SpeechPlaybackSnapshot | null;
  envelope?: SpeechEnvelope | null;
  lipSync?: boolean;
  sensitivity?: number;
  className?: string;
  style?: CSSProperties;
}

export interface Live2DCanvasHandle {
  playAction(id: string): Promise<boolean>;
  stopAction(): void;
  resetPose(): void;
  triggerShortcut(key: string): boolean;
  triggerTarget(target: string): Promise<boolean>;
  clientToModel(x: number, y: number): { x: number; y: number } | null;
  getProjection(): ModelProjection | null;
  setMouthOpen(value: number): void;
  playMotion(group: string, index?: number): Promise<boolean>;
  setExpression(id: string): Promise<boolean>;
  playInteraction(part?: InteractionPart): Promise<boolean>;
  tapAt(clientX: number, clientY: number): Promise<boolean>;
  getCapabilities(): Live2DCapabilities | null;
  wakeRenderer(): void;
}

const POSE_IDS = ['ParamAngleZ', 'ParamEyeBallY', 'ParamBrowLY', 'ParamBrowRY'];
const MOOD_TARGETS: Record<CompanionMood, number[]> = {
  idle: [0, 0, 0, 0], analyzing: [7, 0.2, 0.05, 0.05],
  success: [0, 0, 0.15, 0.15], error: [-4, -0.15, -0.2, -0.2],
};

const Live2DCanvas = forwardRef<Live2DCanvasHandle, Live2DCanvasProps>(function Live2DCanvas(props, ref) {
  const { source, className, style } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const controlsRef = useRef<Live2DCanvasHandle | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);

  useImperativeHandle(ref, () => ({
    playAction: id => controlsRef.current?.playAction(id) ?? Promise.resolve(false),
    stopAction: () => controlsRef.current?.stopAction(),
    resetPose: () => controlsRef.current?.resetPose(),
    triggerTarget: target => controlsRef.current?.triggerTarget(target) ?? Promise.resolve(false),
    triggerShortcut: key => controlsRef.current?.triggerShortcut(key) ?? false,
    clientToModel: (x, y) => controlsRef.current?.clientToModel(x, y) ?? null,
    getProjection: () => controlsRef.current?.getProjection() ?? null,
    setMouthOpen: value => controlsRef.current?.setMouthOpen(value),
    playMotion: (group, index) => controlsRef.current?.playMotion(group, index) ?? Promise.resolve(false),
    setExpression: id => controlsRef.current?.setExpression(id) ?? Promise.resolve(false),
    playInteraction: part => controlsRef.current?.playInteraction(part) ?? Promise.resolve(false),
    tapAt: (x, y) => controlsRef.current?.tapAt(x, y) ?? Promise.resolve(false),
    getCapabilities: () => controlsRef.current?.getCapabilities() ?? null,
    wakeRenderer: () => controlsRef.current?.wakeRenderer(),
  }), []);

  useEffect(() => { refreshRef.current?.(); }, [props.trackPointer, props.mood, props.speech,
    props.envelope, props.lipSync, props.sensitivity, props.pauseWhenIdle, props.dragging, props.interactionProfile, props.testBehaviors, props.testCompanion]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !source) return;
    let disposed = false;
    let initialized = false;
    let app: import('pixi.js').Application | null = null;
    let model: Live2DModel | null = null;
    let runtime: Live2DRuntime | null = null;
    let expressions: ExpressionQueue | null = null;
    let releaseModel: ((model: Live2DModel) => Promise<void>) | null = null;
    const cleanups: Array<() => void> = [];

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      runtime?.destroy();
      expressions?.destroy();
      cleanups.forEach(cleanup => cleanup());
      controlsRef.current = null;
      refreshRef.current = null;
      const ownedApp = app;
      if (initialized) { ownedApp?.stop(); ownedApp?.canvas.remove(); }
      let released = Promise.resolve();
      if (model) {
        ownedApp?.stage.removeChild(model);
        released = releaseModel?.(model) ?? released;
        model = null;
      }
      if (initialized && ownedApp) {
        // Renderer destruction can destroy bound GPU sources. Unload Assets first.
        void released.then(() => ownedApp.destroy(true, { children: true, texture: true, textureSource: true }));
        app = null;
      }
    };

    const initialize = async () => {
      await loadCubismCore();
      if (disposed) return;
      // Official Pixi CSP implementation: replace generated functions before renderer init.
      // Despite the module name, this removes the need for script-src 'unsafe-eval'.
      await import('pixi.js/unsafe-eval');
      const [{ Application, Assets, Point, extensions, UPDATE_PRIORITY }, engine] = await Promise.all([
        import('pixi.js'), import('untitled-pixi-live2d-engine/cubism'),
      ]);
      if (disposed) return;
      releaseModel = item => {
        const urls = item.internalModel.settings.textures.map(path => item.internalModel.settings.resolveURL(path));
        // Assets owns the texture cache. The model owns its renderer, core and automator.
        item.destroy({ children: true });
        return Assets.unload(urls).catch(error => {
          if (process.env.NODE_ENV !== 'production') console.warn('Live2D texture unload failed', error);
        });
      };
      if (!renderPipeRegistered) { extensions.add(engine.Live2DPlugin); renderPipeRegistered = true; }
      const nextApp = new Application();
      app = nextApp;
      const initialRect = container.getBoundingClientRect();
      // Start within WebGL's conservative minimum limit; use actual GPU limits after init.
      const initialQuality = planRenderQuality(initialRect.width, initialRect.height, window.devicePixelRatio, 2048, window.visualViewport?.scale);
      await nextApp.init({ width: initialQuality.width, height: initialQuality.height, preference: 'webgl', backgroundAlpha: 0,
        antialias: true, autoDensity: true, resolution: initialQuality.resolution,
        sharedTicker: false, autoStart: false });
      initialized = true;
      if (disposed) { nextApp.destroy(true, { children: true, texture: true, textureSource: true }); app = null; return; }
      nextApp.canvas.style.width = '100%';
      nextApp.canvas.style.height = '100%';
      container.appendChild(nextApp.canvas);
      // File[] is supported at runtime but omitted by the engine declaration.
      const factory = engine.Live2DModel as unknown as {
        from(source: string | File[], options: { ticker: typeof nextApp.ticker; autoUpdate: boolean;
          autoFocus: boolean; autoHitTest: boolean }): Promise<Live2DModel>;
      };
      const nextModel = await factory.from(source, { ticker: nextApp.ticker,
        autoUpdate: false, autoFocus: false, autoHitTest: false });
      if (disposed) { void releaseModel(nextModel); return; }
      model = nextModel;
      const internal = nextModel.internalModel as CubismInternalModel;
      const core = internal.coreModel;
      nextModel.anchor.set(0.5, 1);
      nextApp.stage.addChild(nextModel);
      const gl = (nextApp.renderer as import('pixi.js').WebGLRenderer).gl;
      const maxBufferEdge = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096);

      const declaredIds = internal.settings.getLipSyncParameters?.() ?? [];
      const mouthIds = declaredIds.length ? declaredIds : [DEFAULT_MOUTH_PARAMETER];
      const parameters = Array.from({ length: core.getParameterCount() }, (_, index) => ({
        index, id: core.getParameterId(index), min: core.getParameterMinimumValue(index),
        max: core.getParameterMaximumValue(index),
      }));
      const mouthParameters = parameters.filter(p => mouthIds.some(id => p.id.isEqual(id)));
      const poseParameters = POSE_IDS.map(id => parameters.find(p => p.id.isEqual(id)));
      const pose = [0, 0, 0, 0];
      let mouth = 0;
      let wasSpeaking = false;
      let manualMouth: number | null = null;
      
      let currentMood: CompanionMood | undefined;
      let currentProfile: ActionProfile | undefined;
      let expressionUntil = 0;
      let inViewport = true;

      const writeParameters = () => {
        for (const [slot, parameter] of poseParameters.entries()) {
          if (!parameter || Math.abs(pose[slot]) < 0.001) continue;
          const base = core.getParameterValueByIndex(parameter.index);
          core.setParameterValueByIndex(parameter.index, Math.max(parameter.min, Math.min(parameter.max, base + pose[slot])));
        }
        const speaking = propsRef.current.lipSync !== false && propsRef.current.speech?.status === 'playing';
        if (speaking || wasSpeaking || manualMouth !== null) {
          for (const p of mouthParameters) core.setParameterValueByIndex(p.index,
            Math.max(p.min, Math.min(p.max, manualMouth ?? mouth)));
        }
        wasSpeaking = speaking;
      };
      internal.on('beforeModelUpdate', writeParameters);
      cleanups.push(() => internal.off('beforeModelUpdate', writeParameters));

      runtime = new Live2DRuntime(mode => {
        if (mode === 'paused') nextApp.stop();
        else { nextApp.ticker.maxFPS = mode === 'active' ? 60 : 15; nextApp.start(); }
        container.dataset.renderMode = mode;
      }, propsRef.current.pauseWhenIdle);

      const manager = internal.motionManager;
      const expressionManager = manager.expressionManager;
      // Disable the SDK's random idle requester; this instance owns exactly one playlist.
      (manager.groups as { idle: string }).idle = '';
      const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
      const idlePlaylist = new IdlePlaylist();
      let idleRevision = 0, idleStarting = false, idleUntil = 0, idlePlaying = false;
      let profileSignature = '';
      const currentConfig = () => propsRef.current.interactionProfile ?? emptyActionProfile();
      // This manager belongs to this preview only. Never change the engine global sound/idle configuration.
      if (propsRef.current.preview) {
        (manager.groups as { idle: string }).idle = '';
        manager.stopAllMotions();
        // Suppress this instance's sound declarations as well as volume. The engine
        // otherwise waits for audio inside motion(), beyond our cancellable load gate.
        for (const definitions of Object.values(manager.definitions)) {
          for (const definition of definitions ?? []) delete definition.Sound;
        }
      }
      const commandGate = new ActionCommandGate();
      cleanups.push(() => commandGate.cancel());
      let manualBusy = false;
      let companionMotion: string | null = null;
      let playback: string | null = null;
      let starting = false;
      let commandNumber = 0;
      const capabilities = detectLive2DCapabilities({
        areas: Object.keys(internal.hitAreas).filter(name => {
          const area = internal.hitAreas[name];
          return area.index >= 0 || !!area.id && internal.getDrawableIndex(area.id) >= 0;
        }),
        motions: manager.definitions,
        expressions: expressionManager?.definitions.map(definition => definition.Name) ?? [],
        expressionDefinitions: expressionManager?.definitions,
      });
      const expressionIndex = (id: string) => { const resource = capabilities.actions.find(item => item.kind === 'expression' && item.id === id); return resource?.index ?? expressionManager?.definitions.findIndex(definition => definition.Name === id) ?? -1; };
      expressions = new ExpressionQueue(async id => {
        if (!expressionManager) return;
        const index = expressionIndex(id);
        if (index >= 0 && !expressionManager.expressions[index]) {
          const expression = await engine.Live2DFactory.loadExpression(expressionManager, index);
          if (!disposed && expression) expressionManager.expressions[index] = expression;
        }
      }, id => {
        if (disposed) return Promise.resolve(false);
        container.dataset.expression = id;
        return nextModel.expression(expressionIndex(id));
      }, () => {
        if (!expressionManager || disposed) return;
        expressionManager.reserveExpressionIndex = -1;
        // The engine may restore currentExpression after a motion. Reset that baseline too.
        expressionManager.currentExpression = expressionManager.defaultExpression;
        expressionManager.resetExpression();
        delete container.dataset.expression;
      }, () => { expressionUntil = performance.now() + 1200; runtime?.setVisible(!document.hidden && inViewport); runtime?.wake(); },
      () => { if (expressionManager) expressionManager.reserveExpressionIndex = -1; });

      const expressionLife = new ExpressionLifecycle(id => expressions?.set(id), () => currentConfig().defaultExpression);
      cleanups.push(() => { idleRevision++; expressionLife.destroy(); });

      // Calibrate the resting artwork once. Its transparent margins need not be symmetric.
      // Retain the offset in model units so resizes do not sample an animated pose.
      let visualCenterOffset = 0;
      let fit = 1;
      let baseMeshCenter: (() => number | null) | null = null;
      let lastPublishedCenter = NaN;
      const publishVisualCenter = () => {
        const center = clampUnit(((baseMeshCenter?.() ?? nextApp.screen.width / 2) + visualCenterOffset * fit) / nextApp.screen.width);
        if (Math.abs(center - lastPublishedCenter) * nextApp.screen.width < .15) return;
        lastPublishedCenter = center;
        container.dataset.visualCenter = String(center);
        propsRef.current.onVisualCenterChange?.(center);
      };
      const layout = () => {
        if (disposed) return;
        const rect = container.getBoundingClientRect();
        const quality = planRenderQuality(rect.width, rect.height, window.devicePixelRatio, maxBufferEdge, window.visualViewport?.scale);
        // Preserve fractional CSS sizes and update density on browser zoom / monitor changes.
        if (Math.abs(nextApp.screen.width - quality.width) > .001 || Math.abs(nextApp.screen.height - quality.height) > .001
          || nextApp.renderer.resolution !== quality.resolution) {
          nextApp.renderer.resize(quality.width, quality.height, quality.resolution);
          // Pixi writes rounded CSS dimensions when resizing; keep the stage responsive.
          nextApp.canvas.style.width = '100%';
          nextApp.canvas.style.height = '100%';
        }
        // The SDK's small default mask atlas can soften masked details at large sizes.
        // Grow in coarse buckets only; reallocating it on every slider tick is expensive.
        if (core.isUsingMasking()) ensureMaskResolution(internal.renderer, quality.maskSize,
          (nextApp.renderer as import('pixi.js').WebGLRenderer).gl);
        container.dataset.renderResolution = String(quality.resolution);
        container.dataset.maskResolution = String(core.isUsingMasking() ? internal.renderer.getClippingMaskBufferSize() : 0);
        fit = Math.min(nextApp.screen.width / Math.max(1, internal.originalWidth),
          nextApp.screen.height * 0.92 / Math.max(1, internal.originalHeight));
        nextModel.scale.set(fit);
        nextModel.position.set(nextApp.screen.width / 2, nextApp.screen.height);
        publishVisualCenter();
        // Resizing must redraw even when reduced motion keeps the ticker paused.
        if (motionPreference.matches) { nextModel.update(0); nextApp.render(); }
        runtime?.wake();
      };
      let layoutFrame = 0;
      const requestLayout = () => {
        if (!layoutFrame) layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; layout(); });
      };
      let densityQuery: MediaQueryList;
      const densityChanged = () => {
        densityQuery?.removeEventListener('change', densityChanged);
        densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        densityQuery.addEventListener('change', densityChanged);
        requestLayout();
      };
      densityChanged();
      const resizeObserver = new ResizeObserver(requestLayout);
      resizeObserver.observe(container);
      window.addEventListener('resize', requestLayout);
      window.visualViewport?.addEventListener('resize', requestLayout);
      cleanups.push(() => {
        resizeObserver.disconnect(); cancelAnimationFrame(layoutFrame);
        densityQuery.removeEventListener('change', densityChanged);
        window.removeEventListener('resize', requestLayout);
        window.visualViewport?.removeEventListener('resize', requestLayout);
      });

      const publish = (status: ActionPlaybackState['status'], actionId = playback, error?: string) => {
        if (disposed) return;
        container.dataset.actionState = status;
        propsRef.current.onActionState?.({ actionId, status, error });
      };
      const stopAction = () => {
        idleRevision++; idleStarting = false; idlePlaying = false; idleUntil = performance.now() + currentConfig().idle.interval * 1000;
        expressionLife.reset();
        commandNumber++; commandGate.cancel(); starting = false; manualBusy = false; playback = null;
        manager.stopAllMotions(); manager.stopSpeaking();
        publish('stopped'); runtime?.wake();
      };
      const resetPose = () => {
        stopAction();
        for (const parameter of parameters) core.setParameterValueByIndex(parameter.index, core.getParameterDefaultValue(parameter.index));
        core.saveParameters(); pose.fill(0); internal.focusController.focus(0, 0); runtime?.wake();
      };
      const playAction = async (id: string, manual = true, target?: string) => {
        const action = capabilities.actions.find(item => item.id === id);
        if (disposed || !action || !manual && manualBusy) return false;
        idleRevision++; idleStarting = false; idlePlaying = false;
        const request = ++commandNumber;
        manualBusy = manual; starting = true; playback = id;
        companionMotion = !manual && target === 'mood:analyzing' && action.kind === 'motion' ? id : null;
        manager.stopAllMotions(); manager.stopSpeaking();
        if (action.kind === 'motion') expressionLife.reset();
        publish('loading', id); runtime?.setVisible(!document.hidden && inViewport); runtime?.wake();
        try {
          const started = await commandGate.run(async () => {
            if (action.kind === 'motion') return !!await manager.loadMotion(action.group, action.index);
            if (!expressionManager) return false;
            if (!expressionManager.expressions[action.index]) {
              const expression = await engine.Live2DFactory.loadExpression(expressionManager, action.index);
              if (!disposed && expression) expressionManager.expressions[action.index] = expression;
            }
            return !!expressionManager.expressions[action.index];
          }, async () => {
            if (disposed) return false;
            return action.kind === 'motion'
              ? nextModel.motion(action.group, action.index, manual ? 3 : 2,
                { loop: false, volume: propsRef.current.preview ? 0 : undefined })
              : nextModel.expression(action.index).then(started => started || expressionManager?.currentExpression === expressionManager?.expressions[action.index]);
          });
          if (!disposed && request === commandNumber) {
            starting = false;
            if (started) {
              publish('playing', id);
              container.dataset.previewPlayCount = String(Number(container.dataset.previewPlayCount ?? 0) + 1);
              if (action.kind === 'expression') {
                const policy = currentConfig().expressionPolicies[target ?? action.id] ?? currentConfig().expressionPolicies[action.id] ?? { mode: 'timed', seconds: 3.5 };
                const mode = target?.startsWith('mood:') ? policy.mode === 'event' ? 'event' : 'timed' : policy.mode === 'event' ? 'timed' : policy.mode;
                expressionUntil = mode === 'timed' ? performance.now() + policy.seconds * 1000 : 0;
                expressionLife.activate(action.id, mode, policy.seconds, () => {
                  if (disposed || request !== commandNumber) return;
                  manualBusy = false; publish('finished', id); playback = null; runtime?.wake();
                });
              }
            } else { manualBusy = false; playback = null; publish('error', id, '资源无法播放，请检查模型文件。'); }
            runtime?.wake();
          }
          return started;
        } catch (error) {
          if (!disposed && request === commandNumber) { starting = false; manualBusy = false; playback = null; publish('error', id, toError(error).message); }
          return false;
        }
      };
      const playMotion = (group: string, index?: number) => {
        const items = capabilities.actions.filter(item => item.kind === 'motion' && item.group === group);
        const action = index === undefined ? items[Math.floor(Math.random() * items.length)] : items.find(item => item.index === index);
        return action ? playAction(action.id) : Promise.resolve(false);
      };
      const dispatch = async (result: ActionResolution, target?: string) => {
        if (result.status !== 'action' || disposed || propsRef.current.dragging) return false;
        const started = await playAction(result.action.id, true, target);
        if (started && !disposed) {
          container.dataset.interactionMotion = result.action.group;
          container.dataset.interactionCount = String(Number(container.dataset.interactionCount ?? 0) + 1);
        }
        return started;
      };
      const playInteraction = (part?: InteractionPart) => dispatch(resolvePartAction(propsRef.current.interactionProfile, part, capabilities));
      const clientToModel = (clientX: number, clientY: number) => {
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const point = nextModel.toModelPosition(new Point((clientX - rect.left) / rect.width * nextApp.screen.width,
          (clientY - rect.top) / rect.height * nextApp.screen.height));
        return { x: point.x / internal.originalWidth, y: point.y / internal.originalHeight };
      };
      const getProjection = () => {
        const rect = container.getBoundingClientRect();
        const project = (x: number, y: number) => {
          const local = internal.localTransform.apply(new Point(x * internal.originalWidth, y * internal.originalHeight));
          const point = nextModel.toGlobal(local);
          return { x: point.x * rect.width / nextApp.screen.width, y: point.y * rect.height / nextApp.screen.height };
        };
        const origin = project(0, 0), x = project(1, 0), y = project(0, 1);
        return { a: x.x - origin.x, b: x.y - origin.y, c: y.x - origin.x, d: y.y - origin.y, tx: origin.x, ty: origin.y };
      };
      const tapAt = (clientX: number, clientY: number) => {
        const rect = container.getBoundingClientRect();
        const point = clientToModel(clientX, clientY);
        if (!point || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return Promise.resolve(false);
        const areas = nextModel.hitTest((clientX - rect.left) / rect.width * nextApp.screen.width,
          (clientY - rect.top) / rect.height * nextApp.screen.height);
        const config = currentConfig();
        const hit = resolvePointerTarget(config, point, areas, capabilities);
        const overlaps = config.hotspots.filter(item => point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height).length;
        propsRef.current.onHitFeedback?.(hit.target, hit.resolution, overlaps);
        return dispatch(hit.resolution, hit.target ?? undefined);
      };
      controlsRef.current = {
        playAction, stopAction, resetPose, clientToModel, getProjection,
        triggerTarget(target) {
          const config = currentConfig();
          return target.startsWith('key:') ? dispatch(resolveShortcutAction(config, target.slice(4), capabilities) ?? { status: 'none' }, target)
            : dispatch(resolveActionBinding(config, target, capabilities, automaticTargetAction(target, config, capabilities)), target);
        },
        triggerShortcut(key) {
          const result = resolveShortcutAction(propsRef.current.interactionProfile, key, capabilities);
          if (!result) return false;
          void dispatch(result, `key:${key}`); return true;
        },
        setMouthOpen(value) { manualMouth = clampUnit(value); runtime?.wake(); },
        playMotion,
        async setExpression(id) {
          const action = capabilities.actions.find(item => item.kind === 'expression' && item.group === id);
          return action ? playAction(action.id) : false;
        },
        playInteraction, tapAt,
        getCapabilities: () => capabilities,
        wakeRenderer() { runtime?.wake(); },
      };

      const refresh = () => {
        const latest = propsRef.current;
        if (latest.speech?.status === 'playing') runtime?.setVisible(!document.hidden && inViewport);
        runtime?.setPauseWhenIdle(latest.pauseWhenIdle === true);
        if (!latest.trackPointer) internal.focusController.focus(0, 0);
        const signature = JSON.stringify([currentConfig().idle, currentConfig().defaultExpression, latest.testBehaviors]);
        if (signature !== profileSignature) {
          profileSignature = signature; idleRevision++; idleStarting = false; idlePlaylist.reset();
          idleUntil = 0; if (idlePlaying) { manager.stopAllMotions(); idlePlaying = false; }
          expressionLife.reset();
        }
        const mood = latest.mood ?? 'idle';
        if (mood !== currentMood || latest.interactionProfile !== currentProfile) {
          currentMood = mood;
          currentProfile = latest.interactionProfile;
          if (!manualBusy && (!latest.preview || latest.testCompanion)) {
            // Cancel pending companion loads as well as already playing motions.
            if (playback) publish('stopped');
            commandNumber++; commandGate.cancel(); starting = false; playback = null; manager.stopAllMotions(); companionMotion = null;
            expressionLife.reset();
            const detected = mood === 'idle' ? null : capabilities.moods[mood];
            const auto = capabilities.actions.find(item => detected?.expression ? item.kind === 'expression' && item.group === detected.expression : item.kind === 'motion' && item.group === detected?.motion);
            const result = resolveActionBinding(latest.interactionProfile, `mood:${mood}`, capabilities, auto);
            if (result.status === 'action') void playAction(result.action.id, false, `mood:${mood}`);
            else expressionLife.reset();
          }
        }
        runtime?.wake();
      };
      refreshRef.current = refresh;

      const update = () => {
        const latest = propsRef.current;
        const frameDt = Math.min(100, nextApp.ticker.deltaMS) / 1000;
        const moodMode = latest.interactionProfile?.bindings[`mood:${latest.mood}`]?.mode;
        const targets = MOOD_TARGETS[manualBusy || latest.preview || moodMode && moodMode !== 'auto' ? 'idle' : latest.mood ?? 'idle'];
        let poseMoving = false;
        pose.forEach((value, index) => {
          pose[index] = smoothValue(value, targets[index], frameDt);
          if (Math.abs(pose[index] - targets[index]) < 0.001) pose[index] = targets[index];
          else poseMoving = true;
        });
        const speech = latest.speech;
        const speaking = latest.lipSync !== false && speech?.status === 'playing';
        mouth = speaking && speech.source === 'audio' && speech.audio && latest.envelope
          ? sampleSpeechEnvelope(latest.envelope, speech.audio.currentTime, latest.sensitivity)
          : speaking && speech.source === 'system' ? 0.25 + 0.2 * Math.abs(Math.sin(performance.now() / 105)) : 0;
        nextModel.update(frameDt * 1000);
        if (baseMeshCenter) publishVisualCenter();
        // Startup promises are not completion promises; inspect current/reserved priorities.
        const state = manager.state;
        const activeMotion = !manager.isFinished() && state.currentPriority > 1 || state.reservePriority > 1
          || internal.parallelMotionManager.some(manager => !manager.isFinished());
        if (playback && !starting && !activeMotion && capabilities.actions.find(item => item.id === playback)?.kind === 'motion') {
          const repeat = latest.preview && latest.repeatActionId === playback ? playback : companionMotion === playback && latest.mood === 'analyzing' ? companionMotion : null;
          publish('finished'); playback = null; manualBusy = false;
          if (repeat) void playAction(repeat, latest.preview === true, latest.preview ? undefined : 'mood:analyzing');
        }
        if (idlePlaying && manager.isFinished()) { idlePlaying = false; idleUntil = performance.now() + currentConfig().idle.interval * 1000; }
        const config = currentConfig();
        const manualMotion = manualBusy && capabilities.actions.find(item => item.id === playback)?.kind === 'motion';
        if ((!motionPreference.matches || latest.testBehaviors) && (!latest.preview || latest.testBehaviors) && !speaking && (latest.mood ?? 'idle') === 'idle'
          && !manualMotion && !starting && !activeMotion && manager.isFinished() && !idleStarting && performance.now() >= idleUntil) {
          const action = idlePlaylist.next(idleResources(config, capabilities), config.idle.order);
          if (action) {
            const request = ++idleRevision; idleStarting = true;
            void manager.loadMotion(action.group, action.index).then(async loaded => {
              if (disposed || request !== idleRevision) return;
              if (!loaded) { idlePlaylist.reject(action.id); idleUntil = performance.now() + 500; return; }
              const started = await nextModel.motion(action.group, action.index, 1, { loop: false, volume: latest.preview ? 0 : undefined });
              if (disposed || request !== idleRevision) return;
              idlePlaying = started;
              if (started) { container.dataset.idleAction = action.id; container.dataset.idlePlayCount = String(Number(container.dataset.idlePlayCount ?? 0) + 1); }
              if (!started) { idlePlaylist.reject(action.id); idleUntil = performance.now() + 500; }
            }).catch(() => { if (request === idleRevision) { idlePlaylist.reject(action.id); idleUntil = performance.now() + 500; } })
              .finally(() => { if (request === idleRevision) idleStarting = false; });
          }
        }
        runtime?.setBusy(Boolean(speaking || latest.dragging || starting || activeMotion || poseMoving
          || performance.now() < expressionUntil));
        if (motionPreference.matches) runtime?.setVisible(!document.hidden && inViewport && Boolean(speaking || starting || activeMotion || latest.testBehaviors || performance.now() < expressionUntil));
      };
      nextApp.ticker.add(update, undefined, UPDATE_PRIORITY.HIGH);
      cleanups.push(() => nextApp.ticker.remove(update));

      const pointerMove = (event: PointerEvent) => {
        if (motionPreference.matches || !propsRef.current.trackPointer || document.hidden || !inViewport || event.pointerType === 'touch') return;
        const rect = container.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        internal.focusController.focus(clampUnit((event.clientX - rect.left) / rect.width) * 2 - 1,
          1 - clampUnit((event.clientY - rect.top) / rect.height) * 2);
        runtime?.wake();
      };
      const pointerLeave = () => { internal.focusController.focus(0, 0); runtime?.wake(); };
      const visibility = () => runtime?.setVisible(!document.hidden && inViewport && (!motionPreference.matches || starting || manualBusy || !!propsRef.current.speech && propsRef.current.speech.status === 'playing'));
      motionPreference.addEventListener('change', visibility);
      cleanups.push(() => motionPreference.removeEventListener('change', visibility));
      const focus = () => { visibility(); runtime?.wake(); };
      const readingSelectionGuard = (event: MouseEvent) => {
        guardStageBackgroundSelection(event, container);
      };
      document.addEventListener('pointermove', pointerMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', pointerLeave);
      document.addEventListener('visibilitychange', visibility);
      document.addEventListener('pointerdown', readingSelectionGuard, true);
      document.addEventListener('mousedown', readingSelectionGuard, true);
      window.addEventListener('focus', focus);
      const observer = new IntersectionObserver(entries => {
        inViewport = entries[0]?.isIntersecting ?? false;
        visibility();
      });
      observer.observe(container);
      cleanups.push(() => {
        observer.disconnect();
        document.removeEventListener('pointermove', pointerMove);
        document.documentElement.removeEventListener('pointerleave', pointerLeave);
        document.removeEventListener('visibilitychange', visibility);
        document.removeEventListener('pointerdown', readingSelectionGuard, true);
        document.removeEventListener('mousedown', readingSelectionGuard, true);
        window.removeEventListener('focus', focus);
      });
      layout();
      if (motionPreference.matches) { nextModel.update(0); nextApp.render(); visibility(); }
      if (propsRef.current.onVisualCenterChange) {
        try {
          nextModel.update(0);
          // Read immediately after render: WebGL does not preserve the drawing buffer.
          // This bounded CPU copy runs once per model, never in the animation ticker.
          nextApp.render();
          const ratio = Math.min(1, 512 / nextApp.screen.width, 1024 / nextApp.screen.height);
          const sample = document.createElement('canvas');
          sample.width = Math.max(1, Math.round(nextApp.screen.width * ratio));
          sample.height = Math.max(1, Math.round(nextApp.screen.height * ratio));
          const context = sample.getContext('2d', { willReadFrequently: true });
          if (context) {
            context.drawImage(nextApp.canvas, 0, 0, sample.width, sample.height);
            const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
            const baseCenter = visibleBaseCenter(pixels, sample.width, sample.height);
            const artwork = visibleAlphaBounds(pixels, sample.width, sample.height);
            if (baseCenter !== null) {
              const center = baseCenter * nextApp.screen.width;
              // Cache only the vertices at the standing base. Track their movement without
              // reading GPU pixels or scanning the complete model again on every frame.
              const baseVertices: Array<{ drawable: number; offsets: number[] }> = [];
              const projection = getProjection();
              const project = (vertices: Float32Array, offset: number, matrix: ModelProjection) => {
                const x = (vertices[offset] * internal.pixelsPerUnit + internal.originalWidth / 2) / internal.originalWidth;
                const y = (-vertices[offset + 1] * internal.pixelsPerUnit + internal.originalHeight / 2) / internal.originalHeight;
                return { x: matrix.a * x + matrix.c * y + matrix.tx, y: matrix.b * x + matrix.d * y + matrix.ty };
              };
              if (artwork) {
                const cutoff = (artwork.bottom - (artwork.bottom - artwork.top) * .12) / sample.height * nextApp.screen.height;
                for (let drawable = 0; drawable < core.getDrawableCount(); drawable++) {
                  if (core.getDrawableOpacity(drawable) < .05 || !core.getDrawableDynamicFlagIsVisible(drawable)) continue;
                  const vertices = core.getDrawableVertices(drawable), offsets: number[] = [];
                  for (let offset = 0; offset < vertices.length; offset += 2) {
                    const point = project(vertices, offset, projection);
                    if (point.y >= cutoff && point.y <= artwork.bottom / sample.height * nextApp.screen.height + 2) offsets.push(offset);
                  }
                  if (offsets.length) baseVertices.push({ drawable, offsets });
                }
              }
              container.dataset.baseAnchorVertices = String(baseVertices.reduce((count, item) => count + item.offsets.length, 0));
              if (baseVertices.length) baseMeshCenter = () => {
                const matrix = getProjection();
                let left = Infinity, right = -Infinity;
                for (const { drawable, offsets } of baseVertices) {
                  if (core.getDrawableOpacity(drawable) < .05) continue;
                  const vertices = core.getDrawableVertices(drawable);
                  for (const offset of offsets) {
                    const { x } = project(vertices, offset, matrix);
                    left = Math.min(left, x); right = Math.max(right, x);
                  }
                }
                return right >= left ? (left + right) / 2 : null;
              };
              visualCenterOffset = (center - (baseMeshCenter?.() ?? nextApp.screen.width / 2)) / fit;
              publishVisualCenter();
            }
          }
        } catch {
          // A restricted canvas can still render normally with its default centre.
        }
      }
      refresh(); visibility();
      propsRef.current.onReady?.();
    };
    void initialize().catch((error: unknown) => {
      if (disposed) return;
      dispose();
      propsRef.current.onError?.(toError(error));
    });
    return dispose;
  }, [source]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />;
});

export default Live2DCanvas;

