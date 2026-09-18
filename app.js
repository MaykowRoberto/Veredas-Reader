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
    Utils._onCancel=opts.onCancel||null;
    document.getElementById('loader').classList.add('active');
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
    return `${n.toFixed(n<10&&i>0?1:0)} ${u[i]}`;
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
  consent:null,scanInvited:false
}};

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
  mode(){return App.state.settings.pageTurn||'curl'}
  available(){
    const r=this.reader;
    if(this.mode()!=='curl')return false;
    if(!r.container||!r.container.isConnected)return false;
    if(r.isVerticalReading())return false;
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
    this.readingMode=this.state.settings.readingMode||'auto';
    this.pendingSelection=null;this.selectedHighlightColor='#f3d76a';
    this.annotationPressTimer=null;this.activeAnnotationId=null;
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
      if(this.currentBook&&document.getElementById('view-reader').classList.contains('active'))this.triggerRePagination();
    },350));
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
    if(this.navigating)return;
    this.navigating=true;
    this.currentBook=Utils.normalizeBook(book);
    const ctrl=new AbortController();
    this.openController=ctrl;
    const watchdog=setTimeout(()=>{
      if(!ctrl.signal.aborted){
        this.openTimedOut=true;
        ctrl.abort();
      }
    },ReaderEngine.OPEN_TIMEOUT);
    this.openTimedOut=false;
    Utils.showLoader('Abrindo livro','Preparando sua leitura...',{
      progress:true,
      onCancel:()=>{this.openCancelled=true;ctrl.abort()}
    });
    this.openCancelled=false;
    try{
      const file=await this.db.getFile(book.id);
      if(!file||!file.buffer)throw new ParseError('O arquivo deste livro não está mais salvo no aparelho.','Importe o arquivo novamente para continuar a leitura.');
      this.destroy();
      document.getElementById('reader-title').textContent=book.title||'Livro';
      this.pdfMode=this.state.settings.pdfReadingMode||'lateral';
      this.pdfZoom=Utils.clamp(Number(this.state.settings.pdfZoom)||1,.75,3);
      App.switchView('reader');
      this.hideUI();
      let start=book.progress?.globalPage??null;
      const w=this.pageWidth(),h=window.innerHeight;
      
      const signal=ctrl.signal;
      if(book.format==='pdf'){
        start=await this.openPdf(file.buffer,book,start);
      }else if(book.format==='docx'){
        start=await this.openDocx(file.buffer,book,w,h,start,signal);
      }else if(book.format==='mobi'){
        start=await this.openMobi(file.buffer,book,w,h,start,signal);
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
  async openDocument(buffer,book,w,h,start,signal,format){
    const sig=this.pagSignature(book,w,h);
    const cached=await this.db.getPageCache(sig);
    if(cached&&cached.pagesData){
      this.restoreFromCache(cached);
      if(start===null)start=book.progress?.pageIndex??0;
      return start;
    }
    const label=format==='docx'?'Lendo o documento':'Lendo o livro';
    Utils.setLoaderProgress(4,label+'...');
    const parser=format==='docx'?DOCXParser:MOBIParser;
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
    const verticalReading=this.isVerticalReading();
    this.readingMode=verticalReading?'vertical':'horizontal';
    const pdfVertical=isPdf&&verticalReading;
    this.container.classList.toggle('reading-vertical',verticalReading);
    this.container.classList.toggle('reading-horizontal',!verticalReading);
    this.container.classList.toggle('pdf-vertical',pdfVertical);
    this.updateReadingModeControl();
    
    this.pagesData.forEach((html,i)=>{
      const d=document.createElement('div');
      d.className='page';d.dataset.page=i;
      
      if(isPdf)d.classList.add('pdf-page');
      
      d.innerHTML = isPdf
        ? html 
        : `<div class="page-content"><div class="page-text" style="font-family:${Utils.esc(this.state.settings.fontFamily)};font-size:${this.state.settings.fontSize}px;line-height:${this.state.settings.lineHeight};">${html}</div><div class="page-number">Página ${i+1} de ${this.pagesData.length}</div></div>`;
      
      this.container.appendChild(d);
    });
    
    this.sliderBook = this.container;
    if(isPdf){
      const badge=document.createElement('div');badge.className='pdf-zoom-badge';badge.id='pdf-zoom-badge';badge.textContent=`${Math.round(this.pdfZoom*100)}%`;this.container.appendChild(badge);
      this.setupPdfPinch();
    }
    if(verticalReading)this.setupContinuousReadingScroll();

    if(isPdf){
      this.updatePdfControls();
    }
    
    const slider = document.getElementById('reader-page-slider');
    const totalMax = Math.max(0, this.pagesData.length - 1);
    if(slider) slider.max = totalMax;
    document.getElementById('scrubber-total').textContent = this.pagesData.length;

    this.curl=new PageCurlEngine(this);
    this.applyPageTurnMode();
    this.setupPageGestures(isPdf,verticalReading);

    this.turnToPage(startIndex,{instant:true});
  }

  applyPageTurnMode(){
    const c=this.container;
    if(!c)return;
    const mode=App.state.settings.pageTurn||'curl';
    c.classList.toggle('pt-curl',mode==='curl');
    c.classList.toggle('pt-none',mode==='none');
    if(mode!=='curl'&&this.curl&&this.curl.active)this.curl.cancel();
  }
  toggleUI(){this.ui.classList.contains('visible')?this.hideUI():this.showUI()}
  /* Um único gesto cuida de tudo: dobrar a folha, tocar nas bordas
     para virar e tocar no meio para mostrar os controles. */
  setupPageGestures(isPdf,verticalReading){
    const c=this.container;
    let pid=null,mode='idle',sx=0,sy=0,st=0,lx=0,ly=0,lt=0,vx=0;
    const blocked=t=>!!(t&&t.closest&&(t.closest('.reader-ui')||t.closest('#annotation-pop')||t.closest('.selection-toolbar')||t.closest('#selection-toolbar')));
    const hasSelection=()=>{const s=window.getSelection();return !!(s&&!s.isCollapsed&&String(s).trim())};
    const reset=()=>{pid=null;mode='idle';vx=0};

    c.addEventListener('pointerdown',e=>{
      if(mode!=='idle')return;
      if(e.pointerType==='mouse'&&e.button!==0)return;
      if(blocked(e.target))return;
      if(this.curl&&this.curl.animating)return;
      pid=e.pointerId;sx=lx=e.clientX;sy=ly=e.clientY;st=lt=performance.now();vx=0;mode='pending';
    },{passive:true});

    c.addEventListener('pointermove',e=>{
      if(pid===null||e.pointerId!==pid)return;
      const now=performance.now(),dt=Math.max(1,now-lt);
      vx=0.72*((e.clientX-lx)/dt)+0.28*vx;
      lx=e.clientX;ly=e.clientY;lt=now;
      const dx=e.clientX-sx,dy=e.clientY-sy;
      if(mode==='curl'){this.curl.dragBy(dx,dy);return}
      if(mode!=='pending'||verticalReading)return;
      if(isPdf&&e.isPrimary===false){mode='blocked';return}
      /* Pegar a folha pelo canto e puxar na diagonal é natural; só o
         gesto quase vertical é descartado (pode ser seleção de texto). */
      if(Math.abs(dx)<16||Math.abs(dx)<Math.abs(dy)*0.6)return;
      if(now-st>520||hasSelection()){mode='blocked';return}
      if(isPdf&&this.pdfZoom>1.02){mode='blocked';return}
      const dir=dx<0?1:-1;
      if(this.curl&&this.curl.start(dir,sy)){
        mode='curl';
        try{c.setPointerCapture(e.pointerId)}catch(err){}
        this.curl.dragBy(dx,dy);
      }else{
        mode='swipe';
      }
    },{passive:true});

    /* Enquanto a folha está na mão, nada mais rola ou dá zoom. */
    c.addEventListener('touchmove',e=>{if(mode==='curl')e.preventDefault()},{passive:false});

    const finish=e=>{
      if(pid===null||(e&&e.pointerId!==undefined&&e.pointerId!==pid))return;
      const dx=lx-sx,dy=ly-sy,elapsed=performance.now()-st;
      const wasCurl=mode==='curl',wasSwipe=mode==='swipe',wasPending=mode==='pending';
      reset();
      if(wasCurl){this.curl.release(vx);return}
      if(hasSelection())return;
      if(verticalReading){
        if(Math.hypot(dx,dy)<10&&elapsed<600)this.toggleUI();
        return;
      }
      if(wasSwipe&&Math.abs(dx)>50){this.flip(dx<0?1:-1);return}
      if(!wasPending)return;
      if(Math.hypot(dx,dy)>=12||elapsed>=600)return;
      if(e&&e.target&&e.target.closest&&e.target.closest('[data-annotation-id]'))return;
      const rect=c.getBoundingClientRect();
      const w=rect.width||window.innerWidth;
      const x=(e?e.clientX:lx)-rect.left;
      if(x<w*0.25)this.flip(-1);
      else if(x>w*0.75)this.flip(1);
      else this.toggleUI();
    };
    c.addEventListener('pointerup',finish,{passive:true});
    c.addEventListener('pointercancel',e=>{
      if(pid===null||e.pointerId!==pid)return;
      const wasCurl=mode==='curl';
      reset();
      if(wasCurl)this.curl.release(vx);
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
    if(this.sliderBook && index >= 0 && index < this.pagesData.length) {
       if(this.isVerticalReading()){
         this.currentPageIndex=index;
         this.container.querySelectorAll('.page').forEach((p,i)=>p.classList.toggle('active',i===index));
         const page=this.container.querySelector(`.page[data-page="${index}"]`);
         if(page&&!options.fromScroll)page.scrollIntoView({block:'start',behavior:options.instant?'auto':'smooth'});
         this.updateProgressText(index);this.persistProgressDebounced(index);this.applyAnnotationsToRenderedPage(index);
         if(this.currentBook.format==='pdf'){
           this.renderPdfPageIfNeeded(index);this.renderPdfPageIfNeeded(index+1);this.renderPdfPageIfNeeded(index-1);
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
       this.renderPdfPageIfNeeded(index);
    }
  }

  async renderPdfPageIfNeeded(pageIndex){
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
  defaultReadingMode(format){
    return ['pdf','docx'].includes(String(format||'').toLowerCase())?'vertical':'horizontal';
  }
  resolveReadingMode(format=this.currentBook?.format){
    const pref=this.state.settings.readingMode||'auto';
    if(pref==='vertical'||pref==='horizontal')return pref;
    if(String(format||'').toLowerCase()==='pdf'&&this.state.settings.pdfReadingMode){
      return this.state.settings.pdfReadingMode==='vertical'?'vertical':'horizontal';
    }
    return this.defaultReadingMode(format);
  }
  isVerticalReading(){return this.readingMode==='vertical'||this.resolveReadingMode()==='vertical'}
  isPdfVertical(){return this.currentBook?.format==='pdf'&&this.isVerticalReading()}
  updateReadingModeControl(){
    const btn=document.getElementById('btn-reader-layout');
    if(!btn)return;
    const vertical=this.isVerticalReading();
    btn.innerHTML=`<i data-lucide="${vertical?'arrow-up-down':'arrow-left-right'}"></i>`;
    btn.title=vertical?'Mudar para leitura horizontal':'Mudar para rolagem vertical';
    btn.setAttribute('aria-label',btn.title);
    btn.classList.toggle('active',vertical);
    lucide.createIcons({root:btn});
  }
  updatePdfControls(){this.updateReadingModeControl()}
  async reloadReadingMode(){
    if(!this.currentBook||!this.sliderBook)return;
    const index=this.currentPageIndex;
    this.readingMode=this.resolveReadingMode(this.currentBook.format);
    this.pdfMode=this.readingMode;
    await this.initSliderBook(index);
  }
  async toggleReadingMode(){
    if(!this.currentBook||!this.sliderBook)return;
    const next=this.isVerticalReading()?'horizontal':'vertical';
    this.readingMode=next;
    await App.updateSetting('readingMode',next);
    if(this.currentBook.format==='pdf')await App.updateSetting('pdfReadingMode',next);
    await this.reloadReadingMode();
    Utils.toast(next==='vertical'?'Rolagem vertical ativada.':'Leitura horizontal ativada.','file-text');
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
          if(this.currentBook?.format==='pdf'&&rect.bottom>0&&rect.top<window.innerHeight){
            this.renderPdfPageIfNeeded(Number(page.dataset.page));
          }
        });
        if(nearest!==null&&nearest!==this.currentPageIndex)this.turnToPage(nearest,{fromScroll:true,instant:true});
      });
    },{passive:true});
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
    if(index >= this.pagesData.length){Utils.toast('Você chegou ao fim do livro.','check-circle');return;}
    if(index < 0){Utils.toast('Este é o início do livro.','info');return;}
    if(this.curl&&this.curl.animate(dir))return;
    this.turnToPage(index);
  }
  async persistProgress(i){
    if(!this.currentBook)return;
    const readPage=i+1,total=this.pagesData.length,pct=Math.round((readPage/Math.max(1,total))*100);
    this.currentBook.progress={globalPage:i,readPages:readPage,totalPages:total,percentage:pct};
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
    this.currentExtractor=null;
    this.pagesData=[];this.pageMeta=[];this.chapterStarts=[];
  }
}
/* Tempo máximo para preparar um livro antes de desistir e avisar o leitor. */
ReaderEngine.OPEN_TIMEOUT=90000;
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
      favorite:this.allBooks.filter(b=>b.favorite).length
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
      this.currentFilter==='favorite'?'Favoritos':
      this.currentFilter==='reading'?'Lendo agora':
      this.currentFilter==='read'?'Lidos':
      this.currentFilter==='toread'?'Para ler':'Pausados';
    sub.textContent=this.search
      ?`${b.length} resultado(s) para “${this.search}”`
      :(App.state.settings.sort==='author'?'Autores agrupados em ordem alfabética.':App.state.settings.sort==='custom'?'Ordem manual da sua estante.':'Livros organizados pela opção selecionada.');
    this.renderHero();
    if(!b.length){
      content.innerHTML=`<div class="empty"><i data-lucide="library"></i><h3>Nada por aqui ainda</h3><p>Importe um livro ou ajuste seus filtros de organização.</p></div>`;
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
    const grouped=new Map();
    b.forEach(book=>{
      const key=App.state.settings.sort==='author'?(book.author||'Autor desconhecido'):'Sua estante';
      if(!grouped.has(key))grouped.set(key,[]);
      grouped.get(key).push(book);
    });
    for(const[name,books]of grouped){
      const shelf=document.createElement('section');
      shelf.className='shelf';
      shelf.innerHTML=`<div class="shelf-head"><h3>${Utils.esc(name)}</h3><span>${books.length} ${books.length===1?'livro':'livros'}</span></div><div class="book-grid"></div>`;
      const grid=shelf.querySelector('.book-grid');
      books.forEach(book=>grid.appendChild(this.card(book)));
      content.appendChild(shelf);
    }
    lucide.createIcons({root:content});
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
    hero.innerHTML=`
      <div class="hero-card" id="hero-continue" role="button" tabindex="0" aria-label="Continuar lendo ${Utils.esc(b.title)}">
        <div>
          <div class="hero-label">Continue lendo</div>
          <div class="hero-title">${Utils.esc(b.title)}</div>
          <div class="hero-meta">${Utils.esc(b.author||'Autor desconhecido')}</div>
        </div>
        <div>
          <div class="hero-progress"><span style="width:${pct}%"></span></div>
          <div class="hero-footer">
            <span>Página ${page} de ${totalPages}</span>
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
    const cover=book.cover
      ?`<img src="${book.cover}" alt="${Utils.esc(book.title)}" loading="lazy">`
      :`<div class="fallback"><strong>${Utils.esc(book.title)}</strong><small>${Utils.esc(book.author||'')}</small></div>`;
    el.innerHTML=`
      <div class="book-menu-wrap">
        ${book.format==='pdf'?'<button class="book-menu convert-btn" title="Converter para EPUB" aria-label="Converter PDF para EPUB"><i data-lucide="file-output"></i></button>':''}
        ${['pdf','docx','txt'].includes(book.format)?'<button class="book-menu share-btn" title="Compartilhar livro" aria-label="Compartilhar livro"><i data-lucide="share-2"></i></button>':''}
        <button class="book-menu organize-btn" title="Organizar livro" aria-label="Organizar livro"><i data-lucide="more-horizontal"></i></button>
        <button class="book-delete" title="Excluir da biblioteca" aria-label="Excluir da biblioteca"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="book-cover">
        ${cover}
        <div class="cover-format-badge">
          ${book.format==='pdf'?'<span class="badge pdf-badge">PDF</span>':''}
          ${book.format==='epub'?'<span class="badge epub-badge">EPUB</span>':''}
          ${book.format==='docx'?'<span class="badge docx-badge">DOCX</span>':''}
          ${book.format==='mobi'?'<span class="badge mobi-badge">MOBI</span>':''}
          ${book.format==='txt'?'<span class="badge txt-badge">TXT</span>':''}
        </div>
        <div class="cover-badges">
          ${book.favorite?'<span class="badge">♥</span>':''}
          ${book.status==='read'?'<span class="badge">Lido</span>':''}
        </div>
      </div>
      <div class="book-info">
        <div class="book-title">${Utils.esc(book.title)}</div>
        <div class="book-author">${Utils.esc(book.author||'Autor desconhecido')}</div>
        <div class="book-progress"><span style="width:${pct}%"></span></div>
        <div class="book-sub"><span>${pct}%</span><span>${book.progress?.readPages?`p. ${book.progress.readPages}`:''}</span></div>
      </div>`;
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

async shareBook(book){
  if(!book)return;
  const shareableFormats=new Set(['pdf','docx','txt']);
  if(!shareableFormats.has(book.format)){
    await AppModal.alert({
      title:'Compartilhamento indisponível',
      subtitle:'Formato protegido',
      message:'Para manter a política de compartilhamento da biblioteca, arquivos EPUB e MOBI não podem ser compartilhados por este aplicativo.',
      confirmText:'Entendi',
      confirmIcon:'lock'
    });
    return;
  }
  try{
    const rec=await this.db.getFile(book.id);
    if(!rec?.buffer)throw new Error('A cópia deste livro não está disponível na biblioteca.');
    const mime=({pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain'})[book.format]||'application/octet-stream';
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
      for(const b of changed)await this.db.updateBook(b);
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
    for(const x of ordered)await this.db.updateBook(x);
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
      const c=document.createElement('div');
      c.className='bookmark-card';
      c.innerHTML=`
        <div class="item-head">
          <div class="item-type">Marcador</div>
          <i data-lucide="bookmark" class="bookmark-icon" style="width:16px;height:16px"></i>
        </div>
        <div class="item-text">${Utils.esc(m.title||'Página salva')}</div>
        <div class="item-meta">${Utils.esc(book.title)} · página ${(m.globalPage??m.pageIndex??0)+1}${m.preview?' · '+Utils.esc(m.preview.slice(0,80)):''}</div>
        <div class="item-actions">
           <button class="action-btn delete-btn" title="Excluir"><i data-lucide="trash"></i></button>
        </div>`;
      
      c.onclick=()=>App.reader.openBook({...book,progress:{...(book.progress||{}),globalPage:m.globalPage??0}});
      
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
    await this.db.updateBook(book);
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
            description:'Livros e documentos',
            accept:{
              'application/epub+zip':['.epub'],
              'application/x-mobipocket-ebook':['.mobi'],
              'application/pdf':['.pdf'],
              'text/plain':['.txt'],
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['.docx']
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
    const list=Array.from(files||[]).filter(Boolean);
    if(!list.length)return;
    if(list.length===1&&!batch)return this.importSingle(list[0]);

    let importados=0,repetidos=0,falhas=0;
    const erros=[];
    Utils.showLoader('Importando livros',`0 de ${list.length}`,{progress:true});
    try{
      for(let i=0;i<list.length;i++){
        const file=list[i];
        Utils.setLoaderProgress(Math.round((i/list.length)*100),`${i} de ${list.length} · ${file.name}`);
        await Utils.yieldToUI();
        const result=await this.importFile(file,{quiet:true});
        if(result.status==='ok')importados++;
        else if(result.status==='duplicate')repetidos++;
        else{falhas++;erros.push(`${file.name}: ${result.message||'não foi possível ler o arquivo'}`)}
      }
      Utils.setLoaderProgress(100,'Finalizando…');
    }finally{
      Utils.hideLoader();
    }

    await this.render();
    const linhas=[
      `${importados} livro(s) adicionado(s) à estante.`,
      repetidos?`${repetidos} já estavam na biblioteca e foram ignorados.`:'',
      falhas?`${falhas} arquivo(s) não puderam ser lidos.`:''
    ].filter(Boolean);
    if(erros.length)console.warn('Falhas na importação:',erros);
    await AppModal.alert({
      title:'Importação concluída',
      subtitle:`${list.length} arquivo(s) processado(s)`,
      message:linhas.join('\n'),
      icon:importados?'library-big':'info',
      confirmText:'Ver estante'
    });
  }

  async importSingle(file){
    Utils.showLoader('Importando livro','Lendo estrutura e capa...');
    let result;
    try{
      result=await this.importFile(file);
    }finally{
      Utils.hideLoader();
    }

    if(result.status==='ok'){
      Utils.toast('Livro importado e salvo offline.','check');
      await this.render();
      return;
    }

    if(result.status==='duplicate'){
      const book=result.book||{};
      const titulo=book.title||file.name;
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
        await this.db.saveBook(result.pending.meta,result.pending.buffer);
        Utils.toast('Livro importado e salvo offline.','check');
        await this.render();
      }catch(err){
        console.error(err);
        Utils.toast('Falha ao salvar o livro na biblioteca.','alert-circle');
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
  async importFile(file,{quiet=false}={}){
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    if(!['epub','pdf','txt','docx','mobi'].includes(ext)){
      if(!quiet)Utils.toast('Formato não suportado.','alert-triangle');
      return {status:'error',message:'Formato não suportado.'};
    }

    let buffer;
    try{
      buffer=await file.arrayBuffer();
    }catch(err){
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
    'lic-mammoth':{title:'Mammoth.js',subtitle:'Licença BSD-2-Clause',icon:'scale',path:'licencas/LICENSE-mammoth.txt',kind:'txt'}
  },
  fallbacks:{
    sobre:[
      '# Veredas Reader',
      '',
      'O Veredas Reader é um leitor de livros digitais que funciona inteiramente no seu dispositivo.',
      'Ele abre arquivos **EPUB**, **MOBI**, **PDF**, **TXT** e **DOCX**, guarda a sua estante offline e',
      'preserva marcações, citações, anotações e progresso de leitura.',
      '',
      '## O que ele faz',
      '',
      '- Importa livros do seu aparelho e mantém uma cópia local para leitura offline.',
      '- Organiza a estante por status, coleções, séries, autores e tags.',
      '- Permite grifar trechos, criar citações, anotações e marcadores.',
      '- Ajusta tema, tipografia, espaçamento, margens, brilho e modo de virada de página.',
      '- Lê o texto em voz alta com as vozes disponíveis no dispositivo.',
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
      '- Os livros que você importa e a cópia usada para leitura offline.',
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
    'lic-mammoth':'Mammoth.js — Licença BSD-2-Clause\n\nO texto completo da licença deve estar em licencas/LICENSE-mammoth.txt.\nReferência oficial: https://github.com/mwilliamson/mammoth.js/blob/master/LICENSE'
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
  exts:['epub','mobi'],
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
      this.setHead('Buscar livros no dispositivo','Escolha uma pasta para procurar EPUB e MOBI.','folder-search');
      this.body.innerHTML=`
        <p>${auto?'Para montar sua estante rapidamente, o':'O'} aplicativo pode procurar livros em <strong>EPUB</strong> e <strong>MOBI</strong> dentro de uma pasta do seu aparelho, incluindo as subpastas.</p>
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
            <div>Não encontramos arquivos EPUB ou MOBI nessa pasta.<br>Você pode tentar outra pasta ou importar os arquivos pelo botão +.</div>
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
      const ext=(file.name.split('.').pop()||'').toLowerCase();
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
          const ext=(entry.name.split('.').pop()||'').toLowerCase();
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
          <div class="onb-point"><i data-lucide="folder-search"></i><div><strong>Busca por EPUB e MOBI</strong><span>Escolha uma pasta (Downloads é um bom começo) e o aplicativo procura nela e em todas as subpastas.</span></div></div>
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
    }catch(e){
      console.error(e);
      FirstRun.unlock();
      Utils.toast('Armazenamento local indisponível neste navegador.','alert-triangle');
      return;
    }
    this.applySettings();
    this.reader=new ReaderEngine(this.db,this.state);
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
    document.querySelectorAll('#reading-mode-grid button').forEach(b=>b.classList.toggle('active',b.dataset.readingMode=== (s.readingMode||'auto')));
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
      await this.updateSetting('readingMode',b.dataset.readingMode);
      if(this.reader&&document.getElementById('view-reader').classList.contains('active')){
        await this.reader.reloadReadingMode();
        Utils.toast(b.dataset.readingMode==='auto'?'Modo automático aplicado.':`Leitura ${b.dataset.readingMode==='vertical'?'vertical':'horizontal'} aplicada.`,'book-open');
      }
    });
    
    document.querySelectorAll('#page-turn-grid button').forEach(b=>b.onclick=async()=>{
      await this.updateSetting('pageTurn',b.dataset.pageTurn);
      const label={curl:'Virada em folha real ativada.',slide:'Virada deslizante ativada.',none:'Virada sem animação ativada.'}[b.dataset.pageTurn];
      Utils.toast(label,'book-open');
    });

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
