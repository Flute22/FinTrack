const crypto = require('crypto');

const target = 'a53ae1fb66022137b062be54258c2201bea9faf27e3ce5ce33de5703febda409';
const candidate = 'flute';

const algos = ['md5', 'sha1', 'sha256', 'sha512'];
for (const algo of algos) {
  const hash = crypto.createHash(algo).update(candidate).digest('hex');
  console.log(`${algo}(${candidate}):`, hash, hash === target ? 'MATCH!!!' : '');
  
  // also check with uppercase/lowercase
  const hashUpper = crypto.createHash(algo).update(candidate.toUpperCase()).digest('hex');
  if (hashUpper === target) console.log(`${algo}(${candidate.toUpperCase()}): MATCH!!!`);
}

// Check if it's bcrypt or pbkdf2 or simple double hash
const doubleSha256 = crypto.createHash('sha256').update(crypto.createHash('sha256').update(candidate).digest('hex')).digest('hex');
console.log('doubleSha256:', doubleSha256, doubleSha256 === target ? 'MATCH!!!' : '');
