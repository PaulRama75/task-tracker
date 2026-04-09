// ─── PDF Generation ────────────────────────────────────────────────────────

const PDF = (() => {

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

    async function generate(reportData, opts = {}) {
        const content = document.getElementById('report-content');
        const equipNum = reportData.equipment_number || 'Report';
        const config = API.getReportTypeConfig(reportData.report_type || 'tower');
        const reportTitle = config.title || 'INSPECTION REPORT';

        // Apply PDF mode
        content.classList.add('pdf-mode');
        document.body.classList.add('printing');

        // Ensure ALL sections are visible and expanded for PDF capture
        content.querySelectorAll('.report-section').forEach(sec => {
            sec.style.display = '';
            sec.classList.remove('hidden');
        });
        content.querySelectorAll('[id$="-container"]').forEach(el => {
            el.classList.remove('hidden');
            el.style.display = '';
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

        // Wait for DOM to settle
        await new Promise(r => setTimeout(r, 300));

        // Force inline colors for html2canvas
        const originals = forceInlineColors(content);

        if (opts.autoDownload && typeof html2pdf !== 'undefined') {
            const filename = `${equipNum}_Final_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

            // Letter size: 8.5 x 11 inches = 215.9 x 279.4 mm
            const pdfOpt = {
                margin: [12, 8, 14, 8],  // top, right, bottom, left in mm
                filename,
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    scrollY: 0,
                    windowWidth: 980,
                    logging: false,
                    backgroundColor: '#ffffff',
                    removeContainer: true,
                    letterRendering: true,
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
        }
    }

    return { generate };
})();
