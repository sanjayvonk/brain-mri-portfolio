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

`public/data/` holds BraTS 2020 training case 070 on the model's
128 × 128 × 155 grid: FLAIR, the U-Net prediction, the expert annotation and
the conformal prediction-set size. They are produced from the research
project's exports with

```sh
python scripts/prepare_data.py "<path>/Research Project" public/data
```

which needs `nibabel` and `numpy`, and the BraTS 2020 training data for the
expert annotation. The script also writes `stats.json`, which the page reads
for its figures.

BraTS data: Menze et al., IEEE TMI 2015; Bakas et al., Scientific Data 2017;
Bakas et al., arXiv:1811.02629, 2018.

## Deploy

Pushing to `main` builds the site and publishes it with GitHub Pages
(`.github/workflows/deploy.yml`). In the repository settings, set
**Pages → Source** to **GitHub Actions** once.

Research visualisation only; not a medical device.
