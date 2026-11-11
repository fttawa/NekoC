// K4's brush makes two source-over Canvas operations per movement: an origin
// disk, then a closed two-point round-joined stroke. A single capsule loses
// the extra opacity at the origin. Independently implemented from observations
// recorded by tools/compat/k4-partial-pen-3-fixtures.mjs (a1xw/Rt).
export function paintK4PenLines(ctx, lines, start, count, width, height) {
  for (let i = start * 9, end = (start + count) * 9; i < end; i += 9) {
    const [x0, y0, x1, y1, size, r, g, b, alpha] = lines.subarray(i, i + 9);
    ctx.lineWidth = size;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = ctx.fillStyle = `rgb(${[r, g, b].map(v => Math.round(v * 255)).join(',')})`;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(width / 2 + x0, height / 2 - y0, size / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(width / 2 + x0, height / 2 - y0);
    ctx.lineTo(width / 2 + x1, height / 2 - y1);
    ctx.closePath();
    ctx.stroke();
  }
}

// Upload only the current contiguous batch's clipped rectangle, preserving
// renderer.apply's existing stamp/fill ordering and per-scene pen surfaces.
// The caller owns GL disposal for renderer.k4PenTexture, like fillTexture.
export function drawK4PenLines(renderer, lines, start, count) {
  if (!count) return;
  const { gl, width, height } = renderer;
  const sx = renderer.canvas.width / width, sy = renderer.canvas.height / height;
  let left = renderer.canvas.width, right = 0, top = renderer.canvas.height, bottom = 0;
  for (let i = start * 9, end = (start + count) * 9; i < end; i += 9) {
    const [x0, y0, x1, y1, size] = lines.subarray(i, i + 5);
    left = Math.min(left, (width / 2 + Math.min(x0, x1) - size / 2) * sx);
    right = Math.max(right, (width / 2 + Math.max(x0, x1) + size / 2) * sx);
    top = Math.min(top, (height / 2 - Math.max(y0, y1) - size / 2) * sy);
    bottom = Math.max(bottom, (height / 2 - Math.min(y0, y1) + size / 2) * sy);
  }
  left = Math.max(0, Math.floor(left) - 1); right = Math.min(renderer.canvas.width, Math.ceil(right) + 1);
  top = Math.max(0, Math.floor(top) - 1); bottom = Math.min(renderer.canvas.height, Math.ceil(bottom) + 1);
  if (right <= left || bottom <= top) return;
  const canvas = renderer.k4PenCanvas ??= document.createElement('canvas');
  canvas.width = right - left; canvas.height = bottom - top;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(sx, 0, 0, sy, -left, -top);
  paintK4PenLines(ctx, lines, start, count, width, height);
  const texture = renderer.k4PenTexture ??= renderer.makeTexture(1, 1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  renderer.drawTexture(texture, (left + right) / 2 / sx - width / 2,
    height / 2 - (top + bottom) / 2 / sy, canvas.width / sx, canvas.height / sy);
}
