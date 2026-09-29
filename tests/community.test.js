import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window??={};
const {normalizeServer}=await import('../app/community.js');

test('public HTTPS server addresses work without a local-network dependency',()=>{
  assert.equal(normalizeServer(' https://campus.example.org/ '),'https://campus.example.org');
  assert.equal(normalizeServer('https://campus.onrender.com'),'https://campus.onrender.com');
  assert.equal(normalizeServer('https://campus.example.org:8443'),'https://campus.example.org:8443');
  assert.equal(normalizeServer('http://127.0.0.1:8787'),'http://127.0.0.1:8787');
  for(const value of ['http://public.example.org','https://campus.example.org/v1','https://u:pass@campus.example.org','https://campus.example.org?token=secret','javascript:alert(1)','campus.example.org'])assert.throws(()=>normalizeServer(value));
});
