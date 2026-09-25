// popup.ts — configuração da chave (BYOK), modelo e permissões.
// A chave nunca é registrada em log; a criptografia acontece no service worker.

import type { MensagemParaFundo, RespostaFundo, StatusChave } from '../lib/messages';

function porId<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error('Elemento ausente no popup: ' + id);
  return elemento as T;
}

const refs = {
  status: porId<HTMLElement>('status'),
  msg: porId<HTMLElement>('msg'),
  apiKey: porId<HTMLInputElement>('apiKey'),
  senha: porId<HTMLInputElement>('masterPassword'),
  salvar: porId<HTMLButtonElement>('saveKey'),
  desbloquear: porId<HTMLButtonElement>('unlock'),
  bloquear: porId<HTMLButtonElement>('lock'),
  testar: porId<HTMLButtonElement>('testKey'),
  modelo: porId<HTMLInputElement>('model'),
  permitirLinks: porId<HTMLButtonElement>('grantLinks'),
  alternarChave: porId<HTMLButtonElement>('toggleKey'),
};

function enviar<T>(mensagem: MensagemParaFundo): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(mensagem, (resposta: RespostaFundo<T> | undefined) => {
      const erro = chrome.runtime.lastError;
      if (erro) {
        reject(new Error(erro.message));
        return;
      }
      if (!resposta || resposta.ok !== true) {
        const texto = resposta && resposta.ok === false && resposta.error
          ? resposta.error
          : 'O serviço da extensão não respondeu.';
        reject(new Error(texto));
        return;
      }
      resolve(resposta.data);
    });
  });
}

function mostrar(mensagem: string, tipo = ''): void {
  refs.msg.textContent = mensagem;
  refs.msg.className = 'msg' + (tipo ? ' ' + tipo : '');
}

function comBotao(botao: HTMLButtonElement, ocupado: boolean, rotulo?: string): void {
  if (ocupado) {
    botao.disabled = true;
    botao.dataset.anterior = botao.textContent || '';
    if (rotulo) botao.textContent = rotulo;
  } else {
    botao.disabled = false;
    if (botao.dataset.anterior) {
      botao.textContent = botao.dataset.anterior;
      delete botao.dataset.anterior;
    }
  }
}

async function atualizarStatus(): Promise<void> {
  try {
    const dados = await enviar<StatusChave>({ type: 'GET_STATUS' });
    refs.status.textContent = dados.desbloqueada
      ? 'chave ativa'
      : (dados.temChave ? 'chave bloqueada' : 'sem chave salva');
    if (dados.modelo) refs.modelo.value = dados.modelo;
  } catch (erro) {
    refs.status.textContent = 'indisponível';
    mostrar((erro as Error).message, 'erro');
  }
}

refs.salvar.addEventListener('click', async () => {
  if (!refs.apiKey.value.trim()) {
    mostrar('Informe a chave da API.', 'aviso');
    return;
  }
  if (refs.senha.value.length < 8) {
    mostrar('A senha mestra precisa ter pelo menos 8 caracteres.', 'aviso');
    return;
  }
  comBotao(refs.salvar, true, 'Salvando...');
  try {
    await enviar<StatusChave>({
      type: 'SAVE_KEY',
      apiKey: refs.apiKey.value,
      masterPassword: refs.senha.value,
    });
    refs.apiKey.value = '';
    refs.senha.value = '';
    mostrar('Chave salva e desbloqueada.', 'ok');
    await atualizarStatus();
  } catch (erro) {
    mostrar((erro as Error).message, 'erro');
  } finally {
    comBotao(refs.salvar, false);
  }
});

refs.desbloquear.addEventListener('click', async () => {
  if (!refs.senha.value) {
    mostrar('Informe a senha mestra.', 'aviso');
    return;
  }
  comBotao(refs.desbloquear, true, 'Abrindo...');
  try {
    await enviar<StatusChave>({ type: 'UNLOCK', masterPassword: refs.senha.value });
    refs.senha.value = '';
    mostrar('Chave desbloqueada.', 'ok');
    await atualizarStatus();
  } catch (erro) {
    mostrar((erro as Error).message, 'erro');
  } finally {
    comBotao(refs.desbloquear, false);
  }
});

refs.bloquear.addEventListener('click', async () => {
  try {
    await enviar<StatusChave>({ type: 'LOCK' });
    refs.senha.value = '';
    mostrar('Chave bloqueada.', 'ok');
    await atualizarStatus();
  } catch (erro) {
    mostrar((erro as Error).message, 'erro');
  }
});

refs.testar.addEventListener('click', async () => {
  comBotao(refs.testar, true, 'Testando...');
  try {
    const dados = await enviar<{ resposta: string }>({ type: 'TEST_KEY' });
    mostrar('Conexão OK. A IA respondeu: ' + dados.resposta, 'ok');
  } catch (erro) {
    mostrar((erro as Error).message, 'erro');
  } finally {
    comBotao(refs.testar, false);
  }
});

refs.modelo.addEventListener('change', async () => {
  try {
    await enviar<StatusChave>({ type: 'SET_SETTINGS', modelo: refs.modelo.value.trim() });
    mostrar('Modelo salvo.', 'ok');
  } catch (erro) {
    mostrar((erro as Error).message, 'erro');
  }
});

refs.alternarChave.addEventListener('click', () => {
  const mostrando = refs.apiKey.type === 'text';
  refs.apiKey.type = mostrando ? 'password' : 'text';
  refs.alternarChave.textContent = mostrando ? 'Mostrar' : 'Ocultar';
});

function atualizarBotaoLinks(): void {
  chrome.permissions.contains({ origins: ['*://*/*'] }, (tem) => {
    refs.permitirLinks.disabled = Boolean(tem);
    refs.permitirLinks.textContent = tem
      ? 'Permissão concedida'
      : 'Permitir acesso aos sites dos links';
  });
}

refs.permitirLinks.addEventListener('click', () => {
  chrome.permissions.request({ origins: ['*://*/*'] }, (concedida) => {
    mostrar(concedida ? 'Permissão concedida.' : 'Permissão não concedida.', concedida ? 'ok' : 'aviso');
    atualizarBotaoLinks();
  });
});

void atualizarStatus();
atualizarBotaoLinks();
