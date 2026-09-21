/* ============================================================
   MOTOR DE IDIOMAS — Veredas Reader
   ------------------------------------------------------------
   Todo o texto que aparece na tela mora em idiomas/<tag>.js.
   Aqui fica só a máquina: descobrir qual idioma usar, carregar os
   arquivos certos, procurar cada texto e formatar número, data e
   plural do jeito de cada lugar.

   POR QUE OS ARQUIVOS SÃO .js E NÃO .json
   ---------------------------------------
   Eles SÃO JSON por dentro — um objeto e nada mais, editável como
   qualquer arquivo de tradução. O que muda é a casca: cada um
   começa com `Idiomas.registrar('pt-BR', {` e termina com `});`.

   O motivo é concreto: no PC o aplicativo é aberto com dois
   cliques, direto do disco, em endereço `file://`. Nesse endereço
   o navegador proíbe `fetch` de arquivo vizinho — por segurança,
   e não há como contornar sem subir um servidor. Um arquivo .json
   de verdade simplesmente não carregaria ali, e o aplicativo
   abriria sem texto nenhum no seu próprio computador.

   `<script>` funciona nos dois mundos, e de quebra chega pronto
   antes da primeira pintura da tela, sem espera e sem piscar
   texto trocado.

   A CADEIA DE RESERVA
   -------------------
   Um pedido de 'en-GB' procura o texto em três lugares, nesta
   ordem: en-GB → en → en. Um pedido de 'pt-BR' procura em
   pt-BR → pt → en. Assim um arquivo de variante regional guarda
   SÓ as diferenças — o en-GB tem umas dezenas de linhas, não
   oitocentas — e nada some se faltar uma linha: cai no inglês.
   ============================================================ */
const Idiomas = {

  /* Os idiomas que existem hoje. `nome` é escrito no próprio
     idioma, como manda o bom senso: quem abre o aplicativo em
     russo por engano precisa achar "Português" na lista, não
     "Portuguese" numa língua que não lê. */
  DISPONIVEIS: [
    { tag:'pt-BR', nome:'Português (Brasil)' },
    { tag:'pt-PT', nome:'Português (Portugal)' },
    { tag:'en',    nome:'English (US)' },
    { tag:'en-GB', nome:'English (UK)' },
    { tag:'en-AU', nome:'English (Australia)' },
    { tag:'en-CA', nome:'English (Canada)' },
    { tag:'en-IN', nome:'English (India)' },
    { tag:'de-DE', nome:'Deutsch' },
    { tag:'es',    nome:'Español (España)' },
    { tag:'es-419',nome:'Español (Latinoamérica)' },
    { tag:'fr',    nome:'Français' },
    { tag:'fr-CA', nome:'Français (Canada)' },
    { tag:'it',    nome:'Italiano' },
    { tag:'nl',    nome:'Nederlands' },
    { tag:'fil',   nome:'Filipino' },
    /* Cirílico: a Inter e a Literata têm esse recorte, e ele viaja
       junto (vendor/fontes/*-cirilico.woff2). */
    { tag:'ru',    nome:'Русский' },
    /* Alfabetos que as nossas fontes não cobrem. A Inter e a Literata
       trazem só o recorte latino, então o navegador passa a vez para a
       fonte do sistema NESTES caracteres — e só neles. Android e iPhone
       trazem as quatro; é por isso que não embutimos nada: seriam
       megabytes por alfabeto, e cada pessoa usa um. */
    { tag:'hi',    nome:'हिन्दी' },
    { tag:'th',    nome:'ไทย' },
    { tag:'ko',    nome:'한국어' },
    { tag:'ja',    nome:'日本語' },
    { tag:'zh',    nome:'中文（简体）' },
    { tag:'zh-TW', nome:'中文（繁體）' },
    /* Da direita para a esquerda: ao entrar, o <html> ganha dir="rtl". */
    { tag:'ar',    nome:'العربية' },
  ],

  RESERVA: 'en',

  /* O idioma em que o aplicativo foi escrito. É o último recurso da
     cadeia, abaixo até do inglês.

     A razão é dura: se uma linha faltar no idioma escolhido E no
     inglês, sem esta rede o motor devolveria a própria chave, e a
     pessoa leria "app.nao_foi_possivel_abrir" no lugar de uma frase.
     Pior ainda quando a chave não é texto de tela e sim um valor que
     o código usa para trabalhar — aí não fica feio, quebra.

     São 30 KB a mais, já guardados pelo service worker. Barato
     demais para se abrir mão da garantia. */
  ORIGINAL: 'pt-BR',

  _dados: {},          /* tag -> objeto de textos */
  _cadeia: ['en'],     /* onde procurar, em ordem */
  _tag: 'en',          /* o idioma em vigor */
  _plural: null,       /* Intl.PluralRules do idioma em vigor */

  /* ----------------------------------------------------------
     Chamado por cada arquivo de idioma ao ser carregado.
     ---------------------------------------------------------- */
  registrar(tag, textos){
    this._dados[tag] = Object.assign(this._dados[tag] || {}, textos || {});
  },

  /* ----------------------------------------------------------
     Que idioma o aparelho está pedindo.

     `navigator.languages` vem em ordem de preferência da pessoa.
     Percorremos essa lista e ficamos com o primeiro que sabemos
     falar — primeiro tentando a tag inteira ('pt-BR'), depois só
     a língua ('pt'). Quem tem o celular em alemão e o Veredas não
     fala alemão cai no inglês, que é o combinado.
     ---------------------------------------------------------- */
  doSistema(){
    const pedidos = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || 'en'];
    const temos = this.DISPONIVEIS.map(i => i.tag);
    for(const bruto of pedidos){
      const pedido = String(bruto || '').replace('_','-');
      const exato = temos.find(t => t.toLowerCase() === pedido.toLowerCase());
      if(exato) return exato;
      const regional = this._regiao(pedido);
      if(regional && temos.includes(regional)) return regional;
      const base = pedido.split('-')[0].toLowerCase();
      /* Uma variante que não temos cai na língua: quem pede 'fr-BE'
         recebe o francês, e não o inglês. */
      const porLingua = temos.find(t => t.split('-')[0].toLowerCase() === base);
      if(porLingua) return porLingua;
    }
    return this.RESERVA;
  },

  /* ----------------------------------------------------------
     Variantes que valem para um país inteiro de vizinhos.

     O aparelho de quem mora no México diz 'es-MX', não 'es-419'; o
     de Hong Kong diz 'zh-HK' ou 'zh-Hant-HK'; o de Angola, 'pt-AO'.
     Sem esta ponte, os três cairiam na variante errada da língua:
     espanhol da Espanha, chinês simplificado e português do Brasil.
     ---------------------------------------------------------- */
  _regiao(pedido){
    const partes = String(pedido || '').toLowerCase().split('-');
    const lingua = partes[0];
    const resto = partes.slice(1);
    const script = resto.find(p => p.length === 4);
    const pais = resto.find(p => p.length === 2 || /^\d{3}$/.test(p));
    if(lingua === 'es'){
      /* Espanha e Guiné Equatorial ficam no espanhol europeu;
         todo o resto das Américas (e os EUA) no latino-americano. */
      if(!pais || pais === 'es' || pais === 'gq') return null;
      return 'es-419';
    }
    if(lingua === 'zh'){
      if(script === 'hant') return 'zh-TW';
      if(script === 'hans') return 'zh';
      if(pais === 'tw' || pais === 'hk' || pais === 'mo') return 'zh-TW';
      return null;
    }
    if(lingua === 'pt'){
      /* O português europeu é a norma de Portugal e dos países
         africanos e asiáticos de língua portuguesa. */
      if(['pt','ao','mz','cv','gw','st','tl','mo','lu','ch'].includes(pais)) return 'pt-PT';
      return null;
    }
    return null;
  },

  /* ----------------------------------------------------------
     A cadeia de lugares onde procurar um texto.
     ---------------------------------------------------------- */
  cadeiaDe(tag){
    const fora = [];
    const posto = t => { if(t && !fora.includes(t)) fora.push(t); };
    posto(tag);
    const base = String(tag || '').split('-')[0];
    if(base && base !== tag){
      /* 'pt' sozinho não existe como arquivo; o nosso português
         mora em 'pt-BR'. Esta linha faz a ponte. */
      const irmao = this.DISPONIVEIS.find(i => i.tag === base)
                 || this.DISPONIVEIS.find(i => i.tag.split('-')[0] === base);
      if(irmao) posto(irmao.tag);
    }
    posto(this.RESERVA);
    posto(this.ORIGINAL);
    return fora;
  },

  /* ----------------------------------------------------------
     Carrega os arquivos da cadeia e liga o idioma.

     Só baixa o que ainda não tem, e nunca mais de três arquivos:
     o escolhido, a língua-base dele e o inglês. Um arquivo que
     falhe não derruba nada — a cadeia continua e o texto cai no
     nível seguinte.
     ---------------------------------------------------------- */
  async usar(tag){
    const cadeia = this.cadeiaDe(tag);
    await Promise.all(cadeia.map(t => this._buscar(t)));
    /* Se nem o inglês carregou, não há o que fazer além de seguir:
       T() devolve a própria chave e o aplicativo abre, feio mas
       funcionando. Melhor do que tela branca. */
    this._tag = tag;
    this._cadeia = cadeia;
    try{ this._plural = new Intl.PluralRules(tag); }
    catch(e){ this._plural = null; }
    this.aplicarNoDocumento();
    this._pedirParaGuardar(cadeia);
    return tag;
  },

  /* Pede ao service worker que guarde os arquivos desta cadeia.

     Sem isto, na primeira visita o arquivo do idioma escapa do service
     worker (ele ainda não controla a página) e fica só no cache comum
     do navegador, que o sistema esvazia quando quiser. Quem abrisse o
     aplicativo uma vez em espanhol e depois ficasse sem internet podia
     reencontrá-lo em inglês.

     É um recado e nada mais: se não houver service worker — em
     file://, por exemplo —, o `if` simplesmente não entra. */
  ALFABETO_CIRILICO: /^(ru|uk|bg|sr|be|kk|mk)\b/,
  FONTES_CIRILICAS: [
    'vendor/fontes/inter-variavel-cirilico.woff2',
    'vendor/fontes/literata-400-cirilico.woff2',
    'vendor/fontes/literata-400-italico-cirilico.woff2',
    'vendor/fontes/literata-700-cirilico.woff2',
  ],

  _pedirParaGuardar(cadeia){
    try{
      const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
      if(!sw) return;
      const v = window.BUILD_QS || '1';
      const urls = cadeia.map(t => `idiomas/${t}.js?v=${v}`);
      /* Quem lê a interface em russo precisa também das letras
         cirílicas das fontes, que não vêm na instalação. */
      if(cadeia.some(t => this.ALFABETO_CIRILICO.test(t))) urls.push(...this.FONTES_CIRILICAS);
      sw.postMessage({ tipo:'guardar-idiomas', urls });
    }catch(e){}
  },

  _buscar(tag){
    if(this._dados[tag]) return Promise.resolve();
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = `idiomas/${tag}.js?v=${(window.BUILD_QS||'1')}`;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => { console.warn('[idioma] não achei', tag); resolve(); };
      document.head.appendChild(s);
    });
  },

  /* ----------------------------------------------------------
     A busca de um texto.

     `chave` é um caminho com pontos: 'estante.vazia.titulo'.
     `vars` preenche os buracos: T('estante.total',{n:4}).

     PLURAL. Português tem duas formas ("1 livro" / "4 livros"),
     russo tem três, árabe tem seis, japonês tem uma. Quem decide
     é o Intl.PluralRules do próprio navegador, que conhece a
     regra de cada língua. No arquivo de textos, uma entrada com
     plural é um objeto:

        "livros": { "one": "{n} livro", "other": "{n} livros" }

     e quem chama não precisa saber de nada disso: passa {n} e
     recebe a frase certa.
     ---------------------------------------------------------- */
  t(chave, vars){
    let achado;
    for(const tag of this._cadeia){
      achado = this._pegar(this._dados[tag], chave);
      if(achado !== undefined) break;
    }
    if(achado === undefined){
      /* Chave que não existe em lugar nenhum é defeito nosso, não
         da pessoa. Avisamos no console e mostramos a própria
         chave, que pelo menos diz onde procurar. */
      if(!this._reclamou) this._reclamou = {};
      if(!this._reclamou[chave]){
        this._reclamou[chave] = true;
        console.warn('[idioma] texto faltando:', chave);
      }
      return chave;
    }
    if(achado && typeof achado === 'object'){
      const n = this._contagem(vars);
      const forma = (this._plural && Number.isFinite(n))
        ? this._plural.select(n)
        : 'other';
      achado = achado[forma] !== undefined ? achado[forma]
             : achado.other !== undefined ? achado.other
             : String(Object.values(achado)[0] || '');
    }
    return this._preencher(String(achado), vars);
  },

  /* Qual número manda no plural.

     O jeito clássico é exigir uma variável chamada `n`. Aqui isso
     obrigaria a renomear a variável em dezenas de chamadas antigas —
     `{importados} livros`, `{falhas} arquivos` —, e cada renomeação
     é uma chance de errar. Então: se existir `n`, ele manda; senão,
     vale o primeiro número que aparecer. Numa frase de contagem só
     existe um número mesmo.

     Frases com DOIS números ("{livros} livros · {marcacoes} marcas")
     não têm como escolher uma forma só, e por isso são escritas em
     texto simples, sem plural, nos arquivos de idioma. */
  _contagem(vars){
    if(!vars) return undefined;
    if(Number.isFinite(vars.n)) return vars.n;
    for(const v of Object.values(vars)) if(Number.isFinite(v)) return v;
    return undefined;
  },

  _pegar(obj, caminho){
    if(!obj) return undefined;
    let atual = obj;
    for(const parte of caminho.split('.')){
      if(atual == null || typeof atual !== 'object') return undefined;
      atual = atual[parte];
    }
    return atual;
  },

  /* {n}, {titulo}… Números saem formatados no padrão do idioma:
     "1.234" no Brasil, "1,234" nos Estados Unidos. */
  _preencher(texto, vars){
    if(!vars) return texto;
    return texto.replace(/\{(\w+)\}/g, (inteiro, nome) => {
      if(!(nome in vars)) return inteiro;
      const v = vars[nome];
      return typeof v === 'number' ? this.numero(v) : String(v ?? '');
    });
  },

  /* ----------------------------------------------------------
     Números, datas e listas no padrão do idioma em vigor.
     ---------------------------------------------------------- */
  numero(n, opcoes){
    try{ return new Intl.NumberFormat(this._tag, opcoes).format(n); }
    catch(e){ return String(n); }
  },
  data(d, opcoes){
    const dt = (d instanceof Date) ? d : new Date(d);
    if(isNaN(dt)) return '';
    try{ return new Intl.DateTimeFormat(this._tag, opcoes || {dateStyle:'medium'}).format(dt); }
    catch(e){ return dt.toLocaleDateString(); }
  },
  dataHora(d){
    return this.data(d, {dateStyle:'medium', timeStyle:'short'});
  },
  /* "a, b e c" em português, "a, b and c" em inglês, "a, b y c"
     em espanhol — o navegador sabe a conjunção de cada língua. */
  lista(itens, tipo){
    try{ return new Intl.ListFormat(this._tag, {style:'long', type: tipo||'conjunction'}).format(itens); }
    catch(e){ return itens.join(', '); }
  },

  /* ----------------------------------------------------------
     Traduz o HTML que já está na página.

       <h3 data-i18n="estante.titulo">Sua Biblioteca</h3>
       <input data-i18n-placeholder="busca.dica">
       <button data-i18n-aria="acoes.fechar">

     O texto em português continua escrito no HTML de propósito:
     serve de rascunho legível para quem abre o arquivo, e é o que
     aparece no meio segundo antes de o idioma entrar.
     ---------------------------------------------------------- */
  ATRIBUTOS: {
    'data-i18n-placeholder':'placeholder',
    'data-i18n-aria':'aria-label',
    'data-i18n-title':'title',
    'data-i18n-alt':'alt',
  },

  aplicarNoDocumento(raiz){
    const base = raiz || document;
    base.querySelectorAll('[data-i18n]').forEach(el => {
      const chave = el.getAttribute('data-i18n');
      if(!chave) return;
      /* Só o texto do elemento muda; os ícones e outros filhos
         ficam onde estão. Por isso procuramos um <span> marcado,
         e só caímos no textContent quando não há filho nenhum. */
      const alvo = el.querySelector('[data-i18n-slot]');
      if(alvo) alvo.textContent = this.t(chave);
      else if(!el.firstElementChild) el.textContent = this.t(chave);
      else {
        /* Elemento com ícone + texto solto: troca só o último
           pedaço de texto, deixando o ícone intacto. */
        const ultimo = [...el.childNodes].reverse().find(n => n.nodeType === 3 && n.textContent.trim());
        if(ultimo) ultimo.textContent = this.t(chave);
        else el.appendChild(document.createTextNode(this.t(chave)));
      }
    });
    Object.entries(this.ATRIBUTOS).forEach(([marca, atributo]) => {
      base.querySelectorAll(`[${marca}]`).forEach(el => {
        el.setAttribute(atributo, this.t(el.getAttribute(marca)));
      });
    });
    if(!raiz){
      document.documentElement.lang = this._tag;
      /* Deixado pronto para o árabe: quando chegar a vez dele,
         basta acrescentar a tag aqui. O CSS já trabalha com
         início/fim em vez de esquerda/direita. */
      document.documentElement.dir = this.ehDaDireitaParaEsquerda(this._tag) ? 'rtl' : 'ltr';
      const titulo = this.t('app.nome');
      if(titulo && titulo !== 'app.nome') document.title = titulo;
    }
  },

  ehDaDireitaParaEsquerda(tag){
    return /^(ar|he|fa|ur)(-|$)/i.test(String(tag||''));
  },

  /* O idioma em vigor, para quem precisar. */
  get atual(){ return this._tag; },
  nomeDe(tag){
    const i = this.DISPONIVEIS.find(x => x.tag === tag);
    return i ? i.nome : tag;
  },
};

/* Atalho. Fica curto porque vai aparecer umas oitocentas vezes. */
const T = (chave, vars) => Idiomas.t(chave, vars);
