/** Local production previews have no TLS listener; deployed hosts stay hardened. */
export function isLoopbackHttp(url?: Pick<URL, 'protocol' | 'hostname'>): boolean {
  return url?.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
}
