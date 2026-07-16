const fs = require('fs');
const path = require('path');

const credentialPath = path.join(__dirname, '../../samples/sample-credential-signed.json');
const raw = fs.readFileSync(credentialPath, 'utf8');
const signed = JSON.parse(raw);
const payload = signed.payload;

function scanForNull(label, value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 0) {
      console.log(`FOUND NULL at ${label}, position ${i}:`, JSON.stringify(str.slice(Math.max(0,i-10), i+10)));
    }
  }
}

console.log('=== Scanning every field that gets inserted ===');
scanForNull('issuer_id', payload.issuer_id);
scanForNull('doc_id', payload.doc_id);
scanForNull('template_id', payload.template_id);
scanForNull('issued_at', payload.issued_at);
scanForNull('expires_at', payload.expires_at);
scanForNull('fields', payload.fields);
scanForNull('asset_hashes', payload.asset_hashes);
scanForNull('template_hash', payload.template_hash);
console.log('=== Scan complete — if nothing printed above, no field contains a null byte ===');

console.log('');
console.log('typeof expires_at:', typeof payload.expires_at, '| value:', payload.expires_at);
console.log('template_version:', payload.template_version, typeof payload.template_version);