function decodeBase64(data: string): Uint8Array {
  const raw = data.replace(/^data:image\/\w+;base64,/, "");
  const binary = globalThis.atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readJpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 0;
  while (i < bytes.length - 9) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xd8) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      if (width > 0 && height > 0) return { width, height };
    }
    i += 2 + (length || 0);
  }
  return null;
}

/** Very blurry / empty frames compress far smaller at the same JPEG quality. */
export function isLikelyBlurry(base64: string): boolean {
  if (!base64) return true;
  try {
    const bytes = decodeBase64(base64);
    const size = readJpegSize(bytes);
    if (!size) return false;
    if (size.width < 240 || size.height < 240) return true;
    const bitsPerPixel = (bytes.length * 8) / (size.width * size.height);
    return bitsPerPixel < 0.14;
  } catch {
    return false;
  }
}
