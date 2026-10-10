"""Convert the exported BraTS case 070 volumes into compact NIfTI files for the site.

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

flair = nib.load(src / "flair_128.nii.gz").get_fdata()
labels = nib.load(src / "tumor_labels.nii.gz").get_fdata().round().astype(np.uint8)
sets = nib.load(src / "uncertainty.nii.gz").get_fdata().round().astype(np.uint8)

# The exports were saved with an identity affine. Borrow the scanner geometry of
# the source scan and stretch it to the 128 x 128 grid (240 mm / 128 voxels).
source = nib.load(case_dir / f"BraTS20_Training_{case}_flair.nii")
affine = source.affine.copy()
affine[:3, :2] *= 240 / 128

# Expert annotation, resampled to the same grid with nearest neighbour.
seg = np.asarray(nib.load(case_dir / f"BraTS20_Training_{case}_seg.nii").dataobj)
seg = np.where(seg == 4, 3, seg).astype(np.uint8)
idx = (np.arange(128) * 240 / 128 + 240 / 256).astype(int)
gt = seg[np.ix_(idx, idx, np.arange(seg.shape[2]))]

# Prediction-set size 1 means the set holds one class. Keep only uncertain voxels.
uncertain = np.where(sets > 1, sets, 0).astype(np.uint8)


def save(data, name):
    img = nib.Nifti1Image(data, affine)
    img.header.set_xyzt_units("mm")
    nib.save(img, out / f"{name}.nii.gz")


flair_u16 = np.clip(flair / flair.max() * 4095, 0, 4095).astype(np.uint16)
save(flair_u16, "flair")
save(labels, "prediction")
save(gt, "ground_truth")
save(uncertain, "uncertainty")


def dice(a, b):
    return float(2 * (a & b).sum() / (a.sum() + b.sum()))


tumour_pred, tumour_gt = labels > 0, gt > 0
brain = flair > 0
stats = {
    "case": case,
    "shape": list(flair.shape),
    "voxel_mm": [240 / 128, 240 / 128, 1.0],
    "display_max": float(np.percentile(flair_u16[brain], 99.5)),
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
    "missed_tumour_in_uncertain_region": float(
        ((tumour_gt & ~tumour_pred) & (sets > 1)).sum() / max((tumour_gt & ~tumour_pred).sum(), 1)
    ),
}
(out / "stats.json").write_text(json.dumps(stats, indent=2))
print(json.dumps(stats, indent=2))
