import type { Provedor } from './messages';

const NOME_BANCO = 'bai-auto-unlock';
const VERSAO_BANCO = 1;
const ARMAZEM_CHAVES = 'chaves';

interface RegistroChave {
  provedor: Provedor;
  sal: string;
  chave: CryptoKey;
}

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
    pedido.onupgradeneeded = () => {
      const banco = pedido.result;
      if (!banco.objectStoreNames.contains(ARMAZEM_CHAVES)) {
        banco.createObjectStore(ARMAZEM_CHAVES, { keyPath: 'provedor' });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(new Error('Não foi possível abrir o armazenamento de desbloqueio automático.'));
    pedido.onblocked = () => reject(new Error('O armazenamento de desbloqueio automático está bloqueado por outra operação.'));
  });
}

export async function lerChaveAutomatica(provedor: Provedor, sal: string): Promise<CryptoKey | null> {
  const banco = await abrirBanco();
  return new Promise((resolve, reject) => {
    const transacao = banco.transaction(ARMAZEM_CHAVES, 'readonly');
    const pedido = transacao.objectStore(ARMAZEM_CHAVES).get(provedor);
    let chave: CryptoKey | null = null;
    pedido.onsuccess = () => {
      const registro = pedido.result as RegistroChave | undefined;
      if (!registro) return;
      if (registro.sal !== sal) return;
      const valor = registro.chave;
      if (
        !(valor instanceof CryptoKey) ||
        valor.extractable ||
        valor.type !== 'secret' ||
        valor.algorithm.name !== 'AES-GCM' ||
        !valor.usages.includes('decrypt')
      ) {
        reject(new Error('A chave local de desbloqueio automático está inválida. Desbloqueie novamente no popup.'));
        return;
      }
      chave = valor;
    };
    pedido.onerror = () => reject(new Error('Não foi possível ler a chave local de desbloqueio automático.'));
    transacao.oncomplete = () => {
      banco.close();
      resolve(chave);
    };
    transacao.onerror = () => {
      banco.close();
      reject(new Error('Falha ao ler a chave local de desbloqueio automático.'));
    };
    transacao.onabort = () => {
      banco.close();
      reject(new Error('A leitura da chave local de desbloqueio automático foi cancelada.'));
    };
  });
}

export async function guardarChaveAutomatica(provedor: Provedor, sal: string, chave: CryptoKey): Promise<void> {
  const banco = await abrirBanco();
  await new Promise<void>((resolve, reject) => {
    const transacao = banco.transaction(ARMAZEM_CHAVES, 'readwrite');
    transacao.objectStore(ARMAZEM_CHAVES).put({ provedor, sal, chave } satisfies RegistroChave);
    transacao.oncomplete = () => {
      banco.close();
      resolve();
    };
    transacao.onerror = () => {
      banco.close();
      reject(new Error('Não foi possível salvar o desbloqueio automático neste navegador.'));
    };
    transacao.onabort = () => {
      banco.close();
      reject(new Error('O salvamento do desbloqueio automático foi cancelado.'));
    };
  });
}

export async function apagarChavesAutomaticas(): Promise<void> {
  const banco = await abrirBanco();
  await new Promise<void>((resolve, reject) => {
    const transacao = banco.transaction(ARMAZEM_CHAVES, 'readwrite');
    transacao.objectStore(ARMAZEM_CHAVES).clear();
    transacao.oncomplete = () => {
      banco.close();
      resolve();
    };
    transacao.onerror = () => {
      banco.close();
      reject(new Error('Não foi possível apagar as chaves locais de desbloqueio automático.'));
    };
    transacao.onabort = () => {
      banco.close();
      reject(new Error('A remoção do desbloqueio automático foi cancelada.'));
    };
  });
}

export async function apagarChaveAutomatica(provedor: Provedor): Promise<void> {
  const banco = await abrirBanco();
  await new Promise<void>((resolve, reject) => {
    const transacao = banco.transaction(ARMAZEM_CHAVES, 'readwrite');
    transacao.objectStore(ARMAZEM_CHAVES).delete(provedor);
    transacao.oncomplete = () => {
      banco.close();
      resolve();
    };
    transacao.onerror = () => {
      banco.close();
      reject(new Error('Não foi possível apagar a chave local de desbloqueio automático.'));
    };
    transacao.onabort = () => {
      banco.close();
      reject(new Error('A remoção da chave local de desbloqueio automático foi cancelada.'));
    };
  });
}
