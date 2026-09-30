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

function lectureTextCell(address, value, style = '') {
    return `<c r="${address}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${lectureXml(value)}</t></is></c>`;
}

function lectureNumberCell(address, value, style) {
    return `<c r="${address}" s="${style}"><v>${value}</v></c>`;
}

function lectureEventRowHeight(summary) {
    const lines = summary.split('\n').reduce((total, line) => {
        const width = Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
        return total + Math.max(1, Math.ceil(width / 31));
    }, 0);
    return Math.min(360, Math.max(90, lines * 14 + 16));
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

function createLectureWorkbook(libraryName, month, rows) {
    const year = month.getUTCFullYear();
    const monthNumber = month.getUTCMonth() + 1;
    const monthLabel = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const monthRows = rows.filter(row => row.date.startsWith(`${monthLabel}-`));
    const hasEvents = monthRows.some(row => row.eventType === '행사');
    const calendarLabel = hasEvents ? '강좌·행사' : '강좌';
    const courseCount = new Set(monthRows.map(row => row.lectureKey || row.url || `${row.name}:${row.beginTime}`)).size;
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const leading = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
    const weeks = Math.ceil((leading + days) / 7);
    const byDate = new Map();
    for (const row of monthRows) {
        if (!byDate.has(row.date)) byDate.set(row.date, []);
        byDate.get(row.date).push(row);
    }
    const sheetRows = [
        `<row r="1" ht="36" customHeight="1">${lectureTextCell('A1', `${libraryName} ${calendarLabel} 달력`, '1')}</row>`,
        `<row r="2" ht="26" customHeight="1">${lectureTextCell('A2', `${year}년 ${monthNumber}월 · ${calendarLabel} ${courseCount}개 · ${hasEvents ? '일정' : '수업'} ${monthRows.length}회`, '2')}</row>`,
        '<row r="3" ht="9" customHeight="1"/>',
        `<row r="4" ht="32" customHeight="1">${['일', '월', '화', '수', '목', '금', '토'].map((day, index) =>
            lectureTextCell(`${String.fromCharCode(65 + index)}4`, day, index === 0 ? '4' : index === 6 ? '5' : '3')
        ).join('')}</row>`,
    ];
    let rowNumber = 5;
    for (let week = 0; week < weeks; week++) {
        const dates = Array.from({ length: 7 }, (_, weekday) => {
            const day = week * 7 + weekday - leading + 1;
            if (day < 1 || day > days) return null;
            const date = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return { date, events: byDate.get(date) || [] };
        });
        sheetRows.push(`<row r="${rowNumber}" ht="32" customHeight="1">${dates.map((day, weekday) => {
            const address = `${String.fromCharCode(65 + weekday)}${rowNumber}`;
            if (!day) return lectureTextCell(address, '', '12');
            return lectureNumberCell(address, lectureExcelDate(day.date), weekday === 0 ? 7 : weekday === 6 ? 8 : 6);
        }).join('')}</row>`);
        rowNumber++;
        const eventRows = Math.max(1, ...dates.map(day => day?.events.length || 0));
        for (let slot = 0; slot < eventRows; slot++) {
            const eventStyleOffset = slot > 0 && slot < eventRows - 1 ? 11 : slot > 0 ? 8 : slot < eventRows - 1 ? 5 : 0;
            const emptyStyleOffset = slot > 0 && slot < eventRows - 1 ? 15 : slot > 0 ? 13 : slot < eventRows - 1 ? 11 : 0;
            let rowHeight = 90;
            const cells = dates.map((day, weekday) => {
                const address = `${String.fromCharCode(65 + weekday)}${rowNumber}`;
                if (!day) return lectureTextCell(address, '', 12 + emptyStyleOffset);
                const event = day.events[slot];
                if (!event) return lectureTextCell(address, '', 13 + emptyStyleOffset);
                const time = event.allDay ? '종일' : [event.beginTime, event.endTime].filter(Boolean).join('–') || '시간 미정';
                const status = event.assignee ? `${event.status || '미정'} · 담당: ${event.assignee}` : (event.status || '미정');
                const summary = [`시간: ${time}`, event.name || '이름 없는 강좌', `대상: ${event.target || '미정'}`,
                    `장소: ${event.place || '미정'}`, `상태: ${status}`,
                    ...(event.source === 'local' ? ['직접 입력 · 로컬', ...(event.note ? [`메모: ${event.note}`] : [])] : [])].join('\n');
                rowHeight = Math.max(rowHeight, lectureEventRowHeight(summary));
                const baseStyle = event.status === '접수중' ? 10 : event.status === '접수예정' ? 11 : 9;
                return lectureTextCell(address, summary, baseStyle + eventStyleOffset);
            });
            sheetRows.push(`<row r="${rowNumber}" ht="${rowHeight}" customHeight="1">${cells.join('')}</row>`);
            rowNumber++;
        }
    }
    const lastRow = rowNumber - 1;
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:G${lastRow}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="20"/><cols><col min="1" max="7" width="34" customWidth="1"/></cols>
<sheetData>${sheetRows.join('')}</sheetData><mergeCells count="2"><mergeCell ref="A1:G1"/><mergeCell ref="A2:G2"/></mergeCells>
<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
<pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="d"/></numFmts>
<fonts count="9"><font><sz val="10"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="18"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FF5C4033"/><sz val="12"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FF5C4033"/><sz val="12"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FFB42332"/><sz val="12"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FF2563A6"/><sz val="12"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FF5C4033"/><sz val="14"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FFB42332"/><sz val="14"/><name val="Malgun Gothic"/></font><font><b/><color rgb="FF2563A6"/><sz val="14"/><name val="Malgun Gothic"/></font></fonts>
<fills count="12"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5C4033"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6EFE7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2ECE5"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE9EB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFAF7F3"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F4"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF9F1"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDF5FF"/></patternFill></fill></fills>
<borders count="5"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="medium"><color rgb="FFC5B7AA"/></left><right style="medium"><color rgb="FFC5B7AA"/></right><top style="medium"><color rgb="FFC5B7AA"/></top><bottom style="medium"><color rgb="FFC5B7AA"/></bottom><diagonal/></border>
<border><left style="medium"><color rgb="FFC5B7AA"/></left><right style="medium"><color rgb="FFC5B7AA"/></right><top style="medium"><color rgb="FFC5B7AA"/></top><bottom style="dotted"><color rgb="FF9E8B7D"/></bottom><diagonal/></border>
<border><left style="medium"><color rgb="FFC5B7AA"/></left><right style="medium"><color rgb="FFC5B7AA"/></right><top style="dotted"><color rgb="FF9E8B7D"/></top><bottom style="medium"><color rgb="FFC5B7AA"/></bottom><diagonal/></border>
<border><left style="medium"><color rgb="FFC5B7AA"/></left><right style="medium"><color rgb="FFC5B7AA"/></right><top style="dotted"><color rgb="FF9E8B7D"/></top><bottom style="dotted"><color rgb="FF9E8B7D"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="29"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="6" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="7" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="8" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyFont="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="11" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="8" borderId="2" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="10" borderId="2" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="11" borderId="2" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="3" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="10" borderId="3" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="11" borderId="3" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="4" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="10" borderId="4" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="11" borderId="4" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="8" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="9" borderId="3" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="8" borderId="3" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="9" borderId="4" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="8" borderId="4" xfId="0" applyFill="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    const safeSheetTitle = `${libraryName.replace(/[\[\]:*?/\\]/g, '').slice(0, 20) || '도서관'} ${monthLabel}`;
    const entries = [
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${lectureXml(safeSheetTitle)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
        ['xl/styles.xml', styles],
        ['xl/worksheets/sheet1.xml', sheet],
    ];
    return lectureZip(entries);
}

if (typeof module !== 'undefined') module.exports = { createLectureWorkbook };
