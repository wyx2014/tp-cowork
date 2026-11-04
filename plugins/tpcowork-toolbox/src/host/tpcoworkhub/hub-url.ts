/** Whether `url` may serve as the TP Cowork Hub address (login page and API).
 * HTTPS is always accepted. Plain HTTP is accepted only on this machine or a private intranet address
 * (10/8, 172.16/12, 192.168/16), so a login is never sent unencrypted over the public internet. */
export function allowedHubUrl(url: URL): boolean {
  if (url.username || url.password) return false
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  if (['127.0.0.1', '[::1]'].includes(host)) return true
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/u.exec(host)
  if (!octets) return false
  const [a, b] = [Number(octets[1]), Number(octets[2])]
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
