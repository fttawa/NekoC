#!/usr/bin/env node
// Read-only official-source evidence recorder. Store coordinates and hashes, never source bodies.
// Usage: K4_PLAYER_DIR=<read-only official resources/app> node tools/compat/k4-effects-11-source.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const file = 'src/player/build/player_v2.2d180c468559fbd29528.js.orig';
const expectedSha256 = '0f7933d51266add6cbad0682b9531036dc1c8daf8c522cde4243744376ce4160';
if (!process.env.K4_PLAYER_DIR) throw Error('K4_PLAYER_DIR must point at the read-only official app');
const bytes = await readFile(path.join(process.env.K4_PLAYER_DIR, file));
const sha256 = hash(bytes);
if (sha256 !== expectedSha256) throw Error('Unexpected official bundle; re-audit coordinates before recording');
const source = bytes.toString('utf8');

// Coordinates were independently inspected in the identity-pinned bundle, not executed or imported.
// Each entry is [UTF-16 offset, anchor length, evidence-window length].
const locations = {
  tweenCreate: [786189, 16, 1006],
  tweenTo: [787195, 12, 129],
  tweenFromTo: [787518, 19, 156],
  slide: [789066, 28, 424],
  distort: [789964, 28, 1024],
  filterPushOverride: [1598609, 32, 1438],
  filterClipDoubleStage: [1599132, 52, 256],
  roundFrame: [1386850, 43, 320],
  legacyQuadMap: [1380071, 42, 480],
  applyFilter: [1385192, 30, 365],
  projectionUpdate: [1427418, 58, 462],
  projectionCalculate: [1427880, 50, 256],
  renderTextureBind: [1428339, 54, 800],
  renderTextureProjectionUpdate: [1428897, 41, 256],
  renderTextureViewportY: [1428823, 37, 256],
  filterBindAndClear: [1384440, 39, 740],
  filterLegacyGlobals: [1383442, 32, 640],
  getEffectFilter: [793395, 21, 640],
  disableEffects: [796653, 18, 256],
  updateTwistOffset: [792444, 31, 256],
  setTwist: [795853, 13, 320],
  scissorY: [1425907, 31, 256],
};
const anchors = Object.fromEntries(Object.entries(locations).map(([name, [offset, anchorLength, windowLength]]) => {
  if (offset < 0 || offset + windowLength > source.length || anchorLength > windowLength) {
    throw Error(`Invalid source coordinate: ${name}`);
  }
  return [name, {
    offset,
    anchorLength,
    anchorSha256: hash(source.slice(offset, offset + anchorLength)),
    windowLength,
    windowSha256: hash(source.slice(offset, offset + windowLength)),
  }];
}));
const evidence = {
  schema: 'nekoc-k4-effects-11-source-v1',
  file,
  sha256,
  byteLength: bytes.length,
  decodedLength: source.length,
  offsetUnit: '0-based UTF-16 code units after UTF-8 decoding; NOT file byte offsets',
  hashEncoding: 'SHA-256 of original file bytes for sha256; UTF-8 re-encoding of the exact decoded slice for anchorSha256/windowSha256',
  sourcePolicy: 'Read-only identity-pinned official input; metadata, hashes and independently worded mechanism notes only. No source excerpts, copied function bodies, execution or runtime capture.',
  anchors,
  mechanisms: {
    slide: {
      anchors: ['slide', 'tweenCreate', 'tweenTo'],
      notes: [
        'The incoming scene is made visible and starts one view width or height offscreen. Down/up place it above/below; left/right place it right/left.',
        'Outgoing and incoming moves both start immediately and last 0.5 seconds, using QUAD easing. Chained to calls register independent concurrent tweens, not sequential timeline segments.',
      ],
    },
    distort: {
      anchors: ['distort', 'tweenCreate', 'tweenFromTo'],
      notes: [
        'The full stage is rendered twice into view-sized render textures, with outgoing and incoming scene visibility switched between captures.',
        'The two snapshot sprites have centered anchors. Twist filters use the minimum view dimension as radius, view center as offset, and padding 10.',
        'Outgoing alpha falls from 1 to 0 and twist changes from 0 to -227.8 degrees over 0.5 seconds. Incoming alpha rises from 0 to 1 and twist changes from 189 degrees to 0 over 0.5 seconds, each with a 0.1-second delay from its registration.',
        'Each from_to call applies its initial state immediately, then registers an independent tween. Its optional final argument is a delay in seconds; it is not an absolute insertion position in a sequential timeline.',
      ],
    },
    filterCapture: {
      anchors: ['filterPushOverride', 'filterClipDoubleStage', 'roundFrame', 'filterBindAndClear'],
      notes: [
        'The later Bn prototype assignment replaces the earlier filter push implementation; compatibility must follow this override rather than the original method.',
        'Across filters, resolution is the minimum, padding is the maximum, autoFit is the conjunction, and legacy is the disjunction.',
        'The source frame begins as filterArea or target bounds and receives padding. With autoFit, the allowed rectangle has twice the current render-target sourceFrame width and height, with its origin shifted by half the original width and height, preserving its center. This is 2x stage extent only when the current sourceFrame is the full stage.',
        'An active projection transform is inverted for the clipping rectangle before fitting. roundFrame maps the source frame through source/destination coordinates and an eligible transform, rounds outward at the current target resolution, and maps back. Non-axis-aligned transforms skip that rounding.',
        'The filter capture preserves previous source/destination frames and projection transform, clears the projection transform for capture, binds a zero-origin destination sized to the rounded source frame, and clears transparent.',
        'bindAndClear restores the saved projection transform only when returning to the preceding stack render target; a filterFrame is rebound with its matching zero-origin destination.',
      ],
    },
    projectionY: {
      anchors: ['renderTextureBind', 'renderTextureViewportY', 'renderTextureProjectionUpdate', 'projectionUpdate', 'projectionCalculate', 'scissorY'],
      notes: [
        'renderTexture.bind chooses a framebuffer for an offscreen render texture and no framebuffer for the screen; the fourth projection.update argument is true only without that framebuffer.',
        'calculateProjection uses that screen flag to select the Y sign. Before any optional projection transform, screen rendering has Y scale -2/sourceHeight and Y translation 1 + 2*sourceY/sourceHeight. Offscreen rendering has Y scale +2/sourceHeight and Y translation -1 - 2*sourceY/sourceHeight. X scale is +2/sourceWidth for both.',
        'Thus increasing world Y moves downward in screen clip space, but upward in offscreen clip space. This is the render-target projection convention, not evidence of an unconditional image flip to apply to every texture.',
        'Screen-only viewport and scissor handling also convert Y relative to the view or renderer height; the render-texture paths omit those conversions.',
        'Projection update can append an additional transform. The saved/restored filter projection state and render-target convention must be considered together when interpreting stage snapshots and filter quads.',
      ],
    },
    legacyFilterQuad: {
      anchors: ['legacyQuadMap', 'applyFilter', 'filterLegacyGlobals'],
      notes: [
        'applyFilter binds and clears the destination, supplies the input texture and global uniforms, then selects the legacy or modern quad path.',
        'The legacy quad is mapped from the input texture frame and filterFrame. Vertex positions span the source-frame rectangle including its origin; UVs start at zero and span source-frame width/texture-frame width and height/texture-frame height, with no explicit Y reversal in this mapping.',
        'Legacy drawing uses indexed triangles; the non-legacy path uses a triangle strip. Legacy filterArea carries pooled destination dimensions and source-frame origin, while filterClamp aliases inputClamp.',
        'The clamp bounds use half-pixel offsets derived from the resolution-scaled pooled texture size, and limit the upper edge to the source-frame fraction of that texture.',
      ],
    },
    effectLifecycle: {
      anchors: ['getEffectFilter', 'disableEffects', 'updateTwistOffset', 'setTwist'],
      notes: [
        'Effect filters are cached by effect index. Acquiring one enables it, and a newly created entry rebuilds the target filter list from populated entries in index order.',
        'disable_effects disables existing filter objects and resets the exposed default values, rather than removing the cached filter list.',
        'Twist offset converts the target position to view-centered coordinates, reversing target Y. It updates only for an enabled twist filter and is refreshed on relevant position changes.',
        'set_twist clamps the exposed amount to 0..100, converts ten times that amount from degrees to the angle representation, sets radius to the half-width/half-height diagonal, and refreshes the offset.',
      ],
    },
  },
};
const json = `${JSON.stringify(evidence, null, 2)}\n`;
const outputBytes = Buffer.byteLength(json);
if (outputBytes >= 20 * 1024) throw Error(`Source evidence exceeds 20 KiB: ${outputBytes}`);
const output = path.join(root, 'docs/kitten4-partial-effects-11-source.json');
await writeFile(output, json, 'utf8');
console.log(JSON.stringify({ file: 'docs/kitten4-partial-effects-11-source.json', sha256, anchors: Object.keys(anchors).length, bytes: outputBytes }));
