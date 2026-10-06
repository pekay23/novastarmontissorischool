/**
 * Static file server for a Next.js `output: 'export'` directory.
 *
 *   node tools/serve-export.mjs --root apps/public-site/out --port 3200
 *
 * Exists because `apps/public-site` ships as static files, so "does the site
 * work" has to be answered against those files rather than against `next dev`:
 * dev compiles routes on demand and rewrites links, so it will happily pass a
 * spec that the deployed artifact fails. There is also no `next start` for an
 * export — there is no server to start.
 *
 * Three behaviours that a naive `http.createServer` gets wrong for this output,
 * each of which is a difference between the artifact and a dev server:
 *
 *   1. Directory index. With `trailingSlash: true` the exporter writes
 *      `/academics/index.html`, and the site links to `/academics/`. Resolving
 *      `/academics/` -> `<root>/academics/index.html` is required.
 *   2. Real status codes. `/no-such-page/` must answer 404 with `404.html` and a
 *      404 status, not 200. A server that returns 404.html with a 200 turns the
 *      404 page into a soft-404 and hides broken internal links.
 *   3. Extensionless and dot-file handling. `/favicon.svg` must be served as an
 *      image, and a request for a dotfile must not escape the root.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const root = resolve(flag('root', 'out'))
const port = Number(flag('port', process.env.PORT ?? 3200))
const host = flag('host', '127.0.0.1')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/** Resolve a URL path to a file inside the root, or null if it escapes or is missing. */
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0])

  // `normalize` collapses `..` before the prefix check, so `/../../etc/passwd`
  // becomes `/etc/passwd` and is then rejected for starting outside the root.
  const candidate = normalize(join(root, decoded))
  if (candidate !== root && !candidate.startsWith(root + sep)) return null

  const attempts = []
  if (decoded.endsWith('/')) {
    attempts.push(join(candidate, 'index.html'))
  } else {
    attempts.push(candidate)
    attempts.push(join(candidate, 'index.html'))
    attempts.push(`${candidate}.html`)
  }

  for (const attempt of attempts) {
    if (existsSync(attempt) && statSync(attempt).isFile()) return attempt
  }
  return null
}

function send(res, status, file) {
  res.writeHead(status, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    // The harness re-runs against the same directory within a minute; a cached
    // stylesheet from a previous build would silently invalidate every
    // measurement in the run.
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(res)
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end()
    return
  }

  const file = resolveFile(req.url ?? '/')
  if (file) {
    send(res, 200, file)
    return
  }

  // Real 404, not a soft one. See the header note.
  const notFound = join(root, '404.html')
  if (existsSync(notFound)) {
    send(res, 404, notFound)
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404')
})

if (!existsSync(root)) {
  console.error(`serve-export: no such directory: ${root}`)
  console.error('Run the build first — `output: "export"` writes it.')
  process.exit(1)
}

server.listen(port, host, () => {
  console.log(`serving ${root} at http://${host}:${port}`)
})
