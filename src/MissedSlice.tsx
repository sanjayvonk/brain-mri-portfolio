import { useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { EDEMA, ENHANCING, NECROTIC, SET } from './layers';

type SliceData = {
  z: number;
  width: number;
  height: number;
  flair: string;
  t1ce: string;
  prediction: string;
  uncertainty: string;
  truth: string;
  focus: [number, number, number];
};
type Rgb = [number, number, number];
type Layer = 'prediction' | 'uncertainty' | 'truth';
type Panel = {
  key: 'scan' | Layer;
  title: string;
  /** Fill colour and opacity per label value. */
  colors: Record<number, { rgb: Rgb; alpha: number }>;
  /** Draw the expert's tumour outline on top, for comparison. */
  outline: boolean;
  legend: { label: string; color: string; line?: boolean }[];
};

const SCALE = 8;
const WHITE: Rgb = [255, 255, 255];
const css = (c: Rgb) => `rgb(${c.join(' ')})`;
const classes = {
  1: { rgb: NECROTIC, alpha: 0.55 },
  2: { rgb: EDEMA, alpha: 0.45 },
  3: { rgb: ENHANCING, alpha: 0.6 },
};
const classLegend = [
  { label: 'Necrotic core', color: css(NECROTIC) },
  { label: 'Edema', color: css(EDEMA) },
  { label: 'Enhancing', color: css(ENHANCING) },
];
const expertLine = { label: 'Expert tumour', color: '#fff', line: true };
const panels: Panel[] = [
  {
    key: 'scan',
    title: 'MRI · FLAIR',
    colors: {},
    outline: false,
    legend: [],
  },
  {
    key: 'prediction',
    title: 'U-Net prediction',
    colors: classes,
    outline: true,
    legend: [...classLegend, expertLine],
  },
  {
    key: 'uncertainty',
    title: 'Conformal uncertainty',
    colors: {
      2: { rgb: SET[0], alpha: 0.45 },
      3: { rgb: SET[1], alpha: 0.55 },
      4: { rgb: SET[2], alpha: 0.65 },
    },
    outline: true,
    legend: [
      { label: '2 classes', color: css(SET[0]) },
      { label: '3', color: css(SET[1]) },
      { label: '4', color: css(SET[2]) },
      expertLine,
    ],
  },
  {
    key: 'truth',
    title: 'Expert annotation',
    colors: classes,
    outline: true,
    legend: [...classLegend, expertLine],
  },
];

const decode = (b64: string) =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Upsamples a label map smoothly: each label's indicator is interpolated
 * bilinearly and a pixel takes the label that covers at least half of it.
 * Edges come out as smooth curves instead of 1 mm steps.
 */
function upsampleLabels(labels: Uint8Array, w: number, h: number) {
  const values = [...new Set(labels)].filter((v) => v > 0);
  const W = w * SCALE;
  const H = h * SCALE;
  const out = new Uint8Array(W * H);
  const at = (x: number, y: number, v: number) =>
    labels[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] === v ? 1 : 0;
  for (let Y = 0; Y < H; Y++) {
    const v = (Y + 0.5) / SCALE - 0.5;
    const y0 = Math.floor(v);
    const fy = v - y0;
    for (let X = 0; X < W; X++) {
      const u = (X + 0.5) / SCALE - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      let best = 0;
      let bestWeight = 0.5;
      for (const value of values) {
        const weight =
          (at(x0, y0, value) * (1 - fx) + at(x0 + 1, y0, value) * fx) * (1 - fy) +
          (at(x0, y0 + 1, value) * (1 - fx) + at(x0 + 1, y0 + 1, value) * fx) * fy;
        if (weight >= bestWeight) {
          best = value;
          bestWeight = weight;
        }
      }
      out[Y * W + X] = best;
    }
  }
  return out;
}

/**
 * Rounds off a binary mask: two box blurs (close to a Gaussian) of about one
 * source voxel, then a half threshold. Used for the expert outline, which is
 * drawn by hand voxel by voxel and would otherwise trace every 1 mm step.
 */
function smoothMask(mask: Uint8Array, W: number, H: number, radius: number) {
  const a = Float32Array.from(mask);
  const b = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[y * W + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[y * W + x] = sum / (2 * radius + 1);
        sum += a[y * W + Math.min(W - 1, x + radius + 1)] - a[y * W + Math.max(0, x - radius)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum / (2 * radius + 1);
        sum += b[Math.min(H - 1, y + radius + 1) * W + x] - b[Math.max(0, y - radius) * W + x];
      }
    }
  }
  return Uint8Array.from(a, (v) => (v >= 0.5 ? 1 : 0));
}

/** Pixels within `radius` of a different label, on the inside of a region. */
function edges(labels: Uint8Array, W: number, H: number, radius: number) {
  const out = new Uint8Array(W * H);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const v = labels[Y * W + X];
      if (!v) continue;
      search: for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const x = X + dx;
          const y = Y + dy;
          if (x < 0 || y < 0 || x >= W || y >= H || labels[y * W + x] !== v) {
            out[Y * W + X] = 1;
            break search;
          }
        }
    }
  return out;
}

function draw(
  canvas: HTMLCanvasElement,
  data: SliceData,
  panel: Panel,
  layers: Partial<Record<Layer, Uint8Array>>,
  tumour: Uint8Array,
) {
  const { width: w, height: h } = data;
  const W = w * SCALE;
  const H = h * SCALE;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // Scan, smoothly enlarged.
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const scan = decode(data.flair);
  const smallCtx = small.getContext('2d')!;
  const smallImage = smallCtx.createImageData(w, h);
  scan.forEach((g, i) => smallImage.data.set([g, g, g, 255], i * 4));
  smallCtx.putImageData(smallImage, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, W, H);
  if (panel.key === 'scan') return;

  const image = ctx.getImageData(0, 0, W, H);
  const px = image.data;
  const blend = (i: number, c: Rgb, a: number) => {
    px[i * 4] += (c[0] - px[i * 4]) * a;
    px[i * 4 + 1] += (c[1] - px[i * 4 + 1]) * a;
    px[i * 4 + 2] += (c[2] - px[i * 4 + 2]) * a;
  };

  // Light fill so the anatomy stays visible, crisp edge in the same colour.
  const labels = layers[panel.key as Layer]!;
  const rim = edges(labels, W, H, 4);
  for (let i = 0; i < W * H; i++) {
    const fill = panel.colors[labels[i]];
    if (fill) blend(i, fill.rgb, rim[i] ? 0.95 : fill.alpha);
  }

  // The expert's tumour as a white line with a dark halo, so it reads on
  // bright and dark tissue alike.
  if (panel.outline) {
    const line = edges(tumour, W, H, 9);
    const core = edges(tumour, W, H, 5);
    for (let i = 0; i < W * H; i++) {
      if (core[i]) blend(i, WHITE, 1);
      else if (line[i]) blend(i, [0, 0, 0], 0.55);
    }
  }
  ctx.putImageData(image, 0, 0);
}

export default function MissedSlice({
  counts,
}: {
  counts: {
    z: number;
    tumour: number;
    found: number;
    missed: number;
    caught: number;
  };
}) {
  const [data, setData] = useState<SliceData | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}data/missed_slice.json`)
      .then((r) => r.json() as Promise<SliceData>)
      .then((d) => active && setData(d))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    const { width: w, height: h } = data;
    const layers: Record<Layer, Uint8Array> = {
      prediction: upsampleLabels(decode(data.prediction), w, h),
      uncertainty: upsampleLabels(decode(data.uncertainty), w, h),
      truth: upsampleLabels(decode(data.truth), w, h),
    };
    const tumour = smoothMask(
      layers.truth.map((v) => (v > 0 ? 1 : 0)),
      w * SCALE,
      h * SCALE,
      SCALE,
    );
    panels.forEach((panel, i) => {
      const canvas = canvases.current[i];
      if (canvas) draw(canvas, data, panel, layers, tumour);
    });
  }, [data]);

  const pct = Math.round((counts.found / counts.tumour) * 100);
  const notes: Record<Panel['key'], string> = {
    scan: `Axial slice ${counts.z}, base of the right hemisphere`,
    prediction: `Labels ${counts.found} of ${counts.tumour} tumour voxels (${pct}%)`,
    uncertainty: `Flags ${counts.caught} of the ${counts.missed} voxels the model missed`,
    truth: `${counts.tumour} voxels of tumour`,
  };

  const showInViewer = () => {
    if (!data) return;
    window.dispatchEvent(
      new CustomEvent('viewer:focus', { detail: { frac: data.focus } }),
    );
    document.getElementById('viewer')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="missed" className="content-section missed-section">
      <header>
        <span className="eyebrow">CASE STUDY · ONE SLICE</span>
        <h2>A tumour the model missed, and the uncertainty caught</h2>
      </header>
      <p className="missed-lead">
        Low in the right hemisphere the U-Net labels this slice almost entirely
        as healthy tissue, although the expert marks tumour there (white
        outline). The segmentation alone would hide it. The conformal
        prediction sets do not: every voxel the model missed on this slice
        keeps more than one class in its set, so the region lights up as
        uncertain. The same happens at the bright spot in the middle, which
        the model wrongly calls tumour.
      </p>
      <div className="missed-grid">
        {panels.map((panel, i) => (
          <figure key={panel.key} className={`missed-panel panel-${panel.key}`}>
            <canvas
              ref={(el) => {
                canvases.current[i] = el;
              }}
              role="img"
              aria-label={`${panel.title}: ${notes[panel.key]}`}
            />
            <figcaption>
              <strong>{panel.title}</strong>
              <span>{notes[panel.key]}</span>
              {panel.legend.length > 0 && (
                <ul className="missed-legend">
                  {panel.legend.map((item) => (
                    <li key={item.label}>
                      <i
                        className={item.line ? 'line' : undefined}
                        style={{ background: item.color }}
                      />
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="missed-footer">
        <button className="export-button missed-button" onClick={showInViewer}>
          <Crosshair size={15} />
          <span>Show this slice in the viewer</span>
        </button>
        <p>
          Counts on the model&apos;s 128 × 128 grid; images at 1 mm with the
          overlays smoothed for display. Patient right is on the left.
        </p>
      </div>
    </section>
  );
}
