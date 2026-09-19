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
const VERSAO = 'veredas-2026-09-19-5';

const ESSENCIAIS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './epub-pdf-converter.js',
  './manifest.json',
  './logo.png',
  './icon-192x192.png',
  './icon-512x512.png'
];

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
  self.skipWaiting();
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.map(k => k !== VERSAO ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const req = evento.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;       /* CDN e afins: fora daqui */
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (req.headers.has('range')) return;                  /* áudio e vídeo pedem fatias */

  evento.respondWith(
    fetch(req)
      .then(resposta => {
        if (resposta && resposta.ok && resposta.type === 'basic') {
          const copia = resposta.clone();
          caches.open(VERSAO).then(c => c.put(req, copia)).catch(() => {});
        }
        return resposta;
      })
      .catch(() =>
        caches.match(req).then(guardado => {
          if (guardado) return guardado;
          /* Sem rede e sem cópia: se era uma navegação, devolve a
             própria página inicial, que está guardada. */
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        })
      )
  );
});

/* Permite que a página peça a troca imediata por uma versão nova. */
self.addEventListener('message', evento => {
  if (evento.data === 'atualizar-agora') self.skipWaiting();
});
