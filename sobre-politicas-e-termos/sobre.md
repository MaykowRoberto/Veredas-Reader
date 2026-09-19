\# Veredas Reader



> \*\*Leitor de livros digitais, quadrinhos e audiolivros que funciona inteiramente no seu dispositivo.\*\*



O \*\*Veredas Reader\*\* abre arquivos \*\*EPUB, MOBI, PDF, TXT, MD e DOCX\*\*, lê quadrinhos em \*\*CBZ, CBR, CB7 e CBT\*\*, toca audiolivros em \*\*MP3 e M4B\*\*, reproduz vídeos em \*\*MP4\*\*, mantém sua estante offline e preserva marcações, citações, anotações e progresso de leitura.



\## ✨ O que ele faz



\- \*\*Importação e leitura offline:\*\* importa livros do seu aparelho e mantém uma cópia local para leitura sem internet.

\- \*\*Organização da estante:\*\* organiza por status, coleções, séries, autores e tags.

\- \*\*Anotações e marcações:\*\* permite grifar trechos, criar citações, anotações e marcadores.

\- \*\*Personalização da leitura:\*\* ajusta tema, tipografia, espaçamento, margens, brilho e modo de virada de página.

\- \*\*Quadrinhos:\*\* zoom por pinça e por duplo toque, revista aberta (duas páginas) no modo paisagem, sentido mangá (direita para a esquerda) e rolagem contínua estilo webtoon. Título, série, autor e capa são lidos do próprio arquivo quando ele traz um \*ComicInfo.xml\*.

\- \*\*Leitura em voz alta:\*\* lê o texto usando as vozes disponíveis no dispositivo.

\- \*\*Audiolivros:\*\* reproduz capítulos, marcadores, velocidade ajustável, timer de sono e retomada exata de onde você parou.

\- \*\*Conversão local:\*\* converte PDF em EPUB localmente, sem enviar o arquivo para lugar nenhum.



\## 🧩 Tecnologia



O aplicativo é uma PWA: depois do primeiro carregamento, funciona sem internet. Todo o conteúdo fica armazenado no navegador do próprio aparelho.



Quadrinhos em \*\*CBZ\*\* são lidos com o JSZip, que o aplicativo já usa para EPUB. Quadrinhos em \*\*CBR, CB7 e CBT\*\* usam o \*\*libarchive\*\* compilado para WebAssembly, que acompanha o aplicativo em \`vendor/libarchive/libarchive-embutido.js\` e só é carregado quando você abre um arquivo desse tipo. Esse arquivo é autossuficiente de propósito: assim o leitor de CBR funciona igualmente bem com o aplicativo aberto direto do disco ou servido por um servidor. As licenças estão em \*\*Sobre > Licenças de código aberto\*\*.



\## 🔒 Privacidade



Tudo acontece no seu dispositivo. Seus livros, sua estante e suas anotações permanecem com você.
