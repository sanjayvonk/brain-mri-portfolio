import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, LoaderCircle } from 'lucide-react';
import MissedSlice from './MissedSlice';
import stats from './data/stats.json';

const Viewer = lazy(() => import('./Viewer'));

type ViewerStatus = 'loading' | 'ready' | 'error';

function ViewerLoadState({ overlay = false }: { overlay?: boolean }) {
  return (
    <div
      className={`viewer-load-state${overlay ? ' viewer-load-mask' : ''}`}
      role="status"
      aria-live="polite"
    >
      <LoaderCircle size={30} className="spin" />
      <strong>Loading scan</strong>
      <span>Preparing MRI, segmentation and uncertainty layers</span>
    </div>
  );
}

const GITHUB = 'https://github.com/sanjayvonk/BrainTumorSegmentation';

export default function App() {
  const [viewerRequested, setViewerRequested] = useState(false);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>('loading');
  const viewerRequestedAt = useRef<number | null>(null);
  const pendingFocus = useRef<[number, number, number] | null>(null);
  const requestViewer = () => {
    if (viewerRequested) return;
    viewerRequestedAt.current = Date.now();
    setViewerStatus('loading');
    setViewerRequested(true);
  };
  const handleViewerLoad = useCallback((status: 'ready' | 'error') => {
    const elapsed = Date.now() - (viewerRequestedAt.current ?? Date.now());
    const delay = status === 'ready' ? Math.max(0, 5000 - elapsed) : 0;
    window.setTimeout(() => {
      setViewerStatus(status);
      if (status === 'ready' && pendingFocus.current) {
        window.dispatchEvent(
          new CustomEvent('viewer:focus', {
            detail: { frac: pendingFocus.current },
          }),
        );
        pendingFocus.current = null;
      }
    }, delay);
  }, []);
  const showSliceInViewer = (frac: [number, number, number]) => {
    if (viewerStatus === 'ready') {
      window.dispatchEvent(new CustomEvent('viewer:focus', { detail: { frac } }));
      return;
    }
    pendingFocus.current = frac;
    requestViewer();
  };

  return (
    <>
      <header className="topbar site-topbar">
        <a className="brand" href="#top">
          <span>
            SANJAY VONK
            <small>False Negative Control for Automated Tumor Segmentation</small>
          </span>
        </a>
        <nav className="site-nav" aria-label="Sections">
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
          </div>
        </section>

        <section id="viewer" className="viewer-section" aria-label="Interactive viewer">
          {!viewerRequested ? (
            <div className="viewer-launch">
              <div>
                <span className="eyebrow">INTERACTIVE MRI VIEWER</span>
                <h2>Explore the scan</h2>
                <p>
                  Open the BraTS 2020 case to inspect the MRI, model prediction,
                  expert annotation and uncertainty map.
                </p>
              </div>
              <a
                className="viewer-launch-button"
                href="#viewer"
                onClick={requestViewer}
              >
                Load 3D demo <ArrowDown size={16} />
              </a>
            </div>
          ) : (
            <Suspense fallback={<ViewerLoadState />}>
              <div className="viewer-load-wrap" aria-busy={viewerStatus === 'loading'}>
                <Viewer
                  displayMax={stats.display_max}
                  shape={stats.shape}
                  onInitialLoad={handleViewerLoad}
                />
                {viewerStatus === 'loading' && <ViewerLoadState overlay />}
              </div>
            </Suspense>
          )}
        </section>

        <MissedSlice
          counts={stats.missed_slice}
          onShowInViewer={showSliceInViewer}
        />
      </main>
    </>
  );
}
