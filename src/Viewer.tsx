// Adapted from OpenMRI's study viewer (MIT, © 2026 Maksim Khuzin).
// See THIRD_PARTY_NOTICES.md.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Niivue } from '@niivue/niivue';
import type { FocusController } from './focus-controller';
import {
  Box,
  Check,
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
import {
  CLASS_NAMES,
  LAYERS,
  type LayerId,
  PRESETS,
  type PresetId,
} from './layers';

type Mode = 'both' | 'volume' | 'slices';
type Point = { mm: number[]; frac: number[] };
type Probe = { flair: number; prediction: number; truth: number; set: number };

const paletteNames: Record<string, string> = {
  silver: 'Silver',
  jade: 'Jade',
  amber: 'Amber',
};
const paletteMaps: Record<string, string> = {
  silver: 'gray',
  jade: 'neuroJade',
  amber: 'neuroAmber',
};
const axes: Record<string, number[]> = {
  sagittal: [270, 0],
  coronal: [0, 0],
  axial: [0, 90],
};
const sliceNames = ['Axial', 'Coronal', 'Sagittal'];
const layerOrder: LayerId[] = ['prediction', 'truth', 'uncertainty'];

function rangeValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0] : (value as number);
}

export default function Viewer({
  displayMax,
  shape,
  voxelMm,
}: {
  displayMax: number;
  shape: number[];
  voxelMm: number[];
}) {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('both');
  const [compact, setCompact] = useState(false);
  const [palette, setPalette] = useState('silver');
  const [brightness, setBrightness] = useState(100);
  const [preset, setPreset] = useState<PresetId>('uncertainty');
  const [visible, setVisible] = useState<Record<LayerId, boolean>>(
    PRESETS.uncertainty.layers,
  );
  const [overlayOpacity, setOverlayOpacity] = useState(75);
  const [cut, setCut] = useState(true);
  // Opens the volume through the tumour.
  const [depth, setDepth] = useState(-12);
  const [axis, setAxis] = useState('sagittal');
  const [rotate, setRotate] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [probe, setProbe] = useState<Probe | null>(null);
  const renderCanvas = useRef<HTMLCanvasElement>(null);
  const sliceCanvas = useRef<HTMLCanvasElement>(null);
  const engines = useRef<{ render: Niivue; slices: Niivue } | null>(null);
  const focusRef = useRef<FocusController | null>(null);

  useEffect(() => {
    let active = true;
    let allocated: { render: Niivue; slices: Niivue } | null = null;
    let focus: FocusController | null = null;
    async function setup() {
      const [{ Niivue }, { FocusController }] = await Promise.all([
        import('@niivue/niivue'),
        import('./focus-controller'),
      ]);
      if (!active || !renderCanvas.current || !sliceCanvas.current) return;
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
        forceDevicePixelRatio: 1,
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
      render.addColormap('neuroJade', {
        I: [0, 45, 100, 170, 225, 255],
        R: [0, 12, 52, 135, 208, 248],
        G: [0, 39, 116, 188, 233, 255],
        B: [0, 37, 111, 174, 216, 253],
        A: [0, 0, 45, 125, 210, 255],
      });
      render.addColormap('neuroAmber', {
        I: [0, 40, 100, 165, 225, 255],
        R: [0, 63, 169, 233, 255, 255],
        G: [0, 28, 88, 167, 224, 253],
        B: [0, 19, 51, 111, 186, 243],
        A: [0, 0, 45, 125, 210, 255],
      });
      render.setClipPlaneColor([0.7, 0.95, 0.82, -0.05]);
      slices.setCustomLayout(
        [0, 1, 2].map((sliceType, i) => ({
          sliceType,
          position: [0, i / 3, 1, 1 / 3],
        })),
      );

      const base = import.meta.env.BASE_URL;
      const volumes = [
        {
          url: `${base}data/flair.nii.gz`,
          colormap: 'gray',
          cal_min: 0,
          cal_max: displayMax,
        },
        ...layerOrder.map((id) => ({
          url: `${base}data/${LAYERS[id].file}`,
          colormap: 'gray',
          opacity: 0,
        })),
      ];
      const loads = await Promise.allSettled([
        render.loadVolumes(volumes),
        slices.loadVolumes(volumes),
      ]);
      const failed = loads.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      if (!active) return;
      for (const nv of [render, slices]) {
        layerOrder.forEach((id, i) => {
          const layer = LAYERS[id];
          nv.volumes[i + 1].setColormapLabel(
            nv === render ? (layer.lut3d ?? layer.lut) : layer.lut,
          );
        });
        nv.updateGLVolume();
      }
      await render.setVolumeRenderIllumination(0.45);
      await render.setGradientOpacity(0.12, 0.06);
      if (!active) return;

      focus = new FocusController(render, slices, (location) => {
        if (!active) return;
        setPoint({ mm: location.mm, frac: location.frac });
        setHasFocus(location.visible);
      });
      focusRef.current = focus;
      engines.current = allocated;
      // Open on an axial level through the tumour.
      focus.reset([0.5, 0.5, 0.55]);
      setReady(true);
      setLoading(false);
    }
    setup().catch((e: unknown) => {
      if (!active) return;
      const message = e instanceof Error ? e.message : String(e);
      setError(
        `3D rendering could not start: ${message}. Open the page in a browser with WebGL 2 enabled.`,
      );
      setLoading(false);
    });
    return () => {
      active = false;
      focus?.dispose();
      focusRef.current = null;
      engines.current = null;
      allocated?.render.cleanup();
      allocated?.slices.cleanup();
    };
  }, [displayMax]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!ready) return;
    engines.current?.slices.setCustomLayout(
      [0, 1, 2].map((sliceType, i) => ({
        sliceType,
        position:
          (mode === 'slices' && !compact) || (mode === 'both' && compact)
            ? [i / 3, 0, 1 / 3, 1]
            : [0, i / 3, 1, 1 / 3],
      })),
    );
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
        nv.volumes[i + 1].opacity = visible[id]
          ? (overlayOpacity / 100) * LAYERS[id].weight
          : 0;
      });
      nv.updateGLVolume();
    }
  }, [visible, overlayOpacity, ready]);

  useEffect(() => {
    const nv = engines.current?.render;
    if (nv?.volumes[0] && ready)
      nv.setColormap(nv.volumes[0].id, paletteMaps[palette]);
  }, [palette, ready]);

  useEffect(() => {
    const nv = engines.current?.render;
    if (!nv || !ready) return;
    nv.setClipPlane(cut ? [depth / 100, ...axes[axis]] : [2, 0, 0]);
  }, [cut, depth, axis, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      const nv = engines.current?.render;
      if (!nv?.volumes[0]) return;
      nv.volumes[0].cal_max = (displayMax * 100) / brightness;
      nv.updateGLVolume();
    }, 100);
    return () => clearTimeout(timer);
  }, [brightness, ready, displayMax]);

  useEffect(() => {
    const nv = engines.current?.slices;
    if (!nv || !point || !ready) return;
    const read = (i: number) => {
      const vol = nv.volumes[i];
      // getValue reads RAS voxel indices; the focus is a RAS fraction.
      const [x, y, z] = point.frac.map((f, d) =>
        Math.round(f * vol.dimsRAS![d + 1] - 0.5),
      );
      return Math.round(vol.getValue(x, y, z));
    };
    setProbe({
      flair: read(0),
      prediction: read(1),
      truth: read(2),
      set: read(3),
    });
  }, [point, ready]);

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

  const choosePreset = useCallback((id: PresetId) => {
    setPreset(id);
    setVisible(PRESETS[id].layers);
  }, []);

  const toggleLayer = (id: LayerId) => {
    setPreset('custom');
    setVisible((v) => ({ ...v, [id]: !v[id] }));
  };

  const reset = useCallback(() => {
    setCut(true);
    setDepth(-12);
    setAxis('sagittal');
    setRotate(false);
    setBrightness(100);
    setPalette('silver');
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
            Training <span>070</span>
          </h1>
          <p className="study-meta">
            FLAIR <span>·</span> glioma <span>·</span> {shape.join(' × ')}
          </p>

          <div className="control-heading layer-heading">
            <span className="eyebrow">STORY</span>
          </div>
          <ToggleGroup
            value={[preset]}
            onValueChange={(v) => {
              if (v[0]) choosePreset(v[0] as PresetId);
            }}
            className="axis-buttons preset-buttons"
            aria-label="What to show"
          >
            {(Object.keys(PRESETS) as PresetId[])
              .filter((id) => id !== 'custom')
              .map((id) => (
                <ToggleGroupItem value={id} key={id}>
                  {PRESETS[id].label}
                </ToggleGroupItem>
              ))}
          </ToggleGroup>
          <p className="muted-text preset-note">{PRESETS[preset].note}</p>

          <section className="series-list" aria-label="Layers">
            {layerOrder.map((id, index) => {
              const layer = LAYERS[id];
              return (
                <button
                  className={`series-card layer-card ${visible[id] ? 'selected' : ''}`}
                  key={id}
                  onClick={() => toggleLayer(id)}
                  aria-pressed={visible[id]}
                  disabled={loading}
                >
                  <span className="series-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="series-text">
                    <strong>{layer.name}</strong>
                    <small>{layer.caption}</small>
                  </span>
                  <span className="layer-swatches" aria-hidden>
                    {layer.legend.map((l) => (
                      <i key={l.label} style={{ background: l.color }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </section>
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
              <span className="eyebrow">LIGHT AND MATERIAL</span>
              <span className="tiny-badge">3D</span>
            </div>
            <ToggleGroup
              value={[palette]}
              onValueChange={(v) => {
                if (v[0]) setPalette(String(v[0]));
              }}
              className="palettes"
              aria-label="Volume palette"
              disabled={loading}
            >
              {Object.entries(paletteNames).map(([id, name]) => (
                <ToggleGroupItem
                  value={id}
                  className={`palette ${id} ${palette === id ? 'chosen' : ''}`}
                  key={id}
                  aria-label={name}
                >
                  <span className="palette-swatch">
                    {palette === id && <Check size={15} />}
                  </span>
                  <span>{name}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
                  step={2}
                />
              </div>
            )}
          </section>
          <section className="focus-card probe-card">
            <div className="focus-title">
              <Crosshair size={17} />
              <span>At the focus</span>
              <span className="focus-type">voxel</span>
            </div>
            {probe && hasFocus ? (
              <dl className="probe">
                <dt>Model</dt>
                <dd>
                  <i style={{ background: CLASS_NAMES[probe.prediction]?.color }} />
                  {CLASS_NAMES[probe.prediction]?.name ?? '—'}
                </dd>
                <dt>Expert</dt>
                <dd>
                  <i style={{ background: CLASS_NAMES[probe.truth]?.color }} />
                  {CLASS_NAMES[probe.truth]?.name ?? '—'}
                </dd>
                <dt>Set size</dt>
                <dd>
                  <b>{probe.set || 1}</b>
                  {probe.set > 1
                    ? ` of 4 classes · uncertain`
                    : ' class · confident'}
                </dd>
              </dl>
            ) : (
              <p>
                Click a slice. The model&apos;s label, the expert&apos;s label
                and the conformal set size at that voxel appear here.
              </p>
            )}
          </section>
        </aside>
        <section className="viewer-workspace" aria-label="MRI viewer">
          <div className="viewer-toolbar">
            <div className="active-series">
              <span className="eyebrow">CURRENT VIEW</span>
              <h2>{PRESETS[preset].title}</h2>
            </div>
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
            <span className="voxel-label">
              {voxelMm.map((v) => Number(v.toFixed(3))).join(' × ')} mm{' '}
              <span>· voxel</span>
            </span>
          </div>
          <div className={`scan-stage mode-${mode}`}>
            <div
              className="render-pane"
              style={{ display: mode === 'slices' ? 'none' : undefined }}
            >
              <canvas
                ref={renderCanvas}
                aria-label="3D volume rendering of the MRI with the tumour overlays. Drag to rotate, scroll to zoom."
              />
              <div className="render-label">
                <span className="status-dot" />
                <span>VOLUME RENDERING</span>
              </div>
              <div className="render-subtitle">
                {paletteNames[palette]}
                {cut ? ' / cut' : ' / full volume'}
              </div>
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
                <span>BraTS 2020 · case 070</span>
                <small>FLAIR, prediction, expert labels and uncertainty</small>
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
          <footer className="viewer-footer">
            <div>
              <span className={`status-dot ${loading ? 'pending' : ''}`} />
              <span>
                {loading ? 'Preparing' : error ? 'Load error' : 'Case open'}
              </span>
              <span className="footer-separator" />
              <span>{shape.join(' × ')} px</span>
            </div>
            <div className="coordinate-readout">
              <Crosshair size={13} />
              {point ? (
                point.mm.map((v, i) => (
                  <span key={i}>
                    <b>{['X', 'Y', 'Z'][i]}</b> {v.toFixed(1)}
                  </span>
                ))
              ) : (
                <span>Pick a point on a slice</span>
              )}
              <span>mm</span>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
