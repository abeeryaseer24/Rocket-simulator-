import type { Vehicle } from '../sim/vehicle';

/**
 * Share a vehicle design in the URL fragment: JSON → deflate → base64url.
 * The fragment never reaches a server, so designs aren't logged anywhere.
 */
const toB64Url = (bytes: Uint8Array) => {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64Url = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeVehicle(v: Vehicle): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(v));
  if (typeof CompressionStream === 'undefined') return 'j' + toB64Url(raw);
  return 'z' + toB64Url(await pipe(raw, new CompressionStream('deflate-raw')));
}

export async function decodeVehicle(code: string): Promise<Vehicle> {
  const kind = code[0];
  const bytes = fromB64Url(code.slice(1));
  const json = kind === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  const v = JSON.parse(new TextDecoder().decode(json)) as Vehicle;
  if (!v || !Array.isArray(v.stages) || !v.stages.length || !v.guidance || !v.site) throw new Error('Not a vehicle design');
  return v;
}

export async function shareLink(v: Vehicle): Promise<string> {
  return `${window.location.origin}/#v=${await encodeVehicle(v)}`;
}
