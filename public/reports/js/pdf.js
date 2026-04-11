// ─── PDF Generation ────────────────────────────────────────────────────────

var PDF = (() => {

    const CONTENT_WIDTH = 940; // px — desired content width for PDF layout
    const WINDOW_WIDTH  = 940; // viewport for CSS rendering

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

        // ── Force body to have zero margin/padding and no scrollbar ─────
        setStyle(document.body, 'margin', '0', styleTracker);
        setStyle(document.body, 'padding', '0', styleTracker);
        setStyle(document.body, 'overflow', 'hidden', styleTracker);
        setStyle(document.documentElement, 'margin', '0', styleTracker);
        setStyle(document.documentElement, 'padding', '0', styleTracker);
        setStyle(document.documentElement, 'overflow', 'hidden', styleTracker);

        // ── Force container to top-left origin so html2canvas captures from x=0 ──
        setStyle(document.body, 'position', 'relative', styleTracker);
        setStyle(container, 'width', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(container, 'maxWidth', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(container, 'margin', '0', styleTracker);
        setStyle(container, 'padding', '0', styleTracker);
        setStyle(container, 'position', 'absolute', styleTracker);
        setStyle(container, 'left', '0px', styleTracker);
        setStyle(container, 'top', '0px', styleTracker);
        setStyle(content, 'width', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(content, 'maxWidth', CONTENT_WIDTH + 'px', styleTracker);
        setStyle(content, 'overflow', 'visible', styleTracker);
        setStyle(content, 'boxSizing', 'border-box', styleTracker);
        setStyle(content, 'padding', '0 10px', styleTracker);
        setStyle(content, 'margin', '0', styleTracker);

        // Ensure ALL sections are visible and expanded for PDF capture
        content.querySelectorAll('.report-section').forEach(sec => {
            sec.style.display = '';
            sec.classList.remove('hidden');
        });
        content.querySelectorAll('[id$="-container"]').forEach(el => {
            el.classList.remove('hidden');
            el.style.display = '';
        });

        // ── Force zero padding/margin on all section-views for tight fit ──
        content.querySelectorAll('.section-view').forEach(sv => {
            setStyle(sv, 'padding', '0', styleTracker);
            setStyle(sv, 'margin', '0', styleTracker);
        });
        // Force header block to flex layout for html2canvas compatibility
        content.querySelectorAll('.ext510-header-block').forEach(hb => {
            setStyle(hb, 'display', 'flex', styleTracker);
            setStyle(hb, 'flexWrap', 'nowrap', styleTracker);
            setStyle(hb, 'alignItems', 'center', styleTracker);
            setStyle(hb, 'padding', '8px 12px', styleTracker);
            setStyle(hb, 'margin', '0', styleTracker);
            setStyle(hb, 'width', '100%', styleTracker);
            setStyle(hb, 'maxWidth', '100%', styleTracker);
            setStyle(hb, 'boxSizing', 'border-box', styleTracker);
            setStyle(hb, 'overflow', 'hidden', styleTracker);
        });

        // Force orientation/data plate grid to flex (html2canvas doesn't support CSS Grid)
        content.querySelectorAll('.orient-dataplate-grid').forEach(grid => {
            setStyle(grid, 'display', 'flex', styleTracker);
            setStyle(grid, 'flexWrap', 'nowrap', styleTracker);
            setStyle(grid, 'gap', '8px', styleTracker);
            setStyle(grid, 'margin', '0', styleTracker);
        });
        content.querySelectorAll('.orient-photo-box').forEach(box => {
            setStyle(box, 'width', 'calc(50% - 4px)', styleTracker);
            setStyle(box, 'flexShrink', '0', styleTracker);
            setStyle(box, 'boxSizing', 'border-box', styleTracker);
        });

        // Force photo grid to flex layout (html2canvas doesn't support CSS Grid)
        // Split photos into groups of 8 per page with page breaks between groups
        content.querySelectorAll('.photo-grid').forEach(grid => {
            const cards = Array.from(grid.querySelectorAll('.photo-card'));
            if (cards.length > 8) {
                // Wrap cards into groups of 8, each in its own container
                grid.innerHTML = '';
                for (let i = 0; i < cards.length; i += 8) {
                    const group = document.createElement('div');
                    group.className = 'photo-page-group';
                    group.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:0;width:100%;';
                    if (i > 0) {
                        // Force page break before groups after the first 8
                        group.classList.add('pdf-page-break');
                        group.style.paddingTop = '4px';
                    }
                    const slice = cards.slice(i, i + 8);
                    slice.forEach(card => group.appendChild(card));
                    grid.appendChild(group);
                }
                setStyle(grid, 'display', 'block', styleTracker);
            } else {
                setStyle(grid, 'display', 'flex', styleTracker);
                setStyle(grid, 'flexWrap', 'wrap', styleTracker);
            }
            setStyle(grid, 'gap', '4px', styleTracker);
            setStyle(grid, 'margin', '0', styleTracker);
        });
        content.querySelectorAll('.photo-card').forEach(card => {
            setStyle(card, 'width', 'calc(50% - 2px)', styleTracker);
            setStyle(card, 'flexShrink', '0', styleTracker);
            setStyle(card, 'boxSizing', 'border-box', styleTracker);
        });
        // Force 270px height on photo images for PDF only (editor stays unchanged)
        content.querySelectorAll('.photo-card img').forEach(img => {
            setStyle(img, 'height', '270px', styleTracker);
            setStyle(img, 'maxHeight', '270px', styleTracker);
            setStyle(img, 'objectFit', 'contain', styleTracker);
            setStyle(img, 'background', '#F4F6F8', styleTracker);
        });
        content.querySelectorAll('.photo-card .photo-caption, .photo-card .photo-caption-pdf').forEach(cap => {
            setStyle(cap, 'fontSize', '10px', styleTracker);
            setStyle(cap, 'padding', '2px 4px', styleTracker);
            setStyle(cap, 'lineHeight', '1.3', styleTracker);
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
            '#photo-file-count', '#photo-preview', '.report-footer',
            '[data-section="inspection_type"]',
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
        content.querySelectorAll('table').forEach(tbl => {
            setStyle(tbl, 'width', '100%', styleTracker);
            setStyle(tbl, 'maxWidth', '100%', styleTracker);
        });
        // Equipment table: use fixed layout so columns share space equally
        content.querySelectorAll('.ext510-equip-table').forEach(tbl => {
            setStyle(tbl, 'tableLayout', 'fixed', styleTracker);
            setStyle(tbl, 'width', '100%', styleTracker);
            setStyle(tbl, 'maxWidth', '100%', styleTracker);
            setStyle(tbl, 'fontSize', '9px', styleTracker);
        });
        content.querySelectorAll('.ext510-equip-table td, .ext510-equip-table th').forEach(cell => {
            setStyle(cell, 'whiteSpace', 'normal', styleTracker);
            setStyle(cell, 'wordWrap', 'break-word', styleTracker);
            setStyle(cell, 'overflowWrap', 'break-word', styleTracker);
            setStyle(cell, 'overflow', 'hidden', styleTracker);
            setStyle(cell, 'padding', '2px 3px', styleTracker);
        });

        // Add page break markers for PDF layout control
        // Mark the HEADING elements (h3) inside checklist and photos so the break
        // happens right before the heading text — keeping heading + content together.
        const checklistContainer = content.querySelector('#checklist-section-container');
        if (checklistContainer && !checklistContainer.classList.contains('hidden')) {
            const clH3 = checklistContainer.querySelector('h3');
            if (clH3) {
                clH3.classList.add('pdf-page-break');
                setStyle(clH3, 'marginTop', '20px', styleTracker);
            }
        }

        const photoSec = content.querySelector('[data-section="photos"]');
        if (photoSec) {
            const phH3 = photoSec.querySelector('h3');
            if (phH3) {
                phH3.classList.add('pdf-page-break');
                setStyle(phH3, 'marginTop', '20px', styleTracker);
            }
        }
        // Mark narrative containers that come before checklist
        const narrativeContainer = content.querySelector('#ext510-narrative-container');
        if (narrativeContainer && !narrativeContainer.classList.contains('hidden')) {
            // Narrative should stay on page 1 — no break needed
        }

        // Add padding to summary/recommendations for cleaner look
        content.querySelectorAll('#ext510-narrative-container .report-section').forEach(sec => {
            setStyle(sec, 'marginBottom', '20px', styleTracker);
        });
        content.querySelectorAll('#ext510-narrative-container .ql-editor, #narrative-sections-container .ql-editor').forEach(ed => {
            setStyle(ed, 'minHeight', '120px', styleTracker);
            setStyle(ed, 'padding', '10px 4px', styleTracker);
            setStyle(ed, 'lineHeight', '1.6', styleTracker);
        });
        content.querySelectorAll('#ext510-narrative-container .section-view h3, #narrative-sections-container .section-view h3').forEach(h3 => {
            setStyle(h3, 'marginBottom', '8px', styleTracker);
        });

        // Force images and divs to stay within width
        content.querySelectorAll('img').forEach(img => {
            setStyle(img, 'maxWidth', '100%', styleTracker);
        });

        // Force all direct children to respect container width
        content.querySelectorAll('.report-section, [id$="-container"]').forEach(el => {
            setStyle(el, 'maxWidth', '100%', styleTracker);
            setStyle(el, 'overflow', 'hidden', styleTracker);
            setStyle(el, 'boxSizing', 'border-box', styleTracker);
        });

        // Force checklist comment cells to clip properly
        content.querySelectorAll('.cl-comment').forEach(el => {
            setStyle(el, 'maxWidth', '100%', styleTracker);
            setStyle(el, 'overflow', 'hidden', styleTracker);
            setStyle(el, 'wordWrap', 'break-word', styleTracker);
        });

        // Pre-process logo: remove white background from live DOM image
        window._pdfLogoDataUrl = null;
        try {
            const liveLogoImg = content.querySelector('.ext510-logo img');
            if (liveLogoImg && liveLogoImg.naturalWidth > 0) {
                const lc = document.createElement('canvas');
                lc.width = liveLogoImg.naturalWidth;
                lc.height = liveLogoImg.naturalHeight;
                const lctx = lc.getContext('2d');
                lctx.drawImage(liveLogoImg, 0, 0);
                const lid = lctx.getImageData(0, 0, lc.width, lc.height);
                const ld = lid.data;
                for (let i = 0; i < ld.length; i += 4) {
                    if (ld[i] > 200 && ld[i+1] > 200 && ld[i+2] > 200) {
                        ld[i+3] = 0;
                    }
                }
                lctx.putImageData(lid, 0, 0);
                window._pdfLogoDataUrl = lc.toDataURL('image/png');
            }
        } catch(e) { /* skip if cross-origin */ }

        // Wait for DOM to settle
        await new Promise(r => setTimeout(r, 400));

        // Force inline colors for html2canvas
        const originals = forceInlineColors(content);

        if (opts.autoDownload && typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined') {
            const filename = `${equipNum}_Final_Report_${new Date().toISOString().slice(0, 10)}.pdf`;

            // Scroll to top before capture to avoid offset issues
            window.scrollTo(0, 0);

            try {
                // Capture the content element directly with html2canvas
                // Use the element's own bounding rect to crop precisely
                const rect = content.getBoundingClientRect();
                const canvas = await html2canvas(content, {
                    scale: 2,
                    useCORS: true,
                    scrollY: -window.scrollY,
                    scrollX: 0,
                    x: rect.left,
                    y: rect.top,
                    width: CONTENT_WIDTH,
                    height: rect.height,
                    windowWidth: WINDOW_WIDTH,
                    logging: false,
                    backgroundColor: '#ffffff',
                    letterRendering: true,
                    onclone: function(clonedDoc) {
                        var cloneBody = clonedDoc.body;
                        cloneBody.style.margin = '0';
                        cloneBody.style.padding = '0';
                        var cloneContainer = clonedDoc.getElementById('report-container');
                        if (cloneContainer) {
                            cloneContainer.style.position = 'absolute';
                            cloneContainer.style.left = '0px';
                            cloneContainer.style.top = '0px';
                            cloneContainer.style.margin = '0';
                            cloneContainer.style.padding = '0';
                            cloneContainer.style.width = CONTENT_WIDTH + 'px';
                            cloneContainer.style.maxWidth = CONTENT_WIDTH + 'px';
                        }
                        var cloneContent = clonedDoc.getElementById('report-content');
                        if (cloneContent) {
                            cloneContent.style.width = CONTENT_WIDTH + 'px';
                            cloneContent.style.maxWidth = CONTENT_WIDTH + 'px';
                            cloneContent.style.margin = '0';
                            cloneContent.style.padding = '0 10px';
                            cloneContent.style.boxSizing = 'border-box';
                        }
                        var style = clonedDoc.createElement('style');
                        style.textContent = '#report-container, .report-container { position: absolute !important; left: 0 !important; top: 0 !important; margin: 0 !important; padding: 0 !important; max-width: ' + CONTENT_WIDTH + 'px !important; width: ' + CONTENT_WIDTH + 'px !important; } ' +
                            '#report-content { margin: 0 !important; padding: 0 10px !important; max-width: ' + CONTENT_WIDTH + 'px !important; width: ' + CONTENT_WIDTH + 'px !important; box-sizing: border-box !important; }';
                        clonedDoc.head.appendChild(style);

                        // Replace all input fields with plain text in the clone
                        clonedDoc.querySelectorAll('.inline-input').forEach(function(inp) {
                            var span = clonedDoc.createElement('span');
                            span.textContent = inp.value || '';
                            span.style.cssText = 'font-size:inherit;color:inherit;';
                            inp.parentNode.replaceChild(span, inp);
                        });
                        clonedDoc.querySelectorAll('.cl-input').forEach(function(inp) {
                            var span = clonedDoc.createElement('span');
                            span.textContent = inp.value || '';
                            span.style.cssText = 'font-size:11px;color:#333;';
                            inp.parentNode.replaceChild(span, inp);
                        });
                        clonedDoc.querySelectorAll('.cl-comment-editable').forEach(function(el) {
                            el.contentEditable = 'false';
                            el.classList.remove('cl-comment-editable');
                            el.style.border = 'none';
                            el.style.outline = 'none';
                            el.style.padding = '0';
                        });
                        clonedDoc.querySelectorAll('[data-section="ext510_inspector"] input').forEach(function(inp) {
                            var span = clonedDoc.createElement('span');
                            span.textContent = inp.value || '';
                            span.style.cssText = 'font-size:12px;color:#333;';
                            inp.parentNode.replaceChild(span, inp);
                        });
                        // Replace logo with pre-processed transparent version
                        if (window._pdfLogoDataUrl) {
                            var cloneLogo = clonedDoc.querySelector('.ext510-logo img');
                            if (cloneLogo) cloneLogo.src = window._pdfLogoDataUrl;
                        }
                        // Convert signature canvas to image in clone
                        var liveSigCanvas = document.getElementById('sig-canvas');
                        var cloneSigCanvas = clonedDoc.getElementById('sig-canvas');
                        if (liveSigCanvas && cloneSigCanvas) {
                            var sigImg = clonedDoc.createElement('img');
                            sigImg.src = liveSigCanvas.toDataURL('image/png');
                            sigImg.style.cssText = 'max-height:60px;max-width:100%;';
                            cloneSigCanvas.parentNode.replaceChild(sigImg, cloneSigCanvas);
                        }
                        // Hide clear button in PDF
                        var cloneSigClear = clonedDoc.getElementById('sig-clear');
                        if (cloneSigClear) cloneSigClear.style.display = 'none';
                    },
                });

                // Letter: 215.9 x 279.4 mm
                const marginTop = 12, marginRight = 10, marginBottom = 12, marginLeft = 10;
                const pageW = 215.9, pageH = 279.4;
                const usableW = pageW - marginLeft - marginRight;
                const usableH = pageH - marginTop - marginBottom;

                // Scale canvas to fit page width
                const imgWidth = usableW;
                const imgHeight = (canvas.height / canvas.width) * imgWidth;

                const { jsPDF } = jspdf;
                const pdf = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'portrait' });

                // Collect forced page break positions (in mm)
                const contentRect = content.getBoundingClientRect();
                const pxToMm = imgWidth / canvas.width * 2; // scale=2
                const forcedBreaks = [];
                content.querySelectorAll('.pdf-page-break').forEach(function(el) {
                    const elRect = el.getBoundingClientRect();
                    // Offset by 10mm before the element so the heading text
                    // is NOT included in the previous page slice
                    const topMm = (elRect.top - contentRect.top) * pxToMm - 10;
                    if (topMm > 10) forcedBreaks.push(topMm);
                });
                forcedBreaks.sort(function(a, b) { return a - b; });

                // Also collect section boundaries for fallback smart breaks
                // Include individual checklist rows to avoid splitting rows across pages
                const sectionBreaks = [];
                content.querySelectorAll('.report-section, .orient-dataplate-grid, .ext510-inspector-table, .ext510-equip-table').forEach(function(el) {
                    const elRect = el.getBoundingClientRect();
                    const topMm = (elRect.top - contentRect.top) * pxToMm;
                    const bottomMm = (elRect.bottom - contentRect.top) * pxToMm;
                    sectionBreaks.push({ top: topMm, bottom: bottomMm });
                });
                // Add checklist table rows as break boundaries so rows aren't split
                content.querySelectorAll('.checklist-table tr').forEach(function(el) {
                    const elRect = el.getBoundingClientRect();
                    const topMm = (elRect.top - contentRect.top) * pxToMm;
                    const bottomMm = (elRect.bottom - contentRect.top) * pxToMm;
                    sectionBreaks.push({ top: topMm, bottom: bottomMm });
                });

                // Build page break points: use forced breaks first, then smart fill
                let yOffset = 0;
                let pageNum = 0;
                var usedBreaks = {};
                while (yOffset < imgHeight) {
                    if (pageNum > 0) pdf.addPage();
                    let sliceH = Math.min(usableH, imgHeight - yOffset);

                    // Check for forced page break within this page's range
                    // Find the FIRST unused forced break in range
                    var nextForced = null;
                    for (var fi = 0; fi < forcedBreaks.length; fi++) {
                        var fb = forcedBreaks[fi];
                        if (usedBreaks[fi]) continue;
                        if (fb > yOffset + 5 && fb <= yOffset + sliceH) {
                            nextForced = fb;
                            usedBreaks[fi] = true;
                            break;
                        }
                    }

                    if (nextForced !== null) {
                        // Break at the forced position
                        sliceH = nextForced - yOffset;
                    } else if (yOffset + sliceH < imgHeight) {
                        // No forced break — use smart section-aware breaking
                        var cutY = yOffset + sliceH;
                        for (var si = 0; si < sectionBreaks.length; si++) {
                            var s = sectionBreaks[si];
                            if (s.top < cutY && s.bottom > cutY) {
                                var breakBefore = s.top - yOffset;
                                if (breakBefore > usableH * 0.3) {
                                    sliceH = breakBefore;
                                }
                                break;
                            }
                        }
                    }

                    const srcY = (yOffset / imgHeight) * canvas.height;
                    const srcH = (sliceH / imgHeight) * canvas.height;

                    const pageCanvas = document.createElement('canvas');
                    pageCanvas.width = canvas.width;
                    pageCanvas.height = Math.ceil(srcH);
                    const ctx = pageCanvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
                    ctx.drawImage(canvas, 0, Math.floor(srcY), canvas.width, Math.ceil(srcH),
                                  0, 0, pageCanvas.width, Math.ceil(srcH));

                    const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
                    pdf.addImage(imgData, 'JPEG', marginLeft, marginTop, usableW, sliceH);
                    yOffset += sliceH;
                    pageNum++;
                }

                addHeaderFooter(pdf, equipNum, reportTitle);
                pdf.save(filename);
            } catch (err) {
                console.error('PDF generation error:', err);
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
            // Remove page break markers
            content.querySelectorAll('.pdf-page-break').forEach(el => el.classList.remove('pdf-page-break'));
            // Restore photo grid from page groups back to flat list
            content.querySelectorAll('.photo-grid').forEach(grid => {
                const groups = grid.querySelectorAll('.photo-page-group');
                if (groups.length > 0) {
                    const cards = Array.from(grid.querySelectorAll('.photo-card'));
                    groups.forEach(g => g.remove());
                    cards.forEach(c => grid.appendChild(c));
                }
            });
        }
    }

    return { generate };
})();
