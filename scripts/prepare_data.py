"""Build the site's NIfTI files for BraTS 2020 training case 070.

The scans and the expert annotation are written at their native 1 mm
resolution (240 x 240 x 155). The model ran on 128 x 128 slices, so its
prediction and conformal set sizes are resampled smoothly onto the native grid
for display.

Run with a Python that has nibabel, numpy and scipy:
    python scripts/prepare_data.py <research-project-dir> <out-dir>
"""

import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage

src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
case = "070"
case_dir = (
    src / "BraTS2020_TrainingData" / "MICCAI_BraTS2020_TrainingData" / f"BraTS20_Training_{case}"
)
MODEL, NATIVE = 128, 240

# Model outputs on the 128 x 128 grid (exported by the research notebook).
labels = nib.load(src / "tumor_labels.nii.gz").get_fdata().round().astype(np.uint8)
sets = nib.load(src / "uncertainty.nii.gz").get_fdata().round().astype(np.uint8)

source = nib.load(case_dir / f"BraTS20_Training_{case}_flair.nii")
affine = source.affine


def save(data, name):
    img = nib.Nifti1Image(data, affine)
    img.header.set_xyzt_units("mm")
    nib.save(img, out / f"{name}.nii.gz")


# Native scans. Each gets its own display window from the brain voxels.
display_max = {}
for scan in ["flair", "t1ce", "t1", "t2"]:
    data = np.asarray(nib.load(case_dir / f"BraTS20_Training_{case}_{scan}.nii").dataobj)
    data = np.clip(data, 0, None).astype(np.int16)
    save(data, scan)
    display_max[scan] = float(np.percentile(data[data > 0], 99.5))

# The model ran on 128 x 128 slices. For display, its outputs are resampled
# smoothly onto the native grid instead of being copied as 1.875 mm blocks:
# each class map (or the set size) is interpolated, lightly blurred, and turned
# back into labels. The page's figures stay on the model grid below.
SIGMA = (1.2, 1.2, 0.8)  # native voxels, x y z
coords = (np.arange(NATIVE) + 0.5) * MODEL / NATIVE - 0.5
cx, cy, cz = np.meshgrid(coords, coords, np.arange(labels.shape[2]), indexing="ij")


def resample(volume):
    """Linearly interpolate a model-grid float volume onto the native grid."""
    fine = ndimage.map_coordinates(volume, [cx, cy, cz], order=1, mode="nearest")
    return ndimage.gaussian_filter(fine, SIGMA)


def smooth_labels(volume, values):
    scores = np.stack([resample((volume == v).astype(np.float32)) for v in values])
    return np.asarray(values, dtype=np.uint8)[scores.argmax(0)]


prediction = smooth_labels(labels, [0, 1, 2, 3])
save(prediction, "prediction")
# Set sizes are nested shells (1 = confident); interpolate them as a number.
set_size = np.clip(np.rint(resample(np.maximum(sets, 1).astype(np.float32))), 1, 4)
# Prediction-set size 1 means the set holds one class. Keep only uncertain voxels.
save(np.where(set_size > 1, set_size, 0).astype(np.uint8), "uncertainty")

seg = np.asarray(nib.load(case_dir / f"BraTS20_Training_{case}_seg.nii").dataobj)
gt_native = np.where(seg == 4, 3, seg).astype(np.uint8)
save(gt_native, "ground_truth")

# Figures are computed on the model's 128 grid, where the method was calibrated.
down = (np.arange(MODEL) * NATIVE / MODEL + NATIVE / (2 * MODEL)).astype(int)
gt = gt_native[np.ix_(down, down, np.arange(gt_native.shape[2]))]
flair_128 = nib.load(src / "flair_128.nii.gz").get_fdata()


def dice(a, b):
    return float(2 * (a & b).sum() / (a.sum() + b.sum()))


tumour_pred, tumour_gt = labels > 0, gt > 0
brain = flair_128 > 0
missed = tumour_gt & ~tumour_pred
stats = {
    "shape": list(source.shape),
    "voxel_mm": [float(v) for v in source.header.get_zooms()[:3]],
    "model_shape": list(labels.shape),
    "display_max": display_max,
    "dice": {
        "whole_tumour": dice(tumour_pred, tumour_gt),
        "tumour_core": dice(np.isin(labels, [1, 3]), np.isin(gt, [1, 3])),
        "enhancing": dice(labels == 3, gt == 3),
    },
    "voxels": {
        "predicted_tumour": int(tumour_pred.sum()),
        "ground_truth_tumour": int(tumour_gt.sum()),
        "uncertain": int((sets > 1).sum()),
        "brain": int(brain.sum()),
        "uncertain_in_brain": int(((sets > 1) & brain).sum()),
    },
    "set_size_counts": {str(k): int((sets == k).sum()) for k in range(1, 5)},
    "missed_tumour_in_uncertain_region": float((missed & (sets > 1)).sum() / max(missed.sum(), 1)),
    # Sanity check that the native grid lines up with the model's outputs.
    "native_whole_tumour_dice": dice(prediction > 0, gt_native > 0),
}
(out / "stats.json").write_text(json.dumps(stats, indent=2))
print(json.dumps(stats, indent=2))
