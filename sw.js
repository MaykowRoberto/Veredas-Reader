/* ============================================================
   SERVICE WORKER — Veredas Reader
   ------------------------------------------------------------
   A versão anterior guardava alguns arquivos no cache mas não
   tinha tratador de `fetch`. Na prática isso é o pior dos dois
   mundos: o aplicativo não funcionava offline de verdade e, ao
   mesmo tempo, ficava à mercê do cache comum do navegador — que
   no celular costuma segurar o `app.js` antigo por bastante
   tempo. Era possível publicar uma correção e o aparelho
   continuar rodando a versão de ontem.

   A estratégia agora é "rede primeiro, cache como rede de
   segurança":

     • toda requisição tenta a rede, então uma versão nova sempre
       chega assim que existe — nunca se lê algo velho tendo algo
       novo disponível;
     • o que volta da rede é guardado, então, sem internet, o
       aplicativo abre com a última versão que funcionou;
     • só o que vem deste mesmo endereço passa por aqui; o que
       vem de fora continua com o navegador.

   VERSAO precisa mudar a cada publicação: é o que limpa o cache
   antigo do aparelho.
   ============================================================ */
const VERSAO = 'veredas-2026-09-20-36';

const ESSENCIAIS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './epub-pdf-converter.js',
  './manifest.json',
  './logo.png',
  './icon-192x192.png',
  './icon-512x512.png',

  /* As bibliotecas agora moram aqui dentro. Sem estas linhas o
     aplicativo abriria offline mas não conseguiria desenhar um
     ícone, abrir um PDF nem ler um EPUB — que é o que acontecia
     quando elas vinham de um servidor de terceiros. */
  './vendor/lucide/lucide.min.js',
  './vendor/jszip/jszip.min.js',
  './vendor/pdfjs/pdf.min.js',
  './vendor/pdfjs/pdf.worker.min.js',
  './vendor/mammoth/mammoth.browser.min.js',

  /* As fontes. Sem elas o aplicativo abre offline mas volta a
     desenhar Roboto ou Segoe UI, e muda de cara justamente
     quando a pessoa está sem internet. São 120 KB no total. */
  './vendor/fontes/inter-variavel.woff2',
  './vendor/fontes/literata-400.woff2',
  './vendor/fontes/literata-400-italico.woff2',
  './vendor/fontes/literata-700.woff2',
  /* Os recortes cirílicos (*-cirilico.woff2, 53 KB) ficam de fora:
     só quem usa a interface em russo precisa deles, e a página pede
     para guardá-los pelo recado 'guardar-idiomas' lá embaixo. Um
     livro em russo aberto por quem usa outra língua também os busca,
     e aí o tratador de `fetch` os guarda. */

  /* O motor de idiomas e os dois arquivos que o aplicativo sempre
     precisa: o idioma da pessoa é carregado sob demanda, mas o
     inglês é a reserva de todos e o português é o original. */
  /* Sobre, Política de Privacidade e Termos de Uso (pt e en). */
  './sobre-politicas-e-termos/textos.js',

  './idioma.js',
  './idiomas/pt-BR.js',
  './idiomas/en.js',

  /* O trabalhador da voz natural (13 KB). O motor dele (ONNX Runtime,
     28 MB) e o modelo (380 MB) NÃO entram aqui: veja MOTOR abaixo. */
  './vendor/supertonic/voz-natural-worker.js'

  /* vendor/libarchive/libarchive-embutido.js fica de fora de
     propósito: são 1,4 MB que só fazem falta para CBR, CB7 e CBT.
     É buscado na primeira vez que alguém abre um desses e, a
     partir daí, o próprio tratador de `fetch` abaixo o guarda. */
];

/* O motor da voz natural (ONNX Runtime Web) mora num cache à parte,
   com a versão do próprio motor no nome. Ele não é apagado a cada
   publicação do aplicativo — seriam 28 MB baixados de novo a cada
   atualização — e só é guardado para quem baixou a voz natural
   (recado 'guardar-motor-de-voz'). O modelo em si fica no IndexedDB,
   fora do service worker. */
const MOTOR = 'veredas-motor-ort-1.30.0';
const PASTA_MOTOR = '/vendor/onnxruntime-web/';

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSAO).then(cache =>
      /* Um arquivo que falhe (um logo de tema que não existe, por
         exemplo) não pode derrubar a instalação inteira. */
      Promise.all(ESSENCIAIS.map(url =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
      ))
    )
  );
  /* Nada de `skipWaiting()` aqui.

     Assumir o controle na marra faz a página que está aberta passar
     a receber arquivos de uma versão diferente da que ela carregou —
     o `index.html` de ontem pedindo o `app.js` de hoje. Na primeira
     instalação não existe fila nenhuma para furar (a ativação é
     imediata de qualquer jeito), e numa atualização quem decide a
     hora é a página, pela mensagem `atualizar-agora` lá embaixo. */
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.map(k =>
        (k === VERSAO || k === MOTOR) ? null : caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ISOLAMENTO ENTRE ORIGENS
   A voz natural roda até 4x mais rápido quando o motor pode usar
   vários núcleos do processador — e o navegador só libera isso
   (SharedArrayBuffer) para páginas "isoladas", que chegam com os
   cabeçalhos COOP e COEP. O GitHub Pages não deixa configurar
   cabeçalhos, então é o service worker quem os acrescenta a tudo o
   que vem deste mesmo endereço.

   Não quebra nada do aplicativo: tudo o que ele carrega mora aqui
   dentro (vendor/), e o download da voz vem do Hugging Face por CORS,
   que o isolamento aceita. Vale a partir da segunda abertura — na
   primeira o service worker ainda não controla a página, e o motor
   simplesmente usa um núcleo só. */
function isolar(resposta) {
  if (!resposta || resposta.type === 'opaque' || resposta.type === 'error' || !resposta.status) return resposta;
  if ([101, 204, 205, 304].includes(resposta.status)) return resposta;
  try {
    const h = new Headers(resposta.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin');
    h.set('Cross-Origin-Embedder-Policy', 'require-corp');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(resposta.body, { status: resposta.status, statusText: resposta.statusText, headers: h });
  } catch (e) { return resposta; }
}

self.addEventListener('fetch', evento => {
  const req = evento.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;       /* CDN e afins: fora daqui */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (req.headers.has('range')) return;                  /* áudio e vídeo pedem fatias */

  /* Motor da voz natural: arquivos que nunca mudam dentro de uma
     versão. Cache primeiro; a rede só quando ainda não foi guardado. */
  if (url.pathname.includes(PASTA_MOTOR)) {
    evento.respondWith(
      caches.open(MOTOR).then(cache =>
        cache.match(req, { ignoreSearch: true }).then(guardado => guardado ? isolar(guardado) : fetch(req).then(resposta => {
          /* Só quem usa a voz natural chega a pedir estes arquivos:
             guardá-los aqui cobre quem baixou a voz na primeira
             visita, antes de o service worker assumir a página. */
          if (resposta && resposta.ok && resposta.type === 'basic') cache.put(req, resposta.clone()).catch(() => {});
          return isolar(resposta);
        }))
      )
    );
    return;
  }

  evento.respondWith(
    fetch(req)
      .then(resposta => {
        if (resposta && resposta.ok && resposta.type === 'basic') {
          const copia = resposta.clone();
          caches.open(VERSAO).then(c => c.put(req, copia)).catch(() => {});
        }
        return isolar(resposta);
      })
      .catch(() =>
        caches.match(req).then(guardado => {
          if (guardado) return isolar(guardado);
          /* Sem rede e sem cópia: se era uma navegação, devolve a
             própria página inicial, que está guardada. */
          if (req.mode === 'navigate') return caches.match('./index.html').then(isolar);
          return Response.error();
        })
      )
  );
});

/* Permite que a página peça a troca imediata por uma versão nova. */
self.addEventListener('message', evento => {
  if (evento.data === 'atualizar-agora') { self.skipWaiting(); return; }

  /* A página avisa qual idioma ela carregou, para guardarmos aquele
     arquivo.

     Por que não guardar os doze de uma vez na instalação: são uns
     600 KB, e cada pessoa usa um só. Por que não confiar no tratador
     de `fetch` abaixo: na PRIMEIRA visita o service worker ainda não
     controla a página, então o arquivo do idioma passa direto por ele
     e é guardado apenas pelo cache comum do navegador — que o sistema
     esvazia quando bem entende. Quem abrisse o aplicativo uma vez, em
     espanhol, e depois ficasse sem internet podia encontrar a
     interface em inglês.

     Com este recado, o idioma é guardado de verdade já na primeira
     visita. */
  if (evento.data && evento.data.tipo === 'guardar-motor-de-voz') {
    const urls = Array.isArray(evento.data.urls) ? evento.data.urls : [];
    evento.waitUntil(
      caches.open(MOTOR).then(cache =>
        Promise.all(urls.map(u =>
          cache.match(u).then(ja => ja ? null : cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))
        ))
      )
    );
    return;
  }

  if (evento.data && evento.data.tipo === 'guardar-idiomas') {
    const urls = Array.isArray(evento.data.urls) ? evento.data.urls : [];
    evento.waitUntil(
      caches.open(VERSAO).then(cache =>
        Promise.all(urls.map(u =>
          cache.match(u).then(ja => ja ? null : cache.add(new Request(u, { cache: 'reload' })).catch(() => {}))
        ))
      )
    );
  }
});
