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
type Panel = {
  key: 'scan' | 'prediction' | 'uncertainty' | 'truth';
  title: string;
  colors: Record<number, Rgb>;
};

const SCALE = 4;
const panels: Panel[] = [
  { key: 'scan', title: 'MRI · FLAIR', colors: {} },
  {
    key: 'prediction',
    title: 'U-Net prediction',
    colors: { 1: NECROTIC, 2: EDEMA, 3: ENHANCING },
  },
  {
    key: 'uncertainty',
    title: 'Conformal uncertainty',
    colors: { 2: SET[0], 3: SET[1], 4: SET[2] },
  },
  {
    key: 'truth',
    title: 'Expert annotation',
    colors: { 1: NECROTIC, 2: EDEMA, 3: ENHANCING },
  },
];

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

function draw(
  canvas: HTMLCanvasElement,
  data: SliceData,
  scan: Uint8Array,
  labels: Uint8Array | null,
  colors: Record<number, Rgb>,
) {
  const { width, height } = data;
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const g = scan[i];
    let [r, gr, b] = [g, g, g];
    const color = labels ? colors[labels[i]] : undefined;
    if (color) {
      // Same weight as the viewer's default overlay opacity.
      r = g * 0.3 + color[0] * 0.7;
      gr = g * 0.3 + color[1] * 0.7;
      b = g * 0.3 + color[2] * 0.7;
    }
    image.data.set([r, gr, b, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const out = canvas.getContext('2d')!;
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = 'high';
  out.drawImage(small, 0, 0, canvas.width, canvas.height);
}

export default function MissedSlice({
  counts,
}: {
  counts: { z: number; tumour: number; found: number; missed: number; caught: number };
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
    const scan = decode(data.flair);
    panels.forEach((panel, i) => {
      const canvas = canvases.current[i];
      if (!canvas) return;
      const labels = panel.key === 'scan' ? null : decode(data[panel.key]);
      draw(canvas, data, scan, labels, panel.colors);
    });
  }, [data]);

  const pct = Math.round((counts.found / counts.tumour) * 100);
  const notes: Record<Panel['key'], string> = {
    scan: `Axial slice ${counts.z}. A glioma sits low in the right hemisphere: the bright region on the right of the brain.`,
    prediction: `The model labels only ${counts.found} of the ${counts.tumour} tumour voxels (${pct}%). The other ${counts.missed}, nearly the whole lesion, go undetected.`,
    uncertainty: `Flags ${counts.caught === counts.missed ? 'all' : `${counts.caught} of the`} ${counts.missed} voxels the model missed. The lesion stands out as uncertain, even where the model called it healthy.`,
    truth: `The ground truth: ${counts.tumour} voxels of tumour, mostly necrotic core with edema and enhancing tumour around it. This is the lesion the model should have found.`,
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
        as healthy tissue, although the expert marks tumour there. The
        segmentation alone would hide it. The conformal prediction sets do not:
        every voxel the model missed on this slice keeps more than one class in
        its set, so the region lights up as uncertain. The same happens at the
        bright spot in the middle, which the model wrongly calls tumour.
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
          overlays smoothed for display. Patient right is on the right.
        </p>
      </div>
    </section>
  );
}
