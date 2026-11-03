import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* pdf.js loads its WASM decoders (JBIG2/JPEG 2000/ICC), CMaps and fallback
   fonts from URLs at runtime, so those files have to be served as static
   assets. They ship inside pdfjs-dist, which Vite can't rewrite for the worker,
   hence this copy into public/. Runs before dev and build so an upgrade of
   pdfjs-dist never leaves stale decoders behind. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'node_modules', 'pdfjs-dist')
const target = path.join(root, 'public', 'pdfjs')
const folders = ['cmaps', 'iccs', 'standard_fonts', 'wasm']

await rm(target, { recursive: true, force: true })
for (const folder of folders) {
  await mkdir(path.join(target, folder), { recursive: true })
  await cp(path.join(source, folder), path.join(target, folder), { recursive: true })
}

console.log(`Synced pdf.js runtime assets to ${path.relative(root, target)}`)
