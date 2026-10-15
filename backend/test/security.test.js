import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicIP } from '../src/security.js';

test('rejects private, loopback, link-local, and reserved IPv4 addresses', () => {
  for (const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.2','169.254.169.254','0.0.0.0','224.0.0.1','198.51.100.4']) assert.equal(isPublicIP(ip), false, ip);
});
test('accepts ordinary public IP addresses', () => {
  for (const ip of ['1.1.1.1','8.8.8.8','93.184.216.34','2606:4700:4700::1111']) assert.equal(isPublicIP(ip), true, ip);
});
test('rejects local and non-global IPv6 ranges', () => {
  for (const ip of ['::1','::','fc00::1','fd00::1','fe80::1','ff02::1','2001:db8::1']) assert.equal(isPublicIP(ip), false, ip);
});
