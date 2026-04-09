// ─── PDF Generation ────────────────────────────────────────────────────────

const PDF = (() => {

    const CONTENT_WIDTH = 980; // px — fixed width for PDF rendering
    const WINDOW_WIDTH = CONTENT_WIDTH + 20; // slightly wider viewport

    function addHeaderFooter(pdf, equipNum, reportTitle) {
        const pageCount = pdf.internal.getNumberOfPages();
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();

        for (let i = 1; i <= pageCount; i++) {
            pdf.setPage(i);

            // Top center: Equipment # - Report Name
            pdf.setFontSize(9);
            pdf.setTextColor(80, 80, 80);
            const headerText = `${equipNum} - ${reportTitle}`;
            const headerW = pdf.getStringUnitWidth(headerText) * 9 / pdf.internal.scaleFactor;
            pdf.text(headerText, (pageW - headerW) / 2, 8);

            // Bottom left: Ferinspection.com
            pdf.setFontSize(8);
            pdf.setTextColor(120, 120, 120);
            pdf.text('Ferinspection.com', 10, pageH - 6);

            // Bottom right: Page X / Y
            const pageText = `Page ${i} / ${pageCount}`;
            const pageTextW = pdf.getStringUnitWidth(pageText) * 8 / pdf.internal.scaleFactor;
            pdf.text(pageText, pageW - pageTextW - 10, pageH - 6);
        }
    }

    // Force inline styles on colored elements so html2canvas picks them up
    function forceInlineColors(content) {
        const colorMap = [
            { sel: '.ext510-header-block', bg: '#a0a0a0', color: '#222' },
            { sel: '.ext510-equip-id', bg: '#888888', color: '#ffffff' },
            { sel: '.ext510-tbl-hdr', bg: '#222222', color: '#ffffff' },
            { sel: '.ext510-insp-label', bg: '#222222', color: '#ffffff' },
            { sel: '.checklist-table thead th', bg: '#222222', color: '#ffffff' },
            { sel: '.cl-cat-cell', bg: '#eeeeee', color: '#000000' },
            { sel: '.orient-photo-label', bg: '#222222', color: '#ffffff' },
            { sel: '.report-section .section-view h3', bg: '#000000', color: '#ffffff' },
        ];
        const originals = [];
        colorMap.forEach(({ sel, bg, color }) => {
            content.querySelectorAll(sel).forEach(el => {
                originals.push({ el, bg: el.style.backgroundColor, color: el.style.color });
                el.style.backgroundColor = bg;
                el.style.color = color;
            });
        });
        return originals;
    }

    function restoreInlineColors(originals) {
        originals.forEach(({ el, bg, color }) => {
            el.style.backgroundColor = bg;
            el.style.color = color;
        });
    }

    // Collect all inline style overrides so cleanup can restore them
    function setStyle(el, prop, val, tracker) {
        tracker.push({ el, prop, prev: el.style[prop] });
        el.style[prop] = val;
    }

    async function generate(reportData, opts = {}) {
        const container = document.getElementById('report-container');
        const content = document.getElementById('report-content');
        const equipNum = reportData.equipment_number || 'Report';
        const config = API.getReportTypeConfig(reportData.report_type || 'tower');
        const reportTitle = config.title || 'INSPECTION REPORT';

        // Track all inline style changes for cleanup
        const styleTracker = [];

        // Apply PDF mode
        content.classList.add('pdf-mode');
        document.body.classList.add('printing');

        // ── Force fixed width on container chain ─────────────────────────
        setStyle(container, 'width', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(container, 'maxWidth', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(container, 'margin', '0', styleTracker);
        setStyle(container, 'padding', '0', styleTracker);
        setStyle(content, 'width', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(content, 'maxWidth', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(content, 'overflow', 'hidden', styleTracker);
        setStyle(content, 'boxSizing', 'border-box', styleTracker);

        // Ensure ALL sections are visible and expanded for PDF capture
        content.querySelectorAll('.report-section').forEach(sec => {
            sec.style.display = '';
            sec.classList.remove('hidden');
        });
        content.querySelectorAll('[id$="-container"]').forEach(el => {
            el.classList.remove('hidden');
            el.style.display = '';
        });

        // ── Hide all UI / interactive elements ───────────────────────────
        const hideSelectors = [
            '#photo-upload-area', '#photo-upload-panel', '.photo-file-input',
            '.orient-photo-actions', '.save-bar', '.version-banner',
            '.import-bar', '.lock-status', '.top-bar',
            '#btn-lock', '#btn-unlock', '#btn-pdf',
            '.btn-edit', '.btn-save', '.btn-cancel',
            '.section-toolbar', '.cl-toolbar',
            'input[type="file"]', '.ql-toolbar',
            '#inspector-edit-area', '#btn-add-inspector',
            '.photo-drop-zone', '#photo-drop-zone',
            '#btn-choose-photos', '#btn-camera',
            '#photo-file-count', '#photo-preview',
        ];
        const hiddenEls = [];
        hideSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                hiddenEls.push({ el, prev: el.style.display });
                el.style.display = 'none';
            });
        });

        // Hide Quill editor chrome
        document.querySelectorAll('.ql-container.ql-snow').forEach(c => {
            setStyle(c, 'border', 'none', styleTracker);
        });
        document.querySelectorAll('.ql-editor').forEach(ed => {
            setStyle(ed, 'padding', '0', styleTracker);
            setStyle(ed, 'minHeight', 'auto', styleTracker);
        });

        // Show photo captions as text (not input fields) for PDF
        content.querySelectorAll('.caption-input').forEach(inp => {
            const span = document.createElement('span');
            span.className = 'photo-caption-pdf';
            span.textContent = inp.value || '';
            span.style.cssText = 'font-size:11px;display:block;padding:2px 4px;color:#333;';
            inp.style.display = 'none';
            inp.parentNode.appendChild(span);
        });

        // ── Force tables to fit within fixed width ─────────────────────
        // Default: all tables get auto layout and 100% width
        content.querySelectorAll('table').forEach(tbl => {
            setStyle(tbl, 'tableLayout', 'auto', styleTracker);
            setStyle(tbl, 'width', '100%', styleTracker);
        });
        // Checklist & equipment tables: smaller font to fit
        content.querySelectorAll('.checklist-table, .ext510-equip-table').forEach(tbl => {
            setStyle(tbl, 'fontSize', '10px', styleTracker);
        });
        // All tables: constrain max width
        content.querySelectorAll('table').forEach(tbl => {
            setStyle(tbl, 'maxWidth', '100%', styleTracker);
        });
        // Force cells to wrap text (prevent overflow)
        content.querySelectorAll('td, th').forEach(cell => {
            setStyle(cell, 'wordWrap', 'break-word', styleTracker);
            setStyle(cell, 'overflowWrap', 'break-word', styleTracker);
            setStyle(cell, 'overflow', 'hidden', styleTracker);
        });
        // Checklist cells: keep nowrap for compact columns, wrap for item/category
        content.querySelectorAll('.cl-cat-cell, .cl-item-cell, .cl-comment-cell, .cl-loc-cell').forEach(cell => {
            setStyle(cell, 'whiteSpace', 'normal', styleTracker);
        });
        content.querySelectorAll('.cl-check-cell').forEach(cell => {
            setStyle(cell, 'whiteSpace', 'nowrap', styleTracker);
            setStyle(cell, 'width', 'auto', styleTracker);
        });

        // Force images and divs to stay within width
        content.querySelectorAll('img').forEach(img => {
            setStyle(img, 'maxWidth', '100%', styleTracker);
        });
        content.querySelectorAll('.ext510-header-block').forEach(el => {
            setStyle(el, 'maxWidth', '100%', styleTracker);
            setStyle(el, 'boxSizing', 'border-box', styleTracker);
        });

        // Wait for DOM to settle
        await new Promise(r => setTimeout(r, 400));

        // Force inline colors for html2canvas
        const originals = forceInlineColors(content);

        if (opts.autoDownload && typeof html2pdf !== 'undefined') {
            const filename = `${equipNum}_Final_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

            // Letter size: 8.5 x 11 inches = 215.9 x 279.4 mm
            const pdfOpt = {
                margin: [12, 6, 14, 6],  // top, right, bottom, left in mm
                filename,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    scrollY: 0,
                    scrollX: 0,
                    windowWidth: WINDOW_WIDTH,
                    width: CONTENT_WIDTH,
                    logging: false,
                    backgroundColor: '#ffffff',
                    removeContainer: true,
                    letterRendering: true,
                    x: 0,
                    y: 0,
                },
                jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
                pagebreak: {
                    mode: ['css', 'legacy'],
                    before: '.page-break-before',
                    after: '.page-break-after',
                    avoid: ['.photo-card', '.info-table', 'tr', '.orient-photo-box', '.ext510-header-block', '.checklist-table thead'],
                },
            };

            try {
                const worker = html2pdf().set(pdfOpt).from(content);
                const pdf = await worker.toPdf().get('pdf');
                addHeaderFooter(pdf, equipNum, reportTitle);
                await worker.save();
            } catch (err) {
                console.error('html2pdf error:', err);
                window.print();
            } finally {
                cleanup();
            }
            return true;
        } else {
            cleanup();
            window.print();
            setTimeout(() => {
                content.classList.remove('pdf-mode');
                document.body.classList.remove('printing');
                App.toast('Use "Save as PDF" in the print dialog.', 'info');
            }, 500);
            return true;
        }

        function cleanup() {
            restoreInlineColors(originals);
            content.classList.remove('pdf-mode');
            document.body.classList.remove('printing');
            // Remove caption spans added for PDF
            content.querySelectorAll('.photo-caption-pdf').forEach(s => s.remove());
            content.querySelectorAll('.caption-input').forEach(inp => inp.style.display = '');
            // Restore all inline style overrides
            styleTracker.forEach(({ el, prop, prev }) => { el.style[prop] = prev; });
            // Restore hidden UI elements
            hiddenEls.forEach(({ el, prev }) => { el.style.display = prev; });
        }
    }

    return { generate };
})();
