// Small OOXML writer for this one-sheet download. It has no network or CDN dependency.
function lectureXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function lectureExcelDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    return (Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - Date.UTC(1899, 11, 30)) / 86400000;
}

function lectureExcelTime(value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(value || '');
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? (hours * 60 + minutes) / 1440 : null;
}

function lectureTextCell(address, value, style = '') {
    return `<c r="${address}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${lectureXml(value)}</t></is></c>`;
}

function lectureNumberCell(address, value, style) {
    return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
}

function lectureCrc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function lectureZip(entries) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const uint16 = (view, at, value) => view.setUint16(at, value, true);
    const uint32 = (view, at, value) => view.setUint32(at, value, true);
    for (const [path, contents] of entries) {
        const name = encoder.encode(path);
        const data = encoder.encode(contents);
        const crc = lectureCrc32(data);
        const local = new Uint8Array(30 + name.length + data.length);
        const localView = new DataView(local.buffer);
        uint32(localView, 0, 0x04034b50);
        uint16(localView, 4, 20);
        uint16(localView, 6, 0x0800); // UTF-8 file names.
        uint32(localView, 14, crc);
        uint32(localView, 18, data.length);
        uint32(localView, 22, data.length);
        uint16(localView, 26, name.length);
        local.set(name, 30);
        local.set(data, 30 + name.length);
        chunks.push(local);

        const record = new Uint8Array(46 + name.length);
        const view = new DataView(record.buffer);
        uint32(view, 0, 0x02014b50);
        uint16(view, 4, 20);
        uint16(view, 6, 20);
        uint16(view, 8, 0x0800);
        uint32(view, 16, crc);
        uint32(view, 20, data.length);
        uint32(view, 24, data.length);
        uint16(view, 28, name.length);
        uint32(view, 42, offset);
        record.set(name, 46);
        central.push(record);
        offset += local.length;
    }
    const centralStart = offset;
    for (const record of central) {
        chunks.push(record);
        offset += record.length;
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    uint32(endView, 0, 0x06054b50);
    uint16(endView, 8, entries.length);
    uint16(endView, 10, entries.length);
    uint32(endView, 12, offset - centralStart);
    uint32(endView, 16, centralStart);
    chunks.push(end);
    const output = new Uint8Array(offset + end.length);
    let position = 0;
    for (const chunk of chunks) {
        output.set(chunk, position);
        position += chunk.length;
    }
    return output;
}

function createLectureWorkbook(libraryName, rows) {
    const headers = ['수업 날짜', '시작', '종료', '강좌명', '대상', '장소', '접수 상태', '상세 링크'];
    const sheetRows = [`<row r="1" ht="28" customHeight="1">${headers.map((header, index) =>
        lectureTextCell(`${String.fromCharCode(65 + index)}1`, header, '1')
    ).join('')}</row>`];
    const hyperlinks = [];
    const relationships = [];
    rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const date = lectureExcelDate(row.date);
        const begin = lectureExcelTime(row.beginTime);
        const end = lectureExcelTime(row.endTime);
        const cells = [
            date === null ? lectureTextCell(`A${rowNumber}`, row.date) : lectureNumberCell(`A${rowNumber}`, date, 2),
            begin === null ? lectureTextCell(`B${rowNumber}`, row.beginTime) : lectureNumberCell(`B${rowNumber}`, begin, 3),
            end === null ? lectureTextCell(`C${rowNumber}`, row.endTime) : lectureNumberCell(`C${rowNumber}`, end, 3),
            lectureTextCell(`D${rowNumber}`, row.name),
            lectureTextCell(`E${rowNumber}`, row.target),
            lectureTextCell(`F${rowNumber}`, row.place),
            lectureTextCell(`G${rowNumber}`, row.status),
            lectureTextCell(`H${rowNumber}`, row.url),
        ];
        sheetRows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
        if (row.url) {
            const id = `rId${relationships.length + 1}`;
            hyperlinks.push(`<hyperlink ref="H${rowNumber}" r:id="${id}"/>`);
            relationships.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${lectureXml(row.url)}" TargetMode="External"/>`);
        }
    });
    const lastRow = rows.length + 1;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:H${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="15" customWidth="1"/><col min="2" max="3" width="10" customWidth="1"/><col min="4" max="4" width="48" customWidth="1"/><col min="5" max="5" width="30" customWidth="1"/><col min="6" max="6" width="34" customWidth="1"/><col min="7" max="7" width="14" customWidth="1"/><col min="8" max="8" width="55" customWidth="1"/></cols>
<sheetData>${sheetRows.join('')}</sheetData><autoFilter ref="A1:H${lastRow}"/>${hyperlinks.length ? `<hyperlinks>${hyperlinks.join('')}</hyperlinks>` : ''}
</worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5C4033"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    const safeSheetTitle = libraryName.replace(/[\[\]:*?/\\]/g, '').slice(0, 24) || '도서관';
    const entries = [
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${lectureXml(safeSheetTitle)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ['xl/styles.xml', styles],
        ['xl/worksheets/sheet1.xml', sheet],
        ['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.join('')}</Relationships>`],
    ];
    return lectureZip(entries);
}

if (typeof module !== 'undefined') module.exports = { createLectureWorkbook };
