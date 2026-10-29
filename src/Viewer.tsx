// Adapted from OpenMRI's study viewer (MIT, © 2026 Maksim Khuzin).
// See THIRD_PARTY_NOTICES.md.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Niivue, SLICE_TYPE } from '@niivue/niivue';
import type { FocusController } from './focus-controller';
import { patchOverlayBlending } from './niivue-patch';
import {
  Box,
  Crosshair,
  Layers3,
  LoaderCircle,
  Maximize2,
  Info,
  Pause,
  Play,
  RotateCcw,
  Scan,
  X,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LAYERS, type LayerId } from './layers';

type Mode = 'both' | 'volume' | 'slices';
type Point = { mm: number[] };

const axes: Record<string, number[]> = {
  sagittal: [270, 0],
  coronal: [180, 0],
  axial: [0, 90],
};
const uncertaintyGlowMap = {
  I: [0, 25, 80, 150, 215, 255],
  R: [0, 170, 235, 255, 255, 255],
  G: [0, 25, 55, 110, 165, 205],
  B: [0, 18, 30, 50, 95, 150],
  A: [0, 4, 18, 45, 90, 140],
};
const sliceNames = ['Axial', 'Coronal', 'Sagittal'];
const layerOrder: LayerId[] = ['prediction', 'truth', 'uncertainty'];
const overlayOptions: { id: LayerId; label: string }[] = [
  { id: 'prediction', label: 'Model' },
  { id: 'uncertainty', label: 'Uncertainty' },
  { id: 'truth', label: 'Expert' },
];
const scans = {
  flair: { label: 'FLAIR', name: 'FLAIR' },
  t1ce: { label: 'T1ce', name: 'T1 with contrast' },
  t1: { label: 'T1', name: 'T1' },
  t2: { label: 'T2', name: 'T2' },
};
type ScanId = keyof typeof scans;

function rangeValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0] : (value as number);
}

export default function Viewer({
  displayMax,
  shape,
  onInitialLoad,
}: {
  displayMax: Record<string, number>;
  shape: number[];
  onInitialLoad: (status: 'ready' | 'error') => void;
}) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('both');
  const [compact, setCompact] = useState(false);
  const [scan, setScan] = useState<ScanId>('t1ce');
  const [brightness, setBrightness] = useState(100);
  const [visible, setVisible] = useState<Record<LayerId, boolean>>(
    { prediction: true, truth: false, uncertainty: true },
  );
  const [overlayOpacity, setOverlayOpacity] = useState(75);
  const [cut, setCut] = useState(true);
  // Opens the volume through the tumour.
  const [depth, setDepth] = useState(-12);
  const [axis, setAxis] = useState('sagittal');
  const [rotate, setRotate] = useState(false);
  const [immersive, setImmersive] = useState(false);
  // Width of the slices column as a share of the stage, set by the divider.
  const [slicesShare, setSlicesShare] = useState(0.28);
  const stageRef = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const renderCanvas = useRef<HTMLCanvasElement>(null);
  const glowCanvas = useRef<HTMLCanvasElement>(null);
  const sliceCanvas = useRef<HTMLCanvasElement>(null);
  const sliceGlowCanvas = useRef<HTMLCanvasElement>(null);
  const engines = useRef<{
    render: Niivue;
    slices: Niivue;
    glow: Niivue;
    glowSlices: Niivue;
  } | null>(null);
  const focusRef = useRef<FocusController | null>(null);
  const loadedScan = useRef<ScanId>('t1ce');

  useEffect(() => {
    let active = true;
    let allocated: Partial<{
      render: Niivue;
      slices: Niivue;
      glow: Niivue;
      glowSlices: Niivue;
    }> = {};
    let glow: Niivue | null = null;
    let glowSlices: Niivue | null = null;
    let focus: FocusController | null = null;
    async function setup() {
      const [{ Niivue }, { FocusController }] = await Promise.all([
        import('@niivue/niivue'),
        import('./focus-controller'),
      ]);
      if (
        !active ||
        !renderCanvas.current ||
        !sliceCanvas.current ||
        !glowCanvas.current ||
        !sliceGlowCanvas.current
      )
        return;
      patchOverlayBlending();
      const common = {
        backColor: [0, 0, 0, 1] as [number, number, number, number],
        crosshairColor: [1, 0.72, 0.16, 1] as [number, number, number, number],
        crosshairWidth: 1,
        crosshairGap: 6,
        dragAndDropEnabled: false,
        drawingEnabled: false,
        loadingText: '',
        isColorbar: false,
        isRadiologicalConvention: true,
        show3Dcrosshair: false,
        // 0 follows the screen, so Retina displays render at full sharpness.
        forceDevicePixelRatio: 0,
      };
      const render = new Niivue({
        ...common,
        isOrientCube: true,
        // The cut plane removes the overlays too, not only the brain.
        isClipAllVolumes: true,
        crosshairColor: [1, 0.77, 0.4, 0.85],
        crosshairWidth: 0.7,
        crosshairGap: 5,
      });
      const slices = new Niivue({
        ...common,
        isOrientCube: false,
        fontMinPx: 12,
        fontSizeScaling: 0.3,
      });
      allocated = { render, slices };
      await render.attachToCanvas(renderCanvas.current);
      if (!active) return;
      await slices.attachToCanvas(sliceCanvas.current);
      if (!active) return;
      render.setSliceType(4);
      render.setRenderAzimuthElevation(120, 14);
      render.setScale(1.05);
      // The uncertainty is drawn by its own engine on a transparent canvas
      // over the 3D view. CSS adds it to the image (screen blend) and blurs it
      // into a bloom, so uncertain regions light up the brain like a light
      // source instead of being painted over it.
      glow = new Niivue({
        ...common,
        backColor: [0, 0, 0, 0],
        isOrientCube: false,
        isClipAllVolumes: true,
      });
      allocated.glow = glow;
      await glow.attachToCanvas(glowCanvas.current);
      if (!active) return;
      glow.setSliceType(4);
      // Faint red through orange to a hot, near-white core.
      glow.addColormap('uncertaintyGlow', uncertaintyGlowMap);
      glow.setClipPlaneColor([0, 0, 0, 0]);
      render.setClipPlaneColor([0.7, 0.95, 0.82, -0.05]);
      glowSlices = new Niivue({
        ...common,
        backColor: [0, 0, 0, 0],
        crosshairColor: [1, 0.72, 0.16, 0],
        isOrientCube: false,
        isOrientationTextVisible: false,
        interactive: false,
      });
      allocated.glowSlices = glowSlices;
      await glowSlices.attachToCanvas(sliceGlowCanvas.current);
      if (!active) return;
      glowSlices.addColormap('uncertaintyGlow', uncertaintyGlowMap);
      glowSlices.setSliceType(0);
      const sliceLayout: {
        sliceType: SLICE_TYPE;
        position: [number, number, number, number];
      }[] = [0, 1, 2].map((sliceType, i) => ({
        sliceType: sliceType as SLICE_TYPE,
        position: [0, i / 3, 1, 1 / 3],
      }));
      slices.setCustomLayout(sliceLayout);
      glowSlices.setCustomLayout(sliceLayout);

      const base = import.meta.env.BASE_URL;
      const scanVolume = [
        {
          // Contrast T1 shows the sharpest anatomy, so the page opens on it.
          url: `${base}data/t1ce.nii.gz`,
          colormap: 'gray',
          cal_min: 0,
          cal_max: displayMax.t1ce,
        },
      ];
      const overlays = layerOrder.map((id) => ({
        url: `${base}data/${LAYERS[id].file}`,
        colormap: 'gray',
        opacity: 0,
      }));
      const glowFile = LAYERS.uncertainty.glow3d!;
      const loads = await Promise.allSettled([
        render.loadVolumes([...scanVolume, ...overlays]),
        slices.loadVolumes([...scanVolume, ...overlays]),
        glow.loadVolumes([
          {
            url: `${base}data/${glowFile.file}`,
            colormap: glowFile.colormap,
            cal_min: 1,
            cal_max: 255,
          },
        ]),
        glowSlices.loadVolumes([
          {
            url: `${base}data/${glowFile.file}`,
            colormap: glowFile.colormap,
            cal_min: 1,
            cal_max: 255,
          },
        ]),
      ]);
      const failed = loads.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (!active) return;
      for (const nv of [render, slices]) {
        layerOrder.forEach((id, i) =>
          nv.volumes[i + 1].setColormapLabel(LAYERS[id].lut),
        );
        nv.updateGLVolume();
      }
      glowSlices.volumes[0].opacity = 1;
      glowSlices.updateGLVolume();
      await render.setVolumeRenderIllumination(0.45);
      await render.setGradientOpacity(0.12, 0.06);
      if (!active) return;

      const sliceGlowEngine = glowSlices;
      const drawSlicesCore = slices.drawSceneCore;
      slices.drawSceneCore = () => {
        const result = drawSlicesCore.call(slices);
        sliceGlowEngine.scene.crosshairPos = [...slices.scene.crosshairPos];
        sliceGlowEngine.scene.pan2Dxyzmm = [
          ...slices.scene.pan2Dxyzmm,
        ] as typeof sliceGlowEngine.scene.pan2Dxyzmm;
        sliceGlowEngine.drawScene();
        return result;
      };
      focus = new FocusController(render, slices, (location) => {
        if (!active) return;
        setPoint(location.visible ? { mm: location.mm } : null);
      });
      focusRef.current = focus;
      // Keep the glow engine's camera and cut plane on the main 3D view's,
      // after every frame the main view draws.
      const glowEngine = glow;
      const drawCore = render.drawSceneCore;
      render.drawSceneCore = () => {
        const result = drawCore.call(render);
        glowEngine.scene.renderAzimuth = render.scene.renderAzimuth;
        glowEngine.scene.renderElevation = render.scene.renderElevation;
        glowEngine.scene.volScaleMultiplier = render.scene.volScaleMultiplier;
        glowEngine.scene.pan2Dxyzmm = render.scene.pan2Dxyzmm;
        glowEngine.setClipPlane(render.scene.clipPlaneDepthAziElevs[0]);
        return result;
      };
      engines.current = { render, slices, glow, glowSlices };
      // Open on an axial level through the tumour.
      focus.reset([0.5, 0.5, 0.55]);
      setReady(true);
      setLoading(false);
      onInitialLoad('ready');
    }
    setup().catch((e: unknown) => {
      if (!active) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(
        `3D rendering could not start: ${message}. Open the page in a browser with WebGL 2 enabled.`,
      );
      setLoading(false);
      onInitialLoad('error');
    });
    return () => {
      active = false;
      focus?.dispose();
      focusRef.current = null;
      engines.current = null;
      allocated.render?.cleanup();
      allocated.slices?.cleanup();
      allocated.glow?.cleanup();
      allocated.glowSlices?.cleanup();
    };
  }, [displayMax, onInitialLoad]);

  useEffect(() => {
    const pair = engines.current;
    if (!ready || !pair || scan === loadedScan.current) return;
    let active = true;
    setLoading(true);
    (async () => {
      const { NVImage } = await import('@niivue/niivue');
      const url = `${import.meta.env.BASE_URL}data/${scan}.nii.gz`;
      // Each engine owns its GL textures, so each needs its own copy.
      const images = await Promise.all(
        [pair.render, pair.slices].map(() =>
          NVImage.loadFromUrl({
            url,
            colormap: 'gray',
            cal_min: 0,
            cal_max: displayMax[scan],
          }),
        ),
      );
      if (!active) return;
      [pair.render, pair.slices].forEach((nv, i) => {
        const previous = nv.volumes[0];
        nv.addVolume(images[i]);
        nv.setVolume(images[i], 0);
        nv.removeVolume(previous);
      });
      loadedScan.current = scan;
      setBrightness(100);
      setLoading(false);
    })().catch((e: unknown) => {
      if (!active) return;
      setError(
        `The ${scans[scan].name} scan could not be loaded: ${e instanceof Error ? e.message : String(e)}`,
      );
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [scan, ready, displayMax]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const layout: {
      sliceType: SLICE_TYPE;
      position: [number, number, number, number];
    }[] = [0, 1, 2].map((sliceType, i) => ({
        sliceType: sliceType as SLICE_TYPE,
        position:
          (mode === 'slices' && !compact) || (mode === 'both' && compact)
            ? [i / 3, 0, 1 / 3, 1]
            : [0, i / 3, 1, 1 / 3],
      }));
    engines.current?.slices.setCustomLayout(layout);
    engines.current?.glowSlices.setCustomLayout(layout);
    const timer = window.setTimeout(
      () => window.dispatchEvent(new Event('resize')),
      80,
    );
    return () => clearTimeout(timer);
  }, [mode, ready, immersive, compact]);

  useEffect(() => {
    const pair = engines.current;
    if (!pair || !ready) return;
    for (const nv of [pair.render, pair.slices]) {
      layerOrder.forEach((id, i) => {
        // Uncertainty uses the matching glow canvases in 3D and slices.
        const glows = id === 'uncertainty';
        nv.volumes[i + 1].opacity =
          visible[id] && !glows
            ? (overlayOpacity / 100) * LAYERS[id].weight
            : 0;
      });
      nv.updateGLVolume();
    }
  }, [visible, overlayOpacity, ready]);

  useEffect(() => {
    const nv = engines.current?.render;
    if (!nv || !ready) return;
    nv.setClipPlane(cut ? [depth / 100, ...axes[axis]] : [2, 0, 0]);
  }, [cut, depth, axis, ready]);

  useEffect(() => {
    if (!ready || loading) return;
    const timer = window.setTimeout(() => {
      const nv = engines.current?.render;
      if (!nv?.volumes[0]) return;
      nv.volumes[0].cal_max =
        (displayMax[loadedScan.current] * 100) / brightness;
      nv.updateGLVolume();
    }, 100);
    return () => clearTimeout(timer);
  }, [brightness, ready, loading, displayMax]);

  useEffect(() => {
    if (!rotate || !ready) return;
    let frame = 0;
    let previous = 0;
    const tick = (now: number) => {
      const nv = engines.current?.render;
      if (nv && previous && now - previous >= 33) {
        nv.setRenderAzimuthElevation(
          nv.scene.renderAzimuth + Math.min(now - previous, 100) * 0.008,
          nv.scene.renderElevation,
        );
        previous = now;
      }
      if (!previous) previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rotate, ready]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setImmersive(false);
        setRotate(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const showUncertainty = useCallback(() => {
    setVisible({ prediction: true, truth: false, uncertainty: true });
  }, []);

  // Other parts of the page can point the viewer at a location.
  useEffect(() => {
    const go = (event: Event) => {
      const frac = (event as CustomEvent<{ frac: [number, number, number] }>)
        .detail?.frac;
      if (!frac || !ready) return;
      const axialFocus: [number, number, number] = [
        frac[0],
        frac[1],
        Math.min(1, frac[2] + 3 / shape[2]),
      ];
      showUncertainty();
      setMode('both');
      setAxis('axial');
      setDepth(Math.round((axialFocus[2] - 0.5) * 100));
      setCut(true);
      setRotate(false);
      engines.current?.render.setRenderAzimuthElevation(0, 90);
      focusRef.current?.moveTo(axialFocus);
    };
    window.addEventListener('viewer:focus', go);
    return () => window.removeEventListener('viewer:focus', go);
  }, [ready, showUncertainty, shape]);

  const reset = useCallback(() => {
    setCut(true);
    setDepth(-12);
    setAxis('sagittal');
    setRotate(false);
    setBrightness(100);
    focusRef.current?.reset([0.5, 0.5, 0.55]);
    engines.current?.render.setRenderAzimuthElevation(120, 14);
    engines.current?.render.setScale(1.05);
  }, []);

  const activeLayers = layerOrder.filter((id) => visible[id]);

  return (
    <div className={`neuro-app viewer-shell ${immersive ? 'immersive' : ''}`}>
      <div className="workspace">
        <aside className="controls">
          <div className="control-heading">
            <span className="eyebrow">CASE</span>
            <span className="tiny-badge">BraTS 2020</span>
          </div>
          <h1 className="case-title">
            Brain <span>glioma</span>
          </h1>

          <div className="control-heading layer-heading">
            <span className="eyebrow">SCAN</span>
          </div>
          <ToggleGroup
            value={[scan]}
            onValueChange={(v) => {
              if (v[0]) setScan(v[0] as ScanId);
            }}
            className="axis-buttons preset-buttons"
            aria-label="MRI sequence"
            disabled={loading}
          >
            {(Object.keys(scans) as ScanId[]).map((id) => (
              <ToggleGroupItem value={id} key={id} title={scans[id].name}>
                {scans[id].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="control-heading layer-heading">
            <span className="eyebrow">OVERLAY</span>
          </div>
          <ToggleGroup
            multiple
            value={overlayOptions
              .filter(({ id }) => visible[id])
              .map(({ id }) => id)}
            onValueChange={(selected) =>
              setVisible({
                prediction: selected.includes('prediction'),
                uncertainty: selected.includes('uncertainty'),
                truth: selected.includes('truth'),
              })
            }
            className="axis-buttons preset-buttons overlay-buttons"
            aria-label="Overlay"
          >
            {overlayOptions.map(({ id, label }) => (
              <ToggleGroupItem value={id} key={id}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="slider-label">
            <span id="overlay-label">Overlay opacity</span>
            <output>{overlayOpacity}%</output>
          </div>
          <Slider
            aria-labelledby="overlay-label"
            value={[overlayOpacity]}
            onValueChange={(v) => setOverlayOpacity(rangeValue(v))}
            min={10}
            max={100}
            step={5}
            disabled={loading}
          />

          <section className="control-section">
            <div className="control-heading">
              <span className="eyebrow">LIGHT</span>
              <span className="tiny-badge">3D</span>
            </div>
            <div className="slider-label">
              <span id="brightness-label">Volume brightness</span>
              <output>{brightness}%</output>
            </div>
            <Slider
              aria-labelledby="brightness-label"
              value={[brightness]}
              onValueChange={(v) => setBrightness(rangeValue(v))}
              min={50}
              max={180}
              step={5}
              disabled={loading}
            />
          </section>
          <section
            className={`control-section cut-section ${cut ? 'enabled' : ''}`}
          >
            <div className="switch-row">
              <label htmlFor="cut-switch">
                <Scan size={16} /> Cut plane
              </label>
              <Switch
                aria-label="Cut plane"
                id="cut-switch"
                checked={cut}
                onCheckedChange={setCut}
                disabled={loading}
              />
            </div>
            {cut && (
              <div className="cut-controls">
                <ToggleGroup
                  value={[axis]}
                  onValueChange={(v) => {
                    if (v[0]) setAxis(String(v[0]));
                  }}
                  className="axis-buttons"
                  aria-label="Cut direction"
                >
                  <ToggleGroupItem value="sagittal">Side</ToggleGroupItem>
                  <ToggleGroupItem value="coronal">Front</ToggleGroupItem>
                  <ToggleGroupItem value="axial">Top</ToggleGroupItem>
                </ToggleGroup>
                <div className="slider-label">
                  <span id="depth-label">Plane position</span>
                  <output>
                    {depth > 0 ? '+' : ''}
                    {depth}%
                  </output>
                </div>
                <Slider
                  aria-labelledby="depth-label"
                  value={[depth]}
                  onValueChange={(v) => setDepth(rangeValue(v))}
                  min={-90}
                  max={90}
                  step={1}
                />
              </div>
            )}
          </section>
        </aside>
        <section className="viewer-workspace" aria-label="MRI viewer">
          <div className="view-options">
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="view-tabs" aria-label="View mode">
                <TabsTrigger value="both">
                  <Layers3 size={15} />
                  Volume + slices
                </TabsTrigger>
                <TabsTrigger value="volume">
                  <Box size={15} />
                  3D
                </TabsTrigger>
                <TabsTrigger value="slices">
                  <Scan size={15} />
                  Slices
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="toolbar-actions">
              <button
                className="icon-button"
                aria-label={immersive ? 'Exit full view' : 'Expand the viewer'}
                onClick={() => setImmersive(!immersive)}
              >
                {immersive ? <X size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          </div>
          <div
            ref={stageRef}
            className={`scan-stage mode-${mode}`}
            style={
              { '--slices-width': `${slicesShare * 100}%` } as React.CSSProperties
            }
          >
            {mode === 'both' && !compact && (
              <div
                className="stage-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the slices panel"
                aria-valuemin={15}
                aria-valuemax={70}
                aria-valuenow={Math.round(slicesShare * 100)}
                tabIndex={0}
                title="Drag to resize · double-click to reset"
                onPointerDown={(e) => {
                  const stage = stageRef.current;
                  if (!stage) return;
                  e.preventDefault();
                  const divider = e.currentTarget;
                  divider.setPointerCapture(e.pointerId);
                  const move = (ev: PointerEvent) => {
                    const box = stage.getBoundingClientRect();
                    setSlicesShare(
                      Math.min(0.7, Math.max(0.15, (box.right - ev.clientX) / box.width)),
                    );
                  };
                  const up = () => {
                    divider.removeEventListener('pointermove', move);
                    divider.removeEventListener('pointerup', up);
                    divider.removeEventListener('pointercancel', up);
                  };
                  divider.addEventListener('pointermove', move);
                  divider.addEventListener('pointerup', up);
                  divider.addEventListener('pointercancel', up);
                }}
                onDoubleClick={() => setSlicesShare(0.28)}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowLeft' ? 0.03 : e.key === 'ArrowRight' ? -0.03 : 0;
                  if (!step) return;
                  e.preventDefault();
                  setSlicesShare((v) => Math.min(0.7, Math.max(0.15, v + step)));
                }}
              />
            )}
            <div
              className="render-pane"
              style={{ display: mode === 'slices' ? 'none' : undefined }}
            >
              <canvas
                ref={glowCanvas}
                className="glow-canvas"
                aria-hidden
                style={{
                  opacity: visible.uncertainty ? overlayOpacity / 100 : 0,
                }}
              />
              <canvas
                ref={renderCanvas}
                aria-label="3D volume rendering of the MRI with the tumour overlays. Drag to rotate, scroll to zoom."
              />
              <div className="legend" aria-label="Legend">
                {activeLayers.flatMap((id) =>
                  LAYERS[id].legend.map((l) => (
                    <span key={`${id}-${l.label}`}>
                      <i style={{ background: l.color }} />
                      {l.label}
                    </span>
                  )),
                )}
              </div>
              <div className="corner corner-tl" />
              <div className="corner corner-tr" />
              <div className="corner corner-bl" />
              <div className="corner corner-br" />
              <div className="orbit-toolbar">
                <button
                  onClick={() => setRotate(!rotate)}
                  disabled={loading}
                  className={rotate ? 'active' : ''}
                >
                  {rotate ? <Pause size={14} /> : <Play size={14} />}
                  <span>{rotate ? 'Pause' : 'Orbit'}</span>
                </button>
                <span className="toolbar-separator" />
                <button
                  onClick={reset}
                  aria-label="Reset the view"
                  disabled={loading}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              <span className="view-help">
                Drag to rotate <span>·</span> Scroll to zoom
              </span>
            </div>
            <div
              className="slices-pane"
              style={{ display: mode === 'volume' ? 'none' : undefined }}
            >
              <canvas
                ref={sliceCanvas}
                aria-label="Three MRI slices. Click to pick a point, scroll to move the slice."
              />
              <canvas
                ref={sliceGlowCanvas}
                className="slice-glow-canvas"
                aria-hidden
                style={{
                  opacity: visible.uncertainty ? overlayOpacity / 100 : 0,
                }}
              />
              {sliceNames.map((name, i) => (
                <div className={`slice-overlay slice-${i}`} key={name}>
                  <span className="slice-label">
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    {name}
                  </span>
                  <span className="slice-axis">{['AX', 'COR', 'SAG'][i]}</span>
                </div>
              ))}
            </div>
            {loading && !error && (
              <output className="scan-loading" aria-live="polite">
                <LoaderCircle size={29} className="spin" />
                <strong>Building the volume</strong>
                <span>BraTS 2020 · {scans[scan].name}</span>
                <small>Scan, prediction, expert labels and uncertainty</small>
              </output>
            )}
            {error && (
              <div className="scan-loading error-state" role="alert">
                <Info size={28} />
                <strong>The viewer could not start</strong>
                <p>{error}</p>
              </div>
            )}
          </div>
          <footer className="viewer-footer" aria-live="polite">
            {point && (
              <div className="coordinate-readout">
                <Crosshair size={13} />
                {point.mm.map((v, i) => (
                  <span key={i}>
                    <b>{['X', 'Y', 'Z'][i]}</b> {v.toFixed(1)}
                  </span>
                ))}
                <span>mm</span>
              </div>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
