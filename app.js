/* ============================================================
   SERVICE WORKER PWA
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log("Service Worker registrado com sucesso."))
      .catch(err => console.error("Falha ao registrar Service Worker:", err));
  });
}

/* ============================================================
   DEPENDÊNCIAS
   ============================================================ */
lucide.createIcons();
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

/* ============================================================
   UTILS
   ============================================================ */
const Utils={
  id:()=>crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36),
  esc:s=>{const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML},
  toast:(msg,icon='check',id=null)=>{
    if(id){
      const ex=document.getElementById(id);
      if(ex){
        ex.innerHTML=`<i data-lucide="${icon}" style="width:15px;height:15px"></i><span>${Utils.esc(msg)}</span>`;
        lucide.createIcons({root:ex});
        return;
      }
    }
    const t=document.createElement('div');t.className='toast';if(id)t.id=id;
    t.innerHTML=`<i data-lucide="${icon}" style="width:15px;height:15px"></i><span>${Utils.esc(msg)}</span>`;
    document.getElementById('toast-wrap').appendChild(t);
    lucide.createIcons({root:t});
    setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .25s';setTimeout(()=>t.remove(),260)},3300);
  },
  debounce:(fn,wait)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}},
  clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),
  safeDecode:s=>{try{return decodeURIComponent(s)}catch{return s}},
  showLoader:(title,sub='',opts={})=>{
    const track=document.getElementById('loader-track');
    const pct=document.getElementById('loader-pct');
    const cancel=document.getElementById('loader-cancel');
    document.getElementById('loader-title').textContent=title;
    document.getElementById('loader-sub').textContent=sub;
    const showBar=!!opts.progress;
    track.classList.toggle('visible',showBar);
    pct.classList.toggle('visible',showBar);
    document.getElementById('loader-fill').style.width='0%';
    pct.textContent='0%';
    track.setAttribute('aria-valuenow','0');
    cancel.classList.toggle('visible',typeof opts.onCancel==='function');
    cancel.disabled=false;
    cancel.textContent='Cancelar';
    Utils.setLoaderMeta('');
    Utils._onCancel=opts.onCancel||null;
    document.getElementById('loader').classList.add('active');
  },
  /* Linha extra do loader: "12,4 MB de 24 MB · 1,8 MB/s · faltam ~7s". */
  setLoaderMeta:(text)=>{
    const el=document.getElementById('loader-meta');
    if(!el)return;
    el.textContent=text||'';
    el.classList.toggle('visible',!!text);
  },
  setLoaderText:(title,sub)=>{
    if(title!=null)document.getElementById('loader-title').textContent=title;
    if(sub!=null)document.getElementById('loader-sub').textContent=sub;
  },
  setLoaderProgress:(percent,sub)=>{
    const p=Utils.clamp(Math.round(percent),0,100);
    const fill=document.getElementById('loader-fill');
    const track=document.getElementById('loader-track');
    if(fill)fill.style.width=p+'%';
    if(track)track.setAttribute('aria-valuenow',String(p));
    const pct=document.getElementById('loader-pct');
    if(pct)pct.textContent=p+'%';
    if(sub!=null)document.getElementById('loader-sub').textContent=sub;
  },
  hideLoader:()=>{
    Utils._onCancel=null;
    Utils.setLoaderMeta('');
    const l=document.getElementById('loader');
    if(l)l.classList.remove('active');
    const c=document.getElementById('loader-cancel');
    if(c){c.classList.remove('visible');c.disabled=false;c.textContent='Cancelar'}
    const t=document.getElementById('loader-track');
    if(t)t.classList.remove('visible');
    const p=document.getElementById('loader-pct');
    if(p)p.classList.remove('visible');
  },
  _onCancel:null,
  /* Devolve o controle ao navegador para que a interface continue respondendo
     (e um quadro seja realmente pintado) durante tarefas longas. */
  yieldToUI:()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))),
  isAbort:e=>!!e&&(e.name==='AbortError'||e.message==='__abort__'),
  fmtBytes:n=>{
    if(!Number.isFinite(n))return '';
    const u=['B','KB','MB','GB'];let i=0;
    while(n>=1024&&i<u.length-1){n/=1024;i++}
    /* vírgula decimal: é assim que o número é lido em português */
    return `${n.toFixed(n<10&&i>0?1:0).replace('.',',')} ${u[i]}`;
  },
  normalizeBook:b=>({...b,
    tags:Array.isArray(b.tags)?b.tags:[],
    collections:Array.isArray(b.collections)?b.collections:[],
    bookmarks:Array.isArray(b.bookmarks)?b.bookmarks:[],
    annotations:Array.isArray(b.annotations)?b.annotations:[],
    status:b.status||'toread',
    series:b.series||'',
    folder:b.folder||'',
    favorite:!!b.favorite,
    order:Number.isFinite(b.order)?b.order:Date.now(),
    manualOrder:!!b.manualOrder
  }),
  normalizeType:t=>t==='notes'?'note':t==='quotes'?'quote':t==='bookmarks'?'bookmark':t
};
window.addEventListener('unhandledrejection',e=>{console.error(e.reason);Utils.hideLoader()});
window.addEventListener('error',e=>{console.error(e.error||e.message);Utils.hideLoader()});
document.getElementById('loader-cancel').addEventListener('click',e=>{
  if(typeof Utils._onCancel!=='function')return;
  e.currentTarget.disabled=true;
  e.currentTarget.textContent='Cancelando...';
  try{Utils._onCancel()}catch(err){console.error(err)}
});

/* ============================================================
   TRANSFERÊNCIA DE ARQUIVOS — "de onde vem" importa
   ------------------------------------------------------------
   Um arquivo escolhido no seletor nem sempre está no aparelho.
   No Android, o que vem do Google Drive (ou de qualquer provedor
   de nuvem) chega como um "atalho": só quando o aplicativo pede
   os bytes é que o download realmente começa — e isso pode levar
   minutos em um arquivo de 20 MB numa rede lenta.

   Até aqui o aplicativo pedia o arquivo inteiro de uma vez
   (file.arrayBuffer()), o que não dá nenhum sinal de vida: a tela
   ficava parada e parecia que nada estava acontecendo.

   A leitura passa a ser feita em pedaços (file.stream()), então
   sabemos exatamente quantos bytes já chegaram. Com isso dá para
   mostrar barra, quantidade, velocidade, tempo restante e um
   botão de cancelar de verdade.
   ============================================================ */
const FileTransfer={
  /* Acima disso não trazemos o arquivo inteiro para a memória. */
  MAX_LOCAL_COPY:700*1024*1024,
  PROBE_BYTES:128*1024,
  SLOW_MS:260,

  supportsStream(file){
    try{return !!file&&typeof file.stream==='function'}catch(e){return false}
  },
  /* Lê um naco pequeno e cronometra: arquivo local responde na hora,
     arquivo de nuvem demora. Serve para decidir se vale a pena avisar
     o usuário de que há um download em andamento. */
  async looksRemote(file){
    if(!file||!file.size)return false;
    const t0=performance.now();
    try{
      await file.slice(0,Math.min(FileTransfer.PROBE_BYTES,file.size)).arrayBuffer();
    }catch(e){return true}
    return (performance.now()-t0)>FileTransfer.SLOW_MS;
  },
  /* ArrayBuffer com progresso. Cai no método simples se o navegador
     não tiver streams — nunca deixa de importar por causa disso. */
  async toBuffer(file,{onProgress=null,signal=null}={}){
    const total=Number(file.size)||0;
    if(!FileTransfer.supportsStream(file)||!total){
      if(onProgress)onProgress(0,total);
      const buf=await file.arrayBuffer();
      if(onProgress)onProgress(total||buf.byteLength,total||buf.byteLength);
      return buf;
    }
    let reader;
    try{reader=file.stream().getReader()}
    catch(e){return file.arrayBuffer()}
    const chunks=[];
    let loaded=0;
    try{
      for(;;){
        if(signal&&signal.aborted){
          try{await reader.cancel()}catch(e){}
          throw new DOMException('Cancelado','AbortError');
        }
        const {done,value}=await reader.read();
        if(done)break;
        chunks.push(value);
        loaded+=value.byteLength;
        if(onProgress)onProgress(loaded,total);
      }
    }catch(err){
      if(Utils.isAbort(err))throw err;
      console.warn('Leitura em pedaços falhou; usando a leitura direta.',err);
      return file.arrayBuffer();
    }
    const out=new Uint8Array(loaded);
    let offset=0;
    for(const c of chunks){out.set(c,offset);offset+=c.byteLength}
    return out.buffer;
  },
  /* Cópia local do arquivo (usada em áudio e vídeo, que ficam guardados
     como Blob). Depois disso, ler pedaços é instantâneo. */
  async localCopy(file,{onProgress=null,signal=null}={}){
    const buffer=await FileTransfer.toBuffer(file,{onProgress,signal});
    const copy=new File([buffer],file.name,{type:file.type||'',lastModified:file.lastModified||Date.now()});
    return copy;
  }
};

/* Mostra o andamento de uma transferência de um jeito que faça sentido
   para quem está olhando: quanto já veio, quão rápido e quanto falta. */
class TransferMeter{
  constructor(name,total,{mode='bar',prefix=''}={}){
    this.name=name||'Arquivo';
    this.total=Number(total)||0;
    this.mode=mode;                 /* 'bar' usa a barra; 'text' só a legenda */
    this.prefix=prefix;
    this.t0=performance.now();
    this.loaded=0;this.lastPaint=0;this.announced=false;
  }
  update(loaded){
    this.loaded=loaded;
    const now=performance.now();
    const elapsed=(now-this.t0)/1000;
    const complete=this.total>0&&loaded>=this.total;
    /* Passou de meio segundo e ainda falta arquivo? Então é download. */
    if(!this.announced&&elapsed>0.55&&this.total&&loaded<this.total*0.92){
      this.announced=true;
      if(this.mode==='bar'){
        Utils.setLoaderText('Baixando o arquivo','O arquivo está vindo do armazenamento em nuvem para o seu aparelho.');
      }
    }
    if(!complete&&now-this.lastPaint<130)return;
    this.lastPaint=now;
    const rate=elapsed>0.3?loaded/elapsed:0;
    const left=rate>0&&this.total>loaded?(this.total-loaded)/rate:0;
    const bits=[];
    if(this.total)bits.push(`${Utils.fmtBytes(loaded)} de ${Utils.fmtBytes(this.total)}`);
    else bits.push(Utils.fmtBytes(loaded));
    if(rate>0&&!complete)bits.push(`${Utils.fmtBytes(rate)}/s`);
    if(left>1.5&&!complete)bits.push(`faltam ~${AudioFmt.long(left)}`);
    const line=bits.join(' · ');
    if(this.mode==='bar'){
      const pct=this.total?Utils.clamp((loaded/this.total)*100,0,100):0;
      Utils.setLoaderProgress(pct,null);
      Utils.setLoaderMeta(line);
    }else{
      Utils.setLoaderText(null,`${this.prefix}${this.name} — ${line}`);
    }
  }
  /* Devolve a função pronta para entregar a quem faz a leitura. */
  handler(){return (loaded)=>this.update(loaded)}
  finish(){if(this.mode==='bar')Utils.setLoaderMeta('')}
}

/* ============================================================
   DB
   ============================================================ */
class DBManager{
  constructor(){this.dbName='LuminaEngineDB';this.version=3}
  async init(){
    return new Promise((resolve,reject)=>{
      const r=indexedDB.open(this.dbName,this.version);
      r.onupgradeneeded=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains('books'))db.createObjectStore('books',{keyPath:'id'});
        if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'id'});
        if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'id'});
        if(!db.objectStoreNames.contains('pagecache'))db.createObjectStore('pagecache',{keyPath:'key'});
      };
      r.onsuccess=e=>{this.db=e.target.result;resolve()};
      r.onerror=e=>reject(e.target.error);
    });
  }
  _exec(storeName,mode,cb){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(storeName,mode);
      const store=tx.objectStore(storeName);
      const req=cb(store);
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }
  async saveBook(meta,buffer){
    await this._exec('books','readwrite',s=>s.put(Utils.normalizeBook(meta)));
    await this._exec('files','readwrite',s=>s.put({id:meta.id,buffer}));
  }
  /* Audiolivro: o arquivo entra como Blobs (não como ArrayBuffer) e o livro
     e o arquivo são gravados na MESMA transação — ou entra tudo, ou nada. */
  async saveAudioBook(meta,blobs){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['books','files'],'readwrite');
      tx.objectStore('books').put(Utils.normalizeBook(meta));
      tx.objectStore('files').put({id:meta.id,kind:'audio',blobs});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('Gravação cancelada.'));
    });
  }
  /* Quadrinho: o pacote de imagens é grande demais para virar um
     ArrayBuffer na memória a cada abertura, então ele é guardado como
     Blob (o navegador cuida de mantê-lo em disco) — livro e arquivo
     na MESMA transação, como no audiolivro. */
  async saveComicBook(meta,blob){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['books','files'],'readwrite');
      tx.objectStore('books').put(Utils.normalizeBook(meta));
      tx.objectStore('files').put({id:meta.id,kind:'comic',blob});
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('Gravação cancelada.'));
    });
  }
  /* Leitura + alteração + gravação numa transação só. Quem só quer mexer em
     alguns campos usa isto em vez de regravar o livro inteiro: assim o player
     (progresso) e a estante (título, status, ordem) nunca se sobrescrevem. */
  patchBook(id,change){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction('books','readwrite');
      const store=tx.objectStore('books');
      let saved=null;
      const get=store.get(id);
      get.onsuccess=()=>{
        if(!get.result)return;
        const cur=Utils.normalizeBook(get.result);
        saved=typeof change==='function'?(change(cur)||cur):Object.assign(cur,change);
        store.put(Utils.normalizeBook(saved));
      };
      tx.oncomplete=()=>resolve(saved);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('Gravação cancelada.'));
    });
  }
  async getBooks(){
    const list=await this._exec('books','readonly',s=>s.getAll());
    return list.map(Utils.normalizeBook);
  }
  async getBook(id){
    const b=await this._exec('books','readonly',s=>s.get(id));
    return b?Utils.normalizeBook(b):null;
  }
  async getFile(id){return this._exec('files','readonly',s=>s.get(id))}
  async updateBook(book){return this._exec('books','readwrite',s=>s.put(Utils.normalizeBook(book)))}
  async addBookmark(id,bm){
    const b=await this.getBook(id);
    if(!b)return null;
    const key=bm.globalPage!=null?`g:${bm.globalPage}`:`c:${bm.chapter}:${bm.pageIndex}`;
    const exists=b.bookmarks.find(x=>(x.globalPage!=null?`g:${x.globalPage}`:`c:${x.chapter}:${x.pageIndex}`)===key);
    if(exists){
      b.bookmarks=b.bookmarks.filter(x=>x!==exists);
      await this.updateBook(b);
      return false;
    }
    b.bookmarks.push({...bm,addedAt:Date.now(),id:Utils.id()});
    await this.updateBook(b);
    return true;
  }
  async deleteBookmark(id, bmId){
    const b=await this.getBook(id);
    if(!b)return;
    b.bookmarks=b.bookmarks.filter(x=>x.id!==bmId);
    await this.updateBook(b);
  }
  async addAnnotation(id,a){
    const b=await this.getBook(id);
    if(!b)return;
    b.annotations.push({...a,type:Utils.normalizeType(a.type),id:Utils.id(),createdAt:Date.now()});
    await this.updateBook(b);
  }
  async deleteAnnotation(id,aid){
    const b=await this.getBook(id);
    if(!b)return;
    b.annotations=b.annotations.filter(a=>a.id!==aid);
    await this.updateBook(b);
  }
  async updateNote(id, aid, newText){
    const b=await this.getBook(id);
    if(!b)return;
    const ann=b.annotations.find(a=>a.id===aid);
    if(ann){ann.note=newText; await this.updateBook(b);}
  }
  async deleteBook(id){
    return new Promise((resolve,reject)=>{
      const tx=this.db.transaction(['books','files','pagecache'],'readwrite');
      tx.objectStore('books').delete(id);
      tx.objectStore('files').delete(id);
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
    });
  }
  async saveSettings(s){return this._exec('settings','readwrite',st=>st.put({...s,id:'global'}))}
  async getSettings(){
    return this._exec('settings','readonly',s=>s.get('global')).then(s=>({...AppDefaults.settings,...(s||{})}));
  }
  async getPageCache(key){return this._exec('pagecache','readonly',s=>s.get(key))}
  async setPageCache(key,data){return this._exec('pagecache','readwrite',s=>s.put({key,...data,createdAt:Date.now()}))}
  async clearBookCache(bookId){
    const all=await this._exec('pagecache','readonly',s=>s.getAll());
    const tx=this.db.transaction('pagecache','readwrite');
    const store=tx.objectStore('pagecache');
    all.filter(c=>c.key.startsWith(`${bookId}__`)).forEach(c=>store.delete(c.key));
    return new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
  }
}

const AppDefaults={settings:{
  theme:'light',fontFamily:"'Merriweather',serif",fontSize:18,lineHeight:1.65,margin:6,brightness:100,
  readerBg:'',readerText:'',orientation:'auto',sort:'custom',groupAuthors:true,
  readingMode:'auto',pdfReadingMode:'vertical',pdfZoom:1,ttsRate:1,ttsVoiceURI:'',pageTurn:'curl',
  audioSpeed:1,audioSkipBack:15,audioSkipForward:30,audioSmartRewind:true,audioAutoplay:true,audioScope:'chapter',audioVolume:1,
  comicFit:'page',comicSpread:true,comicRtl:false,
  consent:null,scanInvited:false,scrollPerBook:false
}};

/* ============================================================
   FORMATOS DE LIVRO
   ------------------------------------------------------------
   Um lugar só para responder: quais extensões o aplicativo abre,
   como cada uma se chama na tela, qual ícone usa e em que sentido
   ela rola por padrão. Acrescentar um formato novo é acrescentar
   uma linha aqui.
   ============================================================ */
const BookFormats={
  TEXT:['epub','pdf','txt','md','docx','mobi','cbz','cbr','cb7','cbt'],
  /* Quadrinhos: um pacote de imagens em sequência. Abrem num leitor
     próprio (ComicEngine), não na paginação de texto. */
  COMIC:['cbz','cbr','cb7','cbt'],
  /* Extensões alternativas que apontam para o mesmo formato.
     `.prc` é o nome antigo do contêiner do Mobipocket: é um MOBI com
     outro sobrenome, e muita gente tem a biblioteca inteira assim. */
  ALIASES:{markdown:'md',mkd:'md',mdown:'md',mdtext:'md',text:'txt',prc:'mobi'},
  INFO:{
    epub:{label:'EPUB',icon:'book-open',scroll:'horizontal',mime:'application/epub+zip',share:false},
    mobi:{label:'MOBI',icon:'book',scroll:'horizontal',mime:'application/x-mobipocket-ebook',share:false},
    txt:{label:'TXT',icon:'file-text',scroll:'horizontal',mime:'text/plain',share:true},
    md:{label:'MD',icon:'file-code-2',scroll:'horizontal',mime:'text/markdown',share:true},
    pdf:{label:'PDF',icon:'file-type-2',scroll:'vertical',mime:'application/pdf',share:true},
    docx:{label:'DOCX',icon:'file-text',scroll:'vertical',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',share:true},
    cbz:{label:'CBZ',icon:'book-image',scroll:'horizontal',mime:'application/vnd.comicbook+zip',share:false,comic:true},
    cbr:{label:'CBR',icon:'book-image',scroll:'horizontal',mime:'application/vnd.comicbook-rar',share:false,comic:true},
    cb7:{label:'CB7',icon:'book-image',scroll:'horizontal',mime:'application/x-cb7',share:false,comic:true},
    cbt:{label:'CBT',icon:'book-image',scroll:'horizontal',mime:'application/x-cbt',share:false,comic:true},
    mp3:{label:'MP3',icon:'headphones',scroll:null,mime:'audio/mpeg',share:false},
    m4b:{label:'M4B',icon:'headphones',scroll:null,mime:'audio/mp4',share:false},
    mp4:{label:'MP4',icon:'film',scroll:null,mime:'video/mp4',share:false}
  },
  /* ordem em que os grupos aparecem quando a estante é agrupada por tipo */
  GROUP_ORDER:['epub','mobi','pdf','docx','txt','md','cbz','cbr','cb7','cbt','mp3','m4b','mp4'],
  ext(name){
    const raw=(String(name||'').split('.').pop()||'').toLowerCase();
    return BookFormats.ALIASES[raw]||raw;
  },
  /* aceita tanto "livro.md" quanto "markdown" */
  normalize(value){
    const v=String(value||'').toLowerCase().trim();
    if(v.includes('.'))return BookFormats.ext(v);
    return BookFormats.ALIASES[v]||v;
  },
  isText:f=>BookFormats.TEXT.includes(BookFormats.normalize(f)),
  /* Quadrinho? Aceita tanto a extensão quanto o próprio livro. */
  isComic:f=>{
    const n=BookFormats.normalize(f&&f.format!==undefined?f.format:f);
    return BookFormats.COMIC.includes(n);
  },
  isSupported:f=>{
    const n=BookFormats.normalize(f);
    return BookFormats.TEXT.includes(n)||Object.prototype.hasOwnProperty.call(AUDIO_FORMATS,n);
  },
  info:f=>BookFormats.INFO[BookFormats.normalize(f)]||null,
  label:f=>(BookFormats.info(f)||{}).label||String(f||'').toUpperCase()||'Outro',
  icon:f=>(BookFormats.info(f)||{}).icon||'file',
  mime:f=>(BookFormats.info(f)||{}).mime||'application/octet-stream',
  canShare:f=>!!(BookFormats.info(f)||{}).share,
  /* Sentido de rolagem que cada formato usa quando o leitor ainda não
     escolheu nada para AQUELE livro. */
  defaultScroll:f=>(BookFormats.info(f)||{}).scroll||'horizontal',
  /* Nome amigável do grupo na estante agrupada por tipo. */
  groupName(f){
    const n=BookFormats.normalize(f);
    const names={epub:'EPUB',mobi:'MOBI',pdf:'PDF',docx:'Word (DOCX)',txt:'Texto (TXT)',
      md:'Markdown (MD)',cbz:'Quadrinho (CBZ)',cbr:'Quadrinho (CBR)',cb7:'Quadrinho (CB7)',
      cbt:'Quadrinho (CBT)',mp3:'Audiolivro (MP3)',m4b:'Audiolivro (M4B)',mp4:'Vídeo (MP4)'};
    return names[n]||(n?n.toUpperCase():'Outros');
  },
  groupRank(f){
    const i=BookFormats.GROUP_ORDER.indexOf(BookFormats.normalize(f));
    return i<0?BookFormats.GROUP_ORDER.length:i;
  },
  /* Lista para o atributo accept e para o seletor avançado. */
  acceptList(){
    return ['.epub','.pdf','.txt','.md','.markdown','.docx','.mobi','.prc',
      '.cbz','.cbr','.cb7','.cbt','.mp3','.m4b','.mp4'];
  }
};

/* ============================================================
   DOCX & MOBI PARSERS
   ============================================================ */

/* Erro com mensagem legível + dica de como resolver. */
class ParseError extends Error{
  constructor(message,hint){super(message);this.name='ParseError';this.hint=hint||''}
}

const DocUtils={
  /* Converte qualquer <a ...>...</a> em <span>...</span>, preservando o
     conteúdo mas descartando href/onclick/target — sem isso, um link real
     dentro do livro navega o navegador para fora do app ao ser tocado. */
  stripLinks(html){
    return String(html).replace(/<a\b[^>]*>/gi,'<span>').replace(/<\/a>/gi,'</span>');
  },
  notice(title,text){
    return `<div class="doc-notice"><strong>${Utils.esc(title)}</strong>${Utils.esc(text)}</div>`;
  },
  hasMarkup(s){return /<\s*(p|div|h[1-6]|br|img|body|html|span|font|blockquote)\b/i.test(s)},
  /* Quebra um documento longo em capítulos usando títulos e quebras de página.
     Sempre devolve pelo menos um capítulo. */
  splitChapters(html,fallbackTitle){
    const host=document.createElement('div');
    host.innerHTML=html;
    const nodes=Array.from(host.childNodes);
    const chapters=[];
    let cur=null;
    const push=(title)=>{cur={title:title||fallbackTitle,parts:[]};chapters.push(cur)};
    push(fallbackTitle);
    for(const node of nodes){
      const isEl=node.nodeType===1;
      const isBreak=isEl&&node.hasAttribute('data-doc-break');
      const isHeading=isEl&&/^H[12]$/.test(node.tagName)&&node.textContent.trim().length<=140;
      if((isBreak||isHeading)&&chapters.length<DocUtils.MAX_CHAPTERS){
        const hasContent=cur&&cur.parts.join('').replace(/<[^>]*>/g,'').trim().length>0;
        if(hasContent)push(isHeading?node.textContent.trim():'');
        else if(isHeading&&cur)cur.title=node.textContent.trim()||cur.title;
      }
      if(isBreak)continue;
      cur.parts.push(node.nodeType===3?Utils.esc(node.textContent):(isEl?node.outerHTML:''));
    }
    /* junta capítulos muito curtos ao anterior para a lista não virar ruído */
    const merged=[];
    for(const ch of chapters){
      const html=ch.parts.join('');
      const len=html.replace(/<[^>]*>/g,'').trim().length;
      if(!len&&!merged.length)continue;
      if(merged.length&&len<DocUtils.MIN_CHAPTER_CHARS){
        merged[merged.length-1].html+=html;
      }else{
        merged.push({title:ch.title||fallbackTitle,html});
      }
    }
    if(!merged.length)merged.push({title:fallbackTitle,html:html||'<p></p>'});
    return merged;
  }
};
DocUtils.MAX_CHAPTERS=400;
DocUtils.MIN_CHAPTER_CHARS=600;

/* ------------------------------------------------------------
   DOCX
   ------------------------------------------------------------ */
class DOCXParser{
  static async parse(buffer,opts={}){
    const onProgress=opts.onProgress||(()=>{});
    if(typeof mammoth==='undefined'||!mammoth||typeof mammoth.convertToHtml!=='function'){
      throw new ParseError('O conversor de DOCX não carregou.','Conecte-se à internet uma vez para baixar o componente e abra o livro novamente.');
    }
    onProgress('Convertendo o documento',.1);
    let budget=DOCXParser.IMAGE_BUDGET;
    const options={styleMap:DOCXParser.STYLE_MAP};
    if(mammoth.images&&typeof mammoth.images.imgElement==='function'){
      options.convertImage=mammoth.images.imgElement(async image=>{
        try{
          if(budget<=0)return{src:''};
          const b64=await image.read('base64');
          const bytes=Math.ceil(b64.length*0.75);
          if(bytes>DOCXParser.MAX_IMAGE||bytes>budget)return{src:''};
          budget-=bytes;
          return{src:`data:${image.contentType||'image/png'};base64,${b64}`};
        }catch(e){return{src:''}}
      });
    }
    let result;
    try{
      result=await mammoth.convertToHtml({arrayBuffer:buffer},options);
    }catch(e){
      console.error(e);
      throw new ParseError('Não foi possível ler este arquivo DOCX.','O arquivo pode estar corrompido, protegido por senha ou ser um .doc antigo. Salve-o novamente como .docx e importe de novo.');
    }
    onProgress('Organizando o texto',.85);
    let html=String((result&&result.value)||'').trim();
    html=html.replace(/<img[^>]*src\s*=\s*(""|'')[^>]*>/gi,'');
    html=DocUtils.stripLinks(html);
    if(!html){
      html=DocUtils.notice('Documento sem texto','Este arquivo .docx não tem conteúdo de texto que possa ser exibido.');
    }
    return html;
  }
}
DOCXParser.MAX_IMAGE=700*1024;
DOCXParser.IMAGE_BUDGET=4*1024*1024;
DOCXParser.STYLE_MAP=[
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Título'] => h1:fresh",
  "p[style-name='Título 1'] => h1:fresh",
  "p[style-name='Título 2'] => h2:fresh",
  "p[style-name='Título 3'] => h3:fresh"
];

/* ------------------------------------------------------------
   MOBI — descompactação HUFF/CDIC
   ------------------------------------------------------------ */
class MobiHuffman{
  constructor(){this.dict1=null;this.minCode=null;this.maxCode=null;this.dictionary=[]}
  static tag(rec,n=4){
    let s='';for(let i=0;i<n;i++)s+=String.fromCharCode(rec[i]||0);return s;
  }
  loadHuff(rec){
    if(!rec||rec.length<24||MobiHuffman.tag(rec)!=='HUFF')throw new ParseError('Tabela de compressão MOBI inválida.','');
    const dv=new DataView(rec.buffer,rec.byteOffset,rec.byteLength);
    const off1=dv.getUint32(8,false),off2=dv.getUint32(12,false);
    if(off1+1024>rec.length||off2+256>rec.length)throw new ParseError('Tabela de compressão MOBI incompleta.','');
    this.dict1=new Array(256);
    for(let i=0;i<256;i++){
      const v=dv.getUint32(off1+i*4,false);
      const codelen=v&0x1F,term=(v&0x80)!==0,maxcode=v>>>8;
      if(codelen===0)throw new ParseError('Tabela de compressão MOBI corrompida.','');
      this.dict1[i]={codelen,term,maxcode:(maxcode+1)*Math.pow(2,32-codelen)-1};
    }
    const dict2=new Array(64);
    for(let i=0;i<64;i++)dict2[i]=dv.getUint32(off2+i*4,false);
    const mins=[0],maxs=[0];
    for(let i=0;i<64;i+=2)mins.push(dict2[i]);
    for(let i=1;i<64;i+=2)maxs.push(dict2[i]);
    this.minCode=mins.map((m,cl)=>m*Math.pow(2,32-cl));
    this.maxCode=maxs.map((m,cl)=>(m+1)*Math.pow(2,32-cl)-1);
    this.dictionary=[];
  }
  loadCdic(rec){
    if(!rec||rec.length<16||MobiHuffman.tag(rec)!=='CDIC')return;
    const dv=new DataView(rec.buffer,rec.byteOffset,rec.byteLength);
    const phrases=dv.getUint32(8,false),bits=dv.getUint32(12,false);
    if(bits>16)return;
    const n=Math.max(0,Math.min(1<<bits,phrases-this.dictionary.length));
    for(let i=0;i<n;i++){
      const at=16+i*2;
      if(at+2>rec.length)break;
      const off=dv.getUint16(at,false);
      if(16+off+2>rec.length)break;
      const blen=dv.getUint16(16+off,false);
      const len=blen&0x7FFF;
      const s=18+off;
      if(s+len>rec.length)break;
      this.dictionary.push({data:rec.subarray(s,s+len),decoded:(blen&0x8000)!==0,busy:false});
    }
  }
  unpack(data,depth=0){
    if(depth>12)throw new ParseError('Arquivo MOBI corrompido.','');
    const total=data.length;
    const out=[];
    let bitsleft=total*8,bitPos=0,guard=0;
    const peek=bp=>{
      const byte=bp>>3,sh=bp&7;
      const b0=byte<total?data[byte]:0;
      const b1=byte+1<total?data[byte+1]:0;
      const b2=byte+2<total?data[byte+2]:0;
      const b3=byte+3<total?data[byte+3]:0;
      const b4=byte+4<total?data[byte+4]:0;
      const big=(b0*16777216+b1*65536+b2*256+b3)*256+b4;
      return Math.floor(big/Math.pow(2,8-sh))%4294967296;
    };
    while(bitsleft>0){
      if(++guard>8000000)break;
      const code=peek(bitPos);
      const e=this.dict1[Math.floor(code/16777216)];
      if(!e)break;
      let codelen=e.codelen,maxcode=e.maxcode;
      if(!e.term){
        while(codelen<=32&&code<this.minCode[codelen])codelen++;
        if(codelen>32)break;
        maxcode=this.maxCode[codelen];
      }
      bitPos+=codelen;bitsleft-=codelen;
      if(bitsleft<0)break;
      const r=Math.floor((maxcode-code)/Math.pow(2,32-codelen));
      const entry=this.dictionary[r];
      if(!entry)break;
      if(!entry.decoded){
        if(entry.busy)break;
        entry.busy=true;
        const sub=this.unpack(entry.data,depth+1);
        entry.data=sub;entry.decoded=true;entry.busy=false;
      }
      out.push(entry.data);
    }
    let len=0;for(const s of out)len+=s.length;
    const res=new Uint8Array(len);
    let p=0;for(const s of out){res.set(s,p);p+=s.length}
    return res;
  }
}

/* ------------------------------------------------------------
   MOBI — leitura do contêiner Palm Database
   ------------------------------------------------------------ */
class MobiFile{
  constructor(buffer){
    this.buffer=buffer;
    this.u8=new Uint8Array(buffer);
    this.dv=new DataView(buffer);
    this.exth=null;
    this.fullName='';
    this.codepage=1252;
    this.extraFlags=0;
    this.firstImage=0;
    this.huffOffset=0;
    this.huffCount=0;
    this.fileVersion=0;
  }
  static signature(buffer){
    try{
      const u8=new Uint8Array(buffer,60,8);
      let s='';for(let i=0;i<8;i++)s+=String.fromCharCode(u8[i]);
      return s;
    }catch(e){return ''}
  }
  static isMobi(buffer){
    const s=MobiFile.signature(buffer);
    return s==='BOOKMOBI'||s==='TEXtREAd';
  }
  record(i){
    if(i<0||i>=this.numRecords)return new Uint8Array(0);
    const start=this.offsets[i];
    const end=i+1<this.numRecords?this.offsets[i+1]:this.buffer.byteLength;
    if(!(start>=0&&end<=this.buffer.byteLength&&start<end))return new Uint8Array(0);
    return this.u8.subarray(start,end);
  }
  decodeBytes(bytes){
    if(!bytes||!bytes.length)return '';
    const label=this.codepage===65001?'utf-8':'windows-1252';
    try{return new TextDecoder(label).decode(bytes)}
    catch(e){
      try{return new TextDecoder('utf-8').decode(bytes)}
      catch(e2){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return s}
    }
  }
  readHeader(){
    const dv=this.dv,len=this.buffer.byteLength;
    if(len<80)throw new ParseError('Arquivo MOBI incompleto.','O download parece ter sido interrompido. Baixe o arquivo novamente.');
    this.signature=MobiFile.signature(this.buffer);
    this.numRecords=dv.getUint16(76,false);
    if(!this.numRecords||78+this.numRecords*8>len){
      throw new ParseError('Arquivo MOBI corrompido.','A lista interna de registros está incompleta. Tente baixar ou converter o arquivo novamente.');
    }
    this.offsets=new Array(this.numRecords);
    for(let i=0;i<this.numRecords;i++)this.offsets[i]=dv.getUint32(78+i*8,false);
    const r0=this.rec0=this.offsets[0];
    if(r0+16>len)throw new ParseError('Arquivo MOBI corrompido.','O cabeçalho do livro não pôde ser lido.');
    this.compression=dv.getUint16(r0,false);
    this.textLength=dv.getUint32(r0+4,false);
    this.textRecordCount=dv.getUint16(r0+8,false);
    this.recordSize=dv.getUint16(r0+10,false);
    this.encryption=dv.getUint16(r0+12,false);
    let magic='';
    for(let i=16;i<20;i++)magic+=String.fromCharCode(this.u8[r0+i]||0);
    this.isMobiHeader=magic==='MOBI';
    if(this.isMobiHeader&&r0+132<=len){
      this.mobiHeaderLength=dv.getUint32(r0+20,false);
      this.mobiType=dv.getUint32(r0+24,false);
      const cp=dv.getUint32(r0+28,false);
      if(cp===65001||cp===1252)this.codepage=cp;
      this.fileVersion=dv.getUint32(r0+36,false);
      const nameOff=dv.getUint32(r0+84,false);
      const nameLen=dv.getUint32(r0+88,false);
      this.firstImage=dv.getUint32(r0+108,false);
      if(!(this.firstImage>0&&this.firstImage<this.numRecords))this.firstImage=0;
      this.huffOffset=dv.getUint32(r0+112,false);
      this.huffCount=dv.getUint32(r0+116,false);
      this.exthFlags=dv.getUint32(r0+128,false);
      if(this.mobiHeaderLength>=0xE4&&r0+244<=len)this.extraFlags=dv.getUint16(r0+242,false);
      if(nameLen>0&&nameLen<2048&&r0+nameOff+nameLen<=len){
        this.fullName=this.decodeBytes(this.u8.subarray(r0+nameOff,r0+nameOff+nameLen)).replace(/\0+$/,'').trim();
      }
      if(this.exthFlags&0x40)this.readExth(r0+16+this.mobiHeaderLength);
    }
    return this;
  }
  readExth(off){
    const dv=this.dv,len=this.buffer.byteLength;
    if(off+12>len)return;
    let magic='';for(let i=0;i<4;i++)magic+=String.fromCharCode(this.u8[off+i]||0);
    if(magic!=='EXTH')return;
    const count=dv.getUint32(off+8,false);
    if(count>1024)return;
    this.exth={};
    let p=off+12;
    for(let i=0;i<count&&p+8<=len;i++){
      const type=dv.getUint32(p,false);
      const size=dv.getUint32(p+4,false);
      if(size<8||p+size>len)break;
      if(this.exth[type]===undefined)this.exth[type]=this.u8.subarray(p+8,p+size);
      p+=size;
    }
  }
  metaTitle(){
    const t=this.exth&&(this.exth[503]||this.exth[99]);
    const s=t?this.decodeBytes(t).trim():'';
    return s||this.fullName||'';
  }
  metaAuthor(){
    const a=this.exth&&this.exth[100];
    return a?this.decodeBytes(a).replace(/\0+$/,'').trim():'';
  }
  imageRecord(recindex){
    if(!this.firstImage||!recindex)return null;
    return this.record(this.firstImage+recindex-1);
  }
  static imageDataUrl(rec){
    if(!rec||rec.length<8||rec.length>MobiFile.MAX_IMAGE)return null;
    let mime='';
    if(rec[0]===0xFF&&rec[1]===0xD8)mime='image/jpeg';
    else if(rec[0]===0x89&&rec[1]===0x50)mime='image/png';
    else if(rec[0]===0x47&&rec[1]===0x49)mime='image/gif';
    else return null;
    try{return `data:${mime};base64,${EPUBParser.uint8ToBase64(rec)}`}
    catch(e){return null}
  }
  coverDataUrl(){
    try{
      if(!this.exth)return null;
      for(const key of [201,203]){
        const raw=this.exth[key];
        if(!raw||raw.length<4)continue;
        const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);
        const idx=dv.getUint32(0,false);
        if(idx===0xFFFFFFFF)continue;
        const url=MobiFile.imageDataUrl(this.imageRecord(idx+1));
        if(url)return url;
      }
      /* sem EXTH de capa: usa a primeira imagem do livro */
      for(let i=1;i<=8;i++){
        const url=MobiFile.imageDataUrl(this.imageRecord(i));
        if(url)return url;
      }
      return null;
    }catch(e){return null}
  }
  /* Tamanho da "trailing data entry" gravada no fim de cada registro de texto. */
  static trailingSize(rec,end){
    let bitpos=0,result=0,size=end;
    if(size<=0)return 0;
    for(;;){
      size--;
      if(size<0)return result;
      const b=rec[size];
      result|=(b&0x7F)<<bitpos;
      if(b&0x80)return result;
      bitpos+=7;
      if(bitpos>=28||size===0)return result;
    }
  }
  trimRecord(rec){
    let end=rec.length;
    let flags=this.extraFlags>>>1;
    while(flags){
      if(flags&1){
        end-=MobiFile.trailingSize(rec,end);
        if(end<=0)return rec.subarray(0,0);
      }
      flags>>>=1;
    }
    if(this.extraFlags&1){
      if(end<=0)return rec.subarray(0,0);
      end-=(rec[end-1]&0x3)+1;
    }
    return rec.subarray(0,Math.max(0,end));
  }
  static lz77(input,out,pos,cap){
    const n=input.length;
    let i=0;
    while(i<n&&pos<cap){
      const c=input[i++];
      if(c>=1&&c<=8){
        for(let k=0;k<c&&i<n&&pos<cap;k++)out[pos++]=input[i++];
      }else if(c<128){
        out[pos++]=c;
      }else if(c>=192){
        out[pos++]=32;
        if(pos<cap)out[pos++]=c^128;
      }else{
        if(i>=n)break;
        const next=input[i++];
        const dist=(((c<<8)|next)>>3)&0x07FF;
        let length=(next&7)+3;
        if(dist===0||dist>pos)break;
        while(length-->0&&pos<cap){out[pos]=out[pos-dist];pos++}
      }
    }
    return pos;
  }
  async readText(onProgress,signal){
    if(this.encryption===1||this.encryption===2){
      throw new ParseError('Este arquivo está protegido por DRM.','Livros com proteção da Amazon não podem ser abertos aqui. Use uma cópia sem DRM ou converta o livro para EPUB.');
    }
    const comp=this.compression;
    if(comp!==1&&comp!==2&&comp!==17480){
      throw new ParseError('Compressão MOBI não reconhecida.','Converta o arquivo para EPUB em um programa como o Calibre e importe novamente.');
    }
    let huff=null;
    if(comp===17480){
      if(!this.huffCount||!this.huffOffset)throw new ParseError('Arquivo MOBI incompleto.','As tabelas de compressão não foram encontradas.');
      huff=new MobiHuffman();
      huff.loadHuff(this.record(this.huffOffset));
      for(let i=1;i<this.huffCount;i++)huff.loadCdic(this.record(this.huffOffset+i));
      if(!huff.dictionary.length)throw new ParseError('Arquivo MOBI incompleto.','O dicionário de compressão está vazio.');
    }
    const declared=Number(this.textLength)||0;
    const cap=Math.min(Math.max(declared,1)+131072,MobiFile.MAX_TEXT);
    const out=new Uint8Array(cap);
    let pos=0;
    const last=Math.min(this.textRecordCount,this.numRecords-1);
    if(last<1)throw new ParseError('Arquivo MOBI sem texto.','Nenhum registro de conteúdo foi encontrado.');
    let mark=performance.now();
    for(let i=1;i<=last;i++){
      if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
      const raw=this.trimRecord(this.record(i));
      if(raw.length){
        if(comp===2){
          pos=MobiFile.lz77(raw,out,pos,cap);
        }else{
          const dec=comp===1?raw:huff.unpack(raw);
          const n=Math.min(dec.length,cap-pos);
          if(n>0){out.set(dec.subarray(0,n),pos);pos+=n}
        }
      }
      if(pos>=cap)break;
      if(performance.now()-mark>40){
        mark=performance.now();
        if(onProgress)onProgress(i/last);
        await Utils.yieldToUI();
      }
    }
    if(!pos)throw new ParseError('Não foi possível extrair o texto deste MOBI.','O arquivo pode estar corrompido. Tente convertê-lo para EPUB.');
    const end=declared>0&&declared<=pos?declared:pos;
    return out.subarray(0,end);
  }
  resolveImages(html){
    if(!this.firstImage)return html.replace(/<img\b[^>]*>/gi,'');
    let budget=MobiFile.IMAGE_BUDGET;
    return html.replace(/<img\b[^>]*>/gi,tag=>{
      const m=/recindex\s*=\s*["']?(\d+)["']?/i.exec(tag);
      if(!m)return '';
      const idx=parseInt(m[1],10);
      if(!idx||budget<=0)return '';
      const url=MobiFile.imageDataUrl(this.imageRecord(idx));
      if(!url)return '';
      budget-=url.length;
      if(budget<0)return '';
      return `<img src="${url}" alt="">`;
    });
  }
  buildHtml(bytes){
    let html=this.decodeBytes(bytes);
    if(!DocUtils.hasMarkup(html))return TXTParser.toHtml(html);
    html=html.replace(/<\?xml[^>]*\?>/gi,'');
    html=html.replace(/<!DOCTYPE[^>]*>/gi,'');
    html=html.replace(/<!--[\s\S]*?-->/g,'');
    html=html.replace(/<head[\s\S]*?<\/head>/gi,'');
    html=html.replace(/<style[\s\S]*?<\/style>/gi,'');
    html=html.replace(/<script[\s\S]*?<\/script>/gi,'');
    html=html.replace(/<guide[\s\S]*?<\/guide>/gi,'');
    html=html.replace(/<mbp:pagebreak[^>]*>/gi,'<div data-doc-break="1"></div>');
    html=html.replace(/<\/?mbp:[^>]*>/gi,'');
    html=html.replace(/<\/?(?:html|body|title|meta|link)\b[^>]*>/gi,'');
    html=html.replace(/<\/?(?:reference|guide)\b[^>]*>/gi,'');
    html=this.resolveImages(html);
    /* âncoras internas do MOBI apontam para posições de byte: viram texto simples */
    /* Remove TODO link, interno ou externo — este leitor não sabe navegar
       para eles, e um href real sobrevivendo faria o navegador tentar
       abrir a página de fora do app ao ser tocado. */
    html=DocUtils.stripLinks(html);
    html=html.replace(/(<br\s*\/?>\s*){4,}/gi,'<br><br>');
    return html.trim()||DocUtils.notice('Livro sem texto legível','Não encontramos conteúdo para exibir neste arquivo.');
  }
}
MobiFile.MAX_TEXT=48*1024*1024;
MobiFile.MAX_IMAGE=900*1024;
MobiFile.IMAGE_BUDGET=4*1024*1024;

class MOBIParser{
  static async parse(buffer,opts={}){
    const onProgress=opts.onProgress||(()=>{});
    const signal=opts.signal||null;
    if(!MobiFile.isMobi(buffer)){
      throw new ParseError('Este arquivo não é um MOBI válido.','Confira se a extensão corresponde ao conteúdo ou converta o livro para EPUB.');
    }
    const file=new MobiFile(buffer).readHeader();
    onProgress('Descompactando o livro',0);
    const bytes=await file.readText(p=>onProgress('Descompactando o livro',p),signal);
    onProgress('Organizando o texto',1);
    await Utils.yieldToUI();
    return file.buildHtml(bytes);
  }
  /* Metadados rápidos para a importação — não descompacta o texto. */
  static metadata(buffer){
    try{
      if(!MobiFile.isMobi(buffer))return null;
      const file=new MobiFile(buffer).readHeader();
      return{
        title:file.metaTitle(),
        author:file.metaAuthor(),
        cover:file.coverDataUrl(),
        drm:file.encryption===1||file.encryption===2
      };
    }catch(e){console.warn(e);return null}
  }
}

/* ============================================================
   EPUB PARSER
   ============================================================ */
class EPUBParser{
  static resolvePath(baseDir,relativePath){
    if(/^(https?:|data:)/i.test(relativePath))return relativePath;
    const stack=baseDir.split('/').filter(Boolean);
    String(relativePath).split('/').forEach(part=>{
      if(part==='..')stack.pop();
      else if(part==='.'||part==='')return;
      else stack.push(part);
    });
    return stack.join('/');
  }
  static getMimeType(path){
    const ext=(String(path).split('.').pop()||'').toLowerCase().split('?')[0];
    const map={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp',bmp:'image/bmp'};
    return map[ext]||'image/jpeg';
  }
  static uint8ToBase64(u8){
    let binary='';const chunkSize=0x8000;
    for(let i=0;i<u8.length;i+=chunkSize){
      binary+=String.fromCharCode.apply(null,u8.subarray(i,i+chunkSize));
    }
    return window.btoa(binary);
  }
  static findFile(zip,path){
    if(!path)return null;
    let f=zip.file(path);
    if(f)return f;
    const dec=Utils.safeDecode(path);
    if(dec!==path){f=zip.file(dec);if(f)return f}
    const lower=String(path).toLowerCase();
    const key=Object.keys(zip.files).find(k=>k.toLowerCase()===lower);
    return key?zip.files[key]:null;
  }
  static async embedImage(zip,chapterDir,relativeSrc){
    try{
      const resolved=EPUBParser.resolvePath(chapterDir,Utils.safeDecode(relativeSrc));
      const file=EPUBParser.findFile(zip,resolved);
      if(!file)return null;
      const u8=await file.async('uint8array');
      return `data:${EPUBParser.getMimeType(resolved)};base64,${EPUBParser.uint8ToBase64(u8)}`;
    }catch(e){return null}
  }
  static async parse(arrayBuffer){
    const zip=await JSZip.loadAsync(arrayBuffer);
    const parser=new DOMParser();
    let containerFile=zip.file('META-INF/container.xml');
    if(!containerFile){
      const path=Object.keys(zip.files).find(p=>/meta-inf\/container\.xml$/i.test(p));
      if(path)containerFile=zip.files[path];
    }
    if(!containerFile)throw new Error('EPUB inválido: container.xml não encontrado.');
    const containerDoc=parser.parseFromString(await containerFile.async('text'),'text/xml');
    let rootfile=null;
    const cEls=containerDoc.getElementsByTagName('*');
    for(let i=0;i<cEls.length;i++){if(cEls[i].localName==='rootfile'){rootfile=cEls[i];break}}
    let opfPath=rootfile?rootfile.getAttribute('full-path'):null;
    if(!opfPath||!EPUBParser.findFile(zip,opfPath)){
      const candidate=Object.keys(zip.files).find(p=>/\.opf$/i.test(p)&&!zip.files[p].dir);
      if(!candidate)throw new Error('EPUB inválido: arquivo OPF não encontrado.');
      opfPath=candidate;
    }
    const opfDir=opfPath.includes('/')?opfPath.substring(0,opfPath.lastIndexOf('/')+1):'';
    const opfDoc=parser.parseFromString(await EPUBParser.findFile(zip,opfPath).async('text'),'text/xml');
    const byLocal=name=>Array.from(opfDoc.getElementsByTagName('*')).filter(el=>el.localName===name);
    const getMeta=tagName=>{const els=byLocal(tagName);return els.length?els[0].textContent.trim():null};
    const title=getMeta('title')||'Livro Sem Título';
    const author=getMeta('creator')||'Autor Desconhecido';
    const manifest={};
    byLocal('item').forEach(item=>{
      const id=item.getAttribute('id');const href=item.getAttribute('href');
      if(id&&href)manifest[id]={href,mediaType:item.getAttribute('media-type')||'',properties:item.getAttribute('properties')||''};
    });
    const spineIds=byLocal('itemref').map(ir=>ir.getAttribute('idref')).filter(Boolean);
    if(spineIds.length===0)throw new Error('EPUB inválido: nenhum capítulo no spine.');
    let coverBase64=null;
    try{
      let coverItem=null;
      const coverMeta=byLocal('meta').find(m=>m.getAttribute('name')==='cover');
      const coverId=coverMeta?coverMeta.getAttribute('content'):null;
      if(coverId&&manifest[coverId])coverItem=manifest[coverId];
      if(!coverItem)coverItem=Object.values(manifest).find(m=>/(^|\s)cover-image(\s|$)/i.test(m.properties)&&/^image\//i.test(m.mediaType))||null;
      if(!coverItem)coverItem=Object.values(manifest).find(m=>/^image\//i.test(m.mediaType)&&/cover/i.test(m.href))||null;
      if(coverItem){
        const coverPath=EPUBParser.resolvePath(opfDir,Utils.safeDecode(coverItem.href));
        const coverFile=EPUBParser.findFile(zip,coverPath);
        if(coverFile){
          const u8=await coverFile.async('uint8array');
          coverBase64=`data:${EPUBParser.getMimeType(coverPath)};base64,`+EPUBParser.uint8ToBase64(u8);
        }
      }
    }catch(e){}
    let toc=spineIds.map((_,i)=>`Capítulo ${i+1}`);
    try{
      let tocItem=null;
      for(const it of Object.values(manifest)){
        if(/(^|\s)nav(\s|$)/i.test(it.properties)){tocItem=it;break}
      }
      if(!tocItem){
        const ref=byLocal('reference').find(r=>(r.getAttribute('type')||'')==='toc');
        if(ref&&ref.getAttribute('href'))tocItem={href:ref.getAttribute('href')};
      }
      if(tocItem&&tocItem.href){
        const tocPath=EPUBParser.resolvePath(opfDir,Utils.safeDecode(tocItem.href));
        const tocFile=EPUBParser.findFile(zip,tocPath);
        if(tocFile){
          const tocDir=tocPath.includes('/')?tocPath.substring(0,tocPath.lastIndexOf('/')+1):'';
          const tocDoc=parser.parseFromString(await tocFile.async('text'),'text/xml');
          let entries=[];
          const navPoints=Array.from(tocDoc.getElementsByTagName('*')).filter(e=>e.localName==='navPoint');
          if(navPoints.length){
            entries=navPoints.map(np=>{
              const label=Array.from(np.getElementsByTagName('*')).find(e=>e.localName==='navLabel');
              const textEl=label?Array.from(label.getElementsByTagName('*')).find(e=>e.localName==='text'):null;
              const content=Array.from(np.getElementsByTagName('*')).find(e=>e.localName==='content');
              return{title:textEl?textEl.textContent.trim():'',src:content?(content.getAttribute('src')||''):''};
            });
          }else{
            entries=Array.from(tocDoc.getElementsByTagName('a'))
              .filter(a=>a.getAttribute('href'))
              .map(a=>({title:a.textContent.trim(),src:a.getAttribute('href')}));
          }
          const spinePaths=spineIds.map(id=>manifest[id]?EPUBParser.resolvePath(opfDir,Utils.safeDecode(manifest[id].href)).toLowerCase():null);
          const assigned=new Set();
          entries.forEach(en=>{
            if(!en.src)return;
            const filePart=Utils.safeDecode(String(en.src).split('#')[0]);
            const p=EPUBParser.resolvePath(tocDir,filePart).toLowerCase();
            const idx=spinePaths.findIndex(sp=>sp===p);
            if(idx>=0&&!assigned.has(idx)){toc[idx]=en.title||toc[idx];assigned.add(idx)}
          });
        }
      }
    }catch(e){}
    const missingHtml=`<div style="padding:20px;text-align:center;"><p>[Trecho ausente ou corrompido no arquivo original]</p></div>`;
    return{
      metadata:{title,author,cover:coverBase64,format:'epub'},
      toc,totalChapters:spineIds.length,
      extractor:async chapterIndex=>{
        try{
          if(chapterIndex<0||chapterIndex>=spineIds.length)return null;
          const item=manifest[spineIds[chapterIndex]];
          if(!item)return missingHtml;
          const fullPath=EPUBParser.resolvePath(opfDir,Utils.safeDecode(item.href));
          const fileObj=EPUBParser.findFile(zip,fullPath);
          if(!fileObj)return missingHtml;
          if(/^image\//i.test(item.mediaType)){
            const u8=await fileObj.async('uint8array');
            const uri=`data:${EPUBParser.getMimeType(fullPath)};base64,${EPUBParser.uint8ToBase64(u8)}`;
            return `<div style="display:flex;align-items:center;justify-content:center;height:100%;"><img src="${uri}" style="max-width:100%;max-height:100%;object-fit:contain;"></div>`;
          }
          const chapterDir=fullPath.includes('/')?fullPath.substring(0,fullPath.lastIndexOf('/')+1):'';
          const html=await fileObj.async('text');
          return await EPUBParser.processChapter(html,zip,chapterDir);
        }catch(e){return missingHtml}
      }
    };
  }
  static async processChapter(rawHtml,zip,chapterDir){
    const doc=new DOMParser().parseFromString(rawHtml,'text/html');
    doc.querySelectorAll('script, link, style').forEach(el=>el.remove());
    Array.from(doc.querySelectorAll('*')).forEach(el=>{
      Array.from(el.attributes).forEach(attr=>{
        if(/^on/i.test(attr.name))el.removeAttribute(attr.name);
      });
    });
    const imgEls=Array.from(doc.querySelectorAll('img'));
    for(const img of imgEls){
      const src=img.getAttribute('src');
      if(!src||src.startsWith('data:'))continue;
      const dataUri=await EPUBParser.embedImage(zip,chapterDir,src);
      if(dataUri)img.setAttribute('src',dataUri);else img.remove();
    }
    const svgImgEls=Array.from(doc.querySelectorAll('image'));
    for(const img of svgImgEls){
      const href=img.getAttribute('href')||img.getAttribute('xlink:href');
      if(!href||href.startsWith('data:'))continue;
      const dataUri=await EPUBParser.embedImage(zip,chapterDir,href);
      if(dataUri){img.setAttribute('href',dataUri);img.setAttribute('xlink:href',dataUri);}
      else img.remove();
    }
    doc.querySelectorAll('a[href]').forEach(a=>a.setAttribute('href','javascript:void(0)'));
    return doc.body?doc.body.innerHTML:rawHtml;
  }
  static plainTextFallback(html){
    try{
      const d=new DOMParser().parseFromString(html,'text/html');
      const blocks=Array.from(d.body.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, div'))
        .map(b=>(b.textContent||'').trim()).filter(Boolean);
      const text=blocks.length?blocks.join('\n\n'):(d.body.textContent||'').trim();
      if(!text)return '<p>Este capítulo não pôde ser exibido.</p>';
      return text.split(/\n{2,}/).map(p=>`<p>${Utils.esc(p)}</p>`).join('');
    }catch(e){return '<p>Este capítulo não pôde ser exibido.</p>'}
  }
}

/* ============================================================
   PDF PARSER
   ============================================================ */
class PDFParser{
  static async parse(buffer){
    const pdf=await pdfjsLib.getDocument({data:buffer}).promise;
    return{pdf,numPages:pdf.numPages};
  }
  static async renderPageToContainer(pdf, pageNumber, wrapNode, maxW, maxH, zoom=1) {
    try {
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({scale: 1});
      const scale = Math.max(0.1, (maxW - 16) / base.width) * Math.max(.75,Math.min(3,zoom));
      const viewport = page.getViewport({scale});

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      
      await page.render({
        canvasContext: ctx,
        transform: [dpr, 0, 0, dpr, 0, 0],
        viewport: viewport
      }).promise;

      const textLayer = document.createElement('div');
      textLayer.className = 'pdf-text-layer';
      textLayer.style.width = canvas.style.width;
      textLayer.style.height = canvas.style.height;

      const textContent = await page.getTextContent();
      textContent.items.forEach(item => {
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.sqrt(tx[1]*tx[1] + tx[3]*tx[3]);
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - (fontHeight * 0.8)}px`;
        span.style.fontSize = `${fontHeight}px`;
        span.style.fontFamily = item.fontName || 'sans-serif';
        textLayer.appendChild(span);
      });

      const inner = document.createElement('div');
      inner.className = 'pdf-page-inner';
      inner.style.width = canvas.style.width;
      inner.style.height = canvas.style.height;
      inner.appendChild(canvas);
      inner.appendChild(textLayer);
      const annotationLayer = document.createElement('div');
      annotationLayer.className = 'pdf-annotation-layer';
      inner.appendChild(annotationLayer);

      wrapNode.innerHTML = '';
      wrapNode.appendChild(inner);
    } catch(e) {
      console.error(e);
      wrapNode.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">Não foi possível carregar esta página.</div>';
    }
  }
  static async renderPageToDataURL(pdf, pageNumber, maxW, maxH, quality=0.7) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: Math.min(maxW / page.getViewport({ scale: 1 }).width, maxH / page.getViewport({ scale: 1 }).height) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/jpeg', quality);
  }
  static async getTitle(pdf){
    try{
      const meta=await pdf.getMetadata();
      return meta&&meta.info&&meta.info.Title?meta.info.Title.trim():null;
    }catch(e){return null}
  }
}

/* ============================================================
   TXT PARSER
   ============================================================ */
class TXTParser{
  static toHtml(text){
    const paras=String(text).replace(/\r\n/g,'\n').split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
    if(!paras.length)return '<p>Arquivo vazio.</p>';
    return paras.map(p=>`<p>${Utils.esc(p).replace(/\n/g,'<br>')}</p>`).join('');
  }
}

/* ============================================================
   MARKDOWN PARSER
   ------------------------------------------------------------
   Markdown entra pela mesma porta do TXT: é texto puro. A
   diferença é que aqui os títulos viram capítulos de verdade
   (aparecem no sumário), as listas viram listas e o negrito
   aparece como negrito.

   Conversor próprio, sem biblioteca externa: o aplicativo precisa
   funcionar offline e um arquivo .md não justifica mais um
   download. Cobre o que se encontra em livros e apostilas:
   títulos, ênfase, código, citações, listas, tabelas, linhas
   horizontais e links (que viram texto simples, porque um link
   real tiraria o leitor de dentro do livro).
   ============================================================ */
class MDParser{
  static decode(buffer){
    try{return new TextDecoder('utf-8',{fatal:true}).decode(buffer)}
    catch(e){return new TextDecoder('windows-1252').decode(buffer)}
  }
  /* Título do documento: primeiro "# " do arquivo, quando existir. */
  static guessTitle(text){
    const m=String(text||'').match(/^\s*#\s+(.+?)\s*#*\s*$/m);
    return m?m[1].trim().slice(0,160):'';
  }
  static inline(raw){
    /* 1) escapa tudo; 2) devolve só as marcações que reconhecemos */
    let s=Utils.esc(raw);
    /* código em linha primeiro: o que está dentro dele não é markdown */
    const codes=[];
    s=s.replace(/(`+)([\s\S]*?)\1/g,(m,tick,body)=>{
      codes.push(body.trim());
      return `\u0000CODE${codes.length-1}\u0000`;
    });
    /* imagem: mostramos a legenda, já que o arquivo da imagem não vem junto */
    s=s.replace(/!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g,(m,alt)=>alt?`<em class="md-img">${alt}</em>`:'');
    /* link: vira texto (nada dentro do livro leva para fora do aplicativo) */
    s=s.replace(/\[([^\]]+)\]\(([^)\s]*)[^)]*\)/g,'<span class="md-link">$1</span>');
    s=s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,'<span class="md-link">$1</span>');
    s=s.replace(/\*\*\*([^*]+)\*\*\*/g,'<strong><em>$1</em></strong>');
    s=s.replace(/___([^_]+)___/g,'<strong><em>$1</em></strong>');
    s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
    s=s.replace(/__([^_]+)__/g,'<strong>$1</strong>');
    s=s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
    s=s.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g,'$1<em>$2</em>');
    s=s.replace(/~~([^~]+)~~/g,'<s>$1</s>');
    s=s.replace(/\u0000CODE(\d+)\u0000/g,(m,i)=>`<code>${codes[Number(i)]}</code>`);
    return s;
  }
  static toHtml(text){
    const lines=String(text||'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n');
    const out=[];
    let i=0;
    const para=[];
    const flushPara=()=>{
      if(!para.length)return;
      out.push(`<p>${MDParser.inline(para.join('\n')).replace(/\n/g,'<br>')}</p>`);
      para.length=0;
    };
    const listItems=(ordered,items)=>{
      const tag=ordered?'ol':'ul';
      out.push(`<${tag}>${items.map(it=>`<li>${MDParser.inline(it)}</li>`).join('')}</${tag}>`);
    };
    while(i<lines.length){
      const line=lines[i];
      /* bloco de código cercado por ``` ou ~~~ */
      const fence=line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
      if(fence){
        flushPara();
        const mark=fence[1][0];
        const body=[];
        i++;
        while(i<lines.length&&!new RegExp(`^\\s{0,3}${mark==='`'?'`':'~'}{3,}\\s*$`).test(lines[i])){
          body.push(lines[i]);i++;
        }
        i++;
        out.push(`<pre class="md-pre"><code>${Utils.esc(body.join('\n'))}</code></pre>`);
        continue;
      }
      /* linha horizontal */
      if(/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)){
        flushPara();out.push('<hr class="md-hr">');i++;continue;
      }
      /* título com # */
      const head=line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if(head){
        flushPara();
        const level=head[1].length;
        out.push(`<h${level}>${MDParser.inline(head[2])}</h${level}>`);
        i++;continue;
      }
      /* título sublinhado (=== ou ---) */
      const next=lines[i+1];
      if(line.trim()&&next&&/^\s{0,3}(=+|-+)\s*$/.test(next)&&!/^\s{0,3}[-*+]\s/.test(line)){
        flushPara();
        const level=next.trim()[0]==='='?1:2;
        out.push(`<h${level}>${MDParser.inline(line.trim())}</h${level}>`);
        i+=2;continue;
      }
      /* tabela: | a | b | seguida de |---|---| */
      if(/^\s{0,3}\|.*\|\s*$/.test(line)&&/^\s{0,3}\|[\s:|-]+\|\s*$/.test(lines[i+1]||'')){
        flushPara();
        const cells=row=>row.trim().replace(/^\||\|$/g,'').split('|').map(c=>MDParser.inline(c.trim()));
        const head2=cells(line);
        i+=2;
        const rows=[];
        while(i<lines.length&&/^\s{0,3}\|.*\|\s*$/.test(lines[i])){rows.push(cells(lines[i]));i++}
        out.push(`<table class="md-table"><thead><tr>${head2.map(c=>`<th>${c}</th>`).join('')}</tr></thead>`+
          `<tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      /* citação */
      if(/^\s{0,3}>\s?/.test(line)){
        flushPara();
        const body=[];
        while(i<lines.length&&/^\s{0,3}>\s?/.test(lines[i])){
          body.push(lines[i].replace(/^\s{0,3}>\s?/,''));i++;
        }
        out.push(`<blockquote>${MDParser.inline(body.join('\n')).replace(/\n/g,'<br>')}</blockquote>`);
        continue;
      }
      /* listas */
      const bullet=line.match(/^\s{0,3}([-*+])\s+(.*)$/);
      const numbered=line.match(/^\s{0,3}(\d{1,9})[.)]\s+(.*)$/);
      if(bullet||numbered){
        flushPara();
        const ordered=!!numbered;
        const items=[];
        while(i<lines.length){
          const b=lines[i].match(ordered?/^\s{0,3}(\d{1,9})[.)]\s+(.*)$/:/^\s{0,3}([-*+])\s+(.*)$/);
          if(b){
            /* marca de tarefa: [ ] e [x] viram símbolos legíveis */
            items.push(b[2].replace(/^\[( |x|X)\]\s*/,(m,c)=>c===' '?'☐ ':'☑ '));
            i++;
            /* continuações indentadas pertencem ao mesmo item */
            while(i<lines.length&&/^\s{2,}\S/.test(lines[i])&&!/^\s{0,3}([-*+]|\d{1,9}[.)])\s/.test(lines[i])){
              items[items.length-1]+=' '+lines[i].trim();i++;
            }
            continue;
          }
          if(!lines[i].trim()&&lines[i+1]&&(ordered?/^\s{0,3}\d{1,9}[.)]\s/:/^\s{0,3}[-*+]\s/).test(lines[i+1])){i++;continue}
          break;
        }
        listItems(ordered,items);
        continue;
      }
      if(!line.trim()){flushPara();i++;continue}
      para.push(line.trim());
      i++;
    }
    flushPara();
    const html=out.join('');
    return html||'<p>Arquivo vazio.</p>';
  }
  /* Mesma assinatura dos outros leitores (DOCXParser / MOBIParser). */
  static async parse(buffer,opts={}){
    const onProgress=opts.onProgress||(()=>{});
    onProgress('Lendo o texto',.15);
    const text=MDParser.decode(buffer);
    onProgress('Convertendo o Markdown',.6);
    await Utils.yieldToUI();
    return DocUtils.stripLinks(MDParser.toHtml(text));
  }
}

/* ============================================================
   QUADRINHOS — CBZ / CBR / CB7 / CBT
   ------------------------------------------------------------
   Um quadrinho digital é só um pacote de imagens em ordem. O que
   muda de um formato para o outro é o TIPO de pacote:

     CBZ -> ZIP   (JSZip, que o aplicativo já usa para o EPUB)
     CBR -> RAR   (libarchive compilado para WebAssembly)
     CB7 -> 7-Zip (idem)
     CBT -> TAR   (idem)

   Por isso a extensão nunca é levada ao pé da letra: o formato é
   descoberto pelos primeiros bytes do arquivo. Um "livro.cbr" que
   na verdade é um ZIP — coisa comuníssima — abre normalmente.

   Estratégias de memória, que é o que importa no celular:
   - ZIP: as páginas ficam compactadas e cada uma é descompactada
     só quando aparece na tela (acesso aleatório é barato).
   - RAR/7z/TAR: descompactar página avulsa é caro (o formato é
     sequencial), então a extração acontece UMA vez, com barra de
     progresso, e as páginas ficam guardadas como Blob — que o
     navegador mantém fora da memória do JavaScript.
   ============================================================ */
const ComicSupport={
  IMAGE_EXT:['jpg','jpeg','jpe','jfif','png','gif','webp','bmp','avif','apng'],
  /* Arquivos que todo empacotador insere e que não são páginas. */
  isJunk(path){
    const p=String(path||'').replace(/\\/g,'/');
    const base=p.split('/').pop()||'';
    if(!base||base.startsWith('.'))return true;
    if(/(^|\/)__MACOSX\//i.test(p))return true;
    if(/^thumbs\.db$/i.test(base)||/^desktop\.ini$/i.test(base))return true;
    return false;
  },
  ext(path){
    const base=String(path||'').split('/').pop()||'';
    return (base.split('.').pop()||'').toLowerCase();
  },
  isImage(path){
    if(ComicSupport.isJunk(path))return false;
    return ComicSupport.IMAGE_EXT.includes(ComicSupport.ext(path));
  },
  mime(path){
    const map={jpg:'image/jpeg',jpeg:'image/jpeg',jpe:'image/jpeg',jfif:'image/jpeg',
      png:'image/png',apng:'image/apng',gif:'image/gif',webp:'image/webp',
      bmp:'image/bmp',avif:'image/avif'};
    return map[ComicSupport.ext(path)]||'image/jpeg';
  },
  /* "pag2.jpg" antes de "pag10.jpg": números comparados como números.
     É o que faz a ordem das páginas bater com a do quadrinho. */
  naturalCompare(a,b){
    const ra=String(a).toLowerCase().match(/(\d+|\D+)/g)||[];
    const rb=String(b).toLowerCase().match(/(\d+|\D+)/g)||[];
    const n=Math.max(ra.length,rb.length);
    for(let i=0;i<n;i++){
      const pa=ra[i],pb=rb[i];
      if(pa===undefined)return -1;
      if(pb===undefined)return 1;
      const na=/^\d/.test(pa),nb=/^\d/.test(pb);
      if(na&&nb){
        const d=parseInt(pa,10)-parseInt(pb,10);
        if(d)return d;
      }else{
        const d=pa.localeCompare(pb,'pt');
        if(d)return d;
      }
    }
    return 0;
  },
  /* Assinatura do pacote, lida nos primeiros bytes. */
  sniff(head){
    const b=head instanceof Uint8Array?head:new Uint8Array(head||[]);
    if(b.length<8)return null;
    if(b[0]===0x50&&b[1]===0x4B&&(b[2]===3||b[2]===5||b[2]===7))return 'zip';
    /* Rar!\x1a\x07\x00 (v4) e Rar!\x1a\x07\x01\x00 (v5) */
    if(b[0]===0x52&&b[1]===0x61&&b[2]===0x72&&b[3]===0x21&&b[4]===0x1A&&b[5]===0x07)return 'rar';
    /* 7z: 37 7A BC AF 27 1C */
    if(b[0]===0x37&&b[1]===0x7A&&b[2]===0xBC&&b[3]===0xAF&&b[4]===0x27&&b[5]===0x1C)return '7z';
    return null;
  },
  async sniffBlob(blob){
    try{
      const head=new Uint8Array(await blob.slice(0,Math.min(512,blob.size)).arrayBuffer());
      const kind=ComicSupport.sniff(head);
      if(kind)return kind;
      /* TAR guarda "ustar" no deslocamento 257. */
      if(blob.size>270){
        const tar=new Uint8Array(await blob.slice(257,262).arrayBuffer());
        if(String.fromCharCode(...tar)==='ustar')return 'tar';
      }
    }catch(e){console.warn(e)}
    return null;
  },
  /* Metadados do padrão ComicInfo.xml (ComicRack), presente na maior
     parte dos quadrinhos digitais. */
  parseComicInfo(xmlText){
    try{
      const doc=new DOMParser().parseFromString(String(xmlText),'text/xml');
      if(!doc||doc.querySelector('parsererror'))return null;
      const pick=name=>{
        const el=Array.from(doc.getElementsByTagName('*')).find(n=>n.localName===name);
        const v=el?String(el.textContent||'').trim():'';
        return v||'';
      };
      const manga=pick('Manga');
      const authors=['Writer','Penciller','Artist','Author','Creator']
        .map(pick).filter(Boolean);
      return{
        title:pick('Title'),
        series:pick('Series'),
        number:pick('Number'),
        volume:pick('Volume'),
        author:authors.length?authors[0].split(/\s*,\s*/)[0]:'',
        summary:pick('Summary'),
        pageCount:Number(pick('PageCount'))||0,
        rtl:/right\s*to\s*left|yesandrighttoleft/i.test(manga)
      };
    }catch(e){return null}
  },
  /* Título montado a partir do ComicInfo: "Série #12 — Título". */
  buildTitle(info,fallback){
    if(!info)return fallback;
    const partes=[];
    if(info.series)partes.push(info.series);
    if(info.number)partes.push(`#${info.number}`);
    const cabeca=partes.join(' ');
    if(cabeca&&info.title&&info.title!==info.series)return `${cabeca} — ${info.title}`;
    return cabeca||info.title||fallback;
  }
};

/* Carregador sob demanda do libarchive: o WebAssembly (1 MB) só é
   baixado quando o leitor realmente abre um CBR/CB7/CBT. Quem lê
   apenas CBZ nunca paga esse custo. */
const LibArchiveLoader={
  _promise:null,
  base(){
    /* app.js mora na raiz do aplicativo; o vendor fica ao lado dele. */
    try{
      const script=document.querySelector('script[src*="app.js"]');
      const src=script?script.src:window.location.href;
      return new URL('vendor/libarchive/',src).href;
    }catch(e){return 'vendor/libarchive/'}
  },
  load(){
    if(window.VeredasLibArchive)return Promise.resolve(window.VeredasLibArchive);
    if(this._promise)return this._promise;
    this._promise=new Promise((resolve,reject)=>{
      if(typeof WebAssembly!=='object'){
        reject(new ParseError('Este navegador não consegue abrir arquivos CBR.',
          'Converta o quadrinho para CBZ (ZIP) e importe novamente.'));
        return;
      }
      /* Script CLÁSSICO, de propósito: com o aplicativo aberto direto
         do disco (file://), o navegador recusa módulos ES, Workers e
         qualquer fetch de arquivo vizinho. Uma tag <script> comum é o
         único caminho que funciona tanto em file:// quanto num
         servidor — e o WebAssembly já vem embutido no próprio arquivo,
         então não há mais nada para buscar depois. */
      const tag=document.createElement('script');
      tag.src=this.base()+'libarchive-embutido.js';
      tag.async=true;
      tag.onload=()=>{
        if(window.VeredasLibArchive&&window.VeredasLibArchive.disponivel()){
          resolve(window.VeredasLibArchive);
        }else{
          reject(new ParseError('Este navegador não consegue abrir arquivos CBR.',
            'Converta o quadrinho para CBZ (ZIP) e importe novamente.'));
        }
      };
      tag.onerror=()=>reject(new ParseError('O leitor de CBR não foi encontrado.',
        'A pasta vendor/libarchive precisa estar junto do index.html, com o arquivo libarchive-embutido.js dentro.'));
      document.head.appendChild(tag);
    }).catch(err=>{
      this._promise=null;
      throw err;
    });
    return this._promise;
  }
};

class ComicArchive{
  constructor(){
    this.pages=[];        /* [{name,path,size}] na ordem de leitura */
    this.info=null;       /* ComicInfo.xml, quando existe */
    this.kind='zip';
    this._zip=null;       /* JSZip, quando o pacote é ZIP */
    this._blobs=null;     /* páginas já extraídas (RAR/7z/TAR) */
    this._urls=new Map(); /* cache de object URLs em uso */
    this._order=[];
    this._closed=false;
  }
  get length(){return this.pages.length}

  /* --------------------------------------------------------
     Abertura
     `source` pode ser Blob/File (caminho normal) ou ArrayBuffer
     (livros antigos, gravados antes desta versão).
     -------------------------------------------------------- */
  static async open(source,opts={}){
    const onStatus=opts.onStatus||(()=>{});
    const signal=opts.signal||null;
    const blob=source instanceof Blob?source:new Blob([source]);
    const archive=new ComicArchive();
    const nome=opts.name||'quadrinho';
    let kind=await ComicSupport.sniffBlob(blob);
    if(!kind){
      /* Sem assinatura conhecida: confia na extensão como último recurso. */
      const ext=BookFormats.normalize(nome);
      kind=ext==='cbr'?'rar':ext==='cb7'?'7z':ext==='cbt'?'tar':'zip';
    }
    archive.kind=kind;
    if(kind==='zip')await archive._openZip(blob,{onStatus,signal});
    else await archive._openLibArchive(blob,{onStatus,signal,coverOnly:opts.coverOnly});
    if(!archive.pages.length){
      throw new ParseError('Não encontramos páginas dentro deste quadrinho.',
        'O arquivo precisa conter imagens (JPG, PNG, WEBP ou GIF).');
    }
    return archive;
  }

  async _openZip(blob,{onStatus}){
    onStatus('Lendo o índice do quadrinho...');
    let zip;
    try{
      zip=await JSZip.loadAsync(blob);
    }catch(e){
      throw new ParseError('Não foi possível ler este quadrinho.',
        'O arquivo pode estar incompleto, protegido por senha ou corrompido.');
    }
    this._zip=zip;
    const entries=[];
    zip.forEach((path,file)=>{
      if(file.dir)return;
      if(/comicinfo\.xml$/i.test(path)&&!ComicSupport.isJunk(path)){
        entries.push({path,info:true,file});
        return;
      }
      if(!ComicSupport.isImage(path))return;
      entries.push({path,file,size:file._data?file._data.uncompressedSize:0});
    });
    const infoEntry=entries.find(e=>e.info);
    if(infoEntry){
      try{this.info=ComicSupport.parseComicInfo(await infoEntry.file.async('text'))}
      catch(e){console.warn(e)}
    }
    this.pages=entries.filter(e=>!e.info)
      .sort((a,b)=>ComicSupport.naturalCompare(a.path,b.path))
      .map(e=>({name:e.path.split('/').pop(),path:e.path,size:e.size||0}));
  }

  async _openLibArchive(blob,{onStatus,signal,coverOnly}){
    const abortou=()=>{
      if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
    };
    onStatus('Preparando o leitor de CBR...');
    const LA=await LibArchiveLoader.load();
    abortou();
    onStatus('Lendo o arquivo...');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    abortou();
    let leitor;
    try{
      leitor=await LA.abrir(bytes);
    }catch(e){
      console.error(e);
      throw new ParseError('Não foi possível abrir este quadrinho.',
        'O arquivo pode ser grande demais para a memória deste aparelho. Dividir o quadrinho em partes menores costuma resolver.');
    }
    try{
      onStatus('Lendo o índice do quadrinho...');
      await Utils.yieldToUI();
      let entradas=[];
      try{entradas=leitor.listar()}catch(e){console.warn(e)}
      const arquivos=entradas.filter(e=>e&&e.path&&!e.dir);
      if(!arquivos.length){
        /* Nem um arquivo sequer: ou o pacote está cifrado, ou não foi
           reconhecido (RAR muito antigo, truncado, ou dividido em
           partes .r00/.r01). */
        const cifrado=leitor.temSenha();
        throw new ParseError(
          cifrado?'Este quadrinho está protegido por senha.'
                 :'Não foi possível ler este arquivo de quadrinho.',
          cifrado?'Remova a senha do arquivo e importe de novo.'
                 :'Ele pode estar incompleto, dividido em várias partes ou em uma variação de RAR que o aplicativo não reconhece. Converter para CBZ resolve.');
      }

      const infoEntrada=arquivos.find(e=>/comicinfo\.xml$/i.test(e.path));
      const imagens=arquivos.filter(e=>ComicSupport.isImage(e.path))
        .sort((a,b)=>ComicSupport.naturalCompare(a.path,b.path));
      this.pages=imagens.map(e=>({name:e.path.split('/').pop(),path:e.path,size:e.size||0}));

      /* Na importação basta a capa; na leitura, tudo. Formatos
         sequenciais como RAR cobram caro por página avulsa, então a
         extração acontece numa passagem só — e devolve o controle ao
         navegador entre as páginas, para a tela não congelar. */
      const querer=new Set();
      if(infoEntrada)querer.add(infoEntrada.path);
      if(coverOnly){if(imagens.length)querer.add(imagens[0].path)}
      else imagens.forEach(e=>querer.add(e.path));

      const total=imagens.length;
      onStatus(coverOnly?'Lendo a capa...':`Descompactando ${total} página(s)...`);
      await Utils.yieldToUI();
      let ultimo=0;
      const extraidos=await leitor.extrair(querer,{
        mime:caminho=>ComicSupport.mime(caminho),
        tick:()=>{abortou();return Utils.yieldToUI()},
        onProgress:(feitas)=>{
          if(coverOnly)return;
          const agora=Date.now();
          if(agora-ultimo<120&&feitas<total)return;
          ultimo=agora;
          onStatus(`Descompactando as páginas (${Math.min(feitas,total)} de ${total})...`);
        }
      });
      abortou();

      if(infoEntrada&&extraidos.has(infoEntrada.path)){
        try{this.info=ComicSupport.parseComicInfo(await extraidos.get(infoEntrada.path).text())}
        catch(e){console.warn(e)}
      }

      this._blobs=new Map();
      if(coverOnly){
        const capa=imagens.length?extraidos.get(imagens[0].path):null;
        if(capa)this._blobs.set(0,capa);
        return;
      }
      /* Páginas que não voltaram da extração saem da lista para não
         virarem buracos silenciosos no meio da leitura. */
      const validas=[];
      imagens.forEach(e=>{
        const b=extraidos.get(e.path);
        if(!b)return;
        this._blobs.set(validas.length,b);
        validas.push({name:e.path.split('/').pop(),path:e.path,size:e.size||0});
      });
      this.pages=validas;
    }finally{
      try{leitor.fechar()}catch(e){}
    }
  }

  /* Blob da página `i` — o formato decide de onde ele vem. */
  async pageBlob(i){
    if(this._closed)throw new Error('Quadrinho fechado.');
    const page=this.pages[i];
    if(!page)return null;
    if(this._blobs){
      const b=this._blobs.get(i);
      if(!b)throw new ParseError('Esta página não pôde ser descompactada.','');
      return b;
    }
    const entry=this._zip&&this._zip.file(page.path);
    if(!entry)throw new ParseError('Esta página não está mais dentro do arquivo.','');
    const u8=await entry.async('uint8array');
    return new Blob([u8],{type:ComicSupport.mime(page.path)});
  }

  /* Endereço temporário da imagem. O leitor devolve o que não usa
     mais com `release`, para a memória não crescer sem parar. */
  async pageUrl(i){
    const existente=this._urls.get(i);
    if(existente)return existente;
    const blob=await this.pageBlob(i);
    if(!blob)return null;
    if(this._closed)return null;
    const url=URL.createObjectURL(blob);
    this._urls.set(i,url);
    return url;
  }
  release(keep){
    const manter=keep instanceof Set?keep:new Set(keep||[]);
    for(const [i,url] of Array.from(this._urls.entries())){
      if(manter.has(i))continue;
      try{URL.revokeObjectURL(url)}catch(e){}
      this._urls.delete(i);
    }
  }
  close(){
    this._closed=true;
    this.release([]);
    this._zip=null;
    this._blobs=null;
    this.pages=[];
  }

  /* Capa reduzida, no mesmo formato usado pelos outros livros. */
  async coverDataURL(maxW=320,maxH=480,quality=.78){
    if(!this.pages.length)return null;
    const blob=await this.pageBlob(0);
    if(!blob)return null;
    return ComicArchive.shrinkToDataURL(blob,maxW,maxH,quality);
  }
  static shrinkToDataURL(blob,maxW,maxH,quality){
    return new Promise(resolve=>{
      const url=URL.createObjectURL(blob);
      const img=new Image();
      const limpar=()=>{try{URL.revokeObjectURL(url)}catch(e){}};
      img.onload=()=>{
        try{
          const escala=Math.min(1,maxW/(img.naturalWidth||maxW),maxH/(img.naturalHeight||maxH));
          const w=Math.max(1,Math.round((img.naturalWidth||maxW)*escala));
          const h=Math.max(1,Math.round((img.naturalHeight||maxH)*escala));
          const canvas=document.createElement('canvas');
          canvas.width=w;canvas.height=h;
          const ctx=canvas.getContext('2d');
          ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
          ctx.drawImage(img,0,0,w,h);
          resolve(canvas.toDataURL('image/jpeg',quality));
        }catch(e){resolve(null)}
        finally{limpar()}
      };
      img.onerror=()=>{limpar();resolve(null)};
      img.src=url;
    });
  }
}

/* ============================================================
   DOM PAGINATOR
   ------------------------------------------------------------
   Monta as páginas medindo os blocos direto no DOM.

   Regras que sustentam este algoritmo:
   - os nós são MOVIDOS para a caixa de medição (nunca reserializados
     a cada passo), então o custo cresce de forma linear com o livro;
   - todo nó que não cabe é dividido em partes estritamente menores,
     o que garante que o laço sempre avança;
   - o trabalho é fatiado com pausas para a interface continuar viva,
     reportar progresso e aceitar o cancelamento.
   ============================================================ */
class DOMPaginator{
  static flattenBlocks(root,out){
    const wrapperTags=['DIV','SECTION','ARTICLE','BODY','MAIN','ASIDE'];
    Array.from(root.childNodes).forEach(node=>{
      if(node.nodeType===3){if(node.textContent.trim())out.push(node);return}
      if(node.nodeType!==1)return;
      const isPureWrapper=wrapperTags.includes(node.tagName)&&node.children.length>0&&
        Array.from(node.childNodes).every(c=>c.nodeType!==3||!c.textContent.trim());
      if(isPureWrapper)this.flattenBlocks(node,out);else out.push(node);
    });
  }
  static cloneShell(el){
    const shell=document.createElement(el.tagName);
    for(const attr of Array.from(el.attributes||[]))shell.setAttribute(attr.name,attr.value);
    return shell;
  }
  /* Encaixa o máximo de texto possível e devolve o restante. */
  static placeText(node,container,fits){
    const full=node.textContent;
    if(!full)return true;
    const probe=document.createTextNode('');
    container.appendChild(probe);
    if(!fits()){container.removeChild(probe);return false}
    let lo=0,hi=full.length;
    while(lo<hi){
      const mid=Math.ceil((lo+hi)/2);
      probe.textContent=full.slice(0,mid);
      if(fits())lo=mid;else hi=mid-1;
    }
    if(lo<=0){container.removeChild(probe);return false}
    let cut=full.lastIndexOf(' ',lo);
    if(cut<=0)cut=lo;
    probe.textContent=full.slice(0,cut);
    const rest=full.slice(cut);
    if(!rest.trim())return true;
    return document.createTextNode(rest);
  }
  /* true = coube inteiro | false = não coube nada | Node = sobra */
  static place(node,container,fits,depth=0){
    if(node.nodeType===3&&!node.textContent)return true;
    if(node.nodeType!==1&&node.nodeType!==3)return true;
    container.appendChild(node);
    if(fits())return true;
    container.removeChild(node);
    if(node.nodeType===3)return this.placeText(node,container,fits);
    if(DOMPaginator.ATOMIC.has(node.tagName)||depth>DOMPaginator.MAX_DEPTH)return false;
    const kids=Array.from(node.childNodes);
    if(!kids.length)return false;
    const shell=this.cloneShell(node);
    container.appendChild(shell);
    if(!fits()){container.removeChild(shell);return false}
    for(let k=0;k<kids.length;k++){
      const result=this.place(kids[k],shell,fits,depth+1);
      if(result===true)continue;
      /* result===false: o filho voltou intacto e vai inteiro para a sobra */
      const leftover=result===false?kids[k]:result;
      if(!shell.childNodes.length){
        /* nada coube aqui: remonta o nó original antes de devolver o "não coube",
           senão os filhos já movidos para a casca se perderiam */
        container.removeChild(shell);
        while(node.firstChild)node.removeChild(node.firstChild);
        for(let m=0;m<kids.length;m++)node.appendChild(m===k?leftover:kids[m]);
        return false;
      }
      const rest=this.cloneShell(node);
      rest.appendChild(leftover);
      for(let m=k+1;m<kids.length;m++)rest.appendChild(kids[m]);
      return rest;
    }
    return true;
  }
  static async paginateHtml(htmlString,w,h,fontSize,fontFamily,lineHeight=1.65,margin=6,opts={}){
    const onProgress=typeof opts.onProgress==='function'?opts.onProgress:null;
    const signal=opts.signal||null;
    const box=document.createElement('div');
    box.className='page-content';
    box.style.cssText=`position:fixed;left:-10000px;top:0;visibility:hidden;width:${w}px;height:${h}px;min-height:0;padding:${margin}% ${margin}% 38px;overflow:hidden;box-sizing:border-box;contain:layout style;`;
    const textBox=document.createElement('div');
    textBox.className='page-text';
    textBox.style.cssText=`font-family:${fontFamily};font-size:${fontSize}px;line-height:${lineHeight};`;
    const footer=document.createElement('div');
    footer.className='page-number';
    footer.textContent='Página';
    box.append(textBox,footer);
    document.body.appendChild(box);

    const pages=[];
    try{
      const tmp=document.createElement('div');
      tmp.innerHTML=htmlString;
      const blocks=[];
      this.flattenBlocks(tmp,blocks);
      const total=blocks.length||1;
      const fits=()=>textBox.scrollHeight<=textBox.clientHeight+2;
      const flush=()=>{
        if(textBox.childNodes.length){
          pages.push(textBox.innerHTML);
          textBox.textContent='';
        }
      };
      let index=0;
      const pending=[];
      const next=()=>pending.length?pending.shift():(index<blocks.length?blocks[index++]:null);
      let guard=0;
      let mark=performance.now();
      let node;
      while((node=next())!==null){
        if(++guard>DOMPaginator.MAX_STEPS)break;
        if(pages.length>=DOMPaginator.MAX_PAGES)break;
        if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
        /* Só nós de texto em branco são descartados: elementos vazios podem ser
           marcadores de capítulo, <br> ou espaçadores e precisam sobreviver. */
        if(node.nodeType===3&&!node.textContent.trim())continue;
        const result=this.place(node,textBox,fits);
        if(result===true){
          if(performance.now()-mark>32){
            mark=performance.now();
            if(onProgress)onProgress(index-pending.length,total,pages.length);
            await Utils.yieldToUI();
          }
          continue;
        }
        if(result===false){
          if(!textBox.childNodes.length){
            /* nem sozinho cabe (imagem gigante, tabela larga): ganha uma página só para ele */
            textBox.appendChild(node);
          }else{
            pending.unshift(node);
          }
          flush();
        }else{
          flush();
          pending.unshift(result);
        }
        if(performance.now()-mark>32){
          mark=performance.now();
          if(onProgress)onProgress(index-pending.length,total,pages.length);
          await Utils.yieldToUI();
        }
      }
      flush();
      if(onProgress)onProgress(total,total,pages.length);
    }finally{
      box.remove();
    }
    return pages.length?pages:['<p></p>'];
  }
}
DOMPaginator.ATOMIC=new Set(['IMG','SVG','VIDEO','AUDIO','IFRAME','CANVAS','HR','BR','INPUT','TEXTAREA','SELECT']);
DOMPaginator.MAX_DEPTH=24;
DOMPaginator.MAX_PAGES=30000;
DOMPaginator.MAX_STEPS=2000000;

/* ============================================================
   AUDIOLIVROS — FORMATOS E LEITURA DE METADADOS
   ------------------------------------------------------------
   Nada aqui carrega o arquivo inteiro na memória: tudo é lido por
   fatias (Blob.slice), então um audiolivro de 1 GB custa o mesmo
   que um de 10 MB para entrar na estante.

   • MP3  — ID3v2 (2.2/2.3/2.4): título, autor, álbum, capa e
            capítulos (CHAP); ID3v1 como reserva; duração exata pelo
            cabeçalho Xing/VBRI ou pelo bitrate constante.
   • M4B  — átomos MP4: mvhd (duração), ilst (título, autor,
            narrador, capa) e capítulos, tanto no formato Nero
            (chpl) quanto na faixa de texto do QuickTime.
   • MP4  — mesmo contêiner do M4B, com imagem. Usa exatamente o
            mesmo leitor de metadados, a mesma linha do tempo e os
            mesmos marcadores; só a tela muda (um <video> ocupa o
            lugar da capa).

   Para acrescentar um formato novo (m4a, ogg, opus, flac…) basta
   registrá-lo em MEDIA_FORMATS e escrever a função de leitura.
   ============================================================ */
const AUDIO_FORMATS={
  mp3:{label:'MP3',mime:'audio/mpeg',kind:'audio',icon:'headphones'},
  m4b:{label:'M4B',mime:'audio/mp4',kind:'audio',icon:'headphones'},
  mp4:{label:'MP4',mime:'video/mp4',kind:'video',icon:'film'}
};
/* Nome novo, mais honesto (áudio + vídeo); AUDIO_FORMATS continua
   apontando para o mesmo objeto para não quebrar nada que já existia. */
const MEDIA_FORMATS=AUDIO_FORMATS;
const AudioFormats={
  has:f=>Object.prototype.hasOwnProperty.call(AUDIO_FORMATS,String(f||'').toLowerCase()),
  ext:name=>(String(name||'').split('.').pop()||'').toLowerCase(),
  isAudioName:name=>AudioFormats.has(AudioFormats.ext(name)),
  isAudioBook:book=>!!book&&AudioFormats.has(book.format),
  /* vídeo: toca no mesmo player, mas mostra imagem e não pode ser compartilhado */
  isVideo:f=>(AUDIO_FORMATS[String(f||'').toLowerCase()]||{}).kind==='video',
  isVideoBook:book=>!!book&&AudioFormats.isVideo(book.format),
  isSoundOnly:f=>AudioFormats.has(f)&&!AudioFormats.isVideo(f),
  isSoundOnlyBook:book=>!!book&&AudioFormats.isSoundOnly(book.format),
  kind:f=>(AUDIO_FORMATS[String(f||'').toLowerCase()]||{}).kind||'audio',
  icon:f=>(AUDIO_FORMATS[String(f||'').toLowerCase()]||{}).icon||'headphones',
  /* “audiolivro” x “vídeo”: usado nas mensagens para o usuário */
  noun:f=>AudioFormats.isVideo(f)?'vídeo':'audiolivro',
  mime:f=>(AUDIO_FORMATS[String(f||'').toLowerCase()]||{}).mime||'audio/mpeg',
  label:f=>(AUDIO_FORMATS[String(f||'').toLowerCase()]||{}).label||String(f||'').toUpperCase()
};

/* Formatação de tempo usada pelo player e pela estante. */
const AudioFmt={
  /* 75 -> "1:15" · 3725 -> "1:02:05" */
  clock(sec){
    sec=Math.max(0,Math.floor(Number.isFinite(sec)?sec:0));
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
  },
  /* 45300 -> "12h 35min" · 2700 -> "45min" · 40 -> "40s" */
  long(sec){
    sec=Math.max(0,Math.round(Number.isFinite(sec)?sec:0));
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);
    if(h)return m?`${h}h ${m}min`:`${h}h`;
    if(m)return `${m}min`;
    return `${sec}s`;
  },
  /* Para leitores de tela: "1 hora, 2 minutos e 5 segundos". */
  spoken(sec){
    sec=Math.max(0,Math.floor(Number.isFinite(sec)?sec:0));
    const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
    const parts=[];
    if(h)parts.push(`${h} ${h===1?'hora':'horas'}`);
    if(m)parts.push(`${m} ${m===1?'minuto':'minutos'}`);
    if(s||!parts.length)parts.push(`${s} ${s===1?'segundo':'segundos'}`);
    return parts.length>1?parts.slice(0,-1).join(', ')+' e '+parts[parts.length-1]:parts[0];
  }
};

/* ------------------------------------------------------------
   Leitura binária por fatias
   ------------------------------------------------------------ */
const Bin={
  async read(blob,start,end){
    const s=Math.max(0,Math.floor(start)),e=Math.min(blob.size,Math.floor(end));
    if(!(e>s))return new Uint8Array(0);
    return new Uint8Array(await blob.slice(s,e).arrayBuffer());
  },
  u16:(b,o)=>(b[o]<<8)|b[o+1],
  u24:(b,o)=>(b[o]<<16)|(b[o+1]<<8)|b[o+2],
  u32:(b,o)=>b[o]*0x1000000+((b[o+1]<<16)|(b[o+2]<<8)|b[o+3]),
  u64:(b,o)=>Bin.u32(b,o)*0x100000000+Bin.u32(b,o+4),
  syncsafe:(b,o)=>((b[o]&0x7f)<<21)|((b[o+1]&0x7f)<<14)|((b[o+2]&0x7f)<<7)|(b[o+3]&0x7f),
  ascii(b,o,n){
    let s='';
    for(let i=0;i<n&&o+i<b.length;i++)s+=String.fromCharCode(b[o+i]);
    return s;
  },
  /* Desfaz a "dessincronização" do ID3 (FF 00 -> FF). */
  unsync(b){
    const out=new Uint8Array(b.length);let j=0;
    for(let i=0;i<b.length;i++){
      out[j++]=b[i];
      if(b[i]===0xFF&&b[i+1]===0x00)i++;
    }
    return out.subarray(0,j);
  },
  /* enc: 0 = ISO-8859-1, 1 = UTF-16 com BOM, 2 = UTF-16BE, 3 = UTF-8.
     Muita etiqueta em português diz "ISO-8859-1" mas foi gravada em
     UTF-8; se os bytes são UTF-8 válido, é isso que eles são. */
  text(bytes,enc){
    try{
      if(enc===1){
        if(bytes[0]===0xFE&&bytes[1]===0xFF)return new TextDecoder('utf-16be').decode(bytes.subarray(2));
        if(bytes[0]===0xFF&&bytes[1]===0xFE)return new TextDecoder('utf-16le').decode(bytes.subarray(2));
        return new TextDecoder('utf-16le').decode(bytes);
      }
      if(enc===2)return new TextDecoder('utf-16be').decode(bytes);
      if(enc===3)return new TextDecoder('utf-8').decode(bytes);
      let high=false;
      for(let i=0;i<bytes.length;i++)if(bytes[i]>127){high=true;break}
      if(high){
        try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch(e){}
      }
      return new TextDecoder('windows-1252').decode(bytes);
    }catch(e){
      return Bin.ascii(bytes,0,bytes.length);
    }
  },
  clean:s=>String(s==null?'':s).replace(/\uFEFF/g,'').replace(/\u0000+/g,' ').replace(/\s+/g,' ').trim(),
  sniffImage(b){
    if(b.length<12)return '';
    if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return 'image/jpeg';
    if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47)return 'image/png';
    if(b[0]===0x47&&b[1]===0x49&&b[2]===0x46)return 'image/gif';
    if(b[0]===0x42&&b[1]===0x4D)return 'image/bmp';
    if(Bin.ascii(b,0,4)==='RIFF'&&Bin.ascii(b,8,4)==='WEBP')return 'image/webp';
    return '';
  }
};

/* ------------------------------------------------------------
   ID3v2 / ID3v1
   ------------------------------------------------------------ */
class ID3Reader{
  static async read(blob){
    const out={
      tagSize:0,hasV2:false,hasV1:false,
      title:'',artist:'',albumArtist:'',album:'',composer:'',narrator:'',
      track:0,trackTotal:0,disc:0,year:'',comment:'',
      cover:null,chapters:[]
    };
    let head;
    try{head=await Bin.read(blob,0,10)}catch(e){return out}
    const valid=head.length>=10&&head[0]===0x49&&head[1]===0x44&&head[2]===0x33&&
      head[3]>=2&&head[3]<=4&&head[6]<0x80&&head[7]<0x80&&head[8]<0x80&&head[9]<0x80;
    if(valid){
      const ver=head[3],flags=head[5];
      const size=Bin.syncsafe(head,6);
      const footer=(ver===4&&(flags&0x10))?10:0;
      out.tagSize=10+size+footer;
      out.hasV2=true;
      if(size>0&&size<=48*1024*1024){
        let body=await Bin.read(blob,10,10+size);
        if((flags&0x80)&&ver<4)body=Bin.unsync(body);
        let p=0;
        if(flags&0x40){
          if(ver===3&&body.length>=4)p=4+Bin.u32(body,0);
          else if(ver===4&&body.length>=4)p=Bin.syncsafe(body,0);
        }
        ID3Reader.apply(out,ID3Reader.frames(body.subarray(Math.min(p,body.length)),ver),ver);
      }
    }
    const v1=await ID3Reader.readV1(blob);
    if(v1){
      out.hasV1=true;
      if(!out.title)out.title=v1.title;
      if(!out.artist)out.artist=v1.artist;
      if(!out.album)out.album=v1.album;
      if(!out.year)out.year=v1.year;
      if(!out.track)out.track=v1.track;
    }
    out.chapters.sort((a,b)=>a.start-b.start);
    return out;
  }
  static async readV1(blob){
    try{
      if(blob.size<128)return null;
      const b=await Bin.read(blob,blob.size-128,blob.size);
      if(Bin.ascii(b,0,3)!=='TAG')return null;
      const f=(o,n)=>Bin.clean(Bin.text(b.subarray(o,o+n),0));
      return{title:f(3,30),artist:f(33,30),album:f(63,30),year:f(93,4),track:(b[125]===0&&b[126]!==0)?b[126]:0};
    }catch(e){return null}
  }
  /* Percorre os quadros de uma etiqueta. `lenient` tolera lixo no fim
     (sub-quadros de CHAP), sem lançar erro. */
  static frames(body,ver,lenient){
    const out=[];
    const idLen=ver===2?3:4,hdr=ver===2?6:10;
    let p=0;
    while(p+hdr<=body.length){
      if(body[p]===0)break;
      let id=Bin.ascii(body,p,idLen);
      if(!/^[A-Z0-9]+$/.test(id))break;
      let fsize,fflags=0;
      if(ver===2)fsize=Bin.u24(body,p+3);
      else if(ver===4)fsize=Bin.syncsafe(body,p+4);
      else fsize=Bin.u32(body,p+4);
      if(ver!==2)fflags=Bin.u16(body,p+8);
      const start=p+hdr,end=start+fsize;
      if(fsize<0||end>body.length){
        if(!lenient||start>=body.length)break;
      }
      let data=body.subarray(start,Math.min(end,body.length));
      let skip=false;
      if(ver===4){
        if(fflags&0x000C)skip=true;               /* compressão / criptografia */
        else{
          if(fflags&0x0040)data=data.subarray(1);  /* grupo */
          if(fflags&0x0001)data=data.subarray(4);  /* indicador de tamanho */
          if(fflags&0x0002)data=Bin.unsync(data);
        }
      }else if(ver===3){
        if(fflags&0x00C0)skip=true;
        else if(fflags&0x0020)data=data.subarray(1);
      }
      id=ID3Reader.ID_MAP[id]||id;
      if(!skip)out.push({id,data});
      p=end;
    }
    return out;
  }
  static strings(data){
    if(!data||data.length<2)return[];
    return Bin.text(data.subarray(1),data[0]).split('\u0000').map(Bin.clean).filter(Boolean);
  }
  static apply(out,frames,ver){
    for(const f of frames){
      try{
        const d=f.data;
        switch(f.id){
          case 'TIT2':out.title=out.title||ID3Reader.strings(d)[0]||'';break;
          case 'TPE1':out.artist=out.artist||ID3Reader.strings(d).join(', ');break;
          case 'TPE2':out.albumArtist=out.albumArtist||ID3Reader.strings(d).join(', ');break;
          case 'TALB':out.album=out.album||ID3Reader.strings(d)[0]||'';break;
          case 'TCOM':out.composer=out.composer||ID3Reader.strings(d).join(', ');break;
          case 'TYER':case 'TDRC':out.year=out.year||(ID3Reader.strings(d)[0]||'').slice(0,4);break;
          case 'TRCK':{
            const m=(ID3Reader.strings(d)[0]||'').match(/^(\d+)(?:\/(\d+))?/);
            if(m){out.track=parseInt(m[1],10)||0;out.trackTotal=parseInt(m[2],10)||0}
            break;
          }
          case 'TPOS':{
            const m=(ID3Reader.strings(d)[0]||'').match(/^(\d+)/);
            if(m)out.disc=parseInt(m[1],10)||0;
            break;
          }
          case 'COMM':{
            if(d.length<5)break;
            const parts=Bin.text(d.subarray(4),d[0]).split('\u0000');
            const text=Bin.clean(parts.slice(1).join(' '));
            if(text&&!out.comment)out.comment=text;
            break;
          }
          case 'TXXX':{
            if(d.length<3)break;
            const parts=Bin.text(d.subarray(1),d[0]).split('\u0000');
            if(/narrat/i.test(Bin.clean(parts[0]))&&!out.narrator)out.narrator=Bin.clean(parts.slice(1).join(' '));
            break;
          }
          case 'APIC':{
            const pic=ID3Reader.picture(d,ver);
            if(pic&&(!out.cover||(pic.type===3&&out.cover.type!==3)))out.cover=pic;
            break;
          }
          case 'CHAP':{
            const ch=ID3Reader.chapter(d,ver);
            if(ch)out.chapters.push(ch);
            break;
          }
        }
      }catch(e){/* um quadro defeituoso não derruba a leitura */}
    }
  }
  static picture(data,ver){
    if(data.length<8)return null;
    const enc=data[0];let i=1,mime='';
    if(ver===2){mime='image/'+Bin.ascii(data,1,3).toLowerCase();i=4}
    else{
      let j=i;
      while(j<data.length&&data[j]!==0)j++;
      mime=Bin.ascii(data,i,j-i).toLowerCase();
      i=j+1;
    }
    const type=data[i++];
    if(enc===1||enc===2){
      while(i+1<data.length&&!(data[i]===0&&data[i+1]===0))i+=2;
      i+=2;
    }else{
      while(i<data.length&&data[i]!==0)i++;
      i++;
    }
    const bytes=data.subarray(i);
    const real=Bin.sniffImage(bytes);
    if(!real)return null;
    return{type,mime:real,bytes};
  }
  static chapter(data,ver){
    let i=0;
    while(i<data.length&&data[i]!==0)i++;
    i++;
    if(i+16>data.length)return null;
    const startMs=Bin.u32(data,i),endMs=Bin.u32(data,i+4);
    i+=16;
    let title='';
    for(const f of ID3Reader.frames(data.subarray(i),ver,true)){
      if(f.id==='TIT2'){title=ID3Reader.strings(f.data)[0]||title;break}
      if((f.id==='TIT3'||f.id==='TIT1')&&!title)title=ID3Reader.strings(f.data)[0]||'';
    }
    return{title,start:startMs/1000,end:endMs<0xFFFFFFFF?endMs/1000:null};
  }
}
ID3Reader.ID_MAP={TT2:'TIT2',TP1:'TPE1',TP2:'TPE2',TAL:'TALB',TCM:'TCOM',TRK:'TRCK',TYE:'TYER',TPA:'TPOS',PIC:'APIC',COM:'COMM',TXX:'TXXX'};

/* ------------------------------------------------------------
   Cabeçalho MPEG: duração exata sem decodificar o arquivo
   ------------------------------------------------------------ */
class MP3Info{
  static async read(blob,audioStart,trailer=0){
    const buf=await Bin.read(blob,audioStart,audioStart+65536);
    for(let i=0;i+4<buf.length;i++){
      if(buf[i]!==0xFF||(buf[i+1]&0xE0)!==0xE0)continue;
      const h=MP3Info.header(buf,i);
      if(!h)continue;
      /* confirma com o quadro seguinte, para não confundir lixo com áudio */
      const next=i+h.frameLen;
      if(next+4<=buf.length){
        if(buf[next]!==0xFF||(buf[next+1]&0xE0)!==0xE0)continue;
      }
      let frames=null,vbr=false;
      const off=i+4+(h.crc?2:0);
      const side=h.mpeg1?(h.mono?17:32):(h.mono?9:17);
      const tag=Bin.ascii(buf,off+side,4);
      if(tag==='Xing'||tag==='Info'){
        const flags=Bin.u32(buf,off+side+4);
        if(flags&1)frames=Bin.u32(buf,off+side+8);
        vbr=tag==='Xing';
      }else if(Bin.ascii(buf,i+4+32,4)==='VBRI'){
        frames=Bin.u32(buf,i+4+32+14);
        vbr=true;
      }
      let duration=null;
      if(frames)duration=frames*h.spf/h.sampleRate;
      else{
        const bytes=blob.size-audioStart-trailer;
        if(h.bitrate>0)duration=bytes*8/(h.bitrate*1000);
      }
      return{duration,bitrate:h.bitrate,sampleRate:h.sampleRate,vbr,channels:h.mono?1:2};
    }
    return null;
  }
  static header(b,i){
    const b1=b[i+1],b2=b[i+2],b3=b[i+3];
    const vBits=(b1>>3)&3,lBits=(b1>>1)&3;
    if(vBits===1||lBits===0)return null;
    const brIdx=b2>>4,srIdx=(b2>>2)&3;
    if(brIdx===0||brIdx===15||srIdx===3)return null;
    const mpeg1=vBits===3;
    const layer=4-lBits;                       /* 1, 2 ou 3 */
    const table=MP3Info.BITRATES[(mpeg1?'1':'2')+layer];
    const bitrate=table[brIdx];
    const sampleRate=MP3Info.RATES[vBits][srIdx];
    const pad=(b2>>1)&1;
    const spf=layer===1?384:(layer===3&&!mpeg1?576:1152);
    let frameLen;
    if(layer===1)frameLen=(Math.floor(12*bitrate*1000/sampleRate)+pad)*4;
    else frameLen=Math.floor((spf/8)*bitrate*1000/sampleRate)+pad;
    if(!(frameLen>4))return null;
    return{mpeg1,layer,bitrate,sampleRate,spf,frameLen,mono:(b3>>6)===3,crc:(b1&1)===0};
  }
}
MP3Info.BITRATES={
  '11':[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
  '12':[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
  '13':[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],
  '21':[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
  '22':[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
  '23':[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]
};
MP3Info.RATES={3:[44100,48000,32000],2:[22050,24000,16000],0:[11025,12000,8000]};

/* ------------------------------------------------------------
   MP4 / M4B
   ------------------------------------------------------------ */
class MP4Reader{
  static async box(blob,off,limit){
    if(off+8>limit)return null;
    const b=await Bin.read(blob,off,Math.min(off+16,limit));
    if(b.length<8)return null;
    let size=Bin.u32(b,0),hs=8;
    const type=Bin.ascii(b,4,4);
    if(size===1){
      if(b.length<16)return null;
      size=Bin.u64(b,8);hs=16;
    }else if(size===0){
      size=limit-off;
    }
    if(size<hs)return null;
    const end=Math.min(off+size,limit);
    return{type,start:off,hs,size:end-off,end,body:off+hs};
  }
  static async children(blob,parent){
    let skip=0;
    if(parent.type==='meta'){
      /* 'meta' do iTunes é uma "full box" (4 bytes extras); o do QuickTime antigo não é */
      const peek=await Bin.read(blob,parent.body,parent.body+8);
      skip=Bin.ascii(peek,4,4)==='hdlr'?0:4;
    }
    const out=[];
    let p=parent.body+skip,guard=0;
    while(p+8<=parent.end&&guard++<20000){
      const h=await MP4Reader.box(blob,p,parent.end);
      if(!h)break;
      out.push(h);
      p=h.end;
    }
    return out;
  }
  static async child(blob,parent,type){
    if(!parent)return null;
    return(await MP4Reader.children(blob,parent)).find(c=>c.type===type)||null;
  }
  static async path(blob,parent,types){
    let cur=parent;
    for(const t of types){
      if(!cur)return null;
      cur=await MP4Reader.child(blob,cur,t);
    }
    return cur;
  }
  static async payload(blob,box,max=1<<20){
    return Bin.read(blob,box.body,Math.min(box.end,box.body+max));
  }
  static async parse(blob){
    const info={
      duration:null,brand:'',codec:'',drm:false,isAudiobook:false,
      title:'',artist:'',albumArtist:'',album:'',narrator:'',composer:'',description:'',year:'',
      cover:null,chapters:[]
    };
    let p=0,moov=null,first=true;
    while(p<blob.size){
      const h=await MP4Reader.box(blob,p,blob.size);
      if(!h)break;
      if(first){
        first=false;
        if(h.type==='ftyp'){
          const b=await Bin.read(blob,h.body,h.body+4);
          info.brand=Bin.ascii(b,0,4).trim();
        }
      }
      if(h.type==='moov'){moov=h;break}
      p=h.end;
    }
    if(!moov)throw new Error('mp4: moov não encontrado');
    const kids=await MP4Reader.children(blob,moov);
    const mvhd=kids.find(k=>k.type==='mvhd');
    if(mvhd){
      const b=await Bin.read(blob,mvhd.body,mvhd.body+32);
      const ts=b[0]===1?Bin.u32(b,20):Bin.u32(b,12);
      const dur=b[0]===1?Bin.u64(b,24):Bin.u32(b,16);
      if(ts>0&&dur>0)info.duration=dur/ts;
    }
    const traks=kids.filter(k=>k.type==='trak');
    /* codec / DRM — olhamos a descrição de amostra de cada faixa */
    for(const trak of traks){
      try{
        const stsd=await MP4Reader.path(blob,trak,['mdia','minf','stbl','stsd']);
        if(!stsd)continue;
        const b=await Bin.read(blob,stsd.body,stsd.body+16);
        const fmt=Bin.ascii(b,12,4);
        if(fmt==='drms'||fmt==='enca')info.drm=true;
        if(!info.codec&&/^(mp4a|alac|ac-3|ec-3|Opus|fLaC|samr|drms|enca)$/.test(fmt))info.codec=fmt;
      }catch(e){}
    }
    /* etiquetas */
    let ilst=null,udta=null;
    try{
      udta=kids.find(k=>k.type==='udta')||null;
      const metaBox=(udta?await MP4Reader.child(blob,udta,'meta'):null)||kids.find(k=>k.type==='meta')||null;
      ilst=metaBox?await MP4Reader.child(blob,metaBox,'ilst'):null;
    }catch(e){}
    if(ilst)await MP4Reader.readTags(blob,ilst,info);
    /* capítulos: Nero (chpl) e/ou faixa de texto do QuickTime */
    let nero=[],qt=[];
    try{nero=udta?await MP4Reader.neroChapters(blob,udta):[]}catch(e){}
    try{qt=await MP4Reader.textTrackChapters(blob,traks)}catch(e){}
    info.chapters=qt.length>nero.length?qt:nero;
    return info;
  }
  static async readTags(blob,ilst,info){
    const MAP={
      '\u00A9nam':'title','\u00A9ART':'artist','aART':'albumArtist','\u00A9alb':'album',
      '\u00A9nrt':'narrator','\u00A9wrt':'composer','desc':'description','ldes':'description',
      '\u00A9cmt':'description','\u00A9day':'year'
    };
    for(const item of await MP4Reader.children(blob,ilst)){
      try{
        const data=await MP4Reader.child(blob,item,'data');
        if(!data)continue;
        if(item.type==='covr'){
          if(info.cover)continue;
          const start=data.body+8;
          if(data.end-start<32)continue;
          const head=await Bin.read(blob,start,start+16);
          const mime=Bin.sniffImage(head);
          if(mime&&data.end-start<=32*1024*1024)info.cover={mime,blob:blob.slice(start,data.end,mime)};
          continue;
        }
        if(item.type==='stik'){
          const b=await Bin.read(blob,data.body+8,data.body+9);
          if(b[0]===2)info.isAudiobook=true;
          continue;
        }
        const key=MAP[item.type];
        if(!key)continue;
        const b=await Bin.read(blob,data.body+8,Math.min(data.end,data.body+8+16384));
        const text=Bin.clean(Bin.text(b,3));
        if(text&&!info[key])info[key]=key==='year'?text.slice(0,4):text;
      }catch(e){}
    }
  }
  /* Capítulos no formato Nero: um único átomo com todos os títulos. */
  static async neroChapters(blob,udta){
    const chpl=await MP4Reader.child(blob,udta,'chpl');
    if(!chpl)return[];
    const b=await MP4Reader.payload(blob,chpl,4<<20);
    let p=4;
    if(b[0]===1)p+=4;
    p+=1;                                   /* contagem (ignorada: lemos até o fim) */
    const out=[];
    while(p+9<=b.length){
      const start=Bin.u64(b,p)/1e7;p+=8;
      const len=b[p++];
      if(p+len>b.length)break;
      out.push({title:Bin.clean(Bin.text(b.subarray(p,p+len),3)),start});
      p+=len;
    }
    return out;
  }
  /* Capítulos como faixa de texto (tref/chap) — o padrão do QuickTime e do Apple Books. */
  static async textTrackChapters(blob,traks){
    let chapId=null;
    for(const trak of traks){
      const tref=await MP4Reader.child(blob,trak,'tref');
      if(!tref)continue;
      const chap=await MP4Reader.child(blob,tref,'chap');
      if(!chap||chap.end-chap.body<4)continue;
      chapId=Bin.u32(await Bin.read(blob,chap.body,chap.body+4),0);
      break;
    }
    if(chapId==null)return[];
    for(const trak of traks){
      const tkhd=await MP4Reader.child(blob,trak,'tkhd');
      if(!tkhd)continue;
      const tb=await Bin.read(blob,tkhd.body,tkhd.body+24);
      const id=tb[0]===1?Bin.u32(tb,20):Bin.u32(tb,12);
      if(id!==chapId)continue;
      const mdia=await MP4Reader.child(blob,trak,'mdia');
      const mdhd=await MP4Reader.child(blob,mdia,'mdhd');
      if(!mdhd)return[];
      const mh=await Bin.read(blob,mdhd.body,mdhd.body+32);
      const timescale=mh[0]===1?Bin.u32(mh,20):Bin.u32(mh,12);
      const stbl=await MP4Reader.path(blob,mdia,['minf','stbl']);
      if(!stbl||!timescale)return[];
      const sk=await MP4Reader.children(blob,stbl);
      const get=async t=>{const bx=sk.find(k=>k.type===t);return bx?MP4Reader.payload(blob,bx,16<<20):null};
      const stts=await get('stts'),stsz=await get('stsz'),stsc=await get('stsc');
      const stco=(await get('stco'))||null,co64=stco?null:await get('co64');
      if(!stts||!stsz||!stsc||(!stco&&!co64))return[];
      /* instantes de início de cada amostra */
      const starts=[];
      let t=0;
      const nStts=Bin.u32(stts,4);
      for(let e=0;e<nStts&&8+e*8+8<=stts.length;e++){
        const cnt=Bin.u32(stts,8+e*8),delta=Bin.u32(stts,12+e*8);
        for(let k=0;k<cnt&&starts.length<20000;k++){starts.push(t);t+=delta}
      }
      /* tamanhos */
      const fixed=Bin.u32(stsz,4),count=Math.min(Bin.u32(stsz,8),starts.length,20000);
      const sizes=[];
      for(let s=0;s<count;s++)sizes.push(fixed||Bin.u32(stsz,12+s*4));
      /* posição de cada amostra no arquivo */
      const nSc=Bin.u32(stsc,4);
      const runs=[];
      for(let e=0;e<nSc&&8+e*12+12<=stsc.length;e++)runs.push({first:Bin.u32(stsc,8+e*12),per:Bin.u32(stsc,12+e*12)});
      const src=stco||co64,wide=!stco;
      const nCh=Bin.u32(src,4);
      const offsets=[];
      let si=0;
      for(let c=1;c<=nCh&&si<count;c++){
        let per=1;
        for(const r of runs){if(r.first<=c)per=r.per;else break}
        let off=wide?Bin.u64(src,8+(c-1)*8):Bin.u32(src,8+(c-1)*4);
        for(let k=0;k<per&&si<count;k++){offsets.push(off);off+=sizes[si];si++}
      }
      const out=[];
      for(let s=0;s<count&&s<offsets.length;s++){
        let title='';
        if(sizes[s]>=2){
          const sb=await Bin.read(blob,offsets[s],offsets[s]+Math.min(sizes[s],2048));
          const len=Math.min(Bin.u16(sb,0),sb.length-2);
          const bytes=sb.subarray(2,2+len);
          title=Bin.clean(Bin.text(bytes,(bytes[0]===0xFE&&bytes[1]===0xFF)?1:3));
        }
        out.push({title,start:starts[s]/timescale});
      }
      return out;
    }
    return[];
  }
}

/* ------------------------------------------------------------
   Interface única para o resto do aplicativo
   ------------------------------------------------------------ */
class AudioMeta{
  static async read(file,format){
    format=String(format||AudioFormats.ext(file.name)).toLowerCase();
    if(format==='m4b'||format==='mp4')return AudioMeta.readMp4(file,format);
    return AudioMeta.readMp3(file);
  }
  static async readMp3(file){
    const id3=await ID3Reader.read(file);
    let info=null;
    try{info=await MP3Info.read(file,id3.tagSize,id3.hasV1?128:0)}catch(e){}
    let cover=null;
    if(id3.cover)cover={blob:new Blob([id3.cover.bytes],{type:id3.cover.mime})};
    return{
      format:'mp3',
      title:id3.title,album:id3.album,
      author:id3.artist||id3.albumArtist||id3.composer,
      narrator:id3.narrator,description:id3.comment,year:id3.year,
      track:id3.track,trackTotal:id3.trackTotal,disc:id3.disc,
      cover,chapters:id3.chapters.map(c=>({title:c.title,start:c.start})),
      duration:info&&info.duration?info.duration:null,
      bitrate:info?info.bitrate:0,vbr:!!(info&&info.vbr),drm:false,codec:'mp3'
    };
  }
  static async readMp4(file,format='m4b'){
    const m=await MP4Reader.parse(file);
    return{
      format:format==='mp4'?'mp4':'m4b',
      title:m.title||m.album,album:m.album,
      author:m.artist||m.albumArtist||'',
      narrator:m.narrator,description:m.description,year:m.year,
      track:0,trackTotal:0,disc:0,
      cover:m.cover?{blob:m.cover.blob}:null,
      chapters:m.chapters,duration:m.duration,
      bitrate:0,vbr:false,drm:m.drm,codec:m.codec||'mp4a'
    };
  }
}

/* Limpa e completa a lista de capítulos: ordem, fim de cada um, títulos. */
const AudioChapters={
  normalize(list,duration){
    let ch=(list||[])
      .map(c=>({title:Bin.clean(c.title||''),start:Number(c.start)}))
      .filter(c=>Number.isFinite(c.start)&&c.start>=0)
      .sort((a,b)=>a.start-b.start);
    const out=[];
    for(const c of ch){
      const last=out[out.length-1];
      if(last&&c.start-last.start<0.5)continue;
      if(duration&&c.start>=duration-0.5)continue;
      out.push(c);
    }
    if(out.length<2)return[];
    if(out[0].start>0.5)out.unshift({title:'Início',start:0});
    out.forEach((c,i)=>{
      c.end=i<out.length-1?out[i+1].start:(duration||c.start);
      if(!c.title)c.title=`Capítulo ${i+1}`;
    });
    return out;
  }
};

/* ============================================================
   AUDIOLIVROS — IMPORTAÇÃO
   ------------------------------------------------------------
   Como o áudio é guardado (a decisão que sustenta o resto):

   • O arquivo entra no IndexedDB como Blob, nunca como
     ArrayBuffer. Um Blob fica no disco e só é lido quando o
     <audio> pede — um audiolivro de 1 GB não ocupa 1 GB de
     memória, e "arquivo grande" deixa de ser um caso especial.
   • O registro no store "files" ganha um formato próprio
     ({id, kind:'audio', blobs:[…]}); os livros de texto seguem
     com {id, buffer}. Os dois convivem sem migração e sem subir
     a versão do banco.
   • Um audiolivro é uma LINHA DO TEMPO única, formada por uma ou
     mais faixas (um M4B / MP3 grande = 1 faixa; uma pasta de
     capítulos em MP3 = N faixas). O player só conhece a linha do
     tempo; por isso "um arquivo" e "vários arquivos" usam o mesmo
     código de reprodução, capítulos, marcadores e progresso.
   • Livro e arquivo são gravados numa transação só: ou entra
     tudo, ou nada (sem livro "fantasma" na estante).
   ============================================================ */
const AudioCover={
  MAX:720,
  async fromBlob(blob){
    if(!blob||!blob.size||blob.size>25*1024*1024)return null;
    try{
      const img=await AudioCover.decode(blob);
      const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
      if(!w||!h)throw new Error('imagem vazia');
      const scale=Math.min(1,AudioCover.MAX/Math.max(w,h));
      const cw=Math.max(1,Math.round(w*scale)),ch=Math.max(1,Math.round(h*scale));
      const canvas=document.createElement('canvas');
      canvas.width=cw;canvas.height=ch;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,cw,ch);
      ctx.drawImage(img,0,0,cw,ch);
      if(typeof img.close==='function')img.close();
      return{dataUrl:canvas.toDataURL('image/jpeg',.86),aspect:w/h};
    }catch(e){
      console.warn('Capa do audiolivro não processada:',e);
      return null;
    }
  },
  decode(blob){
    if(typeof createImageBitmap==='function')return createImageBitmap(blob).catch(()=>AudioCover.viaImage(blob));
    return AudioCover.viaImage(blob);
  },
  viaImage(blob){
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(blob);
      const img=new Image();
      const timer=setTimeout(()=>{URL.revokeObjectURL(url);reject(new Error('imagem demorou demais'))},8000);
      img.onload=()=>{clearTimeout(timer);URL.revokeObjectURL(url);resolve(img)};
      img.onerror=()=>{clearTimeout(timer);URL.revokeObjectURL(url);reject(new Error('imagem inválida'))};
      img.src=url;
    });
  }
};

/* ------------------------------------------------------------
   Capa de vídeo
   ------------------------------------------------------------
   Um MP4 pode trazer capa nas etiquetas (átomo "covr"); quando não
   traz, pegamos um quadro do próprio vídeo — assim a estante nunca
   mostra um retângulo vazio. Tudo acontece no aparelho e o arquivo
   original não é tocado.
   ------------------------------------------------------------ */
const VideoCover={
  MAX:720,
  /* Tenta 3 instantes: 10% do vídeo, 2s e 0s. O primeiro quadro que
     não for preto vira a capa. */
  async fromFile(file,duration){
    if(!file)return null;
    const dur=Number.isFinite(duration)&&duration>0?duration:0;
    const times=[dur?Math.min(dur*0.1,60):1.5,2,0.2].filter((v,i,a)=>a.indexOf(v)===i);
    for(const t of times){
      try{
        const r=await VideoCover.grab(file,t);
        if(r&&r.shot)return r.shot;
        /* O navegador não decodifica este vídeo: insistir só faria o
           usuário esperar à toa. A estante usa a capa padrão. */
        if(r&&r.fatal)return null;
      }catch(e){ /* tenta o próximo instante */ }
    }
    return null;
  },
  grab(file,time){
    return new Promise(resolve=>{
      const url=URL.createObjectURL(file);
      const v=document.createElement('video');
      v.preload='metadata';v.muted=true;v.playsInline=true;
      v.setAttribute('playsinline','');v.crossOrigin='anonymous';
      let done=false;
      const finish=result=>{
        if(done)return;done=true;
        clearTimeout(timer);
        v.onloadeddata=v.onseeked=v.onerror=v.onloadedmetadata=null;
        try{v.removeAttribute('src');v.load()}catch(e){}
        URL.revokeObjectURL(url);
        resolve(result);
      };
      const timer=setTimeout(()=>finish({fatal:true}),12000);
      const draw=()=>{
        try{
          const w=v.videoWidth,h=v.videoHeight;
          if(!w||!h)return finish({fatal:true});
          const scale=Math.min(1,VideoCover.MAX/Math.max(w,h));
          const cw=Math.max(1,Math.round(w*scale)),chh=Math.max(1,Math.round(h*scale));
          const canvas=document.createElement('canvas');
          canvas.width=cw;canvas.height=chh;
          const ctx=canvas.getContext('2d');
          ctx.drawImage(v,0,0,cw,chh);
          if(!VideoCover.hasContent(ctx,cw,chh))return finish({});
          finish({shot:{dataUrl:canvas.toDataURL('image/jpeg',.82),aspect:w/h}});
        }catch(e){finish({fatal:true})}
      };
      v.onloadedmetadata=()=>{
        const target=Utils.clamp(time,0,Math.max(0,(v.duration||0)-0.2));
        if(!Number.isFinite(target)){draw();return}
        v.onseeked=draw;
        try{v.currentTime=target}catch(e){draw()}
      };
      v.onerror=()=>finish({fatal:true});
      v.src=url;
    });
  },
  /* Descarta quadros totalmente pretos (abertura de muitos vídeos). */
  hasContent(ctx,w,h){
    try{
      const data=ctx.getImageData(0,0,Math.min(w,64),Math.min(h,64)).data;
      let sum=0;
      for(let i=0;i<data.length;i+=4)sum+=data[i]+data[i+1]+data[i+2];
      return sum/(data.length/4)>18;
    }catch(e){return true}
  }
};

const AudioImport={
  tagCache:new WeakMap(),
  collator:(typeof Intl!=='undefined'&&Intl.Collator)?new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'}):null,
  compare(a,b){return this.collator?this.collator.compare(a,b):String(a).localeCompare(String(b))},

  async tags(file){
    let t=this.tagCache.get(file);
    if(!t){
      const format=AudioFormats.ext(file.name);
      try{t=await AudioMeta.read(file,format)}
      catch(e){
        console.warn('Metadados ilegíveis:',e);
        throw new ParseError(
          `Este arquivo não é um ${AudioFormats.label(format)} válido.`,
          'Confira se a extensão corresponde ao conteúdo ou converta o áudio para MP3 ou M4B (AAC).'
        );
      }
      this.tagCache.set(file,t);
    }
    return t;
  },
  cleanName(name){
    return String(name||'').replace(/\.[^/.]+$/,'').replace(/_+/g,' ').replace(/\s+/g,' ').trim();
  },

  /* ---------- verificação de espaço e de reprodução ---------- */
  async ensureSpace(bytes){
    try{
      if(!(navigator.storage&&navigator.storage.estimate))return;
      const {quota,usage}=await navigator.storage.estimate();
      if(quota&&usage!=null&&quota-usage<bytes*1.05){
        throw new ParseError(
          'Não há espaço suficiente no aparelho para este audiolivro.',
          `O arquivo tem ${Utils.fmtBytes(bytes)} e restam cerca de ${Utils.fmtBytes(Math.max(0,quota-usage))}. Libere espaço ou exclua livros da biblioteca.`
        );
      }
    }catch(e){if(e instanceof ParseError)throw e}
  },
  /* Pergunta ao próprio navegador se ele consegue tocar o arquivo — pega
     codecs sem suporte (ALAC, AC-3…) na importação, não na hora de ouvir. */
  probe(blob,format){
    return new Promise(resolve=>{
      /* vídeo precisa de um <video>: um <audio> recusa alguns MP4 */
      const a=document.createElement(AudioFormats.isVideo(format)?'video':'audio');
      a.preload='metadata';
      a.muted=true;
      const url=URL.createObjectURL(blob.slice(0,blob.size,AudioFormats.mime(format)));
      let done=false;
      const finish=r=>{
        if(done)return;done=true;
        clearTimeout(timer);
        a.onloadedmetadata=a.onerror=null;
        try{a.removeAttribute('src');a.load()}catch(e){}
        URL.revokeObjectURL(url);
        resolve(r);
      };
      a.onloadedmetadata=()=>finish({ok:true,duration:Number.isFinite(a.duration)&&a.duration>0?a.duration:null});
      a.onerror=()=>finish({ok:false,code:a.error&&a.error.code});
      const timer=setTimeout(()=>finish({ok:null}),10000);   /* iOS pode não carregar sem toque: não é erro */
      a.src=url;
    });
  },
  unplayable(tags,format){
    const video=AudioFormats.isVideo(format);
    if(tags&&tags.drm)return new ParseError(`Este ${AudioFormats.noun(format)} está protegido por DRM.`,'Arquivos com proteção não podem ser reproduzidos aqui. Use uma cópia sem DRM.');
    if(tags&&/^(alac|ac-3|ec-3)$/i.test(tags.codec||''))return new ParseError(
      'O navegador não reproduz o formato de áudio deste arquivo.',
      video?'Converta o vídeo para MP4 com áudio AAC e vídeo H.264 e importe novamente.'
           :'Converta o audiolivro para M4B com áudio AAC (ou para MP3) e importe novamente.');
    return new ParseError(
      `Este ${AudioFormats.label(format)} não pode ser reproduzido neste navegador.`,
      video?'O arquivo pode estar corrompido ou usar um codec sem suporte. Tente converter para MP4 com vídeo H.264 e áudio AAC.'
           :'O arquivo pode estar corrompido ou usar um codec sem suporte. Tente converter para MP3 ou M4B (AAC).');
  },

  /* ---------- um arquivo = um audiolivro ---------- */
  async buildSingle(file,{fingerprint=null,onStatus=null}={}){
    const format=AudioFormats.ext(file.name);
    const video=AudioFormats.isVideo(format);
    const say=t=>{try{onStatus&&onStatus(t)}catch(e){}};
    say('Lendo título, capítulos e capa...');
    const tags=await this.tags(file);
    if(tags.drm)throw this.unplayable(tags,format);
    say(video?'Conferindo se o vídeo pode ser reproduzido...':'Conferindo se o áudio pode ser reproduzido...');
    const probe=await this.probe(file,format);
    if(probe.ok===false)throw this.unplayable(tags,format);
    let duration=tags.duration;
    if(probe.ok&&probe.duration&&(!duration||Math.abs(duration-probe.duration)>2))duration=probe.duration;
    if(!(duration>0)){
      throw new ParseError(`Não foi possível descobrir a duração deste ${video?'vídeo':'áudio'}.`,'O arquivo pode estar incompleto. Tente baixá-lo novamente.');
    }
    const base=this.cleanName(file.name);
    let title=tags.title;
    if(format==='mp3'&&tags.album){
      const generic=/^(cap[ií]tulo|chapter|parte|part|faixa|track|cd|disco)?\s*\d+/i.test(tags.title||'');
      if(!tags.title||generic||tags.title===tags.album)title=tags.album;
    }
    title=Bin.clean(title)||base||(video?'Vídeo':'Audiolivro');
    say('Preparando a capa...');
    let cover=await AudioCover.fromBlob(tags.cover&&tags.cover.blob);
    /* MP4 sem capa nas etiquetas: usamos um quadro do próprio vídeo. */
    if(!cover&&video)cover=await VideoCover.fromFile(file,duration);
    const chapters=AudioChapters.normalize(tags.chapters,duration);
    const hash=fingerprint||await FileFingerprint.hashBlob(file);
    const mime=AudioFormats.mime(format);
    const meta={
      id:Utils.id(),title,author:tags.author||'Autor Desconhecido',format,
      sourceFileName:file.name,addedAt:Date.now(),
      cover:cover?cover.dataUrl:null,coverAspect:cover?cover.aspect:null,
      progress:null,status:'toread',favorite:false,
      tags:[],collections:[],series:'',folder:'',bookmarks:[],annotations:[],
      order:Date.now(),manualOrder:false,fileHash:hash,fileSize:file.size,
      audio:{
        v:1,duration,narrator:tags.narrator||'',description:(tags.description||'').slice(0,1200),year:tags.year||'',
        tracks:[{name:file.name,title:'',size:file.size,mime,duration,offset:0}],
        chapters,speed:null
      }
    };
    return{meta,blobs:[file.slice(0,file.size,mime)]};
  },

  /* ---------- vários MP3 = um audiolivro ---------- */
  chapterTitle(file,tags,index,useTags){
    let raw=useTags&&tags.title?tags.title:this.cleanName(file.name);
    raw=Bin.clean(raw);
    if(/^\d{1,4}$/.test(raw))raw=`Capítulo ${parseInt(raw,10)}`;
    return raw||`Capítulo ${index+1}`;
  },
  sortFiles(files,tagsList){
    const items=files.map((f,i)=>({f,t:tagsList[i]}));
    const numbered=items.every(x=>x.t&&x.t.track>0);
    items.sort((a,b)=>{
      if(numbered){
        const d=(a.t.disc||0)-(b.t.disc||0);
        if(d)return d;
        const tr=a.t.track-b.t.track;
        if(tr)return tr;
      }
      return this.compare(a.f.name,b.f.name);
    });
    return{files:items.map(x=>x.f),tags:items.map(x=>x.t)};
  },
  commonName(names){
    if(!names.length)return'';
    let p=names[0];
    for(const n of names){
      let i=0;
      while(i<p.length&&i<n.length&&p[i].toLowerCase()===n[i].toLowerCase())i++;
      p=p.slice(0,i);
    }
    return p
      .replace(/[\s\-–—_.,:;()\[\]#]*\d*[\s\-–—_.,:;()\[\]#]*$/,'')
      .replace(/\b(cap[ií]tulo|cap|parte|part|faixa|track|disco|disc|cd)\b\.?$/i,'')
      .replace(/[\s\-–—_.,:;()\[\]#]+$/,'')
      .trim();
  },
  /* Devolve um plano se os arquivos parecem partes do mesmo livro; senão null. */
  async analyzeGroup(files){
    const tags=[];
    for(const f of files){
      try{tags.push(await this.tags(f))}catch(e){return null}
    }
    const norm=FileFingerprint.normalize;
    const albums=tags.map(t=>norm(t.album));
    const names=files.map(f=>this.cleanName(f.name));
    let reason='',title='';
    if(albums.every(a=>a)&&new Set(albums).size===1){
      reason='album';title=tags[0].album;
    }else if(albums.every(a=>!a)){
      const base=this.commonName(names);
      const shape=names.map(n=>n.replace(/\d+/g,'#'));
      if(base.length>=3){reason='nome';title=base}
      else if(files.length>=3&&new Set(shape).size===1){reason='sequência';title=''}
    }
    if(!reason)return null;
    const ordered=this.sortFiles(files,tags);
    const author=(ordered.tags.find(t=>t.author)||{}).author||'';
    return{
      reason,title:Bin.clean(title),author,
      files:ordered.files,tags:ordered.tags,
      totalSize:files.reduce((n,f)=>n+f.size,0)
    };
  },
  async buildGroup(plan,{title,author,onStatus=null}={}){
    const files=plan.files,tags=plan.tags;
    const say=t=>{try{onStatus&&onStatus(t)}catch(e){}};
    const first=await this.probe(files[0],'mp3');
    if(first.ok===false)throw this.unplayable(tags[0],'mp3');
    const titles=tags.map(t=>Bin.clean(t.title));
    const useTags=titles.every(Boolean)&&new Set(titles.map(s=>s.toLowerCase())).size===titles.length;
    const tracks=[],blobs=[],hashes=[];
    let offset=0;
    for(let i=0;i<files.length;i++){
      say(`Lendo faixa ${i+1} de ${files.length}...`);
      const f=files[i],t=tags[i];
      let duration=t.duration;
      if(!(duration>0)){
        const p=await this.probe(f,'mp3');
        if(p.ok===false)throw this.unplayable(t,'mp3');
        duration=p.duration;
      }
      if(!(duration>0))throw new ParseError(`Não foi possível descobrir a duração de “${f.name}”.`,'Remova esse arquivo da seleção e tente de novo.');
      tracks.push({name:f.name,title:this.chapterTitle(f,t,i,useTags),size:f.size,mime:'audio/mpeg',duration,offset});
      blobs.push(f.slice(0,f.size,'audio/mpeg'));
      hashes.push(await FileFingerprint.hashBlob(f));
      offset+=duration;
    }
    say('Preparando a capa...');
    const withCover=tags.find(t=>t.cover&&t.cover.blob);
    const cover=await AudioCover.fromBlob(withCover&&withCover.cover.blob);
    const finalTitle=Bin.clean(title)||plan.title||'Audiolivro';
    const meta={
      id:Utils.id(),title:finalTitle,author:Bin.clean(author)||plan.author||'Autor Desconhecido',format:'mp3',
      sourceFileName:`${files.length} arquivos MP3`,addedAt:Date.now(),
      cover:cover?cover.dataUrl:null,coverAspect:cover?cover.aspect:null,
      progress:null,status:'toread',favorite:false,
      tags:[],collections:[],series:'',folder:'',bookmarks:[],annotations:[],
      order:Date.now(),manualOrder:false,
      fileHash:await FileFingerprint.hashList(hashes),
      fileSize:files.reduce((n,f)=>n+f.size,0),
      audio:{
        v:1,duration:offset,narrator:(tags.find(t=>t.narrator)||{}).narrator||'',
        description:((tags.find(t=>t.description)||{}).description||'').slice(0,1200),
        year:(tags.find(t=>t.year)||{}).year||'',
        tracks,chapters:[],speed:null
      }
    };
    return{meta,blobs};
  },
  async save(db,meta,blobs){
    await this.ensureSpace(meta.fileSize||0);
    try{
      await db.saveAudioBook(meta,blobs);
    }catch(err){
      if(err&&(err.name==='QuotaExceededError'||/quota/i.test(String(err.message||'')))){
        throw new ParseError('O armazenamento do aparelho está cheio.','Libere espaço ou exclua livros da biblioteca e tente novamente.');
      }
      throw err;
    }
    /* pede ao navegador que não apague estes dados quando faltar espaço */
    try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  }
};

/* ------------------------------------------------------------
   Pergunta ao usuário quando vários MP3 parecem ser um livro só
   ------------------------------------------------------------ */
const AudioGroupDialog={
  ask(plan){
    const el=document.getElementById('audio-group-modal');
    if(!el)return Promise.resolve({action:'separate'});
    const $=id=>document.getElementById(id);
    const n=plan.files.length;
    $('agm-sub').textContent=`${n} arquivos MP3 · ${Utils.fmtBytes(plan.totalSize)}`;
    $('agm-lead').textContent=plan.reason==='album'
      ?'Os arquivos têm o mesmo álbum nas etiquetas, então parecem ser capítulos de um mesmo audiolivro.'
      :'Os nomes dos arquivos seguem uma sequência, então parecem ser capítulos de um mesmo audiolivro.';
    $('agm-title-input').value=plan.title||'';
    $('agm-author-input').value=plan.author||'';
    const rows=plan.files.slice(0,6).map((f,i)=>{
      const d=plan.tags[i]&&plan.tags[i].duration;
      return `<li><span class="agm-n">${i+1}</span><span class="agm-name">${Utils.esc(f.name)}</span>${d?`<small>${AudioFmt.clock(d)}</small>`:''}</li>`;
    }).join('');
    $('agm-list').innerHTML=`<ol>${rows}</ol>${n>6?`<p class="agm-more">e mais ${n-6} ${n-6===1?'arquivo':'arquivos'}, na ordem em que serão tocados</p>`:'<p class="agm-more">Na ordem em que serão tocados</p>'}`;
    el.classList.add('show');
    document.body.classList.add('modal-open');
    lucide.createIcons({root:el});
    setTimeout(()=>{try{$('agm-title-input').focus()}catch(e){}},60);
    return new Promise(resolve=>{
      const done=result=>{
        el.classList.remove('show');
        if(!document.querySelector('.app-modal.show,.doc-modal.show,.conversion-modal.show,.onboarding.show'))document.body.classList.remove('modal-open');
        $('agm-group').onclick=$('agm-separate').onclick=$('agm-close').onclick=null;
        el.onclick=null;document.removeEventListener('keydown',onKey,true);
        resolve(result);
      };
      const onKey=e=>{if(e.key==='Escape'){e.stopPropagation();done({action:'cancel'})}};
      document.addEventListener('keydown',onKey,true);
      $('agm-group').onclick=()=>done({action:'group',plan,title:$('agm-title-input').value.trim(),author:$('agm-author-input').value.trim()});
      $('agm-separate').onclick=()=>done({action:'separate'});
      $('agm-close').onclick=()=>done({action:'cancel'});
      el.onclick=e=>{if(e.target===el)done({action:'cancel'})};
    });
  }
};

/* ============================================================
   AUDIOLIVROS — PLAYER
   ------------------------------------------------------------
   Um único <audio> vive durante toda a sessão e é reutilizado
   entre faixas (é isso que mantém a reprodução viva em segundo
   plano no celular e evita o bloqueio de autoplay do iOS).

   O player trabalha sobre a LINHA DO TEMPO do livro (segundos
   desde o início), não sobre a faixa atual: buscar, marcar,
   salvar progresso e trocar de capítulo funcionam igual para um
   M4B de 20 horas e para 30 MP3 soltos.

   Duas apresentações do mesmo player:
   • tela cheia (capa, controles, painéis);
   • mini-player, que fica na estante enquanto o livro toca.
   ============================================================ */
class AudioPlayer{
  constructor(db,state){
    this.db=db;this.state=state;
    const g=id=>document.getElementById(id)||document.createElement('div');
    /* Dois elementos, um player só: o <audio> serve MP3/M4B e o <video>
       serve MP4. `this.el` sempre aponta para o que está tocando, então
       todo o resto do código (busca, capítulos, marcadores, timer) não
       precisa saber a diferença. */
    this.audioEl=document.getElementById('audio-el')||document.createElement('audio');
    this.videoEl=document.getElementById('video-el')||document.createElement('video');
    this.mediaEl=this.audioEl;
    this.root=g('audio-player');this.mini=g('mini-player');
    this.ui={
      bg:g('ap-bg'),collapse:g('ap-collapse'),topMid:g('ap-top-mid'),options:g('ap-options'),
      stage:g('ap-stage'),video:g('ap-video'),
      art:g('ap-art'),title:g('ap-title'),author:g('ap-author'),narrator:g('ap-narrator'),
      chapterBtn:g('ap-chapter-btn'),chapterName:g('ap-chapter-name'),
      seek:g('ap-seek'),elapsed:g('ap-elapsed'),remaining:g('ap-remaining'),scope:g('ap-scope'),
      prev:g('ap-prev'),back:g('ap-back'),backNum:g('ap-back-num'),play:g('ap-play'),
      fwd:g('ap-fwd'),fwdNum:g('ap-fwd-num'),next:g('ap-next'),
      speed:g('ap-speed'),speedVal:g('ap-speed-val'),sleep:g('ap-sleep'),sleepLabel:g('ap-sleep-label'),
      bmAdd:g('ap-bookmark-add'),bmOpen:g('ap-bookmarks'),
      mute:g('ap-mute'),volume:g('ap-volume'),
      miniOpen:g('mini-open'),miniCover:g('mini-cover'),miniTitle:g('mini-title'),miniSub:g('mini-sub'),
      miniProgress:g('mini-progress'),miniBack:g('mini-back'),miniPlay:g('mini-play'),miniClose:g('mini-close'),
      chapterList:g('ap-chapter-list'),chapterSub:g('ap-chapters-sub'),
      speedGrid:g('ap-speed-grid'),speedRange:g('ap-speed-range'),speedReadout:g('ap-speed-readout'),speedReset:g('ap-speed-reset'),
      sleepList:g('ap-sleep-list'),bmList:g('ap-bm-list'),bmAddPanel:g('ap-bm-add'),
      optBack:g('ap-opt-back'),optFwd:g('ap-opt-fwd'),optRewind:g('ap-opt-rewind'),optAutoplay:g('ap-opt-autoplay')
    };
    this.book=null;this.tracks=[];this.blobs=[];this.chapters=[];this.duration=0;
    this.trackIndex=0;this.objectUrl='';this.coverUrl='';
    this.loaded=false;this.loading=false;this.transitioning=false;this.expanded=false;
    this.loadToken=0;this.openToken=0;this.seeking=false;this.uiTimeOverride=null;
    this.rate=1;this.pausedAt=0;this.metaDirty=false;this.persistTimer=null;this.lastPersist=0;
    this.sleep={mode:'off',remaining:0,total:0,last:null,chapterEnd:0};
    this.frame=0;this.lastFrameAt=0;this.lastChapterIdx=-2;this.lastPos=0;
    this.unlocked=false;this.lastFocus=null;this.muted=false;this.cache={};
    this.bind();
  }

  /* ---------- atalhos de leitura ---------- */
  get el(){return this.mediaEl}
  get isVideo(){return AudioFormats.isVideoBook(this.book)}
  get s(){return this.state.settings}
  get skipBack(){return Number(this.s.audioSkipBack)||15}
  get skipFwd(){return Number(this.s.audioSkipForward)||30}
  get time(){const t=this.tracks[this.trackIndex];return(t?t.offset:0)+(this.el.currentTime||0)}
  uiTime(){return this.uiTimeOverride!=null?this.uiTimeOverride:this.time}
  isPlaying(){return!!this.book&&!this.el.paused&&!this.el.ended}
  isActive(){return!!this.book&&this.loaded}
  baseVolume(){const v=Number(this.s.audioVolume);return Utils.clamp(Number.isFinite(v)?v:1,0,1)}
  scope(){return this.chapters.length>1?(this.s.audioScope==='book'?'book':'chapter'):'book'}
  fmtRate(r){return String(+Number(r).toFixed(2)).replace('.',',')+'×'}
  keepPitch(){
    const el=this.el;
    try{el.preservesPitch=true;el.mozPreservesPitch=true;el.webkitPreservesPitch=true}catch(e){}
  }

  /* ============================================================
     LIGAÇÕES (eventos)
     ============================================================ */
  bind(){
    const ui=this.ui;
    const on=(node,ev,fn,opts)=>node&&node.addEventListener(ev,fn,opts);
    /* Os mesmos tratadores valem para os dois elementos; o que não está
       em uso fica sem src e nunca dispara nada. */
    [this.audioEl,this.videoEl].forEach(el=>{
      el.preload='auto';
      const mine=fn=>()=>{if(el===this.mediaEl)fn()};
      el.addEventListener('play',mine(()=>this.onPlayState()));
      el.addEventListener('playing',mine(()=>{this.setBusy(false);this.onPlayState()}));
      el.addEventListener('pause',mine(()=>this.onPause()));
      el.addEventListener('waiting',mine(()=>{if(!this.loading&&!el.paused)this.setBusy(true)}));
      el.addEventListener('canplay',mine(()=>{if(!this.loading)this.setBusy(false)}));
      el.addEventListener('timeupdate',mine(()=>this.onTime()));
      el.addEventListener('ended',mine(()=>this.onEnded()));
      el.addEventListener('error',mine(()=>this.onError()));
      el.addEventListener('seeked',mine(()=>{this.setBusy(false);this.render(true)}));
      el.addEventListener('durationchange',mine(()=>this.onDurationChange()));
    });

    /* No vídeo, tocar na imagem pausa e retoma — como em qualquer player. */
    on(this.videoEl,'click',()=>{if(this.isVideo)this.toggle()});
    on(ui.collapse,'click',()=>this.collapse());
    on(ui.miniOpen,'click',()=>this.expand());
    on(ui.miniPlay,'click',()=>this.toggle());
    on(ui.miniBack,'click',()=>this.skip(-this.skipBack));
    on(ui.miniClose,'click',()=>this.close());
    on(ui.play,'click',()=>this.toggle());
    on(ui.back,'click',()=>this.skip(-this.skipBack));
    on(ui.fwd,'click',()=>this.skip(this.skipFwd));
    on(ui.prev,'click',()=>this.prevChapter());
    on(ui.next,'click',()=>this.nextChapter());
    on(ui.chapterBtn,'click',()=>this.openChapters());
    on(ui.speed,'click',()=>this.openSpeed());
    on(ui.sleep,'click',()=>this.openSleep());
    on(ui.bmAdd,'click',()=>this.addBookmark());
    on(ui.bmOpen,'click',()=>this.openBookmarks());
    on(ui.bmAddPanel,'click',()=>this.addBookmark());
    on(ui.options,'click',()=>this.openOptions());
    on(ui.scope,'click',async()=>{
      await App.updateSetting('audioScope',this.scope()==='chapter'?'book':'chapter');
      this.render(true);
    });

    /* barra de progresso: arrastar mostra o tempo; soltar é que busca */
    on(ui.seek,'input',()=>{this.seeking=true;this.render()});
    on(ui.seek,'change',async()=>{
      const v=Number(ui.seek.value)||0;
      const ci=this.chapterIndexAt(this.uiTime());
      const ch=this.chapters[ci];
      const base=(this.scope()==='chapter'&&ch)?ch.start:0;
      this.seeking=false;
      await this.seekTo(base+v);
    });
    on(ui.seek,'pointerup',()=>{if(this.seeking)ui.seek.dispatchEvent(new Event('change'))});
    on(ui.seek,'blur',()=>{this.seeking=false});

    /* volume (desktop) */
    on(ui.volume,'input',()=>{
      this.s.audioVolume=Number(ui.volume.value);
      this.muted=false;this.applyVolume();
    });
    on(ui.volume,'change',()=>App.persistSettings());
    on(ui.mute,'click',()=>{this.muted=!this.muted;this.applyVolume()});

    /* painéis */
    on(ui.speedRange,'input',()=>this.setRate(Number(ui.speedRange.value)));
    on(ui.speedReset,'click',()=>this.setRate(1));
    this.bindOptionsPanel();

    document.addEventListener('keydown',e=>this.onKey(e));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.persist()});
    window.addEventListener('pagehide',()=>this.persist());
    this.updateSkipLabels();
  }
  bindOptionsPanel(){
    const ui=this.ui;
    const seg=(box,key,attr,after)=>{
      box.querySelectorAll('button').forEach(b=>b.onclick=async()=>{
        await App.updateSetting(key,Number(b.dataset[attr]));
        this.updateSkipLabels();this.renderOptions();
        if(after)after();
      });
    };
    seg(ui.optBack,'audioSkipBack','skip');
    seg(ui.optFwd,'audioSkipForward','skip');
    ui.optRewind.onchange=()=>App.updateSetting('audioSmartRewind',ui.optRewind.checked);
    ui.optAutoplay.onchange=()=>App.updateSetting('audioAutoplay',ui.optAutoplay.checked);
  }

  /* ============================================================
     ABRIR / FECHAR
     ============================================================ */
  /* Toca um trecho mudo dentro do gesto do usuário: no iOS isso "libera" o
     elemento para tocar depois, mesmo após as esperas assíncronas da abertura. */
  unlock(){
    if(this.unlocked)return;
    this.unlocked=true;
    /* Os dois elementos precisam ser liberados dentro do mesmo gesto:
       só se sabe qual deles vai tocar depois de ler o livro no banco. */
    [this.audioEl,this.videoEl].forEach(el=>{
      try{
        el.muted=true;
        el.src=AudioPlayer.SILENCE;
        const p=el.play();
        if(p&&p.catch)p.catch(()=>{});
      }catch(e){}
    });
  }
  /* Escolhe o elemento certo para o livro e devolve o outro ao repouso. */
  useMediaFor(book){
    const next=AudioFormats.isVideoBook(book)?this.videoEl:this.audioEl;
    if(next===this.mediaEl)return;
    const old=this.mediaEl;
    try{old.pause()}catch(e){}
    try{old.removeAttribute('src');old.load()}catch(e){}
    this.mediaEl=next;
  }
  async open(book,opts={}){
    if(!book)return;
    this.unlock();
    const wantsPlay=opts.autoplay!==undefined?!!opts.autoplay:this.s.audioAutoplay!==false;
    if(this.book&&this.book.id===book.id&&this.tracks.length){
      this.expand();
      if(opts.startAt!=null){
        await this.seekTo(opts.startAt);
        if(wantsPlay)this.play();
      }
      return;
    }
    const token=++this.openToken;
    await this.unload({soft:true});
    if(token!==this.openToken)return;
    this.book=book;
    this.useMediaFor(book);
    this.paintBook();
    this.setBusy(true);
    this.expand();
    try{
      const [rec,fresh]=await Promise.all([this.db.getFile(book.id),this.db.getBook(book.id)]);
      if(token!==this.openToken)return;
      const meta=fresh||book;
      const blobs=rec&&(rec.blobs||(rec.blob?[rec.blob]:null));
      const noun=AudioFormats.noun(book.format);
      if(!blobs||!blobs.length){
        throw new ParseError(`O arquivo deste ${noun} não está mais salvo no aparelho.`,`Importe o arquivo novamente para continuar ${AudioFormats.isVideoBook(book)?'assistindo':'ouvindo'}.`);
      }
      const trackMeta=(meta.audio&&meta.audio.tracks)||[];
      if(!trackMeta.length||trackMeta.length!==blobs.length){
        throw new ParseError(`Os dados deste ${noun} estão incompletos.`,'Exclua-o da biblioteca e importe o arquivo novamente.');
      }
      this.book=meta;
      this.blobs=blobs;
      this.tracks=trackMeta.map(t=>({...t}));
      this.rate=Utils.clamp(Number(meta.audio.speed)||Number(this.s.audioSpeed)||1,.5,3);
      this.rebuildTimeline();
      let start=opts.startAt!=null?Number(opts.startAt):((meta.progress&&meta.progress.position)||0);
      if(opts.startAt==null&&start>=this.duration-3)start=0;      /* livro terminado recomeça */
      start=Utils.clamp(start,0,this.duration);
      const idx=this.trackAt(start);
      this.pausedAt=meta.lastRead||0;
      await this.loadTrack(idx,{time:start-this.tracks[idx].offset,play:false});
      if(token!==this.openToken)return;
      this.loaded=true;
      this.paintBook();
      this.applyVolume();
      this.updateSkipLabels();this.updateSpeedUi();this.updateSleepUi();
      this.lastChapterIdx=-2;
      this.render(true);
      await this.prepareArtwork();
      if(token!==this.openToken)return;
      this.bindMediaSession();this.updateMediaMetadata();
      this.updateChrome();
      if(wantsPlay)await this.play();
    }catch(e){
      if(token!==this.openToken)return;
      this.collapse();
      this.fail(e);
      await this.unload();
    }
  }
  /* Para tudo, grava o progresso e libera o arquivo. */
  async unload({soft=false}={}){
    clearTimeout(this.persistTimer);
    if(this.book&&this.loaded){try{await this.persist()}catch(e){}}
    this.loadToken++;this.loading=false;this.transitioning=false;
    [this.audioEl,this.videoEl].forEach(el=>{
      try{el.pause()}catch(e){}
      try{el.removeAttribute('src');el.load()}catch(e){}
      el.muted=false;
    });
    if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=''}
    if(this.coverUrl){URL.revokeObjectURL(this.coverUrl);this.coverUrl=''}
    this.clearSleep(true);
    this.book=null;this.tracks=[];this.blobs=[];this.chapters=[];this.duration=0;
    this.mediaEl=this.audioEl;
    this.root.classList.remove('is-video');
    if(this.ui.video)this.ui.video.hidden=true;
    if(this.ui.art)this.ui.art.hidden=false;
    try{this.videoEl.removeAttribute('poster')}catch(e){}
    this.loaded=false;this.trackIndex=0;this.lastChapterIdx=-2;this.uiTimeOverride=null;this.metaDirty=false;
    this.clearMediaSession();
    this.syncCards();
    if(!soft)this.updateChrome();
  }
  /* "X" do mini-player. */
  async close(){
    this.collapse();
    await this.unload();
  }
  expand(){
    if(!this.book)return;
    this.expanded=true;
    this.lastFocus=document.activeElement;
    this.root.hidden=false;
    const app=document.getElementById('app');
    if(app)app.inert=true;
    document.body.classList.add('audio-open');
    requestAnimationFrame(()=>requestAnimationFrame(()=>{if(this.expanded)this.root.classList.add('open')}));
    this.updateChrome();
    this.render(true);
    this.startLoop();
    setTimeout(()=>{if(this.expanded){try{this.ui.play.focus({preventScroll:true})}catch(e){}}},400);
  }
  collapse(){
    if(!this.expanded)return;
    this.expanded=false;
    App.closePanels();
    this.root.classList.remove('open');
    const app=document.getElementById('app');
    if(app)app.inert=false;
    document.body.classList.remove('audio-open');
    setTimeout(()=>{if(!this.expanded)this.root.hidden=true},380);
    this.updateChrome();
    try{if(this.lastFocus&&document.contains(this.lastFocus))this.lastFocus.focus({preventScroll:true})}catch(e){}
    this.lastFocus=null;
  }
  updateChrome(){
    const showMini=!!this.book&&!this.expanded;
    this.mini.hidden=!showMini;
    document.body.classList.toggle('has-mini',showMini);
  }
  /* O livro tocando não pode disputar a tela com a leitura de texto. */
  pauseForOtherMedia(){if(this.book&&!this.el.paused)this.pause()}
  /* Título/autor/capa alterados na estante enquanto o livro está carregado. */
  syncMeta(saved){
    if(!this.book||!saved||saved.id!==this.book.id)return;
    this.book={...this.book,title:saved.title,author:saved.author};
    this.paintBook();this.updateMediaMetadata();
  }

  /* ============================================================
     FAIXAS E LINHA DO TEMPO
     ============================================================ */
  rebuildTimeline(){
    let acc=0;
    this.tracks.forEach(t=>{t.offset=acc;acc+=t.duration});
    this.duration=acc;
    if(this.tracks.length>1){
      this.chapters=this.tracks.map((t,i)=>({title:t.title||`Capítulo ${i+1}`,start:t.offset,end:t.offset+t.duration}));
    }else{
      const src=((this.book&&this.book.audio&&this.book.audio.chapters)||[]).map(c=>({...c}));
      if(src.length)src[src.length-1].end=Math.max(src[src.length-1].start,this.duration);
      this.chapters=src.filter(c=>c.start<this.duration);
    }
  }
  trackAt(time){
    let idx=0;
    for(let i=0;i<this.tracks.length;i++){if(this.tracks[i].offset<=time)idx=i;else break}
    return idx;
  }
  chapterIndexAt(time){
    const list=this.chapters;
    if(!list.length)return -1;
    let lo=0,hi=list.length-1,ans=0;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      if(list[mid].start<=time){ans=mid;lo=mid+1}else hi=mid-1;
    }
    return ans;
  }
  async loadTrack(index,{time=0,play=false}={}){
    const token=++this.loadToken;
    this.loading=true;
    this.trackIndex=index;
    const t=this.tracks[index],el=this.el;
    this.setBusy(true);
    const blob=this.blobs[index];
    const typed=blob.type===t.mime?blob:blob.slice(0,blob.size,t.mime);
    const url=URL.createObjectURL(typed);
    const old=this.objectUrl;
    this.objectUrl=url;
    try{el.pause()}catch(e){}
    el.muted=this.muted;
    el.src=url;
    el.defaultPlaybackRate=this.rate;el.playbackRate=this.rate;this.keepPitch();
    if(old)URL.revokeObjectURL(old);
    try{
      await new Promise((resolve,reject)=>{
        const clean=()=>{el.removeEventListener('loadedmetadata',ok);el.removeEventListener('error',bad)};
        const ok=()=>{clean();resolve()};
        const bad=()=>{clean();reject(el.error||new Error('Falha ao carregar o áudio.'))};
        el.addEventListener('loadedmetadata',ok);
        el.addEventListener('error',bad);
      });
    }catch(e){
      if(token===this.loadToken){this.loading=false;this.transitioning=false;this.setBusy(false)}
      throw e;
    }
    if(token!==this.loadToken)return false;
    this.loading=false;
    const d=el.duration;
    if(Number.isFinite(d)&&d>0&&Math.abs(d-t.duration)>1.5){
      t.duration=d;this.rebuildTimeline();this.metaDirty=true;
    }
    el.playbackRate=this.rate;
    try{el.currentTime=Utils.clamp(time,0,Math.max(0,(el.duration||0)-0.05))}catch(e){}
    this.setBusy(false);
    this.render(true);
    if(play)await this.play();
    return true;
  }
  async seekTo(time){
    if(!this.tracks.length)return;
    time=Utils.clamp(Number(time)||0,0,this.duration);
    const idx=this.trackAt(time),t=this.tracks[idx];
    const local=Utils.clamp(time-t.offset,0,Math.max(0,t.duration-0.05));
    if(idx===this.trackIndex&&!this.loading){
      try{this.el.currentTime=local}catch(e){}
      this.render(true);
    }else{
      const wasPlaying=!this.el.paused||this.transitioning;
      this.uiTimeOverride=time;
      this.render(true);
      try{await this.loadTrack(idx,{time:local,play:wasPlaying})}
      catch(e){this.fail(e)}
      finally{this.uiTimeOverride=null}
    }
    this.updatePositionState(true);
    this.schedulePersist(1500);
  }
  skip(delta){this.seekTo(this.uiTime()+delta)}
  nextChapter(){
    const i=this.chapterIndexAt(this.uiTime());
    const n=this.chapters[i+1];
    if(n)this.seekTo(n.start);
  }
  prevChapter(){
    const i=this.chapterIndexAt(this.uiTime());
    const c=this.chapters[i];
    if(!c){this.seekTo(0);return}
    if(this.uiTime()-c.start>3||i===0)this.seekTo(c.start);
    else this.seekTo(this.chapters[i-1].start);
  }

  /* ============================================================
     REPRODUÇÃO
     ============================================================ */
  async play(){
    if(!this.book||!this.tracks.length||this.loading)return;
    if(this.uiTime()>=this.duration-0.5)await this.seekTo(0);
    this.applySmartRewind();
    this.applyVolume();
    try{await this.el.play()}
    catch(e){
      if(e&&e.name==='NotAllowedError')Utils.toast('Toque em reproduzir para começar.','play');
      else if(!e||e.name!=='AbortError'){console.warn(e);Utils.toast(`Não foi possível reproduzir este ${this.isVideo?'vídeo':'áudio'}.`,'alert-triangle')}
    }
  }
  pause(){try{this.el.pause()}catch(e){}}
  toggle(){if(!this.book)return;if(this.el.paused)this.play();else this.pause()}
  /* Retomar depois de um tempo parado volta alguns segundos: dá contexto de novo. */
  applySmartRewind(){
    if(this.s.audioSmartRewind===false||!this.pausedAt)return;
    const away=(Date.now()-this.pausedAt)/1000;
    this.pausedAt=0;
    const back=away<30?0:away<300?3:away<3600?6:10;
    if(back&&this.el.currentTime>back)this.el.currentTime-=back;
  }
  applyVolume(){
    const v=this.baseVolume();
    try{this.el.volume=v;this.el.muted=this.muted}catch(e){}
    this.ui.volume.value=String(this.muted?0:v);
    this.ui.mute.classList.toggle('is-muted',this.muted||v===0);
  }
  setFade(f){try{this.el.volume=Utils.clamp(this.baseVolume()*f,0,1)}catch(e){}}
  async setRate(r,{save=true}={}){
    r=Utils.clamp(Math.round(Number(r)*20)/20,.5,3);
    if(!Number.isFinite(r))return;
    this.rate=r;
    this.el.defaultPlaybackRate=r;this.el.playbackRate=r;this.keepPitch();
    this.updateSpeedUi();this.renderSpeed();
    this.updatePositionState(true);
    if(save){
      this.s.audioSpeed=r;
      try{await App.persistSettings()}catch(e){}
      this.schedulePersist(500);
    }
  }
  onPlayState(){
    this.transitioning=false;
    this.sleep.last=performance.now();
    this.pausedAt=0;
    this.updatePlayUi();
    this.bindMediaSession();
    if('mediaSession' in navigator){try{navigator.mediaSession.playbackState='playing'}catch(e){}}
    this.startLoop();
    this.syncCards();
  }
  onPause(){
    if(this.loading||this.transitioning)return;
    if(this.el.ended&&this.trackIndex<this.tracks.length-1)return;
    this.pausedAt=Date.now();
    this.sleep.last=null;
    this.updatePlayUi();
    if('mediaSession' in navigator){try{navigator.mediaSession.playbackState='paused'}catch(e){}}
    this.updatePositionState(true);
    this.persist();
    this.syncCards();
  }
  onTime(){
    if(this.loading||!this.book)return;
    const now=performance.now();
    this.sleepTick(now);
    this.render();
    if(!this.el.paused&&now-this.lastPersist>10000)this.persist();
    this.updatePositionState();
    if(this.metaDirty)this.schedulePersist(3000);
  }
  onEnded(){
    if(this.loading||!this.book||!this.loaded||!this.tracks.length)return;
    if(this.trackIndex<this.tracks.length-1){
      this.transitioning=true;
      this.loadTrack(this.trackIndex+1,{time:0,play:true}).catch(e=>{this.transitioning=false;this.fail(e)});
    }else{
      this.finish();
    }
  }
  onDurationChange(){
    if(this.loading||!this.book||!this.tracks.length)return;
    const d=this.el.duration,t=this.tracks[this.trackIndex];
    if(Number.isFinite(d)&&d>0&&Math.abs(d-t.duration)>1.5){
      t.duration=d;this.rebuildTimeline();this.metaDirty=true;
      this.render(true);this.schedulePersist(3000);
    }
  }
  onError(){
    if(this.loading||!this.book||!this.loaded)return;
    const err=this.el.error;
    if(!err||err.code===1)return;
    this.pause();
    this.fail(err);
  }
  fail(e){
    console.error(e);
    const isParse=e instanceof ParseError;
    const code=e&&e.code;
    const v=this.isVideo;
    const msg=isParse?e.message
      :code===4?`O navegador não consegue reproduzir este arquivo de ${v?'vídeo':'áudio'}.`
      :code===3?`O ${v?'vídeo':'áudio'} está danificado neste ponto.`
      :code===2?`Não foi possível ler o arquivo de ${v?'vídeo':'áudio'}.`
      :`Não foi possível abrir este ${v?'vídeo':'audiolivro'}.`;
    Utils.toast(msg,'alert-triangle');
    if(isParse&&e.hint)setTimeout(()=>Utils.toast(e.hint,'info'),900);
  }
  async finish(){
    const video=this.isVideo;
    await this.persist({finished:true});
    this.updatePlayUi();
    this.render(true);
    Utils.toast(video?'Vídeo concluído.':'Audiolivro concluído.','check-circle');
  }

  /* ============================================================
     PROGRESSO
     ============================================================ */
  schedulePersist(delay=1500){
    clearTimeout(this.persistTimer);
    this.persistTimer=setTimeout(()=>this.persist(),delay);
  }
  /* Grava só o que o player é dono (progresso, velocidade, durações) numa
     transação atômica — a estante pode ter editado título/status no meio. */
  async persist({finished=false}={}){
    const book=this.book;
    if(!book||!this.tracks.length||!this.loaded)return;
    const dur=this.duration;
    if(!(dur>0))return;
    const t=finished?dur:Utils.clamp(this.uiTime(),0,dur);
    const done=finished||t>=dur-2;
    const pct=done?100:Utils.clamp(Math.round(t/dur*100),0,99);
    const progress={percentage:pct,position:t,duration:dur,updatedAt:Date.now()};
    const speed=this.rate;
    const meta=this.metaDirty?{tracks:this.tracks.map(x=>({...x})),duration:dur}:null;
    this.metaDirty=false;
    this.lastPersist=performance.now();
    try{
      const saved=await this.db.patchBook(book.id,b=>{
        b.progress={...(b.progress||{}),...progress};
        b.lastRead=Date.now();
        if(done)b.status='read';
        else if(!b.status||b.status==='toread')b.status='reading';
        b.audio={...(b.audio||{}),speed};
        if(meta){b.audio.tracks=meta.tracks;b.audio.duration=meta.duration}
      });
      if(saved&&App.library)App.library.refreshAudioProgress(saved);
    }catch(e){console.warn('Não foi possível salvar o progresso do áudio.',e)}
  }

  /* ============================================================
     TELA
     ============================================================ */
  setText(key,text){
    if(this.cache[key]===text)return;
    this.cache[key]=text;
    const map={elapsed:this.ui.elapsed,remaining:this.ui.remaining,topMid:this.ui.topMid,
      chapterName:this.ui.chapterName,scope:this.ui.scope,miniSub:this.ui.miniSub,sleepLabel:this.ui.sleepLabel};
    if(map[key])map[key].textContent=text;
  }
  setBusy(on){
    this.root.classList.toggle('is-busy',!!on);
    this.mini.classList.toggle('is-busy',!!on);
  }
  updatePlayUi(){
    const playing=!this.el.paused&&!this.el.ended;
    this.root.classList.toggle('is-playing',playing);
    this.mini.classList.toggle('is-playing',playing);
    const label=playing?'Pausar':'Reproduzir';
    this.ui.play.setAttribute('aria-label',label);
    this.ui.miniPlay.setAttribute('aria-label',label);
  }
  updateSkipLabels(){
    const b=this.skipBack,f=this.skipFwd;
    this.ui.backNum.textContent=String(b);this.ui.fwdNum.textContent=String(f);
    this.ui.back.setAttribute('aria-label',`Voltar ${b} segundos`);
    this.ui.fwd.setAttribute('aria-label',`Avançar ${f} segundos`);
    this.ui.miniBack.setAttribute('aria-label',`Voltar ${b} segundos`);
    const mb=this.ui.miniBack.querySelector('text');if(mb)mb.textContent=String(b);
  }
  updateSpeedUi(){
    this.ui.speedVal.textContent=this.fmtRate(this.rate);
    this.ui.speed.setAttribute('aria-label',`Velocidade de reprodução: ${this.fmtRate(this.rate)}`);
    this.ui.speed.classList.toggle('active',Math.abs(this.rate-1)>0.001);
  }
  paintBook(){
    const b=this.book;
    if(!b)return;
    const ui=this.ui;
    const video=AudioFormats.isVideoBook(b);
    const icon=AudioFormats.icon(b.format);
    const fallbackName=video?'Vídeo':'Audiolivro';
    ui.title.textContent=b.title||fallbackName;
    ui.miniTitle.textContent=b.title||fallbackName;
    const author=b.author&&b.author!=='Autor Desconhecido'?b.author:'';
    ui.author.textContent=author;ui.author.hidden=!author;
    const narrator=b.audio&&b.audio.narrator;
    ui.narrator.textContent=narrator?`Narrado por ${narrator}`:'';ui.narrator.hidden=!narrator;
    const fill=(host,big)=>{
      host.textContent='';
      if(b.cover){
        const img=document.createElement('img');
        img.alt='';img.decoding='async';img.src=b.cover;
        host.appendChild(img);
      }else{
        const f=document.createElement('div');
        f.className='ap-art-fallback';
        f.innerHTML=big
          ?`<i data-lucide="${icon}"></i><strong>${Utils.esc(b.title||'')}</strong>`
          :`<i data-lucide="${icon}"></i>`;
        host.appendChild(f);
        lucide.createIcons({root:host});
      }
    };
    /* No vídeo, a própria imagem ocupa o lugar da capa; a capa continua
       valendo na estante, no mini-player e nos controles do sistema. */
    this.root.classList.toggle('is-video',video);
    if(ui.video)ui.video.hidden=!video;
    ui.art.hidden=video;
    if(!video)fill(ui.art,true);
    fill(ui.miniCover,false);
    if(video){
      this.videoEl.poster=b.cover||'';
      ui.video.style.setProperty('--ar',String(Utils.clamp(Number(b.coverAspect)||16/9,.5,2.4)));
    }
    ui.art.style.setProperty('--ar',String(Utils.clamp(Number(b.coverAspect)||1,.6,1.4)));
    this.root.classList.toggle('no-cover',!b.cover);
    ui.bg.style.backgroundImage=b.cover?`url("${b.cover}")`:'none';
    this.cache={};
  }
  render(force=false){
    const b=this.book;
    if(!b||!this.tracks.length){
      if(b){this.setText('miniSub',b.author||'')}
      return;
    }
    const ui=this.ui;
    const dur=this.duration;
    const t=Utils.clamp(this.uiTime(),0,dur);
    const ci=this.chapterIndexAt(t);
    const ch=this.chapters[ci]||null;
    const chapterScope=this.scope()==='chapter'&&!!ch;
    const start=chapterScope?ch.start:0;
    const len=chapterScope?Math.max(0.01,ch.end-ch.start):Math.max(0.01,dur);
    const pos=Utils.clamp(t-start,0,len);
    const shown=this.seeking?Utils.clamp(Number(ui.seek.value)||0,0,len):pos;
    if(force||this.cache.len!==len){ui.seek.max=String(len);this.cache.len=len}
    if(!this.seeking)ui.seek.value=String(pos);
    ui.seek.style.setProperty('--p',(shown/len*100).toFixed(2)+'%');
    this.setText('elapsed',AudioFmt.clock(shown));
    this.setText('remaining','-'+AudioFmt.clock(len-shown));
    const sec=Math.floor(shown);
    if(this.cache.aria!==sec){
      this.cache.aria=sec;
      ui.seek.setAttribute('aria-valuetext',`${AudioFmt.spoken(shown)} de ${AudioFmt.spoken(len)}`);
    }
    const pct=dur>0?Math.round(t/dur*100):0;
    this.setText('topMid',`${pct}% · restam ${AudioFmt.long(dur-t)}`);
    const hasCh=this.chapters.length>1;
    ui.chapterBtn.hidden=!hasCh;
    ui.prev.hidden=!hasCh;ui.next.hidden=!hasCh;
    ui.scope.hidden=!hasCh;
    this.root.classList.toggle('has-chapters',hasCh);
    if(hasCh){
      this.setText('chapterName',ch?ch.title:'');
      this.setText('scope',chapterScope?'Neste capítulo':'No livro todo');
    }
    ui.miniProgress.style.width=(dur>0?t/dur*100:0).toFixed(2)+'%';
    this.setText('miniSub',hasCh&&ch?ch.title:(b.author&&b.author!=='Autor Desconhecido'?b.author:AudioFmt.long(dur-t)+' restantes'));
    if(this.sleep.mode==='time')this.setText('sleepLabel',AudioFmt.clock(Math.max(0,this.sleep.remaining/1000)));
    if(ci!==this.lastChapterIdx){
      this.lastChapterIdx=ci;
      this.onChapterChange();
    }
    if(force)this.updatePlayUi();
  }
  onChapterChange(){
    this.updateMediaMetadata();
    if(document.getElementById('panel-audio-chapters')?.classList.contains('visible'))this.markCurrentChapter();
  }
  startLoop(){
    if(this.frame)return;
    const tick=now=>{
      this.frame=0;
      if(!this.expanded||!this.book||this.el.paused)return;
      if(now-this.lastFrameAt>90){this.lastFrameAt=now;this.render()}
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  /* Marca na estante qual capa está tocando (equalizador animado). */
  syncCards(){
    const id=this.book&&this.isPlaying()?this.book.id:null;
    document.querySelectorAll('.book-card.is-playing').forEach(c=>{if(c.dataset.id!==id)c.classList.remove('is-playing')});
    if(id){
      const c=document.querySelector(`.book-card[data-id="${id}"]`);
      if(c)c.classList.add('is-playing');
    }
  }

  /* ============================================================
     CAPÍTULOS
     ============================================================ */
  openChapters(){
    if(!this.chapters.length)return;
    const list=this.ui.chapterList;
    list.textContent='';
    this.ui.chapterSub.textContent=`${this.chapters.length} capítulos · toque para ir direto ao ponto.`;
    this.chapters.forEach((c,i)=>{
      const btn=document.createElement('button');
      btn.type='button';btn.className='ap-ch';btn.dataset.i=String(i);
      btn.innerHTML=`<span class="ap-ch-n">${i+1}</span>
        <span class="ap-ch-t"><strong>${Utils.esc(c.title)}</strong><small>${AudioFmt.clock(c.start)} · ${AudioFmt.long(c.end-c.start)}</small></span>
        <span class="ap-ch-eq" aria-hidden="true"><i></i><i></i><i></i></span>`;
      btn.onclick=()=>{
        App.closePanels();
        this.seekTo(c.start);
        if(this.el.paused)this.play();
      };
      list.appendChild(btn);
    });
    this.markCurrentChapter();
    App.openPanel('panel-audio-chapters');
    setTimeout(()=>{
      const cur=list.querySelector('.ap-ch.current');
      if(cur)cur.scrollIntoView({block:'center'});
    },80);
  }
  markCurrentChapter(){
    const cur=this.chapterIndexAt(this.uiTime());
    this.ui.chapterList.querySelectorAll('.ap-ch').forEach(b=>{
      const on=Number(b.dataset.i)===cur;
      b.classList.toggle('current',on);
      if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');
    });
  }

  /* ============================================================
     VELOCIDADE
     ============================================================ */
  openSpeed(){
    this.renderSpeed();
    App.openPanel('panel-audio-speed');
  }
  renderSpeed(){
    const grid=this.ui.speedGrid;
    if(!grid.dataset.built){
      grid.dataset.built='1';
      [0.5,0.75,1,1.25,1.5,1.75,2,2.5,3].forEach(r=>{
        const b=document.createElement('button');
        b.type='button';b.dataset.rate=String(r);b.textContent=this.fmtRate(r);
        b.onclick=()=>this.setRate(r);
        grid.appendChild(b);
      });
    }
    grid.querySelectorAll('button').forEach(b=>b.classList.toggle('active',Math.abs(Number(b.dataset.rate)-this.rate)<0.001));
    this.ui.speedRange.value=String(this.rate);
    this.ui.speedReadout.textContent=this.fmtRate(this.rate);
  }

  /* ============================================================
     TIMER DE SONO
     ============================================================ */
  openSleep(){
    this.renderSleep();
    App.openPanel('panel-audio-sleep');
  }
  renderSleep(){
    const list=this.ui.sleepList;
    list.textContent='';
    const s=this.sleep;
    const add=(icon,label,hint,active,fn)=>{
      const b=document.createElement('button');
      b.type='button';b.className='sort-option'+(active?' active':'');
      b.innerHTML=`<i data-lucide="${icon}"></i><span>${Utils.esc(label)}</span>${hint?`<small>${Utils.esc(hint)}</small>`:''}`;
      b.onclick=()=>{fn();App.closePanels()};
      list.appendChild(b);
    };
    if(s.mode!=='off'){
      const txt=s.mode==='time'?`Faltam ${AudioFmt.clock(Math.max(0,s.remaining/1000))}`:'Pausa ao fim do capítulo';
      const info=document.createElement('div');
      info.className='ap-sleep-now';
      info.innerHTML=`<i data-lucide="moon"></i><div><strong>Timer ativo</strong><small>${Utils.esc(txt)}</small></div>`;
      list.appendChild(info);
      if(s.mode==='time')add('plus','Somar 10 minutos','',false,()=>{s.remaining+=600000;s.total+=600000;Utils.toast('Mais 10 minutos no timer.','moon');this.updateSleepUi()});
      add('x','Desativar timer','',false,()=>this.clearSleep());
    }
    [5,10,15,30,45,60].forEach(m=>{
      add('timer',`${m} minutos`,'',s.mode==='time'&&Math.round(s.total/60000)===m,()=>this.setSleep('time',m));
    });
    if(this.chapters.length>1)add('list','Ao fim do capítulo','',s.mode==='chapter',()=>this.setSleep('chapter'));
    lucide.createIcons({root:list});
  }
  setSleep(mode,minutes=0){
    this.clearSleep(true);
    if(mode==='time'){
      const ms=minutes*60000;
      this.sleep={mode:'time',remaining:ms,total:ms,last:this.isPlaying()?performance.now():null,chapterEnd:0};
      Utils.toast(`O áudio vai pausar em ${minutes} minutos.`,'moon');
    }else if(mode==='chapter'){
      const ch=this.chapters[this.chapterIndexAt(this.uiTime())];
      if(!ch){Utils.toast('Este audiolivro não tem capítulos.','info');return}
      this.sleep={mode:'chapter',remaining:0,total:0,last:null,chapterEnd:ch.end};
      Utils.toast('O áudio vai pausar ao fim do capítulo.','moon');
    }
    this.updateSleepUi();
  }
  clearSleep(silent=false){
    const was=this.sleep.mode!=='off';
    this.sleep={mode:'off',remaining:0,total:0,last:null,chapterEnd:0};
    if(this.el&&this.book)this.applyVolume();
    this.updateSleepUi();
    if(was&&!silent)Utils.toast('Timer desativado.','moon');
  }
  updateSleepUi(){
    const s=this.sleep;
    this.ui.sleep.classList.toggle('active',s.mode!=='off');
    this.cache.sleepLabel=undefined;
    this.ui.sleepLabel.textContent=s.mode==='off'?'Timer':s.mode==='chapter'?'Fim do cap.':AudioFmt.clock(Math.max(0,s.remaining/1000));
  }
  sleepTick(now){
    const s=this.sleep;
    if(s.mode==='off')return;
    if(this.el.paused){s.last=null;return}
    if(s.mode==='time'){
      if(s.last!=null)s.remaining-=now-s.last;
      s.last=now;
      const fade=15000;
      if(s.remaining<=fade)this.setFade(Math.max(0,s.remaining/fade));
      if(s.remaining<=0)this.sleepFire(null);
    }else{
      const t=this.time;
      if(t>s.chapterEnd+1){this.clearSleep(true);return}
      const left=(s.chapterEnd-t)/this.rate;
      if(left<=6)this.setFade(Math.max(0,left/6));
      if(left<=0.25)this.sleepFire(s.chapterEnd);
    }
  }
  sleepFire(seekTime){
    this.pause();
    this.clearSleep(true);
    this.applyVolume();
    if(seekTime!=null)this.seekTo(seekTime);
    Utils.toast('Timer de sono encerrado.','moon');
  }

  /* ============================================================
     MARCADORES
     ============================================================ */
  async addBookmark(){
    if(!this.book)return;
    const t=this.uiTime();
    const ch=this.chapters[this.chapterIndexAt(t)];
    try{
      const cur=await this.db.getBook(this.book.id);
      if(cur&&cur.bookmarks.some(m=>m.kind==='audio'&&Math.abs(m.time-t)<3)){
        Utils.toast('Já existe um marcador neste ponto.','bookmark');
        return;
      }
      const bm={id:Utils.id(),kind:'audio',time:t,title:'',chapter:ch?ch.title:'',addedAt:Date.now()};
      await this.db.patchBook(this.book.id,b=>{b.bookmarks.push(bm)});
      try{if(navigator.vibrate)navigator.vibrate(12)}catch(e){}
      Utils.toast(`Marcador salvo em ${AudioFmt.clock(t)}.`,'bookmark');
      this.ui.bmAdd.classList.remove('pulse');void this.ui.bmAdd.offsetWidth;this.ui.bmAdd.classList.add('pulse');
      if(document.getElementById('panel-audio-bookmarks').classList.contains('visible'))this.renderBookmarks();
      if(App.library)App.library.render();
    }catch(e){
      console.error(e);
      Utils.toast('Não foi possível salvar o marcador.','alert-triangle');
    }
  }
  async openBookmarks(){
    await this.renderBookmarks();
    App.openPanel('panel-audio-bookmarks');
  }
  async renderBookmarks(){
    const box=this.ui.bmList;
    const cur=await this.db.getBook(this.book.id);
    const list=(cur?cur.bookmarks:[]).filter(m=>m.kind==='audio').sort((a,b)=>a.time-b.time);
    box.textContent='';
    if(!list.length){
      box.innerHTML=`<div class="empty"><i data-lucide="bookmark"></i><h3>Nenhum marcador ainda</h3><p>Toque em “Marcar agora” para guardar este ponto e voltar a ele quando quiser.</p></div>`;
      lucide.createIcons({root:box});
      return;
    }
    list.forEach(m=>{
      const row=document.createElement('div');
      row.className='ap-bm';
      const label=m.title||m.chapter||'Marcador';
      row.innerHTML=`
        <button type="button" class="ap-bm-go" aria-label="Ir para ${AudioFmt.spoken(m.time)}">
          <span class="ap-bm-time">${AudioFmt.clock(m.time)}</span>
          <span class="ap-bm-label">${Utils.esc(label)}</span>
        </button>
        <div class="ap-bm-actions">
          <button type="button" class="action-btn ap-bm-edit" title="Nomear" aria-label="Nomear marcador"><i data-lucide="edit-3"></i></button>
          <button type="button" class="action-btn delete-btn ap-bm-del" title="Excluir" aria-label="Excluir marcador"><i data-lucide="trash"></i></button>
        </div>`;
      row.querySelector('.ap-bm-go').onclick=()=>{
        App.closePanels();
        this.seekTo(m.time);
        if(this.el.paused)this.play();
      };
      row.querySelector('.ap-bm-edit').onclick=()=>this.editBookmark(row,m);
      row.querySelector('.ap-bm-del').onclick=async()=>{
        const ok=await AppModal.confirm({title:'Excluir marcador?',subtitle:AudioFmt.clock(m.time),message:'O marcador será removido deste audiolivro.',confirmText:'Excluir marcador',confirmIcon:'trash',danger:true});
        if(!ok)return;
        await this.db.patchBook(this.book.id,b=>{b.bookmarks=b.bookmarks.filter(x=>x.id!==m.id)});
        Utils.toast('Marcador excluído.','trash');
        this.renderBookmarks();
        if(App.library)App.library.render();
      };
      box.appendChild(row);
    });
    lucide.createIcons({root:box});
  }
  editBookmark(row,m){
    const go=row.querySelector('.ap-bm-label');
    const input=document.createElement('input');
    input.className='field ap-bm-input';input.value=m.title||'';input.placeholder=m.chapter||'Nome do marcador';
    input.maxLength=120;input.setAttribute('aria-label','Nome do marcador');
    go.replaceWith(input);
    input.focus();
    let closed=false;
    const save=async()=>{
      if(closed)return;closed=true;
      const title=input.value.trim();
      await this.db.patchBook(this.book.id,b=>{const x=b.bookmarks.find(y=>y.id===m.id);if(x)x.title=title});
      this.renderBookmarks();
    };
    input.onkeydown=e=>{
      if(e.key==='Enter'){e.preventDefault();save()}
      else if(e.key==='Escape'){e.stopPropagation();closed=true;this.renderBookmarks()}
    };
    input.onblur=save;
  }

  /* ============================================================
     AJUSTES
     ============================================================ */
  openOptions(){
    this.renderOptions();
    App.openPanel('panel-audio-options');
  }
  renderOptions(){
    const ui=this.ui;
    ui.optBack.querySelectorAll('button').forEach(b=>b.classList.toggle('active',Number(b.dataset.skip)===this.skipBack));
    ui.optFwd.querySelectorAll('button').forEach(b=>b.classList.toggle('active',Number(b.dataset.skip)===this.skipFwd));
    ui.optRewind.checked=this.s.audioSmartRewind!==false;
    ui.optAutoplay.checked=this.s.audioAutoplay!==false;
  }

  /* ============================================================
     TECLADO
     ============================================================ */
  onKey(e){
    if(!this.expanded||!this.book)return;
    if(document.querySelector('.app-modal.show,.doc-modal.show,.conversion-modal.show,.onboarding.show'))return;
    const t=e.target,tag=(t.tagName||'').toLowerCase();
    const typing=(tag==='input'&&t.type!=='range')||tag==='textarea'||tag==='select'||t.isContentEditable;
    const panelOpen=!!document.querySelector('.panel.visible');
    if(e.key==='Escape'&&!typing){
      e.preventDefault();
      if(panelOpen)App.closePanels();else this.collapse();
      return;
    }
    if(typing||panelOpen||e.ctrlKey||e.metaKey||e.altKey)return;
    const onButton=!!(t.closest&&t.closest('button'));
    switch(e.key){
      case ' ':case 'k':case 'K':
        if(onButton)return;             /* o botão já trata o espaço */
        e.preventDefault();this.toggle();break;
      case 'ArrowLeft':e.preventDefault();if(e.shiftKey)this.prevChapter();else this.skip(-this.skipBack);break;
      case 'ArrowRight':e.preventDefault();if(e.shiftKey)this.nextChapter();else this.skip(this.skipFwd);break;
      case 'ArrowUp':e.preventDefault();this.s.audioVolume=Utils.clamp(this.baseVolume()+.05,0,1);this.muted=false;this.applyVolume();break;
      case 'ArrowDown':e.preventDefault();this.s.audioVolume=Utils.clamp(this.baseVolume()-.05,0,1);this.applyVolume();break;
      case 'm':case 'M':this.muted=!this.muted;this.applyVolume();break;
      case 'b':case 'B':this.addBookmark();break;
      case '[':this.setRate(this.rate-.1);break;
      case ']':this.setRate(this.rate+.1);break;
    }
  }

  /* ============================================================
     CONTROLES DO SISTEMA (tela bloqueada, fones, carro)
     ============================================================ */
  async prepareArtwork(){
    if(this.coverUrl){URL.revokeObjectURL(this.coverUrl);this.coverUrl=''}
    if(!this.book||!this.book.cover)return;
    try{
      const r=await fetch(this.book.cover);
      this.coverUrl=URL.createObjectURL(await r.blob());
    }catch(e){}
  }
  bindMediaSession(){
    if(!('mediaSession' in navigator)||!this.book)return;
    const ms=navigator.mediaSession;
    const set=(action,fn)=>{try{ms.setActionHandler(action,fn)}catch(e){}};
    const hasCh=this.chapters.length>1;
    set('play',()=>this.play());
    set('pause',()=>this.pause());
    set('stop',()=>this.close());
    set('seekbackward',d=>this.skip(-((d&&d.seekOffset)||this.skipBack)));
    set('seekforward',d=>this.skip((d&&d.seekOffset)||this.skipFwd));
    set('seekto',d=>{if(d&&d.seekTime!=null)this.seekTo(d.seekTime)});
    set('previoustrack',hasCh?()=>this.prevChapter():null);
    set('nexttrack',hasCh?()=>this.nextChapter():null);
  }
  updateMediaMetadata(){
    if(!('mediaSession' in navigator)||!this.book||typeof MediaMetadata==='undefined')return;
    try{
      const ch=this.chapters[this.chapterIndexAt(this.uiTime())];
      const art=this.coverUrl?[{src:this.coverUrl,sizes:'512x512',type:'image/jpeg'}]:[];
      navigator.mediaSession.metadata=new MediaMetadata({
        title:(this.chapters.length>1&&ch)?ch.title:(this.book.title||'Audiolivro'),
        artist:this.book.author||'Veredas Reader',
        album:this.book.title||'',
        artwork:art
      });
    }catch(e){}
  }
  updatePositionState(force=false){
    if(!('mediaSession' in navigator)||!navigator.mediaSession.setPositionState)return;
    const now=performance.now();
    if(!force&&now-this.lastPos<1000)return;
    this.lastPos=now;
    try{
      if(this.duration>0){
        navigator.mediaSession.setPositionState({
          duration:this.duration,playbackRate:this.rate||1,
          position:Utils.clamp(this.uiTime(),0,this.duration)
        });
      }
    }catch(e){}
  }
  clearMediaSession(){
    if(!('mediaSession' in navigator))return;
    try{
      navigator.mediaSession.metadata=null;
      navigator.mediaSession.playbackState='none';
      ['play','pause','stop','seekbackward','seekforward','seekto','previoustrack','nexttrack'].forEach(a=>{
        try{navigator.mediaSession.setActionHandler(a,null)}catch(e){}
      });
    }catch(e){}
  }
}
/* WAV de zero amostras, usado só para liberar o <audio> no iOS. */
AudioPlayer.SILENCE='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';


/* ============================================================
   READER ENGINE
   ============================================================ */
class TextToSpeechController{
  constructor(reader){
    this.reader=reader;this.supported='speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    this.playing=false;this.paused=false;this.pageIndex=0;this.segmentIndex=0;this.segments=[];this.runId=0;this.wakeLock=null;
    this.bind();
  }
  bind(){
    const open=()=>this.openPanel();
    document.getElementById('btn-reader-tts').onclick=open;
    document.getElementById('btn-tts-play').onclick=()=>this.toggle();
    document.getElementById('btn-tts-back').onclick=()=>this.skip(-1);
    document.getElementById('btn-tts-forward').onclick=()=>this.skip(1);
    document.querySelectorAll('[data-tts-rate]').forEach(btn=>btn.onclick=async()=>{
      await App.updateSetting('ttsRate',Number(btn.dataset.ttsRate));
      this.refreshPanel();
      if(this.playing){this.stop(false);this.start(this.pageIndex,this.segmentIndex)}
    });
    document.getElementById('tts-voice').onchange=async e=>{
      await App.updateSetting('ttsVoiceURI',e.target.value);
      if(this.playing){this.stop(false);this.start(this.pageIndex,this.segmentIndex)}
    };
    if(this.supported){
      speechSynthesis.addEventListener?.('voiceschanged',()=>this.populateVoices());
      window.addEventListener('pagehide',()=>this.stop());
    }
  }
  populateVoices(){
    const select=document.getElementById('tts-voice');if(!select||!this.supported)return;
    const chosen=App.state.settings.ttsVoiceURI||'';
    const voices=speechSynthesis.getVoices().slice().sort((a,b)=>{
      const aPt=/^pt/i.test(a.lang)?0:1,bPt=/^pt/i.test(b.lang)?0:1;
      return aPt-bPt||a.name.localeCompare(b.name);
    });
    select.innerHTML='<option value="">Voz padrão do sistema</option>';
    voices.forEach(v=>{
      const option=document.createElement('option');option.value=v.voiceURI;option.textContent=`${v.name} — ${v.lang}`;
      if(v.voiceURI===chosen)option.selected=true;select.appendChild(option);
    });
  }
  refreshPanel(){
    const title=this.reader.currentBook?.title||'Livro';
    document.getElementById('tts-book-title').textContent=title;
    document.getElementById('tts-status').textContent=!this.supported?'Leitura em voz alta não disponível neste navegador':this.paused?'Em pausa':this.playing?`Lendo página ${this.pageIndex+1} de ${this.reader.pagesData.length}`:'Pronto para começar';
    const btn=document.getElementById('btn-tts-play');
    btn.disabled=!this.supported;btn.setAttribute('aria-label',this.playing&&!this.paused?'Pausar leitura':'Iniciar leitura');
    btn.innerHTML=`<i data-lucide="${this.playing&&!this.paused?'pause':'play'}"></i>`;
    document.getElementById('btn-reader-tts')?.classList.toggle('is-playing',this.playing&&!this.paused);
    document.querySelectorAll('[data-tts-rate]').forEach(x=>x.classList.toggle('active',Number(x.dataset.ttsRate)===Number(App.state.settings.ttsRate||1)));
    lucide.createIcons({root:document.getElementById('panel-tts')});
  }
  openPanel(){
    if(!this.supported)Utils.toast('A leitura em voz alta não é suportada neste navegador.','alert-triangle');
    if(!this.playing)this.pageIndex=this.reader.currentPageIndex;
    this.populateVoices();this.refreshPanel();App.openPanel('panel-tts');
  }
  async toggle(){
    if(!this.supported)return;
    if(this.playing&&!this.paused){speechSynthesis.pause();this.paused=true;this.updateMediaSession('paused');this.refreshPanel();return}
    if(this.playing&&this.paused){speechSynthesis.resume();this.paused=false;this.updateMediaSession('playing');this.refreshPanel();return}
    await this.start(this.reader.currentPageIndex,0);
  }
  async start(pageIndex,segmentIndex=0){
    if(!this.reader.currentBook)return;
    App.player?.pauseForOtherMedia();
    this.stop(false);this.playing=true;this.paused=false;this.pageIndex=Utils.clamp(pageIndex,0,this.reader.pagesData.length-1);this.segmentIndex=segmentIndex;
    await this.requestWakeLock();this.updateMediaSession('playing');this.refreshPanel();
    await this.loadPageAndSpeak();
  }
  async loadPageAndSpeak(){
    const run=++this.runId;
    try{
      const text=await this.reader.getPageSpeechText(this.pageIndex);
      if(!this.playing||run!==this.runId)return;
      this.segments=this.segmentText(text);
      if(!this.segments.length){this.advance();return}
      this.segmentIndex=Utils.clamp(this.segmentIndex,0,this.segments.length-1);
      this.speakSegment(run);
    }catch(e){console.error(e);this.stop();Utils.toast('Não foi possível preparar este trecho para áudio.','alert-triangle')}
  }
  segmentText(text){
    const normalized=(text||'').replace(/\s+/g,' ').trim();if(!normalized)return[];
    const sentences=normalized.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)||[normalized];
    const parts=[];let current='';
    sentences.forEach(sentence=>{
      if((current+' '+sentence).length>280&&current){parts.push(current.trim());current=sentence}
      else current+=' '+sentence;
    });
    if(current.trim())parts.push(current.trim());return parts;
  }
  speakSegment(run){
    if(!this.playing||run!==this.runId)return;
    const utterance=new SpeechSynthesisUtterance(this.segments[this.segmentIndex]);
    const voiceURI=App.state.settings.ttsVoiceURI;
    utterance.voice=speechSynthesis.getVoices().find(v=>v.voiceURI===voiceURI)||null;
    utterance.lang=utterance.voice?.lang||document.documentElement.lang||'pt-BR';
    utterance.rate=Number(App.state.settings.ttsRate)||1;
    utterance.onend=()=>{
      if(!this.playing||run!==this.runId)return;
      this.segmentIndex++;
      if(this.segmentIndex<this.segments.length)this.speakSegment(run);else this.advance();
    };
    utterance.onerror=e=>{if(e.error!=='interrupted'&&e.error!=='canceled'){console.warn(e);this.stop();Utils.toast('A voz foi interrompida pelo navegador.','alert-triangle')}};
    speechSynthesis.speak(utterance);
  }
  advance(){
    if(!this.playing)return;
    if(this.pageIndex>=this.reader.pagesData.length-1){this.stop();Utils.toast('Leitura concluída.','check-circle');return}
    this.pageIndex++;this.segmentIndex=0;this.reader.turnToPage(this.pageIndex,{fromTts:true});this.refreshPanel();this.loadPageAndSpeak();
  }
  skip(direction){
    const next=Utils.clamp(this.pageIndex+direction,0,this.reader.pagesData.length-1);
    if(next===this.pageIndex&&direction<0){this.segmentIndex=0;if(this.playing){this.stop(false);this.start(next,0)}return}
    if(this.playing){this.stop(false);this.start(next,0)}else{this.reader.turnToPage(next);this.pageIndex=next;this.refreshPanel()}
  }
  async requestWakeLock(){
    try{if('wakeLock' in navigator)this.wakeLock=await navigator.wakeLock.request('screen')}catch(e){}
  }
  async releaseWakeLock(){try{await this.wakeLock?.release?.()}catch(e){}this.wakeLock=null}
  updateMediaSession(state){
    if(!('mediaSession' in navigator))return;
    if(App.player&&App.player.isActive())return;   /* os controles do sistema pertencem ao audiolivro */
    try{
      navigator.mediaSession.playbackState=state;
      navigator.mediaSession.metadata=new MediaMetadata({title:this.reader.currentBook?.title||'Leitura',artist:'Veredas Reader'});
      navigator.mediaSession.setActionHandler('play',()=>this.toggle());
      navigator.mediaSession.setActionHandler('pause',()=>this.toggle());
      navigator.mediaSession.setActionHandler('nexttrack',()=>this.skip(1));
      navigator.mediaSession.setActionHandler('previoustrack',()=>this.skip(-1));
    }catch(e){}
  }
  stop(release=true){
    this.runId++;if(this.supported)speechSynthesis.cancel();this.playing=false;this.paused=false;if(release)this.releaseWakeLock();this.updateMediaSession('none');this.refreshPanel();
  }
}

/* ============================================================
   MOTOR DE VIRADA DE PÁGINA — FOLHA REAL
   ------------------------------------------------------------
   A folha dobra exatamente como papel: o canto segurado é levado
   até o dedo e o vinco nasce na bissetriz perpendicular entre os
   dois pontos. Por isso a dobra fica reta quando o gesto é
   horizontal e inclina sozinha quando o gesto é diagonal.

   Três camadas compõem a cena, todas recortadas por semiplanos
   feitos com wrappers girados + overflow (nada de clip-path), de
   modo que cada quadro só atualiza "transform" e a animação roda
   na GPU sem repintar o texto:
     1. sombra projetada sobre a página revelada;
     2. parte da folha que continua deitada;
     3. aba dobrada (verso do papel) espelhada pelo vinco.

   As páginas reais não são tocadas: o motor trabalha com cópias
   temporárias, então grifos, notas, seleção de texto, fontes e
   temas continuam funcionando exatamente como antes.
   ============================================================ */
class PageCurlEngine{
  constructor(reader){
    this.reader=reader;
    this.layer=null;this.parts=null;
    this.active=false;this.dragging=false;this.animating=false;
    this.raf=0;this.dir=0;this.leafIndex=-1;this.underIndex=-1;
    this.W=0;this.H=0;this.K=0;this.anchorY=0;
    this.cornerX=0;this.cornerY=0;this.t=0;
  }
  get container(){return this.reader.container}
  mode(){return this.reader.effectiveTurnMode()}
  available(){
    const r=this.reader;
    if(this.mode()!=='curl')return false;
    if(!r.container||!r.container.isConnected)return false;
    if(r.isVerticalReading())return false;
    /* A folha real dobra a partir da borda direita: no sentido mangá
       o deslize é quem assume. */
    if(r.rtl)return false;
    if(!Array.isArray(r.pagesData)||r.pagesData.length<2)return false;
    return true;
  }
  pageEl(i){return this.container?this.container.querySelector(`.page[data-page="${i}"]`):null}
  measure(){
    const rect=this.container.getBoundingClientRect();
    this.W=Math.max(1,Math.round(rect.width));
    this.H=Math.max(1,Math.round(rect.height));
    this.top=rect.top;
    this.K=Math.ceil(Math.hypot(this.W,this.H)*2.4);
  }
  /* Cópia visual da página, inclusive os pixels já desenhados de PDF. */
  clonePage(el){
    const clone=el.cloneNode(true);
    clone.removeAttribute('id');
    clone.classList.remove('active','prev','next','curl-under','curl-source','page-cut');
    clone.setAttribute('aria-hidden','true');
    clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
    const src=el.querySelectorAll('canvas'),dst=clone.querySelectorAll('canvas');
    dst.forEach((canvas,i)=>{
      const from=src[i];
      if(!from||!from.width||!from.height)return;
      try{
        canvas.width=from.width;canvas.height=from.height;
        canvas.getContext('2d').drawImage(from,0,0);
      }catch(err){}
    });
    return clone;
  }
  build(dir,anchorY){
    const r=this.reader;
    const cur=r.currentPageIndex;
    const leafIndex=dir>0?cur:cur-1;
    const underIndex=dir>0?cur+1:cur;
    if(leafIndex<0||underIndex<0)return false;
    if(leafIndex>=r.pagesData.length||underIndex>=r.pagesData.length)return false;
    const leafEl=this.pageEl(leafIndex),underEl=this.pageEl(underIndex);
    if(!leafEl||!underEl)return false;
    this.measure();
    if(this.W<80||this.H<80)return false;
    try{r.renderPdfPageIfNeeded(underIndex)}catch(err){}

    const mk=(cls,parent)=>{const d=document.createElement('div');d.className=cls;parent.appendChild(d);return d};
    const layer=document.createElement('div');
    layer.className='curl-layer';

    const underFrame=mk('curl-frame',layer);
    const underInner=mk('curl-inner',underFrame);
    const underSheet=mk('curl-sheet',underInner);
    const underBand=mk('curl-band curl-band-under',underSheet);

    const flatFrame=mk('curl-frame',layer);
    const flatInner=mk('curl-inner',flatFrame);
    const flatSheet=mk('curl-sheet',flatInner);

    const mirror=mk('curl-mirror',layer);
    const flapFrame=mk('curl-frame',mirror);
    const flapInner=mk('curl-inner',flapFrame);
    const flapSheet=mk('curl-sheet curl-back',flapInner);
    const flapBand=mk('curl-band curl-band-back',flapSheet);
    const flapEdge=mk('curl-edge',flapSheet);

    [underFrame,flatFrame,flapFrame].forEach(f=>{f.style.width=`${this.K}px`;f.style.height=`${this.K}px`});
    [underInner,flatInner,flapInner].forEach(f=>{f.style.width=`${this.W}px`;f.style.height=`${this.H}px`});
    [underBand,flapBand].forEach(b=>{b.style.width='160px';b.style.height=`${this.K}px`});
    flapEdge.style.height=`${this.K}px`;

    const front=this.clonePage(leafEl);
    flatSheet.appendChild(front);
    const back=this.clonePage(leafEl);
    flapSheet.insertBefore(back,flapBand);

    leafEl.classList.add('curl-source');
    underEl.classList.add('curl-under');
    this.container.appendChild(layer);
    try{front.scrollTop=leafEl.scrollTop;back.scrollTop=leafEl.scrollTop}catch(err){}

    this.layer=layer;
    this.parts={underFrame,underInner,underBand,flatFrame,flatInner,flapFrame,flapInner,flapBand,flapEdge,mirror};
    this.dir=dir;this.leafIndex=leafIndex;this.underIndex=underIndex;
    this.anchorY=anchorY===null||anchorY===undefined
      ? this.H*0.5
      : Utils.clamp(anchorY-this.top,this.H*0.05,this.H*0.95);
    this.cornerY=this.anchorY;
    this.active=true;
    this.container.classList.add('curl-running');
    this.setTurn(dir>0?0:1);
    return true;
  }
  setTurn(t){
    this.t=Utils.clamp(t,0,1);
    this.cornerX=this.W-2*this.W*this.t;
    this.apply();
  }
  apply(){
    if(!this.parts||!this.layer)return;
    const W=this.W,K=this.K,P=this.parts;
    const ax=W,ay=this.anchorY;
    let dx=this.cornerX-ax,dy=this.cornerY-ay;
    if(dx>-0.75)dx=-0.75;
    /* papel rígido: o vinco não passa de ~62°, senão a dobra "explode" */
    const lim=Math.abs(dx)*1.88;
    if(dy>lim)dy=lim;else if(dy<-lim)dy=-lim;
    const len=Math.hypot(dx,dy)||1;
    const nx=dx/len,ny=dy/len;
    const mx=ax+dx/2,my=ay+dy/2;
    const phi=Math.atan2(ny,nx);
    const backAng=phi+Math.PI;
    const place=(frame,inner,ang)=>{
      frame.style.transform=`translate(${mx}px,${my}px) rotate(${ang}rad) translate(0px,${-K/2}px)`;
      inner.style.transform=`translate(0px,${K/2}px) rotate(${-ang}rad) translate(${-mx}px,${-my}px)`;
    };
    place(P.flatFrame,P.flatInner,phi);
    place(P.underFrame,P.underInner,backAng);
    place(P.flapFrame,P.flapInner,backAng);
    const bandT=`translate(${mx}px,${my}px) rotate(${backAng}rad) translate(0px,${-K/2}px)`;
    P.underBand.style.transform=bandT;
    P.flapBand.style.transform=bandT;
    P.flapEdge.style.transform=bandT;
    const a=1-2*nx*nx,b=-2*nx*ny,c=b,d=1-2*ny*ny;
    const e=mx-(a*mx+c*my),f=my-(b*mx+d*my);
    P.mirror.style.transform=`matrix(${a},${b},${c},${d},${e},${f})`;
    /* A sombra nasce junto com o vinco e se apaga quando a folha
       termina de sair: no fim da virada não há papel para sombrear. */
    const lift=Math.min(1,this.t*5)*Math.min(1,(1-this.t)*4);
    this.layer.style.setProperty('--curl-lift',lift.toFixed(3));
  }
  /* --- gesto do usuário ------------------------------------ */
  start(dir,anchorClientY){
    if(this.active||!this.available())return false;
    const r=this.reader;
    const next=r.currentPageIndex+dir;
    if(next<0||next>=r.pagesData.length)return false;
    if(!this.build(dir,anchorClientY))return false;
    this.dragging=true;
    r.navigating=true;
    return true;
  }
  dragBy(dx,dy){
    if(!this.active||!this.dragging)return;
    const base=this.dir>0?this.W:-this.W;
    this.cornerY=this.anchorY+dy;
    const x=base+dx*2;
    this.cornerX=x;
    this.setTurn((this.W-x)/(2*this.W));
  }
  progress(){return this.dir>0?this.t:1-this.t}
  release(vx){
    if(!this.active)return;
    this.dragging=false;
    const speed=Number.isFinite(vx)?vx:0;
    const forward=this.dir>0;
    const fling=forward?speed<-0.32:speed>0.32;
    const flingBack=forward?speed>0.4:speed<-0.4;
    const commit=!flingBack&&(this.progress()>0.32||fling);
    const target=forward?(commit?1:0):(commit?0:1);
    this.animateTo(target,Math.abs(speed),commit);
  }
  /* --- virada automática (toque nas bordas, teclado) -------- */
  animate(dir){
    if(this.active||!this.available())return false;
    const r=this.reader;
    const next=r.currentPageIndex+dir;
    if(next<0||next>=r.pagesData.length)return false;
    if(!this.build(dir,null))return false;
    r.navigating=true;
    this.cornerY=this.anchorY-Math.min(30,this.H*0.06);
    this.animateTo(dir>0?1:0,0,true);
    return true;
  }
  animateTo(target,speed,commit){
    if(!this.active)return;
    const from=this.t,delta=target-from;
    if(Math.abs(delta)<0.0005){this.finish(commit);return}
    const distance=Math.abs(delta)*2*this.W;
    const v=Utils.clamp(speed||0,0,3.5);
    const duration=v>0.25
      ? Utils.clamp(distance/(v*1.25),190,620)
      : Utils.clamp(distance/1.55,280,620);
    const y0=this.cornerY,y1=commit?this.cornerY:this.anchorY;
    const started=performance.now();
    this.animating=true;
    const step=now=>{
      if(!this.active)return;
      const k=Utils.clamp((now-started)/duration,0,1);
      const eased=1-Math.pow(1-k,3);
      this.cornerY=y0+(y1-y0)*eased;
      this.setTurn(from+delta*eased);
      if(k<1){this.raf=requestAnimationFrame(step);return}
      this.raf=0;this.animating=false;
      this.finish(commit);
    };
    this.raf=requestAnimationFrame(step);
  }
  finish(commit){
    const r=this.reader;
    const dir=this.dir,leafIndex=this.leafIndex,underIndex=this.underIndex;
    if(commit){
      const index=dir>0?underIndex:leafIndex;
      r.turnToPage(index,{fromCurl:true});
    }
    this.teardown();
  }
  cancel(){this.teardown()}
  teardown(){
    if(this.raf){cancelAnimationFrame(this.raf);this.raf=0}
    if(this.container){
      const leaf=this.pageEl(this.leafIndex),under=this.pageEl(this.underIndex);
      if(leaf)leaf.classList.remove('curl-source');
      if(under)under.classList.remove('curl-under');
      this.container.classList.remove('curl-running');
    }
    if(this.layer&&this.layer.isConnected)this.layer.remove();
    this.layer=null;this.parts=null;
    this.active=false;this.dragging=false;this.animating=false;
    this.reader.navigating=false;
  }
}

/* ============================================================
   MOTOR DE VIRADA — DESLIZAR
   ------------------------------------------------------------
   A folha acompanha o dedo em tempo real: a página que sai e a
   que entra andam juntas, como duas fotos numa galeria. Soltar
   no meio do caminho desiste da virada.

   Antes, "Deslizar" só reagia quando o dedo era levantado, o que
   dava a sensação de que o gesto não tinha funcionado. Agora o
   movimento é contínuo, e o mesmo motor serve para a leitura da
   direita para a esquerda (mangá), bastando inverter o sinal.
   ============================================================ */
class PageSlideEngine{
  constructor(reader){
    this.reader=reader;
    this.active=false;this.dragging=false;this.animating=false;
    this.raf=0;this.dir=0;this.t=0;this.sign=1;this.W=1;
    this.outEl=null;this.inEl=null;this.targetIndex=-1;
  }
  get container(){return this.reader.container}
  available(){
    const r=this.reader;
    if(!r.container||!r.container.isConnected)return false;
    if(r.isVerticalReading())return false;
    if(!Array.isArray(r.pagesData)||r.pagesData.length<2)return false;
    return true;
  }
  pageEl(i){return this.container?this.container.querySelector(`.page[data-page="${i}"]`):null}
  start(dir){
    if(this.active||!this.available())return false;
    const r=this.reader;
    const alvo=r.currentPageIndex+dir;
    if(alvo<0||alvo>=r.pagesData.length)return false;
    const sai=this.pageEl(r.currentPageIndex),entra=this.pageEl(alvo);
    if(!sai||!entra)return false;
    const rect=this.container.getBoundingClientRect();
    this.W=Math.max(1,rect.width);
    this.sign=r.rtl?-1:1;
    this.dir=dir;this.t=0;this.targetIndex=alvo;
    this.outEl=sai;this.inEl=entra;
    this.active=true;this.dragging=true;
    r.navigating=true;
    this.container.classList.add('slide-running');
    entra.classList.add('slide-incoming');
    try{r.renderLazyPage(alvo)}catch(e){}
    this.apply();
    return true;
  }
  apply(){
    const d=this.dir*this.sign,W=this.W,t=this.t;
    if(this.outEl)this.outEl.style.transform=`translate3d(${-d*t*W}px,0,0)`;
    if(this.inEl)this.inEl.style.transform=`translate3d(${d*W*(1-t)}px,0,0)`;
  }
  setTurn(t){this.t=Utils.clamp(t,0,1);this.apply()}
  dragBy(dx){
    if(!this.active||!this.dragging)return;
    const d=this.dir*this.sign;
    this.setTurn((-d*dx)/this.W);
  }
  progress(){return this.t}
  release(vx){
    if(!this.active)return;
    this.dragging=false;
    const d=this.dir*this.sign;
    const v=Number.isFinite(vx)?vx:0;
    const adiante=-d*v;                       /* >0: o dedo estava a favor da virada */
    const commit=adiante<-0.38?false:(this.t>0.26||adiante>0.3);
    this.animateTo(commit?1:0,Math.abs(v),commit);
  }
  animate(dir){
    if(this.active||!this.available())return false;
    if(!this.start(dir))return false;
    this.dragging=false;
    this.animateTo(1,0,true);
    return true;
  }
  animateTo(target,speed,commit){
    if(!this.active)return;
    const de=this.t,delta=target-de;
    if(Math.abs(delta)<0.0008){this.finish(commit);return}
    const distancia=Math.abs(delta)*this.W;
    const v=Utils.clamp(speed||0,0,4);
    const duracao=v>0.25
      ? Utils.clamp(distancia/(v*1.15),150,460)
      : Utils.clamp(distancia/1.9,190,460);
    const inicio=performance.now();
    this.animating=true;
    const passo=agora=>{
      if(!this.active)return;
      const k=Utils.clamp((agora-inicio)/duracao,0,1);
      const suave=1-Math.pow(1-k,3);
      this.setTurn(de+delta*suave);
      if(k<1){this.raf=requestAnimationFrame(passo);return}
      this.raf=0;this.animating=false;
      this.finish(commit);
    };
    this.raf=requestAnimationFrame(passo);
  }
  finish(commit){
    const alvo=this.targetIndex;
    this.teardown();
    if(commit&&alvo>=0)this.reader.turnToPage(alvo,{fromCurl:true});
  }
  cancel(){this.teardown()}
  teardown(){
    if(this.raf){cancelAnimationFrame(this.raf);this.raf=0}
    if(this.outEl)this.outEl.style.transform='';
    if(this.inEl){this.inEl.style.transform='';this.inEl.classList.remove('slide-incoming')}
    if(this.container)this.container.classList.remove('slide-running');
    this.outEl=null;this.inEl=null;this.targetIndex=-1;
    this.active=false;this.dragging=false;this.animating=false;
    this.reader.navigating=false;
  }
}

class ReaderEngine{
  constructor(db,state){
    this.db=db;this.state=state;
    this.sliderBook=null;this.currentPageIndex=0;
    this.currentBook=null;this.currentExtractor=null;
    this.totalChapters=0;this.chapterTitles=[];this.chapterStarts=[];
    this.pagesData=[];this.pageMeta=[];this.pdfDoc=null;this.container=null;
    this.readerStage=document.getElementById('reader-stage');
    this.ui=document.getElementById('reader-ui');
    this.navigating=false;this.uiTimer=null;this.curl=null;
    /* sentido efetivo do livro aberto; definido a cada abertura */
    this.readingMode='horizontal';
    this.pendingSelection=null;this.selectedHighlightColor='#f3d76a';
    this.annotationPressTimer=null;this.activeAnnotationId=null;
    /* Quadrinhos: arquivo aberto, agrupamento de páginas e estado do zoom. */
    this.comic=null;this.comicViews=[];this.comicRtl=false;
    this.comicFit='page';this.comicSpread=true;this.comicRatio=null;
    this.comicZoom={scale:1,x:0,y:0};
    this.rtl=false;
    this.selectionFrame=null;this.pdfZoom=Number(state.settings.pdfZoom)||1;this.pdfMode=state.settings.pdfReadingMode||'lateral';
    this.persistProgressDebounced=Utils.debounce(i=>this.persistProgress(i),900);
    this.bind();
    this.tts=new TextToSpeechController(this);
  }
  bind(){
    document.addEventListener('keydown',e=>{
      if(!document.getElementById('view-reader').classList.contains('active'))return;
      if(e.key==='ArrowRight')this.flip(1);
      else if(e.key==='ArrowLeft')this.flip(-1);
      else if(e.key==='Escape'){this.hideUI();App.closePanels()}
    });
    document.getElementById('btn-close-reader').onclick=async()=>{
      if(this.currentBook&&this.sliderBook)await this.persistProgress(this.currentPageIndex);
      this.close();
    };
    document.getElementById('btn-reader-bookmark').onclick=()=>this.toggleBookmark();
    document.getElementById('btn-reader-annotations').onclick=()=>this.showAnnotations();
    document.getElementById('btn-reader-settings').onclick=()=>App.openPanel('panel-settings');
    document.getElementById('btn-reader-toc').onclick=()=>this.openToc();
    document.getElementById('btn-reader-layout').onclick=()=>this.toggleReadingMode();
    document.getElementById('sel-highlight').onclick=()=>this.saveSelection('highlight');
    document.getElementById('sel-quote').onclick=()=>this.saveSelection('quote');
    document.getElementById('sel-note').onclick=()=>this.openNoteForSelection();
    document.getElementById('sel-share').onclick=()=>this.shareSelection();
    document.querySelectorAll('.sel-color').forEach(btn=>btn.onclick=e=>{
      e.stopPropagation();
      this.selectedHighlightColor=btn.dataset.hlColor;
      document.querySelectorAll('.sel-color').forEach(x=>x.classList.remove('active'));
      btn.classList.add('active');
    });
    
    const scrubber = document.getElementById('reader-page-slider');
    if(scrubber) {
      scrubber.addEventListener('input', e => {
        document.getElementById('scrubber-current').textContent = Number(e.target.value) + 1;
      });
      scrubber.addEventListener('change', e => {
        if(this.sliderBook) {
           this.turnToPage(Number(e.target.value));
        }
      });
    }

    document.addEventListener('selectionchange',()=>this.scheduleSelectionCapture());
    document.addEventListener('pointerup',()=>this.scheduleSelectionCapture());
    document.addEventListener('touchend',()=>this.scheduleSelectionCapture(),{passive:true});
    
    this.readerStage.addEventListener('contextmenu',e=>e.preventDefault());
    this.readerStage.addEventListener('click',e=>{
      const link=e.target.closest?.('a[href]');
      if(link){e.preventDefault();e.stopPropagation()}
    },true);
    this.readerStage.addEventListener('pointerdown',e=>this.startAnnotationPress(e));
    ['pointerup','pointercancel','pointerleave'].forEach(type=>this.readerStage.addEventListener(type,()=>this.cancelAnnotationPress()));
    window.addEventListener('resize',Utils.debounce(()=>{
      if(!this.currentBook||!document.getElementById('view-reader').classList.contains('active'))return;
      /* Quadrinho não precisa repaginar: o arquivo continua aberto e só
         o arranjo das páginas na tela muda (retrato x paisagem). */
      if(this.comic)this.refreshComicLayout();
      else this.triggerRePagination();
    },320));
  }
  scheduleSelectionCapture(){
    cancelAnimationFrame(this.selectionFrame);
    this.selectionFrame=requestAnimationFrame(()=>this.captureSelection());
  }
  showUI(){this.ui.classList.add('visible');clearTimeout(this.uiTimer);this.uiTimer=setTimeout(()=>this.hideUI(),5000)}
  hideUI(){clearTimeout(this.uiTimer);this.ui.classList.remove('visible')}
  pageWidth(){
    const mobile=window.innerWidth<800||window.innerHeight>window.innerWidth;
    return (this.state.settings.orientation==='portrait'||(this.state.settings.orientation==='auto'&&mobile))
      ? window.innerWidth
      : Math.floor(window.innerWidth/2);
  }
  pagSignature(book,w,h){
    const s=this.state.settings;
    return `${book.id}__${s.fontFamily}__${s.fontSize}__${s.lineHeight}__${s.margin}__${Math.round(w)}x${Math.round(h)}__paginator-v4`;
  }
  async openBook(book){
    /* Audiolivros têm player próprio; todo ponto do app que "abre um livro"
       passa por aqui, então nenhum outro lugar precisa saber a diferença. */
    if(AudioFormats.isAudioBook(book))return App.player.open(book);
    if(this.navigating)return;
    App.player?.pauseForOtherMedia();
    this.navigating=true;
    this.currentBook=Utils.normalizeBook(book);
    /* cada livro entra com o SEU sentido de rolagem */
    this.readingMode=this.resolveReadingMode(this.currentBook.format,this.currentBook);
    const ehQuadrinho=BookFormats.isComic(this.currentBook.format);
    const ctrl=new AbortController();
    this.openController=ctrl;
    /* Descompactar um quadrinho grande leva mais tempo do que montar
       as páginas de um livro de texto: o limite acompanha o formato. */
    const watchdog=setTimeout(()=>{
      if(!ctrl.signal.aborted){
        this.openTimedOut=true;
        ctrl.abort();
      }
    },ehQuadrinho?ReaderEngine.OPEN_TIMEOUT_COMIC:ReaderEngine.OPEN_TIMEOUT);
    this.openTimedOut=false;
    Utils.showLoader('Abrindo livro','Preparando sua leitura...',{
      progress:true,
      onCancel:()=>{this.openCancelled=true;ctrl.abort()}
    });
    this.openCancelled=false;
    try{
      const isComic=ehQuadrinho;
      const file=await this.db.getFile(book.id);
      /* Quadrinhos entram como Blob; os demais, como ArrayBuffer. Livros
         importados em versões antigas podem estar no outro formato, então
         os dois caminhos são aceitos. */
      const fonte=isComic?(file&&(file.blob||file.buffer)):(file&&file.buffer);
      if(!fonte)throw new ParseError('O arquivo deste livro não está mais salvo no aparelho.','Importe o arquivo novamente para continuar a leitura.');
      this.destroy();
      document.getElementById('reader-title').textContent=book.title||'Livro';
      this.pdfMode=this.readingMode;
      this.pdfZoom=Utils.clamp(Number(this.state.settings.pdfZoom)||1,.75,3);
      App.switchView('reader');
      this.hideUI();
      let start=book.progress?.globalPage??null;
      const w=this.pageWidth(),h=window.innerHeight;
      
      const signal=ctrl.signal;
      if(isComic){
        start=await this.openComic(fonte,book,start,signal);
      }else if(book.format==='pdf'){
        start=await this.openPdf(file.buffer,book,start);
      }else if(book.format==='docx'){
        start=await this.openDocx(file.buffer,book,w,h,start,signal);
      }else if(book.format==='mobi'){
        start=await this.openMobi(file.buffer,book,w,h,start,signal);
      }else if(book.format==='md'){
        start=await this.openMd(file.buffer,book,w,h,start,signal);
      }else if(book.format==='txt'){
        start=await this.openTxt(file.buffer,book,w,h,start,signal);
      }else{
        start=await this.openEpub(file.buffer,book,w,h,start,signal);
      }
      
      if(!this.pagesData.length){
        this.pagesData=['<p></p>'];
        this.pageMeta=[{globalPage:0,chapter:0,localPage:0,title:book.title}];
        this.chapterStarts=[0];
      }
      start=Utils.clamp(Number.isFinite(start)?start:0,0,this.pagesData.length-1);
      let changedLegacy=false;
      this.currentBook.bookmarks=this.currentBook.bookmarks.map(m=>{
        if(m.globalPage==null){
          const gp=(this.chapterStarts[m.chapter??0]??0)+(m.pageIndex??0);
          changedLegacy=true;
          return{...m,globalPage:gp,title:m.title||this.pageMeta[gp]?.title||`Página ${gp+1}`};
        }
        return m;
      });
      this.currentBook.progress={
        ...(this.currentBook.progress||{}),
        globalPage:start,readPages:start+1,totalPages:this.pagesData.length,
        percentage:Math.round(((start+1)/Math.max(1,this.pagesData.length))*100)
      };
      if(this.comic){
        this.currentBook.progress.comicPage=(this.comicViews[start]||[start])[0];
        this.currentBook.progress.totalComicPages=this.comic.length;
      }
      this.currentBook.totalPages=this.pagesData.length;
      if(changedLegacy)await this.db.updateBook(this.currentBook);
      
      Utils.setLoaderProgress(100,'Quase lá...');
      await this.initSliderBook(start);
      this.showUI();
    }catch(e){
      if(Utils.isAbort(e)){
        if(this.openTimedOut){
          Utils.toast('O livro demorou demais para abrir e foi interrompido.','alert-triangle');
        }else if(this.openCancelled){
          Utils.toast('Abertura cancelada.','x');
        }
        this.close();
      }else{
        console.error(e);
        const isParse=e instanceof ParseError;
        Utils.toast(isParse?e.message:'Não foi possível abrir este livro.','alert-triangle');
        if(isParse&&e.hint)setTimeout(()=>Utils.toast(e.hint,'info'),900);
        this.close();
      }
    }finally{
      clearTimeout(watchdog);
      this.openController=null;
      Utils.hideLoader();
      this.navigating=false;
    }
  }
  /* Repassa o andamento da paginação para a barra de progresso. */
  paginationOpts(signal,floor=15,ceiling=98){
    return{
      signal,
      onProgress:(done,total,pagesSoFar)=>{
        const ratio=total?Math.min(1,done/total):0;
        Utils.setLoaderProgress(floor+ratio*(ceiling-floor),
          pagesSoFar?`Montando as páginas — ${pagesSoFar} prontas`:'Montando as páginas...');
      }
    };
  }
  /* Converte capítulos em páginas marcadas e reconstrói o índice. */
  markChapters(chapters){
    return chapters.map((ch,i)=>
      `<span data-doc-chapter-marker="${i}" aria-hidden="true"></span>${ch.html||'<p></p>'}`
    ).join('');
  }
  buildChapterMeta(chapters,fallbackTitle){
    const count=chapters.length;
    this.totalChapters=count;
    this.chapterTitles=chapters.map((c,i)=>c.title||`Parte ${i+1}`);
    const starts=Array(count).fill(-1);
    let active=0;
    this.pageMeta=this.pagesData.map((page,globalPage)=>{
      const markers=[...page.matchAll(/data-doc-chapter-marker="(\d+)"/g)].map(m=>Number(m[1]));
      markers.forEach(ch=>{if(starts[ch]===-1)starts[ch]=globalPage});
      if(markers.length)active=markers[markers.length-1];
      return{globalPage,chapter:active,localPage:0,title:this.chapterTitles[active]||fallbackTitle};
    });
    let last=0;
    this.chapterStarts=starts.map(s=>{if(s>=0)last=s;return last});
    const local=Array(count).fill(0);
    this.pageMeta.forEach(m=>{m.localPage=local[m.chapter]++});
  }
  restoreFromCache(cached){
    this.pagesData=cached.pagesData;
    this.pageMeta=cached.pageMeta;
    this.chapterStarts=cached.chapterStarts;
    this.chapterTitles=cached.chapterTitles;
    this.totalChapters=cached.totalChapters;
  }
  /* Livros com muitas imagens embutidas estouram o IndexedDB: nesses casos
     preferimos repaginar na próxima abertura a encher o armazenamento. */
  async cachePages(sig,format){
    try{
      let bytes=0;
      for(const p of this.pagesData){
        bytes+=p.length;
        if(bytes>ReaderEngine.MAX_CACHE_CHARS)return false;
      }
      await this.db.setPageCache(sig,{
        pagesData:this.pagesData,pageMeta:this.pageMeta,
        chapterStarts:this.chapterStarts,chapterTitles:this.chapterTitles,
        totalChapters:this.totalChapters,format
      });
      return true;
    }catch(e){console.warn('Cache de páginas não salvo:',e);return false}
  }
  async openPdf(buffer,book,start){
    const{pdf,numPages}=await PDFParser.parse(buffer);
    this.pdfDoc=pdf;
    this.totalChapters=numPages;
    this.chapterTitles=Array.from({length:numPages},(_,i)=>`Página ${i+1}`);
    this.chapterStarts=Array.from({length:numPages},(_,i)=>i);
    this.pagesData=Array.from({length:numPages},(_,i)=>
      `<div class="pdf-page-wrap" data-pdf-page="${i+1}"><div class="pdf-loading"><div class="spinner"></div><span>Carregando página ${i+1}...</span></div></div>`
    );
    this.pageMeta=this.pagesData.map((_,i)=>({globalPage:i,chapter:i,localPage:0,title:`Página ${i+1}`}));
    if(start===null)start=book.progress?.pageIndex??0;
    return start;
  }

  /* ============================================================
     QUADRINHOS
     ------------------------------------------------------------
     O arquivo fica aberto durante toda a leitura e as páginas são
     lidas conforme aparecem. O que vai para a tela é uma "vista":
     uma página sozinha ou, no modo revista aberta, duas lado a lado.
     ============================================================ */
  async openComic(source,book,start,signal){
    Utils.setLoaderProgress(8,'Abrindo o quadrinho...');
    const arquivo=await ComicArchive.open(source,{
      name:book.sourceFileName||`${book.title||'quadrinho'}.${book.format}`,
      signal,
      onStatus:texto=>Utils.setLoaderText(null,texto)
    });
    if(signal&&signal.aborted){arquivo.close();throw new DOMException('Cancelado','AbortError')}
    this.comic=arquivo;
    const s=this.state.settings;
    /* Sentido de leitura: o livro manda; depois o ComicInfo.xml do
       próprio arquivo; por último, o padrão do aplicativo. */
    this.comicRtl=book.comicRtl!=null?!!book.comicRtl:!!(arquivo.info&&arquivo.info.rtl);
    this.comicFit=book.comicFit||s.comicFit||'page';
    this.comicSpread=book.comicSpread!=null?!!book.comicSpread:(s.comicSpread!==false);
    this.comicZoom={scale:1,x:0,y:0};
    Utils.setLoaderProgress(92,`${arquivo.length} página(s) prontas`);
    this.buildComicViews();
    if(start===null){
      const guardada=book.progress?.comicPage;
      start=Number.isFinite(guardada)?this.viewOfComicPage(guardada):(book.progress?.pageIndex??0);
    }
    return start;
  }
  /* Páginas por vista: 1 no retrato, 2 no paisagem (com a capa sozinha,
     como numa revista de verdade). */
  comicSpreadActive(){
    if(!this.comic||!this.comicSpread)return false;
    if(this.isVerticalReading())return false;
    if(this.comic.length<3)return false;
    return window.innerWidth>window.innerHeight*1.05;
  }
  buildComicViews(){
    const total=this.comic?this.comic.length:0;
    const views=[];
    if(this.comicSpreadActive()){
      if(total>0)views.push([0]);
      for(let i=1;i<total;i+=2){
        views.push(i+1<total?[i,i+1]:[i]);
      }
    }else{
      for(let i=0;i<total;i++)views.push([i]);
    }
    this.comicViews=views;
    this.pagesData=views.map((v,i)=>this.comicViewHtml(v,i));
    this.chapterTitles=views.map(v=>v.length>1?`Páginas ${v[0]+1}–${v[1]+1}`:`Página ${v[0]+1}`);
    this.chapterStarts=views.map((_,i)=>i);
    this.totalChapters=views.length;
    this.pageMeta=views.map((v,i)=>({globalPage:i,chapter:i,localPage:0,
      title:this.chapterTitles[i],comicPages:v.slice()}));
  }
  comicSlotsHtml(pages){
    return (pages||[]).map(p=>
      `<div class="comic-slot" data-comic-page="${p}"><div class="comic-loading"><div class="spinner"></div></div></div>`
    ).join('');
  }
  comicViewHtml(pages,index){
    return `<div class="comic-page-wrap${pages.length>1?' is-spread':''}" data-comic-view="${index}">`+
      `${this.comicSlotsHtml(pages)}</div>`;
  }
  viewOfComicPage(page){
    const alvo=Number(page)||0;
    const i=this.comicViews.findIndex(v=>v.includes(alvo));
    return i>=0?i:Utils.clamp(alvo,0,Math.max(0,this.comicViews.length-1));
  }
  currentComicPage(){
    const v=this.comicViews[this.currentPageIndex];
    return v?v[0]:0;
  }
  /* Girar o aparelho, ligar/desligar a revista aberta ou trocar o
     ajuste da imagem: nada disso reabre o arquivo. */
  async refreshComicLayout(){
    if(!this.comic||!this.sliderBook)return;
    const pagina=this.currentComicPage();
    this.buildComicViews();
    const slider=document.getElementById('reader-page-slider');
    if(slider)slider.max=Math.max(0,this.pagesData.length-1);
    const total=document.getElementById('scrubber-total');
    if(total)total.textContent=this.pagesData.length;
    await this.initSliderBook(this.viewOfComicPage(pagina));
  }
  async setComicOption(chave,valor){
    if(!this.currentBook||!this.comic)return;
    const campos={comicFit:'comicFit',comicSpread:'comicSpread',comicRtl:'comicRtl'};
    if(!campos[chave])return;
    this.currentBook[chave]=valor;
    if(chave==='comicFit')this.comicFit=valor;
    if(chave==='comicSpread')this.comicSpread=!!valor;
    if(chave==='comicRtl')this.comicRtl=!!valor;
    try{
      await this.db.patchBook(this.currentBook.id,b=>{b[chave]=valor});
    }catch(e){console.warn('Preferência do quadrinho não foi salva.',e)}
    const lista=App.library&&App.library.allBooks;
    if(lista){
      const i=lista.findIndex(b=>b.id===this.currentBook.id);
      if(i>=0)lista[i][chave]=valor;
    }
    /* A preferência também vira o padrão dos próximos quadrinhos. */
    try{await App.updateSetting(chave,valor)}catch(e){}
    await this.refreshComicLayout();
  }
  async renderComicPageIfNeeded(viewIndex){
    if(!this.comic||!this.container)return;
    if(viewIndex<0||viewIndex>=this.comicViews.length)return;
    const wrap=this.container.querySelector(`.comic-page-wrap[data-comic-view="${viewIndex}"]`);
    if(!wrap||wrap.dataset.rendered==='1')return;
    wrap.dataset.rendered='1';
    const slots=Array.from(wrap.querySelectorAll('.comic-slot'));
    for(const slot of slots){
      const p=Number(slot.dataset.comicPage);
      try{
        const url=await this.comic.pageUrl(p);
        if(!url||!slot.isConnected)continue;
        const img=document.createElement('img');
        img.className='comic-img';
        img.alt=`Página ${p+1}`;
        img.decoding='async';
        img.draggable=false;
        img.addEventListener('load',()=>{
          slot.classList.add('ready');
          this.learnComicRatio(img);
        },{once:true});
        img.addEventListener('error',()=>{
          slot.classList.add('ready');
          slot.innerHTML='<div class="comic-error">Esta página não pôde ser exibida.</div>';
        },{once:true});
        img.src=url;
        slot.innerHTML='';
        slot.appendChild(img);
      }catch(err){
        console.warn(err);
        slot.classList.add('ready');
        slot.innerHTML=`<div class="comic-error">${Utils.esc(err&&err.message?err.message:'Página indisponível.')}</div>`;
      }
    }
    this.trimComicMemory();
  }
  /* Na rolagem contínua, uma página ainda não carregada precisa ocupar
     desde já o espaço que vai ocupar depois. Sem isso o documento
     encolhe e cresce a cada imagem que chega, e a rolagem parece
     "escorregar" debaixo do dedo. Como as páginas de um quadrinho têm
     quase sempre o mesmo tamanho, a primeira que carrega já ensina a
     proporção de todas as outras. */
  learnComicRatio(img){
    if(!img||!img.naturalWidth||!img.naturalHeight)return;
    const proporcao=img.naturalHeight/img.naturalWidth;
    if(!Number.isFinite(proporcao)||proporcao<=0)return;
    if(this.comicRatio&&Math.abs(this.comicRatio-proporcao)<0.02)return;
    if(!this.comicRatio)this.comicRatio=proporcao;
    this.reserveComicHeights();
  }
  reserveComicHeights(){
    if(!this.comic||!this.container||!this.comicRatio)return;
    if(!this.isVerticalReading())return;
    const largura=this.container.clientWidth||window.innerWidth;
    const altura=Math.round(largura*this.comicRatio);
    if(!altura)return;
    this.container.querySelectorAll('.comic-page-wrap').forEach(wrap=>{
      if(wrap.dataset.rendered==='1')return;
      wrap.style.minHeight=`${altura}px`;
      /* A marca desliga a altura de chute do espaçador: um filho mais
         alto que o pai não deixaria a reserva valer. */
      wrap.dataset.reserved='1';
    });
  }
  /* Mantém na memória só as páginas por perto: um quadrinho de 200
     páginas não cabe inteiro na memória de um celular. */
  trimComicMemory(){
    if(!this.comic||!this.container)return;
    const atual=this.currentPageIndex;
    const janela=this.isVerticalReading()?4:2;
    const manter=new Set();
    for(let v=atual-janela;v<=atual+janela;v++){
      const view=this.comicViews[v];
      if(view)view.forEach(p=>manter.add(p));
    }
    const vertical=this.isVerticalReading();
    this.container.querySelectorAll('.comic-page-wrap[data-rendered="1"]').forEach(wrap=>{
      const v=Number(wrap.dataset.comicView);
      if(Math.abs(v-atual)<=janela)return;
      /* Na rolagem contínua, a página descarregada guarda a altura que
         tinha: sem isso a barra de rolagem saltaria a cada limpeza. */
      if(vertical&&wrap.offsetHeight>0)wrap.style.minHeight=`${wrap.offsetHeight}px`;
      wrap.dataset.rendered='';
      wrap.innerHTML=this.comicSlotsHtml(this.comicViews[v]||[]);
    });
    this.comic.release(manter);
  }
  async openDocument(buffer,book,w,h,start,signal,format){
    const sig=this.pagSignature(book,w,h);
    const cached=await this.db.getPageCache(sig);
    if(cached&&cached.pagesData){
      this.restoreFromCache(cached);
      if(start===null)start=book.progress?.pageIndex??0;
      return start;
    }
    const label=format==='docx'?'Lendo o documento':format==='md'?'Lendo o Markdown':'Lendo o livro';
    Utils.setLoaderProgress(4,label+'...');
    const parser=format==='docx'?DOCXParser:format==='md'?MDParser:MOBIParser;
    const html=await parser.parse(buffer,{
      signal,
      onProgress:(text,ratio)=>Utils.setLoaderProgress(4+(Number(ratio)||0)*10,text+'...')
    });
    if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
    Utils.setLoaderProgress(15,'Separando os capítulos...');
    await Utils.yieldToUI();
    const chapters=DocUtils.splitChapters(html,book.title||'Livro');
    this.pagesData=await DOMPaginator.paginateHtml(
      this.markChapters(chapters),w,h,
      this.state.settings.fontSize,this.state.settings.fontFamily,
      this.state.settings.lineHeight,this.state.settings.margin,
      this.paginationOpts(signal)
    );
    this.buildChapterMeta(chapters,book.title||'Livro');
    await this.cachePages(sig,format);
    if(start===null)start=book.progress?.pageIndex??0;
    return start;
  }
  async openDocx(buffer,book,w,h,start,signal){
    return this.openDocument(buffer,book,w,h,start,signal,'docx');
  }
  async openMobi(buffer,book,w,h,start,signal){
    return this.openDocument(buffer,book,w,h,start,signal,'mobi');
  }
  /* Markdown segue o caminho do DOCX: vira HTML, ganha capítulos pelos
     títulos e é paginado igual a qualquer outro livro. */
  async openMd(buffer,book,w,h,start,signal){
    return this.openDocument(buffer,book,w,h,start,signal,'md');
  }
  async openTxt(buffer,book,w,h,start,signal){
    const sig=this.pagSignature(book,w,h);
    const cached=await this.db.getPageCache(sig);
    if(cached&&cached.pagesData){
      this.restoreFromCache(cached);
    }else{
      let txtData;
      try{txtData=new TextDecoder('utf-8',{fatal:true}).decode(buffer)}
      catch(e){txtData=new TextDecoder('windows-1252').decode(buffer)}
      const html=TXTParser.toHtml(txtData);
      this.pagesData=await DOMPaginator.paginateHtml(html,w,h,this.state.settings.fontSize,this.state.settings.fontFamily,this.state.settings.lineHeight,this.state.settings.margin,this.paginationOpts(signal,8));
      this.totalChapters=1;
      this.chapterTitles=[book.title];
      this.chapterStarts=[0];
      this.pageMeta=this.pagesData.map((_,i)=>({globalPage:i,chapter:0,localPage:i,title:book.title}));
      await this.cachePages(sig,'txt');
    }
    if(start===null)start=book.progress?.pageIndex??0;
    return start;
  }
  async openEpub(buffer,book,w,h,start,signal){
    const sig=this.pagSignature(book,w,h);
    const cached=await this.db.getPageCache(sig);
    if(cached&&cached.pagesData){
      this.restoreFromCache(cached);
    }else{
      const parsed=await EPUBParser.parse(buffer);
      this.currentExtractor=parsed.extractor;
      this.totalChapters=parsed.totalChapters;
      this.chapterTitles=parsed.toc||Array.from({length:this.totalChapters},(_,i)=>`Capítulo ${i+1}`);
      const chapterHtml=[];
      for(let ch=0;ch<this.totalChapters;ch++){
        if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
        if(ch%4===0){
          Utils.setLoaderProgress(2+((ch+1)/Math.max(1,this.totalChapters))*13,`Organizando capítulo ${ch+1} de ${this.totalChapters}`);
          await Utils.yieldToUI();
        }
        const raw=await parsed.extractor(ch);
        chapterHtml.push(`<span data-epub-chapter-marker="${ch}" aria-hidden="true"></span>${raw||'<p></p>'}`);
      }
      try{
        this.pagesData=await DOMPaginator.paginateHtml(chapterHtml.join(''),w,h,this.state.settings.fontSize,this.state.settings.fontFamily,this.state.settings.lineHeight,this.state.settings.margin,this.paginationOpts(signal));
      }catch(e){
        if(Utils.isAbort(e))throw e;
        console.error(e);
        this.pagesData=chapterHtml.map(html=>EPUBParser.plainTextFallback(html));
      }
      const chapterStarts=Array(this.totalChapters).fill(-1);
      let activeChapter=0;
      this.pageMeta=this.pagesData.map((page,globalPage)=>{
        const markers=[...page.matchAll(/data-epub-chapter-marker="(\d+)"/g)].map(match=>Number(match[1]));
        markers.forEach(ch=>{if(chapterStarts[ch]===-1)chapterStarts[ch]=globalPage;});
        if(markers.length)activeChapter=markers[markers.length-1];
        return {globalPage,chapter:activeChapter,localPage:0,title:this.chapterTitles[activeChapter]||`Capítulo ${activeChapter+1}`};
      });
      let lastChapterStart=0;
      this.chapterStarts=chapterStarts.map(start=>{
        if(start>=0)lastChapterStart=start;
        return lastChapterStart;
      });
      const localPages=Array(this.totalChapters).fill(0);
      this.pageMeta.forEach(meta=>{meta.localPage=localPages[meta.chapter]++;});
      await this.cachePages(sig,'epub');
    }
    if(start===null){
      const legacyChapter=Number(book.progress?.chapter||0);
      const legacyPage=Number(book.progress?.pageIndex||0);
      start=(this.chapterStarts[legacyChapter]??0)+legacyPage;
    }
    return start;
  }
  createFreshSliderContainer(){
    if(!this.readerStage)return null;
    const old=this.readerStage.querySelector('#slider-book');
    if(old)old.remove();
    const fresh=document.createElement('div');
    fresh.id='slider-book';fresh.className='slider-book';
    this.readerStage.appendChild(fresh);
    this.container=fresh;
    return fresh;
  }
  async initSliderBook(startIndex){
    this.destroySliderOnly();
    this.createFreshSliderContainer();
    const isPdf=this.currentBook.format==='pdf';
    const isComic=!!this.comic;
    const verticalReading=this.isVerticalReading();
    this.readingMode=verticalReading?'vertical':'horizontal';
    const pdfVertical=isPdf&&verticalReading;
    /* Sentido do gesto: só o quadrinho em modo mangá lê da direita
       para a esquerda. */
    this.rtl=isComic&&this.comicRtl&&!verticalReading;
    this.container.classList.toggle('reading-vertical',verticalReading);
    this.container.classList.toggle('reading-horizontal',!verticalReading);
    this.container.classList.toggle('pdf-vertical',pdfVertical);
    this.container.classList.toggle('comic-book',isComic);
    this.container.classList.toggle('comic-vertical',isComic&&verticalReading);
    this.container.classList.toggle('comic-rtl',this.rtl);
    this.container.classList.toggle('fit-width',isComic&&(verticalReading||this.comicFit==='width'));
    /* Palco novo, zoom novo. Sem isto, um zoom aplicado antes de girar o
       aparelho (ou de trocar o modo de leitura) continuava "valendo" num
       palco que nem existe mais: todo arraste de um dedo era tratado como
       "passear pela página ampliada" e a rolagem parava de funcionar. */
    this.comicZoom={scale:1,x:0,y:0};
    this.updateReadingModeControl();
    this.updateComicControls();

    this.pagesData.forEach((html,i)=>{
      const d=document.createElement('div');
      d.className='page';d.dataset.page=i;

      if(isPdf)d.classList.add('pdf-page');
      if(isComic)d.classList.add('comic-page');

      d.innerHTML = (isPdf||isComic)
        ? html
        : `<div class="page-content"><div class="page-text" style="font-family:${Utils.esc(this.state.settings.fontFamily)};font-size:${this.state.settings.fontSize}px;line-height:${this.state.settings.lineHeight};">${html}</div><div class="page-number">Página ${i+1} de ${this.pagesData.length}</div></div>`;

      this.container.appendChild(d);
    });

    this.sliderBook = this.container;
    if(isPdf){
      const badge=document.createElement('div');badge.className='pdf-zoom-badge';badge.id='pdf-zoom-badge';badge.textContent=`${Math.round(this.pdfZoom*100)}%`;this.container.appendChild(badge);
      this.setupPdfPinch();
      this.updatePdfControls();
    }
    if(isComic&&!verticalReading){
      /* O zoom é do modo página a página. Na rolagem contínua a página já
         ocupa a largura toda e um dedo na tela só pode significar rolar. */
      const badge=document.createElement('div');
      badge.className='pdf-zoom-badge';badge.id='comic-zoom-badge';badge.textContent='100%';
      this.container.appendChild(badge);
      this.setupComicZoom();
    }
    if(verticalReading){
      this.setupContinuousReadingScroll();
      /* A proporção aprendida antes vale para o palco recém-montado. */
      if(isComic)this.reserveComicHeights();
    }

    const slider = document.getElementById('reader-page-slider');
    const totalMax = Math.max(0, this.pagesData.length - 1);
    if(slider) slider.max = totalMax;
    document.getElementById('scrubber-total').textContent = this.pagesData.length;

    this.curl=new PageCurlEngine(this);
    this.slide=new PageSlideEngine(this);
    this.applyPageTurnMode();
    this.setupPageGestures(isPdf,verticalReading);

    this.turnToPage(startIndex,{instant:true});
  }

  /* Modo de virada que vale AGORA. A escolha do usuário continua
     valendo, mas a rolagem vertical não vira página e a folha real
     não sabe dobrar ao contrário (mangá), então nesses casos o
     aplicativo cai no comportamento mais próximo. */
  effectiveTurnMode(){
    const escolhido=App.state.settings.pageTurn||'curl';
    if(this.isVerticalReading())return 'none';
    if(escolhido==='curl'&&this.rtl)return 'slide';
    return escolhido;
  }
  turnEngine(){
    const mode=this.effectiveTurnMode();
    if(mode==='curl'){
      if(this.curl&&this.curl.available())return this.curl;
      return this.slide&&this.slide.available()?this.slide:null;
    }
    if(mode==='slide')return this.slide&&this.slide.available()?this.slide:null;
    return null;
  }
  /* Deslizar para a esquerda avança; no sentido mangá, é o contrário. */
  dirFromDx(dx){
    const avanca=dx<0?1:-1;
    return this.rtl?-avanca:avanca;
  }
  applyPageTurnMode(){
    const c=this.container;
    if(!c)return;
    const mode=this.effectiveTurnMode();
    c.classList.toggle('pt-curl',mode==='curl');
    c.classList.toggle('pt-slide',mode==='slide');
    c.classList.toggle('pt-none',mode==='none');
    if(mode!=='curl'&&this.curl&&this.curl.active)this.curl.cancel();
    if(mode!=='slide'&&this.slide&&this.slide.active)this.slide.cancel();
  }
  toggleUI(){this.ui.classList.contains('visible')?this.hideUI():this.showUI()}
  /* Um único gesto cuida de tudo: arrastar a folha, tocar nas bordas
     para virar e tocar no meio para mostrar os controles.

     O que mudou (e por quê): antes o gesto era descartado se o dedo
     demorasse mais de meio segundo entre encostar na tela e andar os
     primeiros pixels — o que transformava todo deslize calmo em
     "nada aconteceu". Agora quem decide é o movimento, não o relógio:
     assim que o dedo anda para o lado, a página vai junto. */
  setupPageGestures(isPdf,verticalReading){
    const c=this.container;
    const isComic=!!this.comic;
    let pid=null,mode='idle',sx=0,sy=0,st=0,lx=0,ly=0,lt=0,vx=0,engine=null;
    let tapTimer=null,lastTapAt=0,lastTapX=0,lastTapY=0;
    const blocked=t=>!!(t&&t.closest&&(t.closest('.reader-ui')||t.closest('#annotation-pop')||t.closest('.selection-toolbar')||t.closest('#selection-toolbar')));
    const hasSelection=()=>{const s=window.getSelection();return !!(s&&!s.isCollapsed&&String(s).trim())};
    const zoomed=()=>isComic?this.comicZoom.scale>1.02:(isPdf&&this.pdfZoom>1.02);
    const reset=()=>{pid=null;mode='idle';vx=0;engine=null};
    const cancelTap=()=>{if(tapTimer){clearTimeout(tapTimer);tapTimer=null}};

    c.addEventListener('pointerdown',e=>{
      if(mode!=='idle')return;
      if(e.pointerType==='mouse'&&e.button!==0)return;
      if(blocked(e.target))return;
      if(this.curl&&this.curl.animating)return;
      if(this.slide&&this.slide.animating)return;
      pid=e.pointerId;sx=lx=e.clientX;sy=ly=e.clientY;st=lt=performance.now();vx=0;mode='pending';
    },{passive:true});

    c.addEventListener('pointermove',e=>{
      if(pid===null||e.pointerId!==pid)return;
      const agora=performance.now(),dt=Math.max(1,agora-lt);
      vx=0.7*((e.clientX-lx)/dt)+0.3*vx;
      lx=e.clientX;ly=e.clientY;lt=agora;
      const dx=e.clientX-sx,dy=e.clientY-sy;
      if(mode==='drag'){engine.dragBy(dx,dy);return}
      if(mode!=='pending'||verticalReading)return;
      /* Dois dedos na tela é pinça, não virada de página. */
      if(e.isPrimary===false){mode='blocked';return}
      if(zoomed()){mode='blocked';return}
      /* Movimento claramente vertical: é rolagem dentro da página. */
      if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)*1.3){mode='blocked';return}
      /* Limiar curto: a folha começa a andar quase junto com o dedo. */
      if(Math.abs(dx)<10)return;
      if(hasSelection()){mode='blocked';return}
      this.cancelAnnotationPress();
      const dir=this.dirFromDx(dx);
      const alvo=this.currentPageIndex+dir;
      if(alvo<0||alvo>=this.pagesData.length){mode='edge';return}
      const motor=this.turnEngine();
      if(motor&&motor.start(dir,sy)){
        engine=motor;mode='drag';
        try{c.setPointerCapture(e.pointerId)}catch(err){}
        engine.dragBy(dx,dy);
      }else{
        /* "Sem animação": mesmo sem motor, o gesto passa a ser nosso —
           capturar o ponteiro impede que o arraste vire seleção de texto
           e engula a virada no fim do movimento. */
        mode='swipe';
        try{c.setPointerCapture(e.pointerId)}catch(err){}
      }
    },{passive:true});

    /* Enquanto a folha está na mão, nada mais rola ou dá zoom. */
    c.addEventListener('touchmove',e=>{if(mode==='drag')e.preventDefault()},{passive:false});

    const zonaDeToque=(x,largura)=>{
      if(x<largura*0.28)return this.rtl?1:-1;
      if(x>largura*0.72)return this.rtl?-1:1;
      return 0;
    };
    const finish=e=>{
      if(pid===null||(e&&e.pointerId!==undefined&&e.pointerId!==pid))return;
      const dx=lx-sx,dy=ly-sy,decorrido=performance.now()-st;
      const arrastou=mode==='drag',deslizou=mode==='swipe',parado=mode==='pending';
      const motor=engine;
      reset();
      const rect=c.getBoundingClientRect();
      const largura=rect.width||window.innerWidth;
      if(arrastou){motor.release(vx);return}
      if(deslizou){
        /* "Sem animação": o deslize continua valendo, só não há
           acompanhamento visual durante o gesto. Qualquer seleção que o
           arraste tenha criado pelo caminho é desfeita aqui. */
        try{const s=window.getSelection();if(s&&!s.isCollapsed)s.removeAllRanges()}catch(err){}
        if(Math.abs(dx)>Math.max(40,largura*0.12)||Math.abs(vx)>0.45)this.flip(this.dirFromDx(dx));
        return;
      }
      if(hasSelection())return;
      if(verticalReading){
        if(Math.hypot(dx,dy)<12&&decorrido<700)this.toggleUI();
        return;
      }
      if(!parado)return;
      if(Math.hypot(dx,dy)>=14||decorrido>=700)return;
      if(e&&e.target&&e.target.closest&&e.target.closest('[data-annotation-id]'))return;
      const x=(e?e.clientX:lx)-rect.left;
      const y=(e?e.clientY:ly)-rect.top;

      /* Quadrinho: dois toques seguidos ampliam (ou voltam ao tamanho
         normal). Por isso o toque simples espera um instante antes de
         agir — é o tempo de saber se vem um segundo toque. */
      if(isComic){
        const agora=performance.now();
        if(agora-lastTapAt<300&&Math.hypot(x-lastTapX,y-lastTapY)<40){
          cancelTap();lastTapAt=0;
          this.comicToggleZoom(e?e.clientX:lx,e?e.clientY:ly);
          return;
        }
        lastTapAt=agora;lastTapX=x;lastTapY=y;
        cancelTap();
        tapTimer=setTimeout(()=>{
          tapTimer=null;
          if(this.comicZoom.scale>1.02){this.toggleUI();return}
          const dir=zonaDeToque(x,largura);
          if(dir)this.flip(dir);else this.toggleUI();
        },250);
        return;
      }
      if(zoomed()){this.toggleUI();return}
      const dir=zonaDeToque(x,largura);
      if(dir)this.flip(dir);else this.toggleUI();
    };
    c.addEventListener('pointerup',finish,{passive:true});
    c.addEventListener('pointercancel',e=>{
      if(pid===null||e.pointerId!==pid)return;
      const arrastou=mode==='drag';
      const motor=engine;
      reset();
      if(arrastou)motor.release(vx);
    },{passive:true});

    c.addEventListener('click',e=>{
      if(e.target.closest('.reader-ui'))return;
      const annotationTarget=e.target.closest('[data-annotation-id]');
      if(annotationTarget){
        e.stopPropagation();
        this.openAnnotationPopover(annotationTarget.dataset.annotationId,annotationTarget.getBoundingClientRect());
      }
    });
  }
  
  turnToPage(index,options={}){
    if(this.curl&&this.curl.active&&!options.fromCurl)this.curl.cancel();
    if(this.slide&&this.slide.active&&!options.fromCurl)this.slide.cancel();
    if(this.comic&&index!==this.currentPageIndex)this.resetComicZoom();
    if(this.sliderBook && index >= 0 && index < this.pagesData.length) {
       if(this.isVerticalReading()){
         this.currentPageIndex=index;
         this.container.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active',i===index));
         const page=this.container.querySelector(`.page[data-page="${index}"]`);
         if(page&&!options.fromScroll)page.scrollIntoView({block:'start',behavior:options.instant?'auto':'smooth'});
         this.updateProgressText(index);this.persistProgressDebounced(index);this.applyAnnotationsToRenderedPage(index);
         if(this.currentBook.format==='pdf'||this.comic){
           this.renderLazyPage(index);this.renderLazyPage(index+1);this.renderLazyPage(index-1);
         }
         return;
       }

       this.currentPageIndex = index;
       const pages = this.container.querySelectorAll('.page');
       pages.forEach((p, i) => {
            p.classList.remove('active', 'prev', 'next');
            if(i === index) p.classList.add('active');
            else if(i < index) p.classList.add('prev');
            else p.classList.add('next');
       });
       this.container.dataset.started='1';
       this.hideAnnotationPopover();
       /* Sem a transição de slide, um corte seco incomoda: um respiro
          curto de opacidade deixa o salto de página legível. */
       if(!options.fromCurl&&!options.instant&&this.container.classList.contains('pt-curl')){
         const target=pages[index];
         if(target){
           target.classList.remove('page-cut');
           void target.offsetWidth;
           target.classList.add('page-cut');
           setTimeout(()=>target.classList.remove('page-cut'),300);
         }
       }
       
       this.updateProgressText(index);
       this.persistProgressDebounced(index);
       this.applyAnnotationsToRenderedPage(index);
       this.renderLazyPage(index);
       /* Quadrinho: a página seguinte (e a anterior) já ficam prontas,
          para a virada nunca mostrar um vazio. */
       if(this.comic){this.renderLazyPage(index+1);this.renderLazyPage(index-1)}
    }
  }

  /* Porta única para "prepare a página que vai aparecer": o PDF
     desenha, o quadrinho carrega a imagem. */
  renderLazyPage(pageIndex){
    if(this.comic)return this.renderComicPageIfNeeded(pageIndex);
    return this.renderPdfPageIfNeeded(pageIndex);
  }
  async renderPdfPageIfNeeded(pageIndex){
    if(this.comic)return this.renderComicPageIfNeeded(pageIndex);
    if(!this.pdfDoc)return;
    const wrap=document.querySelector(`.page[data-page="${pageIndex}"] .pdf-page-wrap`);
    if(!wrap||wrap.dataset.rendered==='1')return;
    wrap.dataset.rendered='1';
    const pageNo=parseInt(wrap.dataset.pdfPage,10);
    try{
      const rect = wrap.getBoundingClientRect();
      const w = rect.width > 0 ? rect.width : window.innerWidth;
      const h = rect.height > 0 ? rect.height : window.innerHeight;
      await PDFParser.renderPageToContainer(this.pdfDoc, pageNo, wrap, w, h, this.pdfZoom);
      this.applyAnnotationsToRenderedPage(pageIndex);
    }catch(e){
      console.error(e);
      wrap.innerHTML=`<div style="padding:20px;text-align:center;color:var(--muted);font-size:12px">Não foi possível carregar esta página.</div>`;
    }
  }
  /* Padrão de fábrica de cada formato: horizontal para EPUB, MOBI, quadrinhos, TXT e
     MD (texto que reflui); vertical para PDF e DOCX (página fixa). */
  defaultReadingMode(format){
    return BookFormats.defaultScroll(format)==='vertical'?'vertical':'horizontal';
  }
  /* A escolha é DO LIVRO. Só quando o livro não tem escolha própria é que
     entram o padrão geral das configurações e, por fim, o do formato —
     por isso mudar a rolagem de um livro não mexe nos outros. */
  resolveReadingMode(format=this.currentBook?.format,book=this.currentBook){
    const own=book&&book.readingMode;
    if(own==='vertical'||own==='horizontal')return own;
    const pref=this.state.settings.readingMode||'auto';
    if(pref==='vertical'||pref==='horizontal')return pref;
    return this.defaultReadingMode(format);
  }
  isVerticalReading(){return this.readingMode==='vertical'}
  /* Grava o sentido de rolagem NESTE livro. `null` devolve o livro ao
     comportamento automático do formato. */
  async setReadingMode(mode){
    if(!this.currentBook)return false;
    const value=(mode==='vertical'||mode==='horizontal')?mode:null;
    if(value)this.currentBook.readingMode=value;
    else delete this.currentBook.readingMode;
    try{
      await this.db.patchBook(this.currentBook.id,b=>{
        if(value)b.readingMode=value;else delete b.readingMode;
      });
    }catch(e){console.warn('Não foi possível salvar o sentido de rolagem.',e)}
    const list=App.library&&App.library.allBooks;
    if(list){
      const i=list.findIndex(b=>b.id===this.currentBook.id);
      if(i>=0){if(value)list[i].readingMode=value;else delete list[i].readingMode}
    }
    await this.reloadReadingMode();
    return true;
  }
  isPdfVertical(){return this.currentBook?.format==='pdf'&&this.isVerticalReading()}
  updateReadingModeControl(){
    const btn=document.getElementById('btn-reader-layout');
    if(!btn)return;
    const vertical=this.isVerticalReading();
    btn.innerHTML=`<i data-lucide="${vertical?'arrow-up-down':'arrow-left-right'}"></i>`;
    btn.title=this.comic
      ? (vertical?'Voltar para página a página':'Rolagem contínua (estilo webtoon)')
      : (vertical?'Mudar para leitura horizontal':'Mudar para rolagem vertical');
    btn.setAttribute('aria-label',btn.title);
    btn.classList.toggle('active',vertical);
    lucide.createIcons({root:btn});
  }
  updatePdfControls(){this.updateReadingModeControl()}
  async reloadReadingMode(){
    if(!this.currentBook||!this.sliderBook)return;
    let index=this.currentPageIndex;
    const pagina=this.comic?this.currentComicPage():null;
    this.readingMode=this.resolveReadingMode(this.currentBook.format);
    this.pdfMode=this.readingMode;
    if(this.comic){
      /* Trocar entre página a página e rolagem contínua muda o
         agrupamento das páginas: as vistas são refeitas antes. */
      this.buildComicViews();
      index=this.viewOfComicPage(pagina);
      const slider=document.getElementById('reader-page-slider');
      if(slider)slider.max=Math.max(0,this.pagesData.length-1);
      const total=document.getElementById('scrubber-total');
      if(total)total.textContent=this.pagesData.length;
    }
    await this.initSliderBook(index);
  }
  async toggleReadingMode(){
    if(!this.currentBook||!this.sliderBook)return;
    const next=this.isVerticalReading()?'horizontal':'vertical';
    await this.setReadingMode(next);
    App.syncReadingModeUi();
    if(this.comic){
      Utils.toast(next==='vertical'
        ?'Rolagem contínua ativada neste quadrinho.'
        :'Leitura página a página ativada neste quadrinho.','book-image');
      return;
    }
    Utils.toast(next==='vertical'
      ?'Rolagem vertical ativada neste livro.'
      :'Leitura horizontal ativada neste livro.','file-text');
  }
  async togglePdfReadingMode(){return this.toggleReadingMode()}
  setupContinuousReadingScroll(){
    let raf=null;
    this.container.addEventListener('scroll',()=>{
      if(raf)return;
      raf=requestAnimationFrame(()=>{
        raf=null;
        const middle=this.container.getBoundingClientRect().top+this.container.clientHeight*.42;
        let nearest=null,distance=Infinity;
        this.container.querySelectorAll('.page').forEach(page=>{
          const rect=page.getBoundingClientRect(),d=Math.abs(rect.top-middle);
          if(d<distance){distance=d;nearest=Number(page.dataset.page)}
          if((this.currentBook?.format==='pdf'||this.comic)&&rect.bottom>-600&&rect.top<window.innerHeight+600){
            this.renderLazyPage(Number(page.dataset.page));
          }
        });
        if(nearest!==null&&nearest!==this.currentPageIndex)this.turnToPage(nearest,{fromScroll:true,instant:true});
      });
    },{passive:true});
  }
  /* ============================================================
     QUADRINHO — ZOOM E ARRASTE
     ------------------------------------------------------------
     Numa HQ, ampliar um balão é tão importante quanto virar a
     página. A imagem inteira (a vista) é transformada de uma vez
     com `transform`, que roda na GPU: dá para pinçar, arrastar e
     dar dois toques sem o menor engasgo, mesmo em páginas grandes.
     Enquanto há zoom, o deslize lateral serve para passear pela
     página — a virada volta assim que o zoom é desfeito.
     ============================================================ */
  comicViewEl(index=this.currentPageIndex){
    if(!this.container)return null;
    return this.container.querySelector(`.comic-page-wrap[data-comic-view="${index}"]`);
  }
  applyComicZoom(anima=false){
    const el=this.comicViewEl();
    if(!el)return;
    const z=this.comicZoom;
    el.style.transition=anima?'transform .22s cubic-bezier(.2,.8,.2,1)':'none';
    el.style.transform=z.scale>1.001
      ? `translate3d(${z.x}px,${z.y}px,0) scale(${z.scale})`
      : '';
    if(this.container)this.container.classList.toggle('comic-zoomed',z.scale>1.02);
    const badge=document.getElementById('comic-zoom-badge');
    if(badge){
      badge.textContent=`${Math.round(z.scale*100)}%`;
      badge.classList.toggle('show',z.scale>1.02);
    }
  }
  /* Impede que a imagem seja arrastada para fora da tela. */
  clampComicPan(){
    const el=this.comicViewEl();
    if(!el)return;
    const z=this.comicZoom;
    if(z.scale<=1.001){z.x=0;z.y=0;return}
    const rect=this.container.getBoundingClientRect();
    const folgaX=Math.max(0,(rect.width*z.scale-rect.width)/2);
    const folgaY=Math.max(0,(rect.height*z.scale-rect.height)/2);
    z.x=Utils.clamp(z.x,-folgaX,folgaX);
    z.y=Utils.clamp(z.y,-folgaY,folgaY);
  }
  resetComicZoom(){
    const el=this.comicViewEl();
    if(el){el.style.transition='none';el.style.transform=''}
    this.comicZoom={scale:1,x:0,y:0};
    if(this.container)this.container.classList.remove('comic-zoomed');
    const badge=document.getElementById('comic-zoom-badge');
    if(badge)badge.classList.remove('show');
  }
  /* Dois toques: amplia no ponto tocado ou volta ao tamanho da tela. */
  comicToggleZoom(clientX,clientY){
    if(!this.comic||!this.container)return;
    if(this.comicZoom.scale>1.02){
      this.comicZoom={scale:1,x:0,y:0};
      this.applyComicZoom(true);
      setTimeout(()=>this.applyComicZoom(false),240);
      return;
    }
    const rect=this.container.getBoundingClientRect();
    const escala=2.4;
    const px=(clientX-rect.left)-rect.width/2;
    const py=(clientY-rect.top)-rect.height/2;
    this.comicZoom={scale:escala,x:-px*(escala-1),y:-py*(escala-1)};
    this.clampComicPan();
    this.applyComicZoom(true);
    setTimeout(()=>this.applyComicZoom(false),240);
    if(navigator.vibrate)navigator.vibrate(8);
  }
  setupComicZoom(){
    const c=this.container;
    if(!c)return;
    let pincando=false,d0=0,s0=1,cx0=0,cy0=0,x0=0,y0=0;
    let arrastando=false,ax=0,ay=0,px=0,py=0;
    const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);

    c.addEventListener('touchstart',e=>{
      if(e.touches.length===2){
        pincando=true;arrastando=false;
        d0=dist(e.touches)||1;
        s0=this.comicZoom.scale;
        const rect=c.getBoundingClientRect();
        cx0=((e.touches[0].clientX+e.touches[1].clientX)/2)-rect.left-rect.width/2;
        cy0=((e.touches[0].clientY+e.touches[1].clientY)/2)-rect.top-rect.height/2;
        x0=this.comicZoom.x;y0=this.comicZoom.y;
        return;
      }
      if(e.touches.length===1&&this.comicZoom.scale>1.02){
        arrastando=true;
        ax=e.touches[0].clientX;ay=e.touches[0].clientY;
        px=this.comicZoom.x;py=this.comicZoom.y;
      }
    },{passive:true});

    c.addEventListener('touchmove',e=>{
      if(pincando&&e.touches.length===2){
        e.preventDefault();
        const escala=Utils.clamp(s0*(dist(e.touches)/d0),1,5);
        const k=escala/s0;
        /* O ponto entre os dedos fica parado enquanto a imagem cresce. */
        this.comicZoom.scale=escala;
        this.comicZoom.x=cx0+(x0-cx0)*k;
        this.comicZoom.y=cy0+(y0-cy0)*k;
        this.clampComicPan();
        this.applyComicZoom(false);
        return;
      }
      if(arrastando&&e.touches.length===1){
        /* Confere o zoom AGORA, não o que valia quando o dedo encostou:
           um estado velho não pode sequestrar a rolagem da página. */
        if(this.comicZoom.scale<=1.02){arrastando=false;return}
        e.preventDefault();
        this.comicZoom.x=px+(e.touches[0].clientX-ax);
        this.comicZoom.y=py+(e.touches[0].clientY-ay);
        this.clampComicPan();
        this.applyComicZoom(false);
      }
    },{passive:false});

    const soltar=()=>{
      if(pincando){
        pincando=false;
        if(this.comicZoom.scale<=1.05){
          this.comicZoom={scale:1,x:0,y:0};
          this.applyComicZoom(true);
          setTimeout(()=>this.applyComicZoom(false),240);
        }else{
          this.clampComicPan();
          this.applyComicZoom(false);
        }
      }
      arrastando=false;
    };
    c.addEventListener('touchend',soltar,{passive:true});
    c.addEventListener('touchcancel',soltar,{passive:true});

    /* No computador: roda do mouse com Ctrl amplia. */
    c.addEventListener('wheel',e=>{
      if(!e.ctrlKey)return;
      e.preventDefault();
      const rect=c.getBoundingClientRect();
      const anterior=this.comicZoom.scale;
      const escala=Utils.clamp(anterior*(e.deltaY<0?1.12:1/1.12),1,5);
      const k=escala/anterior;
      const cx=(e.clientX-rect.left)-rect.width/2;
      const cy=(e.clientY-rect.top)-rect.height/2;
      this.comicZoom.scale=escala;
      this.comicZoom.x=cx+(this.comicZoom.x-cx)*k;
      this.comicZoom.y=cy+(this.comicZoom.y-cy)*k;
      if(escala<=1.02)this.comicZoom={scale:1,x:0,y:0};
      this.clampComicPan();
      this.applyComicZoom(false);
    },{passive:false});
  }
  /* Botões do topo e seção "Quadrinhos" das configurações. */
  updateComicControls(){
    const comic=!!this.comic;
    const tts=document.getElementById('btn-reader-tts');
    if(tts)tts.hidden=comic;
    const secao=document.getElementById('comic-settings');
    if(secao)secao.hidden=!comic;
    if(!comic)return;
    const marcar=(seletor,atributo,valor)=>{
      document.querySelectorAll(seletor).forEach(b=>
        b.classList.toggle('active',b.dataset[atributo]===String(valor)));
    };
    marcar('#comic-fit-grid button','comicFit',this.comicFit);
    marcar('#comic-direction-grid button','comicDir',this.comicRtl?'rtl':'ltr');
    const spread=document.getElementById('comic-spread-toggle');
    if(spread)spread.checked=!!this.comicSpread;
    const dica=document.getElementById('comic-settings-tip');
    if(dica){
      dica.textContent=this.comicSpreadActive()
        ? 'Agora em revista aberta: duas páginas lado a lado, com a capa sozinha.'
        : 'Gire o aparelho para a horizontal para ver duas páginas lado a lado.';
    }
  }
  setupPdfContinuousScroll(){return this.setupContinuousReadingScroll()}
  setupPdfPinch(){
    let startDistance=0,startZoom=this.pdfZoom,preview=this.pdfZoom,pinching=false;
    const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
    const badge=()=>document.getElementById('pdf-zoom-badge');
    this.container.addEventListener('touchstart',e=>{
      if(e.touches.length!==2)return;
      pinching=true;startDistance=distance(e.touches);startZoom=this.pdfZoom;preview=this.pdfZoom;
      badge()?.classList.add('show');
    },{passive:true});
    this.container.addEventListener('touchmove',e=>{
      if(!pinching||e.touches.length!==2)return;
      e.preventDefault();
      preview=Utils.clamp(startZoom*(distance(e.touches)/startDistance),.75,3);
      const el=badge();if(el)el.textContent=`${Math.round(preview*100)}%`;
      
      const inner = this.container.querySelector(`.page[data-page="${this.currentPageIndex}"] .pdf-page-inner`);
      if(inner) {
          const ratio = preview / this.pdfZoom;
          inner.style.transform = `scale(${ratio})`;
      }
    },{passive:false});
    this.container.addEventListener('touchend',e=>{
      if(!pinching||e.touches.length>1)return;
      pinching=false;badge()?.classList.remove('show');
      if(Math.abs(preview-this.pdfZoom)>.02){
          this.setPdfZoom(preview);
      } else {
          const inner = this.container.querySelector(`.page[data-page="${this.currentPageIndex}"] .pdf-page-inner`);
          if(inner) inner.style.transform = 'none';
      }
    },{passive:true});
  }
  async setPdfZoom(zoom){
    this.pdfZoom=Utils.clamp(zoom,.75,3);
    await App.updateSetting('pdfZoom',this.pdfZoom);
    if(!this.container)return;
    /* Com zoom, a página precisa poder ser arrastada para os lados;
       sem zoom, o movimento lateral pertence à virada de página. */
    this.container.classList.toggle('pdf-zoomed',this.pdfZoom>1.02);
    this.container.querySelectorAll('.pdf-page-wrap').forEach(wrap=>{
      wrap.dataset.rendered='';
      wrap.innerHTML=`<div class="pdf-loading"><div class="spinner"></div><span>Aplicando zoom...</span></div>`;
    });
    this.renderPdfPageIfNeeded(this.currentPageIndex);
    if(this.isPdfVertical())this.renderPdfPageIfNeeded(this.currentPageIndex+1);
  }
  async getPageSpeechText(index){
    if(this.currentBook?.format==='pdf'&&this.pdfDoc){
      const page=await this.pdfDoc.getPage(index+1);const content=await page.getTextContent();
      return content.items.map(item=>item.str).join(' ');
    }
    const temp=document.createElement('div');temp.innerHTML=this.pagesData[index]||'';
    return temp.textContent||'';
  }
  updateProgressText(i){
    const slider = document.getElementById('reader-page-slider');
    if(slider) slider.value = i;
    document.getElementById('scrubber-current').textContent = i + 1;
  }
  async flip(dir){
    if(!this.sliderBook||this.navigating)return;
    const index = this.currentPageIndex + dir;
    if(index >= this.pagesData.length){
      Utils.toast(this.comic?'Você chegou ao fim do quadrinho.':'Você chegou ao fim do livro.','check-circle');return;
    }
    if(index < 0){Utils.toast(this.comic?'Esta é a primeira página.':'Este é o início do livro.','info');return;}
    const motor=this.turnEngine();
    if(motor&&motor.animate(dir))return;
    this.turnToPage(index);
  }
  async persistProgress(i){
    if(!this.currentBook)return;
    const readPage=i+1,total=this.pagesData.length,pct=Math.round((readPage/Math.max(1,total))*100);
    this.currentBook.progress={globalPage:i,readPages:readPage,totalPages:total,percentage:pct};
    if(this.comic){
      /* O quadrinho guarda também a PÁGINA (e não só a vista): assim,
         girar o aparelho e passar para revista aberta não perde o ponto. */
      this.currentBook.progress.comicPage=(this.comicViews[i]||[i])[0];
      this.currentBook.progress.totalComicPages=this.comic.length;
    }
    this.currentBook.totalPages=total;
    this.currentBook.lastRead=Date.now();
    if(i>=total-1)this.currentBook.status='read';
    else if(this.currentBook.status==='toread'||!this.currentBook.status)this.currentBook.status='reading';
    await this.db.updateBook(this.currentBook);
  }
  toggleBookmark(){
    if(!this.currentBook||!this.sliderBook)return;
    const i=this.currentPageIndex;
    const meta=this.pageMeta[i]||{chapter:0,localPage:0,title:this.currentBook.title};
    this.db.addBookmark(this.currentBook.id,{
      globalPage:i,chapter:meta.chapter,pageIndex:meta.localPage,
      title:meta.title,preview:this.previewText(i)
    }).then(added=>{
      Utils.toast(added?'Página adicionada aos marcadores.':'Marcador removido desta página.',added?'bookmark':'bookmark-x');
      this.showAnnotations();
    });
  }
  previewText(i){
    const d=document.createElement('div');
    d.innerHTML=this.pagesData[i]||'';
    return(d.textContent||'').replace(/\s+/g,' ').trim().slice(0,180);
  }
  captureSelection(){
    if(!document.getElementById('view-reader').classList.contains('active'))return;
    const sel=window.getSelection();
    if(!sel||sel.rangeCount===0||sel.isCollapsed)return;
    const text=(sel.toString()||'').replace(/\s+/g,' ').trim();
    if(text.length<3){this.hideSelectionPop();return}
    const node=sel.anchorNode?.parentElement?.closest?.('.page-text') || sel.anchorNode?.parentElement?.closest?.('.pdf-text-layer');
    if(!node)return;
    const pageEl=node.closest('.page');
    if(!pageEl)return;
    const pageIndex=Number(pageEl.dataset.page||0);
    const range=sel.getRangeAt(0).cloneRange();
    const pre=document.createRange();
    pre.selectNodeContents(node);
    pre.setEnd(range.startContainer,range.startOffset);
    const start=pre.toString().length;
    const end=start+range.toString().length;
    this.pendingSelection={text,start,end,pageIndex,rect:range.getBoundingClientRect()};
    const pop=document.getElementById('selection-pop');
    pop.style.left=`${Math.max(110,Math.min(window.innerWidth-110,(this.pendingSelection.rect.left+this.pendingSelection.rect.right)/2))}px`;
    const below=this.pendingSelection.rect.top<118;
    pop.classList.toggle('below',below);
    pop.style.top=`${below?Math.min(window.innerHeight-60,this.pendingSelection.rect.bottom+10):Math.max(70,this.pendingSelection.rect.top)}px`;
    pop.classList.add('show');
  }
  hideSelectionPop(){document.getElementById('selection-pop').classList.remove('show')}
  startAnnotationPress(event){
    const target=event.target.closest?.('[data-annotation-id]');
    if(!target||!target.classList.contains('annotation-highlight'))return;
    this.cancelAnnotationPress();
    this.annotationPressTimer=window.setTimeout(()=>{
      if(navigator.vibrate)navigator.vibrate(18);
      this.openAnnotationPopover(target.dataset.annotationId,target.getBoundingClientRect());
    },560);
  }
  cancelAnnotationPress(){
    if(this.annotationPressTimer){window.clearTimeout(this.annotationPressTimer);this.annotationPressTimer=null;}
  }
  hideAnnotationPopover(){
    const pop=document.getElementById('annotation-pop');
    if(pop)pop.classList.remove('show');
    this.activeAnnotationId=null;
  }
  openAnnotationPopover(annotationId,rect){
    const annotation=this.currentBook?.annotations?.find(a=>a.id===annotationId);
    if(!annotation)return;
    this.hideSelectionPop();
    this.activeAnnotationId=annotationId;
    const pop=document.getElementById('annotation-pop');
    pop.innerHTML='';
    const label=document.createElement('div');label.className='annotation-pop-label';
    label.textContent=annotation.type==='note'?'Comentário':'Grifo';
    const quote=document.createElement('div');quote.className='annotation-pop-quote';
    quote.textContent=`“${annotation.text||''}”`;
    pop.append(label,quote);
    if(annotation.type==='note'){
      const note=document.createElement('div');note.className='annotation-pop-note';note.textContent=annotation.note||'Sem comentário';pop.appendChild(note);
    }
    const actions=document.createElement('div');actions.className='annotation-pop-actions';
    if(annotation.type==='note'){
      const edit=document.createElement('button');edit.type='button';edit.textContent='Editar';
      edit.onclick=()=>this.editAnnotationFromPopover(annotation);actions.appendChild(edit);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='danger';
    remove.textContent=annotation.type==='note'?'Apagar':'Remover grifo';
    remove.onclick=()=>this.deleteAnnotationFromPopover(annotation);actions.appendChild(remove);
    pop.appendChild(actions);
    const width=Math.min(330,window.innerWidth-28);
    const desiredLeft=Math.max(14,Math.min(window.innerWidth-width-14,rect.left+rect.width/2-width/2));
    const desiredTop=Math.max(70,Math.min(window.innerHeight-pop.offsetHeight-14,rect.bottom+10));
    pop.style.left=`${desiredLeft}px`;pop.style.top=`${desiredTop}px`;pop.classList.add('show');
  }
  editAnnotationFromPopover(annotation){
    this.hideAnnotationPopover();
    document.getElementById('selected-preview').innerHTML=`<div class="item-type">Trecho comentado</div><div class="item-text">“${Utils.esc(annotation.text)}”</div><div class="item-meta">Página ${annotation.pageIndex+1} de ${this.pagesData.length}</div>`;
    document.getElementById('note-text').value=annotation.note||'';
    const save=document.getElementById('btn-save-note');
    save.dataset.editId=annotation.id;save.dataset.bookId=this.currentBook.id;
    App.openPanel('panel-note');
  }
  async deleteAnnotationFromPopover(annotation){
    const message=annotation.type==='note'?'Apagar este comentário?':'Remover este grifo?';
    const ok=await AppModal.confirm({
      title:annotation.type==='note'?'Apagar comentário?':'Remover grifo?',
      subtitle:this.currentBook?.title||'Livro',
      message,
      confirmText:annotation.type==='note'?'Apagar comentário':'Remover grifo',
      confirmIcon:'trash',danger:true
    });
    if(!ok)return;
    await this.db.deleteAnnotation(this.currentBook.id,annotation.id);
    this.currentBook=await this.db.getBook(this.currentBook.id);
    this.hideAnnotationPopover();
    this.applyAnnotationsToRenderedPage(annotation.pageIndex);
    Utils.toast(annotation.type==='note'?'Comentário apagado.':'Grifo removido.','trash');
  }
  async saveSelection(type){
    if(!this.pendingSelection||!this.currentBook)return;
    const s=this.pendingSelection;
    this.hideSelectionPop();
    window.getSelection()?.removeAllRanges();
    await this.db.addAnnotation(this.currentBook.id,{
      type:Utils.normalizeType(type),bookId:this.currentBook.id,pageIndex:s.pageIndex,
      chapter:this.pageMeta[s.pageIndex]?.chapter||0,
      text:s.text,start:s.start,end:s.end,note:'',
      color:this.selectedHighlightColor||'#f3d76a'
    });
    this.currentBook=await this.db.getBook(this.currentBook.id);
    this.applyAnnotationsToRenderedPage(s.pageIndex);
    Utils.toast(type==='highlight'?'Trecho grifado.':'Citação salva.',type==='highlight'?'highlighter':'quote');
  }
  async shareSelection(){
    if(!this.pendingSelection)return;
    const text=this.pendingSelection.text;
    try{
      if(navigator.share){await navigator.share({title:this.currentBook?.title||'Trecho',text});Utils.toast('Trecho compartilhado.','share-2')}
      else if(navigator.clipboard){await navigator.clipboard.writeText(text);Utils.toast('Trecho copiado.','copy')}
      else Utils.toast('Compartilhamento indisponível.','info');
    }catch(e){if(e?.name!=='AbortError')Utils.toast('Não foi possível compartilhar.','alert-triangle')}
  }
  openNoteForSelection(){
    if(!this.pendingSelection)return;
    const s=this.pendingSelection;
    this.hideSelectionPop();
    window.getSelection()?.removeAllRanges();
    document.getElementById('selected-preview').innerHTML=
      `<div class="item-type">Trecho selecionado</div><div class="item-text">“${Utils.esc(s.text)}”</div><div class="item-meta">Página ${s.pageIndex+1} de ${this.pagesData.length}</div>`;
    document.getElementById('note-text').value='';
    document.getElementById('btn-save-note').dataset.editId = '';
    document.getElementById('btn-save-note').dataset.bookId = '';
    App.openPanel('panel-note');
  }
  async saveNote(){
    const btn = document.getElementById('btn-save-note');
    const note = document.getElementById('note-text').value.trim();
    if(!note){Utils.toast('Escreva uma nota antes de salvar.','edit-3');return}
    
    const editId = btn.dataset.editId;
    const bId = btn.dataset.bookId || this.currentBook?.id;

    if (editId && bId) {
        await App.db.updateNote(bId, editId, note);
        Utils.toast('Anotação atualizada.', 'check');
        btn.dataset.editId = '';
        btn.dataset.bookId = '';
        App.closePanels();
        
        if (this.currentBook && this.currentBook.id === bId) {
            this.currentBook = await App.db.getBook(bId);
            this.applyAnnotationsToRenderedPage(this.currentPageIndex);
            this.showAnnotations();
        } else {
            App.library.render();
        }
        return;
    }

    if(!this.pendingSelection||!this.currentBook)return;
    const s=this.pendingSelection;
    await this.db.addAnnotation(this.currentBook.id,{
      type:'note',bookId:this.currentBook.id,pageIndex:s.pageIndex,
      chapter:this.pageMeta[s.pageIndex]?.chapter||0,
      text:s.text,start:s.start,end:s.end,note
    });
    this.currentBook=await this.db.getBook(this.currentBook.id);
    App.closePanels();
    this.applyAnnotationsToRenderedPage(s.pageIndex);
    Utils.toast('Anotação salva.','sticky-note');
  }
  applyAnnotationsToRenderedPage(pageIndex){
    const page=document.querySelector(`.page[data-page="${pageIndex}"] .page-text`) || document.querySelector(`.page[data-page="${pageIndex}"] .pdf-text-layer`);
    if(!page||!this.currentBook)return;
    if(page.classList.contains('pdf-text-layer')){
      this.applyPdfAnnotations(page,pageIndex);
      return;
    }
    page.querySelectorAll('[data-annotation-mark]').forEach(e=>e.replaceWith(...e.childNodes));
    const anns=this.currentBook.annotations.filter(a=>a.pageIndex===pageIndex);
    anns.sort((a,b)=>(b.start||0)-(a.start||0)).forEach(a=>this.wrapTextRange(page,a));
  }
  rangeForOffsets(root,start,end){
    if(end<=start)return;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let pos=0,sp=null,so=0,ep=null,eo=0,node;
    while(node=walker.nextNode()){
      const next=pos+node.nodeValue.length;
      if(sp===null&&start>=pos&&start<=next){sp=node;so=start-pos}
      if(end>=pos&&end<=next){ep=node;eo=end-pos;break}
      pos=next;
    }
    if(!sp||!ep)return null;
    const range=document.createRange();
    range.setStart(sp,so);range.setEnd(ep,eo);
    return range;
  }
  wrapTextRange(root,annotation){
    const range=this.rangeForOffsets(root,annotation.start||0,annotation.end||0);
    if(!range)return;
    const type=annotation.type==='highlight'?'HIGHLIGHT':annotation.type==='quote'?'QUOTE':'NOTE';
    const mark=document.createElement(type==='HIGHLIGHT'?'mark':'span');
    mark.dataset.annotationMark='1';
    mark.dataset.annotationId=annotation.id;
    mark.className=type==='QUOTE'?'annotation-quote':type==='NOTE'?'annotation-note':'';
    if(type==='HIGHLIGHT'){
      mark.classList.add('annotation-highlight');
      mark.style.background=annotation.color||'#f3d76a';
      mark.style.color='inherit';
    }
    try{range.surroundContents(mark)}catch(e){}
  }
  applyPdfAnnotations(textLayer,pageIndex){
    const layer=textLayer.parentElement.querySelector('.pdf-annotation-layer');
    if(!layer)return;
    layer.innerHTML='';
    const rootRect=textLayer.getBoundingClientRect();
    const annotations=this.currentBook.annotations.filter(a=>a.pageIndex===pageIndex);
    annotations.forEach(annotation=>{
      const range=this.rangeForOffsets(textLayer,annotation.start||0,annotation.end||0);
      if(!range)return;
      const rects=Array.from(range.getClientRects()).filter(r=>r.width&&r.height);
      rects.forEach((rect,index)=>{
        if(annotation.type==='note'&&index>0)return;
        const el=document.createElement(annotation.type==='note'?'button':'span');
        if(annotation.type==='note'){
          el.type='button';el.className='pdf-note-indicator';
          el.dataset.annotationId=annotation.id;el.setAttribute('aria-label','Abrir comentário');
          el.style.left=`${rect.right-rootRect.left-8}px`;el.style.top=`${rect.top-rootRect.top-8}px`;
        }else{
          el.className=annotation.type==='highlight'?'pdf-annotation-highlight':'pdf-annotation-quote';
          el.style.left=`${rect.left-rootRect.left}px`;el.style.top=`${rect.top-rootRect.top}px`;
          el.style.width=`${rect.width}px`;el.style.height=`${rect.height}px`;
          if(annotation.type==='highlight')el.style.setProperty('--hl-color',annotation.color||'#f3d76a');
        }
        layer.appendChild(el);
      });
    });
  }
  async triggerRePagination(){
    if(!this.currentBook)return;
    /* Quadrinho não tem tipografia para recalcular: basta rearranjar. */
    if(this.comic)return this.refreshComicLayout();
    const old=this.currentPageIndex||0;
    Utils.showLoader('Ajustando leitura','Recalculando páginas...',{progress:true});
    try{
      await this.openBook({...this.currentBook,progress:{...(this.currentBook.progress||{}),globalPage:old}});
    }finally{Utils.hideLoader()}
  }
  openToc(){
    const list=document.getElementById('toc-body');
    list.innerHTML='';
    this.chapterTitles.forEach((t,i)=>{
      const b=document.createElement('button');
      b.className='nav-item';b.style.width='100%';b.style.justifyContent='flex-start';
      b.innerHTML=`<i data-lucide="chevron-right" style="width:16px;height:16px"></i><span style="flex:1;text-align:left">${Utils.esc(t||`Capítulo ${i+1}`)}</span><span class="count">${(this.chapterStarts[i]??0)+1}</span>`;
      b.onclick=()=>{this.closeToc();this.turnToPage(this.chapterStarts[i]||0)};
      list.appendChild(b);
    });
    lucide.createIcons({root:list});
    App.openPanel('panel-toc');
    this.hideUI();
  }
  closeToc(){App.closePanels()}
  async showAnnotations(){
    if(!this.currentBook)return;
    const b=await this.db.getBook(this.currentBook.id);
    this.currentBook=b;
    App.renderAnnotationPanel(b);
    App.openPanel('panel-annotations');
  }
  close(){
    this.openController?.abort();
    this.hideUI();
    this.tts?.stop();
    this.destroy();
    App.switchView('home');
    App.library.render();
  }
  destroySliderOnly(){
    if(this.curl){this.curl.cancel();this.curl=null}
    if(this.slide){this.slide.cancel();this.slide=null}
    this.navigating=false;
    if(this.container&&this.container.isConnected)this.container.remove();
    this.container=null;
    this.sliderBook=null;
  }
  destroy(){
    this.tts?.stop();
    this.destroySliderOnly();
    this.pdfDoc?.destroy?.();
    this.pdfDoc=null;
    /* Fechar o quadrinho devolve à memória todas as páginas abertas. */
    if(this.comic){try{this.comic.close()}catch(e){console.warn(e)}this.comic=null}
    this.comicViews=[];this.comicZoom={scale:1,x:0,y:0};this.rtl=false;this.comicRatio=null;
    this.updateComicControls();
    this.currentExtractor=null;
    this.pagesData=[];this.pageMeta=[];this.chapterStarts=[];
  }
}
/* Tempo máximo para preparar um livro antes de desistir e avisar o leitor. */
ReaderEngine.OPEN_TIMEOUT=90000;
/* Quadrinhos em RAR/7z são descompactados por inteiro de uma vez:
   um álbum grande pode levar bem mais do que um livro de texto. */
ReaderEngine.OPEN_TIMEOUT_COMIC=300000;
/* Acima disso as páginas prontas não vão para o cache, para não estourar o
   armazenamento do aparelho com imagens embutidas. */
ReaderEngine.MAX_CACHE_CHARS=14*1024*1024;


/* ============================================================
   LOCAL FILE ACCESS — grava EPUB na pasta do PDF quando suportado
   ============================================================ */
const LocalFileAccess = {
  supported() {
    return typeof window.showDirectoryPicker === 'function';
  },
  async pickDirectory() {
    if (!this.supported()) return null;
    return window.showDirectoryPicker({
      id: 'veredas-epub-output',
      mode: 'readwrite'
    });
  },
  async ensureReadWritePermission(handle) {
    if (!handle) return false;
    try {
      if (typeof handle.queryPermission === 'function') {
        const current = await handle.queryPermission({mode:'readwrite'});
        if (current === 'granted') return true;
      }
      if (typeof handle.requestPermission === 'function') {
        const asked = await handle.requestPermission({mode:'readwrite'});
        return asked === 'granted';
      }
      return true;
    } catch {
      return false;
    }
  },
  async containsFile(handle, fileName) {
    if (!handle || !fileName) return false;
    try {
      await handle.getFileHandle(fileName);
      return true;
    } catch {
      return false;
    }
  },
  async uniqueName(handle, desiredName) {
    if (!handle) return desiredName;
    const clean = desiredName.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'livro.epub';
    const dot = clean.lastIndexOf('.');
    const base = dot > 0 ? clean.slice(0, dot) : clean;
    const ext = dot > 0 ? clean.slice(dot) : '.epub';
    if (!(await this.containsFile(handle, clean))) return clean;
    for (let i=2;i<=999;i++) {
      const candidate = `${base} (${i})${ext}`;
      if (!(await this.containsFile(handle, candidate))) return candidate;
    }
    return `${base} (${Date.now()})${ext}`;
  },
  async writeBlob(handle, fileName, blob) {
    const fileHandle = await handle.getFileHandle(fileName, {create:true});
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(blob);
    } finally {
      await writable.close();
    }
    return fileHandle;
  }
};

/* ============================================================
   CONVERSION DIALOG CONTROLLER
   ============================================================ */
const ConversionDialog = {
  el:null,
  body:null,
  footer:null,
  title:null,
  subtitle:null,
  confirm:null,
  cancel:null,
  closeBtn:null,
  active:false,
  resolve:null,

  init() {
    this.el=document.getElementById('conversion-modal');
    this.body=document.getElementById('conversion-body');
    this.footer=document.getElementById('conversion-footer');
    this.title=document.getElementById('conversion-title');
    this.subtitle=document.getElementById('conversion-subtitle');
    this.confirm=document.getElementById('conversion-confirm');
    this.cancel=document.getElementById('conversion-cancel');
    this.closeBtn=document.getElementById('conversion-close');

    const close=()=>this.close(false);
    this.cancel?.addEventListener('click',close);
    this.closeBtn?.addEventListener('click',close);
    this.el?.addEventListener('click',e=>{if(e.target===this.el)close()});
  },
  open(book) {
    if (!this.el) this.init();
    this.title.textContent='Converter PDF para EPUB';
    this.subtitle.textContent=book.title || 'Livro em PDF';
    this.body.innerHTML=`
      <p>O EPUB é melhor para livros com texto selecionável, porque permite ajustar fonte, tamanho, margens e modo de leitura.</p>
      <div class="conversion-warning">
        <i data-lucide="triangle-alert"></i>
        <div>
          <strong>Funcionalidade indicada apenas para livros</strong>
          <div>Revistas, apostilas complexas, formulários, documentos com muitas tabelas ou PDFs escaneados podem perder parte do layout original.</div>
        </div>
      </div>
      <p style="margin-top:12px">O PDF original <strong>não será apagado da pasta do usuário</strong>. Apenas a cópia desse PDF será retirada da biblioteca depois que o EPUB for salvo com sucesso.</p>
    `;
    this.footer.style.display='flex';
    this.confirm.innerHTML='<i data-lucide="file-output"></i>Converter para EPUB';
    this.confirm.disabled=false;
    this.cancel.disabled=false;
    this.el.classList.add('show');
    this.active=true;
    lucide.createIcons({root:this.el});
    return new Promise(resolve=>{
      this.resolve=resolve;
      const c=this.confirm, x=this.cancel;
      const onConfirm=()=>{c.removeEventListener('click',onConfirm);x.removeEventListener('click',onCancel);this.resolve=null;resolve(true)};
      const onCancel=()=>{c.removeEventListener('click',onConfirm);x.removeEventListener('click',onCancel);this.resolve=null;resolve(false)};
      c.addEventListener('click',onConfirm,{once:true});
      x.addEventListener('click',onCancel,{once:true});
    });
  },
  close(result=false) {
    if (!this.el) return;
    this.el.classList.remove('show');
    this.active=false;
    const r=this.resolve;
    this.resolve=null;
    if(r)r(result);
  },
  showWorking() {
    this.title.textContent='Convertendo livro';
    this.subtitle.textContent='Processamento local no navegador';
    this.body.innerHTML=`
      <p>O arquivo está sendo lido e reconstruído. Livros grandes podem levar alguns instantes.</p>
      <div class="conversion-status show">
        <div class="spinner"></div>
        <div class="conversion-status-text">
          <strong id="conversion-live-stage">Preparando…</strong>
          <small id="conversion-live-detail">0%</small>
        </div>
      </div>
      <div class="conversion-details" id="conversion-live-stats"></div>
    `;
    this.footer.style.display='none';
    lucide.createIcons({root:this.el});
  },
  updateProgress(percent,message) {
    const stage=document.getElementById('conversion-live-stage');
    const detail=document.getElementById('conversion-live-detail');
    if(stage)stage.textContent=message || 'Processando…';
    if(detail)detail.textContent=`${Utils.clamp(Math.round(percent||0),0,100)}%`;
  },
  showFallbackFolder(book) {
    this.title.textContent='Escolha a pasta do PDF';
    this.subtitle.textContent='Necessário para salvar o EPUB ao lado do original';
    this.body.innerHTML=`
      <p>Para gravar o EPUB <strong>na mesma pasta do PDF</strong>, o navegador precisa de permissão para acessar essa pasta.</p>
      <div class="conversion-warning">
        <i data-lucide="folder-open"></i>
        <div>
          <strong>Selecione a pasta que contém o PDF</strong>
          <div>Essa permissão é dada somente a esta aplicação e evita que o arquivo original seja alterado.</div>
        </div>
      </div>
      <p style="margin-top:12px;font-size:11px;color:var(--muted)">Em navegadores sem suporte a acesso direto ao sistema de arquivos, o EPUB será baixado como alternativa.</p>
    `;
    this.footer.style.display='flex';
    this.confirm.innerHTML='<i data-lucide="folder-open"></i>Selecionar pasta e continuar';
    this.cancel.textContent='Cancelar';
    this.confirm.disabled=false;
    this.cancel.disabled=false;
    lucide.createIcons({root:this.el});
  },
  showSuccess(result, savedInfo) {
    this.title.textContent='Conversão concluída';
    this.subtitle.textContent=result.meta?.title || 'EPUB pronto';
    const stats=result.stats||{};
    this.body.innerHTML=`
      <p><strong>${Utils.esc(savedInfo.message)}</strong></p>
      <div class="conversion-details">
        <div class="conversion-detail"><strong>${stats.pdfPages||0}</strong><span>Páginas do PDF</span></div>
        <div class="conversion-detail"><strong>${stats.words||0}</strong><span>Palavras</span></div>
        <div class="conversion-detail"><strong>${stats.imagePages||0}</strong><span>Páginas como imagem</span></div>
      </div>
      <p style="margin-top:12px">O PDF original permanece intacto na pasta do usuário.</p>
    `;
    this.footer.style.display='flex';
    this.confirm.innerHTML='<i data-lucide="book-open"></i>Ler agora';
    this.cancel.textContent='Concluir';
    this.confirm.disabled=false;
    this.cancel.disabled=false;
    lucide.createIcons({root:this.el});
  }
};

/* ============================================================
   LIBRARY MANAGER
   ============================================================ */
/* ============================================================
   REORDENAÇÃO DA ESTANTE
   ------------------------------------------------------------
   Um único controlador cuida do gesto inteiro, em vez de cada
   capa cuidar de si. Isso resolve três problemas de uma vez:

   • o alvo é calculado pela posição real do dedo sobre a grade,
     então arrastar para a direita, para a esquerda ou na
     diagonal funciona igual;
   • enquanto o livro está na mão, o touchmove é bloqueado, então
     a estante não rola junto e rouba a troca de posição;
   • quando o dedo chega perto da borda, a estante rola sozinha,
     no ritmo da aproximação, para alcançar as fileiras de cima
     e de baixo sem soltar o livro.

   A reordenação acontece ao vivo (as capas abrem espaço com
   animação FLIP) e só é gravada quando o dedo solta.
   ============================================================ */
class ShelfSorter{
  constructor(library){
    this.library=library;
    this.card=null;this.grid=null;this.ghost=null;this.scroller=null;
    this.pointerId=null;this.pressTimer=null;
    this.dragging=false;this.suppressClick=false;
    this.startX=0;this.startY=0;this.offsetX=0;this.offsetY=0;
    this.lastPoint=null;this.scrollRaf=0;this.scrollSpeed=0;
    this.onMove=this.onMove.bind(this);
    this.onUp=this.onUp.bind(this);
    this.onCancel=this.onCancel.bind(this);
    this.blockTouch=this.blockTouch.bind(this);
  }
  attach(el){
    el.draggable=false;
    el.addEventListener('pointerdown',e=>this.onDown(e,el),{passive:true});
    el.addEventListener('contextmenu',e=>{
      if(this.dragging||window.matchMedia('(pointer:coarse)').matches)e.preventDefault();
    });
  }
  onDown(e,el){
    if(this.dragging||this.pointerId!==null)return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    if(e.target.closest&&e.target.closest('.book-menu-wrap'))return;
    this.card=el;this.pointerId=e.pointerId;
    this.startX=e.clientX;this.startY=e.clientY;
    const rect=el.getBoundingClientRect();
    this.offsetX=e.clientX-rect.left;this.offsetY=e.clientY-rect.top;
    window.addEventListener('pointermove',this.onMove,{passive:false});
    window.addEventListener('pointerup',this.onUp,{passive:true});
    window.addEventListener('pointercancel',this.onCancel,{passive:true});
    window.addEventListener('touchmove',this.blockTouch,{passive:false});
    if(e.pointerType!=='mouse'){
      this.pressTimer=setTimeout(()=>this.begin(this.startX,this.startY),320);
    }
  }
  blockTouch(e){if(this.dragging)e.preventDefault()}
  clearPress(){if(this.pressTimer){clearTimeout(this.pressTimer);this.pressTimer=null}}
  onMove(e){
    if(this.pointerId===null||e.pointerId!==this.pointerId)return;
    const dx=e.clientX-this.startX,dy=e.clientY-this.startY;
    if(!this.dragging){
      /* Antes de pegar o livro o dedo ainda pertence à rolagem. */
      if(e.pointerType==='mouse'){
        if(Math.hypot(dx,dy)>6)this.begin(e.clientX,e.clientY);
      }else if(Math.hypot(dx,dy)>12){
        this.release(false);
      }
      return;
    }
    e.preventDefault();
    this.lastPoint={x:e.clientX,y:e.clientY};
    this.moveGhost(e.clientX,e.clientY);
    this.updateTarget(e.clientX,e.clientY);
    this.updateAutoScroll(e.clientY);
  }
  begin(x,y){
    this.clearPress();
    if(!this.card||!this.card.isConnected)return this.release(false);
    const grid=this.card.closest('.book-grid');
    if(!grid)return this.release(false);
    this.grid=grid;
    this.scroller=this.card.closest('.view')||document.getElementById('view-home');
    const rect=this.card.getBoundingClientRect();
    /* As células têm tamanho fixo: medir agora permite descobrir a
       posição de destino pela célula sob o dedo, sem depender dos
       retângulos das capas — que ficam deslocados enquanto a animação
       de abertura de espaço acontece. */
    this.baseW=rect.width;this.baseH=rect.height;
    this.metrics=new Map();
    const ghost=this.card.cloneNode(true);
    ghost.className='book-drag-ghost';
    ghost.setAttribute('aria-hidden','true');
    ghost.style.setProperty('--ghost-w',`${rect.width}px`);
    ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
    document.body.appendChild(ghost);
    this.ghost=ghost;
    this.dragging=true;
    this.autoScrollArmed=false;
    this.lastPoint={x,y};
    this.moveGhost(x,y);
    this.card.classList.add('dnd-source');
    document.body.classList.add('dnd-active');
    if(navigator.vibrate&&window.matchMedia('(pointer:coarse)').matches)navigator.vibrate(16);
  }
  moveGhost(x,y){
    if(!this.ghost)return;
    this.ghost.style.transform=`translate3d(${Math.round(x-this.offsetX)}px,${Math.round(y-this.offsetY)}px,0) scale(1.05) rotate(1.4deg)`;
  }
  cards(){return Array.from(this.grid.querySelectorAll('.book-card'))}
  allGrids(){
    const root=document.getElementById('library-content');
    return root?Array.from(root.querySelectorAll('.book-grid')):[this.grid];
  }
  metricsFor(grid){
    let m=this.metrics.get(grid);
    if(m)return m;
    const cs=getComputedStyle(grid);
    const columns=Math.max(1,String(cs.gridTemplateColumns||'').trim().split(/\s+/).filter(Boolean).length);
    const sample=grid.querySelector('.book-card');
    const r=sample?sample.getBoundingClientRect():null;
    m={
      columns,
      w:Math.max(1,((r&&r.width)||this.baseW)+(parseFloat(cs.columnGap)||0)),
      h:Math.max(1,((r&&r.height)||this.baseH)+(parseFloat(cs.rowGap)||0))
    };
    this.metrics.set(grid,m);
    return m;
  }
  /* Com a estante agrupada existe uma grade por autor: o livro precisa
     poder atravessar prateleiras, senão grupos de um livro só ficariam
     impossíveis de reordenar. */
  gridUnder(y){
    const grids=this.allGrids();
    if(!grids.length)return null;
    for(const g of grids){
      const r=g.getBoundingClientRect();
      if(y>=r.top-10&&y<=r.bottom+10)return g;
    }
    let best=grids[0],dist=Infinity;
    for(const g of grids){
      const r=g.getBoundingClientRect();
      const d=y<r.top?r.top-y:y-r.bottom;
      if(d<dist){dist=d;best=g}
    }
    return best;
  }
  updateTarget(x,y){
    if(!this.card)return;
    const grid=this.gridUnder(y);
    if(!grid)return;
    const m=this.metricsFor(grid);
    const g=grid.getBoundingClientRect();
    const col=Utils.clamp(Math.floor((x-g.left)/m.w),0,m.columns-1);
    const row=Math.max(0,Math.floor((y-g.top)/m.h));
    const cell=row*m.columns+col;
    const list=Array.from(grid.querySelectorAll('.book-card'));
    if(grid===this.card.parentElement){
      if(list.length<2)return;
      const cur=list.indexOf(this.card);
      if(cur<0)return;
      const want=Utils.clamp(cell,0,list.length-1);
      if(want===cur)return;
      const ref=want>cur?list[want].nextElementSibling:list[want];
      if(ref===this.card)return;
      this.applyReorder(()=>grid.insertBefore(this.card,ref));
    }else{
      const want=Utils.clamp(cell,0,list.length);
      this.applyReorder(()=>grid.insertBefore(this.card,list[want]||null));
    }
    this.grid=this.card.parentElement||grid;
  }
  /* FLIP: mede antes, move, e anima a diferença. */
  applyReorder(mutate){
    const root=document.getElementById('library-content');
    const list=Array.from((root||this.grid).querySelectorAll('.book-card'));
    const before=new Map();
    list.forEach(el=>before.set(el,el.getBoundingClientRect()));
    mutate();
    list.forEach(el=>{
      if(el===this.card)return;
      const from=before.get(el),to=el.getBoundingClientRect();
      const dx=from.left-to.left,dy=from.top-to.top;
      if(!dx&&!dy)return;
      el.classList.remove('dnd-moving');
      el.style.transform=`translate(${dx}px,${dy}px)`;
      requestAnimationFrame(()=>{
        el.classList.add('dnd-moving');
        el.style.transform='';
      });
    });
  }
  updateAutoScroll(y){
    const sc=this.scroller;
    if(!sc){this.scrollSpeed=0;return}
    const r=sc.getBoundingClientRect();
    const edge=Math.min(80,r.height*0.12);
    let factor=0;
    if(y<r.top+edge)factor=-(1-Math.max(0,y-r.top)/edge);
    else if(y>r.bottom-edge)factor=1-Math.max(0,r.bottom-y)/edge;
    /* Quem pega um livro que já estava perto da borda não quer que a
       estante saia correndo: a rolagem só é liberada depois que o dedo
       passa pelo meio da tela ao menos uma vez. */
    if(!factor)this.autoScrollArmed=true;
    this.scrollSpeed=this.autoScrollArmed?Utils.clamp(factor,-1,1)*13:0;
    if(this.scrollSpeed&&!this.scrollRaf)this.scrollStep();
  }
  scrollStep(){
    this.scrollRaf=requestAnimationFrame(()=>{
      this.scrollRaf=0;
      if(!this.dragging||!this.scrollSpeed||!this.scroller)return;
      const before=this.scroller.scrollTop;
      this.scroller.scrollTop=before+this.scrollSpeed;
      if(this.scroller.scrollTop!==before&&this.lastPoint){
        this.updateTarget(this.lastPoint.x,this.lastPoint.y);
      }
      this.scrollStep();
    });
  }
  onUp(e){
    if(this.pointerId!==null&&e.pointerId!==this.pointerId)return;
    this.release(true);
  }
  onCancel(e){
    if(this.pointerId!==null&&e.pointerId!==this.pointerId)return;
    this.release(false);
  }
  release(commit){
    this.clearPress();
    window.removeEventListener('pointermove',this.onMove,{passive:false});
    window.removeEventListener('pointerup',this.onUp,{passive:true});
    window.removeEventListener('pointercancel',this.onCancel,{passive:true});
    window.removeEventListener('touchmove',this.blockTouch,{passive:false});
    if(this.scrollRaf){cancelAnimationFrame(this.scrollRaf);this.scrollRaf=0}
    this.scrollSpeed=0;
    const wasDragging=this.dragging;
    if(this.ghost){this.ghost.remove();this.ghost=null}
    if(this.card)this.card.classList.remove('dnd-source');
    document.body.classList.remove('dnd-active');
    document.querySelectorAll('.book-card.dnd-moving').forEach(el=>{
      el.classList.remove('dnd-moving');el.style.transform='';
    });
    this.dragging=false;this.pointerId=null;this.card=null;this.grid=null;
    this.lastPoint=null;this.scroller=null;
    if(wasDragging){
      this.suppressClick=true;
      setTimeout(()=>{this.suppressClick=false},280);
      if(commit)this.library.commitManualOrder();
    }
  }
}

class LibraryManager{
  constructor(db){
    this.db=db;this.allBooks=[];this.currentFilter='all';this.search='';
    this.selectedBookId=null;this.dragged=null;this.sorter=new ShelfSorter(this);
    this.setupImport();this.setupSearch();this.setupNav();this.setupSort();this.setupGlobalActions();
  }
  async render(){
    this.allBooks=await this.db.getBooks();
    this.allBooks.forEach((b,i)=>{if(!Number.isFinite(b.order))b.order=i});
    this.updateCounts();
    this.renderView();
  }
  updateCounts(){
    const c={
      all:this.allBooks.length,
      reading:this.allBooks.filter(b=>b.status==='reading').length,
      read:this.allBooks.filter(b=>b.status==='read').length,
      toread:this.allBooks.filter(b=>b.status==='toread').length,
      paused:this.allBooks.filter(b=>b.status==='paused').length,
      favorite:this.allBooks.filter(b=>b.favorite).length,
      audio:this.allBooks.filter(b=>AudioFormats.isAudioBook(b)).length
    };
    Object.entries(c).forEach(([k,v])=>{
      const el=document.getElementById(`count-${k}`);
      if(el)el.textContent=v;
    });
    const bm=document.getElementById('count-bookmarks');
    const nt=document.getElementById('count-notes');
    const qt=document.getElementById('count-quotes');
    if(bm)bm.textContent=this.allBooks.reduce((n,b)=>n+b.bookmarks.length,0);
    if(nt)nt.textContent=this.allBooks.reduce((n,b)=>n+b.annotations.filter(a=>a.type==='note').length,0);
    if(qt)qt.textContent=this.allBooks.reduce((n,b)=>n+b.annotations.filter(a=>a.type==='quote').length,0);
  }
  setupNav(){
    document.querySelectorAll('#library-nav .nav-item').forEach(btn=>{
      if(!btn.dataset.filter)return;
      btn.onclick=()=>{
        document.querySelectorAll('#library-nav .nav-item').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter=btn.dataset.filter;
        this.search='';
        const si=document.getElementById('library-search-input');
        if(si)si.value='';
        App.syncBottomNav();
        if(['collections','series','authors','tags'].includes(this.currentFilter)){
          this.openDimensionPanel(this.currentFilter);
        }else{
          this.renderView();
        }
        App.closeDrawer();
      };
    });
    const ns=document.getElementById('nav-settings');
    if(ns)ns.onclick=()=>{App.closeDrawer();App.openPanel('panel-settings')};

    const scan=document.getElementById('nav-scan');
    if(scan)scan.onclick=()=>{App.closeDrawer();DeviceScan.start()};

    /* Menu Sobre: acordeão — o botão de cabeçalho mostra/esconde o grupo;
       cada item dentro do grupo abre o documento correspondente em modal. */
    const setupAccordion=(btnId,groupId)=>{
      const btn=document.getElementById(btnId);
      const group=document.getElementById(groupId);
      if(!btn||!group)return;
      btn.onclick=()=>{
        const aberto=btn.getAttribute('aria-expanded')==='true';
        btn.setAttribute('aria-expanded',String(!aberto));
        group.hidden=aberto;
      };
    };
    setupAccordion('nav-sobre-group','nav-sobre-content');
    setupAccordion('nav-licenses','nav-licenses-group');
    document.querySelectorAll('#library-nav [data-doc]').forEach(btn=>{
      btn.onclick=()=>Docs.open(btn.dataset.doc);
    });
  }
  setupSort(){
    const btn=document.getElementById('btn-organize');
    if(btn)btn.onclick=()=>this.openSortPanel();
  }
  openSortPanel(){
    const body=document.getElementById('sort-options');
    if(!body)return;
    const options=[
      {value:'custom',label:'Minha Ordem',desc:'Use a ordem manual da sua estante.',icon:'arrow-down-up'},
      {value:'author',label:'Agrupar por Autor',desc:'Organiza e separa os livros por autor.',icon:'users'},
      {value:'format',label:'Tipo de arquivo',desc:'Separa em prateleiras de EPUB, PDF, DOCX, audiolivros, vídeos…',icon:'file-stack'},
      {value:'title',label:'Título',desc:'Ordem alfabética pelo título.',icon:'type'},
      {value:'recent',label:'Recentes',desc:'Livros adicionados ou lidos mais recentemente.',icon:'clock-3'},
      {value:'progress',label:'Progresso',desc:'Do maior para o menor progresso de leitura.',icon:'chart-no-axes-column-increasing'}
    ];
    const current=App.state.settings.sort||'custom';
    body.innerHTML='';
    options.forEach(opt=>{
      const button=document.createElement('button');
      button.type='button';
      button.className=`sort-option ${current===opt.value?'active':''}`;
      button.setAttribute('aria-pressed',current===opt.value?'true':'false');
      button.innerHTML=`<i data-lucide="${opt.icon}"></i><span>${Utils.esc(opt.label)}</span><small>${Utils.esc(opt.desc)}</small>`;
      button.onclick=async()=>{
        App.state.settings.sort=opt.value;
        App.state.settings.groupAuthors=opt.value==='author';
        await App.persistSettings();
        App.closePanels();
        Utils.toast(`Agrupamento: ${opt.label}.`,'check');
        await this.render();
      };
      body.appendChild(button);
    });
    lucide.createIcons({root:body});
    App.openPanel('panel-sort');
  }
  setupSearch(){
    document.getElementById('library-search-input').addEventListener('input',
      Utils.debounce(e=>{this.search=e.target.value.trim().toLowerCase();this.renderView()},180));
  }
  setupGlobalActions(){
    document.getElementById('btn-import').onclick=()=>this.openImport();
    document.getElementById('btn-search-toggle').onclick=()=>App.openSearch();
    document.getElementById('btn-close-search').onclick=()=>App.closeSearch();
    
    document.getElementById('btn-close-drawer').onclick=()=>App.closeDrawer();
    document.getElementById('tab-more').onclick=()=>App.openDrawer();
    document.querySelectorAll('#bottom-nav [data-filter]').forEach(btn=>{
      btn.onclick=()=>{
        document.querySelectorAll('#library-nav .nav-item').forEach(x=>{
          x.classList.toggle('active',x.dataset.filter===btn.dataset.filter);
        });
        document.querySelectorAll('#bottom-nav [data-filter]').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter=btn.dataset.filter;
        this.search='';
        const si=document.getElementById('library-search-input');
        if(si)si.value='';
        this.renderView();
        const view=document.getElementById('view-home');
        if(view)view.scrollTo({top:0,behavior:'smooth'});
      };
    });
  }
  baseBooks(){
    let b=[...this.allBooks];
    if(['reading','read','toread','paused'].includes(this.currentFilter)){
      b=b.filter(x=>x.status===this.currentFilter);
    }else if(this.currentFilter==='favorite'){
      b=b.filter(x=>x.favorite);
    }else if(this.currentFilter==='audio'){
      b=b.filter(x=>AudioFormats.isAudioBook(x));
    }
    if(['bookmarks','notes','quotes'].includes(this.currentFilter))return[];
    if(this.search)b=b.filter(x=>
      [x.title,x.author,x.series,x.folder,...x.tags,...x.collections].join(' ').toLowerCase().includes(this.search)
    );
    return b;
  }
  sortedBooks(b){
    const s=App.state.settings.sort||'custom';
    if(s==='custom')return b.sort((a,c)=>(a.order??0)-(c.order??0));
    if(s==='author')return b.sort((a,c)=>{
      const aa=(a.author||'').toLowerCase(),cc=(c.author||'').toLowerCase();
      return aa.localeCompare(cc,'pt')||a.title.localeCompare(c.title,'pt');
    });
    if(s==='format')return b.sort((a,c)=>{
      const d=BookFormats.groupRank(a.format)-BookFormats.groupRank(c.format);
      if(d)return d;
      const ga=BookFormats.groupName(a.format),gc=BookFormats.groupName(c.format);
      return ga.localeCompare(gc,'pt')||(a.title||'').localeCompare(c.title||'','pt');
    });
    if(s==='title')return b.sort((a,c)=>(a.title||'').localeCompare(c.title||'','pt'));
    if(s==='recent')return b.sort((a,c)=>(c.lastRead||c.addedAt||0)-(a.lastRead||a.addedAt||0));
    return b.sort((a,c)=>(c.progress?.percentage||0)-(a.progress?.percentage||0));
  }
  renderView(){
    const title=document.getElementById('section-title');
    const sub=document.getElementById('section-subtitle');
    const content=document.getElementById('library-content');
    content.innerHTML='';
    if(this.currentFilter==='bookmarks'){
      title.textContent='Marcadores';
      sub.textContent='Páginas salvas para voltar rapidamente.';
      this.renderBookmarks(content);
      return;
    }
    if(this.currentFilter==='notes'||this.currentFilter==='quotes'){
      const singular=Utils.normalizeType(this.currentFilter);
      title.textContent=singular==='note'?'Anotações':'Citações';
      sub.textContent=singular==='note'?'Comentários vinculados a trechos selecionados.':'Trechos salvos separadamente dos marcadores.';
      this.renderAnnotationsList(content,singular);
      return;
    }
    const b=this.sortedBooks(this.baseBooks());
    title.textContent=
      this.currentFilter==='all'?'Sua Biblioteca':
      this.currentFilter==='audio'?'Áudio e vídeo':
      this.currentFilter==='favorite'?'Favoritos':
      this.currentFilter==='reading'?'Lendo agora':
      this.currentFilter==='read'?'Lidos':
      this.currentFilter==='toread'?'Para ler':'Pausados';
    sub.textContent=this.search
      ?`${b.length} resultado(s) para “${this.search}”`
      :(this.currentFilter==='audio'?'Toque para continuar de onde parou.'
        :App.state.settings.sort==='author'?'Autores agrupados em ordem alfabética.'
        :App.state.settings.sort==='format'?'Uma prateleira para cada tipo de arquivo.'
        :App.state.settings.sort==='custom'?'Ordem manual da sua estante.'
        :'Livros organizados pela opção selecionada.');
    this.renderHero();
    if(!b.length){
      content.innerHTML=this.currentFilter==='audio'&&!this.search
        ?`<div class="empty"><i data-lucide="headphones"></i><h3>Nada para ouvir ou assistir ainda</h3><p>Toque em + e escolha arquivos MP3, M4B ou MP4. Vários MP3 de capítulos podem virar um único audiolivro.</p></div>`
        :`<div class="empty"><i data-lucide="library"></i><h3>Nada por aqui ainda</h3><p>Importe um livro ou ajuste seus filtros de organização.</p></div>`;
      lucide.createIcons({root:content});
      return;
    }
    if(b.length>1&&(App.state.settings.sort||'custom')!=='custom'){
      const hint=document.createElement('div');
      hint.className='shelf-reorder-hint';
      hint.id='shelf-reorder-hint';
      hint.innerHTML=`<i data-lucide="arrow-down-up"></i><span>Arraste um livro para reposicioná-lo: a estante passa para Minha Ordem e guarda a sequência.</span>`;
      content.appendChild(hint);
    }
    const modo=App.state.settings.sort;
    const grouped=new Map();
    b.forEach(book=>{
      const key=modo==='author'?(book.author||'Autor desconhecido')
        :modo==='format'?BookFormats.groupName(book.format)
        :'Sua estante';
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(book);
    });
    for(const[name,books]of grouped){
      const shelf=document.createElement('section');
      shelf.className='shelf';
      const icone=modo==='format'?`<i data-lucide="${BookFormats.icon(books[0].format)}" class="shelf-icon"></i>`:'';
      const unidade=books.length===1?'item':'itens';
      shelf.innerHTML=`<div class="shelf-head"><h3>${icone}${Utils.esc(name)}</h3><span>${books.length} ${modo==='format'?unidade:(books.length===1?'livro':'livros')}</span></div><div class="book-grid"></div>`;
      const grid=shelf.querySelector('.book-grid');
      books.forEach(book=>grid.appendChild(this.card(book)));
      content.appendChild(shelf);
    }
    lucide.createIcons({root:content});
    App.player?.syncCards();
  }
  renderHero(){
    const hero=document.getElementById('hero-area');
    const reading=[...this.allBooks].filter(b=>b.status==='reading').sort((a,c)=>(c.lastRead||0)-(a.lastRead||0));
    const b=reading[0]||this.allBooks.find(x=>x.progress?.percentage>0);
    const total=this.allBooks.length;
    const toRead=this.allBooks.filter(x=>x.status==='toread').length;
    const readingCount=this.allBooks.filter(x=>x.status==='reading').length;
    const finished=this.allBooks.filter(x=>x.status==='read').length;
    const withProgress=this.allBooks.filter(x=>Number.isFinite(x.progress?.percentage));
    const avg=withProgress.length?Math.round(withProgress.reduce((n,x)=>n+Math.max(0,Math.min(100,Number(x.progress?.percentage)||0)),0)/withProgress.length):0;

    const statCard=(icon,label,value,caption,filter='',progress=null)=>`
      <button type="button" class="stat-card${filter?' stat-action':''}" ${filter?`data-stat-filter="${filter}"`:''}>
        <div class="stat-top">
          <span class="stat-icon"><i data-lucide="${icon}"></i></span>
          ${filter?'<i class="stat-arrow" data-lucide="chevron-right"></i>':''}
        </div>
        <div>
          <div class="k">${value}</div>
          <div class="l">${label}</div>
          <div class="stat-caption">${caption}</div>
          ${progress!==null?`<div class="stat-progress"><span style="width:${progress}%"></span></div>`:''}
        </div>
      </button>`;

    if(!b){
      hero.innerHTML=`
        <div class="hero-card">
          <div>
            <div class="hero-label">Sua biblioteca</div>
            <div class="hero-title">Tudo pronto para a próxima leitura.</div>
            <div class="hero-meta">Adicione livros e acompanhe o que está por ler, o que está em andamento e seu progresso.</div>
          </div>
          <button class="soft-btn" id="hero-import"><i data-lucide="plus"></i>Adicionar livro</button>
        </div>
        <div class="stat-grid">
          ${statCard('library','Livros',total,'Na sua biblioteca','all')}
          ${statCard('bookmark-plus','Para ler',toRead,'Na fila de leitura','toread')}
          ${statCard('book-open','Lendo agora',readingCount,readingCount===1?'Livro em andamento':'Livros em andamento','reading')}
          ${statCard('gauge','Progresso médio',`${avg}%`,'Entre os livros com progresso',null,avg)}
        </div>`;
      lucide.createIcons({root:hero});
      const hb=document.getElementById('hero-import');
      if(hb)hb.onclick=()=>this.openImport();
      this.bindHeroStats(hero);
      return;
    }

    const pct=Math.max(0,Math.min(100,Number(b.progress?.percentage)||0));
    const page=b.progress?.readPages||1;
    const totalPages=b.progress?.totalPages||b.totalPages||'—';
    const isAudio=AudioFormats.isAudioBook(b);
    const verbo=AudioFormats.isVideoBook(b)?'assistindo':isAudio?'ouvindo':'lendo';
    const chamada=AudioFormats.isVideoBook(b)?'Continue assistindo':isAudio?'Continue ouvindo':'Continue lendo';
    const footLeft=isAudio
      ?(pct>=100?'Concluído':`${AudioFmt.long(Math.max(0,(b.audio?.duration||0)-(b.progress?.position||0)))} restantes`)
      :`Página ${page} de ${totalPages}`;
    hero.innerHTML=`
      <div class="hero-card" id="hero-continue" role="button" tabindex="0" aria-label="Continuar ${verbo} ${Utils.esc(b.title)}">
        <div>
          <div class="hero-label">${chamada}</div>
          <div class="hero-title">${Utils.esc(b.title)}</div>
          <div class="hero-meta">${Utils.esc(b.author||'Autor desconhecido')}</div>
        </div>
        <div>
          <div class="hero-progress"><span style="width:${pct}%"></span></div>
          <div class="hero-footer">
            <span>${footLeft}</span>
            <strong>${pct}%</strong>
          </div>
        </div>
      </div>
      <div class="stat-grid">
        ${statCard('library','Livros',total,'Na sua biblioteca','all')}
        ${statCard('bookmark-plus','Para ler',toRead,'Na fila de leitura','toread')}
        ${statCard('book-open','Lendo agora',readingCount,readingCount===1?'Livro em andamento':'Livros em andamento','reading')}
        ${statCard('gauge','Progresso médio',`${avg}%`,'Entre os livros com progresso',null,avg)}
      </div>`;
    lucide.createIcons({root:hero});
    const hc=document.getElementById('hero-continue');
    if(hc){
      const go=()=>App.reader.openBook(b);
      hc.onclick=go;
      hc.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}};
    }
    this.bindHeroStats(hero);
  }
  bindHeroStats(root){
    root.querySelectorAll('[data-stat-filter]').forEach(card=>{
      card.onclick=()=>{
        const filter=card.dataset.statFilter;
        this.currentFilter=filter;
        this.search='';
        const si=document.getElementById('library-search-input');
        if(si)si.value='';
        document.querySelectorAll('#library-nav .nav-item').forEach(x=>x.classList.toggle('active',x.dataset.filter===filter));
        App.syncBottomNav();
        this.renderView();
        document.getElementById('view-home')?.scrollTo({top:0,behavior:'smooth'});
      };
    });
  }
  card(book){
    const el=document.createElement('article');
    el.className='book-card';el.draggable=true;el.dataset.id=book.id;
    const pct=book.progress?.percentage||0;
    const media=AudioFormats.isAudioBook(book);
    const video=AudioFormats.isVideoBook(book);
    const audio=media;                 /* nome antigo, mantido para o resto do método */
    const fmt=BookFormats.normalize(book.format);
    const comic=BookFormats.isComic(fmt);
    const mediaIcon=media?AudioFormats.icon(fmt):BookFormats.icon(fmt);
    /* Quadrinho e audiolivro levam o ícone do formato junto da etiqueta:
       são os tipos que a pessoa procura de relance na estante. */
    const comIcone=media||comic;
    /* capas de audiolivro costumam ser quadradas: aparecem inteiras sobre um fundo desfocado */
    const squareCover=media&&!video&&!!book.cover&&(book.coverAspect||0)>0.85;
    const subRight=media?this.audioSubText(book):(book.progress?.readPages?`p. ${book.progress.readPages}`:'');
    const cover=book.cover
      ?`<img src="${book.cover}" alt="${Utils.esc(book.title)}" loading="lazy">`
      :`<div class="fallback${comIcone?' audio-fallback':''}">${comIcone?`<i data-lucide="${mediaIcon}"></i>`:''}<strong>${Utils.esc(book.title)}</strong><small>${Utils.esc(book.author||'')}</small></div>`;
    /* Uma etiqueta só, montada a partir do formato: acrescentar um formato
       novo não exige mexer aqui de novo. */
    const badge=`<span class="badge fmt-badge ${fmt}-badge${media?' audio-badge':''}">${comIcone?`<i data-lucide="${mediaIcon}"></i>`:''}${BookFormats.label(fmt)}</span>`;
    el.innerHTML=`
      <div class="book-menu-wrap">
        ${fmt==='pdf'?'<button class="book-menu convert-btn" title="Converter para EPUB" aria-label="Converter PDF para EPUB"><i data-lucide="file-output"></i></button>':''}
        ${BookFormats.canShare(fmt)?'<button class="book-menu share-btn" title="Compartilhar livro" aria-label="Compartilhar livro"><i data-lucide="share-2"></i></button>':''}
        <button class="book-menu organize-btn" title="Organizar livro" aria-label="Organizar livro"><i data-lucide="more-horizontal"></i></button>
        <button class="book-delete" title="Excluir da biblioteca" aria-label="Excluir da biblioteca"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="book-cover${media?' is-audio':''}${video?' is-video':''}${squareCover?' cover-square':''}">
        ${squareCover?'<div class="cover-blur" aria-hidden="true"></div>':''}
        ${cover}
        <div class="cover-format-badge">${badge}</div>
        <div class="cover-badges">
          ${book.favorite?'<span class="badge">♥</span>':''}
          ${book.status==='read'?'<span class="badge">Lido</span>':''}
        </div>
        ${media?`<span class="cover-duration"><i data-lucide="clock-3"></i>${AudioFmt.long(book.audio?.duration||0)}</span><span class="cover-eq" aria-hidden="true"><i></i><i></i><i></i></span>`:''}
        ${video?'<span class="cover-play" aria-hidden="true"><i data-lucide="play"></i></span>':''}
      </div>
      <div class="book-info">
        <div class="book-title">${Utils.esc(book.title)}</div>
        <div class="book-author">${Utils.esc(book.author||'Autor desconhecido')}</div>
        <div class="book-progress"><span style="width:${pct}%"></span></div>
        <div class="book-sub"><span>${pct}%</span><span>${subRight}</span></div>
      </div>`;
    if(squareCover){
      const blur=el.querySelector('.cover-blur');
      if(blur)blur.style.backgroundImage=`url("${book.cover}")`;
    }
    if(audio&&App.player&&App.player.book&&App.player.book.id===book.id&&App.player.isPlaying())el.classList.add('is-playing');
    const organizeBtn=el.querySelector('.organize-btn');
    organizeBtn.onclick=e=>{e.stopPropagation();this.openOrganizer(book)};
    const convertBtn=el.querySelector('.convert-btn');
    if(convertBtn)convertBtn.onclick=async e=>{e.stopPropagation();await this.convertPdf(book)};
    const shareBtn=el.querySelector('.share-btn');
    if(shareBtn)shareBtn.onclick=async e=>{e.stopPropagation();await this.shareBook(book)};
    el.querySelector('.book-delete').onclick=async e=>{e.stopPropagation();await this.deleteBook(book)};
    el.onclick=e=>{
      if(this.sorter.suppressClick)return;
      if(e.target.closest('.book-menu-wrap'))return;
      App.reader.openBook(book);
    };
    /* Segure para pegar o livro (ou arraste com o mouse) e solte
       sobre a posição desejada — em qualquer direção. */
    this.sorter.attach(el);
    return el;
  }
  /* Texto à direita da barra de progresso do card: quanto falta para terminar. */
  audioSubText(book){
    const dur=book.audio?.duration||0,pos=book.progress?.position||0,pct=book.progress?.percentage||0;
    if(pct>=100)return 'Concluído';
    if(pos>1)return `${AudioFmt.long(Math.max(0,dur-pos))} restantes`;
    return AudioFmt.long(dur);
  }
  /* O player grava o progresso de tempos em tempos; a estante acompanha sem redesenhar tudo. */
  refreshAudioProgress(saved){
    if(!saved)return;
    const i=this.allBooks.findIndex(b=>b.id===saved.id);
    if(i>=0)this.allBooks[i]={...this.allBooks[i],progress:saved.progress,status:saved.status,lastRead:saved.lastRead,audio:saved.audio};
    const card=document.querySelector(`.book-card[data-id="${saved.id}"]`);
    if(!card)return;
    const pct=saved.progress?.percentage||0;
    const bar=card.querySelector('.book-progress span');
    if(bar)bar.style.width=pct+'%';
    const sub=card.querySelector('.book-sub');
    if(sub&&sub.children.length>=2){
      sub.children[0].textContent=pct+'%';
      sub.children[1].textContent=this.audioSubText(saved);
    }
  }

async shareBook(book){
  if(!book)return;
  if(!BookFormats.canShare(book.format)){
    await AppModal.alert({
      title:'Compartilhamento indisponível',
      subtitle:'Formato protegido',
      message:AudioFormats.isAudioBook(book)
        ?'Audiolivros e vídeos ficam guardados somente no seu aparelho e não podem ser compartilhados por este aplicativo.'
        :BookFormats.isComic(book.format)
        ?'Quadrinhos ficam guardados somente no seu aparelho e não podem ser compartilhados por este aplicativo.'
        :'Para manter a política de compartilhamento da biblioteca, arquivos EPUB e MOBI não podem ser compartilhados por este aplicativo.',
      confirmText:'Entendi',
      confirmIcon:'lock'
    });
    return;
  }
  try{
    const rec=await this.db.getFile(book.id);
    if(!rec?.buffer)throw new Error('A cópia deste livro não está disponível na biblioteca.');
    const mime=BookFormats.mime(book.format);
    const safeTitle=(book.title||'livro').replace(/[\\/:*?"<>|]+/g,'-').trim()||'livro';
    const name=book.sourceFileName||`${safeTitle}.${book.format}`;
    const file=new File([rec.buffer],name,{type:mime});

    if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({
        title:book.title||'Livro',
        text:`${book.title||'Livro'} — ${book.author||'Autor desconhecido'}`,
        files:[file]
      });
      Utils.toast('Livro compartilhado.','share-2');
      return;
    }

    // Browser/device sem compartilhamento de arquivos: preserva a intenção do usuário
    // oferecendo o arquivo pronto para compartilhar manualmente.
    const url=URL.createObjectURL(file);
    const a=document.createElement('a');
    a.href=url;
    a.download=name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    Utils.toast('O arquivo foi preparado para você compartilhar em outro aplicativo.','download');
  }catch(err){
    if(err?.name==='AbortError')return;
    console.error(err);
    Utils.toast(err?.message||'Não foi possível compartilhar o livro.','alert-triangle');
  }
}

async convertPdf(book){
  if(!book || book.format!=='pdf')return;

  const accepted=await ConversionDialog.open(book);
  if(!accepted)return;

  ConversionDialog.showWorking();
  Utils.showLoader('Convertendo PDF','Reconstruindo o livro localmente.',{progress:true});

  try{
    const rec=await this.db.getFile(book.id);
    if(!rec?.buffer)throw new Error('A cópia do PDF não está disponível na biblioteca.');

    const sourceName=book.sourceFileName || `${book.title||'livro'}.pdf`;
    const sourceFile=new File([rec.buffer],sourceName,{type:'application/pdf'});
    const result=await VeredasPDFToEPUB.convert(sourceFile,{
      title:book.title||sourceName.replace(/\.pdf$/i,''),
      author:book.author||'',
      lang:'pt-BR',
      publisher:'Veredas Reader',
      onProgress:({percent,message})=>{
        Utils.setLoaderProgress(percent,message);
        ConversionDialog.updateProgress(percent,message);
      }
    });

    Utils.setLoaderProgress(98,'Preparando salvamento…');
    ConversionDialog.updateProgress(98,'Preparando salvamento…');
    Utils.hideLoader();

    const saveResult=await this.saveConvertedEpub(result,book);
    if(!saveResult?.saved){
      ConversionDialog.close(false);
      Utils.toast('Conversão cancelada. O PDF original permanece na biblioteca.','info');
      return;
    }

    const epubMeta={
      ...Utils.normalizeBook({
        id:Utils.id(),
        title:result.meta?.title||book.title,
        author:result.meta?.author||book.author||'Autor Desconhecido',
        format:'epub',
        addedAt:Date.now(),
        cover:result.coverDataUrl||book.cover||null,
        progress:null,
        totalPages:result.stats?.contentPages||result.stats?.pdfPages||0,
        status:book.status||'toread',
        favorite:!!book.favorite,
        tags:Array.isArray(book.tags)?[...book.tags]:[],
        collections:Array.isArray(book.collections)?[...book.collections]:[],
        series:book.series||'',
        folder:book.folder||'',
        bookmarks:[],
        annotations:[],
        order:Number.isFinite(book.order)?book.order:Date.now(),
        manualOrder:!!book.manualOrder,
        convertedFromPdf:true,
        convertedFromBookId:book.id,
        convertedAt:Date.now(),
        sourceFileName:saveResult.outputName,
        sourceDirectoryHandle:null,
        conversionStats:result.stats||null
      })
    };

    // A biblioteca sempre guarda sua própria cópia do EPUB, independente de onde
    // o usuário escolheu salvar o arquivo externo.
    await this.db.saveBook(epubMeta,result.buffer);
    await this.db.deleteBook(book.id);
    await this.db.clearBookCache(book.id);
    if(App.reader.currentBook?.id===book.id)App.reader.close();

    await this.render();
    ConversionDialog.showSuccess(result,{message:saveResult.message});
    const learnNow=await new Promise(resolve=>{
      const c=ConversionDialog.confirm, x=ConversionDialog.cancel;
      const onC=()=>{cleanup();resolve(true)};
      const onX=()=>{cleanup();resolve(false)};
      const cleanup=()=>{c.removeEventListener('click',onC);x.removeEventListener('click',onX)};
      c.addEventListener('click',onC,{once:true});
      x.addEventListener('click',onX,{once:true});
    });
    ConversionDialog.close(false);
    if(learnNow)await App.reader.openBook(epubMeta);
  }catch(err){
    console.error(err);
    ConversionDialog.close(false);
    if(err?.name==='NotAllowedError'){
      Utils.toast('A permissão para salvar o arquivo foi cancelada. Nenhum item da biblioteca foi alterado.','info');
    }else{
      Utils.toast(`Falha ao converter o PDF: ${err.message||'erro desconhecido'}`,'alert-circle');
    }
  }finally{
    Utils.hideLoader();
  }
}

async saveConvertedEpub(result,book){
  const outputName=this.suggestEpubName(result,book);
  const pickFile=async()=>{
    if(typeof window.showSaveFilePicker!=='function')return null;
    const handle=await window.showSaveFilePicker({
      suggestedName:outputName,
      types:[{description:'Livro EPUB',accept:{'application/epub+zip':['.epub']}}],
      excludeAcceptAllOption:false
    });
    const writable=await handle.createWritable();
    try{await writable.write(result.blob)}finally{await writable.close()}
    return handle.name||outputName;
  };

  // Primeiro caminho: salvamento explícito em qualquer pasta/arquivo escolhido.
  if(typeof window.showSaveFilePicker==='function'){
    ConversionDialog.title.textContent='Salvar EPUB';
    ConversionDialog.subtitle.textContent='Escolha livremente onde o arquivo será gravado.';
    ConversionDialog.body.innerHTML=`
      <p>O EPUB já foi convertido. Agora você pode escolher <strong>qualquer pasta do computador</strong> para salvar o arquivo.</p>
      <div class="conversion-warning">
        <i data-lucide="folder-open"></i>
        <div><strong>O PDF original não precisa estar nessa pasta</strong><div>A gravação é independente da localização do PDF e não altera o arquivo original.</div></div>
      </div>`;
    ConversionDialog.footer.style.display='flex';
    ConversionDialog.confirm.innerHTML='<i data-lucide="save"></i>Escolher local';
    ConversionDialog.cancel.textContent='Baixar automaticamente';
    ConversionDialog.confirm.disabled=false;ConversionDialog.cancel.disabled=false;
    lucide.createIcons({root:ConversionDialog.el});

    const choice=await new Promise(resolve=>{
      const c=ConversionDialog.confirm,x=ConversionDialog.cancel;
      const onC=()=>{cleanup();resolve('picker')};
      const onX=()=>{cleanup();resolve('download')};
      const onClose=()=>{cleanup();resolve(false)};
      const cleanup=()=>{c.removeEventListener('click',onC);x.removeEventListener('click',onX);ConversionDialog.closeBtn?.removeEventListener('click',onClose)};
      c.addEventListener('click',onC,{once:true});x.addEventListener('click',onX,{once:true});ConversionDialog.closeBtn?.addEventListener('click',onClose,{once:true});
    });
    if(choice==='picker'){
      try{
        const fileName=await pickFile();
        return {saved:true,outputName:fileName,message:`EPUB salvo em ${fileName}.`};
      }catch(err){
        if(err?.name==='AbortError')return {saved:false};
        throw err;
      }
    }
    if(choice==='download')return this.downloadConvertedEpub(result,outputName);
    return {saved:false};
  }

  return this.downloadConvertedEpub(result,outputName);
}

suggestEpubName(result,book){
  const raw=result?.filename || `${result?.meta?.title||book?.title||'livro'}.epub`;
  const clean=raw.replace(/[\\/:*?"<>|]+/g,'-').trim();
  return /\.epub$/i.test(clean)?clean:`${clean||'livro'}.epub`;
}

downloadConvertedEpub(result,outputName){
  const url=URL.createObjectURL(result.blob);
  const a=document.createElement('a');a.href=url;a.download=outputName;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  return {saved:true,outputName,message:`EPUB baixado como ${outputName}.`};
}

  /* Grava a ordem que está na tela. Se a estante estava agrupada,
     mover um livro é um pedido claro de ordem própria: o modo passa
     para Minha Ordem sozinho, sem perder a sequência que o usuário
     acabou de ver. */
  async commitManualOrder(){
    const ids=Array.from(document.querySelectorAll('#library-content .book-card'))
      .map(el=>el.dataset.id).filter(Boolean);
    if(!ids.length)return;
    const byId=new Map(this.allBooks.map(b=>[b.id,b]));
    const visible=new Set(ids);
    const previous=this.sortedBooks([...this.allBooks]);
    let cursor=0;
    const merged=previous.map(b=>visible.has(b.id)?(byId.get(ids[cursor++])||b):b);
    const changed=[];
    merged.forEach((b,index)=>{
      if(b.order!==index||!b.manualOrder){b.order=index;b.manualOrder=true;changed.push(b)}
    });
    try{
      for(const b of changed)await this.db.patchBook(b.id,{order:b.order,manualOrder:true});
    }catch(e){
      console.error(e);
      Utils.toast('Não foi possível salvar a nova ordem.','alert-triangle');
      await this.render();
      return;
    }
    const wasCustom=(App.state.settings.sort||'custom')==='custom';
    App.state.settings.sort='custom';
    App.state.settings.groupAuthors=false;
    await App.persistSettings();
    if(wasCustom){
      if(changed.length)Utils.toast('Nova ordem salva.','check');
      this.updateShelfHint();
    }else{
      Utils.toast('Agrupamento alterado para Minha Ordem.','arrow-down-up');
      await this.render();
    }
  }
  updateShelfHint(){
    const sub=document.getElementById('section-subtitle');
    if(sub&&!this.search)sub.textContent='Ordem manual da sua estante.';
    const hint=document.getElementById('shelf-reorder-hint');
    if(hint)hint.remove();
  }
  async reorder(a,b){
    const ordered=this.sortedBooks([...this.allBooks]).filter(x=>x.id!==a.id);
    const idx=Math.max(0,ordered.findIndex(x=>x.id===b.id));
    ordered.splice(idx,0,a);
    ordered.forEach((x,i)=>{x.order=i;x.manualOrder=true});
    for(const x of ordered)await this.db.patchBook(x.id,{order:x.order,manualOrder:true});
    App.state.settings.sort='custom';
    App.state.settings.groupAuthors=false;
    await App.persistSettings();
    Utils.toast('Ordem personalizada salva.','move');
    await this.render();
  }
  async deleteBook(book){
    const ok=await AppModal.confirm({
      title:'Excluir livro?',
      subtitle:book.title||'Livro',
      message:'Isso remove apenas a cópia armazenada pela biblioteca, além do progresso, marcadores e anotações. O arquivo original da pasta do usuário não será apagado.',
      confirmText:'Excluir livro',confirmIcon:'trash-2',danger:true
    });
    if(!ok)return;
    try{
      if(App.reader.currentBook?.id===book.id)App.reader.close();
      if(App.player?.book?.id===book.id)await App.player.close();
      await this.db.deleteBook(book.id);
      await this.db.clearBookCache(book.id);
      Utils.toast('Livro excluído da biblioteca.','trash-2');
      await this.render();
    }catch(e){
      console.error(e);
      Utils.toast('Não foi possível excluir o livro.','alert-triangle');
    }
  }
  renderBookmarks(container){
    const items=[];
    this.allBooks.forEach(b=>b.bookmarks.forEach(m=>items.push({book:b,m})));
    items.sort((a,b)=>(b.m.addedAt||0)-(a.m.addedAt||0));
    if(!items.length){
      container.innerHTML=`<div class="empty"><i data-lucide="bookmark"></i><h3>Nenhum marcador ainda</h3><p>No leitor, toque no ícone de marcador para salvar a página.</p></div>`;
      lucide.createIcons({root:container});
      return;
    }
    items.forEach(({book,m})=>{
      const isAudioBm=m.kind==='audio';
      const isVideoBm=isAudioBm&&AudioFormats.isVideoBook(book);
      const c=document.createElement('div');
      c.className='bookmark-card';
      c.innerHTML=`
        <div class="item-head">
          <div class="item-type">Marcador</div>
          <i data-lucide="${isVideoBm?'film':isAudioBm?'headphones':'bookmark'}" class="bookmark-icon" style="width:16px;height:16px"></i>
        </div>
        <div class="item-text">${Utils.esc(isAudioBm?(m.title||m.chapter||(isVideoBm?'Marcador de vídeo':'Marcador de áudio')):(m.title||'Página salva'))}</div>
        <div class="item-meta">${Utils.esc(book.title)} · ${isAudioBm?`${isVideoBm?'assistir':'ouvir'} a partir de ${AudioFmt.clock(m.time)}`:`página ${(m.globalPage??m.pageIndex??0)+1}`}${!isAudioBm&&m.preview?' · '+Utils.esc(m.preview.slice(0,80)):''}</div>
        <div class="item-actions">
           <button class="action-btn delete-btn" title="Excluir"><i data-lucide="trash"></i></button>
        </div>`;
      
      c.onclick=()=>isAudioBm
        ?App.player.open(book,{startAt:m.time,autoplay:true})
        :App.reader.openBook({...book,progress:{...(book.progress||{}),globalPage:m.globalPage??0}});
      
      c.querySelector('.delete-btn').onclick = async (e) => {
        e.stopPropagation();
        if(await AppModal.confirm({title:'Excluir marcador?',message:'O marcador será removido da biblioteca, mas o arquivo do livro permanecerá intacto.',confirmText:'Excluir marcador',confirmIcon:'trash',danger:true})) {
           await App.db.deleteBookmark(book.id, m.id);
           Utils.toast('Marcador excluído.', 'trash');
           this.render();
        }
      };
      
      container.appendChild(c);
    });
    lucide.createIcons({root:container});
  }
  renderAnnotationsList(container,type){
    const items=[];
    this.allBooks.forEach(b=>b.annotations.filter(a=>a.type===type).forEach(a=>items.push({book:b,a})));
    items.sort((a,b)=>(b.a.createdAt||0)-(a.a.createdAt||0));
    if(!items.length){
      const isNote=type==='note';
      container.innerHTML=`<div class="empty"><i data-lucide="${isNote?'sticky-note':'quote'}"></i><h3>Nenhum registro ainda</h3><p>Selecione um trecho durante a leitura para criar ${isNote?'uma anotação':'uma citação'}.</p></div>`;
      lucide.createIcons({root:container});
      return;
    }
    items.forEach(({book,a})=>{
      const isNote=type==='note';
      const c=document.createElement('div');
      c.className='annotation-card';
      c.innerHTML=`
        <div class="item-head">
          <div class="item-type">${isNote?'Anotação':'Citação'}</div>
          <i data-lucide="${isNote?'sticky-note':'quote'}" style="width:16px;height:16px;color:var(--accent)"></i>
        </div>
        <div class="item-text">“${Utils.esc(a.text)}”</div>
        ${a.note?`<div class="item-note">${Utils.esc(a.note)}</div>`:''}
        <div class="item-meta">${Utils.esc(book.title)} · página ${(a.pageIndex||0)+1}</div>
        <div class="item-actions">
           ${isNote ? `<button class="action-btn edit-btn" title="Editar"><i data-lucide="edit-3"></i></button>` : ''}
           <button class="action-btn delete-btn" title="Excluir"><i data-lucide="trash"></i></button>
        </div>`;
      
      c.onclick=()=>App.reader.openBook({...book,progress:{...(book.progress||{}),globalPage:a.pageIndex||0}});
      
      c.querySelector('.delete-btn').onclick = async (e) => {
        e.stopPropagation();
        if(await AppModal.confirm({title:`Excluir ${isNote ? 'anotação' : 'citação'}?`,message:'Este registro será removido permanentemente da biblioteca.',confirmText:`Excluir ${isNote ? 'anotação' : 'citação'}`,confirmIcon:'trash',danger:true})) {
           await App.db.deleteAnnotation(book.id, a.id);
           Utils.toast('Item excluído.', 'trash');
           this.render();
        }
      };

      if(isNote) {
         c.querySelector('.edit-btn').onclick = (e) => {
            e.stopPropagation();
            document.getElementById('selected-preview').innerHTML = 
                `<div class="item-type">Trecho original</div><div class="item-text">“${Utils.esc(a.text)}”</div><div class="item-meta">Página ${(a.pageIndex||0)+1}</div>`;
            document.getElementById('note-text').value = a.note;
            document.getElementById('btn-save-note').dataset.editId = a.id;
            document.getElementById('btn-save-note').dataset.bookId = book.id;
            App.openPanel('panel-note');
         };
      }
      
      container.appendChild(c);
    });
    lucide.createIcons({root:container});
  }
  openOrganizer(book){
    if(!book){
      if(!this.allBooks.length)return Utils.toast('Importe um livro primeiro.','book-open');
      book=this.allBooks[0];
    }
    this.selectedBookId=book.id;
    const tags=book.tags.join(', ');
    const cols=book.collections.join(', ');
    document.getElementById('organize-body').innerHTML=`
      <div class="form-grid">
        <div class="form-group"><label class="form-label" for="org-title">Nome do livro</label>
          <input class="field" id="org-title" placeholder="Nome do livro" value="${Utils.esc(book.title||'')}">
        </div>
        <div class="form-group"><label class="form-label" for="org-author">Autor</label>
          <input class="field" id="org-author" placeholder="Nome do autor" value="${Utils.esc(book.author||'')}">
        </div>
        <div class="form-group"><label class="form-label">Status</label>
          <select class="field" id="org-status">
            <option value="reading">Lendo</option>
            <option value="read">Lido</option>
            <option value="toread">Para ler</option>
            <option value="paused">Pausado</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Favorito</label>
          <label class="toggle-row"><span class="toggle-label"><strong>Favorito</strong><small>Aparece em Favoritos.</small></span><span class="toggle"><input type="checkbox" id="org-fav"><span></span></span></label>
        </div>
        <div class="form-group"><label class="form-label">Série</label>
          <input class="field" id="org-series" placeholder="Ex.: Trilogia..." value="${Utils.esc(book.series)}">
        </div>
        <div class="form-group"><label class="form-label">Pasta / estante</label>
          <input class="field" id="org-folder" placeholder="Ex.: Estudos, Ficção..." value="${Utils.esc(book.folder)}">
        </div>
        <div class="form-group full"><label class="form-label">Coleções</label>
          <input class="field" id="org-cols" placeholder="Separe por vírgulas" value="${Utils.esc(cols)}">
        </div>
        <div class="form-group full"><label class="form-label">Tags</label>
          <input class="field" id="org-tags" placeholder="Separe por vírgulas" value="${Utils.esc(tags)}">
        </div>
      </div>
      <div class="drag-tip">Arraste um livro para outra posição na estante para salvar uma ordem manual. A ordem manual passa a ter prioridade sobre o agrupamento por autor.</div>`;
    document.getElementById('org-status').value=book.status;
    document.getElementById('org-fav').checked=book.favorite;
    App.openPanel('panel-organize');
  }
  async saveOrganizer(){
    const book=this.allBooks.find(b=>b.id===this.selectedBookId);
    if(!book)return;
    const titleField=document.getElementById('org-title');
    const authorField=document.getElementById('org-author');
    const newTitle=titleField?.value.trim()||'';
    const newAuthor=authorField?.value.trim()||'';
    if(!newTitle){
      await AppModal.alert({title:'Nome do livro obrigatório',subtitle:'Organizar livro',message:'Informe um nome para o livro antes de salvar.',confirmText:'Entendi'});
      titleField?.focus();
      return;
    }
    book.title=newTitle;
    book.author=newAuthor||'Autor Desconhecido';
    book.status=document.getElementById('org-status').value;
    book.favorite=document.getElementById('org-fav').checked;
    book.series=document.getElementById('org-series').value.trim();
    book.folder=document.getElementById('org-folder').value.trim();
    book.collections=document.getElementById('org-cols').value.split(',').map(s=>s.trim()).filter(Boolean);
    book.tags=document.getElementById('org-tags').value.split(',').map(s=>s.trim()).filter(Boolean);
    /* só os campos desta tela: o progresso do audiolivro em andamento fica intacto */
    await this.db.patchBook(book.id,{
      title:book.title,author:book.author,status:book.status,favorite:book.favorite,
      series:book.series,folder:book.folder,collections:book.collections,tags:book.tags
    });
    App.player?.syncMeta(book);
    App.closePanels();
    Utils.toast('Organização salva.','check');
    await this.render();
  }
  openDimensionPanel(type){
    const body=document.getElementById('filter-panel-body');
    const title=document.getElementById('filter-panel-title');
    const keyMap={collections:'collections',series:'series',authors:'author',tags:'tags'};
    title.textContent={collections:'Coleções',series:'Séries',authors:'Autores',tags:'Tags'}[type];
    const key=keyMap[type];
    const vals=new Map();
    this.allBooks.forEach(b=>{
      const v=Array.isArray(b[key])?b[key]:[b[key]];
      v.filter(Boolean).forEach(x=>vals.set(x,(vals.get(x)||0)+1));
    });
    body.innerHTML='';
    if(!vals.size){
      body.innerHTML=`<div class="empty"><h3>Ainda não há itens</h3><p>Use “Organizar” em um livro para criar ${title.textContent.toLowerCase()}.</p></div>`;
      App.openPanel('panel-library-filter');
      return;
    }
    Array.from(vals.entries()).sort((a,b)=>a[0].localeCompare(b[0],'pt')).forEach(([v,count])=>{
      const btn=document.createElement('button');
      btn.className='nav-item';btn.style.width='100%';
      btn.innerHTML=`<i data-lucide="${type==='authors'?'user':type==='tags'?'tag':'layers-3'}" style="width:17px;height:17px"></i><span style="flex:1;text-align:left">${Utils.esc(v)}</span><span class="count">${count}</span>`;
      btn.onclick=()=>{
        this.search=v.toLowerCase();
        document.getElementById('library-search-input').value=v;
        this.currentFilter='all';
        document.querySelectorAll('#library-nav .nav-item').forEach(x=>x.classList.toggle('active',x.dataset.filter==='all'));
        App.syncBottomNav();
        App.closePanels();
        this.renderView();
      };
      body.appendChild(btn);
    });
    lucide.createIcons({root:body});
    App.openPanel('panel-library-filter');
  }
  setupImport(){
    document.getElementById('file-input').addEventListener('change',async e=>{
      const files=Array.from(e.target.files||[]);
      e.target.value='';
      if(files.length)await this.importFiles(files);
    });
  }

  /* ------------------------------------------------------------
     IMPORTACAO
     O botao + abre o seletor ja na pasta Downloads quando o
     navegador permite; a pasta usada por ultimo passa a ser a
     sugestao seguinte.
     ------------------------------------------------------------ */
  async openImport(){
    if(typeof window.showOpenFilePicker==='function'){
      try{
        const handles=await window.showOpenFilePicker({
          id:'veredas-import',
          startIn:'downloads',
          multiple:true,
          excludeAcceptAllOption:false,
          types:[{
            description:'Livros, quadrinhos, documentos, audiolivros e vídeos',
            accept:{
              'application/epub+zip':['.epub'],
              'application/x-mobipocket-ebook':['.mobi','.prc'],
              'application/pdf':['.pdf'],
              'text/plain':['.txt'],
              'text/markdown':['.md','.markdown'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx'],
              'application/vnd.comicbook+zip':['.cbz'],
              'application/vnd.comicbook-rar':['.cbr'],
              'application/x-cb7':['.cb7','.cbt'],
              'audio/mpeg':['.mp3'],
              'audio/mp4':['.m4b'],
              'video/mp4':['.mp4']
            }
          }]
        });
        const files=[];
        for(const handle of handles){
          try{files.push(await handle.getFile())}catch(err){console.warn(err)}
        }
        if(files.length)await this.importFiles(files);
        return;
      }catch(err){
        if(err&&err.name==='AbortError')return;
        console.warn('Seletor avançado indisponível; usando o seletor padrão.',err);
      }
    }
    const input=document.getElementById('file-input');
    input.value='';
    input.click();
  }

  async importFiles(files,{batch=false}={}){
    let arquivos=Array.from(files||[]).filter(Boolean);
    if(!arquivos.length)return;
    /* Vários MP3 escolhidos juntos costumam ser capítulos de um mesmo audiolivro. */
    const grupos=[];
    const mp3=arquivos.filter(f=>AudioFormats.ext(f.name)==='mp3');
    if(mp3.length>=2){
      const decisao=await this.decideAudioGroup(mp3);
      if(decisao.action!=='separate'){
        arquivos=arquivos.filter(f=>!mp3.includes(f));
        if(decisao.action==='group')grupos.push(decisao);
      }
    }
    if(!arquivos.length&&!grupos.length)return;
    if(!batch&&arquivos.length===1&&!grupos.length)return this.importSingle(arquivos[0]);
    if(!batch&&!arquivos.length&&grupos.length===1)return this.importSingle(null,grupos[0]);
    const list=[
      ...grupos.map(g=>({group:g,name:g.title||'Audiolivro'})),
      ...arquivos.map(f=>({file:f,name:f.name}))
    ];

    let importados=0,repetidos=0,falhas=0,cancelado=false;
    const erros=[];
    const ctrl=new AbortController();
    Utils.showLoader('Importando livros',`0 de ${list.length}`,{progress:true,onCancel:()=>ctrl.abort()});
    try{
      for(let i=0;i<list.length;i++){
        if(ctrl.signal.aborted){cancelado=true;break}
        const job=list[i];
        Utils.setLoaderProgress(Math.round((i/list.length)*100),`${i} de ${list.length} · ${job.name}`);
        await Utils.yieldToUI();
        /* Progresso de cada arquivo na legenda; a barra continua contando o lote. */
        const meter=job.file?new TransferMeter(job.file.name,job.file.size,{mode:'text',prefix:`${i+1}/${list.length} · `}):null;
        const result=job.group
          ?await this.importAudioGroup(job.group,{quiet:true})
          :await this.importFile(job.file,{quiet:true,meter,signal:ctrl.signal});
        if(result.status==='cancelled'){cancelado=true;break}
        if(result.status==='ok')importados++;
        else if(result.status==='duplicate')repetidos++;
        else{falhas++;erros.push(`${job.name}: ${result.message||'não foi possível ler o arquivo'}`)}
      }
      if(!cancelado)Utils.setLoaderProgress(100,'Finalizando…');
    }finally{
      Utils.hideLoader();
    }

    await this.render();
    const linhas=[
      `${importados} livro(s) adicionado(s) à estante.`,
      repetidos?`${repetidos} já estavam na biblioteca e foram ignorados.`:'',
      falhas?`${falhas} arquivo(s) não puderam ser lidos.`:'',
      cancelado?'A importação foi interrompida; o que já tinha entrado continua na estante.':''
    ].filter(Boolean);
    if(erros.length)console.warn('Falhas na importação:',erros);
    await AppModal.alert({
      title:cancelado?'Importação interrompida':'Importação concluída',
      subtitle:`${list.length} arquivo(s) processado(s)`,
      message:linhas.join('\n'),
      icon:importados?'library-big':'info',
      confirmText:'Ver estante'
    });
  }

  async importSingle(file,group=null){
    const ctrl=new AbortController();
    const meter=file?new TransferMeter(file.name,file.size,{mode:'bar'}):null;
    Utils.showLoader(
      group?'Importando audiolivro':'Preparando o arquivo',
      group?`${group.plan.files.length} arquivos de áudio...`:file.name,
      {progress:!group,onCancel:group?null:()=>ctrl.abort()}
    );
    let result;
    try{
      result=group
        ?await this.importAudioGroup(group)
        :await this.importFile(file,{meter,signal:ctrl.signal});
    }finally{
      Utils.hideLoader();
    }

    if(result.status==='cancelled'){
      Utils.toast('Importação cancelada.','x');
      return;
    }

    if(result.status==='ok'){
      const v=AudioFormats.isVideoBook(result.book);
      Utils.toast(v?'Vídeo importado e salvo no dispositivo.'
        :AudioFormats.isAudioBook(result.book)?'Audiolivro importado e salvo no dispositivo.'
        :BookFormats.isComic(result.book.format)?'Quadrinho importado e salvo no dispositivo.'
        :'Livro importado e salvo no dispositivo.','check');
      await this.render();
      return;
    }

    if(result.status==='duplicate'){
      const book=result.book||{};
      const titulo=book.title||(file?file.name:(group&&group.title)||'Audiolivro');
      if(result.exact){
        await AppModal.alert({
          title:'Este livro já está na estante',
          subtitle:titulo,
          message:`“${titulo}” já foi importado antes e continua disponível na sua biblioteca. Nenhuma cópia nova foi criada.`,
          icon:'library-big',
          confirmText:'Entendi'
        });
        return;
      }
      const seguir=await AppModal.confirm({
        title:'Parece que este livro já está na estante',
        subtitle:titulo,
        message:`Você já tem “${titulo}”${book.author?` de ${book.author}`:''} na biblioteca, embora o arquivo seja diferente. Deseja importar mesmo assim?`,
        confirmText:'Importar mesmo assim',
        confirmIcon:'plus'
      });
      if(!seguir)return;
      Utils.showLoader('Importando livro','Salvando na sua estante...');
      try{
        if(result.pending.comicBlob)await this.db.saveComicBook(result.pending.meta,result.pending.comicBlob);
        else if(result.pending.blobs)await AudioImport.save(this.db,result.pending.meta,result.pending.blobs);
        else await this.db.saveBook(result.pending.meta,result.pending.buffer);
        Utils.toast(result.pending.comicBlob?'Quadrinho importado e salvo no dispositivo.'
          :result.pending.blobs?'Audiolivro importado e salvo no dispositivo.'
          :'Livro importado e salvo no dispositivo.','check');
        await this.render();
      }catch(err){
        console.error(err);
        Utils.toast(err instanceof ParseError?err.message:'Falha ao salvar o livro na biblioteca.','alert-circle');
      }finally{
        Utils.hideLoader();
      }
      return;
    }

    if(result.error instanceof ParseError){
      Utils.toast(result.error.message,'alert-circle');
      if(result.error.hint)setTimeout(()=>Utils.toast(result.error.hint,'info'),900);
    }else{
      Utils.toast(result.message||'Falha ao processar o arquivo.','alert-circle');
    }
  }

  /* Le o arquivo, confere se ele ja existe na estante e so entao salva. */
  async importFile(file,{quiet=false,meter=null,signal=null}={}){
    const ext=BookFormats.normalize(file.name);
    if(AudioFormats.has(ext))return this.importAudioFile(file,{quiet,meter,signal});
    if(BookFormats.isComic(ext))return this.importComicFile(file,{quiet,meter,signal});
    if(!BookFormats.TEXT.includes(ext)){
      if(!quiet)Utils.toast('Formato não suportado.','alert-triangle');
      return {status:'error',message:'Formato não suportado.'};
    }

    let buffer;
    try{
      /* Leitura em pedaços: é aqui que um arquivo vindo do Google Drive
         realmente é baixado, e é isso que a barra de progresso mostra. */
      buffer=await FileTransfer.toBuffer(file,{onProgress:meter?meter.handler():null,signal});
      meter?.finish();
    }catch(err){
      if(Utils.isAbort(err))return {status:'cancelled'};
      console.error(err);
      return {status:'error',message:'Não foi possível ler o arquivo.',error:err};
    }

    const fileHash=await FileFingerprint.hash(buffer);
    const identico=await this.findByHash(fileHash,buffer.byteLength);
    if(identico)return {status:'duplicate',book:identico,exact:true};

    const meta={
      id:Utils.id(),
      title:file.name.replace(/\.[^/.]+$/,''),
      author:'Autor Desconhecido',
      format:ext,
      sourceFileName:file.name,
      addedAt:Date.now(),
      cover:null,progress:null,status:'toread',favorite:false,
      tags:[],collections:[],series:'',folder:'',bookmarks:[],annotations:[],
      order:Date.now(),manualOrder:false,
      fileHash,fileSize:buffer.byteLength
    };

    try{
      if(ext==='epub'){
        const parsed=await EPUBParser.parse(buffer);
        meta.title=parsed.metadata.title;
        meta.author=parsed.metadata.author;
        meta.cover=parsed.metadata.cover;
      }else if(ext==='pdf'){
        try{
          const{pdf}=await PDFParser.parse(buffer.slice(0));
          const t=await PDFParser.getTitle(pdf);
          if(t)meta.title=t;
          meta.cover=await PDFParser.renderPageToDataURL(pdf,1,300,450,.7);
          meta.totalPages=pdf.numPages;
          pdf.destroy();
        }catch(err){console.warn(err)}
      }else if(ext==='mobi'){
        if(!MobiFile.isMobi(buffer)){
          throw new ParseError('Este arquivo não é um MOBI válido.','Confira se a extensão corresponde ao conteúdo ou converta o livro para EPUB.');
        }
        const info=MOBIParser.metadata(buffer);
        if(info){
          if(info.drm){
            throw new ParseError('Este arquivo está protegido por DRM.','Livros com proteção da Amazon não podem ser abertos aqui. Use uma cópia sem DRM ou converta o livro para EPUB.');
          }
          if(info.title)meta.title=info.title;
          if(info.author)meta.author=info.author;
          if(info.cover)meta.cover=info.cover;
        }
      }else if(ext==='docx'){
        const head=new Uint8Array(buffer,0,Math.min(4,buffer.byteLength));
        if(!(head[0]===0x50&&head[1]===0x4B)){
          throw new ParseError('Este arquivo não é um .docx válido.','Se for um .doc antigo, abra no Word e salve como .docx antes de importar.');
        }
      }else if(ext==='md'){
        /* O primeiro "# Título" do arquivo costuma ser o nome do livro. */
        try{
          const titulo=MDParser.guessTitle(MDParser.decode(buffer));
          if(titulo)meta.title=titulo;
        }catch(e){console.warn(e)}
      }
    }catch(err){
      console.error(err);
      return {status:'error',message:err?.message||'Falha ao processar o arquivo.',error:err};
    }

    const parecido=this.findSimilar(meta);
    if(parecido)return {status:'duplicate',book:parecido,exact:false,pending:{meta,buffer}};

    try{
      await this.db.saveBook(meta,buffer);
    }catch(err){
      console.error(err);
      return {status:'error',message:'Não foi possível salvar o livro na biblioteca.',error:err};
    }
    /* Mantem a lista em memoria atualizada para que dois arquivos iguais
       dentro da mesma importacao em lote nao entrem duas vezes. */
    this.allBooks.push(Utils.normalizeBook(meta));
    return {status:'ok',book:meta};
  }

  /* ------------------------------------------------------------
     QUADRINHOS
     O arquivo é guardado como Blob (igual ao audiolivro): um CBZ de
     300 MB não pode virar ArrayBuffer na memória a cada abertura.
     Da importação sai só o essencial para a estante — capa, título,
     autor e número de páginas — lendo apenas a primeira imagem.
     ------------------------------------------------------------ */
  async importComicFile(file,{quiet=false,meter=null,signal=null}={}){
    const ext=BookFormats.normalize(file.name);
    let construido=null;
    try{
      let arquivo=file;
      /* Igual ao audiolivro: se o arquivo ainda está na nuvem, ele é
         trazido de uma vez, com barra de progresso. */
      if(file.size<=FileTransfer.MAX_LOCAL_COPY&&await FileTransfer.looksRemote(file)){
        arquivo=await FileTransfer.localCopy(file,{onProgress:meter?meter.handler():null,signal});
        meter?.finish();
      }
      if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
      const impressao=await FileFingerprint.hashBlob(arquivo);
      const identico=await this.findByHash(impressao,arquivo.size);
      if(identico)return {status:'duplicate',book:identico,exact:true};
      Utils.setLoaderText(null,'Lendo o quadrinho...');
      const pacote=await ComicArchive.open(arquivo,{
        name:file.name,coverOnly:true,signal,
        onStatus:texto=>Utils.setLoaderText(null,texto)
      });
      let capa=null;
      try{capa=await pacote.coverDataURL()}catch(e){console.warn(e)}
      const info=pacote.info;
      const paginas=pacote.length;
      pacote.close();
      const base=file.name.replace(/\.[^/.]+$/,'');
      construido={
        blob:arquivo,
        meta:{
          id:Utils.id(),
          title:ComicSupport.buildTitle(info,base)||base,
          author:(info&&info.author)||'Autor Desconhecido',
          format:ext,
          sourceFileName:file.name,
          addedAt:Date.now(),
          cover:capa,progress:null,status:'toread',favorite:false,
          tags:[],collections:[],series:(info&&info.series)||'',folder:'',
          bookmarks:[],annotations:[],
          order:Date.now(),manualOrder:false,
          fileHash:impressao,fileSize:arquivo.size,
          totalPages:paginas,
          comicRtl:!!(info&&info.rtl)
        }
      };
    }catch(err){
      if(Utils.isAbort(err))return {status:'cancelled'};
      console.error(err);
      return {status:'error',message:err?.message||'Falha ao processar o quadrinho.',error:err};
    }
    const parecido=this.findSimilar(construido.meta);
    if(parecido)return {status:'duplicate',book:parecido,exact:false,
      pending:{meta:construido.meta,comicBlob:construido.blob}};
    return this.saveComicResult(construido);
  }
  async saveComicResult({meta,blob}){
    try{
      Utils.setLoaderText('Salvando na sua estante','Quadrinhos grandes podem levar alguns instantes...');
      await this.db.saveComicBook(meta,blob);
    }catch(err){
      console.error(err);
      return {status:'error',message:err?.message||'Não foi possível salvar o quadrinho.',error:err};
    }
    this.allBooks.push(Utils.normalizeBook(meta));
    return {status:'ok',book:meta};
  }

  /* ------------------------------------------------------------
     AUDIOLIVROS
     Nunca carregam o arquivo inteiro na memória: a assinatura, os
     metadados e a verificação de reprodução leem só pequenas fatias.
     ------------------------------------------------------------ */
  async importAudioFile(file,{quiet=false,meter=null,signal=null}={}){
    let built;
    try{
      /* Áudio e vídeo são guardados como Blob e lidos por fatias. Isso é
         ótimo para um arquivo que já está no aparelho e péssimo para um
         que ainda está na nuvem: cada fatia viraria um download novo.
         Por isso, quando o arquivo parece remoto, ele é trazido de uma
         vez — com barra de progresso — antes de qualquer outra coisa. */
      if(file.size<=FileTransfer.MAX_LOCAL_COPY&&await FileTransfer.looksRemote(file)){
        file=await FileTransfer.localCopy(file,{onProgress:meter?meter.handler():null,signal});
        meter?.finish();
      }
      if(signal&&signal.aborted)throw new DOMException('Cancelado','AbortError');
      const impressao=await FileFingerprint.hashBlob(file);
      const identico=await this.findByHash(impressao,file.size);
      if(identico)return {status:'duplicate',book:identico,exact:true};
      built=await AudioImport.buildSingle(file,{
        fingerprint:impressao,
        onStatus:t=>Utils.setLoaderText(null,t)
      });
    }catch(err){
      if(Utils.isAbort(err))return {status:'cancelled'};
      console.error(err);
      return {status:'error',message:err?.message||'Falha ao processar o arquivo.',error:err};
    }
    const parecido=this.findSimilar(built.meta);
    if(parecido)return {status:'duplicate',book:parecido,exact:false,pending:{meta:built.meta,blobs:built.blobs}};
    return this.saveAudioResult(built);
  }
  async importAudioGroup(group,{quiet=false}={}){
    let built;
    try{
      built=await AudioImport.buildGroup(group.plan,{
        title:group.title,author:group.author,
        onStatus:t=>Utils.setLoaderText(null,t)
      });
      const identico=await this.findByHash(built.meta.fileHash,built.meta.fileSize);
      if(identico)return {status:'duplicate',book:identico,exact:true};
    }catch(err){
      console.error(err);
      return {status:'error',message:err?.message||'Falha ao processar os arquivos.',error:err};
    }
    const parecido=this.findSimilar(built.meta);
    if(parecido)return {status:'duplicate',book:parecido,exact:false,pending:{meta:built.meta,blobs:built.blobs}};
    return this.saveAudioResult(built);
  }
  async saveAudioResult({meta,blobs}){
    try{
      Utils.setLoaderText('Salvando na sua estante','Audiolivros grandes podem levar alguns instantes...');
      await AudioImport.save(this.db,meta,blobs);
    }catch(err){
      console.error(err);
      return {status:'error',message:err?.message||'Não foi possível salvar o audiolivro.',error:err};
    }
    this.allBooks.push(Utils.normalizeBook(meta));
    return {status:'ok',book:meta};
  }
  /* Vários MP3 juntos: se parecem capítulos de um livro, pergunta antes de agrupar. */
  async decideAudioGroup(files){
    Utils.showLoader('Analisando os arquivos','Verificando se são partes do mesmo audiolivro...');
    let plan=null;
    try{plan=await AudioImport.analyzeGroup(files)}
    catch(e){console.warn(e)}
    finally{Utils.hideLoader()}
    if(!plan)return {action:'separate'};
    return AudioGroupDialog.ask(plan);
  }

  /* Arquivo exatamente igual a algum que ja esta guardado. Livros antigos
     ainda sem assinatura recebem a sua na primeira comparacao. */
  async findByHash(hash,size){
    if(!hash)return null;
    const books=this.allBooks.length?this.allBooks:await this.db.getBooks();
    const direto=books.find(b=>b.fileHash&&b.fileHash===hash);
    if(direto)return direto;
    for(const book of books){
      if(book.fileHash)continue;
      if(Number.isFinite(book.fileSize)&&book.fileSize!==size)continue;
      let rec=null;
      try{rec=await this.db.getFile(book.id)}catch(e){continue}
      const buffer=rec&&rec.buffer;
      if(!buffer||typeof buffer.byteLength!=='number')continue;
      book.fileSize=buffer.byteLength;
      if(buffer.byteLength!==size){
        try{await this.db.updateBook(book)}catch(e){}
        continue;
      }
      book.fileHash=await FileFingerprint.hash(buffer);
      try{await this.db.updateBook(book)}catch(e){}
      if(book.fileHash===hash)return book;
    }
    return null;
  }

  /* Mesmo titulo (e autor compativel) em arquivo diferente. */
  findSimilar(meta){
    const norm=FileFingerprint.normalize;
    const titulo=norm(meta.title);
    if(!titulo)return null;
    const autor=norm(meta.author);
    const generico=v=>!v||v==='autor desconhecido';
    return this.allBooks.find(book=>{
      if(AudioFormats.isAudioBook(book)!==AudioFormats.isAudioBook(meta))return false;
      if(norm(book.title)!==titulo)return false;
      const outro=norm(book.author);
      if(generico(autor)||generico(outro))return true;
      return outro===autor;
    })||null;
  }
}

/* ============================================================
   APP MODAL — substitui confirmações nativas do navegador
   ============================================================ */
const AppModal={
  el:null,body:null,title:null,subtitle:null,footer:null,confirmBtn:null,cancelBtn:null,closeBtn:null,icon:null,resolve:null,cleanup:null,
  init(){
    this.el=document.getElementById('app-modal');
    this.body=document.getElementById('app-modal-body');
    this.title=document.getElementById('app-modal-title');
    this.subtitle=document.getElementById('app-modal-subtitle');
    this.footer=document.getElementById('app-modal-footer');
    this.confirmBtn=document.getElementById('app-modal-confirm');
    this.cancelBtn=document.getElementById('app-modal-cancel');
    this.closeBtn=document.getElementById('app-modal-close');
    this.icon=document.getElementById('app-modal-icon');
    const cancel=()=>this.close(false);
    this.cancelBtn?.addEventListener('click',cancel);
    this.closeBtn?.addEventListener('click',cancel);
    this.el?.addEventListener('click',e=>{if(e.target===this.el)cancel()});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.el?.classList.contains('show'))cancel()});
  },
  alert({title='Aviso',subtitle='',message='',confirmText='Entendi',icon='circle-alert'}={}){
    if(!this.el)this.init();
    this.close(false);
    this.title.textContent=title;
    this.subtitle.textContent=subtitle;
    this.body.innerHTML=`<p>${Utils.esc(message).replace(/\n/g,'<br>')}</p>`;
    this.confirmBtn.className='soft-btn primary';
    this.confirmBtn.innerHTML=`<i data-lucide="${icon}"></i>${Utils.esc(confirmText)}`;
    this.cancelBtn.style.display='none';
    this.icon.innerHTML=`<i data-lucide="${icon}"></i>`;
    this.el.classList.add('show');document.body.classList.add('modal-open');
    lucide.createIcons({root:this.el});
    return new Promise(resolve=>{
      const c=this.confirmBtn;
      const finish=()=>{c.removeEventListener('click',finish);this.el.classList.remove('show');document.body.classList.remove('modal-open');this.cancelBtn.style.display='';resolve(true)};
      c.addEventListener('click',finish,{once:true});
    });
  },
  confirm({title='Confirmação',subtitle='',message='',confirmText='Confirmar',confirmIcon='check',danger=false}={}){
    if(!this.el)this.init();
    this.close(false);
    this.title.textContent=title;this.subtitle.textContent=subtitle;
    this.body.innerHTML=`<p>${Utils.esc(message).replace(/\n/g,'<br>')}</p>`;
    this.confirmBtn.className=`soft-btn ${danger?'danger':'primary'}`;
    this.confirmBtn.innerHTML=`<i data-lucide="${confirmIcon}"></i>${Utils.esc(confirmText)}`;
    this.cancelBtn.style.display='';
    this.cancelBtn.textContent='Cancelar';this.cancelBtn.className='soft-btn';
    this.icon.innerHTML=`<i data-lucide="${danger?'triangle-alert':'circle-alert'}"></i>`;
    this.el.classList.add('show');document.body.classList.add('modal-open');
    lucide.createIcons({root:this.el});
    return new Promise(resolve=>{
      const c=this.confirmBtn,x=this.cancelBtn;
      const cleanup=()=>{c.removeEventListener('click',onC);x.removeEventListener('click',onX);this.cleanup=null};
      const onC=()=>{cleanup();this.resolve=null;this.el.classList.remove('show');document.body.classList.remove('modal-open');resolve(true)};
      const onX=()=>{cleanup();this.resolve=null;this.el.classList.remove('show');document.body.classList.remove('modal-open');resolve(false)};
      this.resolve=resolve;this.cleanup=cleanup;
      c.addEventListener('click',onC,{once:true});x.addEventListener('click',onX,{once:true});
    });
  },
  close(result=false){
    if(this.cleanup){this.cleanup();this.cleanup=null}
    this.el?.classList.remove('show');document.body.classList.remove('modal-open');
    const r=this.resolve;this.resolve=null;
    if(r)r(result);
  }
};

/* ============================================================
   ASSINATURA DE ARQUIVO — base da checagem de livros repetidos
   ============================================================ */
const FileFingerprint={
  /* SHA-256 quando o navegador oferece WebCrypto; senao, uma assinatura
     propria (suficiente para comparar arquivos entre si). */
  async hash(buffer){
    try{
      if(window.crypto&&crypto.subtle&&crypto.subtle.digest){
        const digest=await crypto.subtle.digest('SHA-256',buffer);
        return 'sha256:'+Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
      }
    }catch(e){console.warn('WebCrypto indisponivel; usando assinatura alternativa.',e)}
    return this.fallback(buffer);
  },
  fallback(buffer){
    const bytes=new Uint8Array(buffer);
    let h1=0x811c9dc5,h2=0x01000193;
    const step=Math.max(1,Math.floor(bytes.length/65536));
    for(let i=0;i<bytes.length;i+=step){
      h1=Math.imul((h1^bytes[i])>>>0,16777619)>>>0;
      h2=(h2+bytes[i]*((i%251)+1))>>>0;
    }
    return `fnv:${bytes.length.toString(16)}:${h1.toString(16)}:${h2.toString(16)}`;
  },
  /* Assinatura de arquivos grandes (audiolivros): tamanho + trechos do começo,
     do meio e do fim. Lê no máximo ~1,5 MB, seja qual for o tamanho do arquivo. */
  async hashBlob(blob){
    const CH=512*1024;
    const parts=[blob.slice(0,Math.min(CH,blob.size))];
    if(blob.size>CH*3){const mid=Math.floor(blob.size/2-CH/2);parts.push(blob.slice(mid,mid+CH))}
    if(blob.size>CH)parts.push(blob.slice(Math.max(CH,blob.size-CH),blob.size));
    const buffers=await Promise.all(parts.map(p=>p.arrayBuffer()));
    const head=new TextEncoder().encode(`size:${blob.size};`);
    let total=head.length;
    buffers.forEach(b=>{total+=b.byteLength});
    const joined=new Uint8Array(total);
    joined.set(head,0);
    let o=head.length;
    buffers.forEach(b=>{joined.set(new Uint8Array(b),o);o+=b.byteLength});
    return 'audio-'+await this.hash(joined.buffer);
  },
  async hashList(hashes){
    const u8=new TextEncoder().encode(hashes.join('|'));
    return 'group-'+await this.hash(u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength));
  },
  /* Comparacao tolerante de titulos e autores (sem acentos e pontuacao). */
  normalize(value){
    return String(value||'').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  }
};

/* ============================================================
   DOCUMENTOS — sobre, licencas, politica e termos
   Os textos vivem em arquivos externos; se nao for possivel le-los
   (pagina aberta via file://, arquivo ausente), o aplicativo mostra
   a versao embutida para que o usuario nunca fique sem informacao.
   ============================================================ */
const Docs={
  el:null,cache:new Map(),lastFocus:null,
  sources:{
    sobre:{title:'Sobre o aplicativo',subtitle:'O que é o Veredas Reader',icon:'info',path:'sobre-politicas-e-termos/sobre.md',kind:'md'},
    privacidade:{title:'Política de privacidade',subtitle:'Como seus dados são tratados',icon:'shield-check',path:'sobre-politicas-e-termos/politica-de-privacidade.md',kind:'md'},
    termos:{title:'Termos de uso',subtitle:'Condições de uso do aplicativo',icon:'file-text',path:'sobre-politicas-e-termos/termos-de-uso.md',kind:'md'},
    'lic-lucide':{title:'Lucide',subtitle:'Licença ISC',icon:'scale',path:'licencas/LICENSE-Lucide.txt',kind:'txt'},
    'lic-jszip':{title:'JSZip',subtitle:'Licença MIT',icon:'scale',path:'licencas/LICENSE-JSZip.txt',kind:'txt'},
    'lic-pdfjs':{title:'PDF.js',subtitle:'Licença Apache 2.0',icon:'scale',path:'licencas/LICENSE-Apache.txt',kind:'txt'},
    'lic-mammoth':{title:'Mammoth.js',subtitle:'Licença BSD-2-Clause',icon:'scale',path:'licencas/LICENSE-mammoth.txt',kind:'txt'},
    'lic-libarchivejs':{title:'libarchive.js',subtitle:'Licença MIT',icon:'scale',path:'licencas/LICENSE-libarchivejs.txt',kind:'txt'},
    'lic-libarchive':{title:'libarchive',subtitle:'Licença BSD-2-Clause',icon:'scale',path:'licencas/LICENSE-libarchive.txt',kind:'txt'}
  },
  fallbacks:{
    sobre:[
      '# Veredas Reader',
      '',
      'O Veredas Reader é um leitor de livros digitais que funciona inteiramente no seu dispositivo.',
      'Ele abre arquivos **EPUB**, **MOBI**, **PDF**, **TXT**, **MD** (Markdown) e **DOCX**, lê quadrinhos em',
      '**CBZ**, **CBR**, **CB7** e **CBT**, toca audiolivros em **MP3** e **M4B**,',
      'reproduz vídeos em **MP4**, guarda a sua estante no dispositivo e preserva marcações, citações, anotações e progresso.',
      '',
      '## O que ele faz',
      '',
      '- Importa livros do seu aparelho e mantém uma cópia local para leitura no dispositivo.',
      '- Lê quadrinhos com zoom por pinça, revista aberta no modo paisagem, sentido mangá e rolagem contínua.',
      '- Organiza a estante por status, coleções, séries, autores e tags.',
      '- Permite grifar trechos, criar citações, anotações e marcadores.',
      '- Ajusta tema, tipografia, espaçamento, margens, brilho e modo de virada de página.',
      '- Lê o texto em voz alta com as vozes disponíveis no dispositivo.',
      '- Toca audiolivros e vídeos com capítulos, marcadores, velocidade ajustável, timer de sono e retomada exata de onde você parou.',
      '- Guarda o sentido de rolagem de cada livro separadamente: mudar em um não muda nos outros.',
      '- Converte PDF em EPUB localmente, sem enviar o arquivo para lugar nenhum.',
      '',
      '## Tecnologia',
      '',
      'O aplicativo é uma PWA: depois do primeiro carregamento, funciona sem internet.',
      'Todo o conteúdo fica armazenado no navegador do próprio aparelho.',
      '',
      '> Este texto é a versão embutida. O conteúdo completo fica em `sobre-politicas-e-termos/sobre.md`.'
    ].join('\n'),
    privacidade:[
      '# Política de privacidade',
      '',
      'O Veredas Reader foi construído para funcionar **sem coletar dados pessoais**.',
      '',
      '## Dados que ficam no seu dispositivo',
      '',
      '- Os livros que você importa e a cópia usada para leitura no dispositivo.',
      '- Seu progresso de leitura, marcadores, grifos, citações e anotações.',
      '- Suas preferências de tema, tipografia e leitura.',
      '',
      'Essas informações são gravadas no armazenamento local do navegador (IndexedDB) e',
      '**não são enviadas para servidores do aplicativo**.',
      '',
      '## Permissões',
      '',
      'O aplicativo só acessa arquivos e pastas que você escolhe explicitamente, no momento em',
      'que você escolhe. Nenhuma varredura acontece sem a sua autorização.',
      '',
      '## Serviços de terceiros',
      '',
      'As bibliotecas de código aberto usadas pelo aplicativo podem ser carregadas a partir de',
      'redes de distribuição públicas. Nesse caso, o provedor pode registrar dados técnicos',
      'padrão de conexão, como endereço IP e tipo de navegador.',
      '',
      '## Remoção dos dados',
      '',
      'Você pode remover qualquer livro pela própria estante. Limpar os dados do site no',
      'navegador apaga toda a biblioteca local de forma definitiva.',
      '',
      '> Este texto é a versão embutida. O conteúdo completo fica em `sobre-politicas-e-termos/politica-de-privacidade.md`.'
    ].join('\n'),
    termos:[
      '# Termos de uso',
      '',
      'Ao usar o Veredas Reader você concorda com as condições abaixo.',
      '',
      '## 1. Uso do aplicativo',
      '',
      'O aplicativo é oferecido para leitura pessoal de arquivos que você já possui.',
      'Você é responsável por ter os direitos de uso dos livros que importa.',
      '',
      '## 2. Conteúdo protegido',
      '',
      'O aplicativo não remove proteções de DRM nem contorna medidas técnicas de proteção.',
      'Arquivos protegidos podem não abrir.',
      '',
      '## 3. Responsabilidade sobre os dados',
      '',
      'A biblioteca fica armazenada apenas no seu dispositivo. Faça suas próprias cópias de',
      'segurança: a perda de dados do navegador implica a perda da estante local.',
      '',
      '## 4. Garantias',
      '',
      'O aplicativo é fornecido "como está", sem garantias de funcionamento ininterrupto ou',
      'de compatibilidade com todos os arquivos e dispositivos.',
      '',
      '## 5. Código aberto',
      '',
      'O aplicativo usa bibliotecas de terceiros, listadas em Sobre > Licenças de código aberto,',
      'cada uma sujeita à sua própria licença.',
      '',
      '> Este texto é a versão embutida. O conteúdo completo fica em `sobre-politicas-e-termos/termos-de-uso.md`.'
    ].join('\n'),
    'lic-lucide':'Lucide — Licença ISC\n\nO texto completo da licença deve estar em licencas/LICENSE-Lucide.txt.\nReferência oficial: https://github.com/lucide-icons/lucide/blob/main/LICENSE',
    'lic-jszip':'JSZip — Licença MIT\n\nO texto completo da licença deve estar em licencas/LICENSE-JSZip.txt.\nReferência oficial: https://github.com/Stuk/jszip/blob/main/LICENSE.markdown',
    'lic-pdfjs':'PDF.js — Licença Apache 2.0\n\nO texto completo da licença deve estar em licencas/LICENSE-Apache.txt.\nReferência oficial: https://www.apache.org/licenses/LICENSE-2.0',
    'lic-mammoth':'Mammoth.js — Licença BSD-2-Clause\n\nO texto completo da licença deve estar em licencas/LICENSE-mammoth.txt.\nReferência oficial: https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE',
    'lic-libarchivejs':'libarchive.js — Licença MIT\n\nO empacotamento do libarchive para o navegador, usado pelo leitor de\nquadrinhos em CBR, CB7 e CBT, deriva deste projeto.\nO texto completo da licença deve estar em licencas/LICENSE-libarchivejs.txt.\nReferência oficial: https://github.com/nika-begiashvili/libarchivejs/blob/master/LICENSE',
    'lic-libarchive':'libarchive — Licença BSD de 2 cláusulas\n\nO aplicativo distribui uma compilação de libarchive para WebAssembly,\nembutida em vendor/libarchive/libarchive-embutido.js e usada para abrir\nquadrinhos em CBR, CB7 e CBT.\nO texto completo da licença deve estar em licencas/LICENSE-libarchive.txt.\nReferência oficial: https://github.com/libarchive/libarchive/blob/master/COPYING'
  },
  init(){
    this.el=document.getElementById('doc-modal');
    if(!this.el)return;
    const close=()=>this.close();
    document.getElementById('doc-close').addEventListener('click',close);
    document.getElementById('doc-ok').addEventListener('click',close);
    this.el.addEventListener('click',e=>{if(e.target===this.el)close()});
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&this.el.classList.contains('show')){e.stopPropagation();close()}
    },true);
  },
  async load(key){
    if(this.cache.has(key))return this.cache.get(key);
    const src=this.sources[key];
    let data={text:this.fallbacks[key]||'',embedded:true};
    try{
      const res=await fetch(src.path,{cache:'no-cache'});
      if(res.ok){
        const text=(await res.text()).trim();
        if(text)data={text,embedded:false};
      }
    }catch(e){
      console.warn(`Não foi possível ler ${src.path}; usando o texto embutido.`,e);
    }
    this.cache.set(key,data);
    return data;
  },
  /* Conversor de Markdown enxuto: cobre o que documentos legais usam. */
  renderMarkdown(md){
    const inline=t=>Utils.esc(t)
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(m,label,href)=>{
        const safe=String(href).replace(/"/g,'&quot;');
        return /^(https?:|mailto:)/i.test(href)
          ?`<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`
          :label;
      });
    const lines=String(md).replace(/\r\n?/g,'\n').split('\n');
    let html='',list=null,para=[];
    const flushPara=()=>{if(para.length){html+=`<p>${inline(para.join(' '))}</p>`;para=[]}};
    const closeList=()=>{if(list){html+=`</${list}>`;list=null}};
    for(const raw of lines){
      const line=raw.trim();
      if(!line){flushPara();closeList();continue}
      if(/^(-{3,}|\*{3,}|_{3,})$/.test(line)){flushPara();closeList();html+='<hr>';continue}
      let m=line.match(/^(#{1,6})\s+(.*)$/);
      if(m){flushPara();closeList();const level=Math.min(m[1].length,4);html+=`<h${level}>${inline(m[2])}</h${level}>`;continue}
      m=line.match(/^>\s?(.*)$/);
      if(m){flushPara();closeList();html+=`<blockquote>${inline(m[1])}</blockquote>`;continue}
      m=line.match(/^[-*+]\s+(.*)$/);
      if(m){flushPara();if(list!=='ul'){closeList();html+='<ul>';list='ul'}html+=`<li>${inline(m[1])}</li>`;continue}
      m=line.match(/^\d+[.)]\s+(.*)$/);
      if(m){flushPara();if(list!=='ol'){closeList();html+='<ol>';list='ol'}html+=`<li>${inline(m[1])}</li>`;continue}
      closeList();para.push(line);
    }
    flushPara();closeList();
    return html||'<p>Conteúdo indisponível no momento.</p>';
  },
  extras(key){
    if(key!=='sobre')return '';
    const deps=[
      ['Lucide','ISC'],['JSZip','MIT'],['PDF.js','Apache 2.0'],['Mammoth.js','BSD-2-Clause']
    ].map(([n,l])=>`<div class="doc-dep"><i data-lucide="package"></i>${n}<span class="lic-tag">${l}</span></div>`).join('');
    return `<h2>Bibliotecas de código aberto</h2><div class="doc-dep-list">${deps}</div>`;
  },
  async open(key){
    const src=this.sources[key];
    if(!src)return;
    if(!this.el)this.init();
    if(!this.el)return;
    this.lastFocus=document.activeElement;
    document.getElementById('doc-title').textContent=src.title;
    document.getElementById('doc-subtitle').textContent=src.subtitle;
    document.getElementById('doc-icon').innerHTML=`<i data-lucide="${src.icon}"></i>`;
    const body=document.getElementById('doc-body');
    body.innerHTML='<div class="doc-loading"><div class="spinner"></div><span>Carregando documento…</span></div>';
    this.el.classList.add('show');
    document.body.classList.add('modal-open');
    lucide.createIcons({root:this.el});
    const data=await this.load(key);
    const note=data.embedded
      ?`<div class="doc-note"><i data-lucide="info"></i><div>Não foi possível ler <strong>${Utils.esc(src.path)}</strong>. Mostrando a versão incluída no aplicativo.</div></div>`
      :'';
    body.innerHTML=note+(src.kind==='md'
      ?this.renderMarkdown(data.text)+this.extras(key)
      :`<div class="doc-legal">${Utils.esc(data.text)}</div>`);
    body.scrollTop=0;
    lucide.createIcons({root:body});
    document.getElementById('doc-ok')?.focus();
  },
  close(){
    if(!this.el)return;
    this.el.classList.remove('show');
    const stillOpen=document.querySelector('.app-modal.show')||document.querySelector('.conversion-modal.show')||document.querySelector('.onboarding.show');
    if(!stillOpen)document.body.classList.remove('modal-open');
    if(this.lastFocus&&document.contains(this.lastFocus)){try{this.lastFocus.focus()}catch(e){}}
    this.lastFocus=null;
  }
};

/* ============================================================
   BUSCA DE LIVROS NO DISPOSITIVO
   O navegador nao pode varrer o aparelho sozinho: o usuario escolhe
   uma pasta e o aplicativo percorre tudo o que existe dentro dela.
   ============================================================ */
const DeviceScan={
  /* CBZ, CBR, M4B, EPUB e MOBI: são os formatos que o usuário costuma
     já ter guardados no aparelho e que dá para reconhecer só pela
     extensão, sem abrir cada arquivo. */
  exts:['epub','mobi','cbz','cbr','cb7','cbt','m4b'],
  label:'EPUB, MOBI, CBZ, CBR e M4B',
  maxFiles:600,
  busy:false,
  el:null,body:null,footer:null,titleEl:null,subEl:null,iconEl:null,confirmBtn:null,cancelBtn:null,closeBtn:null,
  init(){
    this.el=document.getElementById('scan-modal');
    if(!this.el)return;
    this.body=document.getElementById('scan-body');
    this.footer=document.getElementById('scan-footer');
    this.titleEl=document.getElementById('scan-title');
    this.subEl=document.getElementById('scan-subtitle');
    this.iconEl=document.getElementById('scan-icon');
    this.confirmBtn=document.getElementById('scan-confirm');
    this.cancelBtn=document.getElementById('scan-cancel');
    this.closeBtn=document.getElementById('scan-close');
  },
  pickerSupported(){return typeof window.showDirectoryPicker==='function'},
  inputSupported(){
    try{return 'webkitdirectory' in document.createElement('input')}catch(e){return false}
  },
  supported(){return this.pickerSupported()||this.inputSupported()},
  show(){
    if(!this.el)this.init();
    this.el.classList.add('show');
    document.body.classList.add('modal-open');
  },
  hide(){
    this.el?.classList.remove('show');
    const stillOpen=document.querySelector('.doc-modal.show')||document.getElementById('app-modal')?.classList.contains('show')||document.querySelector('.onboarding.show');
    if(!stillOpen)document.body.classList.remove('modal-open');
  },
  setHead(title,subtitle,icon){
    this.titleEl.textContent=title;
    this.subEl.textContent=subtitle;
    if(icon)this.iconEl.innerHTML=`<i data-lucide="${icon}"></i>`;
  },
  setFooter(confirmHtml,cancelText,{confirmDisabled=false,hideConfirm=false}={}){
    this.confirmBtn.innerHTML=confirmHtml;
    this.confirmBtn.disabled=confirmDisabled;
    this.confirmBtn.style.display=hideConfirm?'none':'';
    this.cancelBtn.textContent=cancelText;
    this.cancelBtn.style.display=cancelText?'':'none';
  },
  waitChoice(){
    return new Promise(resolve=>{
      const c=this.confirmBtn,x=this.cancelBtn,k=this.closeBtn;
      const finish=value=>{
        c.removeEventListener('click',onConfirm);
        x.removeEventListener('click',onCancel);
        k?.removeEventListener('click',onClose);
        resolve(value);
      };
      const onConfirm=()=>finish(true);
      const onCancel=()=>finish(false);
      const onClose=()=>finish(false);
      c.addEventListener('click',onConfirm);
      x.addEventListener('click',onCancel);
      k?.addEventListener('click',onClose);
    });
  },
  async start({auto=false}={}){
    if(this.busy)return;
    if(!this.el)this.init();
    if(!this.supported()){
      await AppModal.alert({
        title:'Busca automática indisponível',
        subtitle:'Seu navegador não permite ler pastas',
        message:'Use o botão + para escolher os arquivos manualmente. Em celulares Android, o Chrome costuma permitir a escolha de uma pasta inteira.',
        icon:'folder-x',confirmText:'Entendi'
      });
      return;
    }
    this.busy=true;
    try{
      this.setHead('Buscar livros no dispositivo',`Escolha uma pasta para procurar ${this.label}.`,'folder-search');
      this.body.innerHTML=`
        <p>${auto?'Para montar sua estante rapidamente, o':'O'} aplicativo pode procurar livros em <strong>EPUB</strong> e <strong>MOBI</strong>, quadrinhos em <strong>CBZ</strong> e <strong>CBR</strong> e audiolivros em <strong>M4B</strong> dentro de uma pasta do seu aparelho, incluindo as subpastas.</p>
        <div class="conversion-warning">
          <i data-lucide="shield-check"></i>
          <div><strong>Você escolhe a pasta</strong><div>A leitura acontece só no seu dispositivo e apenas na pasta autorizada. Downloads costuma ser o melhor ponto de partida.</div></div>
        </div>`;
      this.setFooter('<i data-lucide="folder-open"></i>Escolher pasta',auto?'Agora não':'Cancelar');
      this.show();
      lucide.createIcons({root:this.el});
      if(!await this.waitChoice()){this.hide();return}

      const entries=await this.collect();
      if(entries===null){this.hide();return}

      if(!entries.length){
        this.setHead('Nenhum livro encontrado','Tente outra pasta do aparelho.','folder-x');
        this.body.innerHTML=`
          <div class="scan-empty">
            <i data-lucide="search-x"></i>
            <div>Não encontramos arquivos ${Utils.esc(this.label)} nessa pasta.<br>Você pode tentar outra pasta ou importar os arquivos pelo botão +.</div>
          </div>`;
        this.setFooter('<i data-lucide="folder-open"></i>Tentar outra pasta','Fechar');
        lucide.createIcons({root:this.el});
        if(await this.waitChoice()){this.busy=false;return this.start({auto})}
        this.hide();
        return;
      }

      const chosen=await this.chooseFiles(this.prepare(entries));
      if(!chosen||!chosen.length){this.hide();return}
      this.hide();
      await App.library.importFiles(chosen.map(item=>item.file),{batch:true});
    }catch(err){
      if(err&&(err.name==='AbortError'||err.name==='NotAllowedError')){
        this.hide();
      }else{
        console.error(err);
        this.hide();
        Utils.toast('Não foi possível concluir a busca no dispositivo.','alert-triangle');
      }
    }finally{
      Utils.hideLoader();
      this.busy=false;
    }
  },
  /* Devolve a lista de arquivos encontrados, ou null se o usuario desistir. */
  async collect(){
    if(this.pickerSupported()){
      let dir;
      try{
        dir=await window.showDirectoryPicker({id:'veredas-scan',mode:'read',startIn:'downloads'});
      }catch(err){
        if(err&&err.name==='AbortError')return null;
        console.warn('Seletor de pastas indisponível; usando o seletor padrão.',err);
        return this.collectViaInput();
      }
      return this.walk(dir);
    }
    return this.collectViaInput();
  },
  async collectViaInput(){
    const files=await this.pickViaInput();
    if(files===null)return null;
    const found=[];
    for(const file of files){
      const ext=BookFormats.ext(file.name);
      if(!this.exts.includes(ext))continue;
      found.push({file,path:file.webkitRelativePath||file.name});
      if(found.length>=this.maxFiles)break;
    }
    return found;
  },
  pickViaInput(){
    const input=document.getElementById('folder-input');
    if(!input)return Promise.resolve(null);
    return new Promise(resolve=>{
      let done=false;
      const cleanup=()=>{input.removeEventListener('change',onChange)};
      const onChange=()=>{
        if(done)return;
        done=true;cleanup();
        const list=Array.from(input.files||[]);
        input.value='';
        resolve(list);
      };
      input.addEventListener('change',onChange);
      /* Se a janela voltar ao foco e nada tiver sido escolhido, tratamos como desistência. */
      setTimeout(()=>{
        window.addEventListener('focus',()=>{
          let tries=0;
          const timer=setInterval(()=>{
            tries++;
            if(done||(input.files&&input.files.length)){clearInterval(timer);return}
            if(tries>12){clearInterval(timer);if(!done){done=true;cleanup();input.value='';resolve(null)}}
          },500);
        },{once:true});
      },400);
      input.value='';
      input.click();
    });
  },
  /* Percorre a pasta escolhida e todas as subpastas. */
  async walk(dirHandle){
    const found=[];
    let scanned=0,cancelled=false;
    Utils.showLoader('Procurando livros','Lendo a pasta escolhida…',{onCancel:()=>{cancelled=true}});
    const queue=[{handle:dirHandle,path:dirHandle.name||'',depth:0}];
    try{
      while(queue.length&&!cancelled&&found.length<this.maxFiles){
        const current=queue.shift();
        for await(const entry of current.handle.values()){
          if(cancelled||found.length>=this.maxFiles)break;
          if(entry.kind==='directory'){
            if(current.depth<8&&!/^\./.test(entry.name)&&!/^(node_modules|Android)$/i.test(entry.name)){
              queue.push({handle:entry,path:`${current.path}/${entry.name}`,depth:current.depth+1});
            }
            continue;
          }
          scanned++;
          if(scanned%25===0){
            Utils.setLoaderText(null,`${scanned} arquivo(s) verificado(s) · ${found.length} livro(s) encontrado(s)`);
            await Utils.yieldToUI();
          }
          const ext=BookFormats.ext(entry.name);
          if(!this.exts.includes(ext))continue;
          try{
            const file=await entry.getFile();
            found.push({file,path:`${current.path}/${entry.name}`.replace(/^\/+/,'')});
          }catch(e){console.warn('Arquivo ignorado:',entry.name,e)}
        }
      }
    }finally{
      Utils.hideLoader();
    }
    return cancelled?null:found;
  },
  /* Marca o que aparenta já estar na estante, sem precisar ler os arquivos. */
  prepare(entries){
    const books=App.library?.allBooks||[];
    const norm=FileFingerprint.normalize;
    return entries
      .map(entry=>{
        const base=entry.file.name.replace(/\.[^/.]+$/,'');
        const known=books.some(b=>
          (Number.isFinite(b.fileSize)&&b.fileSize===entry.file.size&&b.sourceFileName===entry.file.name)||
          (norm(b.title)&&norm(b.title)===norm(base))
        );
        return {...entry,known,selected:!known};
      })
      .sort((a,b)=>a.file.name.localeCompare(b.file.name,'pt'));
  },
  chooseFiles(items){
    const novos=items.filter(i=>!i.known).length;
    this.setHead(`${items.length} livro(s) encontrado(s)`,novos?`${novos} ainda não estão na sua estante.`:'Todos parecem já estar na sua estante.','library-big');
    const render=()=>{
      const selected=items.filter(i=>i.selected).length;
      this.body.innerHTML=`
        <p>Escolha o que deseja adicionar à biblioteca. Arquivos idênticos aos que já estão na estante são ignorados automaticamente.</p>
        <div class="scan-toolbar">
          <span>${selected} de ${items.length} selecionado(s)</span>
          <button type="button" id="scan-toggle-all">${selected===items.length?'Limpar seleção':'Selecionar todos'}</button>
        </div>
        <div class="scan-list">
          ${items.map((item,index)=>`
            <button type="button" class="scan-item ${item.selected?'on':''}" data-index="${index}">
              <span class="consent-box"><i data-lucide="check"></i></span>
              <span class="scan-item-info">
                <strong>${Utils.esc(item.file.name)}</strong>
                <small>${Utils.esc(item.path||'')} · ${Utils.fmtBytes(item.file.size)}</small>
              </span>
              ${item.known?'<span class="scan-badge">na estante</span>':''}
            </button>`).join('')}
        </div>`;
      this.setFooter(`<i data-lucide="download"></i>Importar ${selected||''}`.trim(),'Cancelar',{confirmDisabled:!selected});
      lucide.createIcons({root:this.el});
      this.body.querySelector('#scan-toggle-all').onclick=()=>{
        const turnOn=items.filter(i=>i.selected).length!==items.length;
        items.forEach(i=>{i.selected=turnOn});
        render();
      };
      this.body.querySelectorAll('.scan-item').forEach(btn=>{
        btn.onclick=()=>{
          const item=items[Number(btn.dataset.index)];
          item.selected=!item.selected;
          render();
        };
      });
    };
    render();
    return this.waitChoice().then(ok=>ok?items.filter(i=>i.selected):null);
  }
};

/* ============================================================
   PRIMEIRO ACESSO — aceite obrigatorio + convite para a busca
   ============================================================ */
const FirstRun={
  version:1,
  storageKey:'veredas.consent.v1',
  el:null,body:null,foot:null,steps:null,
  init(){
    this.el=document.getElementById('onboarding');
    if(!this.el)return;
    this.body=document.getElementById('onb-body');
    this.foot=document.getElementById('onb-foot');
    this.steps=document.getElementById('onb-steps');
    const logo=document.getElementById('onb-logo-img');
    if(logo)logo.addEventListener('error',()=>{logo.style.display='none'},{once:true});
  },
  storedConsent(){
    try{return localStorage.getItem(this.storageKey)==='1'}catch(e){return false}
  },
  accepted(settings){
    if(this.storedConsent())return true;
    const c=settings&&settings.consent;
    return !!(c&&c.accepted&&Number(c.version)>=this.version);
  },
  /* Bloqueia a interface antes mesmo do banco abrir, evitando qualquer
     interacao antes do aceite. */
  lockIfNeeded(){
    if(!this.storedConsent())document.body.classList.add('app-locked');
  },
  unlock(){document.body.classList.remove('app-locked')},
  show(){
    if(!this.el)this.init();
    this.el.classList.add('show');
    document.body.classList.add('modal-open');
  },
  hide(){
    this.el?.classList.remove('show');
    const stillOpen=document.querySelector('.doc-modal.show')||document.querySelector('.app-modal.show');
    if(!stillOpen)document.body.classList.remove('modal-open');
  },
  setSteps(active,total){
    if(!this.steps)return;
    this.steps.innerHTML=Array.from({length:total},(_,i)=>`<span class="onb-dot ${i===active?'active':''}"></span>`).join('');
  },
  async run(){
    if(!this.el)this.init();
    if(!this.el){this.unlock();return}
    const settings=App.state.settings;
    if(!this.accepted(settings)){
      document.body.classList.add('app-locked');
      await this.askConsent();
      App.state.settings.consent={accepted:true,version:this.version,at:Date.now()};
      try{await App.persistSettings()}catch(e){console.warn(e)}
      try{localStorage.setItem(this.storageKey,'1')}catch(e){}
    }
    this.unlock();

    const jaConvidado=!!App.state.settings.scanInvited;
    if(!jaConvidado){
      App.state.settings.scanInvited=true;
      try{await App.persistSettings()}catch(e){console.warn(e)}
      const vazia=!(App.library&&App.library.allBooks.length);
      if(vazia&&DeviceScan.supported()){
        const quer=await this.inviteScan();
        this.hide();
        if(quer)await DeviceScan.start({auto:true});
        return;
      }
    }
    this.hide();
  },
  askConsent(){
    this.show();
    return new Promise(resolve=>{
      const renderConsent=()=>{
        this.setSteps(0,2);
        document.getElementById('onb-title').textContent='Bem-vindo ao Veredas Reader';
        document.getElementById('onb-lead').textContent='Antes de começar, leia e aceite os documentos abaixo.';
        this.body.innerHTML=`
          <div class="onb-points">
            <div class="onb-point"><i data-lucide="hard-drive"></i><div><strong>Tudo fica no seu aparelho</strong><span>Livros, marcações e progresso são guardados localmente. Nada é enviado para servidores nossos.</span></div></div>
            
            <div class="onb-point"><i data-lucide="user-check"></i><div><strong>Você no controle</strong><span>O aplicativo só acessa os arquivos e pastas que você escolher, quando você escolher.</span></div></div>
          </div>
          <div class="onb-docs">
            <button class="soft-btn" data-open-doc="privacidade"><i data-lucide="shield-check"></i>Política de privacidade</button>
            <button class="soft-btn" data-open-doc="termos"><i data-lucide="file-text"></i>Termos de uso</button>
          </div>
          <button type="button" class="consent-check" id="consent-check" role="checkbox" aria-checked="false">
            <span class="consent-box"><i data-lucide="check"></i></span>
            <p>Li e aceito a <strong>Política de Privacidade</strong> e os <strong>Termos de Uso</strong> do Veredas Reader.</p>
          </button>`;
        this.foot.innerHTML=`
          <button class="soft-btn" id="consent-decline">Não aceito</button>
          <button class="soft-btn primary" id="consent-accept" disabled><i data-lucide="check"></i>Aceitar e continuar</button>`;
        lucide.createIcons({root:this.el});
        const check=document.getElementById('consent-check');
        const accept=document.getElementById('consent-accept');
        let marcado=false;
        check.onclick=()=>{
          marcado=!marcado;
          check.classList.toggle('checked',marcado);
          check.setAttribute('aria-checked',String(marcado));
          accept.disabled=!marcado;
        };
        this.body.querySelectorAll('[data-open-doc]').forEach(btn=>{
          btn.onclick=()=>Docs.open(btn.dataset.openDoc);
        });
        accept.onclick=()=>{if(marcado)resolve(true)};
        document.getElementById('consent-decline').onclick=renderDeclined;
        setTimeout(()=>{try{check.focus()}catch(e){}},80);
      };
      const renderDeclined=()=>{
        this.setSteps(0,2);
        document.getElementById('onb-title').textContent='Precisamos do seu aceite';
        document.getElementById('onb-lead').textContent='Sem a aceitação, o aplicativo não pode ser usado.';
        this.body.innerHTML=`
          <div class="onb-points">
            <div class="onb-point"><i data-lucide="circle-alert"></i><div><strong>Nada acontece sem o aceite</strong><span>A política e os termos explicam como o aplicativo guarda seus livros e o que você pode fazer com eles. Sem a concordância, a biblioteca fica indisponível.</span></div></div>
            <div class="onb-point"><i data-lucide="book-open"></i><div><strong>Leia com calma</strong><span>Os dois documentos ficam sempre disponíveis no menu lateral, em Sobre.</span></div></div>
          </div>
          <div class="onb-docs">
            <button class="soft-btn" data-open-doc="privacidade"><i data-lucide="shield-check"></i>Ler a política</button>
            <button class="soft-btn" data-open-doc="termos"><i data-lucide="file-text"></i>Ler os termos</button>
          </div>`;
        this.foot.innerHTML=`<button class="soft-btn primary" id="consent-back"><i data-lucide="arrow-left"></i>Voltar e revisar</button>`;
        lucide.createIcons({root:this.el});
        this.body.querySelectorAll('[data-open-doc]').forEach(btn=>{
          btn.onclick=()=>Docs.open(btn.dataset.openDoc);
        });
        document.getElementById('consent-back').onclick=renderConsent;
      };
      renderConsent();
    });
  },
  inviteScan(){
    this.show();
    return new Promise(resolve=>{
      this.setSteps(1,2);
      document.getElementById('onb-title').textContent='Vamos montar sua estante?';
      document.getElementById('onb-lead').textContent='O aplicativo pode procurar os livros que já estão no seu aparelho.';
      this.body.innerHTML=`
        <div class="onb-points">
          <div class="onb-point"><i data-lucide="folder-search"></i><div><strong>Busca por EPUB, MOBI, CBZ, CBR e M4B</strong><span>Escolha uma pasta (Downloads é um bom começo) e o aplicativo procura nela e em todas as subpastas.</span></div></div>
          <div class="onb-point"><i data-lucide="list-checks"></i><div><strong>Você revisa antes</strong><span>Nada entra na estante sem a sua confirmação: você vê a lista e marca o que quer importar.</span></div></div>
          <div class="onb-point"><i data-lucide="plus"></i><div><strong>Dá para fazer depois</strong><span>A busca fica sempre disponível no menu lateral, em Sistema.</span></div></div>
        </div>`;
      this.foot.innerHTML=`
        <button class="soft-btn" id="onb-skip">Agora não</button>
        <button class="soft-btn primary" id="onb-scan"><i data-lucide="folder-search"></i>Procurar meus livros</button>`;
      lucide.createIcons({root:this.el});
      document.getElementById('onb-skip').onclick=()=>resolve(false);
      document.getElementById('onb-scan').onclick=()=>resolve(true);
    });
  }
};

/* ============================================================
   APP
   ============================================================ */
ConversionDialog.init();
AppModal.init();

const App={
  state:{settings:{...AppDefaults.settings}},
  lastScrollTop:0,
  scrollTimeout:null,
  async init(){
    Docs.init();
    DeviceScan.init();
    FirstRun.init();
    FirstRun.lockIfNeeded();
    try{
      this.db=new DBManager();
      await this.db.init();
      this.state.settings=await this.db.getSettings();
      /* Antes, o sentido de rolagem era uma preferência única para toda a
         biblioteca. Agora é de cada livro: na primeira abertura depois da
         atualização, a preferência geral volta para "Automático" para que
         cada formato abra do jeito natural dele. */
      if(this.state.settings.scrollPerBook!==true){
        this.state.settings.scrollPerBook=true;
        this.state.settings.readingMode='auto';
        try{await this.db.saveSettings(this.state.settings)}catch(e){console.warn(e)}
      }
    }catch(e){
      console.error(e);
      FirstRun.unlock();
      Utils.toast('Armazenamento local indisponível neste navegador.','alert-triangle');
      return;
    }
    this.applySettings();
    this.reader=new ReaderEngine(this.db,this.state);
    this.player=new AudioPlayer(this.db,this.state);
    this.library=new LibraryManager(this.db);
    this.setupPanels();
    this.setupSettingsUI();
    this.setupScrollBehavior();
    await this.library.render();
    this.syncBottomNav();
    try{
      await FirstRun.run();
    }catch(e){
      console.error(e);
      FirstRun.unlock();
    }
  },
  switchView(view){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
    if(view==='reader'){
      document.body.classList.add('reader-open');
    }else{
      document.body.classList.remove('reader-open');
      document.getElementById('reader-ui').classList.remove('visible');
    }
    if(view==='home'){
      document.body.classList.remove('bar-hidden');
    }
  },
  syncBottomNav(){
    if(!this.library)return;
    document.querySelectorAll('#bottom-nav [data-filter]').forEach(x=>{
      x.classList.toggle('active',x.dataset.filter===this.library.currentFilter);
    });
  },
  openDrawer(){
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('backdrop').classList.add('visible');
  },
  closeDrawer(){
    document.getElementById('sidebar').classList.remove('open');
    if(!document.querySelector('.panel.visible')){
      document.getElementById('backdrop').classList.remove('visible');
    }
  },
  openSearch(){
    document.getElementById('search-bar').classList.add('open');
    setTimeout(()=>document.getElementById('library-search-input').focus(),80);
  },
  closeSearch(){
    document.getElementById('search-bar').classList.remove('open');
    document.getElementById('library-search-input').blur();
  },
  async persistSettings(){await this.db.saveSettings(this.state.settings)},
  async updateSetting(k,v){
    this.state.settings[k]=v;
    this.applySettings();
    await this.persistSettings();
    if(this.reader&&document.getElementById('view-reader').classList.contains('active')&&
       ['fontSize','fontFamily','lineHeight','margin','orientation'].includes(k)){
      this.reader.triggerRePagination();
    }
  },
  applySettings(){
    const s=this.state.settings;
    document.body.dataset.theme=s.theme;

    const themeLogos={light:'logo-claro.png',sepia:'logo-sepia.png',dark:'logo-escuro.png',ocean:'logo-oceano.png'};
    const logoSrc=themeLogos[s.theme]||'logo.png';
    document.querySelectorAll('.brand-mark img').forEach(img=>{
      if(img.dataset.logoBound!=='1'){
        img.dataset.logoBound='1';
        img.addEventListener('error',()=>{
          if(!img.dataset.logoFallback){img.dataset.logoFallback='1';img.src='logo.png';}
        });
      }
      img.dataset.activeLogo=logoSrc;
      img.dataset.logoFallback='';
      if(!img.src.endsWith('/'+logoSrc)&&!img.src.endsWith(logoSrc))img.src=logoSrc;
    });
    const themeColorMeta=document.querySelector('meta[name="theme-color"]');
    if(themeColorMeta){
      const colorMap={light:'#5f202c',sepia:'#9a551f',dark:'#e3c4ca',ocean:'#38bdf8'};
      themeColorMeta.content=colorMap[s.theme]||'#5f202c';
    }
    
    const bodyStyle = document.body.style;
    if(s.readerBg) bodyStyle.setProperty('--reader-bg',s.readerBg);
    else bodyStyle.removeProperty('--reader-bg');
    
    if(s.readerText) bodyStyle.setProperty('--reader-text',s.readerText);
    else bodyStyle.removeProperty('--reader-text');
    
    const root = document.documentElement.style;
    root.setProperty('--reader-font',s.fontFamily);
    
    const lh = (s.lineHeight !== undefined && !isNaN(s.lineHeight)) ? s.lineHeight : AppDefaults.settings.lineHeight;
    root.setProperty('--reader-size',`${s.fontSize}px`);
    root.setProperty('--reader-line', lh);
    root.setProperty('--reader-margin',`${s.margin}%`);
    root.setProperty('--reader-brightness',`${s.brightness/100}`);
    
    document.querySelectorAll('.theme-option').forEach(b=>b.classList.toggle('active',b.dataset.themeValue===s.theme));
    document.querySelectorAll('#font-grid button').forEach(b=>b.classList.toggle('active',b.dataset.font===s.fontFamily));
    document.querySelectorAll('#orientation-grid button').forEach(b=>b.classList.toggle('active',b.dataset.orientation===s.orientation));
    this.syncReadingModeUi();
    const turn=s.pageTurn||'curl';
    document.querySelectorAll('#page-turn-grid button').forEach(b=>b.classList.toggle('active',b.dataset.pageTurn===turn));
    if(this.reader&&this.reader.container)this.reader.applyPageTurnMode();
    
    ['font-size','line-height','margin','brightness'].forEach(k=>{
      const el=document.getElementById(`set-${k}`),val=document.getElementById(`val-${k}`);
      if(!el||!val)return;
      const key=k==='font-size'?'fontSize':k==='line-height'?'lineHeight':k;
      const safeVal = (s[key] !== undefined && !isNaN(s[key])) ? s[key] : AppDefaults.settings[key];
      el.value = safeVal;
      val.textContent=k==='font-size'?`${safeVal}px`:k==='line-height'?Number(safeVal).toFixed(2):`${safeVal}%`;
    });
    
    const bg=document.getElementById('set-reader-bg');
    const txt=document.getElementById('set-reader-text');
    if(bg)bg.value=s.readerBg || '#ffffff';
    if(txt)txt.value=s.readerText || '#000000';
  },
  /* O seletor de rolagem mostra a escolha DO LIVRO enquanto há um livro
     aberto, e o padrão geral quando o leitor está na estante. */
  readerIsOpen(){
    return !!(this.reader&&this.reader.currentBook&&
      document.getElementById('view-reader')?.classList.contains('active'));
  },
  syncReadingModeUi(){
    const grid=document.getElementById('reading-mode-grid');
    if(!grid)return;
    const aberto=this.readerIsOpen();
    const livro=aberto?this.reader.currentBook:null;
    const escolha=aberto?(livro.readingMode||'auto'):(this.state.settings.readingMode||'auto');
    grid.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.readingMode===escolha));
    const tip=document.getElementById('reading-mode-tip');
    if(!tip)return;
    if(aberto){
      const efetivo=this.reader.resolveReadingMode(livro.format,livro)==='vertical'?'vertical':'horizontal';
      const padrao=this.reader.defaultReadingMode(livro.format)==='vertical'?'vertical':'horizontal';
      tip.textContent=`Esta escolha vale só para “${livro.title||'este livro'}”. Cada livro guarda o seu sentido de rolagem. `+
        `Agora está em ${efetivo}; no automático, ${BookFormats.label(livro.format)} abre em ${padrao}.`;
    }else{
      tip.textContent='Automático usa rolagem horizontal para EPUB, MOBI, TXT, MD e quadrinhos, e vertical para PDF e DOCX. '+
        'Mudando durante a leitura, o ajuste fica guardado só naquele livro.';
    }
  },
  setupPanels(){
    document.querySelectorAll('[data-close-panel]').forEach(b=>b.onclick=()=>this.closePanels());
    document.getElementById('backdrop').onclick=()=>{this.closePanels();this.closeDrawer()};
    document.getElementById('btn-save-organize').onclick=()=>this.library.saveOrganizer();
    document.getElementById('btn-save-note').onclick=()=>this.reader.saveNote();
  },
  setupSettingsUI(){
    document.querySelectorAll('[data-theme-value]').forEach(b=>b.onclick=()=>{
      this.updateSetting('theme',b.dataset.themeValue);
      this.updateSetting('readerBg', '');
      this.updateSetting('readerText', '');
    });
    document.querySelectorAll('#font-grid button').forEach(b=>b.onclick=()=>this.updateSetting('fontFamily',b.dataset.font));
    document.querySelectorAll('#orientation-grid button').forEach(b=>b.onclick=()=>this.updateSetting('orientation',b.dataset.orientation));
    document.querySelectorAll('#reading-mode-grid button').forEach(b=>b.onclick=async()=>{
      const valor=b.dataset.readingMode;
      if(this.readerIsOpen()){
        /* com um livro aberto, a escolha é só dele */
        await this.reader.setReadingMode(valor==='auto'?null:valor);
        this.syncReadingModeUi();
        const efetivo=this.reader.isVerticalReading()?'vertical':'horizontal';
        Utils.toast(valor==='auto'
          ?`Automático neste livro: leitura ${efetivo}.`
          :`Leitura ${efetivo} aplicada a este livro.`,'book-open');
      }else{
        await this.updateSetting('readingMode',valor);
        this.syncReadingModeUi();
        Utils.toast(valor==='auto'
          ?'Padrão automático: cada formato abre no sentido natural dele.'
          :`Novos livros vão abrir em leitura ${valor==='vertical'?'vertical':'horizontal'}.`,'book-open');
      }
    });
    
    document.querySelectorAll('#page-turn-grid button').forEach(b=>b.onclick=async()=>{
      await this.updateSetting('pageTurn',b.dataset.pageTurn);
      const label={curl:'Virada em folha real ativada.',slide:'Virada deslizante ativada.',none:'Virada sem animação ativada.'}[b.dataset.pageTurn];
      Utils.toast(label,'book-open');
    });

    /* ---------- Quadrinhos ---------- */
    document.querySelectorAll('#comic-fit-grid button').forEach(b=>b.onclick=async()=>{
      if(!this.reader||!this.reader.comic)return;
      await this.reader.setComicOption('comicFit',b.dataset.comicFit);
      Utils.toast(b.dataset.comicFit==='width'
        ?'A página passa a ocupar toda a largura da tela.'
        :'A página inteira passa a caber na tela.','book-image');
    });
    document.querySelectorAll('#comic-direction-grid button').forEach(b=>b.onclick=async()=>{
      if(!this.reader||!this.reader.comic)return;
      await this.reader.setComicOption('comicRtl',b.dataset.comicDir==='rtl');
      Utils.toast(b.dataset.comicDir==='rtl'
        ?'Leitura da direita para a esquerda (mangá).'
        :'Leitura da esquerda para a direita.','book-image');
    });
    const spreadToggle=document.getElementById('comic-spread-toggle');
    if(spreadToggle)spreadToggle.onchange=async e=>{
      if(!this.reader||!this.reader.comic){e.target.checked=!e.target.checked;return}
      await this.reader.setComicOption('comicSpread',!!e.target.checked);
    };

    const bindings=[['set-font-size','fontSize'],['set-line-height','lineHeight'],['set-margin','margin'],['set-brightness','brightness']];
    bindings.forEach(([id,key])=>{
      const el=document.getElementById(id);
      if(el)el.oninput=e=>this.updateSetting(key,Number(e.target.value));
    });
    const bg=document.getElementById('set-reader-bg');
    const txt=document.getElementById('set-reader-text');
    if(bg)bg.oninput=e=>this.updateSetting('readerBg',e.target.value);
    if(txt)txt.oninput=e=>this.updateSetting('readerText',e.target.value);
    
    const btnRestore = document.getElementById('btn-restore-settings');
    if(btnRestore) {
      btnRestore.onclick = () => {
        /* Restaurar leitura nao apaga o aceite de politica e termos. */
        this.state.settings = {
          ...AppDefaults.settings,
          /* as preferências do áudio não fazem parte da leitura de texto */
          ...Object.fromEntries(Object.entries(this.state.settings).filter(([k])=>k.startsWith('audio'))),
          consent:this.state.settings.consent||null,
          scanInvited:!!this.state.settings.scanInvited
        };
        this.persistSettings();
        this.applySettings();
        if(this.reader && document.getElementById('view-reader').classList.contains('active')) {
          this.reader.triggerRePagination();
        }
        Utils.toast('Configurações padrão restauradas.', 'rotate-ccw');
      };
    }
  },
  setupScrollBehavior(){
    const views=document.querySelectorAll('.view');
    const onScroll=(e)=>{
      if(e.target.id==='view-reader')return;
      const st=e.target.scrollTop;
      const delta=st-this.lastScrollTop;
      
      if(Math.abs(delta)>3){
         document.body.classList.add('bar-hidden');
         
         clearTimeout(this.scrollTimeout);
         this.scrollTimeout = setTimeout(() => {
             document.body.classList.remove('bar-hidden');
         }, 600);
      }
      this.lastScrollTop=st;
    };
    views.forEach(v=>v.addEventListener('scroll',onScroll,{passive:true}));
  },
  openPanel(id){
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('visible'));
    if(id==='panel-settings'){
      this.syncReadingModeUi();
      if(this.reader&&this.reader.updateComicControls)this.reader.updateComicControls();
    }
    document.getElementById(id).classList.add('visible');
    document.getElementById('backdrop').classList.add('visible');
    lucide.createIcons();
  },
  closePanels(){
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('visible'));
    if(!document.getElementById('sidebar').classList.contains('open')){
      document.getElementById('backdrop').classList.remove('visible');
    }
  },
  async reloadAnnotations() {
    if (!this.reader.currentBook) return;
    const b = await this.db.getBook(this.reader.currentBook.id);
    this.reader.currentBook = b;
    this.renderAnnotationPanel(b);
  },
  renderAnnotationPanel(book){
    const body=document.getElementById('annotations-body');
    body.innerHTML='';
    const addSection=(title,items,icon)=>{
      if(!items.length)return;
      const h=document.createElement('div');
      h.className='nav-title';
      h.textContent=title;
      body.appendChild(h);
      items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).forEach(a=>{
        const isNote = a.type === 'note';
        const c=document.createElement('div');
        c.className='annotation-card';
        c.innerHTML=`
          <div class="item-head">
            <div class="item-type">${title}</div>
            <i data-lucide="${icon}" style="width:16px;height:16px;color:var(--accent)"></i>
          </div>
          ${a.text?`<div class="item-text">“${Utils.esc(a.text)}”</div>`:''}
          ${a.note?`<div class="item-note">${Utils.esc(a.note)}</div>`:''}
          <div class="item-meta">Página ${(a.pageIndex||0)+1}</div>
          <div class="item-actions">
             ${isNote ? `<button class="action-btn edit-btn" title="Editar"><i data-lucide="edit-3"></i></button>` : ''}
             <button class="action-btn delete-btn" title="Excluir"><i data-lucide="trash"></i></button>
          </div>`;
        
        c.onclick=(e)=>{ 
            if(!e.target.closest('.item-actions')) {
                this.closePanels(); this.reader.turnToPage(a.pageIndex||0);
            }
        };

        c.querySelector('.delete-btn').onclick = async (e) => {
            e.stopPropagation();
            if(await AppModal.confirm({title:`Excluir ${title.toLowerCase().slice(0,-1)}?`,message:'Este registro será removido permanentemente da biblioteca.',confirmText:'Excluir',confirmIcon:'trash',danger:true})) {
                await this.db.deleteAnnotation(book.id, a.id);
                Utils.toast('Item excluído.', 'trash');
                this.reader.applyAnnotationsToRenderedPage(a.pageIndex);
                this.reloadAnnotations();
            }
        };

        if(isNote) {
            c.querySelector('.edit-btn').onclick = (e) => {
                e.stopPropagation();
                document.getElementById('selected-preview').innerHTML = 
                    `<div class="item-type">Trecho original</div><div class="item-text">“${Utils.esc(a.text)}”</div><div class="item-meta">Página ${(a.pageIndex||0)+1}</div>`;
                document.getElementById('note-text').value = a.note;
                document.getElementById('btn-save-note').dataset.editId = a.id;
                document.getElementById('btn-save-note').dataset.bookId = book.id;
                App.openPanel('panel-note');
            };
        }

        body.appendChild(c);
      });
    };
    addSection('Grifos',book.annotations.filter(a=>a.type==='highlight'),'highlighter');
    addSection('Citações',book.annotations.filter(a=>a.type==='quote'),'quote');
    addSection('Anotações',book.annotations.filter(a=>a.type==='note'),'sticky-note');
    if(book.bookmarks.length){
      const h=document.createElement('div');
      h.className='nav-title';
      h.textContent='Marcadores';
      body.appendChild(h);
      book.bookmarks.forEach(m=>{
        const c=document.createElement('div');
        c.className='bookmark-card';
        c.innerHTML=`
          <div class="item-head">
            <div class="item-type">Marcador</div>
            <i data-lucide="bookmark" style="width:16px;height:16px;color:var(--accent)"></i>
          </div>
          <div class="item-text">${Utils.esc(m.title||'Página salva')}</div>
          <div class="item-meta">Página ${(m.globalPage??m.pageIndex??0)+1}</div>
          <div class="item-actions">
             <button class="action-btn delete-btn" title="Excluir"><i data-lucide="trash"></i></button>
          </div>`;
          
        c.onclick=(e)=>{ 
            if(!e.target.closest('.item-actions')) {
                this.closePanels(); this.reader.turnToPage(m.globalPage??0);
            }
        };

        c.querySelector('.delete-btn').onclick = async (e) => {
            e.stopPropagation();
            if(await AppModal.confirm({title:'Excluir marcador?',message:'O marcador será removido permanentemente.',confirmText:'Excluir marcador',confirmIcon:'trash',danger:true})) {
                await this.db.deleteBookmark(book.id, m.id);
                Utils.toast('Marcador excluído.', 'trash');
                this.reloadAnnotations();
            }
        };

        body.appendChild(c);
      });
    }
    if(!body.children.length){
      body.innerHTML=`<div class="empty"><h3>Nenhuma marcação ainda</h3><p>Use Grifar, Citação, Anotar ou Marcador durante a leitura.</p></div>`;
    }
    lucide.createIcons({root:body});
  }
};

/* ============================================================
   GLOBAL LISTENERS + BOOT
   ============================================================ */
document.addEventListener('click',e=>{
  const p=document.getElementById('selection-pop');
  if(p.classList.contains('show')&&!e.target.closest('#selection-pop')){
    const selection=window.getSelection();
    const hasReaderSelection=selection&&!selection.isCollapsed&&String(selection).trim()&&
      (selection.anchorNode?.parentElement?.closest?.('.page-text')||selection.anchorNode?.parentElement?.closest?.('.pdf-text-layer'));
    if(!hasReaderSelection)setTimeout(()=>p.classList.remove('show'),120);
  }
  const annotationPop=document.getElementById('annotation-pop');
  if(annotationPop.classList.contains('show')&&!e.target.closest('#annotation-pop')&&!e.target.closest('[data-annotation-id]')){
    annotationPop.classList.remove('show');
    if(App.reader)App.reader.activeAnnotationId=null;
  }
});
window.addEventListener('load',()=>App.init());
