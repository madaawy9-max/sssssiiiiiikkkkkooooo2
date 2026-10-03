'use strict';

// Unified backend used by both the website and Discord bot. Hercules is the
// local, no-API default; Luraph remains an explicit optional provider.
const path = require('path');

function getProvider() {
  const name = String(process.env.OBFUSCATOR_PROVIDER || 'hercules').trim().toLowerCase();
  if (name === 'hercules') return require('./hercules-engine');
  if (name === 'luraph') return require('./luraph-engine');
  throw new Error(`OBFUSCATOR_PROVIDER غير معروف: ${name}. الخيارات: hercules أو luraph.`);
}

module.exports = {
  processAndProtectFiles(...args) {
    return getProvider().processAndProtectFiles(...args);
  },
  obfuscateLua(...args) {
    const provider = getProvider();
    if (typeof provider.obfuscateLua !== 'function') {
      throw new Error('المحرك المختار لا يوفّر معالجة ملف Lua منفرد.');
    }
    return provider.obfuscateLua(...args);
  },
  providerName() {
    return String(process.env.OBFUSCATOR_PROVIDER || 'hercules').trim().toLowerCase();
  }
};
