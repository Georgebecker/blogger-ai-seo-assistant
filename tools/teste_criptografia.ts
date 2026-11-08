// teste_criptografia.ts — teste rápido de ida e volta da criptografia da chave.
// Roda direto no Node (moderno, com type stripping): npm run test:crypto

import {
  decryptKey,
  decryptKeyWithDerivedKey,
  deriveKeyForPackage,
  encryptKey,
  encryptKeyWithDerivedKey,
} from '../src/lib/crypto-utils.ts';

const CHAVE = 'AIzaChaveDeTeste123456789';
const SENHA = 'senha-muito-forte';

const pacote = await encryptKey(CHAVE, SENHA);
if (!pacote.sal || !pacote.iv || !pacote.cifrado) throw new Error('pacote incompleto');

const plano = await decryptKey(pacote, SENHA);
if (plano !== CHAVE) throw new Error('a descriptografia devolveu um valor diferente');

const derivada = await encryptKeyWithDerivedKey(CHAVE, SENHA);
if (derivada.chave.extractable) throw new Error('a chave derivada deveria ser não exportável');
const planoAutomatico = await decryptKeyWithDerivedKey(derivada.pacote, derivada.chave);
if (planoAutomatico !== CHAVE) throw new Error('a chave local derivada não abriu o pacote');

const chaveRecalculada = await deriveKeyForPackage(pacote, SENHA);
const planoRecalculado = await decryptKeyWithDerivedKey(pacote, chaveRecalculada);
if (planoRecalculado !== CHAVE) throw new Error('a chave recalculada não abriu o pacote');

let falhou = false;
try {
  await decryptKey(pacote, 'senha-errada');
} catch {
  falhou = true;
}
if (!falhou) throw new Error('senha errada deveria falhar');

console.log('Ok: criptografia, desbloqueio automático, chave não exportável e senha errada verificadas.');
