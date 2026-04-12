// ─── PDF Generation (jsPDF programmatic builder) ───────────────────────────
// Mirrors the Word document format from docx-generator.js + adds signature

var PDF = (() => {
    // ── Constants ────────────────────────────────────────────────────────
    const NAVY = [31, 58, 95];
    const WHITE = [255, 255, 255];
    const LIGHT_GRAY = [244, 246, 248];
    const MED_GRAY = [102, 102, 102];
    const DARK = [34, 34, 34];
    const BORDER_GRAY = [153, 153, 153];
    const PAGE_W = 215.9, PAGE_H = 279.4; // Letter mm
    const MARGIN = 10;
    const USABLE_W = PAGE_W - 2 * MARGIN;
    const CONTENT_TOP = 14;
    const CONTENT_BOTTOM = PAGE_H - 12;
    const FONT = 'Helvetica';

    // ── Helpers ──────────────────────────────────────────────────────────

    function stripHtml(html) {
        if (!html) return '';
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
            .replace(/<\/li>/gi, '\n')
            .replace(/<li[^>]*>/gi, '  \u2022 ')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .trim();
    }

    function checkPage(doc, cursor, needed) {
        if (cursor.y + needed > CONTENT_BOTTOM) {
            doc.addPage();
            cursor.y = CONTENT_TOP;
        }
    }

    function newPage(doc, cursor) {
        doc.addPage();
        cursor.y = CONTENT_TOP;
    }

    // Draw a navy bar with centered white text
    function drawNavyBar(doc, cursor, text, fontSize) {
        fontSize = fontSize || 11;
        const barH = fontSize * 0.5 + 4;
        checkPage(doc, cursor, barH + 2);
        doc.setFillColor(...NAVY);
        doc.rect(MARGIN, cursor.y, USABLE_W, barH, 'F');
        doc.setFont(FONT, 'bold');
        doc.setFontSize(fontSize);
        doc.setTextColor(...WHITE);
        doc.text(text, PAGE_W / 2, cursor.y + barH / 2 + fontSize * 0.15, { align: 'center' });
        cursor.y += barH + 2;
    }

    // Draw a simple table. rows = [[{text,bold,bg,color,align,colSpan},...],...]
    // colWidths = array of mm widths
    function drawTable(doc, cursor, rows, colWidths, opts) {
        opts = opts || {};
        const cellPadX = opts.padX || 1.5;
        const cellPadY = opts.padY || 1.2;
        const fontSize = opts.fontSize || 8;
        const lineH = fontSize * 0.45;

        for (let ri = 0; ri < rows.length; ri++) {
            const row = rows[ri];
            // Calculate row height
            let maxLines = 1;
            const cellLines = [];
            let ci = 0;
            for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                const span = cell.colSpan || 1;
                let cellW = 0;
                for (let s = 0; s < span; s++) cellW += colWidths[ci + s];
                const textW = cellW - cellPadX * 2;
                doc.setFont(FONT, cell.bold ? 'bold' : 'normal');
                doc.setFontSize(fontSize);
                const lines = doc.splitTextToSize(String(cell.text || ''), textW);
                cellLines.push({ lines, cellW, startCol: ci });
                if (lines.length > maxLines) maxLines = lines.length;
                ci += span;
            }
            const rowH = maxLines * lineH + cellPadY * 2;

            if (!opts.noPageBreak) checkPage(doc, cursor, rowH);

            // Draw cells
            let x = MARGIN;
            for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                const cw = cellLines[i].cellW;
                // Background
                if (cell.bg) {
                    doc.setFillColor(...cell.bg);
                    doc.rect(x, cursor.y, cw, rowH, 'F');
                }
                // Border
                doc.setDrawColor(...BORDER_GRAY);
                doc.setLineWidth(0.2);
                doc.rect(x, cursor.y, cw, rowH, 'S');
                // Text
                doc.setFont(FONT, cell.bold ? 'bold' : 'normal');
                doc.setFontSize(fontSize);
                doc.setTextColor(...(cell.color || DARK));
                const align = cell.align || 'left';
                const textX = align === 'center' ? x + cw / 2 : align === 'right' ? x + cw - cellPadX : x + cellPadX;
                const textY = cursor.y + cellPadY + lineH * 0.7;
                cellLines[i].lines.forEach((line, li) => {
                    doc.text(line, textX, textY + li * lineH, { align });
                });
                x += cw;
            }
            cursor.y += rowH;
        }
    }

    function drawWrappedText(doc, cursor, text, fontSize, opts) {
        opts = opts || {};
        fontSize = fontSize || 9;
        const lineH = fontSize * 0.45;
        doc.setFont(FONT, opts.bold ? 'bold' : opts.italic ? 'italic' : 'normal');
        doc.setFontSize(fontSize);
        doc.setTextColor(...(opts.color || DARK));
        const lines = doc.splitTextToSize(text, USABLE_W - 2);
        for (const line of lines) {
            checkPage(doc, cursor, lineH + 1);
            doc.text(line, MARGIN + 1, cursor.y + lineH);
            cursor.y += lineH;
        }
        cursor.y += 1;
    }

    function loadImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                resolve({ dataUrl: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    function getImageDims(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ w: 400, h: 300 });
            img.src = dataUrl;
        });
    }

    function addHeaderFooter(doc, equipNum, reportTitle) {
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            // Header
            doc.setFont(FONT, 'normal');
            doc.setFontSize(8);
            doc.setTextColor(...MED_GRAY);
            doc.text(`${equipNum} - ${reportTitle}`, PAGE_W / 2, 7, { align: 'center' });
            // Footer
            doc.text(`Page ${i} / ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 5, { align: 'right' });
        }
    }

    // ── Main Generate Function ───────────────────────────────────────────

    async function generate(reportData, opts) {
        opts = opts || {};
        try {
            const type = reportData.report_type || 'tower';
            const config = API.getReportTypeConfig(type);
            const sections = reportData.sections || {};
            const headerData = (sections.header || {}).section_data || {};
            const isExt = type === 'ext510' || type === 'ext570';
            const equipNum = headerData.equipment_number || reportData.equipment_number || 'Report';
            const reportTitle = config.title || 'INSPECTION REPORT';
            const idLabel = config.idLabel || 'EQUIPMENT ID';

            const { jsPDF } = jspdf;
            const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });
            const cursor = { y: CONTENT_TOP };

            // ── 1. Logo ─────────────────────────────────────────────────
            const logoImg = await loadImage('/reports/images/fer-logo.png');
            if (logoImg) {
                const logoW = 22, logoH = (logoImg.h / logoImg.w) * logoW;
                doc.addImage(logoImg.dataUrl, 'PNG', PAGE_W / 2 - logoW / 2, cursor.y, logoW, logoH);
                cursor.y += logoH + 3;
            }

            // ── 2. Title ────────────────────────────────────────────────
            doc.setFont(FONT, 'bold');
            doc.setFontSize(16);
            doc.setTextColor(...NAVY);
            doc.text(reportTitle, PAGE_W / 2, cursor.y + 5, { align: 'center' });
            cursor.y += 10;

            // ── 3. Form Number + Date ───────────────────────────────────
            const now = new Date().toISOString().slice(0, 10);
            doc.setFont(FONT, 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...MED_GRAY);
            doc.text(`${config.formNumber}    Issue Date: ${now}`, PAGE_W - MARGIN, cursor.y, { align: 'right' });
            cursor.y += 5;

            // ── 4. Equipment ID Bar ─────────────────────────────────────
            const idBarH = 7;
            doc.setFillColor(102, 102, 102);
            doc.rect(MARGIN, cursor.y, USABLE_W, idBarH, 'F');
            doc.setFont(FONT, 'bold');
            doc.setFontSize(10);
            doc.setTextColor(...WHITE);
            doc.text(`${idLabel}: ${equipNum}`, PAGE_W / 2, cursor.y + idBarH / 2 + 1.5, { align: 'center' });
            cursor.y += idBarH + 3;

            // ── 5. Equipment Info Table ─────────────────────────────────
            if (type === 'ext510') {
                const cw = USABLE_W / 5;
                const hdr = (t, span) => ({ text: t, bold: true, bg: NAVY, color: WHITE, align: 'center', colSpan: span || 1 });
                const val = (t, span) => ({ text: t || '', align: 'center', colSpan: span || 1 });
                drawTable(doc, cursor, [
                    [hdr('UNIT #'), hdr('EQUIPMENT #', 2), hdr('DESCRIPTION', 2)],
                    [val(headerData.unit_number || reportData.unit_number), val(headerData.equipment_number || reportData.equipment_number, 2), val(headerData.description, 2)],
                    [hdr('SERIAL #'), hdr('NATIONAL BD #'), hdr('YEAR BUILT'), hdr('PWHT'), hdr('SYSTEM / SERVICE')],
                    [val(headerData.nb_serial_number), val(headerData.national_bd_number), val(headerData.year_built), val(headerData.pwht), val(headerData.system_service)],
                    [hdr('DESIGN PRESSURE'), hdr('DESIGN TEMP.'), hdr('OPER. PRESSURE'), hdr('OPER. TEMP.'), hdr('P&ID')],
                    [val(headerData.design_pressure ? `${headerData.design_pressure} PSIG` : ''), val(headerData.design_temp ? `${headerData.design_temp} °F` : ''), val(headerData.oper_pressure ? `${headerData.oper_pressure} PSIG` : ''), val(headerData.oper_temp ? `${headerData.oper_temp} °F` : ''), val(headerData.p_and_id)],
                ], [cw, cw, cw, cw, cw]);
            } else if (type === 'ext570') {
                const cw = USABLE_W / 5;
                const hdr = (t, span) => ({ text: t, bold: true, bg: NAVY, color: WHITE, align: 'center', colSpan: span || 1 });
                const val = (t, span) => ({ text: t || '', align: 'center', colSpan: span || 1 });
                drawTable(doc, cursor, [
                    [hdr('UNIT #'), hdr('SYSTEM / CIRCUIT #', 2), hdr('DESCRIPTION', 2)],
                    [val(headerData.unit_number || reportData.unit_number), val(headerData.equipment_number || reportData.equipment_number, 2), val(headerData.description, 2)],
                    [hdr('LINE #'), hdr('MATERIAL'), hdr('PIPE SPEC'), hdr('SYSTEM / SERVICE', 2)],
                    [val(headerData.line_number), val(headerData.material), val(headerData.pipe_spec), val(headerData.system_service, 2)],
                    [hdr('DESIGN PRESSURE'), hdr('DESIGN TEMP.'), hdr('OPER. PRESSURE'), hdr('OPER. TEMP.'), hdr('P&ID')],
                    [val(headerData.design_pressure ? `${headerData.design_pressure} PSIG` : ''), val(headerData.design_temp ? `${headerData.design_temp} °F` : ''), val(headerData.oper_pressure ? `${headerData.oper_pressure} PSIG` : ''), val(headerData.oper_temp ? `${headerData.oper_temp} °F` : ''), val(headerData.p_and_id)],
                ], [cw, cw, cw, cw, cw]);
            } else {
                // Default types: 4-column label/value
                const lw = USABLE_W * 0.22, vw = USABLE_W * 0.28;
                const lbl = (t) => ({ text: t, bold: true, bg: LIGHT_GRAY });
                const valC = (t) => ({ text: t || '' });
                const valSpan = (t) => ({ text: t || '', colSpan: 3 });
                const rows = [
                    [lbl('Unit #'), valC(headerData.unit_number || reportData.unit_number), lbl('Equipment #'), valC(headerData.equipment_number || reportData.equipment_number)],
                    [lbl('Serial #'), valC(headerData.nb_serial_number || reportData.nb_serial_number), lbl('Project'), valC(headerData.project_name || reportData.project_name)],
                ];
                (config.headerFields || []).forEach(([label, key, label2, key2]) => {
                    if (label2) {
                        rows.push([lbl(label), valC(headerData[key]), lbl(label2), valC(headerData[key2])]);
                    } else {
                        rows.push([lbl(label), valSpan(headerData[key])]);
                    }
                });
                drawTable(doc, cursor, rows, [lw, vw, lw, vw]);
            }
            cursor.y += 3;

            // ── 6. Inspector Info ────────────────────────────────────────
            if (isExt) {
                const inspData = (sections.ext510_inspector || {}).section_data || {};
                drawNavyBar(doc, cursor, 'INSPECTOR INFORMATION');
                const lw = USABLE_W * 0.22, vw = USABLE_W * 0.28;
                const lbl = (t) => ({ text: t, bold: true, bg: LIGHT_GRAY });
                const valC = (t) => ({ text: t || '' });
                drawTable(doc, cursor, [
                    [lbl('INSPECTOR NAME'), valC(inspData.ext510_inspector_name), lbl('API #'), valC(inspData.ext510_api_number || inspData.ext510_inspector_api_cert)],
                    [lbl('DATE'), valC(inspData.ext510_inspector_date), lbl('SIGNATURE'), { text: '', _sigPlaceholder: true }],
                ], [lw, vw, lw, vw]);

                // Draw signature image inside the SIGNATURE cell (last cell, last row)
                const sigData = inspData.ext510_inspector_signature || getCanvasSignature();
                if (sigData) {
                    try {
                        const sigX = MARGIN + lw + vw + lw + 2;
                        const sigY = cursor.y - 7; // second row only (bottom row of 2-row table)
                        doc.addImage(sigData, 'PNG', sigX, sigY, vw - 4, 5.5);
                    } catch (e) { /* skip bad signature */ }
                }
            } else {
                const inspTypeData = (sections.inspection_type || {}).section_data || {};
                const inspectors = inspTypeData.inspectors || [];
                if (inspectors.length > 0) {
                    drawNavyBar(doc, cursor, 'INSPECTION TYPE');
                    const checks = [];
                    if (inspTypeData.internal_inspection) checks.push('Internal Inspection');
                    if (inspTypeData.external_inspection_check) checks.push('External Inspection');
                    if (checks.length) {
                        drawWrappedText(doc, cursor, checks.join(', '), 9);
                    }
                    // Inspector table
                    const cw3 = USABLE_W / 3;
                    const hdr = (t) => ({ text: t, bold: true, bg: NAVY, color: WHITE, align: 'center' });
                    const inspRows = [
                        [hdr('Inspector Name'), hdr('API Cert #'), hdr('Date')],
                    ];
                    inspectors.forEach(insp => {
                        inspRows.push([
                            { text: insp.name || '' },
                            { text: insp.api_cert || '', align: 'center' },
                            { text: insp.date || '', align: 'center' },
                        ]);
                    });
                    drawTable(doc, cursor, inspRows, [cw3, cw3, cw3]);
                }
            }
            cursor.y += 1;

            // ── 7. Orientation / Data Plate Photos (skip for 570) ────────
            const orientData = (sections.orientation_photos || {}).section_data || {};
            const orientPhoto = orientData.orientation_photo;
            const dataplatePhoto = orientData.dataplate_photo;
            if ((orientPhoto || dataplatePhoto) && type !== 'ext570') {
                drawNavyBar(doc, cursor, 'ORIENTATION / DATA PLATE');
                const photoW = USABLE_W / 2 - 3;
                const maxPhotoH = 55;

                async function drawOrientPhoto(dataUrl, label, xPos) {
                    if (!dataUrl) return;
                    checkPage(doc, cursor, maxPhotoH + 8);
                    doc.setFont(FONT, 'bold');
                    doc.setFontSize(8);
                    doc.setTextColor(...DARK);
                    doc.text(label, xPos + photoW / 2, cursor.y + 3, { align: 'center' });
                    try {
                        const dims = await getImageDims(dataUrl);
                        const ratio = dims.h / dims.w;
                        const imgH = Math.min(photoW * ratio, maxPhotoH);
                        doc.addImage(dataUrl, 'JPEG', xPos, cursor.y + 5, photoW, imgH);
                        return imgH + 7;
                    } catch (e) { return 5; }
                }

                const h1 = await drawOrientPhoto(orientPhoto, 'ORIENTATION', MARGIN);
                const savedY = cursor.y;
                const h2 = await drawOrientPhoto(dataplatePhoto, 'DATA PLATE', MARGIN + USABLE_W / 2 + 1);
                cursor.y = savedY + Math.max(h1 || 0, h2 || 0) + 2;
            }

            // ── 8. Narrative Sections ────────────────────────────────────
            for (const ns of (config.narrativeSections || [])) {
                const secData = (sections[ns.key] || {}).section_data || {};
                const content = stripHtml(secData.content);
                drawNavyBar(doc, cursor, ns.title);
                if (content) {
                    drawWrappedText(doc, cursor, content, 9);
                } else {
                    drawWrappedText(doc, cursor, '(No content)', 8, { italic: true, color: [153, 153, 153] });
                }
                cursor.y += 2;
            }

            // ── 9. Checklist (ext510/ext570 only) — fills one page ──
            if (config.checklistCategories) {
                newPage(doc, cursor);
                drawNavyBar(doc, cursor, 'CHECKLIST', 8);

                const checklistData = (sections.checklist || {}).section_data || {};
                const items = checklistData.items || {};

                const cws = [
                    USABLE_W * 0.04,  // #
                    USABLE_W * 0.28,  // Item
                    USABLE_W * 0.05,  // Yes
                    USABLE_W * 0.05,  // No
                    USABLE_W * 0.05,  // N/A
                    USABLE_W * 0.14,  // Location
                    USABLE_W * 0.39,  // Comments
                ];
                const hdr = (t) => ({ text: t, bold: true, bg: DARK, color: WHITE, align: 'center' });
                const allRows = [
                    [hdr('#'), hdr('Item'), hdr('Yes'), hdr('No'), hdr('N/A'), hdr('Location'), hdr('Comments')],
                ];
                const cats = config.checklistCategories;

                for (const cat of cats) {
                    allRows.push([
                        { text: cat.title, bold: true, bg: LIGHT_GRAY, color: NAVY, colSpan: 7 },
                    ]);

                    cat.items.forEach(item => {
                        const itemData = items[String(item.num)] || items['item_' + item.num] || {};
                        const checked = itemData.value || itemData.checked;
                        let yes = '[ ]', no = '[ ]', na = '[ ]';
                        if (checked === true || checked === 'yes') yes = '[X]';
                        else if (checked === false || checked === 'no') no = '[X]';
                        else if (checked === 'na') na = '[X]';

                        allRows.push([
                            { text: String(item.num), align: 'center' },
                            { text: item.label },
                            { text: yes, align: 'center' },
                            { text: no, align: 'center' },
                            { text: na, align: 'center' },
                            { text: itemData.location || '' },
                            { text: itemData.comments || itemData.comment || '' },
                        ]);
                    });
                }

                // Try font sizes from 6.5 down to find one that fits the page
                const availH = CONTENT_BOTTOM - cursor.y - 2;
                const padX = 1.2;
                const minPadY = 0.6;
                let bestFontSize = 6.5;
                let bestPadY = minPadY;

                function measureHeight(fs) {
                    const lh = fs * 0.45;
                    let totalH = 0;
                    doc.setFontSize(fs);
                    for (const row of allRows) {
                        let maxLines = 1;
                        let ci = 0;
                        for (const cell of row) {
                            const span = cell.colSpan || 1;
                            let cellW = 0;
                            for (let s = 0; s < span; s++) cellW += cws[ci + s];
                            const tw = cellW - padX * 2;
                            doc.setFont(FONT, cell.bold ? 'bold' : 'normal');
                            const lines = doc.splitTextToSize(String(cell.text || ''), tw);
                            if (lines.length > maxLines) maxLines = lines.length;
                            ci += span;
                        }
                        totalH += maxLines * lh + minPadY * 2;
                    }
                    return totalH;
                }

                for (let fs = 6.5; fs >= 4.5; fs -= 0.5) {
                    const totalH = measureHeight(fs);
                    if (totalH <= availH) {
                        bestFontSize = fs;
                        const extraPerRow = (availH - totalH) / allRows.length;
                        bestPadY = minPadY + extraPerRow / 2;
                        break;
                    }
                }

                drawTable(doc, cursor, allRows, cws, { fontSize: bestFontSize, padX: padX, padY: bestPadY, noPageBreak: true });
            }

            // ── 10. Inspection Photos — always starts on new page ──────
            const photos = reportData.photos || [];
            newPage(doc, cursor);
            drawNavyBar(doc, cursor, 'INSPECTION PHOTOS', 12);

            if (photos.length > 0) {
                const photoW = USABLE_W / 2 - 3;
                const PHOTO_H = 69; // 260px height

                for (let i = 0; i < photos.length; i += 2) {
                    checkPage(doc, cursor, PHOTO_H + 12);
                    const rowStartY = cursor.y;
                    let rowMaxH = 0;

                    for (let j = i; j < Math.min(i + 2, photos.length); j++) {
                        const photo = photos[j];
                        const dataUrl = photo.dataUrl || photo.data_url;
                        if (!dataUrl) continue;
                        const xPos = j === i ? MARGIN : MARGIN + USABLE_W / 2 + 1;

                        try {
                            doc.addImage(dataUrl, 'JPEG', xPos, rowStartY, photoW, PHOTO_H);
                            // Caption
                            doc.setFont(FONT, 'italic');
                            doc.setFontSize(7);
                            doc.setTextColor(...MED_GRAY);
                            doc.text(photo.caption || `Photo ${j + 1}`, xPos + photoW / 2, rowStartY + PHOTO_H + 3, { align: 'center' });
                            if (PHOTO_H + 5 > rowMaxH) rowMaxH = PHOTO_H + 5;
                        } catch (e) { /* skip bad photo */ }
                    }
                    cursor.y = rowStartY + rowMaxH + 4;
                }
            } else {
                drawWrappedText(doc, cursor, 'No inspection photos uploaded.', 9, { italic: true, color: MED_GRAY });
            }

            // ── 11. Signature Section (non-ext reports only) ────────────
            if (!isExt) {
                checkPage(doc, cursor, 55);
                cursor.y += 5;

                doc.setDrawColor(...NAVY);
                doc.setLineWidth(0.5);
                doc.line(MARGIN, cursor.y, PAGE_W - MARGIN, cursor.y);
                cursor.y += 4;

                drawNavyBar(doc, cursor, 'SIGNATURES');

                const sigBlockW = USABLE_W / 2 - 5;
                const lineStartL = MARGIN + 35;
                const lineEndL = MARGIN + sigBlockW;
                const lineStartR = MARGIN + USABLE_W / 2 + 30;
                const lineEndR = PAGE_W - MARGIN;

                const inspTypeData = (sections.inspection_type || {}).section_data || {};
                const inspectors = inspTypeData.inspectors || [];
                const inspName = inspectors[0] ? inspectors[0].name || '' : '';
                const inspDate = inspectors[0] ? inspectors[0].date || '' : '';

                doc.setFont(FONT, 'normal');
                doc.setFontSize(9);
                doc.setTextColor(...DARK);
                doc.setDrawColor(...BORDER_GRAY);
                doc.setLineWidth(0.3);

                doc.text('Inspector Name:', MARGIN, cursor.y + 4);
                doc.text(inspName, lineStartL, cursor.y + 4);
                doc.line(lineStartL, cursor.y + 5, lineEndL, cursor.y + 5);
                doc.text('Date:', MARGIN + USABLE_W / 2 + 2, cursor.y + 4);
                doc.text(inspDate, lineStartR, cursor.y + 4);
                doc.line(lineStartR, cursor.y + 5, lineEndR, cursor.y + 5);
                cursor.y += 12;

                doc.text('Inspector Signature:', MARGIN, cursor.y + 4);
                doc.line(lineStartL, cursor.y + 5, lineEndL, cursor.y + 5);
                cursor.y += 15;

                doc.text('Reviewer Name:', MARGIN, cursor.y + 4);
                doc.line(lineStartL, cursor.y + 5, lineEndL, cursor.y + 5);
                doc.text('Date:', MARGIN + USABLE_W / 2 + 2, cursor.y + 4);
                doc.line(lineStartR, cursor.y + 5, lineEndR, cursor.y + 5);
                cursor.y += 12;

                doc.text('Reviewer Signature:', MARGIN, cursor.y + 4);
                doc.line(lineStartL, cursor.y + 5, lineEndL, cursor.y + 5);
                cursor.y += 10;
            }

            // ── Header / Footer ──────────────────────────────────────────
            addHeaderFooter(doc, equipNum, reportTitle);

            // ── Save ─────────────────────────────────────────────────────
            const filename = `${equipNum}_Final_Report_${now}.pdf`;
            doc.save(filename);

            if (typeof App !== 'undefined' && App.toast) {
                App.toast('PDF generated successfully!', 'success');
            }
        } catch (err) {
            console.error('PDF generation error:', err);
            if (typeof App !== 'undefined' && App.toast) {
                App.toast('PDF generation failed: ' + err.message, 'error');
            }
            window.print();
        }
        return true;
    }

    function getCanvasSignature() {
        try {
            const canvas = document.getElementById('sig-canvas');
            if (canvas) return canvas.toDataURL('image/png');
        } catch (e) {}
        return null;
    }

    return { generate };
})();
