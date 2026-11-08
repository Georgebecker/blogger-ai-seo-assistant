// crypto-utils.ts — criptografia da chave de API (AES-GCM + PBKDF2).
// Usado somente no service worker e nas páginas da extensão.
// O content script nunca recebe a chave em nenhum momento.

const PBKDF2_ITERACOES = 210000;
const TAMANHO_SAL = 16;
const TAMANHO_IV = 12;

export interface PacoteChave {
  v: number;
  iteracoes: number;
  sal: string;
  iv: string;
  cifrado: string;
}

export interface ChaveCifradaComDerivacao {
  pacote: PacoteChave;
  chave: CryptoKey;
}

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

function paraBase64(bytes: Uint8Array): string {
  let binario = '';
  for (let i = 0; i < bytes.length; i += 1) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

function deBase64(texto: string): Uint8Array {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function derivarChave(senhaMestra: string, sal: Uint8Array, iteracoes: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    codificador.encode(senhaMestra),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal as BufferSource, iterations: iteracoes, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Devolve o pacote cifrado e a chave não exportável usada para abri-lo.
export async function encryptKeyWithDerivedKey(
  apiKey: string,
  masterPassword: string,
): Promise<ChaveCifradaComDerivacao> {
  const sal = crypto.getRandomValues(new Uint8Array(TAMANHO_SAL));
  const iv = crypto.getRandomValues(new Uint8Array(TAMANHO_IV));
  const chave = await derivarChave(masterPassword, sal, PBKDF2_ITERACOES);
  const cifrado = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    chave,
    codificador.encode(apiKey),
  );
  return {
    pacote: {
      v: 1,
      iteracoes: PBKDF2_ITERACOES,
      sal: paraBase64(sal),
      iv: paraBase64(iv),
      cifrado: paraBase64(new Uint8Array(cifrado)),
    },
    chave,
  };
}

// Mantém a API usada pelos testes e pelos pacotes antigos.
export async function encryptKey(apiKey: string, masterPassword: string): Promise<PacoteChave> {
  return (await encryptKeyWithDerivedKey(apiKey, masterPassword)).pacote;
}

export async function deriveKeyForPackage(pacote: PacoteChave, masterPassword: string): Promise<CryptoKey> {
  if (!pacote || !pacote.sal || !pacote.iv || !pacote.cifrado) {
    throw new Error('Pacote de chave inválido.');
  }
  const sal = deBase64(pacote.sal);
  return derivarChave(masterPassword, sal, Number(pacote.iteracoes) || PBKDF2_ITERACOES);
}

export async function decryptKeyWithDerivedKey(pacote: PacoteChave, chave: CryptoKey): Promise<string> {
  if (!pacote || !pacote.sal || !pacote.iv || !pacote.cifrado) {
    throw new Error('Pacote de chave inválido.');
  }
  const iv = deBase64(pacote.iv);
  const plano = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    chave,
    deBase64(pacote.cifrado) as BufferSource,
  );
  return decodificador.decode(plano);
}

// Lança erro quando a senha mestra está errada (o AES-GCM autentica o conteúdo).
export async function decryptKey(pacote: PacoteChave, masterPassword: string): Promise<string> {
  const chave = await deriveKeyForPackage(pacote, masterPassword);
  return decryptKeyWithDerivedKey(pacote, chave);
}
