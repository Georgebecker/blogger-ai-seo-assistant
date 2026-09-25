// teste_criptografia.ts — teste rápido de ida e volta da criptografia da chave.
// Roda direto no Node (moderno, com type stripping): npm run test:crypto

import { encryptKey, decryptKey } from '../src/lib/crypto-utils.ts';

const CHAVE = 'AIzaChaveDeTeste123456789';
const SENHA = 'senha-muito-forte';

const pacote = await encryptKey(CHAVE, SENHA);
if (!pacote.sal || !pacote.iv || !pacote.cifrado) throw new Error('pacote incompleto');

const plano = await decryptKey(pacote, SENHA);
if (plano !== CHAVE) throw new Error('a descriptografia devolveu um valor diferente');

let falhou = false;
try {
  await decryptKey(pacote, 'senha-errada');
} catch {
  falhou = true;
}
if (!falhou) throw new Error('senha errada deveria falhar');

console.log('Ok: criptografia, descriptografia e senha errada verificadas.');
