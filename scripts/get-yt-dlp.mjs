import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ASSET = { darwin: 'yt-dlp_macos', win32: 'yt-dlp.exe', linux: 'yt-dlp_linux' }[process.platform];
if (!ASSET) throw new Error(`Unsupported platform: ${process.platform}`);

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${ASSET}`;
const dest = path.resolve('bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

console.log(`Downloading ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
await mkdir(path.dirname(dest), { recursive: true });
await writeFile(dest, Buffer.from(await res.arrayBuffer()));
await chmod(dest, 0o755);
console.log(`Saved to ${dest}`);
