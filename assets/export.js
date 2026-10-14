/* Table exports — CSV, Excel (.xlsx) and PDF — written in the browser with no
   libraries, so they work offline and need no build step.

   MedKitsExport.download(format, {
     title:    "Pick list",                 // heading in the PDF, sheet name in Excel
     subtitle: "12 items · 13 Oct 2026",    // second line of the PDF heading
     filename: "medkits_picklist_…",        // without extension
     columns:  [{ key, label, type: "text"|"number", pdfWidth, xlsxWidth }],
     rows:     [{ key: value, … }]
   });
*/
(function () {
  "use strict";

  /* ── Shared ── */
  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function cellText(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  /* ── CSV ── */
  function csvField(value) {
    var s = cellText(value);
    return /[",;\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(doc) {
    var lines = [doc.columns.map(function (c) { return csvField(c.label); }).join(",")];
    doc.rows.forEach(function (row) {
      lines.push(doc.columns.map(function (c) { return csvField(row[c.key]); }).join(","));
    });
    // The byte-order mark makes Excel read the file as UTF-8 rather than ANSI.
    return new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  }

  /* ── XLSX: a minimal Office Open XML workbook in an uncompressed zip ── */
  function xmlEscape(text) {
    return cellText(text)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      // Control characters are not allowed in XML 1.0 at all.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  }

  function columnLetter(index) {
    var s = "";
    for (var n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    }
    return s;
  }

  function sheetXml(doc) {
    var last = columnLetter(doc.columns.length - 1);
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      // Keep the header row in view while scrolling.
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" ' +
      'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>';
    doc.columns.forEach(function (c, i) {
      x += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' +
        (c.xlsxWidth || 14) + '" customWidth="1"/>';
    });
    x += "</cols><sheetData>";

    function cell(ref, value, column, header) {
      if (!header && column.type === "number" && value !== "" && value !== null &&
          value !== undefined && !isNaN(Number(value))) {
        return '<c r="' + ref + '" s="2"><v>' + Number(value) + "</v></c>";
      }
      return '<c r="' + ref + '" t="inlineStr" s="' + (header ? 1 : 2) + '"><is><t xml:space="preserve">' +
        xmlEscape(value) + "</t></is></c>";
    }

    x += '<row r="1">';
    doc.columns.forEach(function (c, i) { x += cell(columnLetter(i) + "1", c.label, c, true); });
    x += "</row>";
    doc.rows.forEach(function (row, r) {
      x += '<row r="' + (r + 2) + '">';
      doc.columns.forEach(function (c, i) {
        x += cell(columnLetter(i) + (r + 2), row[c.key], c, false);
      });
      x += "</row>";
    });
    x += "</sheetData>";
    if (doc.rows.length) {
      x += '<autoFilter ref="A1:' + last + (doc.rows.length + 1) + '"/>';
    }
    // Landscape, fitted to the page width, header row repeated (see workbook).
    x += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      "</worksheet>";
    return x;
  }

  function sheetName(title) {
    // Excel sheet names: at most 31 characters, none of : \ / ? * [ ]
    return (cellText(title).replace(/[:\\\/?*\[\]]/g, " ").trim() || "Sheet1").slice(0, 31);
  }

  function buildXlsx(doc) {
    var name = xmlEscape(sheetName(doc.title));
    var files = [
      ["[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>"],
      ["_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>"],
      ["xl/workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="' + name + '" sheetId="1" r:id="rId1"/></sheets>' +
        '<definedNames>' +
        (doc.rows.length ? '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' +
          name.replace(/'/g, "''") + "'!$A$1:$" + columnLetter(doc.columns.length - 1) + "$" +
          (doc.rows.length + 1) + "</definedName>" : "") +
        '<definedName name="_xlnm.Print_Titles" localSheetId="0">\'' +
        name.replace(/'/g, "''") + "'!$1:$1</definedName></definedNames></workbook>"],
      ["xl/_rels/workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>"],
      // Style 0: default. 1: bold header on grey with a border. 2: wrapped, top-aligned body cell.
      ["xl/styles.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color rgb="FFC4C8CF"/></left><right style="thin"><color rgb="FFC4C8CF"/></right>' +
        '<top style="thin"><color rgb="FFC4C8CF"/></top><bottom style="thin"><color rgb="FFC4C8CF"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1">' +
        '<alignment vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
        '<alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        "</styleSheet>"],
      ["xl/worksheets/sheet1.xml", sheetXml(doc)],
    ];
    return new Blob([zipStore(files)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* A zip with every entry stored uncompressed — valid, and all an .xlsx needs. */
  function zipStore(entries) {
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    var chunks = [];
    var central = [];
    var offset = 0;

    function header(size) {
      var buf = new ArrayBuffer(size);
      return { view: new DataView(buf), bytes: new Uint8Array(buf) };
    }

    entries.forEach(function (entry) {
      var name = utf8(entry[0]);
      var data = utf8(entry[1]);
      var crc = crc32(data);

      var local = header(30);
      local.view.setUint32(0, 0x04034b50, true);
      local.view.setUint16(4, 20, true);        // version needed
      local.view.setUint16(6, 0x0800, true);    // UTF-8 names
      local.view.setUint16(8, 0, true);         // stored
      local.view.setUint16(10, dosTime, true);
      local.view.setUint16(12, dosDate, true);
      local.view.setUint32(14, crc, true);
      local.view.setUint32(18, data.length, true);
      local.view.setUint32(22, data.length, true);
      local.view.setUint16(26, name.length, true);
      local.view.setUint16(28, 0, true);
      chunks.push(local.bytes, name, data);

      var dir = header(46);
      dir.view.setUint32(0, 0x02014b50, true);
      dir.view.setUint16(4, 20, true);          // version made by
      dir.view.setUint16(6, 20, true);
      dir.view.setUint16(8, 0x0800, true);
      dir.view.setUint16(10, 0, true);
      dir.view.setUint16(12, dosTime, true);
      dir.view.setUint16(14, dosDate, true);
      dir.view.setUint32(16, crc, true);
      dir.view.setUint32(20, data.length, true);
      dir.view.setUint32(24, data.length, true);
      dir.view.setUint16(28, name.length, true);
      dir.view.setUint32(42, offset, true);
      central.push(dir.bytes, name);

      offset += 30 + name.length + data.length;
    });

    var centralSize = central.reduce(function (n, b) { return n + b.length; }, 0);
    var end = header(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(8, entries.length, true);
    end.view.setUint16(10, entries.length, true);
    end.view.setUint32(12, centralSize, true);
    end.view.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [end.bytes]));
  }

  /* ── PDF: a ruled table in Helvetica, US Letter landscape ── */

  // Helvetica advance widths (1/1000 em) for character codes 32–126.
  var HELVETICA = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ];
  // Helvetica-Bold, same range.
  var HELVETICA_BOLD = [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ];

  // Unicode characters that WinAnsiEncoding places in 0x80–0x9F.
  var WIN_ANSI = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
    0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
    0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
    0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
    // Not in WinAnsi: the nearest character that is.
    0x2032: 0x27, 0x2033: 0x22, 0x2212: 0x2d, 0x00a0: 0x20,
  };

  /* Text as single-byte WinAnsi codes (anything unmappable becomes "?"). */
  function toWinAnsi(text) {
    var out = "";
    var s = cellText(text);
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      if (WIN_ANSI[code] !== undefined) code = WIN_ANSI[code];
      else if (code > 255 || (code > 126 && code < 160) || (code < 32 && code !== 9)) code = 63;
      if (code === 9) code = 32;
      out += String.fromCharCode(code);
    }
    return out;
  }

  function textWidth(ansi, size, bold) {
    var table = bold ? HELVETICA_BOLD : HELVETICA;
    var units = 0;
    for (var i = 0; i < ansi.length; i++) {
      var code = ansi.charCodeAt(i);
      units += code >= 32 && code <= 126 ? table[code - 32] : 556;
    }
    return units * size / 1000;
  }

  /* Break text into lines that fit `width`, splitting over-long words. */
  function wrap(ansi, width, size, bold) {
    var lines = [];
    ansi.split("\n").forEach(function (paragraph) {
      var line = "";
      paragraph.split(" ").forEach(function (word) {
        var candidate = line ? line + " " + word : word;
        if (textWidth(candidate, size, bold) <= width) {
          line = candidate;
          return;
        }
        if (line) lines.push(line);
        line = "";
        while (textWidth(word, size, bold) > width) {
          var cut = word.length - 1;
          while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > width) cut--;
          lines.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        line = word;
      });
      lines.push(line);
    });
    return lines.length ? lines : [""];
  }

  function pdfString(ansi) {
    return "(" + ansi.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)") + ")";
  }

  function fixed(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  function buildPdf(doc) {
    // Landscape: a long description and a kit name each fit on a line or two.
    var PAGE_W = 792, PAGE_H = 612, MARGIN = 36;
    var TABLE_W = PAGE_W - 2 * MARGIN;
    var SIZE = 8.5, LEAD = 10.5, PAD = 4;
    var HEAD_SIZE = 8.5;
    var BOTTOM = MARGIN + 18;            // leave room for the footer line

    // Column widths: each column's pdfWidth is a share of the table width.
    var total = doc.columns.reduce(function (n, c) { return n + (c.pdfWidth || 1); }, 0);
    var widths = doc.columns.map(function (c) { return TABLE_W * (c.pdfWidth || 1) / total; });

    function rowLines(values, bold, size) {
      return values.map(function (v, i) {
        return wrap(toWinAnsi(v), widths[i] - 2 * PAD, size, bold);
      });
    }

    var headerCells = rowLines(doc.columns.map(function (c) { return c.label; }), true, HEAD_SIZE);
    var headerHeight = Math.max.apply(null, headerCells.map(function (l) { return l.length; })) *
      LEAD + 2 * PAD;

    // 1. Lay out every row on pages first, so the footer can say "of N".
    var pages = [];
    var page = null;
    var y = 0;

    function newPage(first) {
      page = { rows: [], first: first };
      pages.push(page);
      y = PAGE_H - MARGIN;
      if (first) y -= 40;               // title block
      else y -= 16;                     // running title
      page.headerY = y;
      y -= headerHeight;
    }

    newPage(true);
    doc.rows.forEach(function (row, index) {
      var cells = rowLines(doc.columns.map(function (c) { return row[c.key]; }), false, SIZE);
      var height = Math.max.apply(null, cells.map(function (l) { return l.length; })) *
        LEAD + 2 * PAD;
      if (y - height < BOTTOM && page.rows.length) newPage(false);
      page.rows.push({ cells: cells, y: y, height: height, shade: index % 2 === 1 });
      y -= height;
    });

    // 2. Draw.
    function drawCells(out, cells, top, height, bold, size) {
      var x = MARGIN;
      cells.forEach(function (lines, i) {
        var column = doc.columns[i];
        lines.forEach(function (line, n) {
          var baseline = top - PAD - size - n * LEAD + 1.5;
          var tx = x + PAD;
          if (column.type === "number") {
            tx = x + widths[i] - PAD - textWidth(line, size, bold);
          }
          out.push("BT /" + (bold ? "F2" : "F1") + " " + size + " Tf " +
            fixed(tx) + " " + fixed(baseline) + " Td " + pdfString(line) + " Tj ET");
        });
        x += widths[i];
      });
    }

    function drawGrid(out, top, height) {
      var x = MARGIN;
      out.push(fixed(MARGIN) + " " + fixed(top - height) + " " + fixed(TABLE_W) + " " +
        fixed(height) + " re S");
      for (var i = 0; i < widths.length - 1; i++) {
        x += widths[i];
        out.push(fixed(x) + " " + fixed(top) + " m " + fixed(x) + " " +
          fixed(top - height) + " l S");
      }
    }

    var generated = new Date().toLocaleString();
    var streams = pages.map(function (p, pageIndex) {
      var out = ["0.5 w 0.77 0.78 0.81 RG"];
      if (p.first) {
        out.push("0.11 g BT /F2 15 Tf " + MARGIN + " " + (PAGE_H - MARGIN - 14) + " Td " +
          pdfString(toWinAnsi(doc.title)) + " Tj ET");
        if (doc.subtitle) {
          out.push("0.42 g BT /F1 9 Tf " + MARGIN + " " + (PAGE_H - MARGIN - 29) + " Td " +
            pdfString(toWinAnsi(doc.subtitle)) + " Tj ET");
        }
      } else {
        out.push("0.42 g BT /F1 8 Tf " + MARGIN + " " + (PAGE_H - MARGIN - 8) + " Td " +
          pdfString(toWinAnsi(doc.title + " (continued)")) + " Tj ET");
      }

      // Header row on every page.
      out.push("0.9 0.91 0.92 rg " + fixed(MARGIN) + " " + fixed(p.headerY - headerHeight) +
        " " + fixed(TABLE_W) + " " + fixed(headerHeight) + " re f");
      out.push("0.11 g");
      drawCells(out, headerCells, p.headerY, headerHeight, true, HEAD_SIZE);
      drawGrid(out, p.headerY, headerHeight);

      p.rows.forEach(function (r) {
        if (r.shade) {
          out.push("0.97 0.98 0.98 rg " + fixed(MARGIN) + " " + fixed(r.y - r.height) + " " +
            fixed(TABLE_W) + " " + fixed(r.height) + " re f");
        }
        out.push("0.11 g");
        drawCells(out, r.cells, r.y, r.height, false, SIZE);
        drawGrid(out, r.y, r.height);
      });

      var footer = toWinAnsi("All Medical Kits - generated " + generated);
      var pageNo = "Page " + (pageIndex + 1) + " of " + pages.length;
      out.push("0.42 g BT /F1 7.5 Tf " + MARGIN + " " + (MARGIN) + " Td " +
        pdfString(footer) + " Tj ET");
      out.push("BT /F1 7.5 Tf " + fixed(PAGE_W - MARGIN - textWidth(pageNo, 7.5)) + " " +
        MARGIN + " Td " + pdfString(pageNo) + " Tj ET");
      return out.join("\n");
    });

    // 3. Serialise. Every character is one byte, so string length = byte offset.
    var objects = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = [];
    var firstPageObj = 5;
    streams.forEach(function (stream, i) {
      var pageObj = firstPageObj + i * 2;
      kids.push(pageObj + " 0 R");
      objects[pageObj] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " +
        PAGE_H + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " +
        (pageObj + 1) + " 0 R >>";
      objects[pageObj + 1] = "<< /Length " + stream.length + " >>\nstream\n" + stream +
        "\nendstream";
    });
    objects[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + streams.length + " >>";
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

    var pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    var offsets = [];
    for (var n = 1; n < objects.length; n++) {
      offsets[n] = pdf.length;
      pdf += n + " 0 obj\n" + objects[n] + "\nendobj\n";
    }
    var xref = pdf.length;
    pdf += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
    for (n = 1; n < objects.length; n++) {
      pdf += ("0000000000" + offsets[n]).slice(-10) + " 00000 n \n";
    }
    pdf += "trailer\n<< /Size " + objects.length + " /Root 1 0 R /Info << /Title " +
      pdfString(toWinAnsi(doc.title)) + " /Producer (All Medical Kits) >> >>\n" +
      "startxref\n" + xref + "\n%%EOF\n";

    var bytes = new Uint8Array(pdf.length);
    for (var b = 0; b < pdf.length; b++) bytes[b] = pdf.charCodeAt(b) & 0xff;
    return new Blob([bytes], { type: "application/pdf" });
  }

  var BUILDERS = {
    csv: { build: buildCsv, ext: ".csv" },
    xlsx: { build: buildXlsx, ext: ".xlsx" },
    pdf: { build: buildPdf, ext: ".pdf" },
  };

  window.MedKitsExport = {
    build: function (format, doc) { return BUILDERS[format].build(doc); },
    download: function (format, doc) {
      var builder = BUILDERS[format];
      if (!builder) throw new Error("Unknown export format: " + format);
      saveBlob(builder.build(doc), doc.filename + builder.ext);
    },
  };
})();
