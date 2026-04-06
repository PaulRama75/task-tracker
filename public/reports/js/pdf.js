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
            pdf.text(headerText, (pageW - headerW) / 2, 6);

            // Bottom left: Ferinspection.com
            pdf.setFontSize(8);
            pdf.setTextColor(120, 120, 120);
            pdf.text('Ferinspection.com', 8, pageH - 4);

            // Bottom right: Page X / Y
            const pageText = `Page ${i} / ${pageCount}`;
            const pageTextW = pdf.getStringUnitWidth(pageText) * 8 / pdf.internal.scaleFactor;
            pdf.text(pageText, pageW - pageTextW - 8, pageH - 4);
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
        await new Promise(r => setTimeout(r, 150));

        // Force inline colors for html2canvas
        const originals = forceInlineColors(content);

        if (opts.autoDownload && typeof html2pdf !== 'undefined') {
            const filename = `${equipNum}_Final_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

            const pdfOpt = {
                margin: [8, 5, 10, 5],
                filename,
                image: { type: 'jpeg', quality: 0.92 },
                html2canvas: {
                    scale: 2,
                    useCORS: true,
                    scrollY: 0,
                    windowWidth: 850,
                    logging: false,
                    backgroundColor: '#ffffff',
                    removeContainer: true,
                },
                jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'], avoid: ['.photo-card', '.info-table', 'tr'] },
            };

            try {
                const worker = html2pdf().set(pdfOpt).from(content);
                const pdf = await worker.toPdf().get('pdf');
                addHeaderFooter(pdf, equipNum, reportTitle);
                await worker.save();
                restoreInlineColors(originals);
                content.classList.remove('pdf-mode');
                document.body.classList.remove('printing');
                return true;
            } catch (err) {
                restoreInlineColors(originals);
                content.classList.remove('pdf-mode');
                document.body.classList.remove('printing');
                window.print();
                setTimeout(() => {
                    content.classList.remove('pdf-mode');
                    document.body.classList.remove('printing');
                }, 500);
                return true;
            }
        } else {
            restoreInlineColors(originals);
            // Browser print — use CSS for headers/footers
            window.print();
            setTimeout(() => {
                content.classList.remove('pdf-mode');
                document.body.classList.remove('printing');
                App.toast('Use "Save as PDF" in the print dialog.', 'info');
            }, 500);
            return true;
        }
    }

    return { generate };
})();
