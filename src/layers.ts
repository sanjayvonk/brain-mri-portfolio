// Edema green and enhancing tumour yellow as in the BraTS convention; the
// necrotic core is blue rather than red, because red marks the uncertainty.
export const NECROTIC: [number, number, number] = [45, 125, 255];
export const EDEMA: [number, number, number] = [40, 205, 70];
export const ENHANCING: [number, number, number] = [255, 225, 40];
export const TRUTH: [number, number, number][] = [
  [178, 237, 202],
  [140, 220, 180],
  [226, 250, 236],
];
export const SET: [number, number, number][] = [
  [245, 95, 85],
  [255, 140, 115],
  [255, 190, 155],
];

const rgb = (c: number[]) => `rgb(${c.join(' ')})`;

function lut(colors: [number, number, number][], labels: string[]) {
  return {
    R: [0, ...colors.map((c) => c[0])],
    G: [0, ...colors.map((c) => c[1])],
    B: [0, ...colors.map((c) => c[2])],
    A: [0, ...colors.map(() => 255)],
    I: [0, 1, 2, 3],
    labels: ['', ...labels],
  };
}

export const CLASS_NAMES: Record<number, { name: string; color: string }> = {
  0: { name: 'No tumour', color: 'transparent' },
  1: { name: 'Necrotic core', color: rgb(NECROTIC) },
  2: { name: 'Edema', color: rgb(EDEMA) },
  3: { name: 'Enhancing', color: rgb(ENHANCING) },
};
export type LayerId = 'prediction' | 'truth' | 'uncertainty';

type Layer = {
  name: string;
  caption: string;
  file: string;
  /** Scales the shared opacity slider; the uncertainty shell needs less. */
  weight: number;
  lut: ReturnType<typeof lut>;
  /**
   * In 3D this layer is drawn as light instead: a continuous volume rendered
   * by a separate engine and blended over the view (see Viewer).
   */
  glow3d?: { file: string; colormap: string };
  legend: { label: string; color: string }[];
};

export const LAYERS: Record<LayerId, Layer> = {
  prediction: {
    name: 'U-Net prediction',
    caption: 'Argmax of the softmax',
    file: 'prediction.nii.gz',
    weight: 1,
    lut: lut([NECROTIC, EDEMA, ENHANCING], ['Necrotic', 'Edema', 'Enhancing']),
    legend: [
      { label: 'Necrotic core', color: rgb(NECROTIC) },
      { label: 'Edema', color: rgb(EDEMA) },
      { label: 'Enhancing', color: rgb(ENHANCING) },
    ],
  },
  truth: {
    name: 'Expert annotation',
    caption: 'BraTS ground truth',
    file: 'ground_truth.nii.gz',
    weight: 0.85,
    lut: lut(TRUTH, ['Necrotic', 'Edema', 'Enhancing']),
    legend: [{ label: 'Expert label', color: rgb(TRUTH[0]) }],
  },
  uncertainty: {
    name: 'Conformal uncertainty',
    caption: 'Prediction-set size 2–4',
    file: 'uncertainty.nii.gz',
    weight: 1,
    // Values 2, 3 and 4 hold the set size; 0 and 1 stay transparent.
    lut: {
      R: [0, 0, ...SET.map((c) => c[0])],
      G: [0, 0, ...SET.map((c) => c[1])],
      B: [0, 0, ...SET.map((c) => c[2])],
      A: [0, 0, 175, 238, 255],
      I: [0, 1, 2, 3, 4],
      labels: ['', '', '2 classes', '3 classes', '4 classes'],
    },
    glow3d: { file: 'uncertainty_glow.nii.gz', colormap: 'uncertaintyGlow' },
    legend: [
      { label: 'Set of 2', color: rgb(SET[0]) },
      { label: '3', color: rgb(SET[1]) },
      { label: '4', color: rgb(SET[2]) },
    ],
  },
};
