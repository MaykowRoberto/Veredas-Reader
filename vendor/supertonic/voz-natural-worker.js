/* ============================================================
   VOZ NATURAL — trabalhador (Web Worker)
   ------------------------------------------------------------
   Roda o Supertonic 3 (Supertone Inc., código MIT, modelo
   BigScience OpenRAIL-M) com o ONNX Runtime Web, fora da linha
   principal, para a leitura nunca travar a tela.

   O modelo NÃO vem dentro do aplicativo: a pessoa o baixa uma vez
   pela tela "Ouvir leitura" e ele fica no IndexedDB deste aparelho
   (banco "veredas-voz"). Daqui em diante, nada sai do aparelho:
   o texto é transformado em áudio aqui dentro.

   A lógica de síntese segue o exemplo oficial do Supertonic
   (web/helper.js, licença MIT, © Supertone Inc.), reescrita com
   vetores tipados para gastar menos memória e tempo.

   Conversa com a página:
     → {tipo:'iniciar', ortBase, preferirGpu}
     ← {tipo:'pronto', backend}            | {tipo:'erro', ...}
     → {tipo:'sintetizar', id, texto, lang, voz, passos, velocidade}
     ← {tipo:'audio', id, wav(ArrayBuffer), duracao, tempo}
     → {tipo:'cancelar', id?}  (id ausente: cancela tudo)
   ============================================================ */
'use strict';

const BANCO = 'veredas-voz';
const IDIOMAS = ['en','ko','ja','ar','bg','cs','da','de','el','es','et','fi','fr','hi','hr','hu','id','it','lt','lv','nl','pl','pt','ro','ru','sk','sl','sv','tr','uk','vi','na'];

let ORT = null;   /* o ort.min.js declara `var ort` no escopo global */
let sessoes = null;       /* {dp, enc, ve, voc} */
let cfg = null;
let indexador = null;     /* Int32Array: ponto de código → índice */
let backend = '';
const estilos = new Map();/* 'F5' → {ttl, dp} */
const cancelados = new Set();
let cancelarTudoAte = 0;  /* ids menores ou iguais a este são descartados */
let fila = Promise.resolve();
let ultimoInicio = null;
/* Quanto custa cada parte da síntese: a página usa isso para escolher
   quantos passos cabem no tempo da fala neste aparelho. */
let medida = { fixo: 0, passos: 0, n: 0 };

async function soltarSessoes() {
  if (!sessoes) return;
  for (const x of Object.values(sessoes)) { try { await x.release(); } catch (_) {} }
  sessoes = null;
  estilos.clear();
}

/* ---------- IndexedDB ------------------------------------------------ */
function abrirBanco() {
  return new Promise((ok, falha) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('pedacos')) db.createObjectStore('pedacos');
      if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos', { keyPath: 'nome' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  });
}
function req(r) { return new Promise((ok, falha) => { r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); }); }

async function lerArquivo(db, nome) {
  const info = await req(db.transaction('arquivos').objectStore('arquivos').get(nome));
  if (!info || !info.completo) throw new Error('arquivo-ausente:' + nome);
  const loja = db.transaction('pedacos').objectStore('pedacos');
  const partes = [];
  for (let i = 0; i < info.pedacos; i++) {
    const p = await req(loja.get(nome + '#' + i));
    if (!p) throw new Error('pedaco-ausente:' + nome + '#' + i);
    partes.push(p);
  }
  return new Blob(partes);
}

/* ---------- carga do motor ------------------------------------------- */
async function iniciar(msg) {
  if (sessoes) return { backend };
  if (!ORT) try {
    importScripts(msg.ortScript || (msg.ortBase + 'ort.min.js'));
    ORT = self.ort;
    /* Vários núcleos só quando a página está isolada (o service worker
       cuida disso); sem isolamento o navegador não oferece memória
       compartilhada, e o motor roda num núcleo só. */
    ORT.env.wasm.numThreads = (self.crossOriginIsolated && msg.threads > 1) ? msg.threads : 1;
    ORT.env.wasm.proxy = false;
    ORT.env.wasm.wasmPaths = { mjs: msg.ortMjs || (msg.ortBase + 'ort-wasm-simd-threaded.jsep.js') };
    /* O binário do ONNX Runtime (28 MB) vem em duas partes de 14 MB:
       o upload pelo site do GitHub recusa arquivos acima de 25 MB.
       As partes são emendadas aqui e entregues prontas ao motor. */
    const partes = msg.wasmPartes || [msg.ortBase + 'ort-wasm-jsep-parte1.bin', msg.ortBase + 'ort-wasm-jsep-parte2.bin'];
    const buffers = [];
    for (const u of partes) {
      const r = await fetch(u);
      if (!r.ok) throw new Error('motor-ausente:' + u.split('/').pop() + ':' + r.status);
      buffers.push(new Uint8Array(await r.arrayBuffer()));
    }
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const wasm = new Uint8Array(total);
    let o = 0;
    for (const b of buffers) { wasm.set(b, o); o += b.length; }
    if (wasm[0] !== 0 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) throw new Error('motor-corrompido');
    ORT.env.wasm.wasmBinary = wasm.buffer;
  } catch (e) { ORT = null; throw e; }
  const db = await abrirBanco();
  cfg = JSON.parse(await (await lerArquivo(db, 'onnx/tts.json')).text());
  const lista = JSON.parse(await (await lerArquivo(db, 'onnx/unicode_indexer.json')).text());
  indexador = Int32Array.from(lista);

  /* O maior primeiro, de propósito: enquanto ele é montado a memória
     ainda está vazia, e é esse o momento de aperto (o arquivo ocupa
     256 MB em JavaScript e outro tanto dentro do motor). */
  const nomes = ['vector_estimator', 'vocoder', 'text_encoder', 'duration_predictor'];
  const tentar = async (provedores, opcoes) => {
    const s = {};
    try {
      for (const n of nomes) {
        let bytes = new Uint8Array(await (await lerArquivo(db, 'onnx/' + n + '.onnx')).arrayBuffer());
        s[n] = await ORT.InferenceSession.create(bytes, { executionProviders: provedores, ...opcoes });
        bytes = null;
      }
      return s;
    } catch (e) {
      for (const x of Object.values(s)) { try { await x.release(); } catch (_) {} }
      throw e;
    }
  };
  /* Tentativas, da melhor para a mais econômica. Aparelhos de 4 GB
     costumam falhar na primeira por falta de memória: a otimização do
     grafo chega a manter duas cópias dos pesos enquanto trabalha.
     Sem otimização, sem arena e sem mapa de memória, o motor usa bem
     menos — roda mais devagar, mas roda. */
  const planos = [];
  let temGpu = false;
  if (msg.preferirGpu && self.navigator && navigator.gpu) {
    try { temGpu = !!(await navigator.gpu.requestAdapter()); } catch (e) { temGpu = false; }
  }
  if (temGpu) planos.push(['webgpu', { graphOptimizationLevel: 'all' }, 'webgpu']);
  planos.push(['wasm', { graphOptimizationLevel: 'all' }, 'wasm']);
  planos.push(['wasm', { graphOptimizationLevel: 'disabled', enableMemPattern: false, enableCpuMemArena: false, executionMode: 'sequential' }, 'wasm-economico']);
  let conjunto = null, ultimoErro = null;
  for (const [ep, opcoes, nome] of planos) {
    try { conjunto = await tentar([ep], opcoes); backend = nome; break; }
    catch (e) { ultimoErro = e; }
  }
  if (!conjunto) throw ultimoErro || new Error('motor-nao-carregou');
  sessoes = { dp: conjunto.duration_predictor, enc: conjunto.text_encoder, ve: conjunto.vector_estimator, voc: conjunto.vocoder };
  db.close();
  return { backend, threads: ORT.env.wasm.numThreads };
}

async function estilo(voz) {
  if (estilos.has(voz)) return estilos.get(voz);
  const db = await abrirBanco();
  const j = JSON.parse(await (await lerArquivo(db, 'voice_styles/' + voz + '.json')).text());
  db.close();
  const ttl = new ORT.Tensor('float32', Float32Array.from(j.style_ttl.data.flat(Infinity)), j.style_ttl.dims);
  const dp = new ORT.Tensor('float32', Float32Array.from(j.style_dp.data.flat(Infinity)), j.style_dp.dims);
  const e = { ttl, dp };
  estilos.set(voz, e);
  return e;
}

/* ---------- texto ---------------------------------------------------- */
function preparar(texto, lang) {
  let t = String(texto || '').normalize('NFKD');
  t = t.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu, '');
  const trocas = { '–': '-', '‑': '-', '—': '-', '_': ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ',
    /* O Supertonic 3 entende marcas como <laugh>. Texto de livro não
       pode disparar isso por acaso. */
    '<': ' ', '>': ' ', '«': '"', '»': '"', '­': '', '​': '' };
  for (const [k, v] of Object.entries(trocas)) t = t.split(k).join(v);
  t = t.replace(/[♥☆♡©\\]/g, '');
  t = t.replace(/ ,/g, ',').replace(/ \./g, '.').replace(/ !/g, '!').replace(/ \?/g, '?').replace(/ ;/g, ';').replace(/ :/g, ':').replace(/ '/g, "'");
  while (t.includes('""')) t = t.replace('""', '"');
  while (t.includes("''")) t = t.replace("''", "'");
  /* Caracteres que o modelo não conhece viram espaço: um índice -1
     derrubaria a síntese do trecho inteiro. */
  let limpo = '';
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    if (cp < indexador.length && indexador[cp] >= 0) limpo += ch;
    else if (/\s/.test(ch)) limpo += ' ';
  }
  t = limpo.replace(/\s+/g, ' ').trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return '';
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(t)) t += '.';
  if (!IDIOMAS.includes(lang)) lang = 'na';
  return '<' + lang + '>' + t + '</' + lang + '>';
}

function pedacos(texto, max) {
  const paragrafos = texto.trim().split(/\n\s*\n+/).filter(p => p.trim());
  const saida = [];
  for (let p of paragrafos) {
    p = p.trim();
    const frases = p.split(/(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Sra\.|Dra\.|etc\.|vs\.|Inc\.|Ltd\.|Co\.|St\.)(?<!\b\p{Lu}\.)(?<=[.!?。！？])\s+/u);
    let atual = '';
    for (let f of frases) {
      while (f.length > max) {          /* frase gigante: corta em vírgula ou espaço */
        let corte = f.lastIndexOf(', ', max);
        if (corte < max * 0.4) corte = f.lastIndexOf(' ', max);
        if (corte < max * 0.4) corte = max;
        if (atual) { saida.push(atual.trim()); atual = ''; }
        saida.push(f.slice(0, corte + 1).trim());
        f = f.slice(corte + 1).trim();
      }
      if (atual.length + f.length + 1 <= max) atual += (atual ? ' ' : '') + f;
      else { if (atual) saida.push(atual.trim()); atual = f; }
    }
    if (atual) saida.push(atual.trim());
  }
  return saida;
}

/* ---------- síntese -------------------------------------------------- */
function mascara(tam, max) {
  const m = new Float32Array(max);
  for (let j = 0; j < Math.min(tam, max); j++) m[j] = 1;
  return m;
}

function ruido(n) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(1e-4, Math.random()), u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    a[i] = r * Math.cos(2 * Math.PI * u2);
    if (i + 1 < n) a[i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return a;
}

function cancelado(id) { return id <= cancelarTudoAte || cancelados.has(id); }

async function inferir(textoPreparado, est, passos, velocidade, id) {
  const cps = Array.from(textoPreparado);
  const T = cps.length;
  const ids = new BigInt64Array(T);
  for (let j = 0; j < T; j++) {
    const cp = cps[j].codePointAt(0);
    ids[j] = BigInt(cp < indexador.length ? indexador[cp] : -1);
  }
  const tIds = new ORT.Tensor('int64', ids, [1, T]);
  const tMask = new ORT.Tensor('float32', mascara(T, T), [1, 1, T]);

  let t = performance.now();
  const dur = await sessoes.dp.run({ text_ids: tIds, style_dp: est.dp, text_mask: tMask });
  let duracao = dur.duration.data[0] / velocidade;
  if (cancelado(id)) return null;

  const enc = await sessoes.enc.run({ text_ids: tIds, style_ttl: est.ttl, text_mask: tMask });
  const emb = enc.text_emb;
  medida.fixo += performance.now() - t;
  if (cancelado(id)) return null;

  const sr = cfg.ae.sample_rate;
  const bloco = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const amostras = Math.floor(duracao * sr);
  const L = Math.max(1, Math.floor((amostras + bloco - 1) / bloco));
  const lm = mascara(L, L);
  const tLm = new ORT.Tensor('float32', lm, [1, 1, L]);
  let xt = ruido(dim * L);
  const tTotal = new ORT.Tensor('float32', new Float32Array([passos]), [1]);

  t = performance.now();
  for (let passo = 0; passo < passos; passo++) {
    const r = await sessoes.ve.run({
      noisy_latent: new ORT.Tensor('float32', xt, [1, dim, L]),
      text_emb: emb, style_ttl: est.ttl, latent_mask: tLm, text_mask: tMask,
      current_step: new ORT.Tensor('float32', new Float32Array([passo]), [1]),
      total_step: tTotal
    });
    xt = r.denoised_latent.data instanceof Float32Array ? r.denoised_latent.data : Float32Array.from(r.denoised_latent.data);
    if (cancelado(id)) return null;
  }
  medida.passos += performance.now() - t; medida.n += passos;
  t = performance.now();
  const v = await sessoes.voc.run({ latent: new ORT.Tensor('float32', xt, [1, dim, L]) });
  const wav = v.wav_tts.data;
  medida.fixo += performance.now() - t;
  return wav.subarray(0, Math.min(wav.length, amostras));
}

function paraWav(amostras, sr) {
  const n = amostras.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const d = new DataView(buf);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) d.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  s(36, 'data'); d.setUint32(40, n * 2, true);
  const pcm = new Int16Array(buf, 44, n);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, amostras[i])); pcm[i] = x < 0 ? x * 32768 : x * 32767; }
  return buf;
}

async function sintetizar(msg) {
  const { id, texto, lang, voz, passos, velocidade } = msg;
  if (cancelado(id)) return { tipo: 'cancelado', id };
  const t0 = performance.now();
  medida = { fixo: 0, passos: 0, n: 0 };
  const est = await estilo(voz);
  const sr = cfg.ae.sample_rate;
  const max = (lang === 'ko' || lang === 'ja') ? 120 : 300;
  const partes = pedacos(String(texto || ''), max);
  const pausa = Math.floor(0.3 * sr), fim = Math.floor(0.22 * sr);
  const blocos = [];
  let total = 0;
  for (const p of partes) {
    const prep = preparar(p, lang);
    if (!prep) continue;
    const w = await inferir(prep, est, passos, velocidade, id);
    if (!w) return { tipo: 'cancelado', id };
    if (blocos.length) { blocos.push(new Float32Array(pausa)); total += pausa; }
    blocos.push(w); total += w.length;
  }
  if (!total) return { tipo: 'vazio', id };
  blocos.push(new Float32Array(fim)); total += fim;
  const tudo = new Float32Array(total);
  let o = 0;
  for (const b of blocos) { tudo.set(b, o); o += b.length; }
  const wav = paraWav(tudo, sr);
  return { tipo: 'audio', id, wav, duracao: total / sr, tempo: (performance.now() - t0) / 1000, backend,
    fixo: medida.fixo / 1000, porPasso: passos ? medida.passos / passos / 1000 : 0, transferir: [wav] };
}

self.onmessage = e => {
  const msg = e.data || {};
  if (msg.tipo === 'cancelar') {
    if (typeof msg.id === 'number') cancelados.add(msg.id);
    else if (typeof msg.ate === 'number') cancelarTudoAte = Math.max(cancelarTudoAte, msg.ate);
    return;
  }
  /* Uma coisa de cada vez: o ONNX Runtime não roda duas sessões em
     paralelo numa só linha, e a fila garante a ordem dos trechos. */
  fila = fila.then(async () => {
    try {
      if (msg.tipo === 'iniciar') {
        ultimoInicio = msg;
        const r = await iniciar(msg);
        self.postMessage({ tipo: 'pronto', backend: r.backend, threads: r.threads });
      } else if (msg.tipo === 'sintetizar') {
        if (!sessoes) throw new Error('motor-nao-iniciado');
        let r;
        try { r = await sintetizar(msg); }
        catch (err) {
          /* Algumas placas de vídeo aceitam o modelo e falham só na hora
             de rodar. Nesse caso, uma segunda chance no processador. */
          if (backend !== 'webgpu') throw err;
          await soltarSessoes();
          await iniciar({ ...ultimoInicio, preferirGpu: false });
          r = await sintetizar(msg);
        }
        const tr = r.transferir; delete r.transferir;
        self.postMessage(r, tr || []);
        cancelados.delete(msg.id);
      } else if (msg.tipo === 'soltar-estilos') {
        estilos.clear();
      }
    } catch (err) {
      self.postMessage({ tipo: 'erro', id: msg.id, pedido: msg.tipo, mensagem: String(err && err.message || err) });
    }
  });
};
