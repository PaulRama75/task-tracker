// ─── Word Document Generator for Reports ────────────────────────────────────
const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, HeadingLevel, BorderStyle, ImageRun,
    TableLayoutType, VerticalAlign, ShadingType, PageBreak,
    Header, Footer, PageNumber, NumberFormat
} = require('docx');
const fs = require('fs');
const path = require('path');

// ─── Report Type Configs (mirrored from client api.js) ──────────────────────
const reportTypeConfigs = {
    tower: {
        title: 'TOWER INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-01',
        headerFields: [
            ['Equipment Name:', 'equipment_name', null, null],
            ['Equipment Type:', 'equipment_type', null, null],
            ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
            ['Height:', 'height', 'Internal Diameter:', 'internal_diameter'],
            ['Head Material:', 'head_material', 'Head Thickness:', 'head_thickness'],
            ['Cladding/Lining Material:', 'cladding_material', 'NDE Performed:', 'nde_performed'],
            ['Stress Relieved:', 'stress_relieved', 'Corrosion Allowance:', 'corrosion_allowance'],
            ['Acceptance Criteria:', 'acceptance_criteria', null, null],
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'repairs', title: 'REPAIRS' },
            { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
            { key: 'shell', title: 'SHELL' },
            { key: 'heads', title: 'HEADS' },
            { key: 'nozzles', title: 'NOZZLES' },
            { key: 'trays', title: 'TRAYS' },
            { key: 'internal_piping', title: 'INTERNAL PIPING' },
            { key: 'clad_overlay', title: 'CLAD / OVERLAY' },
            { key: 'external_inspection', title: 'EXTERNAL' },
        ],
    },
    exchanger: {
        title: 'EXCHANGER INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-02',
        headerFields: [
            ['Equipment Name:', 'equipment_name', null, null],
            ['Equipment Type:', 'equipment_type', null, null],
            ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
            ['Cladding/Lining Material:', 'cladding_material', 'Internal Diameter:', 'internal_diameter'],
            ['Tube Material:', 'tube_material', 'Tube Thickness:', 'tube_thickness'],
            ['ECT Performed / Method:', 'ect_performed', 'Test Pressure:', 'test_pressure'],
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'repairs', title: 'REPAIRS' },
            { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
            { key: 'shell', title: 'SHELL' },
            { key: 'shell_cover', title: 'SHELL COVER' },
            { key: 'channel_head', title: 'CHANNEL HEAD' },
            { key: 'channel_cover', title: 'CHANNEL COVER' },
            { key: 'floating_head', title: 'FLOATING HEAD' },
            { key: 'bundle', title: 'BUNDLE' },
            { key: 'eddy_current', title: 'EDDY CURRENT RESULTS' },
            { key: 'external_inspection', title: 'EXTERNAL' },
        ],
    },
    aircooler: {
        title: 'AIR COOLER INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-03',
        headerFields: [
            ['Equipment Name:', 'equipment_name', null, null],
            ['Equipment Type:', 'equipment_type', null, null],
            ['Header Box Material:', 'header_box_material', 'Header Box Thickness:', 'header_box_thickness'],
            ['Tube Sheet Material:', 'tube_sheet_material', 'Tube Sheet Thickness:', 'tube_sheet_thickness'],
            ['Tube Material:', 'tube_material', 'Tube Thickness:', 'tube_thickness'],
            ['Total Tubes:', 'total_tubes', 'ECT Performed / Method:', 'ect_performed'],
            ['Test Pressure:', 'test_pressure', null, null],
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'repairs', title: 'REPAIRS' },
            { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
            { key: 'header_boxes', title: 'HEADER BOXES' },
            { key: 'tube_sheets', title: 'TUBE SHEETS' },
            { key: 'tube_id_od', title: 'TUBE ID / TUBE OD' },
            { key: 'eddy_current', title: 'EDDY CURRENT RESULTS' },
            { key: 'external_inspection', title: 'EXTERNAL' },
        ],
    },
    drum: {
        title: 'DRUM INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-04',
        headerFields: [
            ['Equipment Name:', 'equipment_name', null, null],
            ['Equipment Type:', 'equipment_type', null, null],
            ['Shell Material:', 'shell_material', 'Shell Thickness:', 'shell_thickness'],
            ['Height:', 'height', 'Internal Diameter:', 'internal_diameter'],
            ['Head Material:', 'head_material', 'Head Thickness:', 'head_thickness'],
            ['Cladding/Lining Material:', 'cladding_material', 'NDE Performed:', 'nde_performed'],
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'repairs', title: 'REPAIRS' },
            { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
            { key: 'shell', title: 'SHELL' },
            { key: 'heads', title: 'HEADS' },
            { key: 'nozzles', title: 'NOZZLES' },
            { key: 'internal_piping', title: 'INTERNAL PIPING' },
            { key: 'clad_overlay', title: 'CLAD / OVERLAY' },
            { key: 'external_inspection', title: 'EXTERNAL' },
        ],
    },
    heater: {
        title: 'HEATER INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-05',
        headerFields: [
            ['Equipment Name:', 'equipment_name', null, null],
            ['Equipment Type:', 'equipment_type', null, null],
            ['MFR #:', 'mfr_number', null, null],
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'repairs', title: 'REPAIRS' },
            { key: 'future_recommendations', title: 'FUTURE RECOMMENDATIONS' },
            { key: 'radiant_tube_coils', title: 'RADIANT SECTION - TUBE COILS' },
            { key: 'radiant_tube_supports', title: 'RADIANT SECTION - TUBE SUPPORTS' },
            { key: 'radiant_refractory', title: 'RADIANT SECTION - REFRACTORY / LINING' },
            { key: 'radiant_burners', title: 'RADIANT SECTION - BURNERS' },
            { key: 'radiant_snuffing_steam', title: 'RADIANT SECTION - SNUFFING STEAM' },
            { key: 'radiant_thermocouples', title: 'RADIANT SECTION - THERMOCOUPLES' },
            { key: 'convection_tube_coils', title: 'CONVECTION SECTION - TUBE COILS' },
            { key: 'convection_tube_supports', title: 'CONVECTION SECTION - TUBE SUPPORTS' },
            { key: 'convection_refractory', title: 'CONVECTION SECTION - REFRACTORY / LINING' },
            { key: 'convection_thermowells', title: 'CONVECTION SECTION - THERMOWELLS' },
            { key: 'convection_misc', title: 'CONVECTION SECTION - MISCELLANEOUS' },
            { key: 'stack', title: 'HEATER STACK - STACK' },
            { key: 'ducting', title: 'HEATER STACK - DUCTING' },
            { key: 'dampers', title: 'HEATER STACK - DAMPERS' },
            { key: 'external_inspection', title: 'EXTERNAL' },
        ],
    },
    ext510: {
        title: 'API 510 EXTERNAL INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-06',
        headerFields: [
            ['Description:', 'description', null, null],
            ['National BD #:', 'national_bd_number', 'Year Built:', 'year_built'],
            ['PWHT:', 'pwht', 'System / Service:', 'system_service'],
            ['Design Pressure (PSIG):', 'design_pressure', 'Design Temp. (\u00B0F):', 'design_temp'],
            ['Oper. Pressure (PSIG):', 'oper_pressure', 'Oper. Temp. (\u00B0F):', 'oper_temp'],
            ['P&ID:', 'p_and_id', null, null],
        ],
        checklistCategories: [
            { title: 'GENERAL- VESSEL "(ISSUES)"', items: [
                { num: 1, label: 'Other (please explain)' }, { num: 2, label: 'Corrosion' },
                { num: 3, label: 'Leaks' }, { num: 4, label: 'Vibration' },
                { num: 5, label: 'Dissimilar Flange Rating' }, { num: 6, label: 'Ladder / Stairway' },
                { num: 7, label: 'Guy Wires' }, { num: 8, label: 'Electrical Grounding' },
                { num: 9, label: 'Painted Inactive Corrosion' }, { num: 10, label: 'Coating / Painting' },
                { num: 11, label: 'Gauge / Site Glass' },
            ]},
            { title: 'SUPPORTS', items: [
                { num: 12, label: 'Other (please explain)' }, { num: 13, label: 'Foundation' },
                { num: 14, label: 'Anchor Bolts' }, { num: 15, label: 'Saddle / Skirt / Wear Pads' },
                { num: 16, label: 'Davit Arm' }, { num: 17, label: 'Fireproofing' },
            ]},
            { title: 'COMPONENTS', items: [
                { num: 18, label: 'Other (please explain)' }, { num: 19, label: 'Small Branch' },
                { num: 20, label: 'Nozzles' }, { num: 21, label: 'Manways' },
                { num: 22, label: 'Reinforcement Pad' }, { num: 23, label: 'Thread Engagement' },
                { num: 24, label: 'Bolting' }, { num: 25, label: 'Flanges' },
                { num: 26, label: 'Threaded connections' }, { num: 27, label: 'Nameplate' },
            ]},
            { title: 'INSULATION', items: [
                { num: 28, label: 'Other (please explain)' }, { num: 29, label: 'Damage' },
                { num: 30, label: 'Penetrations' }, { num: 31, label: 'Jacket' },
                { num: 32, label: 'Banding' }, { num: 33, label: 'Seals / Joints / Caulking' },
            ]},
            { title: 'SAFETY RELIEF', items: [
                { num: 34, label: 'Relief Valve' },
                { num: 35, label: 'Relief Valve Inlet/Outlet Restricted' },
            ]},
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'recommendations', title: 'RECOMMENDATIONS' },
        ],
    },
    ext570: {
        title: 'API 570 EXTERNAL INSPECTION REPORT',
        formNumber: 'FER-PROJ-FORM-07',
        idLabel: 'CIRCUIT ID',
        headerFields: [
            ['Description:', 'description', null, null],
            ['Line #:', 'line_number', 'Material:', 'material'],
            ['Pipe Spec:', 'pipe_spec', 'System / Service:', 'system_service'],
            ['Design Pressure (PSIG):', 'design_pressure', 'Design Temp. (\u00B0F):', 'design_temp'],
            ['Oper. Pressure (PSIG):', 'oper_pressure', 'Oper. Temp. (\u00B0F):', 'oper_temp'],
            ['P&ID:', 'p_and_id', null, null],
        ],
        checklistCategories: [
            { title: 'GENERAL- PIPING "(ISSUES)"', items: [
                { num: 1, label: 'Active Process Leaks?' },
                { num: 2, label: 'Leak Repair Devices. If yes (List)' },
                { num: 3, label: 'Pipe \u2013 Cracks or Corrosion' },
                { num: 4, label: 'Dead leg. If yes (Document Temperature Range?)' },
                { num: 5, label: "Long Horizontal Runs (Over 100')" },
                { num: 6, label: 'Abnormal Thermal Expansion / Deformation' },
                { num: 7, label: 'Vibration \u2013 Overhung Weight / Supports' },
                { num: 8, label: 'Cantilevered Branches (Vents, Drains, Etc.)' },
                { num: 9, label: 'Piping Misalignment / Restricted Movement' },
                { num: 10, label: 'Bolting with Inadequate Thread Engagement' },
                { num: 11, label: 'Counterbalance Condition' },
                { num: 12, label: 'Soil to Air Interface' },
                { num: 13, label: 'Welds and Heat-Affected Zones Corrosion or Damage' },
                { num: 14, label: 'Flanges with Corrosion or Damage' },
                { num: 'Other', label: 'Other' },
            ]},
            { title: 'Insulation / Fireproofing', items: [
                { num: 15, label: 'Insulated. If yes (Condition)' },
                { num: 16, label: 'Circuit Insulated. If Yes (Approximate %)' },
                { num: 17, label: 'Insulation Type (Identify)' },
                { num: 18, label: 'Circuit Operates Within CUI Range? \u2013 If yes (Temp)' },
                { num: 19, label: 'Sweating Service' },
                { num: 20, label: 'Steam Traced' },
                { num: 21, label: 'Evidence of Corrosion Under Insulation' },
                { num: 22, label: 'Challenge Need for Insulation' },
                { num: 'Other', label: 'Other' },
            ]},
            { title: 'COATINGS', items: [
                { num: 23, label: 'Coated. If yes (Condition? Grade 1 \u2013 5)' },
                { num: 24, label: 'Is the coating identified as containing lead?' },
                { num: 'Other', label: 'Other' },
            ]},
            { title: 'SUPPORTS', items: [
                { num: 25, label: 'Loose Support Causing Fretting / Metal Wear' },
                { num: 26, label: 'Pipe or Shoe Off Supports' },
                { num: 27, label: 'Support / Hangers / Braces' },
                { num: 28, label: 'Corrosion at Supports / Hangers/Braces' },
                { num: 29, label: 'Bottomed Out Spring Hangers' },
                { num: 30, label: 'Support Bolting' },
            ]},
        ],
        narrativeSections: [
            { key: 'summary', title: 'SUMMARY' },
            { key: 'recommendations', title: 'RECOMMENDATIONS' },
        ],
    },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const NAVY = '1F3A5F';
const WHITE = 'FFFFFF';
const LIGHT_GRAY = 'F4F6F8';
const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };
const thinBorders = {
    top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
};

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<li[^>]*>/gi, '  \u2022 ')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function base64ToBuffer(dataUrl) {
    if (!dataUrl) return null;
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
    if (!match) return null;
    return Buffer.from(match[2], 'base64');
}

function sectionHeading(title) {
    return new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 24, color: WHITE, font: 'Arial' })],
        alignment: AlignmentType.CENTER,
        shading: { type: ShadingType.CLEAR, fill: NAVY },
        spacing: { before: 200, after: 100 },
    });
}

function labelValueRow(label, value, label2, value2) {
    const cells = [
        new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: label || '', bold: true, size: 18, font: 'Arial' })] })],
            width: { size: 25, type: WidthType.PERCENTAGE },
            borders: thinBorders,
            shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY },
        }),
        new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: value || '', size: 18, font: 'Arial' })] })],
            width: { size: label2 ? 25 : 75, type: WidthType.PERCENTAGE },
            borders: thinBorders,
        }),
    ];
    if (label2) {
        cells.push(new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: label2, bold: true, size: 18, font: 'Arial' })] })],
            width: { size: 25, type: WidthType.PERCENTAGE },
            borders: thinBorders,
            shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY },
        }));
        cells.push(new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: value2 || '', size: 18, font: 'Arial' })] })],
            width: { size: 25, type: WidthType.PERCENTAGE },
            borders: thinBorders,
        }));
    }
    return new TableRow({ children: cells });
}

// ─── Main Generator ──────────────────────────────────────────────────────────

async function generateDocx(report) {
    const type = report.report_type || 'tower';
    const config = reportTypeConfigs[type] || reportTypeConfigs.tower;
    const sections = report.sections || {};
    const headerData = (sections.header || {}).section_data || {};
    const isExt = type === 'ext510' || type === 'ext570';
    const idLabel = config.idLabel || 'EQUIPMENT ID';

    const children = [];

    // ── Logo ─────────────────────────────────────────────────────────────
    const logoPath = path.join(__dirname, '..', 'public', 'reports', 'images', 'fer-logo.png');
    if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        children.push(new Paragraph({
            children: [new ImageRun({ data: logoBuffer, transformation: { width: 100, height: 80 } })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
        }));
    }

    // ── Title ────────────────────────────────────────────────────────────
    children.push(new Paragraph({
        children: [new TextRun({ text: config.title, bold: true, size: 32, color: NAVY, font: 'Arial' })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 50 },
    }));

    // ── Form number & dates ──────────────────────────────────────────────
    const now = new Date().toISOString().slice(0, 10);
    children.push(new Paragraph({
        children: [
            new TextRun({ text: `${config.formNumber}`, size: 16, color: '666666', font: 'Arial' }),
            new TextRun({ text: `    Issue Date: ${now}`, size: 16, color: '666666', font: 'Arial' }),
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 100 },
    }));

    // ── Equipment ID bar ─────────────────────────────────────────────────
    children.push(new Paragraph({
        children: [new TextRun({ text: `${idLabel}: ${headerData.equipment_number || report.equipment_number || ''}`, bold: true, size: 22, color: WHITE, font: 'Arial' })],
        alignment: AlignmentType.CENTER,
        shading: { type: ShadingType.CLEAR, fill: '666666' },
        spacing: { after: 100 },
    }));

    // ── Equipment Info Table ─────────────────────────────────────────────
    // Table width = page width (12240) - left margin (720) - right margin (720) = 10800 DXA
    const TABLE_W = 10800;
    const COL5 = TABLE_W / 5; // 2160 per column for 5-col tables

    function hdrCell(text, span, width) {
        return new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18, color: WHITE, font: 'Arial' })], alignment: AlignmentType.CENTER })],
            shading: { type: ShadingType.CLEAR, fill: NAVY },
            borders: thinBorders,
            width: { size: width, type: WidthType.DXA },
            columnSpan: span || 1,
            verticalAlign: VerticalAlign.CENTER,
        });
    }
    function valCell(text, span, width) {
        return new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: text || '', size: 18, font: 'Arial' })], alignment: AlignmentType.CENTER })],
            borders: thinBorders,
            width: { size: width, type: WidthType.DXA },
            columnSpan: span || 1,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
        });
    }

    if (type === 'ext570') {
        // 570 EXT piping layout – 5 columns, 6 rows
        const equipTable = new Table({
            width: { size: TABLE_W, type: WidthType.DXA },
            columnWidths: [COL5, COL5, COL5, COL5, COL5],
            layout: TableLayoutType.FIXED,
            rows: [
                // Row 1: headers
                new TableRow({ children: [
                    hdrCell('UNIT #', 1, COL5),
                    hdrCell('SYSTEM / CIRCUIT #', 2, COL5 * 2),
                    hdrCell('DESCRIPTION', 2, COL5 * 2),
                ]}),
                // Row 2: values
                new TableRow({ children: [
                    valCell(headerData.unit_number || report.unit_number || '', 1, COL5),
                    valCell(headerData.equipment_number || report.equipment_number || '', 2, COL5 * 2),
                    valCell(headerData.description || '', 2, COL5 * 2),
                ]}),
                // Row 3: headers
                new TableRow({ children: [
                    hdrCell('LINE #', 1, COL5),
                    hdrCell('MATERIAL', 1, COL5),
                    hdrCell('PIPE SPEC', 1, COL5),
                    hdrCell('SYSTEM / SERVICE', 2, COL5 * 2),
                ]}),
                // Row 4: values
                new TableRow({ children: [
                    valCell(headerData.line_number || '', 1, COL5),
                    valCell(headerData.material || '', 1, COL5),
                    valCell(headerData.pipe_spec || '', 1, COL5),
                    valCell(headerData.system_service || '', 2, COL5 * 2),
                ]}),
                // Row 5: headers
                new TableRow({ children: [
                    hdrCell('DESIGN PRESSURE', 1, COL5),
                    hdrCell('DESIGN TEMP.', 1, COL5),
                    hdrCell('OPER. PRESSURE', 1, COL5),
                    hdrCell('OPER. TEMP.', 1, COL5),
                    hdrCell('P&ID', 1, COL5),
                ]}),
                // Row 6: values
                new TableRow({ children: [
                    valCell(headerData.design_pressure ? `${headerData.design_pressure} PSIG` : '', 1, COL5),
                    valCell(headerData.design_temp ? `${headerData.design_temp} \u00B0F` : '', 1, COL5),
                    valCell(headerData.oper_pressure ? `${headerData.oper_pressure} PSIG` : '', 1, COL5),
                    valCell(headerData.oper_temp ? `${headerData.oper_temp} \u00B0F` : '', 1, COL5),
                    valCell(headerData.p_and_id || '', 1, COL5),
                ]}),
            ],
        });
        children.push(equipTable);

    } else if (type === 'ext510') {
        // 510 EXT vessel layout – 5 columns, 6 rows
        const equipTable = new Table({
            width: { size: TABLE_W, type: WidthType.DXA },
            columnWidths: [COL5, COL5, COL5, COL5, COL5],
            layout: TableLayoutType.FIXED,
            rows: [
                // Row 1: headers
                new TableRow({ children: [
                    hdrCell('UNIT #', 1, COL5),
                    hdrCell('EQUIPMENT #', 2, COL5 * 2),
                    hdrCell('DESCRIPTION', 2, COL5 * 2),
                ]}),
                // Row 2: values
                new TableRow({ children: [
                    valCell(headerData.unit_number || report.unit_number || '', 1, COL5),
                    valCell(headerData.equipment_number || report.equipment_number || '', 2, COL5 * 2),
                    valCell(headerData.description || '', 2, COL5 * 2),
                ]}),
                // Row 3: headers
                new TableRow({ children: [
                    hdrCell('SERIAL #', 1, COL5),
                    hdrCell('NATIONAL BD #', 1, COL5),
                    hdrCell('YEAR BUILT', 1, COL5),
                    hdrCell('PWHT', 1, COL5),
                    hdrCell('SYSTEM / SERVICE', 1, COL5),
                ]}),
                // Row 4: values
                new TableRow({ children: [
                    valCell(headerData.nb_serial_number || '', 1, COL5),
                    valCell(headerData.national_bd_number || '', 1, COL5),
                    valCell(headerData.year_built || '', 1, COL5),
                    valCell(headerData.pwht || '', 1, COL5),
                    valCell(headerData.system_service || '', 1, COL5),
                ]}),
                // Row 5: headers
                new TableRow({ children: [
                    hdrCell('DESIGN PRESSURE', 1, COL5),
                    hdrCell('DESIGN TEMP.', 1, COL5),
                    hdrCell('OPER. PRESSURE', 1, COL5),
                    hdrCell('OPER. TEMP.', 1, COL5),
                    hdrCell('P&ID', 1, COL5),
                ]}),
                // Row 6: values
                new TableRow({ children: [
                    valCell(headerData.design_pressure ? `${headerData.design_pressure} PSIG` : '', 1, COL5),
                    valCell(headerData.design_temp ? `${headerData.design_temp} \u00B0F` : '', 1, COL5),
                    valCell(headerData.oper_pressure ? `${headerData.oper_pressure} PSIG` : '', 1, COL5),
                    valCell(headerData.oper_temp ? `${headerData.oper_temp} \u00B0F` : '', 1, COL5),
                    valCell(headerData.p_and_id || '', 1, COL5),
                ]}),
            ],
        });
        children.push(equipTable);

    } else {
        // Default report types (tower, exchanger, aircooler, drum, heater) – 4 columns
        const COL4_LABEL = Math.round(TABLE_W * 0.22); // label columns
        const COL4_VALUE = Math.round(TABLE_W * 0.28); // value columns
        const defaultRows = [];

        // First rows: Unit# / Equipment# / Serial# / Project
        defaultRows.push(new TableRow({ children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Unit #', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData.unit_number || report.unit_number || '', size: 18, font: 'Arial' })] })], width: { size: COL4_VALUE, type: WidthType.DXA }, borders: thinBorders }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Equipment #', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData.equipment_number || report.equipment_number || '', size: 18, font: 'Arial' })] })], width: { size: COL4_VALUE, type: WidthType.DXA }, borders: thinBorders }),
        ]}));
        defaultRows.push(new TableRow({ children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Serial #', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData.nb_serial_number || report.nb_serial_number || '', size: 18, font: 'Arial' })] })], width: { size: COL4_VALUE, type: WidthType.DXA }, borders: thinBorders }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Project', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData.project_name || report.project_name || '', size: 18, font: 'Arial' })] })], width: { size: COL4_VALUE, type: WidthType.DXA }, borders: thinBorders }),
        ]}));

        // Config-specific header fields
        config.headerFields.forEach(([label, key, label2, key2]) => {
            if (label2) {
                defaultRows.push(new TableRow({ children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData[key] || '', size: 18, font: 'Arial' })] })], width: { size: COL4_VALUE, type: WidthType.DXA }, borders: thinBorders }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label2, bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData[key2] || '', size: 18, font: 'Arial' })] })], width: { size: COL4_VALUE, type: WidthType.DXA }, borders: thinBorders }),
                ]}));
            } else {
                defaultRows.push(new TableRow({ children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: headerData[key] || '', size: 18, font: 'Arial' })] })], width: { size: COL4_LABEL + COL4_VALUE * 2, type: WidthType.DXA }, borders: thinBorders, columnSpan: 3 }),
                ]}));
            }
        });

        children.push(new Table({
            rows: defaultRows,
            width: { size: TABLE_W, type: WidthType.DXA },
            columnWidths: [COL4_LABEL, COL4_VALUE, COL4_LABEL, COL4_VALUE],
            layout: TableLayoutType.FIXED,
        }));
    }
    children.push(new Paragraph({ spacing: { after: 100 } }));

    // ── Inspection Type / Inspector Info ──────────────────────────────────
    if (isExt) {
        const inspData = (sections.ext510_inspector || {}).section_data || {};
        children.push(sectionHeading('INSPECTOR INFORMATION'));
        const COL4_IL = Math.round(TABLE_W * 0.22);
        const COL4_IV = Math.round(TABLE_W * 0.28);
        const inspRows = [
            new TableRow({ children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'INSPECTOR NAME', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_IL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: inspData.ext510_inspector_name || '', size: 18, font: 'Arial' })] })], width: { size: COL4_IV, type: WidthType.DXA }, borders: thinBorders }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'API #', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_IL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: inspData.ext510_api_number || inspData.ext510_inspector_api_cert || '', size: 18, font: 'Arial' })] })], width: { size: COL4_IV, type: WidthType.DXA }, borders: thinBorders }),
            ]}),
            new TableRow({ children: [
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'INSPECTOR SIGNATURE', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_IL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: inspData.ext510_inspector_signature || '', size: 18, font: 'Arial' })] })], width: { size: COL4_IV, type: WidthType.DXA }, borders: thinBorders }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'DATE', bold: true, size: 18, font: 'Arial' })] })], width: { size: COL4_IL, type: WidthType.DXA }, borders: thinBorders, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY } }),
                new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: inspData.ext510_inspector_date || '', size: 18, font: 'Arial' })] })], width: { size: COL4_IV, type: WidthType.DXA }, borders: thinBorders }),
            ]}),
        ];
        children.push(new Table({
            rows: inspRows,
            width: { size: TABLE_W, type: WidthType.DXA },
            columnWidths: [COL4_IL, COL4_IV, COL4_IL, COL4_IV],
            layout: TableLayoutType.FIXED,
        }));
        children.push(new Paragraph({ spacing: { after: 100 } }));
    } else {
        const inspTypeData = (sections.inspection_type || {}).section_data || {};
        const inspectors = inspTypeData.inspectors || [];
        if (inspectors.length > 0) {
            children.push(sectionHeading('INSPECTION TYPE'));
            const checks = [];
            if (inspTypeData.internal_inspection) checks.push('Internal Inspection');
            if (inspTypeData.external_inspection_check) checks.push('External Inspection');
            if (checks.length) {
                children.push(new Paragraph({
                    children: [new TextRun({ text: checks.join(', '), size: 20, font: 'Arial' })],
                    spacing: { before: 50, after: 50 },
                }));
            }
            const inspHeaderRow = new TableRow({
                children: ['Inspector Name', 'API Cert #', 'Date'].map(h =>
                    new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, color: WHITE, font: 'Arial' })], alignment: AlignmentType.CENTER })],
                        shading: { type: ShadingType.CLEAR, fill: NAVY },
                        borders: thinBorders,
                    })
                ),
            });
            const inspDataRows = inspectors.map(insp => new TableRow({
                children: [insp.name || '', insp.api_cert || '', insp.date || ''].map(v =>
                    new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: v, size: 18, font: 'Arial' })] })],
                        borders: thinBorders,
                    })
                ),
            }));
            children.push(new Table({
                rows: [inspHeaderRow, ...inspDataRows],
                width: { size: 100, type: WidthType.PERCENTAGE },
                layout: TableLayoutType.FIXED,
            }));
            children.push(new Paragraph({ spacing: { after: 100 } }));
        }
    }

    // ── Orientation / Data Plate Photos ──────────────────────────────────
    const orientData = (sections.orientation_photos || {}).section_data || {};
    const orientBuf = base64ToBuffer(orientData.orientation_photo);
    const dataPlateBuf = base64ToBuffer(orientData.dataplate_photo);
    if (orientBuf || dataPlateBuf) {
        children.push(sectionHeading('ORIENTATION / DATA PLATE'));
        const photoCells = [];
        if (orientBuf) {
            photoCells.push(new TableCell({
                children: [
                    new Paragraph({ children: [new TextRun({ text: 'ORIENTATION', bold: true, size: 18, font: 'Arial' })], alignment: AlignmentType.CENTER }),
                    new Paragraph({ children: [new ImageRun({ data: orientBuf, transformation: { width: 250, height: 200 } })], alignment: AlignmentType.CENTER }),
                ],
                width: { size: 50, type: WidthType.PERCENTAGE },
                borders: thinBorders,
            }));
        }
        if (dataPlateBuf) {
            photoCells.push(new TableCell({
                children: [
                    new Paragraph({ children: [new TextRun({ text: 'DATA PLATE', bold: true, size: 18, font: 'Arial' })], alignment: AlignmentType.CENTER }),
                    new Paragraph({ children: [new ImageRun({ data: dataPlateBuf, transformation: { width: 250, height: 200 } })], alignment: AlignmentType.CENTER }),
                ],
                width: { size: 50, type: WidthType.PERCENTAGE },
                borders: thinBorders,
            }));
        }
        if (photoCells.length) {
            children.push(new Table({
                rows: [new TableRow({ children: photoCells })],
                width: { size: 100, type: WidthType.PERCENTAGE },
                layout: TableLayoutType.FIXED,
            }));
        }
        children.push(new Paragraph({ spacing: { after: 100 } }));
    }

    // ── Narrative Sections ───────────────────────────────────────────────
    for (const ns of config.narrativeSections) {
        const secData = (sections[ns.key] || {}).section_data || {};
        const content = stripHtml(secData.content);
        children.push(sectionHeading(ns.title));
        if (content) {
            const lines = content.split('\n');
            lines.forEach(line => {
                children.push(new Paragraph({
                    children: [new TextRun({ text: line, size: 20, font: 'Arial' })],
                    spacing: { before: 40, after: 40 },
                }));
            });
        } else {
            children.push(new Paragraph({
                children: [new TextRun({ text: '(No content)', size: 18, italics: true, color: '999999', font: 'Arial' })],
                spacing: { before: 40, after: 40 },
            }));
        }
    }

    // ── Checklist (ext510 / ext570 only) ─────────────────────────────────
    if (config.checklistCategories) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        children.push(sectionHeading('CHECKLIST'));

        const checklistData = (sections.checklist || {}).section_data || {};
        const items = checklistData.items || {};

        for (const cat of config.checklistCategories) {
            // Category header
            children.push(new Paragraph({
                children: [new TextRun({ text: cat.title, bold: true, size: 20, color: NAVY, font: 'Arial' })],
                shading: { type: ShadingType.CLEAR, fill: 'EEEEEE' },
                spacing: { before: 100, after: 50 },
            }));

            // Table header
            const headerRow = new TableRow({
                children: ['#', 'Item', 'Yes', 'No', 'N/A', 'Location', 'Comments'].map((h, i) =>
                    new TableCell({
                        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16, color: WHITE, font: 'Arial' })], alignment: AlignmentType.CENTER })],
                        shading: { type: ShadingType.CLEAR, fill: '222222' },
                        borders: thinBorders,
                        width: { size: i === 1 ? 30 : (i === 6 ? 20 : i === 5 ? 12 : 6), type: WidthType.PERCENTAGE },
                    })
                ),
            });

            const dataRows = cat.items.map(item => {
                const key = `item_${item.num}`;
                const itemData = items[key] || {};
                const checked = itemData.checked;
                let yes = '', no = '', na = '';
                if (checked === true || checked === 'yes') yes = '\u2612';
                else if (checked === false || checked === 'no') no = '\u2612';
                else if (checked === 'na') na = '\u2612';
                else { yes = '\u2610'; no = '\u2610'; na = '\u2610'; }

                return new TableRow({
                    children: [
                        String(item.num), item.label, yes || '\u2610', no || '\u2610', na || '\u2610',
                        itemData.location || '', itemData.comment || ''
                    ].map((v, i) =>
                        new TableCell({
                            children: [new Paragraph({ children: [new TextRun({ text: v, size: 16, font: 'Arial' })], alignment: i >= 2 && i <= 4 ? AlignmentType.CENTER : AlignmentType.LEFT })],
                            borders: thinBorders,
                        })
                    ),
                });
            });

            children.push(new Table({
                rows: [headerRow, ...dataRows],
                width: { size: 100, type: WidthType.PERCENTAGE },
                layout: TableLayoutType.FIXED,
            }));
        }
        children.push(new Paragraph({ spacing: { after: 100 } }));
    }

    // ── Inspection Photos ────────────────────────────────────────────────
    const photos = report.photos || [];
    if (photos.length > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
        children.push(sectionHeading('INSPECTION PHOTOS'));

        for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            const buf = base64ToBuffer(photo.data_url);
            if (buf) {
                children.push(new Paragraph({
                    children: [new ImageRun({ data: buf, transformation: { width: 350, height: 260 } })],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 80, after: 20 },
                }));
                children.push(new Paragraph({
                    children: [new TextRun({ text: photo.caption || `Photo ${i + 1}`, size: 18, italics: true, font: 'Arial' })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 80 },
                }));
            }
        }
    }

    // ── Build Document ───────────────────────────────────────────────────
    const eqNum = headerData.equipment_number || report.equipment_number || 'Report';
    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    size: { width: 12240, height: 15840 }, // Letter
                    margin: { top: 720, bottom: 720, left: 720, right: 720 },
                },
            },
            headers: {
                default: new Header({
                    children: [new Paragraph({
                        children: [new TextRun({ text: `${eqNum} - ${config.title}`, size: 16, color: '888888', font: 'Arial' })],
                        alignment: AlignmentType.CENTER,
                    })],
                }),
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        children: [
                            new TextRun({ text: 'Page ', size: 16, font: 'Arial' }),
                            new TextRun({ children: [PageNumber.CURRENT], size: 16, font: 'Arial' }),
                            new TextRun({ text: ' / ', size: 16, font: 'Arial' }),
                            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: 'Arial' }),
                        ],
                        alignment: AlignmentType.RIGHT,
                    })],
                }),
            },
            children,
        }],
    });

    return Packer.toBuffer(doc);
}

module.exports = { generateDocx, reportTypeConfigs };
