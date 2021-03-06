const assert = require('assert');
const path = require('path');
const { promises: fs } = require('fs');
const NodeRSA = require('node-rsa');
const { BigInteger } = require('jsbn');

const KEYS_DIR = '../keys';

const BN_1 = new BigInteger('1');
const BN_0 = new BigInteger('0');
const BNtoBuffer = (BN) => Buffer.from(BN.toString(16), 'hex');

const genPrivKey = ({ publicKey: pubKey, gcd }) => {
  const { n, e } = pubKey.keyPair;
  assert(n.mod(gcd).equals(BN_0));

  const p = gcd.clone();
  const q = n.divide(gcd);
  const p1 = p.subtract(BN_1);
  const q1 = q.subtract(BN_1);
  const phiN = p1.multiply(q1);
  const d = new BigInteger(e.toString()).modInverse(phiN);
  const dmp1 = d.mod(p1);
  const dmq1 = d.mod(q1);
  const coeff = q.modInverse(p);

  const privKey = new NodeRSA().importKey(
    {
      n: BNtoBuffer(n),
      e,
      d: BNtoBuffer(d),
      p: BNtoBuffer(p),
      q: BNtoBuffer(q),
      dmp1: BNtoBuffer(dmp1),
      dmq1: BNtoBuffer(dmq1),
      coeff: BNtoBuffer(coeff),
    },
    'components',
  );
  return privKey.exportKey('pkcs1-private-pem');
};

const commonFactorAttack = (pubKeyFiles) => {
  const privKeyFiles = [];
  const pubKeys = pubKeyFiles.map((keyFile) => new NodeRSA(keyFile.content));

  for (let i = 0; i < pubKeys.length - 1; i += 1) {
    for (let j = i + 1; j < pubKeys.length; j += 1) {
      const GCD = pubKeys[i].keyPair.n.gcd(pubKeys[j].keyPair.n);
      if (!GCD.equals(BN_1)) {
        privKeyFiles.push({
          name: `${pubKeyFiles[i].name}`,
          content: genPrivKey({ publicKey: pubKeys[i], gcd: GCD }),
        });
        privKeyFiles.push({
          name: `${pubKeyFiles[j].name}`,
          content: genPrivKey({ publicKey: pubKeys[j], gcd: GCD }),
        });
      }
    }
  }
  return privKeyFiles;
};

const attack = async (keysDir) => {
  const pubKeyFiles = await Promise.all(
    (await fs.readdir(path.join(__dirname, keysDir), { withFileTypes: true }))
      .filter((dirent) => !dirent.isDirectory() && dirent.name.endsWith('.pub'))
      .map((dirent) => dirent.name)
      .map(async (fileName) => ({
        name: fileName,
        content: await fs.readFile(
          path.join(__dirname, `${keysDir}/${fileName}`),
        ),
      })),
  );

  const privKeyFiles = commonFactorAttack(pubKeyFiles);

  await Promise.all(
    privKeyFiles.map(async (privKeyFile) =>
      fs.writeFile(
        path.join(
          __dirname,
          `${KEYS_DIR}/${privKeyFile.name.replace(/.pub$/, '.pem')}`,
        ),
        privKeyFile.content,
      ),
    ),
  );
  return privKeyFiles.map((key) => key.name);
};

if (!module.parent) {
  const main = async () => {
    const keyNames = await attack(KEYS_DIR);
    console.log(`Found Private Keys For: ${JSON.stringify(keyNames)}`);
  };

  try {
    main();
  } catch (error) {
    console.error(error);
  }
}

module.exports = attack;
