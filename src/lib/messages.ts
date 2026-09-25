// messages.ts — contratos de mensagem entre content script, popup e service worker.

export interface ContextoImagem {
  titulo: string;
  palavraChave: string;
}

export interface StatusChave {
  temChave: boolean;
  desbloqueada: boolean;
  modelo: string;
}

export interface SugestaoTexto {
  title: string;
  meta_description: string;
  improved_text: string;
  headings: string[];
  notes: string[];
}

export interface SugestaoAlt {
  alt: string;
  caption: string;
}

export type StatusLink = 'ok' | 'quebrado' | 'nao_verificado';

export interface ResultadoLink {
  url: string;
  status: StatusLink;
  http: number | null;
}

export interface ResultadoLinks {
  temPermissao: boolean;
  resultados: ResultadoLink[];
}

export type MensagemParaFundo =
  | { type: 'GET_STATUS' }
  | { type: 'SAVE_KEY'; apiKey: string; masterPassword: string }
  | { type: 'UNLOCK'; masterPassword: string }
  | { type: 'LOCK' }
  | { type: 'TEST_KEY' }
  | { type: 'SET_SETTINGS'; modelo: string }
  | { type: 'AI_OPTIMIZE_TEXT'; text: string; title: string; keyword: string }
  | { type: 'AI_IMAGE_ALT'; src: string; contexto: ContextoImagem }
  | { type: 'CHECK_LINKS'; urls: string[] };

export type RespostaFundo<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
