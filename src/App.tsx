import { ArrowDown, ArrowUpRight, Orbit, ShieldCheck } from 'lucide-react';
import Viewer from './Viewer';
import stats from '../public/data/stats.json';

const GITHUB = 'https://github.com/sanjayvonk/BrainTumorSegmentation';
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const fmt = (v: number) => v.toLocaleString('en-GB');

export default function App() {
  return (
    <>
      <header className="topbar site-topbar">
        <a className="brand" href="#top">
          <Orbit strokeWidth={1.25} />
          <span>
            SANJAY VONK<small>BRAIN MRI · UNCERTAINTY</small>
          </span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          <a href="#viewer">Viewer</a>
          <a href="#method">Method</a>
          <a href="#results">Results</a>
          <a
            className="export-button"
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            aria-label="Source code on GitHub"
          >
            <span>Code</span>
            <ArrowUpRight size={15} />
          </a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="status-dot" /> RESEARCH PROJECT · GLIOMA SEGMENTATION
            </span>
            <h1>
              A tumour segmentation that shows <em>where it might be wrong</em>.
            </h1>
            <p>
              A U-Net outlines three glioma sub-regions on brain MRI. Conformal
              prediction then turns its softmax into prediction sets, so every
              voxel says how many tissue classes are still plausible. The result
              is a calibrated shell of uncertainty around the tumour, rendered
              below in 3D.
            </p>
            <a className="primary-action" href="#viewer">
              Explore the scan <ArrowDown size={16} />
            </a>
          </div>
          <dl className="stat-grid">
            <div>
              <dt>Whole-tumour Dice</dt>
              <dd>{stats.dice.whole_tumour.toFixed(2)}</dd>
              <small>against the expert annotation</small>
            </div>
            <div>
              <dt>Missed tumour inside the shell</dt>
              <dd>{pct(stats.missed_tumour_in_uncertain_region)}</dd>
              <small>of voxels the model labelled healthy</small>
            </div>
            <div>
              <dt>Brain flagged uncertain</dt>
              <dd>{pct(stats.voxels.uncertain_in_brain / stats.voxels.brain)}</dd>
              <small>
                {fmt(stats.voxels.uncertain_in_brain)} of {fmt(stats.voxels.brain)} brain voxels
              </small>
            </div>
            <div>
              <dt>Target false-negative rate</dt>
              <dd>5%</dd>
              <small>of tumour voxels left out of the set</small>
            </div>
          </dl>
        </section>

        <section id="viewer" className="viewer-section" aria-label="Interactive viewer">
          <Viewer
            displayMax={stats.display_max}
            shape={stats.shape}
            voxelMm={stats.voxel_mm}
          />
          <div className="below-viewer">
            <span>
              BraTS 2020 · scans at 1 mm; model outputs mapped from its
              128 × 128 grid
            </span>
            <span>Research visualisation · not for diagnosis</span>
          </div>
        </section>

        <section id="method" className="content-section">
          <header>
            <span className="eyebrow">METHOD</span>
            <h2>From pixels to calibrated prediction sets</h2>
          </header>
          <ol className="method-steps">
            <li>
              <span className="series-index">01</span>
              <h3>Data</h3>
              <p>
                BraTS 2020: multi-institutional pre-operative MRI of glioma
                patients with expert labels for necrotic core, edema and
                enhancing tumour. Each axial slice of FLAIR and contrast T1 is
                resized to 128 × 128 and stacked as two channels.
              </p>
            </li>
            <li>
              <span className="series-index">02</span>
              <h3>Segmentation</h3>
              <p>
                A 2D U-Net with pretrained weights from Rastislav Kopál&apos;s
                public BraTS model predicts a softmax over four classes for
                every pixel. Its argmax is the segmentation you see in colour.
              </p>
            </li>
            <li>
              <span className="series-index">03</span>
              <h3>Conformal calibration</h3>
              <p>
                On held-out calibration scans each voxel gets an adaptive
                prediction-set score: the cumulative softmax mass needed to
                reach the true class. A threshold λ̂ is chosen so that at most
                5% of tumour voxels fall outside their set.
              </p>
            </li>
            <li>
              <span className="series-index">04</span>
              <h3>Uncertainty map</h3>
              <p>
                At test time every voxel keeps the classes whose sorted softmax
                mass stays under λ̂. A set of one is a confident call; sets of
                two to four classes form the red shell in the viewer.
              </p>
            </li>
          </ol>
          <div className="formula">
            <span className="eyebrow">PREDICTION SET</span>
            <p>
              C(x) = &#123; y : Σ<sub>k ≤ rank(y)</sub> π̂<sub>(k)</sub>(x) ≤ λ̂ &#125;
              <small>
                π̂<sub>(k)</sub> is the k-th largest softmax probability. Because one
                class is healthy tissue, any set larger than one contains a
                tumour class.
              </small>
            </p>
          </div>
        </section>

        <section id="results" className="content-section">
          <header>
            <span className="eyebrow">RESULTS</span>
            <h2>The shell catches what the outline misses</h2>
          </header>
          <div className="results-grid">
            <table className="results-table">
              <caption>Dice against the expert annotation</caption>
              <tbody>
                <tr>
                  <th>Whole tumour</th>
                  <td>{stats.dice.whole_tumour.toFixed(3)}</td>
                  <td>
                    <meter min={0} max={1} value={stats.dice.whole_tumour} />
                  </td>
                </tr>
                <tr>
                  <th>Tumour core</th>
                  <td>{stats.dice.tumour_core.toFixed(3)}</td>
                  <td>
                    <meter min={0} max={1} value={stats.dice.tumour_core} />
                  </td>
                </tr>
                <tr>
                  <th>Enhancing tumour</th>
                  <td>{stats.dice.enhancing.toFixed(3)}</td>
                  <td>
                    <meter min={0} max={1} value={stats.dice.enhancing} />
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="result-notes">
              <p>
                The U-Net finds the tumour well as a whole, but the borders
                between its sub-regions are harder. That is exactly where the
                prediction sets grow: of the tumour voxels the model labelled
                as healthy,{' '}
                <strong>{pct(stats.missed_tumour_in_uncertain_region)}</strong>{' '}
                sit inside the uncertainty shell. A reader who looks at the
                shell, not only the outline, sees almost all of the missed
                tumour.
              </p>
              <p className="caveat">
                <ShieldCheck size={15} />
                This scan was one of the calibration scans, so these
                figures are in-sample and describe a single patient. The
                conformal guarantee holds on average over new scans, not for
                any one voxel.
              </p>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div>
            <strong>Credits</strong>
            <p>
              Viewer design and 3D interaction adapted from{' '}
              <a href="https://github.com/lev1nson/OpenMRI" target="_blank" rel="noreferrer">
                OpenMRI
              </a>{' '}
              (MIT). Rendering by{' '}
              <a href="https://niivue.com" target="_blank" rel="noreferrer">
                NiiVue
              </a>
              . U-Net weights by{' '}
              <a
                href="https://www.kaggle.com/code/rastislav/3d-mri-brain-tumor-segmentation-u-net"
                target="_blank"
                rel="noreferrer"
              >
                Rastislav Kopál
              </a>
              . Data: BraTS 2020 (Menze et al., 2015; Bakas et al., 2017, 2018).
            </p>
          </div>
          <div>
            <strong>Disclaimer</strong>
            <p>
              A research and teaching project. It is not a medical device and
              must not be used for diagnosis.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
