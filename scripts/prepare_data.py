"""Build the site's NIfTI files for BraTS 2020 training case 070.

The scans and the expert annotation are written at their native 1 mm
resolution (240 x 240 x 155). The model ran on 128 x 128 slices, so its
prediction and conformal set sizes are resampled smoothly onto the native grid
for display.

Run with a Python that has nibabel, numpy and scipy:
    python scripts/prepare_data.py <research-project-dir> <out-dir>
"""

import base64
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

# The site's files are kept small: everything is cropped to the brain's
# bounding box (the brain fills about 40% of the 240 x 240 x 155 grid), the
# scans are stored as 8-bit and gzip runs at its strongest level.
nib.openers.Opener.default_compresslevel = 9
xs, ys, zs = np.nonzero(np.asarray(source.dataobj) > 0)
box = tuple(
    slice(max(int(a.min()) - 2, 0), min(int(a.max()) + 3, n))
    for a, n in zip((xs, ys, zs), source.shape)
)
crop_shape = [b.stop - b.start for b in box]
affine = source.affine.copy()
affine[:3, 3] += source.affine[:3, :3] @ [b.start for b in box]


def save(data, name):
    img = nib.Nifti1Image(data[box], affine)
    img.header.set_xyzt_units("mm")
    nib.save(img, out / f"{name}.nii.gz")


# Native scans, scaled to 8 bits from the brain's intensities. Each also gets
# a display window.
display_max = {}
scaled = {}
for scan in ["flair", "t1ce", "t1", "t2"]:
    data = np.asarray(nib.load(case_dir / f"BraTS20_Training_{case}_{scan}.nii").dataobj)
    data = np.clip(data, 0, None).astype(np.float32)
    data = np.clip(np.rint(data / np.percentile(data[data > 0], 99.9) * 255), 0, 255)
    data = data.astype(np.uint8)
    scaled[scan] = data
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


VOXEL_SCALE = (NATIVE / MODEL) ** 2  # native voxels per model voxel


def smooth_region(mask, sigma=SIGMA):
    """Smooth a model-grid mask onto the native grid, keeping its volume."""
    fine = ndimage.map_coordinates(mask.astype(np.float32), [cx, cy, cz], order=1, mode="nearest")
    fine = ndimage.gaussian_filter(fine, sigma)
    target = int(round(mask.sum() * VOXEL_SCALE))
    if target == 0:
        return np.zeros(fine.shape, bool)
    # Blurring shrinks small regions at a 0.5 cut, so threshold at the level
    # that keeps the region as large as it was on the model grid.
    threshold = np.partition(fine.ravel(), -target)[-target]
    return fine >= max(threshold, 1e-3)


# Smooth the nested BraTS regions rather than each class: whole tumour
# {1,2,3}, tumour core {1,3} and enhancing tumour {3}. The inner borders then
# come out as smooth surfaces too, instead of speckled islands.
whole = smooth_region(labels > 0)
core = smooth_region(np.isin(labels, [1, 3])) & whole
enhancing = smooth_region(labels == 3) & core
# Where the core and enhancing borders nearly coincide, core minus enhancing
# leaves thin slivers; fold the small ones into the enhancing tumour.
slivers, count = ndimage.label(core & ~enhancing)
sizes = ndimage.sum(np.ones_like(slivers), slivers, range(1, count + 1))
enhancing |= np.isin(slivers, np.flatnonzero(sizes < 30) + 1)
prediction = np.zeros(whole.shape, np.uint8)
prediction[whole] = 2
prediction[core] = 1
prediction[enhancing] = 3
save(prediction, "prediction")
# Set sizes are nested shells (1 = confident); interpolate them as a number.
set_size = np.clip(np.rint(resample(np.maximum(sets, 1).astype(np.float32))), 1, 4)
# Prediction-set size 1 means the set holds one class. Keep only uncertain voxels.
save(np.where(set_size > 1, set_size, 0).astype(np.uint8), "uncertainty")

# A soft glow of the same uncertainty for the 3D view: sets of three or four
# shine, sets of two only faintly, blurred into a halo and scaled to 0-255.
weight = np.array([0, 0, 0.15, 0.6, 1.0], np.float32)  # by set size 0-4
glow = ndimage.gaussian_filter(resample(weight[sets]), (2.5, 2.5, 2.0))
glow = np.clip(glow / np.percentile(glow[glow > 0.01], 99.5), 0, 1)
save(np.rint(glow * 255).astype(np.uint8), "uncertainty_glow")

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
# The figure below the viewer: an axial slice where the model misses the
# tumour but the uncertainty does not. Chosen on the model grid, among slices
# where the model finds under 5% of the expert's tumour, as the one where the
# most missed voxels fall inside the uncertainty region.
best = None
for z in range(labels.shape[2]):
    truth, found, flagged = tumour_gt[:, :, z], tumour_pred[:, :, z], sets[:, :, z] > 1
    if truth.sum() < 30 or (truth & found).sum() >= 0.05 * truth.sum():
        continue
    caught = int((truth & ~found & flagged).sum())
    if best is None or caught > best["caught"]:
        best = {
            "z": z,
            "tumour": int(truth.sum()),
            "found": int((truth & found).sum()),
            "missed": int((truth & ~found).sum()),
            "caught": caught,
        }
stats["missed_slice"] = best
(out / "stats.json").write_text(json.dumps(stats, indent=2))

# Slice images for that figure, from the native display volumes, cropped to
# the brain and stored as rows top to bottom, anterior first, patient right on
# the right.
z = best["z"]
flair = scaled["flair"][:, :, z]
t1ce = scaled["t1ce"][:, :, z]
xs, ys = np.nonzero(flair > 0)
pad = 6
x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, NATIVE)
y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, NATIVE)


def plane(volume, window=None):
    data = volume[x0:x1, y0:y1].astype(np.float32)
    if window:
        data = np.clip(data / window * 255, 0, 255)
    # Voxel x grows toward the patient's left and y toward posterior. After the
    # transpose rows run anterior to posterior; mirroring the columns puts the
    # patient's right on the right of the image.
    return base64.b64encode(np.ascontiguousarray(data.T[:, ::-1]).astype(np.uint8).tobytes()).decode()


slice_data = {
    "z": z,
    "width": int(x1 - x0),
    "height": int(y1 - y0),
    "flair": plane(flair, display_max["flair"]),
    "t1ce": plane(t1ce, display_max["t1ce"]),
    "prediction": plane(prediction[:, :, z]),
    "uncertainty": plane(np.where(set_size > 1, set_size, 0)[:, :, z]),
    "truth": plane(gt_native[:, :, z]),
    # Centre of the missed tumour as a RAS volume fraction, for the viewer.
    # NiiVue flips x and y into RAS order; the fraction is of the cropped grid.
    "focus": [
        float((box[0].stop - 1 - np.argwhere(gt_native[:, :, z] > 0)[:, 0].mean() + 0.5) / crop_shape[0]),
        float((box[1].stop - 1 - np.argwhere(gt_native[:, :, z] > 0)[:, 1].mean() + 0.5) / crop_shape[1]),
        float((z - box[2].start + 0.5) / crop_shape[2]),
    ],
}
(out / "missed_slice.json").write_text(json.dumps(slice_data))
print(json.dumps(stats, indent=2))
