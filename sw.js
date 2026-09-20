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
const VERSAO = 'veredas-2026-09-20-12';

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
  './vendor/mammoth/mammoth.browser.min.js'

  /* vendor/libarchive/libarchive-embutido.js fica de fora de
     propósito: são 1,4 MB que só fazem falta para CBR, CB7 e CBT.
     É buscado na primeira vez que alguém abre um desses e, a
     partir daí, o próprio tratador de `fetch` abaixo o guarda. */
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
