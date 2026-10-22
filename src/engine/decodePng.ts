// Manual PNG decode for data textures that must survive a real, varying alpha
// channel exactly. `landcover.png` stores a fraction in every one of R/G/B/A
// (open-ground fraction included), and A legitimately hits 0 for plenty of
// cells (100% tree, 100% built-up, ...). The HTML Canvas 2D spec explicitly
// leaves RGB undefined wherever a pixel's alpha is 0 (the usual
// `new Image()` + `<canvas>` + `getImageData()` path masks.ts uses for
// masks.png), so a real alpha channel can't go through that path without risk
// of silently losing R/G/B at every zero-alpha pixel. This fetches and
// inflates the PNG by hand instead, sidestepping the canvas pixel pipeline.

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Response(ab).body!.pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetches and decodes an 8-bit RGBA (or RGB/grayscale) PNG, filter bytes
 *  resolved, into one straight (non-premultiplied) byte buffer. `null` if the
 *  fetch fails. */
export async function fetchPng(url: string): Promise<{ width: number; height: number; channels: number; data: Uint8Array } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let pos = 8; // past the PNG signature
  let width = 0;
  let height = 0;
  let channels = 4;
  const idatParts: Uint8Array[] = [];
  while (pos < buf.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      const colorType = buf[pos + 8 + 9];
      channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    } else if (type === 'IDAT') {
      idatParts.push(buf.subarray(pos + 8, pos + 8 + len));
    } else if (type === 'IEND') break;
    pos += len + 12; // 4-byte length + 4-byte type + `len` bytes body + 4-byte CRC
  }

  const idat = new Uint8Array(idatParts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of idatParts) {
    idat.set(p, o);
    o += p.length;
  }
  const raw = await inflateZlib(idat);

  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[dst + x - channels] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? data[dst - stride + x - channels] : 0;
      const v = raw[src + x];
      data[dst + x] =
        filter === 0 ? v
        : filter === 1 ? (v + a) & 0xff
        : filter === 2 ? (v + b) & 0xff
        : filter === 3 ? (v + ((a + b) >> 1)) & 0xff
        : (v + paeth(a, b, c)) & 0xff;
    }
  }
  return { width, height, channels, data };
}
