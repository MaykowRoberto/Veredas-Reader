/* ============================================================
   MOTOR LOCAL PDF -> EPUB — integrado a partir do motor fornecido
   ============================================================ */
(() => {
    'use strict';
    class VeredasPDFToEPUB {
        // ======================================================
        // CONFIGURAÇÕES PADRÃO
        // ======================================================
        static DEFAULTS = {
            title: 'Livro Convertido',
            author: '',
            lang: 'pt-BR',
            publisher: '',
            // --------------------------------------------------
            // CAPA
            // --------------------------------------------------
            // Largura máxima da imagem da capa.
            coverMaxWidth: 1600,
            // Qualidade JPEG da capa.
            coverQuality: 0.88,
            // --------------------------------------------------
            // PÁGINAS DE IMAGEM
            // --------------------------------------------------
            // Largura máxima das páginas que precisarem
            // ser preservadas como imagem.
            imagePageMaxWidth: 1400,
            // Qualidade JPEG dessas páginas.
            imagePageQuality: 0.86,
            // --------------------------------------------------
            // DETECÇÃO DE PÁGINAS VAZIAS
            // --------------------------------------------------
            // Tamanho da amostra usada para verificar
            // se uma página aparentemente vazia possui
            // conteúdo visual.
            blankSampleSize: 140,
            // Percentual mínimo de pixels considerados
            // visualmente diferentes do branco.
            blankThreshold: 0.006,
            // --------------------------------------------------
            // RECONSTRUÇÃO DO TEXTO
            // --------------------------------------------------
            // Tolerância vertical para considerar dois
            // fragmentos pertencentes à mesma linha.
            rowToleranceFactor: 0.42,
            // Espaçamento vertical que sugere novo parágrafo.
            paragraphGapFactor: 1.75,
            // Tamanho relativo que sugere título.
            headingFactor: 1.35,
            // Tamanho relativo que sugere título principal.
            strongHeadingFactor: 1.75,
            // Remove páginas completamente vazias.
            removeEmptyPages: true
        };
        // ======================================================
        // MÉTODO PRINCIPAL
        // ======================================================
        static async convert(file, options = {}) {
            this._assertDependencies();
            this._assertPdf(file);
            const cfg = {
                ...this.DEFAULTS,
                ...options
            };
            const setProgress = typeof cfg.onProgress === 'function'
                ? cfg.onProgress
                : () => { };
            // --------------------------------------------------
            // Lê o arquivo
            // --------------------------------------------------
            const arrayBuffer = await file.arrayBuffer();
            // --------------------------------------------------
            // Carrega PDF.js
            // --------------------------------------------------
            const pdf = await pdfjsLib
                .getDocument({
                data: arrayBuffer
            })
                .promise;
            // --------------------------------------------------
            // Extrai e reconstrói o conteúdo
            // --------------------------------------------------
            const data = await this._extractPdf(pdf, cfg, setProgress);
            // --------------------------------------------------
            // Metadados
            // --------------------------------------------------
            const meta = {
                id: this._uuid(),
                title: String(cfg.title ||
                    file.name.replace(/\.pdf$/i, '') ||
                    'Livro Convertido').trim(),
                author: String(cfg.author || '').trim(),
                lang: String(cfg.lang || 'pt-BR').trim() || 'pt-BR',
                publisher: String(cfg.publisher || '').trim()
            };
            setProgress({
                stage: 'epub',
                percent: 72,
                message: 'Reconstruindo o livro…'
            });
            // --------------------------------------------------
            // Cria EPUB
            // --------------------------------------------------
            const epubBuffer = await this._createEpub(meta, data, cfg, setProgress);
            // --------------------------------------------------
            // Blob final
            // --------------------------------------------------
            const blob = new Blob([epubBuffer], {
                type: 'application/epub+zip'
            });
            setProgress({
                stage: 'done',
                percent: 100,
                message: 'Conversão concluída.'
            });
            return {
                blob,
                buffer: epubBuffer,
                filename: `${this._slugify(meta.title)}.epub`,
                coverDataUrl: data.coverDataUrl || '',
                meta,
                stats: {
                    pdfPages: data.numPages,
                    contentPages: data.pages.length,
                    imagePages: data.imagePageCount,
                    ignoredBlankPages: data.ignoredBlankPages,
                    words: data.wordCount
                },
                previewHtml: this._buildPreviewHtml(meta, data)
            };
        }
        // ======================================================
        // VALIDAÇÕES
        // ======================================================
        static _assertDependencies() {
            if (!window.pdfjsLib) {
                throw new Error('PDF.js não foi carregado. ' +
                    'Inclua pdf.min.js antes deste motor.');
            }
            if (!window.JSZip) {
                throw new Error('JSZip não foi carregado. ' +
                    'Inclua jszip.min.js antes deste motor.');
            }
        }
        static _assertPdf(file) {
            if (!file ||
                typeof file.arrayBuffer !== 'function') {
                throw new Error('Forneça um objeto File/Blob contendo o PDF.');
            }
            const name = String(file.name || '').toLowerCase();
            const type = String(file.type || '').toLowerCase();
            if (type &&
                type !== 'application/pdf' &&
                !name.endsWith('.pdf')) {
                throw new Error('O arquivo selecionado não parece ser um PDF.');
            }
        }
        // ======================================================
        // UTILITÁRIOS
        // ======================================================
        static _uuid() {
            if (globalThis.crypto &&
                typeof globalThis.crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
            return (`${Date.now()}-` +
                `${Math.random().toString(16).slice(2)}-` +
                `${Math.random().toString(16).slice(2)}`);
        }
        static _escapeXml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }
        static _escapeHtml(value) {
            return this._escapeXml(value);
        }
        static _slugify(value) {
            return String(value || 'livro')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 90)
                || 'livro';
        }
        static _safeId(text) {
            return this
                ._slugify(text)
                .replace(/-/g, '_')
                .slice(0, 40)
                || 'heading';
        }
        // ======================================================
        // EXTRAÇÃO DO PDF
        // ======================================================
        static async _extractPdf(pdf, cfg, setProgress) {
            const pages = [];
            let wordCount = 0;
            let imagePageCount = 0;
            let ignoredBlankPages = 0;
            let coverDataUrl = '';
            // --------------------------------------------------
            // Percorre todas as páginas
            // --------------------------------------------------
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const progress = ((pageNumber - 1) /
                    Math.max(1, pdf.numPages)) * 68;
                setProgress({
                    stage: 'pdf',
                    percent: progress,
                    message: `Lendo página ${pageNumber} ` +
                        `de ${pdf.numPages}…`
                });
                const page = await pdf.getPage(pageNumber);
                // ==================================================
                // PRIMEIRA PÁGINA = CAPA
                // ==================================================
                if (pageNumber === 1) {
                    const cover = await this._renderPageImage(page, cfg.coverMaxWidth, cfg.coverQuality);
                    coverDataUrl =
                        cover.dataUrl;
                    // Importante:
                    // não manda o texto da capa para o conteúdo.
                    continue;
                }
                // ==================================================
                // EXTRAÇÃO DO TEXTO
                // ==================================================
                const textContent = await page.getTextContent({
                    normalizeWhitespace: true,
                    disableCombineTextItems: false
                });
                const textItems = Array.isArray(textContent.items)
                    ? textContent.items
                        .filter(item => String(item?.str || '').trim())
                    : [];
                // ==================================================
                // EXISTE TEXTO
                // ==================================================
                if (textItems.length) {
                    const grouped = this._groupPage(textContent.items, cfg);
                    if (grouped.blocks.length) {
                        pages.push({
                            number: pageNumber,
                            blocks: grouped.blocks
                        });
                        wordCount +=
                            grouped.wordCount;
                        continue;
                    }
                }
                // ==================================================
                // NÃO HÁ TEXTO
                // ==================================================
                // Se o comportamento configurado permitir,
                // mantém a página como imagem.
                if (!cfg.removeEmptyPages) {
                    const rendered = await this._renderPageImage(page, cfg.imagePageMaxWidth, cfg.imagePageQuality);
                    pages.push({
                        number: pageNumber,
                        blocks: [
                            {
                                type: 'image',
                                src: rendered.dataUrl,
                                alt: `Página ${pageNumber}`
                            }
                        ]
                    });
                    imagePageCount++;
                    continue;
                }
                // ==================================================
                // VERIFICA VISUALMENTE A PÁGINA
                // ==================================================
                const rendered = await this._renderPageImage(page, cfg.imagePageMaxWidth, cfg.imagePageQuality);
                // Existe alguma coisa visual relevante?
                if (this._canvasHasVisibleContent(rendered.canvas, cfg)) {
                    pages.push({
                        number: pageNumber,
                        blocks: [
                            {
                                type: 'image',
                                src: rendered.dataUrl,
                                alt: `Ilustração ou página ${pageNumber}`
                            }
                        ]
                    });
                    imagePageCount++;
                }
                else {
                    // Página realmente vazia:
                    // não entra no EPUB.
                    ignoredBlankPages++;
                }
            }
            return {
                numPages: pdf.numPages,
                pages,
                wordCount,
                imagePageCount,
                ignoredBlankPages,
                coverDataUrl
            };
        }
        // ======================================================
        // NORMALIZA ITEMS DO PDF.JS
        // ======================================================
        static _normalizeItems(items) {
            return items
                .filter(item => typeof item?.str === 'string' &&
                item.str.trim())
                .map(item => {
                const t = item.transform ||
                    [1, 0, 0, 1, 0, 0];
                const fontSize = Math.hypot(t[0], t[1])
                    ||
                        Math.hypot(t[2], t[3])
                    ||
                        10;
                return {
                    str: item.str.trim(),
                    x: Number(t[4] || 0),
                    y: Number(t[5] || 0),
                    w: Number(item.width || 0),
                    h: Math.abs(Number(item.height ||
                        fontSize)) || fontSize,
                    fontSize
                };
            });
        }
        // ======================================================
        // RECONSTRUÇÃO DE LINHAS / PARÁGRAFOS
        // ======================================================
        static _groupPage(items, cfg) {
            const clean = this._normalizeItems(items);
            if (!clean.length) {
                return {
                    blocks: [],
                    wordCount: 0
                };
            }
            // --------------------------------------------------
            // Tamanho médio das fontes
            // --------------------------------------------------
            const sortedSizes = clean
                .map(item => item.fontSize)
                .sort((a, b) => a - b);
            const medianSize = sortedSizes[Math.floor(sortedSizes.length / 2)] || 12;
            const tolerance = Math.max(2.5, medianSize *
                cfg.rowToleranceFactor);
            // --------------------------------------------------
            // Agrupa os fragmentos em linhas
            // --------------------------------------------------
            const rows = [];
            for (const item of clean) {
                let row = rows.find(r => Math.abs(r.y -
                    item.y) <= tolerance);
                if (!row) {
                    row = {
                        y: item.y,
                        items: []
                    };
                    rows.push(row);
                }
                row.items.push(item);
                // Recalcula a posição média
                row.y =
                    row.items.reduce((sum, current) => sum +
                        current.y, 0) /
                        row.items.length;
            }
            // PDF usa coordenadas que crescem
            // de baixo para cima.
            rows.sort((a, b) => b.y - a.y);
            // --------------------------------------------------
            // Converte rows em linhas de texto
            // --------------------------------------------------
            const lines = rows
                .map(row => {
                row.items.sort((a, b) => a.x - b.x);
                let text = '';
                let prev = null;
                for (const item of row.items) {
                    const gap = prev
                        ? item.x -
                            (prev.x +
                                prev.w)
                        : 0;
                    const left = /^[\p{L}\p{N}]/u
                        .test(item.str);
                    const right = prev &&
                        /[\p{L}\p{N}]$/u
                            .test(prev.str);
                    const addSpace = prev &&
                        left &&
                        right &&
                        gap >
                            Math.max(1, medianSize *
                                0.08);
                    text +=
                        (addSpace
                            ? ' '
                            : '') +
                            item.str;
                    prev = item;
                }
                return {
                    text: text
                        .replace(/\s+/g, ' ')
                        .trim(),
                    y: row.y,
                    x: row.items[0]?.x ||
                        0,
                    fontSize: row.items.reduce((sum, item) => sum +
                        item.fontSize, 0) /
                        row.items.length
                };
            })
                .filter(line => line.text);
            if (!lines.length) {
                return {
                    blocks: [],
                    wordCount: 0
                };
            }
            // --------------------------------------------------
            // Detecta fonte base
            // --------------------------------------------------
            const bodySizes = lines
                .map(line => line.fontSize)
                .sort((a, b) => a - b);
            const base = bodySizes[Math.floor(bodySizes.length / 2)] || medianSize;
            // --------------------------------------------------
            // Detecta títulos
            // --------------------------------------------------
            const isHeading = line => {
                const strongWords = /^(cap[ií]tulo|chapter|parte|se[cç][aã]o|sess[aã]o|introdu[cç][aã]o|conclus[aã]o|pref[aá]cio|sum[aá]rio|bibliografia|refer[eê]ncias|ap[eê]ndice)\b/i;
                return (line.fontSize >=
                    base *
                        cfg.headingFactor)
                    ||
                        (strongWords.test(line.text)
                            &&
                                line.text.length <
                                    120);
            };
            const blocks = [];
            let current = null;
            // --------------------------------------------------
            // Monta parágrafos
            // --------------------------------------------------
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const next = lines[i + 1];
                const gap = next
                    ? Math.abs(line.y -
                        next.y)
                    : 0;
                const heading = isHeading(line);
                // ------------------------------------------------
                // Decide se começa um novo parágrafo
                // ------------------------------------------------
                const likelyNewParagraph = !current ||
                    gap >
                        Math.max(base *
                            cfg.paragraphGapFactor, 14) ||
                    heading ||
                    (current &&
                        /[.!?:;”")]$/.test(current.lines[current.lines.length - 1]) &&
                        line.x <=
                            current.firstX +
                                base * 1.8 &&
                        gap >
                            base * 0.9);
                // ------------------------------------------------
                // Título
                // ------------------------------------------------
                if (heading) {
                    blocks.push({
                        type: line.fontSize >=
                            base *
                                cfg.strongHeadingFactor
                            ? 'h1'
                            : 'h2',
                        text: line.text
                    });
                    current = null;
                    continue;
                }
                // ------------------------------------------------
                // Novo parágrafo
                // ------------------------------------------------
                if (likelyNewParagraph) {
                    current = {
                        type: 'p',
                        lines: [
                            line.text
                        ],
                        firstX: line.x
                    };
                    blocks.push(current);
                }
                else {
                    // Continuação do parágrafo.
                    current.lines.push(line.text);
                }
            }
            // --------------------------------------------------
            // Finaliza os blocos
            // --------------------------------------------------
            const finalBlocks = blocks
                .map(block => block.type === 'p'
                ? {
                    type: 'p',
                    text: block.lines
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                }
                : block)
                .filter(block => block.text);
            // --------------------------------------------------
            // Contagem de palavras
            // --------------------------------------------------
            const words = finalBlocks.reduce((total, block) => {
                return (total +
                    block.text
                        .split(/\s+/)
                        .filter(Boolean)
                        .length);
            }, 0);
            return {
                blocks: finalBlocks,
                wordCount: words
            };
        }
        // ======================================================
        // RENDERIZA UMA PÁGINA DO PDF COMO IMAGEM
        // ======================================================
        static async _renderPageImage(page, maxWidth, quality) {
            const baseViewport = page.getViewport({
                scale: 1
            });
            // Mantém a escala em faixa
            // razoável para evitar imagens gigantes.
            const scale = Math.min(2, Math.max(1, maxWidth /
                baseViewport.width));
            const viewport = page.getViewport({
                scale
            });
            const canvas = document.createElement('canvas');
            canvas.width =
                Math.ceil(viewport.width);
            canvas.height =
                Math.ceil(viewport.height);
            const context = canvas.getContext('2d', {
                alpha: false,
                willReadFrequently: true
            });
            await page.render({
                canvasContext: context,
                viewport,
                background: '#ffffff'
            }).promise;
            return {
                canvas,
                dataUrl: canvas.toDataURL('image/jpeg', quality)
            };
        }
        // ======================================================
        // VERIFICA SE UMA PÁGINA É REALMENTE VAZIA
        // ======================================================
        static _canvasHasVisibleContent(canvas, cfg) {
            const sourceWidth = canvas.width;
            const sourceHeight = canvas.height;
            if (!sourceWidth ||
                !sourceHeight) {
                return false;
            }
            const sampleSize = cfg.blankSampleSize;
            const width = Math.min(sampleSize, sourceWidth);
            const height = Math.min(sampleSize, sourceHeight);
            // Pequena tela para análise.
            const sample = document.createElement('canvas');
            sample.width =
                width;
            sample.height =
                height;
            const context = sample.getContext('2d', {
                willReadFrequently: true
            });
            context.drawImage(canvas, 0, 0, width, height);
            const pixels = context.getImageData(0, 0, width, height).data;
            let visible = 0;
            const total = width *
                height;
            // --------------------------------------------------
            // Analisa pixels
            // --------------------------------------------------
            for (let i = 0; i < pixels.length; i += 4) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];
                if (a > 8 &&
                    (255 -
                        Math.max(r, g, b) > 14
                        ||
                            Math.abs(r - g) > 10
                        ||
                            Math.abs(g - b) > 10)) {
                    visible++;
                }
            }
            return (visible /
                total) >=
                cfg.blankThreshold;
        }
        // ======================================================
        // ESTILOS DO EPUB
        // ======================================================
        static _styles() {
            return `

body{
    font-family:
        Georgia,
        "Times New Roman",
        serif;

    line-height:
        1.7;

    margin:
        0 auto;

    padding:
        0 6%;

    max-width:
        46em;

    color:
        #222;
}

h1{
    font-size:
        2em;

    line-height:
        1.15;

    margin:
        0 0 .65em;
}

h2{
    font-size:
        1.35em;

    line-height:
        1.25;

    margin:
        1.8em 0 .65em;
}

p{
    margin:
        .9em 0;
}

.cover-page{
    margin:
        0;

    padding:
        0;

    max-width:
        none;

    text-align:
        center;

    background:
        #fff;
}

.cover-image{
    display:
        block;

    width:
        auto;

    height:
        100vh;

    max-width:
        100%;

    margin:
        0 auto;

    object-fit:
        contain;
}

.frontmatter{
    min-height:
        70vh;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        center;

    text-align:
        center;
}

.frontmatter h1{
    font-size:
        2.4em;
}

.author{
    font-style:
        italic;

    color:
        #555;
}

.content-page{
    margin:
        0;

    padding:
        0;
}

.embedded-page-image{
    margin:
        1.4em 0;

    text-align:
        center;
}

.embedded-page-image img{
    display:
        block;

    max-width:
        100%;

    height:
        auto;

    margin:
        0 auto;
}

nav ol{
    line-height:
        1.8;
}

`;
        }
        // ======================================================
        // COLETA TÍTULOS
        // ======================================================
        static _collectHeadings(data) {
            const headings = [];
            let counter = 0;
            for (const page of data.pages) {
                for (const block of page.blocks || []) {
                    if (block.type === 'h1' ||
                        block.type === 'h2') {
                        counter++;
                        headings.push({
                            id: `heading-${counter}`,
                            text: block.text,
                            type: block.type
                        });
                    }
                }
            }
            return headings;
        }
        // ======================================================
        // COVER.XHTML
        // ======================================================
        static _buildCoverXhtml(meta) {
            return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:epub="http://www.idpf.org/2007/ops"
    lang="${this._escapeXml(meta.lang)}">

<head>
    <meta charset="utf-8"/>
    <title>
        ${this._escapeXml(meta.title)}
    </title>

    <link
        rel="stylesheet"
        type="text/css"
        href="styles.css"/>
</head>

<body class="cover-page">

    <img
        class="cover-image"
        src="cover.jpg"
        alt="Capa de ${this._escapeXml(meta.title)}"
        epub:type="cover"/>

</body>

</html>`;
        }
        // ======================================================
        // BOOK.XHTML
        // ======================================================
        static _buildBookXhtml(meta, data) {
            const body = [];
            // --------------------------------------------------
            // Folha inicial com título
            // --------------------------------------------------
            body.push(`<section class="frontmatter" id="top">` +
                `<h1>` +
                this._escapeHtml(meta.title) +
                `</h1>` +
                (meta.author
                    ? `<p class="author">` +
                        this._escapeHtml(meta.author) +
                        `</p>`
                    : '') +
                `</section>`);
            let headingIndex = 0;
            let imageIndex = 0;
            // --------------------------------------------------
            // Conteúdo
            // --------------------------------------------------
            for (const page of data.pages) {
                for (const block of page.blocks || []) {
                    // ------------------------------------------
                    // Títulos
                    // ------------------------------------------
                    if (block.type === 'h1' ||
                        block.type === 'h2') {
                        headingIndex++;
                        body.push(`<${block.type} ` +
                            `id="heading-${headingIndex}">` +
                            this._escapeHtml(block.text) +
                            `</${block.type}>`);
                        continue;
                    }
                    // ------------------------------------------
                    // Imagens
                    // ------------------------------------------
                    if (block.type === 'image') {
                        imageIndex++;
                        const fileName = block.epubFile ||
                            `page-image-${imageIndex}.jpg`;
                        body.push(`<figure ` +
                            `class="embedded-page-image">` +
                            `<img ` +
                            `src="${this._escapeXml(fileName)}" ` +
                            `alt="${this._escapeHtml(block.alt ||
                                'Imagem')}"/>` +
                            `</figure>`);
                        continue;
                    }
                    // ------------------------------------------
                    // Parágrafo
                    // ------------------------------------------
                    if (block.type === 'p' &&
                        block.text) {
                        body.push(`<p>` +
                            this._escapeHtml(block.text) +
                            `</p>`);
                    }
                }
            }
            return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html
    xmlns="http://www.w3.org/1999/xhtml"
    lang="${this._escapeXml(meta.lang)}">

<head>

    <meta charset="utf-8"/>

    <title>
        ${this._escapeHtml(meta.title)}
    </title>

    <link
        rel="stylesheet"
        type="text/css"
        href="styles.css"/>

</head>

<body>

    ${body.join('')}

</body>

</html>`;
        }
        // ======================================================
        // NAV.XHTML
        // ======================================================
        static _buildNav(meta, data) {
            const headings = this._collectHeadings(data);
            const entries = (headings.length
                ? headings
                : [
                    {
                        id: 'top',
                        text: 'Início'
                    }
                ])
                .map(heading => `<li>` +
                `<a href="book.xhtml#${heading.id}">` +
                this._escapeHtml(heading.text) +
                `</a>` +
                `</li>`)
                .join('');
            return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html
    xmlns="http://www.w3.org/1999/xhtml"
    xmlns:epub="http://www.idpf.org/2007/ops"
    lang="${this._escapeXml(meta.lang)}">

<head>

    <title>
        Sumário
    </title>

</head>

<body>

    <nav
        epub:type="toc"
        id="toc">

        <h1>
            Sumário
        </h1>

        <ol>
            ${entries}
        </ol>

    </nav>

</body>

</html>`;
        }
        // ======================================================
        // TOC.NCX
        // ======================================================
        static _buildNcx(meta, data) {
            const headings = this._collectHeadings(data);
            const points = (headings.length
                ? headings
                : [
                    {
                        id: 'top',
                        text: 'Início'
                    }
                ])
                .map((heading, index) => `<navPoint ` +
                `id="nav-${index + 1}" ` +
                `playOrder="${index + 1}">` +
                `<navLabel>` +
                `<text>` +
                this._escapeXml(heading.text) +
                `</text>` +
                `</navLabel>` +
                `<content ` +
                `src="book.xhtml#${heading.id}"/>` +
                `</navPoint>`)
                .join('');
            return `<?xml version="1.0" encoding="UTF-8"?>
<ncx
    xmlns="http://www.daisy.org/z3986/2005/ncx/"
    version="2005-1"
    xml:lang="${this._escapeXml(meta.lang)}">

<head>

    <meta
        name="dtb:uid"
        content="urn:uuid:${meta.id}"/>

</head>

<docTitle>

    <text>
        ${this._escapeXml(meta.title)}
    </text>

</docTitle>

<navMap>

    ${points}

</navMap>

</ncx>`;
        }
        // ======================================================
        // CONTENT.OPF
        // ======================================================
        static _buildOpf(meta, data) {
            const images = [];
            let imageIndex = 0;
            // --------------------------------------------------
            // Imagens internas
            // --------------------------------------------------
            for (const page of data.pages) {
                for (const block of page.blocks || []) {
                    if (block.type === 'image') {
                        imageIndex++;
                        block.epubFile =
                            block.epubFile ||
                                `page-image-${imageIndex}.jpg`;
                        images.push(`<item ` +
                            `id="page-image-${imageIndex}" ` +
                            `href="${this._escapeXml(block.epubFile)}" ` +
                            `media-type="image/jpeg"/>`);
                    }
                }
            }
            const modified = new Date()
                .toISOString()
                .replace(/\.\d{3}Z$/, 'Z');
            return `<?xml version="1.0" encoding="utf-8"?>

<package
    xmlns="http://www.idpf.org/2007/opf"
    version="3.0"
    unique-identifier="pub-id">

    <metadata
        xmlns:dc="http://purl.org/dc/elements/1.1/">

        <dc:identifier id="pub-id">
            urn:uuid:${meta.id}
        </dc:identifier>

        <dc:title>
            ${this._escapeXml(meta.title)}
        </dc:title>

        ${meta.author
                ? `<dc:creator>
                    ${this._escapeXml(meta.author)}
                   </dc:creator>`
                : ''}

        <dc:language>
            ${this._escapeXml(meta.lang)}
        </dc:language>

        ${meta.publisher
                ? `<dc:publisher>
                    ${this._escapeXml(meta.publisher)}
                   </dc:publisher>`
                : ''}

        <meta
            name="cover"
            content="cover-image"/>

        <meta
            property="dcterms:modified">
            ${modified}
        </meta>

    </metadata>


    <manifest>

        <item
            id="cover-page"
            href="cover.xhtml"
            media-type="application/xhtml+xml"/>

        <item
            id="cover-image"
            href="cover.jpg"
            media-type="image/jpeg"
            properties="cover-image"/>

        <item
            id="book"
            href="book.xhtml"
            media-type="application/xhtml+xml"/>

        <item
            id="nav"
            href="nav.xhtml"
            media-type="application/xhtml+xml"
            properties="nav"/>

        <item
            id="ncx"
            href="toc.ncx"
            media-type="application/x-dtbncx+xml"/>

        <item
            id="css"
            href="styles.css"
            media-type="text/css"/>

        ${images.join('\n        ')}

    </manifest>


    <spine toc="ncx">

        <itemref
            idref="cover-page"/>

        <itemref
            idref="book"/>

    </spine>

</package>`;
        }
        // ======================================================
        // GERA O EPUB
        // ======================================================
        static async _createEpub(meta, data, cfg, setProgress) {
            const zip = new JSZip();
            // --------------------------------------------------
            // MIME TYPE
            // --------------------------------------------------
            // O padrão EPUB exige que o arquivo
            // mimetype seja armazenado sem compressão.
            zip.file('mimetype', 'application/epub+zip', {
                compression: 'STORE'
            });
            // --------------------------------------------------
            // CONTAINER.XML
            // --------------------------------------------------
            zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>

<container
    version="1.0"
    xmlns="urn:oasis:names:tc:opendocument:xmlns:container">

    <rootfiles>

        <rootfile
            full-path="OEBPS/content.opf"
            media-type="application/oebps-package+xml"/>

    </rootfiles>

</container>`);
            const oebps = zip.folder('OEBPS');
            // --------------------------------------------------
            // CAPA
            // --------------------------------------------------
            const coverBase64 = data.coverDataUrl
                ? data.coverDataUrl.split(',')[1]
                : '';
            if (!coverBase64) {
                throw new Error('Não foi possível gerar a capa ' +
                    'a partir da primeira página do PDF.');
            }
            // --------------------------------------------------
            // DEFINE IMAGENS
            // --------------------------------------------------
            let imageCounter = 0;
            for (const page of data.pages) {
                for (const block of page.blocks || []) {
                    if (block.type === 'image') {
                        imageCounter++;
                        block.epubFile =
                            `page-image-${imageCounter}.jpg`;
                    }
                }
            }
            // --------------------------------------------------
            // ARQUIVOS EPUB
            // --------------------------------------------------
            oebps.file('content.opf', this._buildOpf(meta, data));
            oebps.file('cover.xhtml', this._buildCoverXhtml(meta));
            oebps.file('cover.jpg', coverBase64, {
                base64: true
            });
            oebps.file('book.xhtml', this._buildBookXhtml(meta, data));
            oebps.file('nav.xhtml', this._buildNav(meta, data));
            oebps.file('toc.ncx', this._buildNcx(meta, data));
            oebps.file('styles.css', this._styles());
            // --------------------------------------------------
            // IMAGENS DE PÁGINAS
            // --------------------------------------------------
            for (const page of data.pages) {
                for (const block of page.blocks || []) {
                    if (block.type === 'image' &&
                        block.src &&
                        block.epubFile) {
                        oebps.file(block.epubFile, block.src.split(',')[1], {
                            base64: true
                        });
                    }
                }
            }
            setProgress({
                stage: 'epub',
                percent: 84,
                message: 'Compactando EPUB…'
            });
            // --------------------------------------------------
            // ZIP FINAL
            // --------------------------------------------------
            return zip.generateAsync({
                type: 'arraybuffer',
                compression: 'DEFLATE',
                compressionOptions: {
                    level: 6
                }
            }, metadata => {
                setProgress({
                    stage: 'epub',
                    percent: 84 +
                        (metadata.percent *
                            0.16),
                    message: 'Compactando EPUB…'
                });
            });
        }
        // ======================================================
        // PRÉVIA OPCIONAL
        // ======================================================
        static _buildPreviewHtml(meta, data) {
            const parts = [];
            // --------------------------------------------------
            // Capa
            // --------------------------------------------------
            if (data.coverDataUrl) {
                parts.push(`<div ` +
                    `class="veredas-preview-cover">` +
                    `<img ` +
                    `src="${this._escapeHtml(data.coverDataUrl)}" ` +
                    `alt="Capa"/>` +
                    `</div>`);
            }
            // --------------------------------------------------
            // Título
            // --------------------------------------------------
            parts.push(`<div ` +
                `class="veredas-preview-front">` +
                `<h1>` +
                this._escapeHtml(meta.title) +
                `</h1>`);
            if (meta.author) {
                parts.push(`<p>` +
                    `<em>` +
                    this._escapeHtml(meta.author) +
                    `</em>` +
                    `</p>`);
            }
            parts.push('</div>');
            // --------------------------------------------------
            // Conteúdo
            // --------------------------------------------------
            for (const page of data.pages) {
                for (const block of page.blocks || []) {
                    if (block.type === 'image') {
                        parts.push(`<figure>` +
                            `<img ` +
                            `src="${this._escapeHtml(block.src)}" ` +
                            `alt="${this._escapeHtml(block.alt ||
                                'Imagem')}"/>` +
                            `</figure>`);
                    }
                    else {
                        parts.push(`<${block.type}>` +
                            this._escapeHtml(block.text) +
                            `</${block.type}>`);
                    }
                }
            }
            return parts.join('');
        }
    }
    // ==========================================================
    // EXPORTAÇÃO GLOBAL
    // ==========================================================
    window.VeredasPDFToEPUB =
        VeredasPDFToEPUB;
})();
