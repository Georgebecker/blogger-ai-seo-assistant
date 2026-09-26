// popup.ts — configuração da chave (BYOK), modelo e permissões.
// A chave nunca é registrada em log; a criptografia acontece no service worker.

import type { MensagemParaFundo, Provedor, RespostaFundo, StatusChave, UsoIA } from '../lib/messages';

function porId<T extends HTMLElement>(id: string): T {
  const elemento = document.getElementById(id);
  if (!elemento) throw new Error('Elemento ausente no popup: ' + id);
  return elemento as T;
}

const refs = {
  provider: porId<HTMLSelectElement>('provider'),
  providerNome: porId<HTMLElement>('providerNome'),
  chaves: porId<HTMLElement>('chaves'),
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
  getKey: porId<HTMLAnchorElement>('getKey'),
  reserva: porId<HTMLInputElement>('reserva'),
  resumoModelos: porId<HTMLElement>('resumoModelos'),
  ultimoUso: porId<HTMLElement>('ultimoUso'),
};

const NOMES_PROVEDOR: Record<Provedor, string> = { google: 'Google', deepseek: 'DeepSeek' };

const LINKS_CHAVE: Record<Provedor, { url: string; texto: string }> = {
  google: { url: 'https://aistudio.google.com/app/apikey', texto: 'Criar uma chave no Google AI Studio' },
  deepseek: { url: 'https://platform.deepseek.com/api_keys', texto: 'Criar uma chave no DeepSeek' },
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

function atualizarLinkChave(provedor: Provedor): void {
  const link = LINKS_CHAVE[provedor];
  refs.getKey.href = link.url;
  refs.getKey.textContent = link.texto;
}

async function atualizarStatus(): Promise<void> {
  try {
    const dados = await enviar<StatusChave>({ type: 'GET_STATUS' });
    refs.provider.value = dados.provedor;
    refs.providerNome.textContent = NOMES_PROVEDOR[dados.provedor];
    const salva = dados.provedor === 'deepseek' ? dados.temDeepSeek : dados.temGoogle;
    refs.status.textContent = dados.desbloqueada
      ? 'chave ativa'
      : (salva ? 'chave bloqueada' : 'sem chave salva');
    refs.chaves.textContent =
      'Google: ' + (dados.temGoogle ? 'chave salva' : 'sem chave') +
      ' | DeepSeek: ' + (dados.temDeepSeek ? 'chave salva' : 'sem chave');
    if (dados.modelo) refs.modelo.value = dados.modelo;
    refs.reserva.checked = dados.reserva;
    refs.resumoModelos.textContent =
      'Principal: ' +
      NOMES_PROVEDOR[dados.provedor] +
      ' (' +
      dados.modelo +
      ') - reserva: ' +
      (dados.reserva
        ? NOMES_PROVEDOR[dados.provedorReserva] + ' (' + dados.modeloReserva + ')'
        : 'desligada');
    try {
      const uso = await enviar<UsoIA | null>({ type: 'GET_USO' });
      refs.ultimoUso.textContent = uso
        ? 'Último uso: ' +
          NOMES_PROVEDOR[uso.provedor] +
          ' (' +
          uso.modelo +
          ')' +
          (uso.reserva ? ' - veio da reserva' : '')
        : 'Nenhum uso registrado nesta sessão ainda.';
    } catch {
      refs.ultimoUso.textContent = '';
    }
    atualizarLinkChave(dados.provedor);
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
      provedor: refs.provider.value as Provedor,
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
    await enviar<StatusChave>({
      type: 'UNLOCK',
      provedor: refs.provider.value as Provedor,
      masterPassword: refs.senha.value,
    });
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
    const dados = await enviar<{ resposta: string; provedor: string; modelo: string }>({ type: 'TEST_KEY' });
    mostrar('Conexão OK (' + dados.provedor + ', ' + dados.modelo + '). A IA respondeu: ' + dados.resposta, 'ok');
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

refs.reserva.addEventListener('change', async () => {
  try {
    await enviar<StatusChave>({ type: 'SET_SETTINGS', reserva: refs.reserva.checked });
    mostrar(refs.reserva.checked ? 'Reserva ligada.' : 'Reserva desligada.', 'ok');
    await atualizarStatus();
  } catch (erro) {
    mostrar((erro as Error).message, 'erro');
  }
});

refs.provider.addEventListener('change', async () => {
  try {
    const provedor = refs.provider.value as Provedor;
    await enviar<StatusChave>({ type: 'SET_SETTINGS', provedor });
    mostrar('Provedor alterado para ' + NOMES_PROVEDOR[provedor] + '.', 'ok');
    await atualizarStatus();
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
