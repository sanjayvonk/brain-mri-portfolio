"""Build the site's NIfTI files for BraTS 2020 training case 070.

The scans and the expert annotation are written at their native 1 mm
resolution (240 x 240 x 155). The model ran on 128 x 128 slices, so its
prediction and conformal set sizes are mapped onto the native grid with
nearest-neighbour lookup.

Run with a Python that has nibabel and numpy:
    python scripts/prepare_data.py <research-project-dir> <out-dir>
"""

import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np

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

# Native voxel j lies inside model voxel floor((j + 0.5) * 128 / 240).
up = ((np.arange(NATIVE) + 0.5) * MODEL / NATIVE).astype(int)
grid = np.ix_(up, up, np.arange(labels.shape[2]))
save(labels[grid], "prediction")
# Prediction-set size 1 means the set holds one class. Keep only uncertain voxels.
save(np.where(sets > 1, sets, 0).astype(np.uint8)[grid], "uncertainty")

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
    "native_whole_tumour_dice": dice(labels[grid] > 0, gt_native > 0),
}
(out / "stats.json").write_text(json.dumps(stats, indent=2))
print(json.dumps(stats, indent=2))
