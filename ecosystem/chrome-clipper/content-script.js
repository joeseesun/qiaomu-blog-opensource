/**
 * Qiaomu Blog Clipper - Content Script
 * Injected into the active tab to extract article content via Readability,
 * then convert to Markdown via Turndown.
 * Returns { title, markdown, images, url } back to the caller.
 */

(function () {
  try {
    // 1. Extract article with Readability
    const documentClone = document.cloneNode(true);
    const article = new Readability(documentClone).parse();

    const title = article ? (article.title || document.title) : document.title;
    const htmlContent = article ? article.content : document.body.innerHTML;
    const pageUrl = location.href;

    // 2. Convert HTML to Markdown with Turndown
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      bulletListMarker: '-',
    });

    // Keep iframes as links
    turndownService.addRule('iframe', {
      filter: 'iframe',
      replacement: function (content, node) {
        var src = node.getAttribute('src') || '';
        return src ? '\n\n[嵌入视频](' + src + ')\n\n' : '';
      },
    });

    // ---- GFM table support ----
    // turndown 基础版没有表格规则,这里手写把 <table> 转成 GFM markdown
    function cellText(cell) {
      var text = (cell.innerText || cell.textContent || '').trim();
      // 单元格内换行会破坏 GFM 表格,统一替换成空格
      text = text.replace(/\s*\n+\s*/g, ' ');
      // 转义 | 字符,避免破坏表格列分隔
      text = text.replace(/\|/g, '\\|');
      return text;
    }

    function buildRow(cells) {
      var parts = [];
      for (var i = 0; i < cells.length; i++) {
        parts.push(cellText(cells[i]));
      }
      return '| ' + parts.join(' | ') + ' |';
    }

    turndownService.addRule('gfmTable', {
      filter: 'table',
      replacement: function (content, node) {
        var rows = node.rows;
        if (!rows || rows.length === 0) return '';

        var headerCells = [];
        var bodyRows = [];
        var firstRow = rows[0];
        var firstRowIsHeader = false;
        if (firstRow && firstRow.cells.length > 0) {
          firstRowIsHeader = true;
          for (var i = 0; i < firstRow.cells.length; i++) {
            if (firstRow.cells[i].tagName !== 'TH') {
              firstRowIsHeader = false;
              break;
            }
          }
        }

        var startIdx;
        if (firstRowIsHeader) {
          for (var j = 0; j < firstRow.cells.length; j++) {
            headerCells.push(firstRow.cells[j]);
          }
          startIdx = 1;
        } else {
          // 没有 thead/th,用第一行当 header
          if (firstRow) {
            for (var k = 0; k < firstRow.cells.length; k++) {
              headerCells.push(firstRow.cells[k]);
            }
          }
          startIdx = 1;
        }

        var colCount = headerCells.length;
        if (colCount === 0) return '';

        for (var r = startIdx; r < rows.length; r++) {
          var cells = rows[r].cells;
          var rowCells = [];
          for (var c = 0; c < colCount; c++) {
            rowCells.push(cells[c] ? cells[c] : { innerText: '', textContent: '', tagName: 'TD' });
          }
          bodyRows.push(rowCells);
        }

        var out = '\n\n' + buildRow(headerCells) + '\n';
        var seps = [];
        for (var s = 0; s < colCount; s++) seps.push('---');
        out += '| ' + seps.join(' | ') + ' |\n';
        for (var b = 0; b < bodyRows.length; b++) {
          out += buildRow(bodyRows[b]) + '\n';
        }
        return out + '\n';
      },
    });

    // table 内部元素交给 gfmTable 统一处理,避免被默认规则递归成普通文本
    turndownService.addRule('tableParts', {
      filter: ['thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col'],
      replacement: function () {
        return '';
      },
    });

    var markdown = turndownService.turndown(htmlContent);

    // Prepend source URL
    markdown = '> 原文: [' + title + '](' + pageUrl + ')\n\n' + markdown;

    // 3. Collect all image URLs from the markdown
    var images = [];
    var seen = {};

    // Markdown image syntax: ![alt](url)
    var mdRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    var m;
    while ((m = mdRegex.exec(markdown)) !== null) {
      var url = m[2];
      if (!seen[url]) {
        seen[url] = true;
        images.push(url);
      }
    }

    // Also check for leftover <img> tags
    var imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    while ((m = imgRegex.exec(markdown)) !== null) {
      var url = m[1];
      if (!seen[url]) {
        seen[url] = true;
        images.push(url);
      }
    }

    return {
      title: title,
      markdown: markdown,
      images: images,
      url: pageUrl,
    };
  } catch (err) {
    // Fallback: return raw content
    return {
      title: document.title,
      markdown: document.body.innerText,
      images: [],
      url: location.href,
      error: err.message,
    };
  }
})();
