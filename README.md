# Glioma uncertainty viewer

An interactive portfolio page for a brain tumour segmentation project: a U-Net
segments glioma sub-regions on BraTS 2020 MRI, and conformal prediction turns
its softmax into prediction sets that mark where the model is unsure. The page
renders one case in 3D and on three linked slices, with the prediction, the
expert annotation and the uncertainty as switchable layers.

The viewer is adapted from [OpenMRI](https://github.com/lev1nson/OpenMRI)
(MIT) and renders with [NiiVue](https://niivue.com). It is a static site; no
server is needed.

## Run locally

```sh
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static site in dist/
```

## Data

`public/data/` holds one BraTS 2020 training scan at its native 1 mm
resolution (240 × 240 × 155): the FLAIR, T1, contrast T1 and T2 scans, the
expert annotation, and the model's prediction and conformal prediction-set
size. The model ran on 128 × 128 slices, so for display its outputs are
interpolated onto the native grid and lightly smoothed; the figures on the
page are computed on the model's own grid. The files are produced from the
research project's exports and the BraTS 2020 training data with

```sh
python scripts/prepare_data.py "<path>/Research Project" public/data
```

which needs `nibabel`, `numpy` and `scipy`. The script writes `stats.json` into
`src/data/`, which the page reads for its figures.

BraTS data: Menze et al., IEEE TMI 2015; Bakas et al., Scientific Data 2017;
Bakas et al., arXiv:1811.02629, 2018.

## Deploy

Pushing to `main` builds the site and publishes it with GitHub Pages
(`.github/workflows/deploy.yml`). In the repository settings, set
**Pages → Source** to **GitHub Actions** once.

Research visualisation only; not a medical device.
