// service-worker.ts — centro do assistente (Manifest V3).
// Guarda as chaves (criptografadas), fala com as APIs de IA (Google Gemini ou DeepSeek)
// e atende content script + popup.
// Decisões do DevLog aplicadas aqui:
// - o service worker "dorme"; todo estado crítico vai para chrome.storage.local na hora;
// - as chamadas externas ficam centralizadas aqui por causa do CORS;
// - o listener devolve `true` para manter o canal aberto até a resposta assíncrona;
// - a chave nunca é registrada em log nem enviada ao content script.

import { encryptKey, decryptKey, type PacoteChave } from '../lib/crypto-utils';
import type {
  CriacaoPost,
  LinkInterno,
  MensagemParaFundo,
  PerfilEstilo,
  PostDoBlog,
  PromptImagem,
  Provedor,
  ResultadoImagem,
  ResultadoLink,
  ResultadoLinks,
  StatusChave,
  SugestaoAlt,
  SugestaoTexto,
} from '../lib/messages';

const ARMAZEM_AJUSTES = 'bai.settings';
const SESSAO_CHAVE = 'bai.sessionKey';

const ENDPOINT_GOOGLE = 'https://generativelanguage.googleapis.com/v1beta/models';
const ENDPOINT_DEEPSEEK = 'https://api.deepseek.com/chat/completions';
const MODELO_PADRAO_GOOGLE = 'gemini-3.8-flash';
const MODELO_PADRAO_DEEPSEEK = 'deepseek-flash';
const LIMITE_TEXTO = 15000;
const MAX_LINKS = 20;
// API nova de imagens ("Interactions"). Os modelos abaixo são tentados em ordem.
const ENDPOINT_INTERACOES = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MODELOS_IMAGEM = [
  'gemini-3.1-flash-image',
  'gemini-3.1-flash-lite-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
];

const NOMES_PROVEDOR: Record<Provedor, string> = { google: 'Google', deepseek: 'DeepSeek' };

// Modelos aposentados que podem ter ficado salvos de versões anteriores.
const MODELOS_APOSENTADOS: Record<string, string> = {
  'gemini-2.0-flash': MODELO_PADRAO_GOOGLE,
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
};

function armazemChave(provedor: Provedor): string {
  return 'bai.encryptedKey.' + provedor;
}

const ESQUEMA_TEXTO = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Título do post com até 60 caracteres, contendo a palavra-chave.' },
    meta_description: { type: 'STRING', description: 'Meta-descrição com até 155 caracteres.' },
    improved_text: { type: 'STRING', description: 'Texto revisado em parágrafos separados por linha em branco, sem HTML.' },
    headings: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Até 5 sugestões curtas de subtítulos (H2).' },
    notes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Até 5 observações objetivas de SEO.' },
  },
  required: ['title', 'meta_description', 'improved_text', 'headings', 'notes'],
  propertyOrdering: ['title', 'meta_description', 'improved_text', 'headings', 'notes'],
};

const ESQUEMA_ALT = {
  type: 'OBJECT',
  properties: {
    alt: { type: 'STRING', description: 'Descrição da imagem para o atributo alt (no máximo 10 palavras).' },
    caption: { type: 'STRING', description: 'Legenda curta que complementa a imagem.' },
  },
  required: ['alt', 'caption'],
  propertyOrdering: ['alt', 'caption'],
};

const ESQUEMA_POST = {
  type: 'OBJECT',
  properties: {
    titulo: { type: 'STRING', description: 'Título do post com 50 a 60 caracteres e a palavra-chave no início.' },
    meta_descricao: { type: 'STRING', description: 'Meta descrição com 150 a 160 caracteres.' },
    slug: { type: 'STRING', description: 'Endereço curto sugerido, palavras separadas por hífen.' },
    palavra_chave: { type: 'STRING' },
    palavras_secundarias: { type: 'ARRAY', items: { type: 'STRING' } },
    corpo_html: { type: 'STRING', description: 'Corpo do post em HTML simples.' },
    links_internos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { ancora: { type: 'STRING' }, url: { type: 'STRING' } },
        required: ['ancora', 'url'],
      },
    },
    observacoes: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: [
    'titulo',
    'meta_descricao',
    'slug',
    'palavra_chave',
    'palavras_secundarias',
    'corpo_html',
    'links_internos',
    'observacoes',
  ],
};

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((mensagem: unknown, remetente, responder) => {
  if (!remetente || remetente.id !== chrome.runtime.id) return false;
  tratarMensagem(mensagem as MensagemParaFundo)
    .then((data) => responder({ ok: true, data }))
    .catch((erro) => responder({ ok: false, error: textoDoErro(erro) }));
  return true;
});

function textoDoErro(erro: unknown): string {
  if (erro && typeof erro === 'object' && 'message' in erro) {
    return String((erro as { message: unknown }).message);
  }
  return 'Falha inesperada na extensão.';
}

async function tratarMensagem(mensagem: MensagemParaFundo): Promise<unknown> {
  await garantirMigracao();
  switch (mensagem.type) {
    case 'GET_STATUS':
      return statusAtual();
    case 'SAVE_KEY':
      return salvarChave(mensagem);
    case 'UNLOCK':
      return desbloquear(mensagem);
    case 'LOCK':
      await bloquear();
      return statusAtual();
    case 'TEST_KEY':
      return testarChave();
    case 'SET_SETTINGS':
      return salvarAjustes({ provedor: mensagem.provedor, modelo: mensagem.modelo });
    case 'AI_OPTIMIZE_TEXT':
      return otimizarTexto(mensagem);
    case 'AI_IMAGE_ALT':
      return gerarAlt(mensagem);
    case 'AI_APRENDER_ESTILO':
      return aprenderEstilo(mensagem.blogId);
    case 'AI_GERAR_POST':
      return gerarPost(mensagem);
    case 'AI_PROMPT_IMAGEM':
      return criarPromptImagem(mensagem);
    case 'AI_GERAR_IMAGEM':
      return gerarImagem(mensagem);
    case 'CHECK_LINKS':
      return verificarLinks(mensagem.urls);
    default:
      throw new Error('Comando desconhecido.');
  }
}

// ---------------------------------------------------------------------------
// Chave de API (BYOK)
// ---------------------------------------------------------------------------

interface AjustesIA {
  provedor: Provedor;
  modelos: Record<Provedor, string>;
}

interface SessaoIA {
  provedor: Provedor;
  apiKey: string;
}

function normalizarProvedor(valor: unknown): Provedor {
  return valor === 'deepseek' ? 'deepseek' : 'google';
}

function normalizarModelo(nome: string, padrao: string): string {
  const modelo = String(nome || '').trim();
  if (!modelo) return padrao;
  return MODELOS_APOSENTADOS[modelo] || modelo;
}

async function obterAjustes(): Promise<AjustesIA> {
  const local = (await chrome.storage.local.get(ARMAZEM_AJUSTES)) as Record<string, unknown>;
  const bruto = (local[ARMAZEM_AJUSTES] || {}) as Record<string, unknown>;
  const modelos = (bruto.modelos || {}) as Record<string, unknown>;
  const modeloAntigo = typeof bruto.modelo === 'string' ? bruto.modelo : '';
  return {
    provedor: normalizarProvedor(bruto.provedor),
    modelos: {
      google: normalizarModelo(String(modelos.google || modeloAntigo || ''), MODELO_PADRAO_GOOGLE),
      deepseek: normalizarModelo(String(modelos.deepseek || ''), MODELO_PADRAO_DEEPSEEK),
    },
  };
}

async function salvarAjustes(parcial: { provedor?: Provedor; modelo?: string }): Promise<StatusChave> {
  const atuais = await obterAjustes();
  const proximo: AjustesIA = {
    provedor: parcial.provedor ? normalizarProvedor(parcial.provedor) : atuais.provedor,
    modelos: { ...atuais.modelos },
  };
  if (parcial.modelo !== undefined) {
    const modelo = String(parcial.modelo || '').trim();
    if (!modelo) throw new Error('Informe o nome do modelo.');
    if (modelo.length > 80) throw new Error('O nome do modelo é longo demais.');
    proximo.modelos[proximo.provedor] = modelo;
  }
  await chrome.storage.local.set({ [ARMAZEM_AJUSTES]: proximo });
  return statusAtual();
}

async function definirProvedorAtivo(provedor: Provedor): Promise<void> {
  const atuais = await obterAjustes();
  await chrome.storage.local.set({
    [ARMAZEM_AJUSTES]: { provedor, modelos: { ...atuais.modelos } },
  });
}

interface SessoesIA {
  ativo: Provedor;
  chaves: Partial<Record<Provedor, string>>;
}

// A sessão guarda a chave desbloqueada de cada provedor (some ao fechar o navegador).
async function lerSessoes(): Promise<SessoesIA> {
  const dados = (await chrome.storage.session.get(SESSAO_CHAVE)) as Record<string, unknown>;
  const bruto = (dados[SESSAO_CHAVE] || null) as Record<string, unknown> | null;
  const sessoes: SessoesIA = { ativo: 'google', chaves: {} };
  if (!bruto) return sessoes;
  if (typeof bruto.apiKey === 'string' && bruto.apiKey) {
    // Formato antigo: uma chave só.
    const provedor = normalizarProvedor(bruto.provedor);
    sessoes.ativo = provedor;
    sessoes.chaves[provedor] = bruto.apiKey;
    return sessoes;
  }
  sessoes.ativo = normalizarProvedor(bruto.ativo);
  const chaves = (bruto.chaves || {}) as Record<string, unknown>;
  if (typeof chaves.google === 'string' && chaves.google) sessoes.chaves.google = chaves.google;
  if (typeof chaves.deepseek === 'string' && chaves.deepseek) sessoes.chaves.deepseek = chaves.deepseek;
  return sessoes;
}

async function chaveDaSessao(provedor: Provedor): Promise<string | null> {
  const sessoes = await lerSessoes();
  return sessoes.chaves[provedor] || null;
}

async function gravarSessao(provedor: Provedor, apiKey: string): Promise<void> {
  const sessoes = await lerSessoes();
  const chaves = { ...sessoes.chaves, [provedor]: apiKey };
  await chrome.storage.session.set({ [SESSAO_CHAVE]: { ativo: provedor, chaves } });
}

let migracaoFeita = false;

async function garantirMigracao(): Promise<void> {
  if (migracaoFeita) return;
  migracaoFeita = true;
  try {
    // Formato antigo: uma única chave, sempre do Google.
    const local = (await chrome.storage.local.get(['bai.encryptedKey', armazemChave('google')])) as Record<string, unknown>;
    if (local['bai.encryptedKey'] && !local[armazemChave('google')]) {
      await chrome.storage.local.set({ [armazemChave('google')]: local['bai.encryptedKey'] });
      await chrome.storage.local.remove('bai.encryptedKey');
    }
  } catch {
    // segue sem migração
  }
}

async function statusAtual(): Promise<StatusChave> {
  const ajustes = await obterAjustes();
  const local = (await chrome.storage.local.get([
    armazemChave('google'),
    armazemChave('deepseek'),
  ])) as Record<string, unknown>;
  const sessoes = await lerSessoes();
  return {
    provedor: ajustes.provedor,
    temGoogle: Boolean(local[armazemChave('google')]),
    temDeepSeek: Boolean(local[armazemChave('deepseek')]),
    desbloqueada: sessoes.ativo === ajustes.provedor && Boolean(sessoes.chaves[ajustes.provedor]),
    modelo: ajustes.modelos[ajustes.provedor],
  };
}

async function salvarChave(mensagem: { provedor: Provedor; apiKey: string; masterPassword: string }): Promise<StatusChave> {
  const provedor = normalizarProvedor(mensagem.provedor);
  const chave = String(mensagem.apiKey || '').trim();
  const senha = String(mensagem.masterPassword || '');
  if (!chave) throw new Error('Informe a chave da API.');
  if (chave.length < 20) throw new Error('A chave da API parece curta demais. Confira no painel do provedor.');
  if (senha.length < 8) throw new Error('A senha mestra precisa ter pelo menos 8 caracteres.');

  const pacote = await encryptKey(chave, senha);
  await chrome.storage.local.set({ [armazemChave(provedor)]: pacote });
  await definirProvedorAtivo(provedor);
  await gravarSessao(provedor, chave);
  return statusAtual();
}

async function desbloquear(mensagem: { provedor: Provedor; masterPassword: string }): Promise<StatusChave> {
  const provedor = normalizarProvedor(mensagem.provedor);
  const senha = String(mensagem.masterPassword || '');
  if (!senha) throw new Error('Informe a senha mestra.');
  const local = (await chrome.storage.local.get(armazemChave(provedor))) as Record<string, unknown>;
  const pacote = local[armazemChave(provedor)] as PacoteChave | undefined;
  if (!pacote) {
    throw new Error('Nenhuma chave do ' + NOMES_PROVEDOR[provedor] + ' salva ainda. Salve a chave primeiro.');
  }

  let chave: string;
  try {
    chave = await decryptKey(pacote, senha);
  } catch {
    throw new Error('Senha mestra incorreta.');
  }
  await definirProvedorAtivo(provedor);
  await gravarSessao(provedor, chave);
  return statusAtual();
}

async function bloquear(): Promise<void> {
  await chrome.storage.session.remove(SESSAO_CHAVE);
}

async function obterChaveAtiva(): Promise<SessaoIA> {
  const ajustes = await obterAjustes();
  const sessoes = await lerSessoes();
  const chave = sessoes.chaves[ajustes.provedor];
  if (sessoes.ativo !== ajustes.provedor || !chave) {
    throw new Error(
      'A chave do ' + NOMES_PROVEDOR[ajustes.provedor] +
        ' está bloqueada. Abra o popup da extensão e desbloqueie com a senha mestra (ou salve a chave).',
    );
  }
  return { provedor: ajustes.provedor, apiKey: chave };
}

async function testarChave(): Promise<{ resposta: string; provedor: string; modelo: string }> {
  const ativa = await obterChaveAtiva();
  const ajustes = await obterAjustes();
  const resposta = await chamarIA(
    {
      prompt: 'Responda apenas com a palavra: ok',
      temperatura: 0,
      maxTokens: 1024,
    },
    { semFallback: true, semRetentativas: true },
  );
  return {
    resposta: limitarTexto(resposta, 40),
    provedor: NOMES_PROVEDOR[ativa.provedor],
    modelo: ajustes.modelos[ativa.provedor],
  };
}

// ---------------------------------------------------------------------------
// APIs de IA (Google Gemini e DeepSeek)
// ---------------------------------------------------------------------------

interface OpcoesIA {
  prompt: string;
  imagemBase64?: string | null;
  tipoImagem?: string;
  esquema?: object | null;
  temperatura?: number;
  maxTokens?: number;
}

interface RespostaGemini {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

interface RespostaDeepSeek {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

interface ControleIA {
  semFallback?: boolean;
  semRetentativas?: boolean;
}

// Chama a IA com duas proteções: repeti erros passageiros (429/503, alta procura)
// e, se o outro serviço estiver desbloqueado, tenta nele antes de desistir.
async function chamarIA(opcoes: OpcoesIA, controle: ControleIA = {}): Promise<string> {
  const ajustes = await obterAjustes();
  const principal = ajustes.provedor;
  const sessoes = await lerSessoes();
  if (sessoes.ativo !== principal || !sessoes.chaves[principal]) {
    throw new Error(
      'A chave do ' + NOMES_PROVEDOR[principal] +
        ' está bloqueada. Abra o popup da extensão e desbloqueie com a senha mestra (ou salve a chave).',
    );
  }
  const ordem: Provedor[] = controle.semFallback
    ? [principal]
    : [principal, principal === 'google' ? 'deepseek' : 'google'];
  let ultimoErro: unknown = null;
  for (const provedor of ordem) {
    const chave = sessoes.chaves[provedor];
    if (!chave) continue;
    try {
      return await chamarProvedor(provedor, chave, ajustes.modelos[provedor], opcoes, !controle.semRetentativas);
    } catch (erro) {
      ultimoErro = erro;
      const transitorio = erro instanceof ErroApi && erro.transitorio;
      if (!transitorio) throw erro;
      // erro passageiro: tenta o próximo da fila (se houver)
    }
  }
  throw ultimoErro instanceof Error
    ? ultimoErro
    : new Error('Não consegui falar com a IA agora. Tente novamente em instantes.');
}

async function chamarProvedor(
  provedor: Provedor,
  apiKey: string,
  modelo: string,
  opcoes: OpcoesIA,
  comRetentativas: boolean,
): Promise<string> {
  const esperas = comRetentativas ? [2500, 7000] : [];
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return provedor === 'deepseek'
        ? await chamarDeepSeek(apiKey, modelo, opcoes)
        : await chamarGoogle(apiKey, modelo, opcoes);
    } catch (erro) {
      const transitorio = erro instanceof ErroApi && erro.transitorio;
      if (!transitorio || tentativa >= esperas.length) throw erro;
      await dormir(esperas[tentativa]);
    }
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function chamarGoogle(apiKey: string, modelo: string, opcoes: OpcoesIA): Promise<string> {
  const partes: Array<Record<string, unknown>> = [{ text: opcoes.prompt }];
  if (opcoes.imagemBase64) {
    partes.push({
      inline_data: { mime_type: opcoes.tipoImagem || 'image/jpeg', data: opcoes.imagemBase64 },
    });
  }

  const corpo: Record<string, unknown> = {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      temperature: opcoes.temperatura ?? 0.2,
      maxOutputTokens: opcoes.maxTokens ?? 8192,
    },
  };
  if (opcoes.esquema) {
    const config = corpo.generationConfig as Record<string, unknown>;
    config.responseMimeType = 'application/json';
    config.responseSchema = opcoes.esquema;
  }

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 60000);
  let resposta: Response;
  try {
    resposta = await fetch(`${ENDPOINT_GOOGLE}/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    if (erro && (erro as { name?: string }).name === 'AbortError') {
      throw new ErroApi('A IA demorou demais para responder. Tente novamente.', true);
    }
    throw new ErroApi('Não consegui falar com a API do Google. Verifique a conexão e tente de novo.', true);
  } finally {
    clearTimeout(relogio);
  }

  const dados = (await resposta.json().catch(() => null)) as RespostaGemini | null;
  if (!resposta.ok) {
    throw erroDaApi('Google', resposta.status, dados?.error?.message ?? undefined);
  }

  const texto = extrairTexto(dados);
  if (!texto) throw new Error('A IA não retornou texto. Tente novamente.');
  return texto;
}

async function chamarDeepSeek(apiKey: string, modelo: string, opcoes: OpcoesIA): Promise<string> {
  const conteudo: Array<Record<string, unknown>> = [{ type: 'text', text: opcoes.prompt }];
  if (opcoes.imagemBase64) {
    const tipo = opcoes.tipoImagem || 'image/jpeg';
    conteudo.push({
      type: 'image_url',
      image_url: { url: `data:${tipo};base64,${opcoes.imagemBase64}` },
    });
  }

  const corpo: Record<string, unknown> = {
    model: modelo,
    messages: [{ role: 'user', content: conteudo }],
    temperature: opcoes.temperatura ?? 0.2,
    max_tokens: opcoes.maxTokens ?? 8192,
  };

  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 60000);
  let resposta: Response;
  try {
    resposta = await fetch(ENDPOINT_DEEPSEEK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    if (erro && (erro as { name?: string }).name === 'AbortError') {
      throw new ErroApi('A IA demorou demais para responder. Tente novamente.', true);
    }
    throw new ErroApi('Não consegui falar com a API do DeepSeek. Verifique a conexão e tente de novo.', true);
  } finally {
    clearTimeout(relogio);
  }

  const dados = (await resposta.json().catch(() => null)) as RespostaDeepSeek | null;
  if (!resposta.ok) {
    throw erroDaApi('DeepSeek', resposta.status, dados?.error?.message ?? undefined);
  }

  const candidato = dados && dados.choices && dados.choices[0];
  const texto = candidato && candidato.message && candidato.message.content;
  const limpo = typeof texto === 'string' ? texto.trim() : '';
  if (!limpo) throw new Error('A IA não retornou texto. Tente novamente.');
  return limpo;
}

class ErroApi extends Error {
  readonly transitorio: boolean;
  readonly modeloIndisponivel: boolean;
  readonly semCota: boolean;

  constructor(mensagem: string, transitorio: boolean, modeloIndisponivel = false, semCota = false) {
    super(mensagem);
    this.transitorio = transitorio;
    this.modeloIndisponivel = modeloIndisponivel;
    this.semCota = semCota;
  }
}

function erroDaApi(provedorNome: string, status: number, detalheApi?: string): ErroApi {
  const detalhe = detalheApi ? ` (${detalheApi})` : '';
  if (status === 400) {
    return new ErroApi('A chave da API parece inválida ou a solicitação foi recusada.' + detalhe, false);
  }
  if (status === 401 || status === 403) {
    return new ErroApi('A chave da API não tem permissão para usar este modelo.' + detalhe, false);
  }
  if (status === 404) {
    return new ErroApi(
      'O modelo configurado não foi encontrado. Confira o nome do modelo no popup da extensão.' + detalhe,
      false,
      true,
    );
  }
  if (status === 429) {
    const textoDetalhe = detalheApi || '';
    const semCota = /limit:\s*0|free tier|upgrade your tier|not available for free/i.test(textoDetalhe);
    if (semCota) {
      return new ErroApi(
        'Sua conta do Google está no nível gratuito e este modelo está fora da cota gratuita (0 por dia). ' +
          'Para usar, ative o faturamento da conta no Google AI Studio.' +
          detalhe,
        false,
        false,
        true,
      );
    }
    return new ErroApi('Limite de uso da API atingido. Aguarde um instante e tente novamente.' + detalhe, true);
  }
  if (status >= 500) {
    return new ErroApi(
      'O serviço do ' + provedorNome + ' está instável agora (alta procura). Tente novamente em instantes.' + detalhe,
      true,
    );
  }
  return new ErroApi('A API do ' + provedorNome + ' respondeu com erro ' + status + '.' + detalhe, false);
}

function extrairTexto(dados: RespostaGemini | null): string {
  const candidato = dados && dados.candidates && dados.candidates[0];
  const partes = candidato && candidato.content && candidato.content.parts;
  if (!partes || !partes.length) {
    const motivo = dados && dados.promptFeedback && dados.promptFeedback.blockReason;
    if (motivo) throw new Error('O conteúdo foi bloqueado pela IA (' + motivo + ').');
    if (candidato && candidato.finishReason === 'MAX_TOKENS') {
      throw new Error('A IA atingiu o limite de resposta antes de escrever. Tente novamente.');
    }
    return '';
  }
  return partes.map((parte) => parte.text || '').join('').trim();
}

// ---------------------------------------------------------------------------
// Otimização de texto
// ---------------------------------------------------------------------------

async function otimizarTexto(mensagem: { text: string; title: string; keyword: string }): Promise<SugestaoTexto> {
  const texto = String(mensagem.text || '').trim();
  const titulo = limitarTexto(mensagem.title, 160);
  const palavraChave = limitarTexto(mensagem.keyword, 120);

  if (texto.length < 40) throw new Error('O texto do post está muito curto para analisar.');
  if (!palavraChave) throw new Error('Informe a palavra-chave principal do post.');

  const bruto = await chamarIA({
    prompt: montarPromptTexto({ texto, titulo, palavraChave }),
    esquema: ESQUEMA_TEXTO,
    temperatura: 0.2,
    maxTokens: 32768,
  });

  return normalizarOtimizacao(lerJson(bruto));
}

function montarPromptTexto(dados: { texto: string; titulo: string; palavraChave: string }): string {
  const cortado = dados.texto.length > LIMITE_TEXTO;
  const trecho = cortado ? dados.texto.slice(0, LIMITE_TEXTO) : dados.texto;
  const linhas = [
    'Você é um especialista em SEO para blogs e escreve em português do Brasil.',
    'Analise o post abaixo e responda SOMENTE com o JSON pedido, sem comentários e sem cercas de código (```).',
    '',
    'Palavra-chave principal: "' + dados.palavraChave + '"',
    dados.titulo ? 'Título atual: "' + dados.titulo + '"' : 'O post ainda não tem título.',
    '',
    'Regras:',
    '- title: no máximo 60 caracteres, com a palavra-chave, sem sensacionalismo.',
    '- meta_description: no máximo 155 caracteres, com a palavra-chave, resumindo o conteúdo.',
    '- improved_text: reescreva melhorando clareza e legibilidade, sem mudar o sentido;',
    '  mantenha os parágrafos separados por linha em branco; não use HTML.',
    '- headings: até 5 sugestões curtas de subtítulos (H2), em ordem de aparição.',
    '- notes: até 5 observações objetivas (legibilidade, densidade da palavra-chave, estrutura).',
  ];
  if (cortado) linhas.push('(Observação: o texto foi cortado no limite de análise.)');
  linhas.push('', 'POST:', '"""', trecho, '"""');
  return linhas.join('\n');
}

function normalizarOtimizacao(bruto: unknown): SugestaoTexto {
  const dados = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const saida: SugestaoTexto = {
    title: limitarTexto(dados.title, 70),
    meta_description: limitarTexto(dados.meta_description, 160),
    improved_text: String(dados.improved_text || '').trim(),
    headings: vetorDeTextos(dados.headings, 8, 90),
    notes: vetorDeTextos(dados.notes, 8, 220),
  };
  if (!saida.title && !saida.meta_description && !saida.improved_text) {
    throw new Error('A IA devolveu uma resposta vazia. Tente novamente.');
  }
  return saida;
}

// ---------------------------------------------------------------------------
// ALT de imagens (visão)
// ---------------------------------------------------------------------------

async function gerarAlt(mensagem: {
  src: string;
  contexto: { titulo: string; palavraChave: string };
}): Promise<SugestaoAlt> {
  const src = String(mensagem.src || '').trim();
  if (!src) throw new Error('A imagem não tem endereço utilizável.');
  if (!/^(https?:|data:image)/i.test(src)) {
    throw new Error('Não consigo analisar este tipo de imagem.');
  }

  const { base64, tipo } = await baixarImagem(src);
  const bruto = await chamarIA({
    prompt: montarPromptImagem(mensagem.contexto),
    imagemBase64: base64,
    tipoImagem: tipo,
    esquema: ESQUEMA_ALT,
    temperatura: 0.2,
    maxTokens: 8192,
  });
  return normalizarAlt(lerJson(bruto));
}

function montarPromptImagem(contexto: { titulo: string; palavraChave: string }): string {
  const linhas = [
    'Você descreve imagens para acessibilidade (atributo alt) de blogs, em português do Brasil.',
  ];
  if (contexto && contexto.titulo) linhas.push('Título do post: "' + limitarTexto(contexto.titulo, 120) + '"');
  if (contexto && contexto.palavraChave) linhas.push('Palavra-chave do post: "' + limitarTexto(contexto.palavraChave, 80) + '"');
  linhas.push(
    '',
    'Responda SOMENTE com o JSON pedido, sem cercas de código (```).',
    '- alt: descrição específica e objetiva da imagem, em português do Brasil, com 70 a 125 caracteres (até 12 palavras), sem começar com "imagem de" nem "foto de" e sem aspas.',
    '- caption: uma frase curta de legenda que complemente a imagem, sem repetir o alt literalmente.',
  );
  return linhas.join('\n');
}

function normalizarAlt(bruto: unknown): SugestaoAlt {
  const dados = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const alt = limitarTexto(dados.alt, 125);
  if (!alt) throw new Error('A IA não conseguiu descrever a imagem.');
  return { alt, caption: limitarTexto(dados.caption, 160) };
}

async function baixarImagem(src: string): Promise<{ base64: string; tipo: string }> {
  let blob: Blob;
  try {
    const resposta = await fetch(src, { redirect: 'follow' });
    if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
    blob = await resposta.blob();
  } catch {
    throw new Error('Não consegui baixar a imagem (pode ser privada ou o endereço mudou).');
  }
  if (!/^image\//.test(blob.type || '')) throw new Error('O endereço não devolveu uma imagem.');
  const ajustado = await reduzirImagem(blob);
  if (ajustado.size > 15 * 1024 * 1024) throw new Error('A imagem é grande demais para enviar à IA.');
  return { base64: await blobParaBase64(ajustado), tipo: ajustado.type || 'image/jpeg' };
}

async function reduzirImagem(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const maiorLado = Math.max(bitmap.width, bitmap.height);
    const escala = Math.min(1, 1024 / maiorLado);
    if (escala === 1 && blob.size <= 1500000) {
      bitmap.close();
      return blob;
    }
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));
    const tela = new OffscreenCanvas(largura, altura);
    const contexto = tela.getContext('2d');
    if (!contexto) return blob;
    contexto.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close();
    return await tela.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } catch {
    return blob;
  }
}

async function blobParaBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binario = '';
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode(...Array.from(bytes.subarray(i, i + passo)));
  }
  return btoa(binario);
}

// ---------------------------------------------------------------------------
// Criador de posts (personalidade + SEO) e aprendizado de estilo
// ---------------------------------------------------------------------------

interface EntradaFeed {
  title?: { $t?: string };
  content?: { $t?: string };
  link?: Array<{ rel?: string; href?: string }>;
}

interface RespostaFeed {
  feed?: { entry?: EntradaFeed[] };
}

async function buscarPostsDoBlog(blogId: string): Promise<{ posts: PostDoBlog[]; amostras: string[] }> {
  const id = String(blogId || '').trim();
  if (!/^[0-9]{5,25}$/.test(id)) {
    throw new Error('Não identifiquei o número do blog nesta página. Abra o editor de um post e tente de novo.');
  }
  const url = 'https://www.blogger.com/feeds/' + id + '/posts/default?alt=json&max-results=50';
  let resposta: Response;
  try {
    resposta = await fetch(url, { redirect: 'follow' });
  } catch {
    throw new Error('Não consegui acessar os textos do blog. Verifique a conexão e tente de novo.');
  }
  if (!resposta.ok) {
    throw new Error(
      'O blog não liberou a lista de posts (talvez seja privado). Você pode escrever a personalidade à mão.',
    );
  }
  const dados = (await resposta.json().catch(() => null)) as RespostaFeed | null;
  const entradas = (dados && dados.feed && dados.feed.entry) || [];
  const posts: PostDoBlog[] = [];
  const amostras: string[] = [];
  for (const entrada of entradas) {
    const titulo = (entrada.title && entrada.title.$t) || '';
    const links = entrada.link || [];
    const alternativo = links.find((l) => l.rel === 'alternate' && l.href);
    if (titulo && alternativo && alternativo.href) posts.push({ titulo, url: alternativo.href });
    const bruto = (entrada.content && entrada.content.$t) || '';
    const limpo = bruto.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (titulo && limpo.length > 200 && amostras.length < 10) {
      amostras.push('Título: ' + titulo + '\n' + limpo.slice(0, 3000));
    }
  }
  return { posts, amostras };
}

async function aprenderEstilo(blogId: string): Promise<PerfilEstilo> {
  const { posts, amostras } = await buscarPostsDoBlog(blogId);
  if (!amostras.length) {
    throw new Error('Não encontrei posts publicados com texto suficiente para aprender o estilo.');
  }
  const material = amostras.join('\n\n---\n\n').slice(0, 26000);
  const prompt = [
    'Você é um analista de estilo de escrita.',
    'Leia os textos abaixo, escritos pelo autor de um blog, e produza um PERFIL DE ESTILO objetivo, em português do Brasil.',
    'Descreva: tom e humor, público, vocabulário típico, expressões e bordões, tamanho dos parágrafos, uso de listas, ritmo e estrutura dos posts.',
    'Responda apenas com o texto do perfil (até 1200 caracteres), pronto para ser usado como instrução de personalidade.',
    '',
    'TEXTOS:',
    material,
  ].join('\n');
  const perfil = limitarTexto(await chamarIA({ prompt, temperatura: 0.3, maxTokens: 4096 }), 1500);
  if (!perfil) throw new Error('A IA não conseguiu criar o perfil de estilo. Tente novamente.');
  const pacote: PerfilEstilo = { perfil, posts: posts.slice(0, 25), atualizadoEm: agoraIso() };
  await chrome.storage.local.set({ 'bai.perfilEstilo': pacote });
  return pacote;
}

async function gerarPost(mensagem: {
  persona: string;
  assunto: string;
  pontos: string;
  blogId: string;
}): Promise<CriacaoPost> {
  const persona = String(mensagem.persona || '').trim().slice(0, 2000);
  const assunto = limitarTexto(mensagem.assunto, 200);
  const pontos = String(mensagem.pontos || '').trim().slice(0, 4000);
  if (!assunto) throw new Error('Informe o assunto (ou um título provisório) do post.');
  if (persona.length < 20) {
    throw new Error('Escreva a personalidade ou use "Aprender estilo com os textos do blog".');
  }

  let listaPosts: PostDoBlog[] = [];
  const local = (await chrome.storage.local.get('bai.perfilEstilo')) as Record<string, unknown>;
  const salvo = local['bai.perfilEstilo'] as PerfilEstilo | undefined;
  if (salvo && Array.isArray(salvo.posts) && salvo.posts.length) {
    listaPosts = salvo.posts;
  } else if (mensagem.blogId) {
    try {
      const busca = await buscarPostsDoBlog(mensagem.blogId);
      listaPosts = busca.posts;
    } catch {
      listaPosts = [];
    }
  }

  const bruto = await chamarIA({
    prompt: montarPromptPost({ persona, assunto, pontos, posts: listaPosts.slice(0, 20) }),
    esquema: ESQUEMA_POST,
    temperatura: 0.3,
    maxTokens: 32768,
  });
  return normalizarCriacao(lerJson(bruto));
}

function montarPromptPost(dados: {
  persona: string;
  assunto: string;
  pontos: string;
  posts: PostDoBlog[];
}): string {
  const linhas = [
    'Você é o autor de um blog e vai escrever um post completo, em português do Brasil.',
    '',
    'PERSONALIDADE (siga exatamente este jeito de escrever):',
    dados.persona,
    '',
    'ASSUNTO DO POST: ' + dados.assunto,
  ];
  if (dados.pontos) {
    linhas.push('', 'PONTOS QUE PRECISAM APARECER (não ignore nenhum):', dados.pontos);
  }
  linhas.push(
    '',
    'REGRAS DE SEO QUE O TEXTO PRECISA CUMPRIR:',
    '- titulo: 50 a 60 caracteres, com a palavra-chave principal no início, sem repetir o nome do blog.',
    '- meta_descricao: 150 a 160 caracteres, com a palavra-chave de forma natural e um convite para clicar.',
    '- slug: curto, com a palavra-chave, palavras separadas por hífen.',
    '- Estrutura: use apenas <h2> e <h3> no corpo (o título do post já é o H1); nunca pule níveis; um <h2> a cada 200 a 500 palavras.',
    '- corpo_html: entre 800 e 2500 palavras, parágrafos de 2 a 4 linhas, listas quando ajudar, negrito para destacar.',
    '- Densidade da palavra-chave principal: entre 1% e 2% (nunca acima de 3%).',
    '- Use APENAS estas tags no corpo: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <em> e <a href="...">.',
    '- Conteúdo único e específico sobre o assunto; nada de encher linguiça.',
  );
  if (dados.posts.length) {
    linhas.push(
      '- links_internos: sugira de 2 a 5 links para posts do próprio blog usando SOMENTE estas URLs: ' +
        dados.posts.map((post) => post.url).join(' '),
    );
  } else {
    linhas.push('- links_internos: deixe a lista vazia.');
  }
  linhas.push(
    '- observacoes: até 4 recados curtos para o autor (ex.: onde inserir imagens, fatos a conferir).',
    '',
    'Responda SOMENTE com o JSON pedido, sem cercas de código (```).',
  );
  return linhas.join('\n');
}

function normalizarCriacao(bruto: unknown): CriacaoPost {
  const dados = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const corpo = String(dados.corpo_html || '').trim();
  if (!corpo) throw new Error('A IA não devolveu o texto do post. Tente novamente.');
  const linksBrutos = Array.isArray(dados.links_internos) ? dados.links_internos : [];
  const links: LinkInterno[] = [];
  for (const item of linksBrutos) {
    const registro = (item || {}) as Record<string, unknown>;
    const ancora = limitarTexto(registro.ancora, 80);
    const url = String(registro.url || '').trim();
    if (ancora && /^https?:/i.test(url)) links.push({ ancora, url });
  }
  return {
    titulo: limitarTexto(dados.titulo, 90),
    meta_descricao: limitarTexto(dados.meta_descricao, 220),
    slug: limitarTexto(dados.slug, 90),
    palavra_chave: limitarTexto(dados.palavra_chave, 80),
    palavras_secundarias: vetorDeTextos(dados.palavras_secundarias, 10, 60),
    corpo_html: corpo.slice(0, 120000),
    links_internos: links.slice(0, 8),
    observacoes: vetorDeTextos(dados.observacoes, 6, 240),
  };
}

function agoraIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Imagem para o post (comando criado pela IA + geração com os modelos do Google)
// ---------------------------------------------------------------------------

const ESQUEMA_PROMPT_IMAGEM = {
  type: 'OBJECT',
  properties: {
    prompt: {
      type: 'STRING',
      description: 'Comando em inglês, detalhado (cena, estilo, luz, enquadramento), sem texto escrito dentro da imagem.',
    },
    alt: {
      type: 'STRING',
      description: 'Descrição da imagem em português do Brasil, com 70 a 125 caracteres.',
    },
  },
  required: ['prompt', 'alt'],
  propertyOrdering: ['prompt', 'alt'],
};

async function criarPromptImagem(mensagem: {
  titulo: string;
  texto: string;
  palavraChave: string;
  estilo: string;
}): Promise<PromptImagem> {
  const titulo = limitarTexto(mensagem.titulo, 160);
  const texto = String(mensagem.texto || '').trim();
  const palavraChave = limitarTexto(mensagem.palavraChave, 120);
  if (titulo.length < 5 || texto.length < 200) {
    throw new Error(
      'Para montar o comando a partir do post, o post precisa ter título e um texto com pelo menos um parágrafo. Sem isso, escreva você mesmo o comando da imagem.',
    );
  }
  const bruto = await chamarIA({
    prompt: montarPromptImagemDoPost({ titulo, texto, palavraChave, estilo: limitarTexto(mensagem.estilo, 300) }),
    esquema: ESQUEMA_PROMPT_IMAGEM,
    temperatura: 0.5,
    maxTokens: 8192,
  });
  const dados = (lerJson(bruto) || {}) as Record<string, unknown>;
  const prompt = String(dados.prompt || '').trim();
  if (!prompt) throw new Error('A IA não conseguiu criar o comando da imagem. Tente de novo.');
  return { prompt: limitarTexto(prompt, 1200), alt: limitarTexto(dados.alt, 125) };
}

function montarPromptImagemDoPost(dados: {
  titulo: string;
  texto: string;
  palavraChave: string;
  estilo: string;
}): string {
  const trecho = dados.texto.length > 3000 ? dados.texto.slice(0, 3000) : dados.texto;
  const linhas = [
    'Você cria comandos ("prompts") de imagem para ilustrar posts de blog.',
    'Leia a prévia do post abaixo e escreva um comando de imagem que represente bem o assunto.',
    'Regras:',
    '- prompt: escrito em inglês, com cena, estilo (fotografia ou ilustração), iluminação e enquadramento;',
    '  sem escrever texto ou palavras dentro da imagem; sem marcas conhecidas nem pessoas famosas.',
    '- alt: em português do Brasil, descrevendo o que a imagem mostra, com 70 a 125 caracteres,',
    '  sem começar com "imagem de" nem "foto de".',
    'Responda SOMENTE com o JSON pedido, sem cercas de código (```).',
  ];
  if (dados.palavraChave) linhas.push('', 'Palavra-chave do post: "' + dados.palavraChave + '"');
  if (dados.estilo) linhas.push('Tom do blog (use só como referência): ' + dados.estilo);
  linhas.push('', 'Título do post: ' + dados.titulo, 'Prévia do texto:', '"""', trecho, '"""');
  return linhas.join('\n');
}

async function gerarImagem(mensagem: { prompt: string; proporcao: string; alt: string }): Promise<ResultadoImagem> {
  const chave = await chaveDaSessao('google');
  if (!chave) {
    throw new Error(
      'A geração de imagem usa o serviço do Google. Salve e desbloqueie a chave do Google no popup da extensão, ou escolha uma imagem do computador.',
    );
  }
  const prompt = String(mensagem.prompt || '').trim();
  if (prompt.length < 15) throw new Error('Escreva o que a imagem deve mostrar (pelo menos 15 caracteres).');
  const proporcao = /^[0-9]{1,2}:[0-9]{1,2}$/.test(String(mensagem.proporcao || ''))
    ? String(mensagem.proporcao)
    : '16:9';
  let ultimoErro: unknown = null;
  for (const modelo of MODELOS_IMAGEM) {
    try {
      const imagem = await pedirImagem(chave, modelo, limitarTexto(prompt, 1200), proporcao);
      return { imagem, modelo, alt: limitarTexto(mensagem.alt, 125) };
    } catch (erro) {
      ultimoErro = erro;
      // Tenta o próximo modelo quando este não existe ou não tem cota na conta.
      if (erro instanceof ErroApi && (erro.modeloIndisponivel || erro.semCota)) continue;
      throw erro;
    }
  }
  if (ultimoErro instanceof ErroApi && ultimoErro.semCota) {
    throw new ErroApi(
      'A geração de imagem não está liberada na sua conta do Google: no nível gratuito a cota é de 0 imagens por dia, e nenhum dos modelos de imagem tem cota gratuita. ' +
        'Para gerar por aqui, ative o faturamento da conta no Google AI Studio. ' +
        'Enquanto isso: cole o comando em um serviço de imagens (por exemplo, o Gemini no navegador), salve a imagem e use "Escolher do computador"; ou use "Usar imagem padrão".',
      false,
    );
  }
  throw ultimoErro instanceof Error ? ultimoErro : new Error('Não consegui gerar a imagem agora. Tente novamente.');
}

async function pedirImagem(apiKey: string, modelo: string, prompt: string, proporcao: string): Promise<string> {
  try {
    return await pedirImagemInteracoes(apiKey, modelo, prompt, proporcao);
  } catch (erro) {
    if (erro instanceof ErroApi && erro.modeloIndisponivel) {
      return await pedirImagemClassica(apiKey, modelo, prompt, proporcao);
    }
    throw erro;
  }
}

interface RespostaInteracao {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; mime_type?: string; mimeType?: string; data?: string }>;
  }>;
  error?: { message?: string };
}

async function pedirImagemInteracoes(
  apiKey: string,
  modelo: string,
  prompt: string,
  proporcao: string,
): Promise<string> {
  const corpo = {
    model: modelo,
    input: prompt,
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: proporcao },
    store: false,
  };
  const resposta = await pedirApi(ENDPOINT_INTERACOES, apiKey, corpo, 180000);
  const dados = (await resposta.json().catch(() => null)) as RespostaInteracao | null;
  if (!resposta.ok) throw erroDaApi('Google', resposta.status, dados?.error?.message ?? undefined);
  const extraida = extrairImagemInteracao(dados);
  if (extraida.imagem) return extraida.imagem;
  if (extraida.texto) throw new ErroApi('A imagem não veio. Resposta do serviço: ' + extraida.texto, false);
  throw new ErroApi('O serviço não devolveu imagem nem explicação. Tente novamente.', true);
}

function extrairImagemInteracao(dados: RespostaInteracao | null): { imagem: string; texto: string } {
  let texto = '';
  for (const passo of (dados && dados.steps) || []) {
    for (const bloco of passo.content || []) {
      if (bloco.type === 'image' && bloco.data) {
        const tipo = bloco.mime_type || bloco.mimeType || 'image/jpeg';
        return { imagem: 'data:' + tipo + ';base64,' + bloco.data, texto };
      }
      if (bloco.type === 'text' && bloco.text) texto += bloco.text + ' ';
    }
  }
  return { imagem: '', texto: limitarTexto(texto, 300) };
}

interface RespostaClassica {
  candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  error?: { message?: string };
}

// Caminho antigo (generateContent): só usado se a API nova não aceitar o modelo.
async function pedirImagemClassica(apiKey: string, modelo: string, prompt: string, proporcao: string): Promise<string> {
  const corpo = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: proporcao } },
  };
  const url = ENDPOINT_GOOGLE + '/' + encodeURIComponent(modelo) + ':generateContent';
  const resposta = await pedirApi(url, apiKey, corpo, 180000);
  const dados = (await resposta.json().catch(() => null)) as RespostaClassica | null;
  if (!resposta.ok) throw erroDaApi('Google', resposta.status, dados?.error?.message ?? undefined);
  const candidato = dados && dados.candidates && dados.candidates[0];
  const partes = (candidato && candidato.content && candidato.content.parts) || [];
  let texto = '';
  for (const parte of partes) {
    const registro = (parte || {}) as Record<string, unknown>;
    const bruto = (registro.inlineData || registro.inline_data) as
      | { mimeType?: string; mime_type?: string; data?: string }
      | undefined;
    if (bruto && bruto.data) {
      return 'data:' + (bruto.mimeType || bruto.mime_type || 'image/jpeg') + ';base64,' + bruto.data;
    }
    if (typeof registro.text === 'string') texto += registro.text + ' ';
  }
  if (texto.trim()) throw new ErroApi('A imagem não veio. Resposta do serviço: ' + limitarTexto(texto, 300), false);
  throw new ErroApi('O serviço não devolveu imagem. Tente novamente.', true);
}

async function pedirApi(url: string, apiKey: string, corpo: unknown, tempoLimite: number): Promise<Response> {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), tempoLimite);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(corpo),
      signal: controlador.signal,
    });
  } catch (erro) {
    if (erro && (erro as { name?: string }).name === 'AbortError') {
      throw new ErroApi('A imagem demorou demais para ficar pronta. Tente novamente.', true);
    }
    throw new ErroApi('Não consegui falar com o serviço de imagens do Google. Verifique a conexão.', true);
  } finally {
    clearTimeout(relogio);
  }
}

// ---------------------------------------------------------------------------
// Verificação de links externos (permissão opcional *://*/*)
// ---------------------------------------------------------------------------

async function verificarLinks(lista: string[]): Promise<ResultadoLinks> {
  const urls = [...new Set((Array.isArray(lista) ? lista : []).map((url) => String(url || '').trim()))]
    .filter((url) => /^https?:/i.test(url))
    .slice(0, MAX_LINKS);

  let temPermissao = false;
  try {
    temPermissao = await chrome.permissions.contains({ origins: ['*://*/*'] });
  } catch {
    temPermissao = false;
  }

  const resultados: ResultadoLink[] = [];
  for (const url of urls) {
    resultados.push(await verificarUrl(url));
  }
  return { temPermissao, resultados };
}

async function verificarUrl(url: string): Promise<ResultadoLink> {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), 8000);
  try {
    let resposta: Response | null = null;
    try {
      resposta = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controlador.signal });
    } catch {
      resposta = null;
    }
    if (!resposta || resposta.status === 405 || resposta.status === 501) {
      resposta = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
        signal: controlador.signal,
      });
    }
    if (resposta.status >= 200 && resposta.status < 400) {
      return { url, status: 'ok', http: resposta.status };
    }
    return { url, status: 'quebrado', http: resposta.status };
  } catch {
    return { url, status: 'nao_verificado', http: null };
  } finally {
    clearTimeout(relogio);
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function lerJson(texto: string): unknown {
  const tentativas: string[] = [texto];
  const semCercas = texto.replace(/```(?:json)?/gi, '').trim();
  if (semCercas !== texto) tentativas.push(semCercas);
  const inicio = semCercas.indexOf('{');
  const fim = semCercas.lastIndexOf('}');
  if (inicio >= 0 && fim > inicio) {
    tentativas.push(semCercas.slice(inicio, fim + 1));
  }
  for (const tentativa of tentativas) {
    try {
      return JSON.parse(tentativa);
    } catch {
      // tenta a próxima forma
    }
    try {
      return JSON.parse(tentativa.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      // tenta a próxima forma
    }
  }
  throw new Error(
    'A IA devolveu uma resposta em formato inesperado (pode ter sido cortada). Tente novamente ou use um texto menor.',
  );
}

function limitarTexto(valor: unknown, maximo: number): string {
  const texto = String(valor == null ? '' : valor).replace(/\s+/g, ' ').trim();
  if (texto.length <= maximo) return texto;
  const corte = texto.slice(0, maximo);
  const ultimoEspaco = corte.lastIndexOf(' ');
  return (ultimoEspaco > maximo * 0.6 ? corte.slice(0, ultimoEspaco) : corte).trim();
}

function vetorDeTextos(valor: unknown, maximo: number, limite: number): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => limitarTexto(item, limite)).filter(Boolean).slice(0, maximo);
}

// Ajustes iniciais na primeira instalação.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local
    .get(ARMAZEM_AJUSTES)
    .then((atual: Record<string, unknown>) => {
      if (!atual[ARMAZEM_AJUSTES]) {
        chrome.storage.local.set({
          [ARMAZEM_AJUSTES]: {
            provedor: 'google',
            modelos: { google: MODELO_PADRAO_GOOGLE, deepseek: MODELO_PADRAO_DEEPSEEK },
          },
        });
      }
    })
    .catch(() => {});
});
