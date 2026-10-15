import dns from 'node:dns/promises';
import net from 'node:net';

// Conservative IPv4/IPv6 public-address checks. All resolved addresses must be public.
function isPublicIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = p;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0));
}
function isPublicIP(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPublicIPv4(ip);
  if (family !== 6) return false;
  const s = ip.toLowerCase();
  if (s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('ff')) return false;
  if (s.startsWith('::ffff:')) return isPublicIPv4(s.slice(7));
  // Only globally-routable 2000::/3 addresses; exclude documentation range.
  if (!/^2[0-9a-f]{3}:/.test(s)) return false;
  if (s.startsWith('2001:db8:')) return false;
  return true;
}

export async function validatePublicHttpUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a valid website URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed.');
  if (!url.hostname || url.hostname.endsWith('.local') || url.hostname === 'localhost') throw new Error('Private or local hosts are not allowed.');
  if (url.port && !['80','443'].includes(url.port)) throw new Error('Only standard HTTP/HTTPS ports (80 and 443) are allowed.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = net.isIP(hostname);
  if (family) {
    if (!isPublicIP(hostname)) throw new Error('Private or non-public IP addresses are not allowed.');
  } else {
    let records;
    try { records = await dns.lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new Error('The website hostname could not be resolved.'); }
    if (!records.length || records.some(r => !isPublicIP(r.address))) throw new Error('The hostname resolves to a private or non-public address.');
  }
  url.hash = '';
  return url;
}
export { isPublicIP };
