// NiiVue's 3D shader accumulates overlay colour premultiplied by alpha, then
// mixes it over the volume by alpha again. Opaque labels are unaffected, but
// translucent overlays, such as the prediction below full opacity, come out
// darker than the tissue behind them. Dividing the alpha back out gives standard "over"
// compositing. The shader source is rewritten as it is compiled.
const ORIGINAL = 'fColor.rgb = mix(fColor.rgb, colAcc.rgb, overMix);';
const FIXED =
  'fColor.rgb = mix(fColor.rgb, colAcc.rgb / max(colAcc.a, 0.0001), overMix);';

let patched = false;

export function patchOverlayBlending() {
  if (patched || typeof WebGL2RenderingContext === 'undefined') return;
  patched = true;
  const proto = WebGL2RenderingContext.prototype;
  const shaderSource = proto.shaderSource;
  proto.shaderSource = function (shader, source) {
    shaderSource.call(
      this,
      shader,
      source.includes(ORIGINAL) ? source.replaceAll(ORIGINAL, FIXED) : source,
    );
  };
}
