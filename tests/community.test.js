import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window??={};
const {normalizeServer,initialServer,DEFAULT_SERVER_URL}=await import('../app/community.js');

test('fresh installs and empty or invalid settings use the shared server; explicit overrides survive',()=>{
  assert.equal(DEFAULT_SERVER_URL,'https://139.100.239.210.sslip.io');
  for(const saved of [undefined,null,'','  ',{},'broken','http://public.example.org'])assert.equal(initialServer(saved),DEFAULT_SERVER_URL);
  assert.equal(initialServer('https://team.example.org/'),'https://team.example.org');
  assert.equal(initialServer('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
});

test('public HTTPS server addresses work without a local-network dependency',()=>{
  assert.equal(normalizeServer(' https://campus.example.org/ '),'https://campus.example.org');
  assert.equal(normalizeServer('https://campus.onrender.com'),'https://campus.onrender.com');
  assert.equal(normalizeServer('https://campus.example.org:8443'),'https://campus.example.org:8443');
  assert.equal(normalizeServer('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  for(const value of ['http://public.example.org','https://campus.example.org/v1','https://u:pass@campus.example.org','https://campus.example.org?token=secret','javascript:alert(1)','campus.example.org'])assert.throws(()=>normalizeServer(value));
});
