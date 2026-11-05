(() => {
  const editor = document.getElementById('editor');
  const marginGuides = document.getElementById('margin-guides');
  const nameInput = document.getElementById('document-name');
  const saveStatus = document.getElementById('save-status');
  const STORAGE_KEY = 'urdu-writer-document-v1';
  const DOCUMENTS_KEY = 'urdu-writer-documents-v1';
  const RECOVERY_KEY_PREFIX = 'urdu-writer-recovery-v1-';
  let activeDocumentId = '';
  let alignmentGuides = [];
  let documentHistoryManager = null;
  let historyCheckpointTimer = 0;
  let pendingHistoryAction = '';
  let pendingHistoryGroupKey = null;
  let pendingHistoryActionExpiresAt = 0;
  let activePointerHistoryAction = null;
  let isRestoringHistory = false;
  let saveTimer;
  let recoveryTimer = 0;
  let paginationFrame = 0;
  let zoom = 100;
  let urduTyping = true;
  let landscape = false;
  let pageSize = 'A4';
  let customPageDimensions = null;
  let pageMargins = [1, 1, 1, 1];
  let pageBorderStyle = 'none';
  let pageBorderColor = '#697586';
  let pageColor = '#ffffff';
  let toastTimer;
  let savedEditorRange = null;
  let lastFormattedSpan = null;
  let protectSelectedRange = false;
  let protectRangeTimer;
  let applyingFontSize = false;
  const fontFamilies = [
    "'Noto Nastaliq Urdu', serif", "'Gulzar', serif", "'Noto Naskh Arabic', serif",
    "'Lateef', serif", "'Amiri', serif", "'Markazi Text', serif", "'Scheherazade New', serif",
    "'Harmattan', sans-serif", "'Noto Sans Arabic', sans-serif", "'Noto Kufi Arabic', sans-serif",
    "'Reem Kufi', sans-serif", "'Mada', sans-serif", "'Tajawal', sans-serif", "'Cairo', sans-serif",
    "'IBM Plex Sans Arabic', sans-serif", "'Changa', sans-serif", "'Lemonada', cursive",
    "'El Messiri', sans-serif", "'Mirza', serif", "'Aref Ruqaa', serif",
    "'Alexandria', sans-serif", "'Almarai', sans-serif", "'Noto Serif Arabic', serif",
    "'Rakkas', serif", "'Readex Pro', sans-serif", "'Rubik', sans-serif"
  ];
  const fontNames = [
    'Noto Nastaliq Urdu', 'Gulzar', 'Noto Naskh Arabic', 'Lateef', 'Amiri',
    'Markazi Text', 'Scheherazade New', 'Harmattan', 'Noto Sans Arabic',
    'Noto Kufi Arabic', 'Reem Kufi', 'Mada', 'Tajawal', 'Cairo',
    'IBM Plex Sans Arabic', 'Changa', 'Lemonada', 'El Messiri', 'Mirza', 'Aref Ruqaa',
    'Alexandria', 'Almarai', 'Noto Serif Arabic', 'Rakkas', 'Readex Pro', 'Rubik'
  ];
  const polygonShapeTypes = new Set([
    'triangle', 'right-triangle', 'diamond', 'pentagon', 'hexagon', 'octagon',
    'parallelogram', 'trapezoid', 'star', 'arrow', 'chevron', 'plus', 'heart',
    'double-arrow', 'left-right-arrow', 'left-arrow', 'up-arrow', 'down-arrow', 'pentagon-arrow',
    'minus', 'multiply', 'divide', 'equal', 'not-equal', 'flow-decision', 'flow-data',
    'star-4', 'star-8', 'star-16', 'star-24', 'star-32', 'snip-corner-rectangle',
    'curved-arrow', 'u-turn-arrow', 'elbow-connector', 'pie', 'rectangular-callout',
    'rounded-rectangle-callout', 'oval-callout', 'cloud-callout', 'sun',
    'lightning-bolt', 'flow-document', 'flow-preparation', 'flow-delay', 'ribbon',
    'wave-banner',
    ...window.WordShapesEngine.categories.flatMap(({ shapes }) =>
      shapes.filter(({ geometry }) => geometry === 'polygon').map(({ type }) => type))
  ]);
  const allowedTags = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'DIV', 'EM', 'FONT', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'S', 'SPAN', 'STRIKE',
    'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL',
    'COL', 'COLGROUP'
  ]);

  function sanitizeDocumentHtml(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const cleanNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (!(node instanceof HTMLElement)) return document.createDocumentFragment();
      const clean = document.createElement(node.tagName.toLowerCase());
      if (!allowedTags.has(node.tagName)) {
        const fragment = document.createDocumentFragment();
        if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(node.tagName)) {
          Array.from(node.childNodes).forEach((child) => fragment.append(cleanNode(child)));
        }
        if (clean.tagName === 'DIV' && clean.dataset.editorShape === 'true' && clean.dataset.shapeFill) {
          clean.style.backgroundColor = clean.dataset.shapeFill;
        }
        return fragment;
      }
      const documentRegion = node.tagName === 'DIV' && ['header', 'footer'].includes(node.dataset.documentRegion)
        ? node.dataset.documentRegion
        : '';
      const isPageNumberField = node.tagName === 'SPAN' && ['number', 'total'].includes(node.dataset.pageNumberField);
      Array.from(node.attributes).forEach(({ name, value }) => {
        if (name === 'dir' && ['ltr', 'rtl', 'auto'].includes(value.toLowerCase())) {
          clean.setAttribute('dir', value.toLowerCase());
        } else if (name === 'lang' && ['en', 'ur'].includes(value.toLowerCase())) {
          clean.setAttribute('lang', value.toLowerCase());
        } else if (name === 'class' && node.tagName === 'DIV' &&
          value.split(/\s+/).some((className) => ['page-break', 'column-break', 'editor-shape'].includes(className))) {
          clean.className = value.split(/\s+/).find((className) => ['page-break', 'column-break', 'editor-shape'].includes(className));
          if (node.dataset.editorTextbox === 'true') clean.classList.add('editor-textbox');
          clean.setAttribute('contenteditable', node.dataset.editorTextbox === 'true' ? 'true' : 'false');
        } else if (name === 'data-editor-shape' && node.tagName === 'DIV' && value === 'true') {
          clean.dataset.editorShape = 'true';
        } else if (name === 'data-editor-textbox' && node.tagName === 'DIV' && value === 'true') {
          clean.dataset.editorTextbox = 'true';
          clean.tabIndex = 0;
        } else if (name === 'data-textbox-manual-width' && node.tagName === 'DIV' &&
          node.dataset.editorTextbox === 'true' && value === 'true') {
          clean.dataset.textboxManualWidth = 'true';
        } else if (name === 'data-shape-label' && node.tagName === 'SPAN' && value === 'true') {
          clean.dataset.shapeLabel = 'true';
        } else if (name === 'data-shape-text-style' && node.tagName === 'SPAN' && ['accent', 'shadow'].includes(value)) {
          clean.dataset.shapeTextStyle = value;
        } else if (name === 'data-shape-text-color' && node.tagName === 'SPAN' && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.shapeTextColor = value;
        } else if (name === 'data-shape-geometry' && node.tagName === 'DIV' && ['basic', 'polygon'].includes(value)) {
          clean.dataset.shapeGeometry = value;
        } else if (name === 'data-shape-type' && node.tagName === 'DIV' &&
          /^[a-z][a-z0-9-]{0,30}$/.test(value)) {
          clean.dataset.shapeType = value;
        } else if (name === 'data-shape-fill' && node.tagName === 'DIV' && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.shapeFill = value;
        } else if (name === 'data-shape-line' && node.tagName === 'DIV' && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.shapeLine = value;
        } else if (name === 'data-shape-line-width' && node.tagName === 'DIV' &&
          Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100) {
          clean.dataset.shapeLineWidth = value;
        } else if (name === 'data-shape-opacity' && node.tagName === 'DIV' && /^(?:10|[1-9]\d|100)$/.test(value)) {
          clean.dataset.shapeOpacity = value;
        } else if (name === 'data-shape-text-align' && node.tagName === 'DIV' &&
          ['left', 'center', 'right', 'justify'].includes(value)) {
          clean.dataset.shapeTextAlign = value;
        } else if (name === 'data-shape-text-vertical' && node.tagName === 'DIV' &&
          ['top', 'middle', 'bottom'].includes(value)) {
          clean.dataset.shapeTextVertical = value;
        } else if (name === 'data-shape-text-direction' && node.tagName === 'DIV' &&
          ['auto', 'rtl', 'ltr'].includes(value)) {
          clean.dataset.shapeTextDirection = value;
        } else if (name === 'data-shape-shadow' && node.tagName === 'DIV' && ['true', 'false'].includes(value)) {
          clean.dataset.shapeShadow = value;
        } else if (name === 'data-shape-rotation' && node.tagName === 'DIV' && /^(?:0|[1-9]\d?|[12]\d\d|3[0-5]\d)$/.test(value)) {
          clean.dataset.shapeRotation = value;
        } else if (name === 'class' && node.tagName === 'DIV' && documentRegion &&
          value.split(/\s+/).includes(`document-${documentRegion}`)) {
          clean.className = `document-${documentRegion}`;
        } else if (name === 'data-document-region' && node.tagName === 'DIV' && value === documentRegion) {
          clean.dataset.documentRegion = value;
        } else if (name === 'data-template' && node.tagName === 'DIV' && documentRegion &&
          ['blank', 'three-columns', 'austin', 'banded'].includes(value)) {
          clean.dataset.template = value;
        } else if (name === 'data-document-alignment' && node.tagName === 'DIV' && documentRegion &&
          ['left', 'center', 'right'].includes(value)) {
          clean.dataset.documentAlignment = value;
        } else if (name === 'data-header-alignment' && node.tagName === 'DIV' &&
          documentRegion === 'header' && ['left', 'center', 'right'].includes(value)) {
          clean.dataset.headerAlignment = value;
        } else if (name === 'data-empty' && node.tagName === 'DIV' && documentRegion && ['true', 'false'].includes(value)) {
          clean.dataset.empty = value;
        } else if (name === 'data-page-number-location' && node.tagName === 'DIV' && documentRegion &&
          ['header-left', 'header-center', 'header-right', 'footer-left', 'footer-center', 'footer-right'].includes(value)) {
          clean.dataset.pageNumberLocation = value;
        } else if (name === 'data-page-number-style' && node.tagName === 'DIV' && documentRegion &&
          ['decimal', 'upper-roman', 'lower-roman', 'upper-alpha', 'lower-alpha'].includes(value)) {
          clean.dataset.pageNumberStyle = value;
        } else if (name === 'data-page-number-field' && isPageNumberField) {
          clean.dataset.pageNumberField = value;
        } else if (name === 'data-page-number-set' && node.tagName === 'SPAN' && value === 'true') {
          clean.dataset.pageNumberSet = 'true';
        } else if (name === 'data-auto-page-break' && node.tagName === 'DIV' &&
          node.classList.contains('page-break') && value === 'true') {
          clean.dataset.autoPageBreak = 'true';
        } else if (name === 'data-watermark' && ['DIV', 'IMG'].includes(node.tagName) &&
          (node.tagName === 'DIV' && value === 'text' || node.tagName === 'IMG' && value === 'image')) {
          clean.dataset.watermark = value;
        } else if (name === 'data-watermark-opacity' && ['DIV', 'IMG'].includes(node.tagName) &&
          /^(?:0?\.\d{1,2}|1(?:\.0{1,2})?)$/.test(value) &&
          Number(value) >= 0.05 && Number(value) <= 1) {
          clean.dataset.watermarkOpacity = value;
        } else if (name === 'data-watermark-rotation' && ['DIV', 'IMG'].includes(node.tagName) &&
          /^(?:0|[1-9]\d?|[12]\d\d|3[0-5]\d)$/.test(value)) {
          clean.dataset.watermarkRotation = value;
        } else if (name === 'data-watermark-locked' && ['DIV', 'IMG'].includes(node.tagName) && value === 'true') {
          clean.dataset.watermarkLocked = 'true';
        } else if (name === 'data-watermark-centered' &&
          ['DIV', 'IMG'].includes(node.tagName) && value === 'true') {
          clean.dataset.watermarkCentered = 'true';
        } else if (name === 'contenteditable' && value === 'false' &&
          (node.classList.contains('page-break') || node.classList.contains('column-break') || node.classList.contains('editor-shape') ||
            isPageNumberField || documentRegion ||
            ['text', 'image'].includes(node.dataset.watermark))) {
          clean.setAttribute(name, 'false');
        } else if (['colspan', 'rowspan'].includes(name) && ['TD', 'TH'].includes(node.tagName)) {
          const span = Number.parseInt(value, 10);
          if (Number.isInteger(span) && span >= 1 && span <= 20) clean.setAttribute(name, String(span));
        } else if (name === 'size' && node.tagName === 'FONT' && /^[1-7]$/.test(value)) {
          clean.setAttribute('size', value);
        } else if (name === 'face' && node.tagName === 'FONT' &&
          [...fontFamilies, ...fontFamilies.map((family) => family.split(',')[0].replaceAll("'", ''))].includes(value)) {
          clean.setAttribute('face', value);
        } else if (name === 'href' && node.tagName === 'A') {
          try {
            const url = new URL(value, window.location.href);
            if (['http:', 'https:', 'mailto:'].includes(url.protocol)) clean.setAttribute('href', url.href);
          } catch (error) {
            console.warn('Ignored an invalid link in imported document content.', error);
          }
        } else if (name === 'src' && node.tagName === 'IMG' && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(value)) {
          clean.setAttribute('src', value);
        } else if (name === 'alt' && node.tagName === 'IMG') {
          clean.setAttribute('alt', value.slice(0, 200));
        } else if (name === 'width' && node.tagName === 'IMG') {
          const width = Number.parseInt(value, 10);
          if (Number.isInteger(width) && width >= 1 && width <= 10000) clean.setAttribute('width', String(width));
        } else if (name === 'width' && node.tagName === 'TABLE' && /^(?:[1-9]\d?|100)%$/.test(value)) {
          clean.setAttribute('width', value);
        } else if (name === 'data-image-wrap' && node.tagName === 'IMG' &&
          ['inline', 'square', 'top-bottom', 'behind', 'front', 'free'].includes(value)) {
          clean.dataset.imageWrap = value;
        } else if (name === 'data-image-align' && node.tagName === 'IMG' &&
          ['left', 'center', 'right'].includes(value)) {
          clean.dataset.imageAlign = value;
        } else if (name === 'data-image-crop' && node.tagName === 'IMG' &&
          /^(?:\d{1,2}),\s*(?:\d{1,2}),\s*(?:\d{1,2}),\s*(?:\d{1,2})$/.test(value)) {
          const insets = value.split(',').map(Number);
          if (insets.every((inset) => inset <= 45) && insets[0] + insets[2] < 90 &&
            insets[1] + insets[3] < 90) {
            clean.dataset.imageCrop = insets.join(',');
          }
        } else if (name === 'data-image-rotation' && node.tagName === 'IMG' &&
          /^(?:0|[1-9]\d?|[12]\d\d|3[0-5]\d)$/.test(value)) {
          clean.dataset.imageRotation = value;
        } else if (name === 'data-image-border-color' && node.tagName === 'IMG' && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.imageBorderColor = value;
        } else if (name === 'data-image-border-width' && node.tagName === 'IMG' &&
          Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100) {
          clean.dataset.imageBorderWidth = value;
        } else if (name === 'data-image-radius' && node.tagName === 'IMG' && /^(?:[0-9]|[1-4]\d|50)$/.test(value)) {
          clean.dataset.imageRadius = value;
        } else if (name === 'data-image-opacity' && node.tagName === 'IMG' &&
          /^(?:0|1|0?\.\d{1,2}|1(?:\.0{1,2})?)$/.test(value) && Number(value) >= 0 && Number(value) <= 1) {
          clean.dataset.imageOpacity = value;
        } else if (name === 'data-editor-shape' && node.tagName === 'IMG' && value === 'true') {
          clean.dataset.editorShape = 'true';
        } else if (name === 'data-shape-type' && node.tagName === 'IMG' &&
          /^[a-z][a-z0-9-]{0,30}$/.test(value)) {
          clean.dataset.shapeType = value;
        } else if (name === 'data-shape-fill' && node.tagName === 'IMG' && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.shapeFill = value;
        } else if (name === 'data-borders' && node.tagName === 'TABLE' &&
          ['all', 'outside', 'inside', 'horizontal', 'vertical', 'none'].includes(value)) {
          clean.dataset.borders = value;
        } else if (name === 'data-border-width' && node.tagName === 'TABLE' && /^(?:[0-8])$/.test(value)) {
          clean.dataset.borderWidth = value;
        } else if (name === 'data-border-color' && node.tagName === 'TABLE' && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.borderColor = value;
        } else if (name === 'data-table-style' && node.tagName === 'TABLE' &&
          ['grid', 'light', 'banded', 'medium', 'dark', 'accent', 'plain'].includes(value)) {
          clean.dataset.tableStyle = value;
        } else if (name === 'data-canvas-table' && node.tagName === 'TABLE' && value === 'true') {
          clean.dataset.canvasTable = 'true';
        } else if (name === 'data-cell-border-color' && ['TD', 'TH'].includes(node.tagName) && /^#[\da-f]{6}$/i.test(value)) {
          clean.dataset.cellBorderColor = value;
        } else if (name === 'data-cell-border-width' && ['TD', 'TH'].includes(node.tagName) && /^(?:[0-8])$/.test(value)) {
          clean.dataset.cellBorderWidth = value;
        } else if (name === 'data-table-align' && node.tagName === 'TABLE' && ['left', 'center', 'right'].includes(value)) {
          clean.dataset.tableAlign = value;
        } else if (name === 'data-table-autofit' && node.tagName === 'TABLE' && ['fixed', 'window', 'contents'].includes(value)) {
          clean.dataset.tableAutofit = value;
        } else if (name === 'data-table-position' && node.tagName === 'TABLE' && value === 'free') {
          clean.dataset.tablePosition = value;
        } else if (name === 'data-repeat-header' && node.tagName === 'TABLE' && value === 'true') {
          clean.dataset.repeatHeader = 'true';
        } else if (name === 'data-layer' && /^-10$|^-?[0-9]$|^10$/.test(value)) {
          clean.dataset.layer = value;
        } else if (name === 'style') {
          const styles = [];
          for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-style', 'text-decoration-color', 'text-align', 'vertical-align', 'direction', 'list-style-type', 'line-height', 'margin-top', 'margin-bottom', 'text-indent', 'padding-inline-start', 'padding', 'color', 'background-color', 'border-color', 'border-width', 'position', 'width', 'height', 'left', 'top', 'opacity', 'z-index', 'table-layout']) {
            const styleValue = node.style.getPropertyValue(property).trim();
            if (!styleValue) continue;
            if (property === 'font-family' && fontFamilies.includes(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'font-size' && /^(?:\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%))$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (            property === 'width' && (node.tagName === 'TABLE' || node.tagName === 'DIV' && node.dataset.editorShape === 'true') &&
              (/^(?:auto|(?:[1-9]\d?|100)%)$/.test(styleValue) ||
                /^\d+(?:\.\d{1,4})?px$/.test(styleValue) && Number.parseFloat(styleValue) <= 10000)) {
              styles.push(`${property}:${styleValue}`);
            }
            if (property === 'width' && node.tagName === 'COL' &&
              /^(?:\d{1,3}(?:\.\d{1,6})?%)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'position' && node.tagName === 'DIV' && node.dataset.editorShape === 'true' &&
              styleValue === 'absolute') styles.push(`${property}:${styleValue}`);
            if (['left', 'top'].includes(property) &&
              (node.tagName === 'TABLE' && node.dataset.tablePosition === 'free' ||
                node.tagName === 'IMG' && (node.dataset.imageWrap === 'free' ||
                  node.dataset.watermark === 'image') ||
                node.tagName === 'DIV' && (node.dataset.watermark === 'text' ||
                  node.dataset.editorShape === 'true')) &&
              (/^\d+(?:\.\d{1,4})?px$/.test(styleValue) &&
                Number.parseFloat(styleValue) <= 10000 ||
                property === 'left' && ['text', 'image'].includes(node.dataset.watermark) &&
                  styleValue === '50%')) {
              styles.push(`${property}:${styleValue}`);
              if (property === 'left' && styleValue === '50%' &&
                ['text', 'image'].includes(node.dataset.watermark)) {
                clean.dataset.watermarkCentered = 'true';
              }
            }
            if (property === 'border-color' && node.tagName === 'DIV' && node.dataset.editorShape === 'true' &&
              /^#[\da-f]{6}$/i.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'border-width' && node.tagName === 'DIV' && node.dataset.editorShape === 'true' &&
              /^(?:[0-9]|10)px$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'opacity' && node.tagName === 'DIV' && node.dataset.editorShape === 'true' &&
              /^(?:0?\.\d{1,2}|1(?:\.0{1,2})?)$/.test(styleValue) &&
              Number(styleValue) >= 0.1 && Number(styleValue) <= 1) styles.push(`${property}:${styleValue}`);
            if (property === 'opacity' && ['DIV', 'IMG'].includes(node.tagName) &&
              ['text', 'image'].includes(node.dataset.watermark) &&
              /^(?:0?\.\d{1,2}|1(?:\.0{1,2})?)$/.test(styleValue) &&
              Number(styleValue) >= 0.05 && Number(styleValue) <= 1) styles.push(`${property}:${styleValue}`);
            if (property === 'width' && ['TD', 'TH'].includes(node.tagName) && /^(?:\d{1,4}(?:\.\d{1,6})?px|\d{1,3}%)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'height' && ['TR', 'TD', 'TH'].includes(node.tagName) && /^(?:\d{1,4}(?:\.\d{1,6})?px)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'height' && node.tagName === 'DIV' && node.dataset.editorShape === 'true' &&
              /^\d{1,4}(?:\.\d{1,4})?px$/.test(styleValue) && Number.parseFloat(styleValue) <= 10000) {
              styles.push(`${property}:${styleValue}`);
            }
            if (property === 'z-index' && /^-10$|^-?[0-9]$|^10$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'table-layout' && node.tagName === 'TABLE' && ['auto', 'fixed'].includes(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'font-weight' && /^(?:normal|bold|[1-9]00)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'font-style' && /^(?:normal|italic|oblique)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'text-decoration' && /^(?:none|underline|line-through|overline)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'text-decoration-style' && /^(?:solid|double|dotted|dashed|wavy)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'text-decoration-color' && CSS.supports('color', styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'text-align' && /^(?:left|right|center|justify)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'vertical-align' && ['TD', 'TH'].includes(node.tagName) && /^(?:top|middle|bottom)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'padding' && ['TD', 'TH'].includes(node.tagName) && /^(?:\d{1,2}px)(?: \d{1,2}px){0,3}$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'direction' && /^(?:ltr|rtl)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'list-style-type' && /^(?:disc|circle|square|decimal|upper-roman|lower-roman|upper-alpha|lower-alpha|decimal-paren|upper-roman-paren|lower-roman-paren|upper-alpha-paren|lower-alpha-paren|decimal-bracket|upper-roman-bracket|lower-roman-bracket|upper-alpha-bracket|lower-alpha-bracket|"(?:•|○|▪|▫|★|➜|\\+|−|♦|♢|❖|➤|☻|☹|✓|✗|□)")$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'line-height' && /^(?:\d+(?:\.\d+)?|normal)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (['margin-top', 'margin-bottom', 'text-indent', 'padding-inline-start'].includes(property) && /^-?\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (['color', 'background-color'].includes(property) && CSS.supports('color', styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'background-color' && node.tagName === 'SPAN' && CSS.supports('color', styleValue)) {
              styles.push(`--text-highlight-color:${styleValue}`);
            }
          }
          if (styles.length) clean.setAttribute('style', styles.join(';'));
        }
      });
      if (clean.tagName === 'TABLE') {
        if (clean.dataset.tablePosition === 'free' &&
          (!clean.style.left || !clean.style.top)) {
          delete clean.dataset.tablePosition;
          clean.style.removeProperty('left');
          clean.style.removeProperty('top');
        }
        if (clean.dataset.borderWidth) clean.style.setProperty('--table-border-width', `${clean.dataset.borderWidth}px`);
        if (clean.dataset.borderColor) clean.style.setProperty('--table-border-color', clean.dataset.borderColor);
      }
      if (['DIV', 'IMG'].includes(clean.tagName) && clean.dataset.watermarkOpacity) {
        clean.style.opacity = clean.dataset.watermarkOpacity;
      }
      if (clean.tagName === 'DIV' && clean.dataset.editorShape === 'true') {
        const fill = clean.dataset.shapeFill || '#dce8f5';
        const line = clean.dataset.shapeLine || '#176b9a';
        const lineWidth = clean.dataset.shapeLineWidth ?? 2;
        const shapeDefinition = window.WordShapesEngine.get(clean.dataset.shapeType);
        clean.dataset.shapeGeometry = shapeDefinition?.geometry ||
          (polygonShapeTypes.has(clean.dataset.shapeType) ? 'polygon' : 'basic');
        if (shapeDefinition) window.WordShapesEngine.applyGeometry(clean, clean.dataset.shapeType);
        clean.style.backgroundColor = clean.dataset.shapeGeometry === 'polygon' || clean.dataset.shapeType === 'line'
          ? line
          : fill;
        clean.style.borderColor = line;
        clean.style.borderWidth = `${lineWidth}px`;
        clean.style.setProperty('--shape-line-color', clean.dataset.shapeLine || '#176b9a');
        clean.style.setProperty('--shape-fill-color', fill);
        clean.style.setProperty('--shape-border-width', `${lineWidth}px`);
        clean.style.opacity = String(Number(clean.dataset.shapeOpacity ?? 100) / 100);
        clean.setAttribute('dir', clean.dataset.shapeTextDirection || 'auto');
        const rotation = Number(clean.dataset.shapeRotation || 0);
        if (rotation) clean.style.rotate = `${rotation}deg`;
      }
      if (['DIV', 'IMG'].includes(clean.tagName) && clean.dataset.watermark) {
        clean.tabIndex = 0;
        clean.setAttribute('role', 'button');
        clean.setAttribute('aria-label',
          `${clean.dataset.watermark === 'image' ? 'Image' : 'Text'} watermark. Press Enter to open controls.`);
        const rotation = Number(clean.dataset.watermarkRotation) || 0;
        if (rotation) clean.style.rotate = `${rotation}deg`;
      }
      if (clean.tagName === 'IMG') {
        clean.setAttribute('contenteditable', 'false');
        const rotation = Number(clean.dataset.imageRotation || 0);
        if (rotation) clean.style.rotate = `${rotation}deg`;
        const borderWidth = Number(clean.dataset.imageBorderWidth || 0);
        if (borderWidth) {
          clean.style.border = `${borderWidth}px solid ${clean.dataset.imageBorderColor || '#176b9a'}`;
        }
        if (clean.dataset.imageRadius !== undefined) clean.style.borderRadius = `${clean.dataset.imageRadius}px`;
        if (clean.dataset.imageOpacity !== undefined) clean.style.opacity = clean.dataset.imageOpacity;
        if (clean.dataset.imageCrop) {
          const [top, right, bottom, left] = clean.dataset.imageCrop.split(',');
          clean.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
        }
      }
      if (['TD', 'TH'].includes(clean.tagName) && clean.dataset.cellBorderColor) {
        clean.style.borderColor = clean.dataset.cellBorderColor;
        clean.style.borderWidth = `${clean.dataset.cellBorderWidth || 1}px`;
        clean.style.borderStyle = clean.dataset.cellBorderWidth === '0' ? 'none' : 'solid';
      }
      Array.from(node.childNodes).forEach((child) => clean.append(cleanNode(child)));
      return clean;
    };
    const result = document.createDocumentFragment();
    Array.from(parsed.body.childNodes).forEach((child) => result.append(cleanNode(child)));
    const container = document.createElement('div');
    container.append(result);
    return container.innerHTML;
  }

  function setSaveStatus(message) {
    saveStatus.textContent = message;
  }

  function updateCounts(syncLayout = true) {
    if (syncLayout) syncPageBreakLayout();
    const text = editor.innerText.replace(/\u00a0/g, ' ').trim();
    const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
    const characters = Array.from(text).length;
    document.getElementById('word-count').textContent = `${words} words`;
    document.getElementById('character-count').textContent = `${characters} characters`;
    document.getElementById('mobile-page-number').textContent = document.getElementById('page-number').textContent;
    const pages = Math.max(1, editor.querySelectorAll('.page-break').length + 1);
    document.getElementById('page-total').textContent = String(pages);
    document.getElementById('mobile-page-total').textContent = String(pages);
    updatePageNumberFields(pages);
    syncPageNumberPrintLocation();
  }

  function syncDocumentHeaderSpacing() {
    const header = editor.querySelector('.document-header:not([data-page-number-location])');
    const headerButton = document.getElementById('header-insert-button');
    const footerButton = document.getElementById('footer-insert-button');
    const hasHeader = Boolean(editor.querySelector('.document-header'));
    const hasFooter = Boolean(editor.querySelector('.document-footer'));
    headerButton.setAttribute('aria-pressed', String(hasHeader));
    headerButton.title = 'Header templates';
    headerButton.querySelector('span').textContent = 'Header';
    footerButton.setAttribute('aria-pressed', String(hasFooter));
    footerButton.title = 'Footer templates';
    footerButton.querySelector('span').textContent = 'Footer';
    document.querySelector('#header-template-menu [data-document-region-action="remove"]').disabled = !hasHeader;
    document.querySelector('#footer-template-menu [data-document-region-action="remove"]').disabled = !hasFooter;
    const savedMarginTop = Number.parseFloat(editor.style.getPropertyValue('--document-margin-top'));
    const currentPaddingTop = rulerPixels(getComputedStyle(editor).paddingTop);
    editor.classList.toggle('has-document-header', Boolean(header));
    if (!header) {
      editor.style.removeProperty('--document-content-top');
      return;
    }
    const marginTop = Number.isFinite(savedMarginTop) ? savedMarginTop : currentPaddingTop;
    editor.style.setProperty('--document-margin-top', `${marginTop}px`);
    editor.style.setProperty('--document-content-top',
      `${Math.max(marginTop, documentHeaderContentMinimum(header))}px`);
  }

  function documentHeaderContentMinimum(header) {
    return rulerPixels(getComputedStyle(header).top) + (header.offsetHeight || 36) + 4;
  }

  function documentMargin(side) {
    const savedMargin = Number.parseFloat(editor.style.getPropertyValue(`--document-margin-${side}`));
    if (Number.isFinite(savedMargin)) return savedMargin;
    return rulerPixels(getComputedStyle(editor)[`padding${side[0].toUpperCase()}${side.slice(1)}`]);
  }

  function syncPageBreakLayout(changedBreak = null) {
    const allPageBreaks = Array.from(editor.querySelectorAll('.page-break'));
    const changedIndex = changedBreak ? allPageBreaks.indexOf(changedBreak) : 0;
    const pageBreaks = changedIndex > 0
      ? allPageBreaks.slice(changedIndex)
      : allPageBreaks;
    editor.dataset.multipage = String(pageBreaks.length > 0);
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
    const pageStride = pageHeight + pageGap;
    const pageTopMargin = rulerPixels(getComputedStyle(editor).paddingTop);
    const totalPageCount = allPageBreaks.length + 1;
    editor.style.minHeight = `${pageHeight * totalPageCount + pageGap * allPageBreaks.length}px`;
    pageBreaks.forEach((pageBreak) => {
      const pageOffset = ((pageBreak.offsetTop % pageStride) + pageStride) % pageStride;
      const spaceToNextPage = pageStride - pageOffset + pageTopMargin;
      pageBreak.style.setProperty('--page-break-space', `${spaceToNextPage}px`);
    });
    if (!changedBreak) syncAlignmentGuides();
  }

  function autoPageBreakCandidate(skippedNodes = new Set(), processedNodes = new Set()) {
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
    const pageStride = pageHeight + pageGap;
    const editorRect = editor.getBoundingClientRect();
    const scaleY = editorRect.height / Math.max(editor.offsetHeight, 1);
    const style = getComputedStyle(editor);
    const topMargin = rulerPixels(style.paddingTop);
    const bottomMargin = rulerPixels(style.paddingBottom);
    const contentHeight = pageHeight - topMargin - bottomMargin;
    for (const node of editor.children) {
      if (node.matches('.page-break, .document-header, .document-footer, .editor-shape, [data-watermark]') ||
        skippedNodes.has(node) || processedNodes.has(node) || getComputedStyle(node).position === 'absolute') {
        processedNodes.add(node);
        continue;
      }
      const bounds = node.getBoundingClientRect();
      if (!bounds.height) {
        processedNodes.add(node);
        continue;
      }
      const top = Math.max(0, (bounds.top - editorRect.top) / scaleY);
      const page = Math.floor(top / pageStride);
      const pageTop = page * pageStride;
      const bottom = (bounds.bottom - editorRect.top) / scaleY;
      const pageBottom = pageTop + pageHeight - bottomMargin;
      if (top < pageTop + topMargin - 1 || bottom > pageBottom + 1) {
        const splittableBlock = /^(P|H[1-6]|BLOCKQUOTE|DIV|LI|UL|OL)$/.test(node.tagName) &&
          !node.querySelector('table');
        const remainingContentHeight = pageBottom - top;
        const split = splittableBlock && remainingContentHeight > 0 &&
          node.offsetHeight > remainingContentHeight;
        if (node.offsetHeight > contentHeight && !split) {
          processedNodes.add(node);
          continue;
        }
        return {
          node,
          page,
          top,
          pageContentTop: pageTop + topMargin,
          pageBottom: editorRect.top + pageBottom * scaleY,
          contentHeight,
          split
        };
      }
      processedNodes.add(node);
    }
    return null;
  }

  function findParagraphSplitPoint(block, pageBottom) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return node.parentElement?.closest('[data-pagination-caret]')
          ? NodeFilter.FILTER_REJECT
          : node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR'
            ? NodeFilter.FILTER_SKIP
            : NodeFilter.FILTER_ACCEPT;
      }
    });
    let best = null;
    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      if (currentNode.nodeType === Node.ELEMENT_NODE) {
        const bounds = currentNode.getBoundingClientRect();
        if (bounds.height && bounds.bottom <= pageBottom + 1) {
          best = {
            node: currentNode.parentNode,
            offset: Array.prototype.indexOf.call(currentNode.parentNode.childNodes, currentNode) + 1
          };
          continue;
        }
        break;
      }
      const textNode = currentNode;
      if (!textNode.length) continue;
      const segments = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(textNode.data))
        : (() => {
          let offset = 0;
          return Array.from(textNode.data).map((segment) => {
            const result = { index: offset, segment };
            offset += segment.length;
            return result;
          });
        })();
      const offsets = segments.map(({ index, segment }) => index + segment.length);
      const range = document.createRange();
      const fits = (count) => {
        if (!count) return true;
        range.setStart(textNode, 0);
        range.setEnd(textNode, offsets[count - 1]);
        const rect = range.getBoundingClientRect();
        return rect.height > 0 && rect.bottom <= pageBottom + 1;
      };
      if (fits(offsets.length)) {
        best = { node: textNode, offset: textNode.length };
        continue;
      }
      let low = 0;
      let high = offsets.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fits(middle)) low = middle;
        else high = middle - 1;
      }
      if (low) {
        let offset = offsets[low - 1];
        const lastSpace = Math.max(textNode.data.lastIndexOf(' ', offset - 1),
          textNode.data.lastIndexOf('\n', offset - 1));
        if (lastSpace > 0 && offset - lastSpace < 80) offset = lastSpace + 1;
        best = { node: textNode, offset };
      }
      break;
    }
    if (!best || !best.offset) return null;
    const trailingRange = document.createRange();
    trailingRange.setStart(best.node, best.offset);
    trailingRange.setEnd(block, block.childNodes.length);
    const trailingContent = trailingRange.cloneContents();
    return trailingContent.textContent.trim() || trailingContent.querySelector('br') ? best : null;
  }

  function hasPaginationContent(block) {
    return Boolean(block.textContent.trim() || block.querySelector('br'));
  }

  function paginateEditor() {
    const hasAutomaticBreaks = editor.querySelector('.page-break[data-auto-page-break="true"]');
    if (!hasAutomaticBreaks && !autoPageBreakCandidate()) {
      syncPageBreakLayout();
      updateCounts(false);
      return;
    }
    const selection = window.getSelection();
    let caretMarker = null;
    if (selection?.isCollapsed && selection.rangeCount &&
      editor.contains(selection.anchorNode) && !selection.anchorNode.parentElement?.closest('[data-document-region]')) {
      caretMarker = document.createElement('span');
      caretMarker.dataset.paginationCaret = 'true';
      caretMarker.setAttribute('aria-hidden', 'true');
      caretMarker.style.cssText = 'display:inline-block;width:0;height:0;overflow:hidden';
      caretMarker.textContent = '\u200b';
      selection.getRangeAt(0).insertNode(caretMarker);
    }
    editor.querySelectorAll('.page-break[data-auto-page-break="true"]').forEach((pageBreak) => pageBreak.remove());
    syncPageBreakLayout();
    let changes = 0;
    const skippedNodes = new Set();
    const processedNodes = new Set();
    while (changes < 200) {
      const overflow = autoPageBreakCandidate(skippedNodes, processedNodes);
      if (!overflow) break;
      let continuation = null;
      if (overflow.split) {
        const point = findParagraphSplitPoint(overflow.node, overflow.pageBottom);
        if (point) {
          const suffix = document.createRange();
          suffix.setStart(point.node, point.offset);
          suffix.setEnd(overflow.node, overflow.node.childNodes.length);
          continuation = overflow.node.cloneNode(false);
          continuation.append(suffix.extractContents());
          processedNodes.add(overflow.node);
          if (!hasPaginationContent(continuation)) continuation.remove();
          else editor.insertBefore(continuation, overflow.node.nextSibling);
        } else {
          if (overflow.top <= overflow.pageContentTop + 1 &&
            overflow.node.offsetHeight > overflow.contentHeight) {
            skippedNodes.add(overflow.node);
            continue;
          }
          continuation = overflow.node;
        }
      }
      if (!continuation) continuation = overflow.node;
      const pageBreak = createPageBreak();
      pageBreak.dataset.autoPageBreak = 'true';
      editor.insertBefore(pageBreak, continuation);
      syncPageBreakLayout(pageBreak);
      changes += 1;
    }
    if (changes === 200 && autoPageBreakCandidate(skippedNodes)) {
      console.error('Automatic pagination stopped after reaching the 200-page safety limit.');
      showToast('This document is too long to paginate automatically.');
    }
    if (caretMarker?.isConnected) {
      const range = document.createRange();
      range.setStartBefore(caretMarker);
      range.collapse(true);
      caretMarker.remove();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    syncPageBreakLayout();
    updateCounts(false);
    syncRulers();
    scheduleSave('', null, false);
  }

  function queueAutoPagination() {
    window.clearTimeout(paginationFrame);
    paginationFrame = window.setTimeout(() => {
      paginationFrame = 0;
      window.requestAnimationFrame(() => {
        paginateEditor();
      });
    }, 300);
  }

  function syncVerticalRuler() {
    if (!verticalRuler) return;
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
    const pageScale = editor.getBoundingClientRect().height / editor.offsetHeight;
    const workspace = document.querySelector('.document-workspace');
    const visiblePageY = workspace.getBoundingClientRect().top + workspace.clientHeight / 2 -
      editor.getBoundingClientRect().top;
    const pageIndex = Math.max(0, Math.min(
      editor.querySelectorAll('.page-break').length,
      Math.floor(Math.max(0, visiblePageY / pageScale) / (pageHeight + pageGap))
    ));
    const renderedHeight = pageHeight * pageScale;
    const renderedScale = 96 * pageScale;
    verticalRuler.style.height = `${renderedHeight}px`;
    verticalRuler.style.setProperty('--ruler-unit', `${renderedScale}px`);
    verticalRuler.style.setProperty('--ruler-start', `${documentMargin('top') / pageHeight * 100}%`);
    verticalRuler.style.setProperty('--ruler-end', `${(pageHeight - documentMargin('bottom')) / pageHeight * 100}%`);
    verticalRuler.parentElement.style.top = `${pageIndex * (pageHeight + pageGap) * pageScale}px`;
    verticalRuler.parentElement.style.left = `${editor.getBoundingClientRect().width + 30}px`;
    const pageActions = document.querySelector('.page-actions');
    pageActions.style.left = `${editor.getBoundingClientRect().width + 5}px`;
    pageActions.style.top = `${pageIndex * (pageHeight + pageGap) * pageScale + 12}px`;
    document.getElementById('delete-page-button').disabled =
      editor.querySelectorAll('.page-break').length === 0;
    verticalRuler.querySelector('[data-ruler-handle="margin-top"]').style.top =
      `${Math.max(0, documentMargin('top') * pageScale - 5)}px`;
    verticalRuler.querySelector('[data-ruler-handle="margin-bottom"]').style.top =
      `${Math.max(0, renderedHeight - documentMargin('bottom') * pageScale - 5)}px`;
    if (verticalRuler.dataset.renderedHeight !== String(renderedHeight) ||
      verticalRuler.dataset.renderedScale !== String(renderedScale)) {
      updateRulerLabels(pageScale, renderedHeight, true);
      verticalRuler.dataset.renderedHeight = String(renderedHeight);
      verticalRuler.dataset.renderedScale = String(renderedScale);
    }
    verticalRuler.dataset.pageIndex = String(pageIndex);
  }

  function updatePageNumberFields(pageCount) {
    editor.querySelectorAll('[data-page-number-field="number"]').forEach((field) => {
      const page = Array.from(editor.querySelectorAll('.page-break')).filter((pageBreak) =>
        pageBreak.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).length + 1;
      const region = field.closest('[data-document-region]');
      const style = region?.dataset.pageNumberStyle || 'decimal';
      field.textContent = formatPageNumber(page, style);
      field.dataset.pageNumberStyle = style;
    });
    editor.querySelectorAll('[data-page-number-field="total"]').forEach((field) => {
      field.textContent = String(pageCount);
    });
  }

  function formatPageNumber(number, style) {
    if (style === 'decimal') return String(number);
    if (style === 'upper-alpha' || style === 'lower-alpha') {
      let value = number;
      let result = '';
      while (value > 0) {
        value -= 1;
        result = String.fromCharCode(65 + value % 26) + result;
        value = Math.floor(value / 26);
      }
      return style === 'lower-alpha' ? result.toLowerCase() : result;
    }
    const romanValues = [
      [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
    ];
    let value = Math.min(number, 3999);
    let result = '';
    romanValues.forEach(([amount, numeral]) => {
      while (value >= amount) {
        result += numeral;
        value -= amount;
      }
    });
    if (number > 3999) result += ` (${number})`;
    return style === 'lower-roman' ? result.toLowerCase() : result;
  }

  function syncPageNumberPrintLocation() {
    const pageNumberSets = editor.querySelectorAll('[data-page-number-set="true"]');
    pageNumberSets.forEach((pageNumberSet) => {
      const number = pageNumberSet.querySelector('[data-page-number-field="number"]');
      if (number) pageNumberSet.replaceChildren(number);
      pageNumberSet.contentEditable = 'false';
      pageNumberSet.style.userSelect = 'none';
      pageNumberSet.style.cursor = 'default';
    });
    const firstPageNumberSet = pageNumberSets[0];
    const containingRegion = firstPageNumberSet && firstPageNumberSet.closest('[data-document-region]');
    if (containingRegion && !containingRegion.dataset.pageNumberLocation) {
      const alignment = ['left', 'center', 'right'].includes(containingRegion.style.textAlign)
        ? containingRegion.style.textAlign
        : 'left';
      containingRegion.dataset.pageNumberLocation = `${containingRegion.dataset.documentRegion}-${alignment}`;
    }
    const region = editor.querySelector('[data-page-number-location]');
    if (region && !region.dataset.pageNumberStyle) region.dataset.pageNumberStyle = 'decimal';
    const location = region?.dataset.pageNumberLocation;
    const style = region?.dataset.pageNumberStyle || 'decimal';
    editor.style.page = location ? `page-number-${location}-${style}` : '';
  }

  const wordSuggestions = document.getElementById('word-suggestions');
  const urduDictionary = [
    'آپ', 'آج', 'آسان', 'آسمان', 'آواز', 'آنا', 'آگے', 'آخری', 'آزاد', 'آزادی',
    'اسلام', 'السلام', 'استاد', 'اسکول', 'اس لیے', 'اسے', 'اسکا', 'اسکی', 'اسکے',
    'امید', 'انسان', 'انداز', 'اندر', 'انگریزی', 'انہیں', 'اہم', 'اہمیت',
    'بات', 'بارش', 'بالکل', 'بہت', 'بہتر', 'بڑی', 'بچے', 'بچوں', 'بنا', 'بنائیں',
    'پانی', 'پاکستان', 'پیار', 'پہلے', 'پھر', 'پڑھنا', 'پڑھیں',
    'تعلیم', 'تجربہ', 'تک', 'تم', 'تمام', 'تو', 'تھا', 'تھی', 'تھے',
    'جانا', 'جائیں', 'جائے', 'جیسے', 'جو', 'چاہیے', 'چاہتا', 'چاہتی', 'چاہتے',
    'حالت', 'حقیقت', 'حکومت', 'خوبصورت', 'خوش', 'خیال', 'خیر',
    'درخواست', 'دن', 'دنیا', 'دوست', 'دوسرا', 'دیکھیں',
    'رہا', 'رہی', 'رہے', 'رکھیں', 'زندگی', 'زمین', 'زبان',
    'ساتھ', 'سچ', 'سلام', 'سلامت', 'سمجھ', 'سمجھیں', 'سنیں', 'سیکھیں',
    'شکریہ', 'شروع', 'شخص', 'شہر', 'شاید',
    'صحیح', 'ضروری', 'طریقہ', 'عادت', 'علاقہ', 'علم', 'عمل', 'علیکم',
    'فائدہ', 'فکر', 'فیصلہ',
    'قابل', 'قلم', 'قومی',
    'کام', 'کامیابی', 'کیا', 'کیوں', 'کیسے', 'کہاں', 'کب', 'کس', 'کسی', 'کچھ',
    'کرنا', 'کرتا', 'کرتی', 'کرتے', 'کریں', 'کرو', 'کرتے ہیں',
    'گھر', 'گفتگو', 'گیا', 'گئی', 'گئے',
    'لکھنا', 'لکھیں', 'لکھتا', 'لکھتی', 'لکھتے', 'لیکن', 'لوگ', 'لہذا',
    'ماں', 'ماحول', 'ماہر', 'مبارک', 'مبارکباد', 'مبنی', 'متاثر', 'متعلق',
    'مثال', 'مختلف', 'محفوظ', 'محنت', 'محبوب', 'محبت', 'محترم', 'محسوس',
    'محروم', 'محلہ', 'محمد', 'مدد', 'مددگار', 'مدرسہ', 'مدرسے', 'مدت',
    'مذہب', 'مذہبی', 'مرتب', 'مرحلہ', 'مرحلے', 'مرکز', 'مزید', 'مستقبل',
    'مستقل', 'مسئلہ', 'مسائل', 'مسجد', 'مسکرا', 'مشکل', 'مشورہ', 'مشہور',
    'مشین', 'مشرق', 'مشغول', 'مصروف', 'مضمون', 'معلومات', 'معلوم', 'معنی',
    'معاشرہ', 'معاشرے', 'معافی', 'معاہدہ', 'معاونت', 'مفید', 'مقصد', 'مقابلہ',
    'مختلف', 'مکمل', 'مکان', 'مکتب', 'مگر', 'ملازمت', 'ملنا', 'ملک',
    'ملی', 'مناسب', 'منظر', 'منصوبہ', 'منصوبے', 'منفرد', 'موقع', 'مواقع',
    'موجود', 'موجودہ', 'موسم', 'موسیقی', 'موت', 'مومن', 'میاں',
    'میرا', 'میری', 'میرے', 'میں',
    'نہیں', 'نیا', 'نئی', 'نئے', 'نام', 'نظم', 'نیچے',
    'وقت', 'والا', 'والی', 'والے', 'وجہ', 'وہ', 'وہاں',
    'یہ', 'یہاں', 'یہی', 'یاد', 'یقین'
  ];
  const uniqueUrduDictionary = [...new Set(urduDictionary)];
  let activeSuggestionIndex = 0;
  let suggestionRange = null;
  let suggestionPositionFrame = 0;

  function hideWordSuggestions() {
    window.cancelAnimationFrame(suggestionPositionFrame);
    suggestionPositionFrame = 0;
    wordSuggestions.hidden = true;
    wordSuggestions.replaceChildren();
    suggestionRange = null;
    editor.removeAttribute('aria-activedescendant');
  }

  function positionWordSuggestions(range) {
    const caret = range.getBoundingClientRect();
    const width = 220;
    const left = Math.max(8, Math.min(caret.left, window.innerWidth - width - 8));
    const top = caret.bottom + 6 + 240 > window.innerHeight
      ? Math.max(8, caret.top - 246)
      : Math.min(window.innerHeight - 248, caret.bottom + 6);
    wordSuggestions.style.left = `${left}px`;
    wordSuggestions.style.top = `${top}px`;
  }

  function updateWordSuggestions() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed ||
      !editor.contains(selection.anchorNode) || selection.anchorNode.nodeType !== Node.TEXT_NODE) {
      hideWordSuggestions();
      return;
    }

    const caretRange = selection.getRangeAt(0).cloneRange();
    const textBeforeCaret = caretRange.startContainer.textContent.slice(0, caretRange.startOffset);
    const wordMatch = textBeforeCaret.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+$/u);
    if (!wordMatch) {
      hideWordSuggestions();
      return;
    }

    const matches = uniqueUrduDictionary
      .filter((word) => word.startsWith(wordMatch[0]) && word !== wordMatch[0]);
    if (!matches.length) {
      hideWordSuggestions();
      return;
    }

    suggestionRange = caretRange.cloneRange();
    suggestionRange.setStart(caretRange.startContainer, caretRange.startOffset - wordMatch[0].length);
    activeSuggestionIndex = 0;
    wordSuggestions.replaceChildren();
    matches.forEach((word, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'word-suggestion';
      option.id = `word-suggestion-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === activeSuggestionIndex));
      option.textContent = word;
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => acceptWordSuggestion(index));
      wordSuggestions.append(option);
    });
    wordSuggestions.hidden = false;
    editor.setAttribute('aria-activedescendant', 'word-suggestion-0');
    window.cancelAnimationFrame(suggestionPositionFrame);
    suggestionPositionFrame = window.requestAnimationFrame(() => {
      suggestionPositionFrame = 0;
      if (!wordSuggestions.hidden) positionWordSuggestions(caretRange);
    });
  }

  function acceptWordSuggestion(index = activeSuggestionIndex) {
    const option = wordSuggestions.children[index];
    if (!option || !suggestionRange || !editor.contains(suggestionRange.commonAncestorContainer)) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(suggestionRange);
    editor.focus();
    document.execCommand('insertText', false, option.textContent);
    hideWordSuggestions();
    rememberEditorSelection();
    updateCounts();
    scheduleSave();
  }

  function moveWordSuggestionSelection(direction) {
    const options = Array.from(wordSuggestions.children);
    activeSuggestionIndex = (activeSuggestionIndex + direction + options.length) % options.length;
    options.forEach((option, index) => option.setAttribute('aria-selected', String(index === activeSuggestionIndex)));
    editor.setAttribute('aria-activedescendant', options[activeSuggestionIndex].id);
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  function syncZoomControls() {
    ['zoom-range', 'status-zoom-range'].forEach((id) => { document.getElementById(id).value = String(zoom); });
    ['zoom-label', 'status-zoom-label'].forEach((id) => { document.getElementById(id).textContent = `${zoom}%`; });
    document.getElementById('mobile-zoom-label').textContent = `${zoom}%`;
    editor.style.transform = `scale(${zoom / 100})`;
    editor.style.marginBottom = `${(zoom / 100 - 1) * editor.scrollHeight}px`;
    if (!marginGuides.hidden) marginGuides.style.transform = `scale(${zoom / 100})`;
    syncRulers();
  }

  const horizontalRuler = document.getElementById('horizontal-ruler');
  const verticalRuler = document.getElementById('vertical-ruler');
  const pageFrame = document.querySelector('.page-frame');
  const alignmentGuidesLayer = document.getElementById('alignment-guides');
  const documentStage = document.querySelector('.document-stage');
  const landscapeScrollbar = document.getElementById('landscape-scrollbar');

  function syncHorizontalRulerScroll() {
    horizontalRuler.style.transform = `translateX(${-documentStage.scrollLeft}px)`;
  }

  function syncLandscapeScrollbar() {
    const shouldShow = document.body.classList.contains('landscape-page') &&
      document.body.classList.contains('landscape-keyboard-open') &&
      documentStage.scrollWidth > documentStage.clientWidth + 1;
    landscapeScrollbar.hidden = !shouldShow;
    syncHorizontalRulerScroll();
    if (!shouldShow) return;
    landscapeScrollbar.firstElementChild.style.width = `${documentStage.scrollWidth}px`;
    if (landscapeScrollbar.scrollLeft !== documentStage.scrollLeft) {
      landscapeScrollbar.scrollLeft = documentStage.scrollLeft;
    }
  }
  landscapeScrollbar.addEventListener('scroll', () => {
    if (landscapeScrollbar.hidden || documentStage.scrollLeft === landscapeScrollbar.scrollLeft) return;
    documentStage.scrollLeft = landscapeScrollbar.scrollLeft;
  });
  documentStage.addEventListener('scroll', () => {
    syncHorizontalRulerScroll();
    if (landscapeScrollbar.hidden) return;
    if (landscapeScrollbar.scrollLeft !== documentStage.scrollLeft) {
      landscapeScrollbar.scrollLeft = documentStage.scrollLeft;
    }
  });

  function rulerPixels(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function updateRulerLabels(scale, length, vertical = false) {
    const axis = vertical ? verticalRuler : horizontalRuler;
    const layer = axis.querySelector(vertical ? '.vertical-ruler-scale' : '.ruler-scale');
    axis.querySelectorAll('.ruler-label').forEach((label) => label.remove());
    for (let inch = 1; inch * 96 * scale < length; inch += 1) {
      const label = document.createElement('span');
      label.className = 'ruler-label';
      label.textContent = String(inch);
      if (vertical) label.style.top = `${inch * 96 * scale}px`;
      else label.style.left = `${inch * 96 * scale}px`;
      layer.append(label);
    }
  }

  function syncRulers() {
    if (!horizontalRuler || !verticalRuler) return;
    pageFrame.style.width = `${editor.getBoundingClientRect().width + 42}px`;
    document.getElementById('add-page-button').style.width = `${editor.offsetWidth}px`;
    const paperRect = editor.getBoundingClientRect();
    const rulerRect = horizontalRuler.parentElement.getBoundingClientRect();
    const horizontalScale = paperRect.width / editor.offsetWidth;
    const verticalScale = paperRect.height / editor.offsetHeight;
    const style = getComputedStyle(editor);
    const paddingLeft = rulerPixels(style.paddingLeft);
    const paddingRight = rulerPixels(style.paddingRight);
    const horizontalWidth = paperRect.width;
    const verticalHeight = paperRect.height;

    horizontalRuler.style.width = `${horizontalWidth}px`;
    horizontalRuler.style.marginLeft = `${paperRect.left - rulerRect.left + documentStage.scrollLeft}px`;
    horizontalRuler.style.marginRight = '0';
    syncHorizontalRulerScroll();
    horizontalRuler.style.setProperty('--ruler-unit', `${96 * horizontalScale}px`);
    horizontalRuler.style.setProperty('--ruler-start', `${paddingLeft / editor.offsetWidth * 100}%`);
    horizontalRuler.style.setProperty('--ruler-end', `${(editor.offsetWidth - paddingRight) / editor.offsetWidth * 100}%`);
    updateRulerLabels(horizontalScale, horizontalWidth);

    const leftMargin = paddingLeft * horizontalScale;
    const rightMargin = horizontalWidth - paddingRight * horizontalScale;
    const setMarker = (name, position) => {
      const marker = horizontalRuler.querySelector(`[data-ruler-handle="${name}"]`);
      if (!marker) return;
      marker.style.left = `${Math.max(0, Math.min(horizontalWidth - 12, position - 6))}px`;
    };
    setMarker('margin-left', leftMargin);
    setMarker('margin-right', rightMargin);

    syncVerticalRuler();
    syncLandscapeScrollbar();
    syncAlignmentGuides();
  }

  function rulerDragValue(event, track, vertical) {
    const rect = track.getBoundingClientRect();
    const dimension = vertical
      ? Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123
      : editor.offsetWidth;
    const renderedDimension = vertical ? rect.height : rect.width;
    const offset = vertical ? event.clientY - rect.top : event.clientX - rect.left;
    return Math.max(0, Math.min(dimension, offset * dimension / renderedDimension));
  }

  function syncAlignmentGuides() {
    alignmentGuidesLayer.style.width = `${editor.offsetWidth}px`;
    alignmentGuidesLayer.style.height = `${editor.offsetHeight}px`;
    alignmentGuidesLayer.style.transform = `scale(${zoom / 100})`;
  }

  function positionAlignmentGuide(line, guide) {
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
    const pageTop = guide.page * (pageHeight + pageGap);
    if (guide.axis === 'x') {
      line.style.left = `${guide.position}px`;
      line.style.top = `${pageTop}px`;
      line.style.height = `${pageHeight}px`;
    } else {
      line.style.left = '0';
      line.style.top = `${pageTop + guide.position}px`;
      line.style.width = `${editor.offsetWidth}px`;
    }
  }

  function renderAlignmentGuides() {
    syncAlignmentGuides();
    alignmentGuidesLayer.replaceChildren();
    alignmentGuides.forEach((guide, index) => {
      const line = document.createElement('div');
      line.className = 'alignment-guide';
      line.dataset.axis = guide.axis;
      line.dataset.guideIndex = String(index);
      line.tabIndex = 0;
      line.setAttribute('role', 'separator');
      line.setAttribute('aria-label',
        `${guide.axis === 'x' ? 'Vertical' : 'Horizontal'} alignment guide on page ${guide.page + 1}; drag to move or press Delete to remove`);
      positionAlignmentGuide(line, guide);
      alignmentGuidesLayer.append(line);
    });
    document.querySelectorAll('[data-guide-add]').forEach((button) => {
      const axis = button.dataset.guideAdd;
      const active = alignmentGuides.some((guide) => guide.axis === axis);
      const direction = axis === 'x' ? 'vertical' : 'horizontal';
      button.setAttribute('aria-pressed', String(active));
      button.title = `${active ? 'Remove' : 'Add'} a ${direction} blue alignment guide`;
      button.querySelector('span:last-child').textContent =
        `${active ? 'Remove' : 'Add'} ${direction} guide`;
    });
  }

  function addAlignmentGuide(axis, page, position) {
    if (!['x', 'y'].includes(axis) || alignmentGuides.some((guide) => guide.axis === axis)) return;
    alignmentGuides.push({ axis, page, position });
    renderAlignmentGuides();
    scheduleSave();
    alignmentGuidesLayer.lastElementChild?.focus();
  }

  function removeAlignmentGuide(index) {
    if (!Number.isInteger(index) || index < 0 || index >= alignmentGuides.length) return;
    alignmentGuides.splice(index, 1);
    renderAlignmentGuides();
    scheduleSave();
  }

  alignmentGuidesLayer.addEventListener('pointerdown', (event) => {
    const line = event.target.closest('.alignment-guide');
    if (!line || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    line.focus();
    line.setPointerCapture(event.pointerId);
    const index = Number(line.dataset.guideIndex);
    const guide = alignmentGuides[index];
    if (!guide) return;
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const rect = editor.getBoundingClientRect();
      const scaleX = rect.width / Math.max(editor.offsetWidth, 1);
      const scaleY = rect.height / Math.max(editor.offsetHeight, 1);
      const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
      const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
      guide.position = guide.axis === 'x'
        ? Math.max(0, Math.min(editor.offsetWidth, (moveEvent.clientX - rect.left) / scaleX))
        : Math.max(0, Math.min(pageHeight,
          (moveEvent.clientY - rect.top) / scaleY - guide.page * (pageHeight + pageGap)));
      positionAlignmentGuide(line, guide);
      moveEvent.preventDefault();
    };
    const finish = (finishEvent) => {
      if (finishEvent.pointerId !== event.pointerId) return;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      scheduleSave();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  });
  alignmentGuidesLayer.addEventListener('keydown', (event) => {
    const line = event.target.closest('.alignment-guide');
    if (!line) return;
    const index = Number(line.dataset.guideIndex);
    const guide = alignmentGuides[index];
    if (!guide) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeAlignmentGuide(index);
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    guide.position = Math.max(0, Math.min(guide.axis === 'x' ? editor.offsetWidth : pageHeight,
      guide.position + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? step :
        event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : 0)));
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    positionAlignmentGuide(line, guide);
    scheduleSave();
  });
  horizontalRuler.parentElement.title = 'Double-click to add a vertical blue guide; drag the guide to align objects.';
  verticalRuler.parentElement.title = 'Double-click to add a horizontal blue guide; drag the guide to align objects.';
  horizontalRuler.parentElement.addEventListener('dblclick', (event) => {
    if (event.target.closest('[data-ruler-handle]')) return;
    const rect = editor.getBoundingClientRect();
    const scaleX = rect.width / Math.max(editor.offsetWidth, 1);
    const page = Math.max(0, Number(verticalRuler.dataset.pageIndex) || 0);
    addAlignmentGuide('x', page, Math.max(0, Math.min(editor.offsetWidth, (event.clientX - rect.left) / scaleX)));
  });
  verticalRuler.parentElement.addEventListener('dblclick', (event) => {
    if (event.target.closest('[data-ruler-handle]')) return;
    const rect = editor.getBoundingClientRect();
    const scaleY = rect.height / Math.max(editor.offsetHeight, 1);
    const page = Math.max(0, Number(verticalRuler.dataset.pageIndex) || 0);
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
    const localY = (event.clientY - rect.top) / scaleY - page * (pageHeight + pageGap);
    addAlignmentGuide('y', page, Math.max(0, Math.min(pageHeight, localY)));
  });

  function setRulerValue(handle, value) {
    const pageWidth = editor.offsetWidth;
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const minMargin = 36;
    if (handle === 'margin-left' || handle === 'margin-right') {
      const side = handle === 'margin-left' ? 'left' : 'right';
      const key = `padding${side[0].toUpperCase()}${side.slice(1)}`;
      const opposite = side === 'left' ? 'right' : 'left';
      const maxMargin = Math.max(minMargin, pageWidth - documentMargin(opposite) - 80);
      const margin = Math.max(minMargin, Math.min(maxMargin, handle === 'margin-left' ? value : pageWidth - value));
      editor.style[key] = `${margin}px`;
      editor.style.setProperty(`--document-margin-${side}`, `${margin}px`);
    } else if (handle === 'margin-top' || handle === 'margin-bottom') {
      const side = handle === 'margin-top' ? 'top' : 'bottom';
      const key = `padding${side[0].toUpperCase()}${side.slice(1)}`;
      const opposite = side === 'top' ? 'bottom' : 'top';
      const header = side === 'top' ? editor.querySelector('.document-header:not([data-page-number-location])') : null;
      const minimumMargin = Math.max(minMargin, header ? documentHeaderContentMinimum(header) : minMargin);
      const maxMargin = Math.max(minimumMargin, pageHeight - documentMargin(opposite) - 80);
      const margin = Math.max(minimumMargin, Math.min(maxMargin, handle === 'margin-top' ? value : pageHeight - value));
      editor.style.setProperty(`--document-margin-${side}`, `${margin}px`);
      if (side === 'top' && editor.classList.contains('has-document-header')) {
        syncDocumentHeaderSpacing();
      } else {
        editor.style[key] = `${margin}px`;
      }
    }
    syncRulers();
    queueAutoPagination();
    scheduleSave();
  }

  [horizontalRuler, verticalRuler].forEach((track) => {
    track.addEventListener('pointerdown', (event) => {
      const marker = event.target.closest('[data-ruler-handle]');
      if (!marker) return;
      event.preventDefault();
      marker.setPointerCapture(event.pointerId);
      const vertical = track === verticalRuler;
      const handle = marker.dataset.rulerHandle;
      const update = (moveEvent) => {
        setRulerValue(handle, rulerDragValue(moveEvent, track, vertical));
      };
      const finish = () => {
        marker.removeEventListener('pointermove', update);
        marker.removeEventListener('pointerup', finish);
        marker.removeEventListener('pointercancel', finish);
      };
      marker.addEventListener('pointermove', update);
      marker.addEventListener('pointerup', finish);
      marker.addEventListener('pointercancel', finish);
    });
  });
  window.addEventListener('resize', syncRulers);
  document.fonts.ready.then(syncRulers);
  editor.addEventListener('load', syncRulers, true);
  syncRulers();

  function saveLocally() {
    try {
      const documentData = {
        id: activeDocumentId,
        name: nameInput.value.trim() || 'Untitled document',
        html: editor.innerHTML,
        alignmentGuides,
        pageSetup: {
          size: pageSize,
          landscape,
          customDimensionsInches: customPageDimensions
            ? customPageDimensions.map((dimension) => dimension / 96)
            : null,
          margins: pageMargins
        },
        pageBorderStyle,
        pageBorderColor,
        pageColor,
        updatedAt: new Date().toISOString()
      };
      const storedDocuments = localStorage.getItem(DOCUMENTS_KEY);
      const documents = storedDocuments ? JSON.parse(storedDocuments) : [];
      if (!Array.isArray(documents)) throw new Error('Saved files have an invalid format.');
      const existingIndex = documents.findIndex((saved) => saved && saved.id === activeDocumentId);
      if (existingIndex === -1) documents.push(documentData);
      else documents[existingIndex] = documentData;
      localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(documents));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(documentData));
      localStorage.removeItem(`${RECOVERY_KEY_PREFIX}${activeDocumentId}`);
      window.clearTimeout(recoveryTimer);
      recoveryTimer = 0;
      setSaveStatus('Saved');
      saveStatus.title = 'Saved on this device';
    } catch (error) {
      setSaveStatus('Save failed');
      saveStatus.title = 'Could not save on this device';
      console.error('Could not save the document in this browser.', error);
    }
  }

  function saveRecoveryDraft() {
    try {
      const draft = {
        id: activeDocumentId,
        name: nameInput.value.trim() || 'Untitled document',
        html: editor.innerHTML,
        alignmentGuides,
        pageSetup: {
          size: pageSize,
          landscape,
          customDimensionsInches: customPageDimensions
            ? customPageDimensions.map((dimension) => dimension / 96)
            : null,
          margins: pageMargins
        },
        pageBorderStyle,
        pageBorderColor,
        pageColor,
        updatedAt: new Date().toISOString()
      };
      localStorage.setItem(`${RECOVERY_KEY_PREFIX}${activeDocumentId}`, JSON.stringify(draft));
      return true;
    } catch (error) {
      setSaveStatus('Recovery save failed');
      saveStatus.title = 'Could not protect the latest changes from a reload';
      console.error('Could not save a recovery copy of the document.', error);
      return false;
    }
  }

  function setPendingHistoryAction(action, groupKey = null) {
    if (!action) return;
    pendingHistoryAction = action;
    pendingHistoryGroupKey = groupKey;
    pendingHistoryActionExpiresAt = Date.now() + 1500;
  }

  function queueHistoryCheckpoint() {
    if (!documentHistoryManager || isRestoringHistory) return;
    window.clearTimeout(historyCheckpointTimer);
    const delay = pendingHistoryGroupKey ? 150 : 0;
    historyCheckpointTimer = window.setTimeout(() => {
      historyCheckpointTimer = 0;
      const expired = Date.now() > pendingHistoryActionExpiresAt;
      const action = expired || !pendingHistoryAction ? 'Edited Document' : pendingHistoryAction;
      const groupKey = expired ? null : pendingHistoryGroupKey;
      pendingHistoryAction = '';
      pendingHistoryGroupKey = null;
      pendingHistoryActionExpiresAt = 0;
      documentHistoryManager.record(action, { groupKey });
    }, delay);
  }

  function flushHistoryCheckpoint() {
    if (historyCheckpointTimer) {
      window.clearTimeout(historyCheckpointTimer);
      historyCheckpointTimer = 0;
    }
    if (!documentHistoryManager || isRestoringHistory) return;
    const expired = Date.now() > pendingHistoryActionExpiresAt;
    const action = expired || !pendingHistoryAction ? 'Edited Document' : pendingHistoryAction;
    const groupKey = expired ? null : pendingHistoryGroupKey;
    pendingHistoryAction = '';
    pendingHistoryGroupKey = null;
    pendingHistoryActionExpiresAt = 0;
    documentHistoryManager.record(action, { groupKey });
  }

  function scheduleSave(historyAction = '', historyGroupKey = null, recordHistory = true) {
    if (recordHistory) {
      if (typeof historyAction === 'string' && historyAction) {
        setPendingHistoryAction(historyAction, historyGroupKey);
      } else if (!pendingHistoryAction || Date.now() > pendingHistoryActionExpiresAt) {
        setPendingHistoryAction('Edited Document');
      }
      queueHistoryCheckpoint();
    }
    setSaveStatus('Saving…');
    saveStatus.title = 'Saving on this device';
    if (!recoveryTimer) {
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = 0;
        saveRecoveryDraft();
      }, 1500);
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveLocally, 350);
  }

  function flushPendingSave() {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = 0;
    window.clearTimeout(saveTimer);
    saveRecoveryDraft();
    saveLocally();
  }

  function applyPageBorder() {
    if (pageBorderStyle === 'none') delete editor.dataset.pageBorder;
    else editor.dataset.pageBorder = pageBorderStyle;
    editor.style.setProperty('--page-border-color', pageBorderColor);
    editor.style.setProperty('--page-border-width', '2px');
    document.querySelectorAll('[data-page-border]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.pageBorder === pageBorderStyle));
      const preview = button.querySelector('.page-border-preview');
      if (preview) preview.style.borderColor = pageBorderColor;
    });
  }

  function applyPageColor() {
    editor.style.setProperty('--paper', pageColor);
    const input = document.getElementById('page-color-input');
    input.value = pageColor;
    const indicator = input.nextElementSibling?.querySelector('.color-tool > span');
    if (indicator) indicator.style.backgroundColor = pageColor;
  }

  function restorePageSetup(settings) {
    if (!settings || typeof settings !== 'object') return;
    const sizes = ['Letter', 'Legal', 'Executive', 'A4', 'A5', 'Custom'];
    if (sizes.includes(settings.size)) pageSize = settings.size;
    if (typeof settings.landscape === 'boolean') landscape = settings.landscape;
    if (pageSize === 'Custom' && Array.isArray(settings.customDimensionsInches) &&
      settings.customDimensionsInches.length === 2 &&
      settings.customDimensionsInches.every((value) =>
        Number.isFinite(value) && value >= 4 && value <= 20)) {
      customPageDimensions = settings.customDimensionsInches.map((value) => value * 96);
    } else if (pageSize !== 'Custom') {
      customPageDimensions = null;
    } else {
      pageSize = 'A4';
      customPageDimensions = null;
    }
    if (Array.isArray(settings.margins) && settings.margins.length === 4 &&
      settings.margins.every((value) => Number.isFinite(value) && value >= 0 && value <= 3)) {
      pageMargins = [...settings.margins];
    }
  }

  window.addEventListener('pagehide', flushPendingSave);
  window.addEventListener('beforeunload', flushPendingSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });

  function restoreDocument() {
    const params = new URLSearchParams(window.location.search);
    let recoveredDraft = false;
    if (params.get('new') === '1') {
      activeDocumentId = createDocumentId();
      alignmentGuides = [];
      nameInput.value = 'Untitled document';
      editor.innerHTML = '<p><br></p>';
      pageBorderStyle = 'none';
      pageBorderColor = '#697586';
      applyPageBorder();
      pageColor = '#ffffff';
      applyPageColor();
      renderAlignmentGuides();
      window.history.replaceState({}, document.title, `${window.location.pathname}?document=${encodeURIComponent(activeDocumentId)}`);
      return;
    }
    try {
      const requestedId = params.get('document');
      let documentData;
      if (requestedId) {
        activeDocumentId = requestedId;
        const storedDocuments = localStorage.getItem(DOCUMENTS_KEY);
        const documents = storedDocuments ? JSON.parse(storedDocuments) : [];
        if (!Array.isArray(documents)) throw new Error('Saved files have an invalid format.');
        documentData = documents.find((saved) => saved && saved.id === requestedId);
        const draftValue = localStorage.getItem(`${RECOVERY_KEY_PREFIX}${requestedId}`);
        if (draftValue) {
          try {
            const draft = JSON.parse(draftValue);
            if (draft && draft.id === requestedId && typeof draft.name === 'string' && typeof draft.html === 'string') {
              const savedAt = documentData && Date.parse(documentData.updatedAt);
              const draftAt = Date.parse(draft.updatedAt);
              if (!documentData || (Number.isFinite(draftAt) && (!Number.isFinite(savedAt) || draftAt > savedAt))) {
                documentData = draft;
                recoveredDraft = true;
              }
            } else {
              console.error('The recovery copy for this document has an invalid format.');
            }
          } catch (error) {
            console.error('Could not read the recovery copy for this document.', error);
          }
        }
        if (!documentData) throw new Error('The requested saved file could not be found.');
      } else {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          activeDocumentId = createDocumentId();
          alignmentGuides = [];
          renderAlignmentGuides();
          window.history.replaceState({}, document.title, `${window.location.pathname}?document=${encodeURIComponent(activeDocumentId)}`);
          return;
        }
        documentData = JSON.parse(stored);
        activeDocumentId = documentData.id || 'legacy-document';
        window.history.replaceState({}, document.title, `${window.location.pathname}?document=${encodeURIComponent(activeDocumentId)}`);
      }
      if (typeof documentData.name === 'string' && typeof documentData.html === 'string') {
        nameInput.value = documentData.name;
        editor.innerHTML = sanitizeDocumentHtml(documentData.html);
        restorePageSetup(documentData.pageSetup);
        syncDocumentHeaderSpacing();
        const pageCount = editor.querySelectorAll('.page-break').length + 1;
        const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
        const restoredGuideAxes = new Set();
        alignmentGuides = Array.isArray(documentData.alignmentGuides)
          ? documentData.alignmentGuides.filter((guide) => {
            if (!guide || !['x', 'y'].includes(guide.axis) || !Number.isInteger(guide.page) ||
              guide.page < 0 || guide.page >= pageCount || !Number.isFinite(guide.position) ||
              guide.position < 0 || restoredGuideAxes.has(guide.axis)) return false;
            restoredGuideAxes.add(guide.axis);
            return true;
          }).map((guide) => ({
            axis: guide.axis,
            page: guide.page,
            position: Math.min(guide.axis === 'x' ? editor.offsetWidth : pageHeight, guide.position)
          }))
          : [];
        pageBorderStyle = ['none', 'solid', 'thick', 'double', 'dashed', 'dotted'].includes(documentData.pageBorderStyle)
          ? documentData.pageBorderStyle
          : 'none';
        pageBorderColor = /^#[\da-f]{6}$/i.test(documentData.pageBorderColor || '')
          ? documentData.pageBorderColor
          : '#697586';
        applyPageBorder();
        document.getElementById('page-border-color-input').value = pageBorderColor;
        pageColor = /^#[\da-f]{6}$/i.test(documentData.pageColor || '')
          ? documentData.pageColor
          : '#ffffff';
        applyPageColor();
        renderAlignmentGuides();
        if (recoveredDraft) setSaveStatus('Recovered');
      } else {
        throw new Error('The saved document does not have a valid format.');
      }
    } catch (error) {
      setSaveStatus('Open failed');
      saveStatus.title = 'Could not open the saved document';
      console.error('Could not restore the saved document.', error);
    }
    if (recoveredDraft) scheduleSave();
  }

  function createDocumentId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function rememberEditorSelection() {
    const activeElement = document.activeElement;
    const activeRegion = activeElement instanceof Element
      ? activeElement.closest('[data-document-region]')
      : null;
    if (activeElement !== editor && activeRegion?.getAttribute('contenteditable') !== 'true') return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      const range = selection.getRangeAt(0);
      const region = (selection.anchorNode instanceof Element
        ? selection.anchorNode
        : selection.anchorNode.parentElement)?.closest('[data-document-region]');
      if (region && region.getAttribute('contenteditable') !== 'true') return;
      if (protectSelectedRange && range.collapsed) return;
      savedEditorRange = range.cloneRange();
      if (!range.collapsed) {
        protectSelectedRange = false;
        window.clearTimeout(protectRangeTimer);
      }
    }
  }

  function restoreBodyCaret() {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const anchorRegion = anchorElement?.closest('[data-document-region]');
    const focus = selection?.focusNode;
    const focusElement = focus instanceof Element ? focus : focus?.parentElement;
    const focusRegion = focusElement?.closest('[data-document-region]');
    if (selection && !selection.isCollapsed &&
      (!anchorRegion || anchorRegion.getAttribute('contenteditable') === 'true') &&
      (!focusRegion || focusRegion.getAttribute('contenteditable') === 'true')) return;
    if (anchor && anchor !== editor &&
      (!anchorRegion || anchorRegion.getAttribute('contenteditable') === 'true')) return false;

    const bodyParagraphs = Array.from(editor.querySelectorAll('p')).filter((item) =>
      !item.closest('[data-document-region], .editor-shape, table'));
    let paragraph = bodyParagraphs[bodyParagraphs.length - 1];
    if (!paragraph) {
      paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      const footer = editor.querySelector(':scope > .document-footer');
      editor.insertBefore(paragraph, footer || null);
    }

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
    return true;
  }

  function preserveSelectedRange(range) {
    if (!range || range.collapsed) return;
    savedEditorRange = range.cloneRange();
    protectSelectedRange = true;
    window.clearTimeout(protectRangeTimer);
    protectRangeTimer = window.setTimeout(() => { protectSelectedRange = false; }, 400);
  }

  function getRangeFontSize(range) {
    if (!range || !editor.contains(range.commonAncestorContainer)) return null;
    if (range.collapsed) {
      const container = range.startContainer;
      const element = container instanceof Element ? container : container.parentElement;
      return Number.parseFloat(getComputedStyle(element || editor).fontSize) || null;
    }

    const sizes = new Set();
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root || editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (!textNode.textContent.trim() || !range.intersectsNode(textNode)) continue;
      sizes.add(Number.parseFloat(getComputedStyle(textNode.parentElement || editor).fontSize));
      if (sizes.size > 1) return null;
    }
    return sizes.size === 1 ? sizes.values().next().value : null;
  }

  const FONT_SIZE_SELECTION_HIGHLIGHT = 'font-size-selection';
  function setFontSizeSelectionHighlight(range) {
    if (!window.CSS?.highlights || typeof window.Highlight !== 'function') return;
    window.CSS.highlights.delete(FONT_SIZE_SELECTION_HIGHLIGHT);
    if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
      window.CSS.highlights.set(FONT_SIZE_SELECTION_HIGHLIGHT, new window.Highlight(range.cloneRange()));
    }
  }

  function updateFontSizeControl(range = null, force = false) {
    const input = document.getElementById('font-size');
    if (!input || (input === document.activeElement && !force)) return;
    const selection = window.getSelection();
    const currentRange = range || (selection?.rangeCount ? selection.getRangeAt(0) : savedEditorRange);
    const size = getRangeFontSize(currentRange);
    input.value = size ? String(Math.round(size * 100) / 100) : '';
  }

  function getElementFormatState(command, element) {
    if (!element || element === editor) return false;
    const computedStyle = getComputedStyle(element);
    if (command === 'bold') {
      return element.tagName === 'B' || element.tagName === 'STRONG' ||
        computedStyle.fontWeight === 'bold' || Number.parseInt(computedStyle.fontWeight, 10) >= 600;
    }
    if (command === 'italic') {
      return element.tagName === 'I' || element.tagName === 'EM' ||
        ['italic', 'oblique'].includes(computedStyle.fontStyle);
    }
    if (command === 'underline') {
      return element.tagName === 'U' ||
        computedStyle.textDecorationLine.split(/\s+/).includes('underline');
    }
    return false;
  }

  function getCollapsedInlineFormatState(command, range = null) {
    const selection = window.getSelection();
    const caretRange = range || (selection?.rangeCount ? selection.getRangeAt(0) : null);
    if (!caretRange || !caretRange.collapsed || !editor.contains(caretRange.startContainer)) return false;
    const activeFormatCaret = caretRange.startContainer instanceof Element
      ? caretRange.startContainer.closest?.('span[data-format-caret="true"]')
      : caretRange.startContainer.parentElement?.closest?.('span[data-format-caret="true"]');
    if (activeFormatCaret && editor.contains(activeFormatCaret)) {
      return getElementFormatState(command, activeFormatCaret);
    }
    let element = caretRange.startContainer instanceof Element
      ? caretRange.startContainer
      : caretRange.startContainer.parentElement;
    while (element && element !== editor) {
      if (getElementFormatState(command, element)) return true;
      element = element.parentElement;
    }
    return false;
  }

  function getRangeInlineFormatState(command, range) {
    if (!range || !editor.contains(range.commonAncestorContainer)) return false;
    if (range.collapsed) return getCollapsedInlineFormatState(command, range);

    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let foundText = false;
    let allTextFormatted = true;
    const checkTextNode = (node) => {
      if (!node.textContent || !range.intersectsNode(node)) return true;
      foundText = true;
      if (!getElementFormatState(command, node.parentElement)) {
        allTextFormatted = false;
        return false;
      }
      return true;
    };

    if (root.nodeType === Node.TEXT_NODE && !checkTextNode(root)) return false;
    while (walker.nextNode()) {
      if (!checkTextNode(walker.currentNode)) return false;
    }
    return foundText && allTextFormatted;
  }

  function updateTextFormatButtons() {
    const selection = window.getSelection();
    const liveSelectionIsInEditor = selection?.rangeCount &&
      editor.contains(selection.anchorNode) && editor.contains(selection.focusNode);
    const range = liveSelectionIsInEditor ? selection.getRangeAt(0) : savedEditorRange;
    const rangeIsInEditor = range && editor.contains(range.commonAncestorContainer);
    document.querySelectorAll('.format-group [data-command="bold"], .format-group [data-command="italic"], .format-group [data-command="underline"]').forEach((button) => {
      const command = button.dataset.command;
      const active = rangeIsInEditor && getRangeInlineFormatState(command, range);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function isAtStartOfBody(range) {
    const firstParagraph = Array.from(editor.querySelectorAll('p')).find((paragraph) =>
      !paragraph.closest('[data-document-region], .editor-shape, table'));
    if (!firstParagraph) return false;
    if (!firstParagraph.textContent.trim() &&
      !firstParagraph.querySelector('img, table, .editor-shape, [data-watermark]') &&
      firstParagraph.contains(range.startContainer)) return true;
    const walker = document.createTreeWalker(firstParagraph, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    const bodyStart = document.createRange();
    if (firstText) bodyStart.setStart(firstText, 0);
    else bodyStart.selectNodeContents(firstParagraph);
    bodyStart.collapse(true);
    return range.compareBoundaryPoints(Range.START_TO_START, bodyStart) <= 0;
  }

  document.querySelector('.ribbon').addEventListener('pointerdown', rememberEditorSelection, true);
  editor.addEventListener('pointerup', () => {
    protectSelectedRange = false;
    lastFormattedSpan = null;
    if (restoreBodyCaret()) window.requestAnimationFrame(restoreBodyCaret);
    rememberEditorSelection();
    updateWordSuggestions();
  });
  editor.addEventListener('click', () => {
    if (restoreBodyCaret()) window.requestAnimationFrame(restoreBodyCaret);
    rememberEditorSelection();
  });
  editor.addEventListener('keyup', () => {
    protectSelectedRange = false;
    lastFormattedSpan = null;
    const selection = window.getSelection();
    const selectionElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const editableObject = selectionElement?.closest('.editor-textbox, .editor-shape[contenteditable="true"]');
    if (editableObject && document.activeElement !== editableObject) {
      editableObject.focus({ preventScroll: true });
    }
    rememberEditorSelection();
  });

  document.addEventListener('selectionchange', () => {
    rememberEditorSelection();
    updateTableCaretOverlay();
    updateFontSizeControl();
    updateTextFormatButtons();
  });

  function focusEditor() {
    rememberEditorSelection();
    const selection = window.getSelection();
    const savedNode = savedEditorRange?.commonAncestorContainer;
    const savedElement = savedNode instanceof Element ? savedNode : savedNode?.parentElement;
    const savedRegion = savedElement?.closest('[data-document-region]');
    if (savedRegion?.getAttribute('contenteditable') === 'true') {
      savedRegion.focus();
      if (selection && savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
        selection.removeAllRanges();
        selection.addRange(savedEditorRange);
      }
      return;
    }
    editor.focus();
    if (savedRegion && savedRegion.getAttribute('contenteditable') !== 'true') {
      savedEditorRange = null;
    }
    if (selection && savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(savedEditorRange);
    }
    restoreBodyCaret();
  }

  function getFormatCaretSpan(range) {
    if (!range?.collapsed) return null;
    const container = range.startContainer;
    const element = container instanceof Element ? container : container.parentElement;
    const span = element?.closest('span[data-format-caret="true"]');
    return span && editor.contains(span) && span.contains(container) ? span : null;
  }

  function applyInlineStyle(property, value) {
    focusEditor();
    const selection = window.getSelection();
    if (!selection) return;
    let range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range && range.collapsed && lastFormattedSpan && editor.contains(lastFormattedSpan)) {
      if (lastFormattedSpan.dataset.formatCaret === 'true') {
        lastFormattedSpan.style.setProperty(property, value);
        savedEditorRange = selection.getRangeAt(0).cloneRange();
        scheduleSave();
        updateCounts();
        return;
      }
      range.selectNodeContents(lastFormattedSpan);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (range && !range.collapsed && lastFormattedSpan && editor.contains(lastFormattedSpan) &&
      range.toString() === lastFormattedSpan.textContent) {
      lastFormattedSpan.style.setProperty(property, value);
      preserveSelectedRange(range);
      scheduleSave();
      updateCounts();
      return;
    }
    if (!range || !editor.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    const span = document.createElement('span');
    span.style.setProperty(property, value);
    const isCollapsed = range.collapsed;
    if (isCollapsed) {
      span.dataset.formatCaret = 'true';
      span.textContent = '\u200b';
    } else {
      let ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;
      while (ancestor && ancestor !== editor) {
        const parent = ancestor.parentElement;
        if (ancestor.style && ancestor.style.getPropertyValue(property) &&
          range.toString() === ancestor.textContent) {
          ancestor.style.removeProperty(property);
          if (!ancestor.style.length) ancestor.removeAttribute('style');
        }
        ancestor = parent;
      }
      const contents = range.extractContents();
      contents.querySelectorAll('[style]').forEach((node) => {
        node.style.removeProperty(property);
        if (!node.style.length) node.removeAttribute('style');
        if (node.tagName === 'SPAN' && node.attributes.length === 0) {
          node.replaceWith(...node.childNodes);
        }
      });
      span.append(contents);
    }
    range.insertNode(span);
    const nextRange = document.createRange();
    if (isCollapsed) {
      nextRange.setStart(span.firstChild, 0);
      nextRange.collapse(true);
    } else {
      nextRange.selectNodeContents(span);
    }
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedEditorRange = nextRange.cloneRange();
    lastFormattedSpan = span;
    preserveSelectedRange(nextRange);
    let wrapper = span.parentElement;
    while (wrapper && wrapper !== editor) {
      const parent = wrapper.parentElement;
      if (wrapper.tagName === 'SPAN' && wrapper.attributes.length === 0) {
        wrapper.replaceWith(...wrapper.childNodes);
      }
      wrapper = parent;
    }
    scheduleSave();
    updateCounts();
  }

  function applyEnglishItalic(range) {
    const getTextOffset = (container, offset) => {
      const preceding = document.createRange();
      preceding.selectNodeContents(editor);
      preceding.setEnd(container, offset);
      return preceding.toString().length;
    };
    const selectionStart = getTextOffset(range.startContainer, range.startOffset);
    const selectionEnd = getTextOffset(range.endContainer, range.endOffset);
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const textRuns = [];
    let textOffset = 0;
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const start = Math.max(0, selectionStart - textOffset);
      const end = Math.min(textNode.length, selectionEnd - textOffset);
      textOffset += textNode.length;
      if (end <= start) continue;
      const text = textNode.textContent.slice(start, end);
      for (const match of text.matchAll(/[\p{Script=Latin}\p{N}]+/gu)) {
        textRuns.push({
          node: textNode,
          start: start + match.index,
          end: start + match.index + match[0].length
        });
      }
    }
    textRuns.reverse().forEach(({ node, start, end }) => {
      const runRange = document.createRange();
      runRange.setStart(node, start);
      runRange.setEnd(node, end);
      const wasItalic = getComputedStyle(node.parentElement).fontStyle === 'italic';
      let ancestor = node.parentElement;
      while (ancestor && ancestor !== editor) {
        if (ancestor.tagName === 'SPAN' && ancestor.style.fontStyle &&
          ancestor.textContent === runRange.toString()) {
          ancestor.style.fontStyle = wasItalic ? 'normal' : 'italic';
          return;
        }
        ancestor = ancestor.parentElement;
      }
      const wrapper = document.createElement('span');
      wrapper.style.fontStyle = wasItalic ? 'normal' : 'italic';
      wrapper.append(runRange.extractContents());
      runRange.insertNode(wrapper);
    });
    editor.querySelectorAll('span[style]').forEach((span) => {
      if (span.style.fontStyle !== 'normal') return;
      let ancestor = span.parentElement;
      while (ancestor && ancestor !== editor) {
        if (ancestor.tagName === 'SPAN' && ancestor.style.fontStyle === 'italic' &&
          ancestor.textContent === span.textContent) {
          ancestor.style.fontStyle = 'normal';
          if (span.attributes.length === 1) span.replaceWith(...span.childNodes);
          break;
        }
        ancestor = ancestor.parentElement;
      }
    });
    const pointAt = (textOffset) => {
      const textWalker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let remaining = textOffset;
      let lastTextNode = null;
      while (textWalker.nextNode()) {
        const textNode = textWalker.currentNode;
        lastTextNode = textNode;
        if (remaining <= textNode.length) return [textNode, remaining];
        remaining -= textNode.length;
      }
      return lastTextNode ? [lastTextNode, lastTextNode.length] : [editor, 0];
    };
    const updatedRange = document.createRange();
    updatedRange.setStart(...pointAt(selectionStart));
    updatedRange.setEnd(...pointAt(selectionEnd));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(updatedRange);
    preserveSelectedRange(updatedRange);
    scheduleSave();
    updateCounts();
  }

  function applyFontSize(input) {
    if (applyingFontSize) return;
    const size = Number(input.value);
    if (!Number.isFinite(size) || size < 6 || size > 1000) {
      input.setCustomValidity('Enter a font size from 6 to 1000.');
      input.reportValidity();
      input.setCustomValidity('');
      return false;
    }
    input.value = String(size);
    setFontSizeSelectionHighlight(null);
    const activeSelection = window.getSelection();
    const rangeBeforeFocus = activeSelection?.rangeCount &&
      editor.contains(activeSelection.anchorNode)
      ? activeSelection.getRangeAt(0).cloneRange()
      : savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)
        ? savedEditorRange.cloneRange()
        : null;
    focusEditor();
    const fontSelection = window.getSelection();
    if (fontSelection && rangeBeforeFocus &&
      editor.contains(rangeBeforeFocus.commonAncestorContainer)) {
      fontSelection.removeAllRanges();
      fontSelection.addRange(rangeBeforeFocus);
    }
    const caretRange = fontSelection?.rangeCount ? fontSelection.getRangeAt(0) : savedEditorRange;
    if (caretRange?.collapsed && editor.contains(caretRange.startContainer)) {
      const caretElement = caretRange.startContainer instanceof Element
        ? caretRange.startContainer
        : caretRange.startContainer.parentElement;
      const paragraph = caretElement?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, div');
      if (paragraph) {
        const beforeRange = caretRange.cloneRange();
        beforeRange.selectNodeContents(paragraph);
        beforeRange.setEnd(caretRange.startContainer, caretRange.startOffset);
        const afterRange = caretRange.cloneRange();
        afterRange.selectNodeContents(paragraph);
        afterRange.setStart(caretRange.startContainer, caretRange.startOffset);
        const previousCharacter = Array.from(beforeRange.toString()).pop();
        const nextCharacter = Array.from(afterRange.toString())[0];
        const previousIsUrduLetter = previousCharacter &&
          /\p{L}/u.test(previousCharacter) && /\p{Script=Arabic}/u.test(previousCharacter);
        const nextIsWhitespace = nextCharacter && /\s/u.test(nextCharacter);
        if (previousIsUrduLetter && !nextIsWhitespace) {
          const activeFormatCaret = getFormatCaretSpan(caretRange);
          if (activeFormatCaret) {
            activeFormatCaret.before(document.createTextNode(' '));
          } else {
            const separator = document.createTextNode(' ');
            caretRange.insertNode(separator);
            caretRange.setStartAfter(separator);
            caretRange.collapse(true);
            fontSelection.removeAllRanges();
            fontSelection.addRange(caretRange);
            savedEditorRange = caretRange.cloneRange();
          }
        }
      }
    }
    applyingFontSize = true;
    try {
      const activeFormatCaret = getFormatCaretSpan(caretRange);
      if (activeFormatCaret) {
        activeFormatCaret.style.setProperty('font-size', `${size}px`);
        lastFormattedSpan = activeFormatCaret;
        scheduleSave();
        updateCounts();
      } else {
        applyInlineStyle('font-size', `${size}px`);
      }
    } finally {
      applyingFontSize = false;
    }
    const selection = window.getSelection();
    const range = selection?.rangeCount && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)
        ? savedEditorRange
        : null;
    const listItems = range && !range.collapsed
      ? Array.from(editor.querySelectorAll('li')).filter((item) => range.intersectsNode(item))
      : [];
    listItems.forEach((item) => { item.style.fontSize = `${size}px`; });
    const formattingNode = range?.startContainer;
    const formattingElement = formattingNode instanceof Element ? formattingNode : formattingNode?.parentElement;
    const table = formattingElement?.closest('table');
    if (table) {
      releaseContentSizedRows(table, true);
      normalizeTableRowHeights(table);
      updateTableCaretOverlay();
      stabilizeTableCaret();
    }
    updateFontSizeControl(fontSelection?.rangeCount ? fontSelection.getRangeAt(0) : savedEditorRange);
    if (listItems.length) {
      scheduleSave();
      queueAutoPagination();
    }
    return true;
  }

  function insertHtml(html, atDocumentRoot = false) {
    focusEditor();
    if (atDocumentRoot) {
      const selection = window.getSelection();
      let anchor = selection?.anchorNode;
      while (anchor && anchor !== editor && anchor.parentNode !== editor) anchor = anchor.parentNode;
      const insertionPoint = anchor?.parentNode === editor ? anchor.nextSibling : null;
      const fragmentRange = document.createRange();
      fragmentRange.selectNodeContents(editor);
      editor.insertBefore(fragmentRange.createContextualFragment(html), insertionPoint);
    } else if (document.queryCommandSupported('insertHTML')) {
      document.execCommand('insertHTML', false, html);
    } else {
      editor.insertAdjacentHTML('beforeend', html);
    }
    scheduleSave();
    updateCounts();
  }

  function insertEditableTableElement(table) {
    const insertionRange = savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)
      ? savedEditorRange.cloneRange()
      : null;
    let anchor = insertionRange?.startContainer || null;
    while (anchor && anchor !== editor && anchor.parentNode !== editor) anchor = anchor.parentNode;
    if (anchor instanceof Element && anchor.matches('.document-header, .document-footer')) anchor = null;

    let insertionPoint = anchor?.parentNode === editor ? anchor.nextSibling : null;
    if (!anchor) {
      const pageBreaks = Array.from(editor.querySelectorAll(':scope > .page-break'));
      const pageIndex = Math.max(0, Math.min(pageBreaks.length, Number(verticalRuler.dataset.pageIndex) || 0));
      insertionPoint = pageBreaks[pageIndex] || editor.querySelector(':scope > .document-footer');
    }
    editor.insertBefore(table, insertionPoint);
    const spacer = document.createElement('p');
    spacer.append(document.createElement('br'));
    table.after(spacer);
    const spacerRange = document.createRange();
    spacerRange.selectNodeContents(spacer);
    spacerRange.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(spacerRange);
    savedEditorRange = spacerRange.cloneRange();
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertHTML' }));
    scheduleSave();
    updateCounts();

    const insertedTable = editor.querySelector('table[data-table-insertion-token]');
    if (insertedTable) insertedTable.removeAttribute('data-table-insertion-token');
    return insertedTable;
  }

  const keyboardToggle = document.getElementById('onscreen-keyboard-toggle');
  const mobileKeyboardToggle = document.getElementById('mobile-keyboard-toggle');
  const onscreenKeyboard = document.getElementById('onscreen-keyboard');
  let keyboardLayout = 'urdu';
  keyboardToggle.addEventListener('click', () => {
    const expanded = keyboardToggle.getAttribute('aria-expanded') !== 'true';
    keyboardToggle.setAttribute('aria-expanded', String(expanded));
    mobileKeyboardToggle.setAttribute('aria-pressed', String(expanded));
    onscreenKeyboard.hidden = !expanded;
    const keyboardSidebar = keyboardToggle.closest('.keyboard-sidebar');
    keyboardSidebar.classList.toggle('keyboard-open', expanded);
    document.body.classList.toggle('landscape-keyboard-open', expanded);
    document.documentElement.style.setProperty(
      '--mobile-keyboard-height',
      expanded && window.matchMedia('(max-width: 900px)').matches
        ? `${keyboardSidebar.offsetHeight}px`
        : '0px'
    );
    syncRulers();
    if (expanded) keepEditorCaretVisible();
  });
  mobileKeyboardToggle.addEventListener('click', () => keyboardToggle.click());
  document.getElementById('mobile-undo').addEventListener('click', () => undoButton.click());
  document.getElementById('mobile-redo').addEventListener('click', () => redoButton.click());
  document.getElementById('mobile-zoom-out').addEventListener('click', () => document.getElementById('status-zoom-out').click());
  document.getElementById('mobile-zoom-in').addEventListener('click', () => document.getElementById('status-zoom-in').click());
  const syncMobileViewport = () => {
    const viewport = window.visualViewport;
    document.documentElement.style.setProperty(
      '--visual-viewport-height',
      `${viewport ? viewport.height : window.innerHeight}px`
    );
    document.documentElement.style.setProperty(
      '--mobile-viewport-bottom',
      `${Math.max(0, window.innerHeight - (viewport ? viewport.height + viewport.offsetTop : window.innerHeight))}px`
    );
    const keyboardOpen = keyboardToggle.getAttribute('aria-expanded') === 'true';
    const sidebar = keyboardToggle.closest('.keyboard-sidebar');
    document.documentElement.style.setProperty(
      '--mobile-keyboard-height',
      keyboardOpen && window.matchMedia('(max-width: 900px)').matches
        ? `${sidebar.offsetHeight}px`
        : '0px'
    );
  };
  syncMobileViewport();
  window.addEventListener('resize', syncMobileViewport, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMobileViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', syncMobileViewport, { passive: true });
  }
  const keepEditorCaretVisible = () => {
    if (!window.matchMedia('(max-width: 900px)').matches) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const rangeRect = range?.getBoundingClientRect();
      const focusNode = selection?.focusNode;
      const focusElement = focusNode instanceof Element ? focusNode : focusNode?.parentElement;
      let target = rangeRect?.height ? rangeRect : null;
      if (!target && range && focusNode?.nodeType === Node.TEXT_NODE && focusNode.textContent.length) {
        const offset = selection.focusOffset;
        const characterRange = range.cloneRange();
        const characterStart = offset > 0 ? offset - 1 : 0;
        characterRange.setStart(focusNode, characterStart);
        characterRange.setEnd(focusNode, offset > 0 ? offset : 1);
        const characterRect = characterRange.getBoundingClientRect();
        if (characterRect.height) target = characterRect;
      }
      if (!target) {
        target = focusElement?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote')?.getBoundingClientRect() ||
          editor.getBoundingClientRect();
      }
      const workspace = document.querySelector('.document-workspace');
      const viewport = window.visualViewport;
      if (!workspace || !target) return;
      const visibleTop = viewport?.offsetTop || 0;
      const keyboard = keyboardToggle.getAttribute('aria-expanded') === 'true'
        ? keyboardToggle.closest('.keyboard-sidebar').offsetHeight
        : 0;
      const visibleBottom = visibleTop + (viewport?.height || window.innerHeight) -
        (document.getElementById('mobile-action-bar').offsetHeight || 64) - keyboard - 12;
      if (target.bottom > visibleBottom) {
        workspace.scrollBy({ top: target.bottom - visibleBottom + 16, behavior: 'smooth' });
      } else if (target.top < visibleTop + 8) {
        workspace.scrollBy({ top: target.top - visibleTop - 8, behavior: 'smooth' });
      }
    }, 120);
  };
  editor.addEventListener('focusin', keepEditorCaretVisible);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', keepEditorCaretVisible, { passive: true });
  document.querySelectorAll('[data-keyboard-layout]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const layout = tab.dataset.keyboardLayout;
      keyboardLayout = layout;
      document.querySelectorAll('[data-keyboard-layout]').forEach((item) => {
        item.setAttribute('aria-selected', String(item === tab));
      });
      document.querySelectorAll('[data-keyboard-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.keyboardPanel !== layout;
      });
    });
  });
  const phoneticKeyboard = document.getElementById('phonetic-keyboard');
  const physicalKeyboardRows = ['1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
  let phoneticShiftActive = false;
  let pendingHamza = false;
  let pendingHamzaRange = null;
  const phoneticShiftToggle = document.getElementById('phonetic-shift-toggle');
  const renderPhoneticKeyboard = () => {
    phoneticKeyboard.replaceChildren();
    physicalKeyboardRows.forEach((row) => {
      const rowElement = document.createElement('div');
      rowElement.className = 'phonetic-key-row';
      Array.from(row).forEach((character) => {
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'phonetic-key';
        key.dataset.physicalCharacter = character;
        const legend = document.createElement('span');
        const top = document.createElement('span');
        const main = document.createElement('span');
        legend.className = 'phonetic-key-legend';
        top.className = 'phonetic-key-shift-output';
        main.className = 'phonetic-key-main-output';
        legend.textContent = character === ',' ? ', <' : character === '.' ? '. >' : character;
        key.append(legend, top, main);
        rowElement.append(key);
      });
      phoneticKeyboard.append(rowElement);
    });
    updatePhoneticKeyLabels();
  };
  const updatePhoneticKeyLabels = () => {
    phoneticKeyboard.querySelectorAll('[data-physical-character]').forEach((key) => {
      const character = key.dataset.physicalCharacter;
      const normalOutput = UrduKeyboardLayout.mapCharacter(character);
      const shiftedOutput = UrduKeyboardLayout.mapCharacter(character, true);
      const visibleOutput = (output) => output === '\u0654' ? '\u25cc\u0654' : output;
      const activeOutput = phoneticShiftActive ? shiftedOutput : normalOutput;
      key.querySelector('.phonetic-key-main-output').textContent = visibleOutput(activeOutput);
      key.querySelector('.phonetic-key-shift-output').textContent =
        visibleOutput(phoneticShiftActive ? normalOutput : shiftedOutput);
      key.dataset.onscreenKey = activeOutput;
      key.classList.toggle('is-shifted', phoneticShiftActive);
      key.setAttribute('aria-label', activeOutput === '\u0654'
        ? `${character} inserts hamza above the next Urdu letter`
        : `${character} inserts ${activeOutput}`);
      key.title = `${character}: ${normalOutput}${shiftedOutput !== normalOutput ? ` / Shift: ${shiftedOutput}` : ''}`;
    });
  };
  renderPhoneticKeyboard();
  phoneticShiftToggle.addEventListener('click', () => {
    phoneticShiftActive = !phoneticShiftActive;
    phoneticShiftToggle.setAttribute('aria-pressed', String(phoneticShiftActive));
    phoneticShiftToggle.textContent = phoneticShiftActive ? 'Shift on' : 'Shift';
    updatePhoneticKeyLabels();
  });
  const insertKeyboardOutput = (output, editableTarget = null) => {
    const insertText = (text) => {
      if (!editableTarget) {
        const selection = window.getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
        const formatCaret = range && getFormatCaretSpan(range);
        if (selection && range?.collapsed && formatCaret) {
          let formattedRun = formatCaret.previousElementSibling;
          if (!formattedRun || formattedRun.tagName !== 'SPAN' ||
            formattedRun.nextSibling !== formatCaret ||
            formattedRun.style.cssText !== formatCaret.style.cssText) {
            formattedRun = document.createElement('span');
            formattedRun.style.cssText = formatCaret.style.cssText;
            formatCaret.before(formattedRun);
          }
          formattedRun.append(document.createTextNode(text));
          const nextCaret = formatCaret.cloneNode(false);
          nextCaret.textContent = '\u200b';
          formatCaret.replaceWith(nextCaret);
          const nextRange = document.createRange();
          nextRange.setStart(nextCaret.firstChild, 0);
          nextRange.collapse(true);
          selection.removeAllRanges();
          selection.addRange(nextRange);
          lastFormattedSpan = nextCaret;
          savedEditorRange = nextRange.cloneRange();
          editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text
          }));
          return;
        }
        document.execCommand('insertText', false, text);
        return;
      }
      const selection = window.getSelection();
      if (!selection) return;
      const range = selection.rangeCount &&
        editableTarget.contains(selection.anchorNode) &&
        editableTarget.contains(selection.focusNode)
        ? selection.getRangeAt(0)
        : document.createRange();
      if (!selection.rangeCount ||
        !editableTarget.contains(selection.anchorNode) ||
        !editableTarget.contains(selection.focusNode)) {
        const label = editableTarget.querySelector('[data-shape-label="true"]') || editableTarget;
        range.selectNodeContents(label);
        range.collapse(false);
      }
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      editableTarget.focus({ preventScroll: true });
      editableTarget.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      }));
    };
    if (output === '\u0654') {
      pendingHamza = false;
      pendingHamzaRange = null;
      insertText('\u0621');
      const selection = window.getSelection();
      if (selection?.isCollapsed) {
        selection.modify('extend', 'backward', 'character');
        if (selection.toString() === '\u0621') {
          pendingHamzaRange = selection.getRangeAt(0).cloneRange();
          selection.collapseToEnd();
        }
      }
      pendingHamza = true;
      return;
    }
    if (pendingHamza) {
      const selection = window.getSelection();
      const canComposeAtCaret = pendingHamzaRange &&
        pendingHamzaRange.toString() === '\u0621' &&
        selection?.isCollapsed &&
        selection.anchorNode === pendingHamzaRange.endContainer &&
        selection.anchorOffset === pendingHamzaRange.endOffset;
      pendingHamza = false;
      const hamzaRange = pendingHamzaRange;
      pendingHamzaRange = null;
      const characters = Array.from(output);
      if (canComposeAtCaret && characters[0] &&
        /^\p{L}$/u.test(characters[0]) && /[\u0600-\u08ff]/u.test(characters[0])) {
        const base = characters[0] === '\u06cc'
          ? '\u0626'
          : (characters[0] + '\u0654').normalize('NFC');
        output = `${base}${characters.slice(1).join('')}`;
        selection.removeAllRanges();
        selection.addRange(hamzaRange);
      } else {
        pendingHamza = false;
      }
    }
    insertText(output);
  };
  document.querySelector('.keyboard-sidebar').addEventListener('pointerdown', rememberEditorSelection, true);
  document.querySelectorAll('[data-onscreen-key]').forEach((button) => {
    button.addEventListener('click', () => {
      focusEditor();
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const key = button.dataset.physicalCharacter
        ? UrduKeyboardLayout.mapCharacter(button.dataset.physicalCharacter, phoneticShiftActive)
        : button.dataset.onscreenKey;
      if (button.dataset.physicalCharacter && phoneticShiftActive) {
        phoneticShiftActive = false;
        phoneticShiftToggle.setAttribute('aria-pressed', 'false');
        phoneticShiftToggle.textContent = 'Shift';
        updatePhoneticKeyLabels();
      }
      if (key === 'Backspace') {
        if (pendingHamza) {
          const canDeleteHamza = pendingHamzaRange?.toString() === '\u0621' &&
            selection.isCollapsed &&
            selection.anchorNode === pendingHamzaRange.endContainer &&
            selection.anchorOffset === pendingHamzaRange.endOffset;
          const hamzaRange = pendingHamzaRange;
          pendingHamza = false;
          pendingHamzaRange = null;
          if (canDeleteHamza) {
            selection.removeAllRanges();
            selection.addRange(hamzaRange);
            document.execCommand('delete');
          } else {
            if (selection.isCollapsed) selection.modify('extend', 'backward', 'character');
            document.execCommand('delete');
          }
        } else {
          if (selection.isCollapsed) selection.modify('extend', 'backward', 'character');
          document.execCommand('delete');
        }
      } else if (key === 'Enter') {
        document.execCommand('insertParagraph');
      } else {
        const wasUrduTyping = urduTyping;
        if (keyboardLayout === 'symbols') urduTyping = false;
        try {
          insertKeyboardOutput(key);
        } finally {
          urduTyping = wasUrduTyping;
        }
      }
      rememberEditorSelection();
      scheduleSave();
      updateCounts();
    });
  });

  function downloadFile(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function safeFilename(extension) {
    const base = (nameInput.value.trim() || 'urdu-document')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 70);
    return `${base || 'urdu-document'}.${extension}`;
  }

  function historyLabelForCommand(command) {
    const labels = {
      bold: 'Applied Bold',
      italic: 'Applied Italic',
      underline: 'Applied Underline',
      fontName: 'Changed Font',
      foreColor: 'Changed Font Color',
      hiliteColor: 'Highlighted Text',
      insertUnorderedList: 'Applied Bullets',
      insertOrderedList: 'Applied Numbering',
      justifyLeft: 'Aligned Text Left',
      justifyCenter: 'Centered Text',
      justifyRight: 'Aligned Text Right',
      justifyFull: 'Justified Text'
    };
    return labels[command] || `Applied ${command.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
  }

  function historyLabelForTableDrag(kind, index) {
    if (kind === 'column') return `Resized Column ${index + 1}`;
    if (kind === 'row') return `Resized Row ${index + 1}`;
    if (kind === 'move') return 'Moved Table';
    if (kind === 'left-edge' || kind === 'right-edge') return 'Resized Table';
    if (kind === 'row-reorder') return 'Reordered Rows';
    if (kind === 'column-reorder') return 'Reordered Columns';
    return 'Edited Table';
  }

  function historyGroupForControl(control) {
    if (control === nameInput) return 'document-name';
    if (control instanceof HTMLInputElement &&
      ['color', 'number', 'range', 'search', 'text'].includes(control.type)) {
      return `control:${control.id || control.type}`;
    }
    if (control instanceof HTMLTextAreaElement) return `control:${control.id || 'text-area'}`;
    return null;
  }

  function clearCollapsedInlineFormat(command) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
    return setCollapsedInlineFormat(command, false);
  }

  function isUnderlineFormattingElement(element) {
    if (element.tagName === 'U' || element.tagName === 'INS' || element.tagName === 'A') return true;
    return /\bunderline\b/i.test(
      `${element.style.textDecoration} ${element.style.textDecorationLine}`
    );
  }

  function splitInlineElementAtCaret(element, caret) {
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(element);
    beforeRange.setEndBefore(caret);
    const before = beforeRange.extractContents();

    const afterRange = document.createRange();
    afterRange.selectNodeContents(element);
    afterRange.setStartAfter(caret);
    const after = afterRange.extractContents();

    const replacements = [];
    if (before.hasChildNodes()) {
      const beforeElement = element.cloneNode(false);
      beforeElement.removeAttribute('id');
      beforeElement.append(before);
      replacements.push(beforeElement);
    }
    replacements.push(caret);
    if (after.hasChildNodes()) {
      const afterElement = element.cloneNode(false);
      afterElement.removeAttribute('id');
      afterElement.append(after);
      replacements.push(afterElement);
    }
    element.replaceWith(...replacements);
  }

  function removeUnderlineFromCaret(caret) {
    let underlineElement = caret.parentElement;
    while (underlineElement && underlineElement !== editor &&
      !isUnderlineFormattingElement(underlineElement)) {
      underlineElement = underlineElement.parentElement;
    }
    if (!underlineElement || underlineElement === editor) return;

    const computedStyle = getComputedStyle(caret);
    for (const property of ['font-weight', 'font-style', 'font-family', 'font-size', 'color']) {
      caret.style.setProperty(property, computedStyle.getPropertyValue(property));
    }

    let element = caret.parentElement;
    while (element && element !== editor) {
      const parent = element.parentElement;
      splitInlineElementAtCaret(element, caret);
      if (element === underlineElement) break;
      element = parent;
    }
  }

  function setCollapsedInlineFormat(command, active) {
    const formatStyles = {
      bold: ['font-weight', '700', 'normal'],
      italic: ['font-style', 'italic', 'normal'],
      underline: ['text-decoration', 'underline', 'none']
    };
    const style = formatStyles[command];
    const selection = window.getSelection();
    if (!style || !selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return false;

    let caret = getFormatCaretSpan(range);
    if (!caret) {
      caret = document.createElement('span');
      caret.dataset.formatCaret = 'true';
      caret.textContent = '\u200b';
      range.insertNode(caret);
    }
    if (command === 'underline' && !active) removeUnderlineFromCaret(caret);
    caret.style.setProperty(style[0], active ? style[1] : style[2]);

    const nextRange = document.createRange();
    nextRange.setStart(caret.firstChild, 0);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    savedEditorRange = nextRange.cloneRange();
    lastFormattedSpan = caret;
    updateTextFormatButtons();
    return true;
  }

  function toggleCollapsedInlineFormat(command) {
    if (!['bold', 'italic', 'underline'].includes(command)) return false;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed || !editor.contains(selection.anchorNode)) return false;
    const alreadyActive = getCollapsedInlineFormatState(command);
    if (alreadyActive) {
      clearCollapsedInlineFormat(command);
      return true;
    }
    return setCollapsedInlineFormat(command, true);
  }

  function runCommand(command, value = null) {
    focusEditor();
    let selection = window.getSelection();
    if (['bold', 'italic', 'underline'].includes(command) && selection?.isCollapsed &&
      selection.rangeCount && editor.contains(selection.anchorNode) &&
      toggleCollapsedInlineFormat(command)) {
      scheduleSave();
      updateCounts();
      queueAutoPagination();
      return;
    }
    if (selection && selection.isCollapsed && lastFormattedSpan && editor.contains(lastFormattedSpan) &&
      ['bold', 'italic', 'underline', 'fontName', 'foreColor', 'hiliteColor'].includes(command)) {
      const caret = selection.rangeCount ? getFormatCaretSpan(selection.getRangeAt(0)) : null;
      if (!caret) {
        const range = document.createRange();
        range.selectNodeContents(lastFormattedSpan);
        selection.removeAllRanges();
        selection.addRange(range);
        savedEditorRange = range.cloneRange();
      }
    }
    selection = window.getSelection();
    const currentRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (command === 'italic' && currentRange && !currentRange.collapsed) {
      applyEnglishItalic(currentRange);
      updateTextFormatButtons();
      scheduleSave(historyLabelForCommand(command));
      queueAutoPagination();
      return;
    }
    document.execCommand(command, false, value);
    if (command === 'hiliteColor' && currentRange && !currentRange.collapsed &&
      typeof value === 'string') {
      editor.querySelectorAll('span[style*="background-color"]').forEach((span) => {
        if (!currentRange.intersectsNode(span)) return;
        if (value === 'transparent') span.style.removeProperty('--text-highlight-color');
        else span.style.setProperty('--text-highlight-color', span.style.backgroundColor);
      });
    }
    if (['foreColor', 'removeFormat'].includes(command)) {
      const startNode = currentRange?.startContainer;
      const startElement = startNode instanceof Element ? startNode : startNode?.parentElement;
      const listItems = currentRange && !currentRange.collapsed
        ? Array.from(editor.querySelectorAll('li')).filter((item) => currentRange.intersectsNode(item))
        : [startElement?.closest('li')].filter((item) => item && editor.contains(item));
      listItems.forEach((item) => {
        if (command === 'foreColor' && typeof value === 'string' && CSS.supports('color', value)) {
          item.style.color = value;
        } else {
          item.style.removeProperty('color');
        }
      });
    }
    if (['bold', 'italic', 'underline', 'fontName', 'foreColor', 'hiliteColor'].includes(command)) {
      preserveSelectedRange(currentRange);
    }
    updateTextFormatButtons();
    scheduleSave(historyLabelForCommand(command));
    updateCounts();
    queueAutoPagination();
  }

  function getHistoryInputAction(event) {
    const inputType = event.inputType || '';
    if (inputType === 'insertText' || inputType === 'insertCompositionText') {
      return { action: 'Typed Text', groupKey: 'typing' };
    }
    if (inputType.startsWith('delete')) {
      return { action: 'Deleted Text', groupKey: 'deleting' };
    }
    if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') {
      return { action: inputType === 'insertFromPaste' ? 'Pasted Content' : 'Dropped Content' };
    }
    if (inputType === 'insertParagraph' || inputType === 'insertLineBreak') {
      return { action: 'Inserted Paragraph' };
    }
    if (inputType === 'insertTable') return { action: 'Inserted Table' };
    if (inputType.startsWith('format')) return { action: 'Formatted Text' };
    return { action: 'Edited Document' };
  }

  function historyNodePath(root, node) {
    if (!(node instanceof Node) || (node !== root && !root.contains(node))) return null;
    const path = [];
    while (node !== root) {
      const parent = node.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }
    return path;
  }

  function historyNodeAtPath(root, path) {
    let node = root;
    for (const index of path || []) {
      node = node.childNodes[index];
      if (!node) return null;
    }
    return node;
  }

  function captureHistorySelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const anchorPath = historyNodePath(editor, selection.anchorNode);
    const focusPath = historyNodePath(editor, selection.focusNode);
    if (!anchorPath || !focusPath) return null;
    return {
      anchorPath,
      anchorOffset: selection.anchorOffset,
      focusPath,
      focusOffset: selection.focusOffset
    };
  }

  function captureHistoryState() {
    const snapshot = editor.cloneNode(true);
    snapshot.querySelectorAll(
      '.table-caret-target, .table-band-selected, .image-selected, .image-crop-active, ' +
      '.shape-selected, .watermark-selected, .selected-object'
    ).forEach((element) => {
      element.classList.remove(
        'table-caret-target', 'table-band-selected', 'image-selected', 'image-crop-active',
        'shape-selected', 'watermark-selected', 'selected-object'
      );
    });
    snapshot.querySelectorAll('[class=""]').forEach((element) => element.removeAttribute('class'));
    return {
      html: snapshot.innerHTML,
      name: nameInput.value,
      alignmentGuides: JSON.parse(JSON.stringify(alignmentGuides)),
      pageBorderStyle,
      pageBorderColor,
      pageColor,
      selection: captureHistorySelection()
    };
  }

  function restoreHistoryState(state) {
    isRestoringHistory = true;
    try {
      editor.innerHTML = state.html;
      nameInput.value = state.name;
      alignmentGuides = JSON.parse(JSON.stringify(state.alignmentGuides || []));
      pageBorderStyle = state.pageBorderStyle;
      pageBorderColor = state.pageBorderColor;
      pageColor = /^#[\da-f]{6}$/i.test(state.pageColor || '') ? state.pageColor : '#ffffff';
      applyPageBorder();
      document.getElementById('page-border-color-input').value = pageBorderColor;
      applyPageColor();
      syncDocumentHeaderSpacing();
      renderAlignmentGuides();

      editor.querySelectorAll(
        '.table-caret-target, .table-band-selected, .image-selected, .image-crop-active, ' +
        '.shape-selected, .watermark-selected, .selected-object'
      ).forEach((element) => {
        element.classList.remove(
          'table-caret-target', 'table-band-selected', 'image-selected', 'image-crop-active',
          'shape-selected', 'watermark-selected', 'selected-object'
        );
      });
      selectedTableBand = null;
      activeImage = null;
      imageCropMode = false;
      pictureFormatTab.hidden = true;
      if (pictureFormatTab.classList.contains('active') || shapeFormatTab.classList.contains('active') ||
        textboxFormatTab.classList.contains('active')) {
        activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
      }
      activeShape = null;
      activeTableCell = null;
      activeCaretTableCell = null;
      activeTable = null;
      activeWatermark = null;
      selectedObject = null;
      updateTableToolbar(null);
      imageToolbar.hidden = true;
      hideShapeFormatTabs();
      shapeToolbar.hidden = true;
      watermarkToolbar.hidden = true;
      imageManipulators.replaceChildren();
      shapeManipulators.replaceChildren();
      watermarkManipulators.replaceChildren();
      tableCaretOverlay.hidden = true;

      editor.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const anchor = state.selection && historyNodeAtPath(editor, state.selection.anchorPath);
        const focus = state.selection && historyNodeAtPath(editor, state.selection.focusPath);
        if (anchor && focus && typeof selection.setBaseAndExtent === 'function') {
          const anchorLimit = anchor.nodeType === Node.TEXT_NODE
            ? anchor.textContent.length
            : anchor.childNodes.length;
          const focusLimit = focus.nodeType === Node.TEXT_NODE
            ? focus.textContent.length
            : focus.childNodes.length;
          selection.setBaseAndExtent(
            anchor,
            Math.min(state.selection.anchorOffset, anchorLimit),
            focus,
            Math.min(state.selection.focusOffset, focusLimit)
          );
        } else {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.addRange(range);
        }
      }
      savedEditorRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      lastFormattedSpan = null;
      updateCounts(false);
      syncRulers();
      queueAutoPagination();
      scheduleSave('', null, false);
    } finally {
      isRestoringHistory = false;
    }
  }

  function historyLabelForControl(control) {
    if (!control) return '';
    if (control.dataset.command) return historyLabelForCommand(control.dataset.command);
    const tableActionLabels = {
      'row-above': 'Inserted Row Above',
      'row-below': 'Inserted Row Below',
      'column-left': 'Inserted Column Left',
      'column-right': 'Inserted Column Right',
      'delete-row': 'Deleted Row',
      'delete-column': 'Deleted Column',
      'delete-table': 'Deleted Table',
      'merge-cells': 'Merged Cells',
      'split-cell': 'Split Cell',
      'distribute-columns': 'Distributed Columns',
      'distribute-rows': 'Distributed Rows',
      'shade-cell': 'Changed Cell Color'
    };
    if (tableActionLabels[control.dataset.tableAction]) {
      return tableActionLabels[control.dataset.tableAction];
    }
    const label = control.getAttribute('aria-label') || control.title ||
      control.closest('label')?.textContent || control.textContent || control.id || '';
    const words = label.replace(/\s+/g, ' ').trim().replace(/[↶↷▾＋+]/g, '').trim();
    if (!words) return '';
    const verb = /^(add|insert|delete|remove|resize|move|change|set|apply|format|merge|split|align|distribute|shade|fit|clear|rotate|crop|replace|upload|download|print)\b/i.exec(words);
    const pastTense = {
      add: 'Added', insert: 'Inserted', delete: 'Deleted', remove: 'Removed',
      resize: 'Resized', move: 'Moved', change: 'Changed', set: 'Changed',
      apply: 'Applied', format: 'Formatted', merge: 'Merged', split: 'Split',
      align: 'Aligned', distribute: 'Distributed', shade: 'Changed',
      fit: 'Fit', clear: 'Cleared', rotate: 'Rotated', crop: 'Cropped',
      replace: 'Replaced', upload: 'Uploaded', download: 'Downloaded', print: 'Printed'
    };
    return verb ? `${pastTense[verb[1].toLowerCase()]}${words.slice(verb[0].length)}` : `Changed ${words}`;
  }

  function historyNavigation(method, count = 1) {
    if (!documentHistoryManager) return Promise.resolve(0);
    flushHistoryCheckpoint();
    return documentHistoryManager[method](count).catch((error) => {
      console.error(`Could not ${method === 'undoSteps' ? 'undo' : 'redo'} document changes.`, error);
      showToast(`Could not ${method === 'undoSteps' ? 'undo' : 'redo'} the document change.`);
      return 0;
    });
  }

  document.addEventListener('click', (event) => {
    const control = event.target instanceof Element
      ? event.target.closest('button, [role="button"]')
      : null;
    if (!control || ['undo-button', 'redo-button'].includes(control.id)) return;
    setPendingHistoryAction(historyLabelForControl(control));
  }, true);
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const grip = target.closest('[data-grip-kind]');
    const kind = grip?.dataset.gripKind;
    const shapeMove = target.closest('[data-shape-move-handle]');
    const shapeResize = target.closest('[data-shape-resize-x]');
    const shapeRotate = target.closest('[data-shape-rotate-handle]');
    const watermarkRotate = target.closest('[data-watermark-rotate-handle]');
    const watermarkResize = target.closest('[data-watermark-resize-handle]');
    const imageResize = target.closest('[data-resize-corner]');
    const image = target.closest('img[data-image-wrap="free"]');
    const label = kind
      ? historyLabelForTableDrag(kind, Number(grip.dataset.gripIndex))
      : shapeMove ? 'Moved Shape'
        : shapeResize ? 'Resized Shape'
          : shapeRotate ? 'Rotated Shape'
            : watermarkRotate ? 'Rotated Watermark'
              : watermarkResize ? 'Resized Watermark'
                : imageResize ? 'Resized Picture'
                  : target.closest('.image-rotate-handle') ? 'Rotated Picture'
                    : image ? 'Moved Picture'
                      : '';
    if (!label) return;
    activePointerHistoryAction = { pointerId: event.pointerId, action: label };
    setPendingHistoryAction(label);
  }, true);
  ['pointerup', 'pointercancel'].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      if (activePointerHistoryAction?.pointerId !== event.pointerId) return;
      setPendingHistoryAction(activePointerHistoryAction.action);
      activePointerHistoryAction = null;
    }, true);
  });
  document.addEventListener('input', (event) => {
    if (event.target === editor || (event.target instanceof Node && editor.contains(event.target))) {
      const { action, groupKey } = getHistoryInputAction(event);
      setPendingHistoryAction(action, groupKey || null);
      return;
    }
    if (event.target === nameInput) {
      setPendingHistoryAction('Renamed Document', 'document-name');
      return;
    }
    const control = event.target instanceof Element ? event.target : null;
    if (control) {
      setPendingHistoryAction(historyLabelForControl(control), historyGroupForControl(control));
    }
  }, true);
  document.addEventListener('change', (event) => {
    const control = event.target instanceof Element ? event.target : null;
    if (control && control !== nameInput && !editor.contains(control)) {
      setPendingHistoryAction(historyLabelForControl(control), historyGroupForControl(control));
    }
  }, true);
  document.addEventListener('paste', () => {
    setPendingHistoryAction('Pasted Content');
  }, true);
  document.addEventListener('drop', () => {
    setPendingHistoryAction('Dropped Content');
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!editor.contains(event.target)) return;
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const method = key === 'z' && event.shiftKey ? 'redoSteps'
      : key === 'z' ? 'undoSteps'
        : key === 'y' && !event.shiftKey ? 'redoSteps'
          : null;
    if (!method) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void historyNavigation(method);
  }, true);
  editor.addEventListener('beforeinput', (event) => {
    const method = event.inputType === 'historyUndo' ? 'undoSteps'
      : event.inputType === 'historyRedo' ? 'redoSteps'
        : null;
    if (!method) return;
    event.preventDefault();
    void historyNavigation(method);
  });

  editor.addEventListener('input', (event) => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const table = anchorElement?.closest('table');
    if (table) {
      releaseContentSizedRows(table);
      normalizeTableRowHeights(table);
      updateTableCaretOverlay();
      if (activeTable === table) refreshTableManipulators(table);
    }
    editor.querySelectorAll('p[style*="background-color"], li[style*="background-color"], h1[style*="background-color"], h2[style*="background-color"], h3[style*="background-color"], h4[style*="background-color"], h5[style*="background-color"], h6[style*="background-color"], blockquote[style*="background-color"], div[style*="background-color"]').forEach((block) => {
      if (block.closest('[data-document-region], .editor-shape, .editor-textbox, [contenteditable="false"]') ||
        block.textContent.replace(/[\s\u200b\ufeff]/g, '') ||
        block.querySelector('img, table, .editor-shape, .editor-textbox, [data-watermark]')) return;
      block.style.removeProperty('background-color');
    });
    const inputElement = event.target instanceof Element ? event.target : event.target.parentElement;
    const selectionElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const isEditingObjectText = inputElement?.closest('.editor-textbox, .editor-shape[contenteditable="true"]') ||
      selectionElement?.closest('.editor-textbox, .editor-shape[contenteditable="true"]');
    if (!isEditingObjectText && restoreBodyCaret()) window.requestAnimationFrame(restoreBodyCaret);
    scheduleSave();
    queueAutoPagination();
    updateWordSuggestions();
  });
  editor.addEventListener('keydown', (event) => {
    const eventElement = event.target instanceof Element ? event.target : event.target.parentElement;
    const isEditingObjectText = eventElement?.closest('.editor-textbox, .editor-shape[contenteditable="true"]');
    if (!isEditingObjectText) restoreBodyCaret();
    const selection = window.getSelection();
    const selectionElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    const documentRegion = eventElement?.closest('[data-document-region]') ||
      selectionElement?.closest('[data-document-region]');
    const textBox = eventElement?.closest('.editor-textbox') ||
      selectionElement?.closest('.editor-textbox');
    const editableShape = eventElement?.closest('.editor-shape[contenteditable="true"]') ||
      selectionElement?.closest('.editor-shape[contenteditable="true"]');
    if (event.key === 'Backspace' && selection?.isCollapsed) {
      const listItem = selectionElement?.closest('li');
      const list = listItem?.parentElement;
      if (listItem && list && editor.contains(listItem) &&
        !listItem.textContent.replace(/[\s\u200b\ufeff]/g, '') &&
        !listItem.querySelector('img, table, ul, ol, .editor-shape, [data-watermark]')) {
        event.preventDefault();
        const trailingList = list.cloneNode(false);
        let nextItem = listItem.nextElementSibling;
        while (nextItem) {
          const followingItem = nextItem.nextElementSibling;
          trailingList.append(nextItem);
          nextItem = followingItem;
        }
        listItem.remove();
        const paragraph = document.createElement('p');
        paragraph.append(document.createElement('br'));
        if (list.children.length) {
          list.after(paragraph);
          if (trailingList.children.length) paragraph.after(trailingList);
        } else {
          list.replaceWith(paragraph);
          if (trailingList.children.length) paragraph.after(trailingList);
        }
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        scheduleSave();
        queueAutoPagination();
        updateCounts();
        return;
      }
    }
    if (!documentRegion && !textBox && !editableShape && selection?.rangeCount &&
      ['Backspace', 'Delete'].includes(event.key)) {
      const range = selection.getRangeAt(0);
      const crossesDocumentRegion = Array.from(editor.querySelectorAll('[data-document-region]'))
        .some((region) => range.intersectsNode(region));
      if (crossesDocumentRegion || (event.key === 'Backspace' && range.collapsed && isAtStartOfBody(range))) {
        event.preventDefault();
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      const range = document.createRange();
      if (textBox || editableShape) {
        range.selectNodeContents(textBox || editableShape);
      } else if (documentRegion) {
        range.selectNodeContents(documentRegion);
      } else {
        const bodyNodes = Array.from(editor.childNodes).filter((node) =>
          !(node instanceof Element && node.matches('.document-header, .document-footer')));
        if (!bodyNodes.length) return;
        range.setStartBefore(bodyNodes[0]);
        range.setEndAfter(bodyNodes[bodyNodes.length - 1]);
      }
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      savedEditorRange = range.cloneRange();
      return;
    }
    if (!wordSuggestions.hidden) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveWordSuggestionSelection(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        acceptWordSuggestion();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        hideWordSuggestions();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) hideWordSuggestions();
    }
    if (pendingHamza && event.key === 'Backspace') {
      const selection = window.getSelection();
      const canDeleteHamza = pendingHamzaRange?.toString() === '\u0621' &&
        selection?.isCollapsed &&
        selection.anchorNode === pendingHamzaRange.endContainer &&
        selection.anchorOffset === pendingHamzaRange.endOffset;
      const hamzaRange = pendingHamzaRange;
      pendingHamza = false;
      pendingHamzaRange = null;
      if (canDeleteHamza) {
        selection.removeAllRanges();
        selection.addRange(hamzaRange);
        document.execCommand('delete');
        event.preventDefault();
        return;
      }
    }
    if (pendingHamza && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key) &&
      event.key.length !== 1) {
      pendingHamza = false;
      pendingHamzaRange = null;
    }
    if (!urduTyping || event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
      event.key.length !== 1) return;
    const output = UrduKeyboardLayout.mapKey(event);
    if (output === event.key && !pendingHamza) return;
    event.preventDefault();
    insertKeyboardOutput(output, editableShape);
  });
  editor.addEventListener('blur', hideWordSuggestions);
  editor.addEventListener('paste', (event) => {
    const html = event.clipboardData && event.clipboardData.getData('text/html');
    if (!html) return;
    event.preventDefault();
    insertHtml(sanitizeDocumentHtml(html));
  });
  nameInput.addEventListener('input', scheduleSave);
  restoreDocument();
  const undoButton = document.getElementById('undo-button');
  const redoButton = document.getElementById('redo-button');
  documentHistoryManager = new window.WordStyleHistoryManager({
    captureState: captureHistoryState,
    restoreState: restoreHistoryState,
    maxHistory: 100,
    groupingWindow: 900,
    getStateKey: (state) => JSON.stringify({
      html: state.html,
      name: state.name,
      alignmentGuides: state.alignmentGuides,
      pageBorderStyle: state.pageBorderStyle,
      pageBorderColor: state.pageBorderColor,
      pageColor: state.pageColor
    }),
    onStateChange: (state) => {
      undoButton.disabled = !state.canUndo;
      redoButton.disabled = !state.canRedo;
      document.getElementById('mobile-undo').disabled = !state.canUndo;
      document.getElementById('mobile-redo').disabled = !state.canRedo;
      undoButton.dataset.historyCount = String(state.undoCount);
      redoButton.dataset.historyCount = String(state.redoCount);
      undoButton.title = state.canUndo
        ? `Undo (Ctrl+Z) — ${state.undoCount} action${state.undoCount === 1 ? '' : 's'} available${state.nextUndoAction ? `; next: ${state.nextUndoAction}` : ''}`
        : 'Undo (Ctrl+Z)';
      redoButton.title = state.canRedo
        ? `Redo (Ctrl+Y) — ${state.redoCount} action${state.redoCount === 1 ? '' : 's'} available${state.nextRedoAction ? `; next: ${state.nextRedoAction}` : ''}`
        : 'Redo (Ctrl+Y)';
    }
  });
  window.documentHistoryManager = documentHistoryManager;
  window.wordStyleHistoryManager = documentHistoryManager;
  documentHistoryManager.initialize();
  editor.querySelectorAll('.table-caret-target').forEach((cell) => {
    cell.classList.remove('table-caret-target');
  });
  savedEditorRange = document.createRange();
  savedEditorRange.selectNodeContents(editor);
  savedEditorRange.collapse(false);
  updateCounts();
  queueAutoPagination();

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      runCommand(button.dataset.command);
    });
  });
  undoButton.addEventListener('click', () => { void historyNavigation('undoSteps'); });
  redoButton.addEventListener('click', () => { void historyNavigation('redoSteps'); });
  document.getElementById('copy-button').addEventListener('click', () => {
    focusEditor();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      showToast('Select text in the document before copying.');
      return;
    }
    if (!document.execCommand('copy')) showToast('Copy was blocked by the browser. Use Ctrl+C instead.');
  });
  document.getElementById('cut-button').addEventListener('click', () => {
    focusEditor();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      showToast('Select text in the document before cutting.');
      return;
    }
    if (!document.execCommand('cut')) showToast('Cut was blocked by the browser. Use Ctrl+X instead.');
    scheduleSave();
    updateCounts();
  });
  document.getElementById('paste-button').addEventListener('click', async () => {
    focusEditor();
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      showToast('Clipboard access is unavailable. Use Ctrl+V to paste.');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        showToast('The clipboard has no plain text to paste.');
        return;
      }
      runCommand('insertText', text);
    } catch (error) {
      showToast('The browser blocked clipboard access. Use Ctrl+V to paste.');
      console.warn('Could not read text from the clipboard.', error);
    }
  });
  const fontFamilySelect = document.getElementById('font-family');
  const fontFamilyPreview = document.getElementById('font-family-preview');
  const fontMeasureContext = document.createElement('canvas').getContext('2d');
  const updateFontFamilyPreview = () => {
    const fontName = fontNames[fontFamilySelect.selectedIndex];
    const previewText = `${fontName} — اردو`;
    fontFamilyPreview.textContent = previewText;
    fontFamilySelect.title = previewText;
    fontFamilyPreview.style.fontFamily = fontFamilySelect.value;
    fontMeasureContext.font = `11px ${fontFamilySelect.value}`;
    const contentWidth = fontMeasureContext.measureText(previewText).width;
    fontFamilySelect.style.width = `${Math.ceil(Math.min(230, Math.max(120, contentWidth + 34)))}px`;
  };
  fontFamilySelect.addEventListener('change', (event) => {
    event.currentTarget.style.fontFamily = event.currentTarget.value;
    updateFontFamilyPreview();
    runCommand('fontName', event.target.value);
  });
  Array.from(fontFamilySelect.options).forEach((option, index) => {
    const family = fontFamilies[index];
    option.textContent = `${fontNames[index]} — اردو`;
    option.style.fontFamily = family;
    option.style.fontSize = '11px';
  });
  fontFamilySelect.style.fontFamily = fontFamilySelect.value;
  updateFontFamilyPreview();

  const fontSizeInput = document.getElementById('font-size');
  const fontSizeToggle = document.getElementById('font-size-toggle');
  const fontSizeMenu = document.getElementById('font-size-menu');
  fontSizeInput.addEventListener('focus', () => {
    const selection = window.getSelection();
    const range = savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)
      ? savedEditorRange
      : selection?.rangeCount && editor.contains(selection.anchorNode)
        ? selection.getRangeAt(0)
        : null;
    updateFontSizeControl(range, true);
    setFontSizeSelectionHighlight(range);
  });
  fontSizeInput.addEventListener('input', () => {
    if (!fontSizeInput.value.trim()) return;
    const size = Number(fontSizeInput.value);
    if (Number.isFinite(size) && size >= 6 && size <= 1000) fontSizeInput.setCustomValidity('');
  });
  fontSizeInput.addEventListener('blur', () => {
    setFontSizeSelectionHighlight(null);
    updateFontSizeControl();
  });
  const closeFontSizeMenu = () => {
    fontSizeMenu.hidden = true;
    fontSizeToggle.setAttribute('aria-expanded', 'false');
  };
  const positionFontSizeMenu = () => {
    const toggleBounds = fontSizeToggle.getBoundingClientRect();
    const menuWidth = fontSizeMenu.offsetWidth;
    const menuHeight = fontSizeMenu.offsetHeight;
    const left = Math.max(4, Math.min(toggleBounds.left, window.innerWidth - menuWidth - 4));
    const top = toggleBounds.bottom + menuHeight + 4 <= window.innerHeight
      ? toggleBounds.bottom + 4
      : Math.max(4, toggleBounds.top - menuHeight - 4);
    fontSizeMenu.style.left = `${left}px`;
    fontSizeMenu.style.top = `${top}px`;
  };
  document.body.appendChild(fontSizeMenu);
  fontSizeInput.addEventListener('change', () => applyFontSize(fontSizeInput));
  fontSizeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (applyFontSize(fontSizeInput)) {
        focusEditor();
        fontSizeInput.blur();
      }
    } else if (event.key === 'Escape') {
      closeFontSizeMenu();
      fontSizeInput.blur();
    }
  });
  fontSizeToggle.addEventListener('pointerdown', (event) => event.preventDefault());
  fontSizeToggle.addEventListener('click', () => {
    const isOpening = fontSizeMenu.hidden;
    fontSizeMenu.hidden = !isOpening;
    fontSizeToggle.setAttribute('aria-expanded', String(isOpening));
    if (isOpening) positionFontSizeMenu();
  });
  fontSizeMenu.querySelectorAll('[data-font-size]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      fontSizeInput.value = button.dataset.fontSize;
      applyFontSize(fontSizeInput);
      closeFontSizeMenu();
      focusEditor();
    });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.font-size-control') && !fontSizeMenu.contains(event.target)) closeFontSizeMenu();
  });
  window.addEventListener('resize', () => {
    if (!fontSizeMenu.hidden) positionFontSizeMenu();
  });
  document.querySelector('.ribbon').addEventListener('scroll', () => {
    if (!fontSizeMenu.hidden) positionFontSizeMenu();
  });
  document.querySelectorAll('[data-size-step]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const presets = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
      const current = Number(fontSizeInput.value) || 12;
      const next = button.dataset.sizeStep === '1'
        ? presets.find((preset) => preset > current) || Math.min(1000, current + 1)
        : [...presets].reverse().find((preset) => preset < current) || Math.max(6, current - 1);
      fontSizeInput.value = String(next);
      applyFontSize(fontSizeInput);
    });
  });
  const paragraphMenus = {
    bullets: document.getElementById('bullet-menu'),
    numbering: document.getElementById('numbering-menu'),
    spacing: document.getElementById('spacing-menu'),
    underline: document.getElementById('underline-menu')
  };
  Object.values(paragraphMenus).forEach((menu) => document.body.appendChild(menu));
  const lineSpacingPreview = new Map();
  const clearLineSpacingPreview = () => {
    lineSpacingPreview.forEach((previousValue, paragraph) => {
      if (previousValue.value) paragraph.style.setProperty('line-height', previousValue.value, previousValue.priority);
      else paragraph.style.removeProperty('line-height');
    });
    lineSpacingPreview.clear();
  };
  const closeParagraphMenus = () => {
    clearLineSpacingPreview();
    Object.values(paragraphMenus).forEach((menu) => {
      menu.hidden = true;
    });
    document.querySelectorAll('[data-list-menu]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
  };
  const positionParagraphMenu = (menu, trigger) => {
    const bounds = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(bounds.left, window.innerWidth - width - 4))}px`;
    menu.style.top = `${bounds.bottom + height + 4 <= window.innerHeight
      ? bounds.bottom + 4
      : Math.max(4, bounds.top - height - 4)}px`;
  };
  const selectedParagraphs = (restoreFocus = true) => {
    if (restoreFocus) focusEditor();
    const selection = window.getSelection();
    const range = selection?.rangeCount && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)
        ? savedEditorRange
        : null;
    if (!range) return [editor.querySelector('p') || editor];
    const startElement = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    if (startElement?.closest('[data-document-region]')) return [];
    const blocks = new Set();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return /^(P|LI|H[1-6]|BLOCKQUOTE|DIV)$/.test(node.tagName) &&
          !node.closest('[data-document-region]') && range.intersectsNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) {
      const block = walker.currentNode;
      if (!Array.from(block.children).some((child) => /^(P|LI|H[1-6]|BLOCKQUOTE|DIV)$/.test(child.tagName))) blocks.add(block);
    }
    if (!blocks.size) {
      let block = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer
        : range.startContainer.parentElement;
      while (block && block !== editor && !/^(P|LI|H[1-6]|BLOCKQUOTE|DIV)$/.test(block.tagName)) block = block.parentElement;
      if (block?.closest('[data-document-region]')) return [];
      blocks.add(block || editor);
    }
    return [...blocks];
  };
  const applyParagraphSpacing = (value) => {
    focusEditor();
    const selection = window.getSelection();
    const selectedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    selectedParagraphs().forEach((paragraph) => { paragraph.style.lineHeight = value; });
    if (selectedRange && editor.contains(selectedRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
      preserveSelectedRange(selectedRange);
    }
    scheduleSave();
    queueAutoPagination();
  };
  const applyParagraphShading = (color) => {
    focusEditor();
    const selection = window.getSelection();
    const selectedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    selectedParagraphs().forEach((paragraph) => {
      if (color) paragraph.style.backgroundColor = color;
      else paragraph.style.removeProperty('background-color');
    });
    if (selectedRange && editor.contains(selectedRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(selectedRange);
      preserveSelectedRange(selectedRange);
    }
    scheduleSave();
    queueAutoPagination();
  };
  document.querySelectorAll('[data-list-menu]').forEach((trigger) => {
    trigger.addEventListener('pointerdown', (event) => event.preventDefault());
    trigger.addEventListener('click', () => {
      const menu = paragraphMenus[trigger.dataset.listMenu];
      const shouldOpen = menu.hidden;
      closeParagraphMenus();
      if (!shouldOpen) return;
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      positionParagraphMenu(menu, trigger);
    });
  });
  const getUnderlineTargets = (range) => {
    if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer)) return [];
    const targets = new Set();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      if (!textNode.textContent || !range.intersectsNode(textNode)) continue;
      let element = textNode.parentElement;
      while (element && element !== editor) {
        if (element.tagName === 'U' ||
          getComputedStyle(element).textDecorationLine.split(/\s+/).includes('underline')) {
          targets.add(element);
          break;
        }
        element = element.parentElement;
      }
    }
    return [...targets];
  };
  const applyUnderlineFormatting = (style, color = null) => {
    focusEditor();
    const selection = window.getSelection();
    const initialRange = selection?.rangeCount && editor.contains(selection.anchorNode)
      ? selection.getRangeAt(0)
      : savedEditorRange;
    if (!initialRange || !editor.contains(initialRange.commonAncestorContainer)) return;
    const wasUnderlined = document.queryCommandState('underline');
    if (style === 'none') {
      if (!initialRange.collapsed && wasUnderlined) runCommand('underline');
      closeParagraphMenus();
      return;
    }
    if (style && !wasUnderlined) runCommand('underline');
    const currentSelection = window.getSelection();
    const range = currentSelection?.rangeCount && editor.contains(currentSelection.anchorNode)
      ? currentSelection.getRangeAt(0)
      : savedEditorRange;
    const targets = getUnderlineTargets(range);
    targets.forEach((target) => {
      if (style) target.style.textDecorationStyle = style;
      if (color) target.style.textDecorationColor = color;
    });
    if (range && !range.collapsed) preserveSelectedRange(range);
    if (style || color) {
      const styleLabel = style === 'double' ? 'Double'
        : style === 'dotted' ? 'Dotted'
          : style === 'dashed' ? 'Dashed'
            : style === 'wavy' ? 'Wavy'
              : 'Single';
      scheduleSave(color && !style ? 'Changed Underline Color' : `Applied ${styleLabel} Underline`);
      updateTextFormatButtons();
      updateCounts();
      queueAutoPagination();
    }
    closeParagraphMenus();
  };
  document.querySelectorAll('[data-underline-style]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => applyUnderlineFormatting(button.dataset.underlineStyle));
  });
  document.getElementById('underline-color').addEventListener('input', (event) => {
    applyUnderlineFormatting(null, event.currentTarget.value);
  });
  const findSelectedList = () => {
    const selection = window.getSelection();
    let element = selection && selection.anchorNode
      ? (selection.anchorNode.nodeType === Node.ELEMENT_NODE
        ? selection.anchorNode
        : selection.anchorNode.parentElement)
      : null;
    while (element && element !== editor) {
      if (element.tagName === 'UL' || element.tagName === 'OL') return element;
      element = element.parentElement;
    }
    return null;
  };
  document.querySelectorAll('[data-list-kind]').forEach((option) => {
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => {
      const kind = option.dataset.listKind;
      const tagName = kind === 'bullet' ? 'UL' : 'OL';
      focusEditor();
      let list = findSelectedList();
      if (!list || list.tagName !== tagName) {
        runCommand(kind === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList');
        list = findSelectedList();
      }
      if (list && list.tagName === tagName) {
        if (kind === 'bullet') {
          list.style.listStyleType = `"${option.dataset.listValue}"`;
        } else {
          const numberingStyle = option.dataset.listValue;
          list.style.listStyleType = numberingStyle;
        }
        scheduleSave();
      }
      closeParagraphMenus();
      focusEditor();
    });
  });
  document.querySelectorAll('[data-paragraph-align]').forEach((button) => {
    button.addEventListener('click', () => {
      const alignment = button.dataset.paragraphAlign;
      const currentSelection = window.getSelection();
      const selectionNode = currentSelection?.anchorNode;
      const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement;
      const documentRegion = selectionElement?.closest('[data-document-region]');
      const isDocumentRegionSelection = documentRegion && editor.contains(documentRegion);
      if (isDocumentRegionSelection) {
        documentRegion.dataset.documentAlignment = alignment === 'justify' ? 'center' : alignment;
        documentRegion.style.textAlign = alignment;
        documentRegion.querySelectorAll(':scope > p').forEach((paragraph) => {
          paragraph.style.textAlign = alignment;
        });
      } else {
        runCommand(alignment === 'justify' ? 'justifyFull' : `justify${alignment[0].toUpperCase()}${alignment.slice(1)}`);
      }
      if (isDocumentRegionSelection) {
        syncDocumentHeaderSpacing();
        scheduleSave();
        updateCounts();
      }
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range) {
        editor.querySelectorAll('ul, ol').forEach((list) => {
          if (!range.intersectsNode(list)) return;
          list.style.direction = alignment === 'left' ? 'ltr' : 'rtl';
          list.style.textAlign = alignment;
          list.querySelectorAll(':scope > li').forEach((item) => {
            item.style.direction = alignment === 'left' ? 'ltr' : 'rtl';
            item.style.textAlign = alignment;
          });
        });
      }
      document.querySelectorAll('[data-paragraph-align]').forEach((item) => item.classList.toggle('active', item === button));
    });
  });
  document.querySelectorAll('[data-line-spacing]').forEach((option) => {
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    const previewLineSpacing = () => {
      clearLineSpacingPreview();
      selectedParagraphs(false).forEach((paragraph) => {
        lineSpacingPreview.set(paragraph, {
          value: paragraph.style.getPropertyValue('line-height'),
          priority: paragraph.style.getPropertyPriority('line-height')
        });
        paragraph.style.lineHeight = option.dataset.lineSpacing;
      });
    };
    option.addEventListener('pointerenter', previewLineSpacing);
    option.addEventListener('pointerleave', clearLineSpacingPreview);
    option.addEventListener('focus', previewLineSpacing);
    option.addEventListener('blur', clearLineSpacingPreview);
    option.addEventListener('click', () => {
      clearLineSpacingPreview();
      const spacing = option.dataset.lineSpacing;
      const select = document.getElementById('line-spacing');
      if (!Array.from(select.options).some((item) => item.value === spacing)) {
        select.add(new Option(spacing, spacing));
      }
      select.value = spacing;
      applyParagraphSpacing(spacing);
      closeParagraphMenus();
    });
  });
  document.querySelectorAll('[data-paragraph-space]').forEach((option) => {
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => {
      selectedParagraphs().forEach((paragraph) => {
        paragraph.style[option.dataset.paragraphSpace === 'before' ? 'marginTop' : 'marginBottom'] =
          option.dataset.paragraphSpace === 'before' ? '8pt' : '0pt';
      });
      scheduleSave();
      queueAutoPagination();
      closeParagraphMenus();
    });
  });
  document.querySelector('[data-spacing-step]').addEventListener('click', () => {
    const select = document.getElementById('line-spacing');
    const values = [1, 1.15, 1.5, 1.7, 2, 2.5, 3];
    const next = values.find((value) => value > Number(select.value)) || values[0];
    if (!Array.from(select.options).some((item) => Number(item.value) === next)) {
      select.add(new Option(next, next));
    }
    select.value = String(next);
    applyParagraphSpacing(String(next));
  });
  document.getElementById('apply-custom-line-spacing').addEventListener('click', () => {
    const input = document.getElementById('custom-line-spacing');
    const spacing = Number(input.value);
    if (!Number.isFinite(spacing) || spacing < 0.5 || spacing > 10) {
      showToast('Enter line spacing between 0.5 and 10.');
      input.focus();
      return;
    }
    const value = String(spacing);
    const select = document.getElementById('line-spacing');
    if (!Array.from(select.options).some((item) => item.value === value)) {
      select.add(new Option(value, value));
    }
    select.value = value;
    applyParagraphSpacing(value);
    closeParagraphMenus();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.paragraph-group, .underline-split-tool') &&
      !event.target.closest('.paragraph-menu')) closeParagraphMenus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeParagraphMenus();
  });
  window.addEventListener('resize', () => {
    document.querySelectorAll('[data-list-menu]').forEach((trigger) => {
      const menu = paragraphMenus[trigger.dataset.listMenu];
      if (!menu.hidden) positionParagraphMenu(menu, trigger);
    });
  });
  function resetTextStyle() {
    runCommand('removeFormat');
    editor.style.fontFamily = "'Noto Nastaliq Urdu', 'Noto Naskh Arabic', serif";
    editor.style.fontSize = '';
    editor.style.lineHeight = '1.6';
  }
  document.getElementById('text-color').addEventListener('input', (event) => {
    runCommand('foreColor', event.target.value);
  });
  document.getElementById('highlight-color').addEventListener('input', (event) => {
    runCommand('hiliteColor', event.target.value);
  });
  document.getElementById('paragraph-shading-color').addEventListener('input', (event) => {
    applyParagraphShading(event.target.value);
  });
  const themeHues = [0, 350, 28, 58, 102, 180, 210, 220, 270, 315];
  const themePaletteColors = [
    '#000000', '#404040', '#666666', '#808080', '#999999', '#b3b3b3', '#cccccc', '#dddddd', '#eeeeee', '#ffffff',
    '#c00000', '#ff0000', '#ff9900', '#ffff00', '#00e000', '#00cfcf', '#4472e8', '#0066cc', '#8000ff', '#ff00ff'
  ];
  const hslToHex = (hue, saturation, lightness) => {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const secondary = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
    const match = lightness - chroma / 2;
    const [red, green, blue] = hue < 60 ? [chroma, secondary, 0]
      : hue < 120 ? [secondary, chroma, 0]
        : hue < 180 ? [0, chroma, secondary]
          : hue < 240 ? [0, secondary, chroma]
            : hue < 300 ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
    return `#${[red, green, blue].map((channel) =>
      Math.round((channel + match) * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  [0.85, 0.75, 0.65, 0.55, 0.45, 0.35].forEach((lightness) => {
    themeHues.forEach((hue) => themePaletteColors.push(hslToHex(hue, 0.68, lightness)));
  });
  document.querySelectorAll('input[type="color"]').forEach((input) => {
    let picker = input.closest('.color-picker');
    if (!picker) {
      picker = document.createElement('span');
      picker.className = 'color-picker color-input-picker';
      picker.dataset.colorPicker = 'input';
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'color-tool color-input-tool';
      trigger.setAttribute('aria-label', input.getAttribute('aria-label') || 'Choose color');
      const indicator = document.createElement('span');
      trigger.append(indicator);
      const palette = document.createElement('div');
      palette.className = 'color-palette';
      palette.setAttribute('role', 'group');
      palette.setAttribute('aria-label', `${input.getAttribute('aria-label') || 'Color'} palette`);
      const customButton = document.createElement('button');
      customButton.type = 'button';
      customButton.className = 'more-colors';
      customButton.textContent = 'Custom color';
      customButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        input.click();
      });
      palette.append(customButton);
      picker.append(trigger, palette);
      input.insertAdjacentElement('afterend', picker);
    }
    const palette = picker.querySelector('.color-palette');
    const colorTool = picker.querySelector('.color-tool');
    themePaletteColors.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.setAttribute('aria-label', color);
      swatch.dataset.color = color;
      const customOption = palette.querySelector('.more-colors');
      palette.insertBefore(swatch, customOption || null);
    });
    if (picker.dataset.colorPicker === 'highlight') {
      const clearHighlight = document.createElement('button');
      clearHighlight.type = 'button';
      clearHighlight.className = 'color-clear-option';
      clearHighlight.dataset.clearHighlight = 'true';
      clearHighlight.textContent = 'No color';
      clearHighlight.setAttribute('aria-label', 'Remove text highlight');
      palette.append(clearHighlight);
    } else if (picker.dataset.colorPicker === 'shading') {
      const clearShading = document.createElement('button');
      clearShading.type = 'button';
      clearShading.className = 'color-clear-option';
      clearShading.dataset.clearShading = 'true';
      clearShading.textContent = 'No color';
      clearShading.setAttribute('aria-label', 'Remove paragraph shading');
      palette.append(clearShading);
    } else if (input.id === 'page-color-input') {
      const clearPageColor = document.createElement('button');
      clearPageColor.type = 'button';
      clearPageColor.className = 'color-clear-option';
      clearPageColor.dataset.clearPageColor = 'true';
      clearPageColor.textContent = 'No color';
      clearPageColor.setAttribute('aria-label', 'Reset page color');
      palette.append(clearPageColor);
    }
    const customOption = palette.querySelector('.more-colors');
    if (customOption && customOption.tagName === 'LABEL') customOption.firstChild.textContent = 'CUSTOM';
    const customActions = document.createElement('div');
    customActions.className = 'palette-custom-actions';
    const eyedropper = document.createElement('button');
    eyedropper.type = 'button';
    eyedropper.className = 'color-eyedropper';
    eyedropper.setAttribute('aria-label', 'Pick a color from the screen');
    eyedropper.title = 'Pick a color from the screen';
    eyedropper.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.8 2.8 4.4 4.4m-2.2-2.2-8.6 8.6-3.1.9.9-3.1 8.6-8.6m-2.2 2.2 4.4 4.4M4.2 15.8l-1.6 1.6"/></svg>';
    eyedropper.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof window.EyeDropper !== 'function') {
        input.click();
        return;
      }
      try {
        const { sRGBHex } = await new window.EyeDropper().open();
        input.value = sRGBHex;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Could not pick a color from the screen.', error);
          showToast('Could not pick a color from the screen.');
        }
      }
    });
    if (customOption) customActions.append(customOption);
    customActions.append(eyedropper);
    palette.append(customActions);
    colorTool.querySelector('span').style.backgroundColor = input.value;
    colorTool.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('.color-picker.open').forEach((openPicker) => {
        if (openPicker !== picker) {
          openPicker.classList.remove('open');
          openPicker.querySelector('.color-tool')?.setAttribute('aria-expanded', 'false');
        }
      });
      const isOpen = picker.classList.toggle('open');
      colorTool.setAttribute('aria-expanded', String(isOpen));
    });
    palette.addEventListener('click', (event) => {
      const clearHighlight = event.target.closest('[data-clear-highlight]');
      if (clearHighlight) {
        event.preventDefault();
        picker.classList.remove('open');
        colorTool.setAttribute('aria-expanded', 'false');
        colorTool.querySelector('span').style.backgroundColor = 'transparent';
        runCommand('hiliteColor', 'transparent');
        return;
      }
      const clearShading = event.target.closest('[data-clear-shading]');
      if (clearShading) {
        event.preventDefault();
        picker.classList.remove('open');
        colorTool.setAttribute('aria-expanded', 'false');
        colorTool.querySelector('span').style.backgroundColor = 'transparent';
        applyParagraphShading('');
        return;
      }
      const clearPageColor = event.target.closest('[data-clear-page-color]');
      if (clearPageColor) {
        event.preventDefault();
        picker.classList.remove('open');
        colorTool.setAttribute('aria-expanded', 'false');
        input.value = '#ffffff';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const swatch = event.target.closest('[data-color]');
      if (!swatch) return;
      event.preventDefault();
      picker.classList.remove('open');
      colorTool.setAttribute('aria-expanded', 'false');
      input.value = swatch.dataset.color;
      colorTool.querySelector('span').style.backgroundColor = swatch.dataset.color;
      if (picker.dataset.colorPicker === 'table-border') {
        const table = getActiveTable();
        if (table) {
          table.dataset.borderColor = swatch.dataset.color;
          table.style.setProperty('--table-border-color', swatch.dataset.color);
          scheduleSave();
        }
        return;
      }
      if (picker.dataset.colorPicker === 'image-border') {
        const image = activeImage;
        if (image && editor.contains(image)) {
          image.dataset.imageBorderColor = swatch.dataset.color;
          const borderWidth = Number(image.dataset.imageBorderWidth || 0);
          image.style.border = borderWidth ? `${borderWidth}px solid ${swatch.dataset.color}` : 'none';
          scheduleSave();
        }
        return;
      }
      if (picker.dataset.colorPicker === 'underline') {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (picker.classList.contains('color-input-picker')) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const isHighlight = picker.dataset.colorPicker === 'highlight';
      if (picker.dataset.colorPicker === 'shading') applyParagraphShading(swatch.dataset.color);
      else runCommand(isHighlight ? 'hiliteColor' : 'foreColor', swatch.dataset.color);
      if (picker.dataset.colorPicker === 'text') {
        document.querySelector('.text-color-tool > span').style.backgroundColor = swatch.dataset.color;
      }
    });
    colorTool.addEventListener('click', () => {
      if (picker.classList.contains('open')) {
        const rect = colorTool.getBoundingClientRect();
        const paletteBounds = palette.getBoundingClientRect();
        const paletteHeight = paletteBounds.height || 240;
        const paletteWidth = paletteBounds.width || 235;
        palette.style.left = `${Math.max(4, Math.min(window.innerWidth - paletteWidth - 4, rect.left))}px`;
        palette.style.top = `${Math.max(4, Math.min(window.innerHeight - paletteHeight - 4, rect.bottom + 4))}px`;
      }
    });
    input.addEventListener('input', (event) => {
      picker.classList.remove('open');
      colorTool.setAttribute('aria-expanded', 'false');
      colorTool.querySelector('span').style.backgroundColor = event.target.value;
      if (picker.dataset.colorPicker === 'table-border') {
        const table = getActiveTable();
        if (table) {
          table.dataset.borderColor = event.target.value;
          table.style.setProperty('--table-border-color', event.target.value);
          scheduleSave();
        }
        return;
      }
      if (picker.dataset.colorPicker === 'image-border') {
        const image = activeImage;
        if (image && editor.contains(image)) {
          image.dataset.imageBorderColor = event.target.value;
          const borderWidth = Number(image.dataset.imageBorderWidth || 0);
          image.style.border = borderWidth ? `${borderWidth}px solid ${event.target.value}` : 'none';
          scheduleSave();
        }
      }
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.color-picker')) {
      document.querySelectorAll('.color-picker.open').forEach((picker) => {
        picker.classList.remove('open');
        picker.querySelector('.color-tool')?.setAttribute('aria-expanded', 'false');
      });
    }
  });
  const insertLink = () => {
    const url = window.prompt('Enter a link:');
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) throw new Error('Unsupported URL protocol.');
        runCommand('createLink', parsed.href);
      } catch (error) {
        window.alert('Please enter a valid web link.');
      }
    }
  };
  let activeFindMatch = null;
  let findCursor = 0;

  function getEditorTextMap() {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const segments = [];
    let text = '';
    let previousBlock = null;
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('[contenteditable="false"]')) continue;
      const value = node.nodeValue || '';
      if (!value) continue;
      let block = node.parentElement;
      while (block && block !== editor && !/^(?:ADDRESS|BLOCKQUOTE|DIV|H[1-6]|LI|P|PRE|TD|TH)$/.test(block.tagName)) {
        block = block.parentElement;
      }
      if (previousBlock && block !== previousBlock) text += '\u0000';
      segments.push({ node, start: text.length, end: text.length + value.length });
      text += value;
      previousBlock = block;
    }
    return { text, segments };
  }

  function getTextPoint(segments, offset, isEnd) {
    const segment = segments.find(({ start, end }) => isEnd
      ? offset > start && offset <= end
      : offset >= start && offset < end);
    if (!segment) return null;
    return { node: segment.node, offset: offset - segment.start };
  }

  function getMatchRange(segments, start, end) {
    const startPoint = getTextPoint(segments, start, false);
    const endPoint = getTextPoint(segments, end, true);
    if (!startPoint || !endPoint) return null;
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    return range;
  }

  function getFindMatches(text, query, matchCase) {
    if (!query) return [];
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(escapedQuery, matchCase ? 'gu' : 'giu');
    return Array.from(text.matchAll(expression), (match) => ({
      start: match.index,
      end: match.index + match[0].length
    }));
  }

  function openFindPanel(showReplace) {
    let panel = document.getElementById('find-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'find-panel';
      panel.className = 'find-panel';
      panel.dir = 'ltr';
      panel.setAttribute('aria-label', 'Find and replace');
      panel.innerHTML = '<div class="find-row"><input id="find-query" type="search" placeholder="Find in document" aria-label="Find in document"><button id="find-previous" type="button" aria-label="Find previous match" title="Previous match">↑</button><button id="find-next" type="button" aria-label="Find next match" title="Next match">↓</button><button id="find-close" type="button" aria-label="Close find and replace">×</button></div><div class="replace-row"><input id="replace-query" type="text" placeholder="Replace with" aria-label="Replace with"><button id="replace-current" type="button">Replace</button><button id="replace-all" type="button">Replace all</button></div><div class="find-options"><label><input id="find-match-case" type="checkbox"> Match case</label><output id="find-status" aria-live="polite"></output></div>';
      document.body.append(panel);
      const queryInput = panel.querySelector('#find-query');
      const replaceInput = panel.querySelector('#replace-query');
      const matchCaseInput = panel.querySelector('#find-match-case');
      const resetSearch = () => {
        activeFindMatch = null;
        findCursor = 0;
        updateFindStatus();
      };
      const getMatches = () => {
        const { text } = getEditorTextMap();
        return getFindMatches(text, queryInput.value, matchCaseInput.checked);
      };
      const updateFindStatus = () => {
        const matches = getMatches();
        const activeIndex = activeFindMatch
          ? matches.findIndex(({ start, end }) => start === activeFindMatch.start && end === activeFindMatch.end)
          : -1;
        panel.querySelector('#find-status').textContent = matches.length
          ? activeIndex >= 0 ? `${activeIndex + 1} of ${matches.length}` : `${matches.length} matches`
          : queryInput.value ? 'No matches' : '';
      };
      const selectMatch = (match, segments) => {
        const range = getMatchRange(segments, match.start, match.end);
        if (!range) return false;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        activeFindMatch = match;
        findCursor = match.end;
        editor.focus();
        range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        updateFindStatus();
        return true;
      };
      const findMatch = (direction, startAt = findCursor) => {
        const { text, segments } = getEditorTextMap();
        const matches = getFindMatches(text, queryInput.value, matchCaseInput.checked);
        if (!matches.length) {
          activeFindMatch = null;
          updateFindStatus();
          showToast(queryInput.value ? 'No matches found.' : 'Enter text to find.');
          return null;
        }
        let index;
        if (direction === 'previous') {
          index = -1;
          for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
            if (matches[matchIndex].end <= startAt) {
              index = matchIndex;
              break;
            }
          }
          if (index < 0) index = matches.length - 1;
        } else {
          index = matches.findIndex((match) => match.start >= startAt);
          if (index < 0) index = 0;
        }
        const match = matches[index];
        return selectMatch(match, segments) ? match : null;
      };
      const replaceMatch = (match, replacement, refresh = true) => {
        const { segments } = getEditorTextMap();
        const range = getMatchRange(segments, match.start, match.end);
        if (!range) return false;
        range.deleteContents();
        const insertedText = document.createTextNode(replacement);
        range.insertNode(insertedText);
        range.setStartAfter(insertedText);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        activeFindMatch = null;
        findCursor = match.start + replacement.length;
        if (refresh) {
          updateCounts();
          scheduleSave();
        }
        return true;
      };

      queryInput.addEventListener('input', resetSearch);
      matchCaseInput.addEventListener('change', resetSearch);
      panel.querySelector('#find-next').addEventListener('click', () => findMatch('next', activeFindMatch ? activeFindMatch.end : findCursor));
      panel.querySelector('#find-previous').addEventListener('click', () => findMatch('previous', activeFindMatch ? activeFindMatch.start : findCursor));
      panel.querySelector('#replace-current').addEventListener('click', () => {
        const matches = getMatches();
        const current = activeFindMatch && matches.find(({ start, end }) => start === activeFindMatch.start && end === activeFindMatch.end);
        const match = current || findMatch('next');
        if (!match) return;
        if (!replaceMatch(match, replaceInput.value)) return;
        findMatch('next', findCursor);
      });
      panel.querySelector('#replace-all').addEventListener('click', () => {
        const matches = getMatches();
        if (!matches.length) {
          updateFindStatus();
          showToast(queryInput.value ? 'No matches found.' : 'Enter text to find.');
          return;
        }
        let replaced = 0;
        for (const match of matches.reverse()) {
          if (replaceMatch(match, replaceInput.value, false)) replaced += 1;
        }
        activeFindMatch = null;
        findCursor = 0;
        updateCounts();
        scheduleSave();
        updateFindStatus();
        showToast(`${replaced} occurrence${replaced === 1 ? '' : 's'} replaced.`);
      });
      panel.querySelector('#find-close').addEventListener('click', () => {
        panel.remove();
        activeFindMatch = null;
      });
      queryInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          findMatch(event.shiftKey ? 'previous' : 'next', activeFindMatch ? (event.shiftKey ? activeFindMatch.start : activeFindMatch.end) : findCursor);
        } else if (event.key === 'Escape') {
          panel.remove();
        }
      });
      replaceInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') panel.querySelector('#replace-current').click();
        else if (event.key === 'Escape') {
          panel.remove();
        }
      });
    }
    panel.classList.toggle('replace-mode', showReplace);
    const queryInput = panel.querySelector('#find-query');
    queryInput.focus();
    queryInput.select();
    panel.querySelector('#find-status').textContent = '';
  }

  document.getElementById('find-button').addEventListener('click', () => openFindPanel(false));
  document.getElementById('replace-button').addEventListener('click', () => openFindPanel(true));
  const tablePickerGrid = document.getElementById('table-picker-grid');
  const tablePickerLabel = document.getElementById('table-picker-label');
  const tablePickerCells = [];
  for (let row = 1; row <= 8; row += 1) {
    for (let column = 1; column <= 10; column += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'table-picker-cell';
      cell.setAttribute('role', 'gridcell');
      cell.dataset.rows = String(row);
      cell.dataset.columns = String(column);
      cell.setAttribute('aria-label', `${column} columns by ${row} rows`);
      cell.setAttribute('aria-selected', 'false');
      tablePickerGrid.append(cell);
      tablePickerCells.push(cell);
    }
  }
  const highlightTablePicker = (rows, columns) => {
    tablePickerLabel.textContent = `${columns}×${rows} Table`;
    tablePickerCells.forEach((cell) => {
      const selected = Number(cell.dataset.rows) <= rows && Number(cell.dataset.columns) <= columns;
      cell.classList.toggle('is-highlighted', selected);
      cell.setAttribute('aria-selected', String(selected));
    });
  };
  const clearTablePicker = () => {
    tablePickerLabel.textContent = 'Insert Table';
    tablePickerCells.forEach((cell) => {
      cell.classList.remove('is-highlighted');
      cell.setAttribute('aria-selected', 'false');
    });
  };
  tablePickerGrid.addEventListener('pointerover', (event) => {
    const cell = event.target.closest('.table-picker-cell');
    if (cell) highlightTablePicker(Number(cell.dataset.rows), Number(cell.dataset.columns));
  });
  tablePickerGrid.addEventListener('focusin', (event) => {
    const cell = event.target.closest('.table-picker-cell');
    if (cell) highlightTablePicker(Number(cell.dataset.rows), Number(cell.dataset.columns));
  });
  tablePickerGrid.addEventListener('pointerleave', () => {
    if (!tablePickerGrid.contains(document.activeElement)) clearTablePicker();
  });
  tablePickerGrid.addEventListener('focusout', (event) => {
    if (!tablePickerGrid.contains(event.relatedTarget)) clearTablePicker();
  });
  tablePickerGrid.addEventListener('click', (event) => {
    const cell = event.target.closest('.table-picker-cell');
    if (!cell) return;
    const rows = Number(cell.dataset.rows);
    const columns = Number(cell.dataset.columns);
    document.getElementById('table-create-rows').value = String(rows);
    document.getElementById('table-create-columns').value = String(columns);
    insertTableIntoDocument(rows, columns);
  });
  const insertTableIntoDocument = (rowCount, columnCount) => {
    const rows = Number(rowCount);
    const columns = Number(columnCount);
    const cellWidth = Number(document.getElementById('table-create-width').value);
    const cellHeight = Number(document.getElementById('table-create-height').value);
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 ||
      rows > 20 || columns > 20 || rows * columns > 400) {
      showToast('Choose between 1 and 20 rows and columns, with no more than 400 cells.');
      return false;
    }
    if (!Number.isFinite(cellWidth) || cellWidth < 40 || cellWidth > 240 ||
      !Number.isFinite(cellHeight) || cellHeight < MIN_TABLE_ROW_HEIGHT || cellHeight > 120) {
      showToast(`Cell width must be 40–240 px and cell height ${MIN_TABLE_ROW_HEIGHT}–120 px.`);
      return false;
    }

    const availableWidth = Math.max(1,
      editor.clientWidth - parseFloat(getComputedStyle(editor).paddingLeft) -
      parseFloat(getComputedStyle(editor).paddingRight));
    const table = document.createElement('table');
    table.dataset.canvasTable = 'true';
    table.dataset.tableInsertionToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    table.dataset.borderWidth = '1';
    table.dataset.borderColor = '#000000';
    table.dataset.tableStyle = 'grid';
    table.style.width = `${Math.max(10, Math.min(100, Math.round(columns * cellWidth / availableWidth * 100)))}%`;
    table.style.tableLayout = 'fixed';
    const body = table.createTBody();
    for (let row = 0; row < rows; row += 1) {
      const tableRow = body.insertRow();
      tableRow.style.height = `${cellHeight}px`;
      if (cellHeight > MIN_TABLE_ROW_HEIGHT) tableRow.dataset.tableRowHeight = 'manual';
      for (let column = 0; column < columns; column += 1) {
        const cell = tableRow.insertCell();
        const paragraph = document.createElement('p');
        paragraph.append(document.createElement('br'));
        cell.append(paragraph);
        cell.style.width = `${100 / columns}%`;
        cell.style.height = `${cellHeight}px`;
        cell.style.textAlign = 'right';
        cell.style.direction = 'rtl';
        cell.style.fontFamily = "'Noto Nastaliq Urdu', serif";
        cell.dataset.cellBorderColor = '#000000';
        cell.dataset.cellBorderWidth = '1';
      }
    }

    closeInsertMenus();
    const insertedTable = insertEditableTableElement(table);
    const firstCell = insertedTable && insertedTable.rows[0] && insertedTable.rows[0].cells[0];
    if (!firstCell) {
      showToast('Could not insert the table. Try again.');
      return false;
    }
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(firstCell.querySelector('p') || firstCell);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
    updateTableToolbar(firstCell);
    scheduleSave();
    updateCounts();
    return true;
  };
  document.getElementById('table-custom-toggle').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const fields = document.getElementById('table-create-fields');
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    fields.hidden = !expanded;
    if (expanded) document.getElementById('table-create-rows').focus();
  });
  document.getElementById('table-create-button').addEventListener('click', () => {
    insertTableIntoDocument(
      document.getElementById('table-create-rows').value,
      document.getElementById('table-create-columns').value
    );
  });
  const shapeLibrary = document.getElementById('shape-library');
  window.WordShapesEngine.renderGallery(shapeLibrary);
  shapeLibrary.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-insert-shape]')) event.preventDefault();
  });
  shapeLibrary.addEventListener('click', (event) => {
    const button = event.target.closest('[data-insert-shape]');
    if (!button) return;
    const type = button.dataset.insertShape;
    const shapeDefinition = window.WordShapesEngine.get(type);
    if (!shapeDefinition) return;
    closeInsertMenus();
    const width = type.endsWith('-button') ? 90 : ['square', 'circle'].includes(type) ? 100 : 140;
    const height = type === 'line' ? 2 : 90;
    const shapeHeight = type === 'square' || type === 'circle' ? 100 : height;
    const geometry = shapeDefinition.geometry;
    const lineColor = '#176b9a';
    const fillColor = '#dce8f5';
    const backgroundColor = geometry === 'polygon' || type === 'line' ? lineColor : fillColor;
    insertHtml(`<div class="editor-shape" contenteditable="false" data-editor-shape="true" data-shape-type="${type}" data-shape-geometry="${geometry}" data-shape-fill="${fillColor}" data-shape-line="${lineColor}" data-shape-line-width="2" data-shape-opacity="100" data-shape-rotation="0" style="position:absolute;width:${width}px;height:${shapeHeight}px;background-color:${backgroundColor};border-color:${lineColor};border-width:2px"></div><p><br></p>`, true);
    const shapes = editor.querySelectorAll('.editor-shape');
    const shape = shapes[shapes.length - 1];
    if (shape) {
      shape.style.width = `${width}px`;
      shape.style.height = `${shapeHeight}px`;
      window.WordShapesEngine.applyGeometry(shape, type);
      shape.style.setProperty('--shape-line-color', lineColor);
      shape.style.setProperty('--shape-fill-color', fillColor);
      shape.style.setProperty('--shape-border-width', `${shape.dataset.shapeLineWidth}px`);
      ensureShapePosition(shape);
      showShapeToolbar(shape);
    }
  });
  document.getElementById('text-box-button').addEventListener('click', () => {
    syncVerticalRuler();
    const height = 40;
    const editorStyle = getComputedStyle(editor);
    const paddingLeft = Number.parseFloat(editorStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(editorStyle.paddingRight) || 0;
    const paddingTop = Number.parseFloat(editorStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(editorStyle.paddingBottom) || 0;
    const pageWidth = editor.clientWidth;
    const availablePageWidth = Math.max(1, pageWidth - paddingLeft - paddingRight - 16);
    let width = Math.min(240, availablePageWidth);
    const pageHeight = Number.parseFloat(editorStyle.getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(editorStyle.getPropertyValue('--layout-page-gap')) || 20;
    const pageIndex = Math.max(0, Math.min(editor.querySelectorAll('.page-break').length,
      Number(verticalRuler.dataset.pageIndex) || 0));
    const pageTop = pageIndex * (pageHeight + pageGap);
    const top = Math.max(pageTop + paddingTop, Math.min(pageTop + pageHeight - paddingBottom - height,
      pageTop + paddingTop + 24));
    const pageBounds = editor.getBoundingClientRect();
    const workspaceBounds = document.querySelector('.document-workspace').getBoundingClientRect();
    const scaleX = pageBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = pageBounds.height / Math.max(editor.offsetHeight, 1);
    const boxTop = pageBounds.top + top * scaleY;
    const boxBottom = boxTop + height * scaleY;
    let visibleLeft = Math.max(pageBounds.left + paddingLeft * scaleX, workspaceBounds.left);
    let visibleRight = Math.min(pageBounds.right - paddingRight * scaleX, workspaceBounds.right);
    [
      document.querySelector('.keyboard-sidebar'),
      document.querySelector('.ads-sidebar')
    ].forEach((obstruction) => {
      if (!obstruction || getComputedStyle(obstruction).display === 'none') return;
      const bounds = obstruction.getBoundingClientRect();
      if (bounds.bottom <= boxTop || bounds.top >= boxBottom) return;
      if (bounds.left <= visibleLeft && bounds.right > visibleLeft) {
        visibleLeft = bounds.right;
      } else if (bounds.left < visibleRight && bounds.right >= visibleRight) {
        visibleRight = bounds.left;
      }
    });
    const visibleContentWidth = visibleRight - visibleLeft;
    if (visibleContentWidth > 16) {
      width = Math.max(1, Math.min(width, visibleContentWidth - 16));
    }
    const left = visibleContentWidth > 16
      ? Math.max(paddingLeft, Math.round(
        (visibleLeft + (visibleContentWidth - width) / 2 - pageBounds.left) / scaleX
      ))
      : Math.max(paddingLeft,
        Math.round(paddingLeft + (pageWidth - paddingLeft - paddingRight - width) / 2));
    const lineColor = '#176b9a';
    const fillColor = '#ffffff';
    insertHtml(`<div class="editor-shape editor-textbox" tabindex="0" contenteditable="true" dir="auto" data-editor-shape="true" data-editor-textbox="true" data-shape-type="rectangle" data-shape-geometry="basic" data-shape-fill="${fillColor}" data-shape-line="${lineColor}" data-shape-line-width="1" data-shape-opacity="100" data-shape-rotation="0" style="position:absolute;width:${width}px;height:${height}px;left:${left}px;top:${top}px;background-color:${fillColor};border-color:${lineColor};border-width:1px"></div><p><br></p>`, true);
    const textBox = editor.querySelectorAll('.editor-textbox');
    const activeTextBox = textBox[textBox.length - 1];
    if (!activeTextBox) return;
    showShapeToolbar(activeTextBox);
    activeTextBox.focus();
    const range = document.createRange();
    range.selectNodeContents(activeTextBox);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    activeTextBox.focus({ preventScroll: true });
  });
  let textBoxManipulatorFrame = 0;
  const resizeTextBoxToFit = (textBox) => {
    if (!textBox || !editor.contains(textBox)) return;
    const left = Number.parseFloat(textBox.style.left) || 0;
    const editorStyle = getComputedStyle(editor);
    const paddingRight = Number.parseFloat(editorStyle.paddingRight) || 0;
    const availableWidth = Math.max(1, editor.clientWidth - left - paddingRight - 16);
    const maxWidth = `${availableWidth}px`;
    if (textBox.style.maxWidth !== maxWidth) textBox.style.maxWidth = maxWidth;
    if (textBox.dataset.textboxManualWidth !== 'true') {
      const minimumWidth = Math.min(240, availableWidth);
      const minWidth = `${minimumWidth}px`;
      if (textBox.style.minWidth !== minWidth) textBox.style.minWidth = minWidth;
      if (textBox.style.width !== 'auto') textBox.style.width = 'auto';
    } else {
      if (textBox.style.minWidth !== '20px') textBox.style.minWidth = '20px';
    }
    if (activeShape === textBox) {
      window.cancelAnimationFrame(textBoxManipulatorFrame);
      textBoxManipulatorFrame = window.requestAnimationFrame(() => {
        textBoxManipulatorFrame = 0;
        if (activeShape === textBox && editor.contains(textBox)) refreshShapeManipulators(textBox);
      });
    }
  };
  editor.addEventListener('input', (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const selectionNode = window.getSelection()?.anchorNode;
    const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement;
    const textBox = target?.closest('.editor-textbox') ||
      selectionElement?.closest('.editor-textbox');
    if (textBox) resizeTextBoxToFit(textBox);
  });
  const insertMenus = [
    { button: document.getElementById('table-button'), menu: document.getElementById('table-menu') },
    { button: document.getElementById('page-number-button'), menu: document.getElementById('page-number-menu') },
    { button: document.getElementById('emoji-button'), menu: document.getElementById('emoji-menu') },
    { button: document.getElementById('shapes-button'), menu: document.getElementById('shapes-menu') },
    { button: document.getElementById('header-insert-button'), menu: document.getElementById('header-template-menu') },
    { button: document.getElementById('footer-insert-button'), menu: document.getElementById('footer-template-menu') }
  ].filter(({ menu }) => menu);
  insertMenus.forEach(({ menu }) => document.body.append(menu));
  const closeInsertMenus = () => insertMenus.forEach(({ button, menu }) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
  const positionInsertMenu = (menu, button) => {
    const bounds = button.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    menu.style.left = `${Math.max(4, Math.min(bounds.left, window.innerWidth - width - 4))}px`;
    menu.style.top = `${bounds.bottom + height + 4 <= window.innerHeight
      ? bounds.bottom + 4
      : Math.max(4, bounds.top - height - 4)}px`;
  };
  insertMenus.forEach(({ button, menu }) => {
    button.addEventListener('click', () => {
      const opening = menu.hidden;
      closeInsertMenus();
      if (opening) {
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        positionInsertMenu(menu, button);
      }
    });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!insertMenus.some(({ button, menu }) => button.contains(event.target) || menu.contains(event.target))) {
      closeInsertMenus();
    }
  });
  window.addEventListener('resize', () => {
    insertMenus.forEach(({ button, menu }) => {
      if (!menu.hidden) positionInsertMenu(menu, button);
    });
  });
  document.getElementById('emoji-menu').querySelectorAll('[data-emoji]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      closeInsertMenus();
      insertHtml(button.dataset.emoji);
    });
  });
  document.querySelectorAll('[data-page-number-location]').forEach((button) => {
    button.addEventListener('pointerdown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const [regionName, alignment] = button.dataset.pageNumberLocation.split('-');
      const region = ensureDocumentRegion(regionName, alignment);
      editor.querySelectorAll('[data-document-region]').forEach((item) => {
        item.removeAttribute('data-page-number-location');
      });
      editor.querySelectorAll('[data-page-number-set="true"]').forEach((field) => field.remove());
      region.querySelectorAll('p').forEach((paragraph) => {
        if (!paragraph.textContent.trim()) paragraph.remove();
      });
      region.style.textAlign = alignment;
      region.dataset.empty = 'false';
      region.dataset.pageNumberLocation = button.dataset.pageNumberLocation;
      syncDocumentHeaderSpacing();
      region.dataset.pageNumberStyle = document.getElementById('page-number-style').value;
      const pageNumberSet = document.createElement('span');
      pageNumberSet.dataset.pageNumberSet = 'true';
      pageNumberSet.contentEditable = 'false';
      const number = document.createElement('span');
      number.dataset.pageNumberField = 'number';
      number.setAttribute('contenteditable', 'false');
      number.textContent = '1';
      pageNumberSet.append(number);
      region.append(pageNumberSet);
      const hasOtherContent = Array.from(region.childNodes).some((node) =>
        node !== pageNumberSet && node.textContent.trim());
      region.setAttribute('contenteditable', hasOtherContent ? 'true' : 'false');
      closeInsertMenus();
      updateCounts();
      scheduleSave();
      window.getSelection()?.removeAllRanges();
    });
  });
  document.getElementById('page-number-style').addEventListener('change', (event) => {
    const region = editor.querySelector('[data-page-number-location]');
    if (!region) return;
    region.dataset.pageNumberStyle = event.currentTarget.value;
    updateCounts();
    scheduleSave();
  });
  document.getElementById('page-number-button').addEventListener('click', () => {
    const region = editor.querySelector('[data-page-number-location]');
    document.getElementById('page-number-style').value = region?.dataset.pageNumberStyle || 'decimal';
  });
  document.getElementById('remove-page-numbers').addEventListener('click', () => {
    editor.querySelectorAll('[data-page-number-set="true"]').forEach((field) => field.remove());
    editor.querySelectorAll('[data-document-region]').forEach((region) => {
      region.removeAttribute('data-page-number-location');
      region.removeAttribute('data-page-number-style');
      region.setAttribute('contenteditable', 'true');
      region.dataset.empty = String(!region.textContent.trim());
    });
    syncDocumentHeaderSpacing();
    editor.style.page = '';
    closeInsertMenus();
    updateCounts();
    scheduleSave();
  });
  function createPageBreak() {
    const pageBreak = document.createElement('div');
    pageBreak.className = 'page-break';
    pageBreak.contentEditable = 'false';
    pageBreak.setAttribute('aria-hidden', 'true');
    return pageBreak;
  }
  function getPageContentNodes(pageIndex, pageBreaks = Array.from(editor.querySelectorAll('.page-break'))) {
    const children = Array.from(editor.children);
    const start = pageIndex === 0 ? 0 : children.indexOf(pageBreaks[pageIndex - 1]) + 1;
    const end = pageIndex < pageBreaks.length ? children.indexOf(pageBreaks[pageIndex]) : children.length;
    return children.slice(start, end).filter((node) =>
      !node.matches('.document-header, .document-footer'));
  }
  document.getElementById('copy-page-button').addEventListener('click', () => {
    const pageBreaks = Array.from(editor.querySelectorAll('.page-break'));
    const pageIndex = Math.max(0, Math.min(pageBreaks.length, Number(verticalRuler.dataset.pageIndex) || 0));
    const sourceNodes = getPageContentNodes(pageIndex, pageBreaks);
    const clonedNodes = sourceNodes.map((node) => node.cloneNode(true));
    clonedNodes.forEach((node) => {
      if (node.id) node.removeAttribute('id');
      node.querySelectorAll('[id]').forEach((child) => child.removeAttribute('id'));
      node.classList.remove('image-selected');
      node.querySelectorAll('.image-selected').forEach((child) => child.classList.remove('image-selected'));
    });
    if (clonedNodes.length === 0) {
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      clonedNodes.push(paragraph);
    }
    const nextPageBreak = pageBreaks[pageIndex] || null;
    editor.insertBefore(createPageBreak(), nextPageBreak);
    const fragment = document.createDocumentFragment();
    clonedNodes.forEach((node) => fragment.append(node));
    editor.insertBefore(fragment, nextPageBreak);
    syncPageBreakLayout();
    updateCounts();
    syncRulers();
    scheduleSave();
    clonedNodes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('delete-page-button').addEventListener('click', () => {
    const pageBreaks = Array.from(editor.querySelectorAll('.page-break'));
    if (pageBreaks.length === 0) return;
    const pageIndex = Math.max(0, Math.min(pageBreaks.length, Number(verticalRuler.dataset.pageIndex) || 0));
    getPageContentNodes(pageIndex, pageBreaks).forEach((node) => node.remove());
    if (pageIndex < pageBreaks.length) pageBreaks[pageIndex].remove();
    else pageBreaks[pageIndex - 1].remove();
    const hasPageContent = Array.from(editor.children).some((node) =>
      !node.matches('.page-break, .document-header, .document-footer'));
    if (!hasPageContent) {
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      editor.append(paragraph);
    }
    syncPageBreakLayout();
    updateCounts();
    syncRulers();
    scheduleSave();
    editor.querySelector('p')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('add-page-button').addEventListener('click', () => {
    const pageBreak = createPageBreak();
    const paragraph = document.createElement('p');
    paragraph.append(document.createElement('br'));
    editor.append(pageBreak, paragraph);
    syncPageBreakLayout();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(true);
    const selection = window.getSelection();
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
    updateCounts();
    scheduleSave();
    paragraph.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  function applyDocumentRegionTemplate(region, templateName = 'blank') {
    if (!region) return null;
    const supportedTemplates = ['blank', 'three-columns', 'austin', 'banded'];
    region.dataset.template = supportedTemplates.includes(templateName) ? templateName : 'blank';
    region.style.display = '';
    region.style.gridTemplateColumns = '';
    region.style.alignItems = '';
    region.style.gap = '';
    region.style.padding = '';
    region.style.background = '';
    region.style.border = '';
    region.style.borderRadius = '';
    region.querySelectorAll('p').forEach((item) => item.removeAttribute('style'));
    return region;
  }
  function setDocumentRegionTemplate(region, templateName) {
    const supportedTemplates = ['blank', 'three-columns', 'austin', 'banded'];
    const selectedTemplate = supportedTemplates.includes(templateName) ? templateName : 'blank';
    const footerPageNumber = region.dataset.documentRegion === 'footer' &&
      ['austin', 'banded'].includes(selectedTemplate);
    region.replaceChildren();
    const paragraphCount = selectedTemplate === 'three-columns' ? 3 : 1;
    for (let index = 0; index < paragraphCount; index += 1) {
      const paragraph = document.createElement('p');
      if (!footerPageNumber) paragraph.append(document.createElement('br'));
      region.append(paragraph);
    }
    if (footerPageNumber) {
      const paragraph = region.querySelector('p');
      if (selectedTemplate === 'austin') paragraph.append(document.createTextNode('Pg. '));
      const pageNumber = document.createElement('span');
      pageNumber.dataset.pageNumberField = 'number';
      pageNumber.setAttribute('contenteditable', 'false');
      pageNumber.textContent = '1';
      paragraph.append(pageNumber);
    }
    region.dataset.empty = String(!region.textContent.trim());
    applyDocumentRegionTemplate(region, selectedTemplate);
  }
  function ensureDocumentRegion(name, alignment = 'center') {
    let region = editor.querySelector(`[data-document-region="${name}"]`);
    if (!region) {
      region = document.createElement('div');
      region.className = `document-${name}`;
      region.dataset.documentRegion = name;
      region.dataset.empty = 'true';
      region.setAttribute('dir', 'ltr');
      region.setAttribute('contenteditable', 'false');
      region.style.textAlign = alignment;
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      region.append(paragraph);
      if (name === 'header') editor.insertBefore(region, editor.firstChild);
      else editor.append(region);
    } else {
      region.style.textAlign = alignment;
    }
    if (!region.dataset.template) region.dataset.template = 'blank';
    applyDocumentRegionTemplate(region, region.dataset.template);
    syncDocumentHeaderSpacing();
    return region;
  }
  function focusDocumentRegion(region, clientX = null, clientY = null) {
    const activeRegion = editor.querySelector('[data-document-region][contenteditable="true"]');
    if (activeRegion && activeRegion !== region) lockDocumentRegion(activeRegion);
    const paragraph = region.querySelector('p') || region;
    const selection = window.getSelection();
    editor.dataset.documentEditing = region.dataset.documentRegion;
    editor.setAttribute('contenteditable', 'false');
    region.setAttribute('contenteditable', 'true');
    region.tabIndex = 0;
    region.scrollIntoView({ behavior: 'smooth', block: 'center' });
    region.focus({ preventScroll: true });
    let range = null;
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      range = document.caretRangeFromPoint?.(clientX, clientY) || null;
      if (range && !region.contains(range.startContainer)) range = null;
    } else {
      const regionBounds = region.getBoundingClientRect();
      const paragraphBounds = paragraph.getBoundingClientRect();
      range = document.caretRangeFromPoint?.(
        regionBounds.left + regionBounds.width / 2,
        paragraphBounds.top + paragraphBounds.height / 2
      ) || null;
      if (range && !region.contains(range.startContainer)) range = null;
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
  }
  function lockDocumentRegion(region) {
    if (region.getAttribute('contenteditable') !== 'true') return;
    region.setAttribute('contenteditable', 'false');
    region.removeAttribute('tabindex');
    region.dataset.empty = String(!region.textContent.trim());
    if (editor.dataset.documentEditing === region.dataset.documentRegion) {
      delete editor.dataset.documentEditing;
      editor.setAttribute('contenteditable', 'true');
    }
    if (savedEditorRange && region.contains(savedEditorRange.commonAncestorContainer)) {
      savedEditorRange = null;
    }
    syncDocumentHeaderSpacing();
    scheduleSave();
  }
  function isDocumentRegionBandClick(region, clientY) {
    const pageBounds = editor.getBoundingClientRect();
    const pageScale = pageBounds.height / Math.max(editor.offsetHeight, 1);
    const styles = getComputedStyle(editor);
    const regionBounds = region.getBoundingClientRect();
    if (region.dataset.documentRegion === 'header') {
      const bandBottom = Math.max(
        pageBounds.top + rulerPixels(styles.paddingTop) * pageScale,
        regionBounds.bottom
      );
      return clientY >= pageBounds.top && clientY <= bandBottom;
    }
    const bandTop = Math.min(
      pageBounds.bottom - rulerPixels(styles.paddingBottom) * pageScale,
      regionBounds.top
    );
    return clientY >= bandTop && clientY <= pageBounds.bottom;
  }
  document.addEventListener('pointerdown', (event) => {
    const region = editor.querySelector('[data-document-region][contenteditable="true"]');
    if (!region || region.contains(event.target) || !editor.contains(event.target)) return;
    if (isDocumentRegionBandClick(region, event.clientY)) return;
    rememberEditorSelection();
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (target?.closest('.ribbon, .context-toolbar, .insert-menu, .layout-menu')) return;
    lockDocumentRegion(region);
    if (editor.contains(event.target)) editor.dataset.documentEditing = 'body';
    else delete editor.dataset.documentEditing;
  }, true);
  function removeDocumentRegion(name) {
    const region = editor.querySelector(`.document-${name}`);
    if (!region) return;
    lockDocumentRegion(region);
    if (savedEditorRange && region.contains(savedEditorRange.commonAncestorContainer)) savedEditorRange = null;
    region.remove();
    syncDocumentHeaderSpacing();
    updateCounts();
    scheduleSave();
  }
  const headerInsertButton = document.getElementById('header-insert-button');
  const footerInsertButton = document.getElementById('footer-insert-button');
  const documentRegionMenus = [document.getElementById('header-template-menu'), document.getElementById('footer-template-menu')];
  documentRegionMenus.forEach((menu) => {
    menu.querySelectorAll('[data-document-template]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const name = menu.dataset.documentRegion;
        const region = ensureDocumentRegion(name);
        setDocumentRegionTemplate(region, button.dataset.documentTemplate);
        closeInsertMenus();
        focusDocumentRegion(region);
        updateCounts();
        scheduleSave();
      });
    });
    menu.querySelectorAll('[data-document-region-action]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        const name = menu.dataset.documentRegion;
        closeInsertMenus();
        if (button.dataset.documentRegionAction === 'remove') {
          removeDocumentRegion(name);
          return;
        }
        focusDocumentRegion(ensureDocumentRegion(name));
      });
    });
  });
  editor.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const region = target?.closest('[data-document-region]');
    if (!region || !editor.contains(region) ||
      region.getAttribute('contenteditable') === 'true' &&
      editor.dataset.documentEditing === region.dataset.documentRegion) return;
    focusDocumentRegion(region, event.clientX, event.clientY);
    event.preventDefault();
  });
  editor.addEventListener('dblclick', (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const region = target?.closest('[data-document-region]');
    if (region && editor.contains(region)) {
      focusDocumentRegion(region);
      event.preventDefault();
      return;
    }
    const pageBounds = editor.getBoundingClientRect();
    const pageScale = pageBounds.height / Math.max(editor.offsetHeight, 1);
    const headerAreaHeight = rulerPixels(getComputedStyle(editor).paddingTop) * pageScale;
    const footerAreaHeight = rulerPixels(getComputedStyle(editor).paddingBottom) * pageScale;
    if (event.clientY >= pageBounds.top && event.clientY <= pageBounds.top + headerAreaHeight) {
      focusDocumentRegion(ensureDocumentRegion('header'));
      event.preventDefault();
      return;
    }
    if (event.clientY >= pageBounds.bottom - footerAreaHeight && event.clientY <= pageBounds.bottom) {
      focusDocumentRegion(ensureDocumentRegion('footer'));
      event.preventDefault();
    }
  });
  editor.addEventListener('focusout', (event) => {
    const region = event.target.closest('[data-document-region]');
    if (!region || region.contains(event.relatedTarget) || event.relatedTarget === editor ||
      !editor.contains(event.relatedTarget)) return;
    const nextTarget = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (nextTarget?.closest('.ribbon, .context-toolbar, .insert-menu, .layout-menu')) return;
    lockDocumentRegion(region);
  });
  editor.addEventListener('focusin', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const region = target?.closest('[data-document-region]');
    if (region?.getAttribute('contenteditable') === 'true' ||
      editor.getAttribute('contenteditable') === 'false') return;
    editor.dataset.documentEditing = 'body';
  });
  editor.addEventListener('input', (event) => {
    editor.querySelectorAll('[data-document-region]').forEach((region) => {
      region.dataset.empty = String(!region.textContent.trim());
    });
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const header = target?.closest('.document-header:not([data-page-number-location])');
    if (header && editor.contains(header)) syncDocumentHeaderSpacing();
  });
  document.getElementById('image-button').addEventListener('click', () => {
    const workspace = document.querySelector('.document-workspace');
    const workspaceBounds = workspace.getBoundingClientRect();
    const pageBounds = editor.getBoundingClientRect();
    const visibleLeft = Math.max(workspaceBounds.left + workspace.clientLeft, pageBounds.left);
    const visibleRight = Math.min(workspaceBounds.right, pageBounds.right);
    const visibleTop = Math.max(workspaceBounds.top + workspace.clientTop, pageBounds.top);
    const visibleBottom = Math.min(workspaceBounds.bottom, pageBounds.bottom);
    const scaleX = pageBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = pageBounds.height / Math.max(editor.offsetHeight, 1);
    pendingImagePosition = {
      centerX: (visibleLeft + visibleRight - 2 * pageBounds.left) / (2 * scaleX),
      centerY: (visibleTop + visibleBottom - 2 * pageBounds.top) / (2 * scaleY),
      scrollTop: workspace.scrollTop,
      scrollLeft: workspace.scrollLeft
    };
    document.getElementById('image-input').click();
  });
  let pendingImagePosition = null;
  const placeImageInVisibleArea = (image, position) => {
    if (!position || !editor.contains(image)) return;
    const workspace = document.querySelector('.document-workspace');
    workspace.scrollTop = position.scrollTop;
    workspace.scrollLeft = position.scrollLeft;
    const maxLeft = Math.max(0, editor.clientWidth - image.offsetWidth);
    const maxTop = Math.max(0, editor.clientHeight - image.offsetHeight);
    image.style.left = `${Math.max(0, Math.min(maxLeft, position.centerX - image.offsetWidth / 2))}px`;
    image.style.top = `${Math.max(0, Math.min(maxTop, position.centerY - image.offsetHeight / 2))}px`;
  };
  document.getElementById('image-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      window.alert('Please select a PNG, JPEG, GIF, or WebP image.');
      pendingImagePosition = null;
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Image size must be under 2 MB.');
      pendingImagePosition = null;
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    const imagePosition = pendingImagePosition;
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        insertHtml(`<img src="${reader.result}" alt="Inserted image" width="240" data-image-wrap="inline" data-image-align="center" data-pending-image="true">`);
        activeImage = editor.querySelector('img[data-pending-image="true"]');
        if (activeImage) {
          activeImage.removeAttribute('data-pending-image');
          activeImage.setAttribute('contenteditable', 'false');
          setImageWrap(activeImage, 'free');
          const insertedImage = activeImage;
          placeImageInVisibleArea(insertedImage, imagePosition);
          if (!activeImage.complete) {
            insertedImage.addEventListener('load', () => {
              placeImageInVisibleArea(insertedImage, imagePosition);
              if (activeImage === insertedImage) refreshImageManipulators(insertedImage);
            }, { once: true });
          }
          showImageToolbar(insertedImage);
        }
      }
      pendingImagePosition = null;
    });
    reader.addEventListener('error', () => {
      pendingImagePosition = null;
      window.alert('Could not read the image.');
    });
    reader.readAsDataURL(file);
    event.target.value = '';
  });
  let activeImage = null;
  let activeShape = null;
  let imageCropMode = false;
  let activeTableCell = null;
  let activeCaretTableCell = null;
  let activeTable = null;
  let selectedObject = null;
  let selectedTableBand = null;
  const tableToolbar = document.getElementById('table-context-toolbar');
  const imageToolbar = document.getElementById('image-context-toolbar');
  const imageManipulators = document.getElementById('image-manipulators');
  const shapeManipulators = document.getElementById('shape-manipulators');
  const shapeToolbar = document.getElementById('shape-context-toolbar');
  const imageRotationIndicator = document.getElementById('image-rotation-indicator');
  const watermarkToolbar = document.getElementById('watermark-context-toolbar');
  const watermarkManipulators = document.getElementById('watermark-manipulators');
  const watermarkDialog = document.getElementById('watermark-dialog');
  const tableManipulators = document.getElementById('table-manipulators');
  const selectObjectsToggle = document.getElementById('select-objects-toggle');
  const tableCaretOverlay = document.createElement('span');
  tableCaretOverlay.className = 'table-caret-overlay';
  tableCaretOverlay.setAttribute('aria-hidden', 'true');
  tableCaretOverlay.hidden = true;
  document.body.append(tableCaretOverlay);
  let tableCaretStabilizationTimer = 0;
  const stabilizeTableCaret = () => {
    if (tableCaretOverlay.hidden) return;
    document.body.classList.add('table-caret-stable');
    window.clearTimeout(tableCaretStabilizationTimer);
    tableCaretStabilizationTimer = window.setTimeout(() => {
      document.body.classList.remove('table-caret-stable');
    }, 250);
  };
  const tableLayoutPanel = document.querySelector('[data-panel="table-layout"]');
  const tableLayoutTab = document.getElementById('table-layout-tab');
  const shapeFormatTab = document.getElementById('shape-format-tab');
  const textboxFormatTab = document.getElementById('textbox-format-tab');
  const pictureFormatTab = document.getElementById('picture-format-tab');
  const hideShapeFormatTabs = () => {
    shapeFormatTab.hidden = true;
    textboxFormatTab.hidden = true;
  };
  const MIN_TABLE_ROW_HEIGHT = 20;
  const tableTextMetricsContext = document.createElement('canvas').getContext('2d');
  const normalizeTableCellTextBlocks = (table) => {
    const blockTags = /^(?:P|DIV|UL|OL|LI|H[1-6]|BLOCKQUOTE|TABLE)$/;
    table.querySelectorAll('td, th').forEach((cell) => {
      if (Array.from(cell.children).some((child) => blockTags.test(child.tagName))) return;
      if (!Array.from(cell.childNodes).some((node) =>
        node.nodeType === Node.TEXT_NODE ? node.textContent.trim() : node instanceof Element)) return;
      const paragraph = document.createElement('p');
      const selection = window.getSelection();
      const range = selection?.rangeCount && cell.contains(selection.anchorNode)
        ? selection.getRangeAt(0).cloneRange()
        : null;
      while (cell.firstChild) paragraph.append(cell.firstChild);
      cell.append(paragraph);
      if (range && selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  };
  const updateTableTextMetrics = (table) => {
    table.querySelectorAll('td > p, th > p').forEach((paragraph) => {
      const textNodes = [];
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode.textContent.trim()) textNodes.push(textNode);
        textNode = walker.nextNode();
      }
      const caretSpans = Array.from(paragraph.querySelectorAll('[data-format-caret="true"]'));
      if ((!textNodes.length && !caretSpans.length) || !tableTextMetricsContext) {
        paragraph.classList.remove('table-ink-metrics');
        paragraph.style.removeProperty('--table-text-line-height');
        paragraph.style.removeProperty('--table-text-ink-offset');
        return;
      }

      let lineHeight = 0;
      let inkOffset = 0;
      textNodes.forEach((node) => {
        const style = getComputedStyle(node.parentElement || paragraph);
        tableTextMetricsContext.font = style.font;
        const metrics = tableTextMetricsContext.measureText(node.textContent);
        const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        const fontHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
        if (!(inkHeight > 0) || !(fontHeight > 0)) return;
        const offset = (inkHeight - fontHeight) / 2 +
          metrics.fontBoundingBoxAscent - metrics.actualBoundingBoxAscent;
        if (inkHeight > lineHeight) {
          lineHeight = inkHeight;
          inkOffset = offset;
        }
      });
      caretSpans.forEach((span) => {
        const fontSize = Number.parseFloat(getComputedStyle(span).fontSize) || 0;
        lineHeight = Math.max(lineHeight, fontSize * 1.2);
      });

      if (!(lineHeight > 0)) {
        paragraph.classList.remove('table-ink-metrics');
        paragraph.style.removeProperty('--table-text-line-height');
        paragraph.style.removeProperty('--table-text-ink-offset');
        return;
      }
      paragraph.classList.add('table-ink-metrics');
      paragraph.style.setProperty('--table-text-line-height', `${lineHeight}px`);
      paragraph.style.setProperty('--table-text-ink-offset', `${inkOffset}px`);
    });
    table.querySelectorAll('td, th').forEach((cell) => {
      let fontSize = 0;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        if (textNode.textContent.trim()) {
          fontSize = Math.max(
            fontSize,
            Number.parseFloat(getComputedStyle(textNode.parentElement || cell).fontSize) || 0
          );
        }
        textNode = walker.nextNode();
      }
      if (fontSize > 0) {
        cell.style.setProperty('--table-text-top-padding', `${Math.max(3, fontSize * 0.3)}px`);
      } else {
        cell.style.removeProperty('--table-text-top-padding');
      }
    });
  };
  const getMinimumTableRowHeight = (row) => {
    let minHeight = Array.from(row.cells).some((cell) => cell.textContent.trim())
      ? 0
      : MIN_TABLE_ROW_HEIGHT;
    Array.from(row.cells).forEach((cell) => {
      const style = getComputedStyle(cell);
      const children = Array.from(cell.children).filter((child) =>
        /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|UL|OL)$/.test(child.tagName));
      let contentHeight = 0;
      if (children.length) {
        const bounds = children.map((child) => child.getBoundingClientRect());
        contentHeight = Math.max(...bounds.map((rect) => rect.bottom)) -
          Math.min(...bounds.map((rect) => rect.top));
      } else if (cell.textContent.trim()) {
        const contentRange = document.createRange();
        contentRange.selectNodeContents(cell);
        const contentRects = Array.from(contentRange.getClientRects());
        const lineTops = new Set(contentRects.map((rect) => Math.round(rect.top)));
        const lineHeight = Math.max(
          Number.parseFloat(style.lineHeight) || 0,
          ...Array.from(cell.querySelectorAll('*'), (element) =>
            Number.parseFloat(getComputedStyle(element).lineHeight) || 0)
        );
        contentHeight = lineHeight * Math.max(1, lineTops.size);
      }
      const cellInsets = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        Math.max(parseFloat(style.borderTopWidth), parseFloat(style.borderBottomWidth));
      minHeight = Math.max(minHeight, Math.ceil((contentHeight + cellInsets) / Math.max(1, cell.rowSpan)));
    });
    return minHeight;
  };
  const releaseContentSizedRows = (table, includeManuallySizedRows = false) => {
    Array.from(table.rows).forEach((row) => {
      if (!includeManuallySizedRows && row.dataset.tableRowHeight === 'manual') return;
      delete row.dataset.tableRowHeight;
      row.style.height = '';
      Array.from(row.cells).forEach((cell) => { cell.style.height = ''; });
    });
  };
  const normalizeTableRowHeights = (table) => {
    normalizeTableCellTextBlocks(table);
    updateTableTextMetrics(table);
    Array.from(table.rows).forEach((row) => {
      const minHeight = getMinimumTableRowHeight(row);
      if (row.getBoundingClientRect().height < minHeight) {
        row.style.height = `${minHeight}px`;
        Array.from(row.cells).forEach((cell) => { cell.style.height = `${minHeight}px`; });
      }
    });
  };
  editor.querySelectorAll('table').forEach((table) => {
    releaseContentSizedRows(table);
    normalizeTableRowHeights(table);
  });
  document.fonts.ready.then(() => {
    editor.querySelectorAll('table').forEach((table) => {
      releaseContentSizedRows(table);
      normalizeTableRowHeights(table);
    });
  });
  const MAX_TABLE_DIMENSION = 20;
  const MAX_TABLE_CELLS = 400;
  const TABLE_STYLE_PRESETS = {
    grid: { border: '#000000', header: '#e7e7e7', band: '#f5f5f5', first: '#eeeeee', last: '#eeeeee', total: '#e7e7e7' },
    light: { border: '#aeb6c5', header: '#e8eef5', band: '#f6f8fa', first: '#edf2f7', last: '#edf2f7', total: '#e8eef5' },
    banded: { border: '#000000', header: '#dddddd', band: '#f0f0f0', first: '#e8e8e8', last: '#e8e8e8', total: '#dddddd' },
    medium: { border: '#465c6e', header: '#c4d3e0', band: '#eaf0f5', first: '#dce6ee', last: '#dce6ee', total: '#c4d3e0' },
    dark: { border: '#26313b', header: '#aeb8c1', band: '#dfe4e8', first: '#cbd2d8', last: '#cbd2d8', total: '#aeb8c1' },
    accent: { border: '#345f7a', header: '#cde2ef', band: '#eef6fa', first: '#dcecf4', last: '#dcecf4', total: '#cde2ef' },
    plain: { border: '#000000', header: '#ffffff', band: '#ffffff', first: '#ffffff', last: '#ffffff', total: '#ffffff' }
  };
  const syncTableDesignControls = (table) => {
    if (!table) return;
    const style = table.dataset.tableStyle || 'grid';
    tableLayoutPanel.querySelectorAll('.table-style-option[data-table-style]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tableStyle === style));
    });
    document.querySelector('[data-color-picker="table-border"] .color-tool > span').style.backgroundColor =
      table.dataset.borderColor || TABLE_STYLE_PRESETS[style].border;
  };
  const applyTableDesign = (table) => {
    if (!table) return;
    const preset = TABLE_STYLE_PRESETS[table.dataset.tableStyle] || TABLE_STYLE_PRESETS.grid;
    const borderColor = table.dataset.borderColor || preset.border;
    table.dataset.borderColor = borderColor;
    table.style.setProperty('--table-border-color', borderColor);
    Array.from(table.rows).forEach((row, rowIndex) => Array.from(row.cells).forEach((cell) => {
      cell.style.backgroundColor = table.dataset.tableStyle === 'banded' && rowIndex % 2 === 1 ? preset.band : '';
    }));
    syncTableDesignControls(table);
    scheduleSave();
  };
  const positionTableToolbar = (cell) => {
    const rect = cell.getBoundingClientRect();
    const workspace = document.querySelector('.document-workspace').getBoundingClientRect();
    const status = document.querySelector('.status-bar').getBoundingClientRect();
    const topLimit = Math.max(8, workspace.top + 8);
    const bottomLimit = Math.max(topLimit + 120, status.top - 8);
    tableToolbar.style.maxHeight = `${bottomLimit - topLimit}px`;
    const panelHeight = tableToolbar.offsetHeight;
    tableToolbar.style.left = 'auto';
    tableToolbar.style.right = '8px';
    tableToolbar.style.top = `${Math.max(topLimit, Math.min(rect.top, bottomLimit - panelHeight))}px`;
  };
  const positionContextToolbar = (toolbar, anchor) => {
    const maxLeft = Math.max(8, window.innerWidth - toolbar.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - toolbar.offsetHeight - 8);
    const above = anchor.top - toolbar.offsetHeight - 6;
    const preferredTop = above >= 8 ? above : anchor.bottom + 6;
    toolbar.style.left = `${Math.max(8, Math.min(anchor.left, maxLeft))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(preferredTop, maxTop))}px`;
  };
  const positionWatermarkToolbar = (watermark) => {
    if (watermarkToolbar.hidden) return;
    const anchor = watermark.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - watermarkToolbar.offsetWidth - 8);
    const workspaceBounds = document.querySelector('.document-workspace').getBoundingClientRect();
    const minTop = Math.max(8, workspaceBounds.top + 8);
    const maxTop = Math.max(minTop, Math.min(
      window.innerHeight - watermarkToolbar.offsetHeight - 8,
      workspaceBounds.bottom - watermarkToolbar.offsetHeight - 8
    ));
    const gap = 52;
    const above = anchor.top - watermarkToolbar.offsetHeight - gap;
    const below = anchor.bottom + gap;
    const left = Math.max(8, Math.min(anchor.left, maxLeft));
    const handles = Array.from(watermarkManipulators.children, (handle) => handle.getBoundingClientRect())
      .filter((bounds) => bounds.right > left && bounds.left < left + watermarkToolbar.offsetWidth);
    const overlapsHandle = (top) => handles.some((bounds) =>
      top < bounds.bottom && top + watermarkToolbar.offsetHeight > bounds.top);
    const candidates = [above, below, minTop, maxTop]
      .map((top) => Math.max(minTop, Math.min(top, maxTop)));
    for (let top = minTop; top <= maxTop; top += 8) candidates.push(top);
    const top = candidates.find((candidate) => !overlapsHandle(candidate));
    watermarkToolbar.style.left = `${left}px`;
    watermarkToolbar.style.top = `${top ?? Math.max(minTop, Math.min(above, maxTop))}px`;
  };
  const positionImageToolbar = (anchor) => {
    if (imageToolbar.hidden) return;
    const gap = 46;
    const fitsRight = anchor.right + gap + imageToolbar.offsetWidth <= window.innerWidth - 8;
    const left = fitsRight ? anchor.right + gap : Math.max(8, anchor.left - imageToolbar.offsetWidth - gap);
    const top = Math.max(8, Math.min(
      (anchor.top + anchor.bottom - imageToolbar.offsetHeight) / 2,
      window.innerHeight - imageToolbar.offsetHeight - 8
    ));
    imageToolbar.style.left = `${left}px`;
    imageToolbar.style.top = `${top}px`;
  };
  let activeWatermark = null;
  let watermarkRotateDrag = null;
  let watermarkResizeDrag = null;
  const getWatermarkHandlePoint = (watermark, x, y) => {
    const bounds = watermark.getBoundingClientRect();
    const editorBounds = editor.getBoundingClientRect();
    const scaleX = editorBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = editorBounds.height / Math.max(editor.offsetHeight, 1);
    const angle = (Number(watermark.dataset.watermarkRotation) || 0) * Math.PI / 180;
    return {
      left: (bounds.left + bounds.right) / 2 + x * scaleX * Math.cos(angle) - y * scaleY * Math.sin(angle),
      top: (bounds.top + bounds.bottom) / 2 + x * scaleX * Math.sin(angle) + y * scaleY * Math.cos(angle)
    };
  };
  const clampFloatingHandle = (handle) => {
    const workspace = document.querySelector('.document-workspace');
    if (!workspace) return;
    const workspaceBounds = workspace.getBoundingClientRect();
    const clipLeft = Math.max(0, workspaceBounds.left + workspace.clientLeft);
    const clipTop = Math.max(0, workspaceBounds.top + workspace.clientTop);
    const clipRight = Math.min(window.innerWidth, clipLeft + workspace.clientWidth);
    const clipBottom = Math.min(window.innerHeight, clipTop + workspace.clientHeight);
    const handleBounds = handle.getBoundingClientRect();
    const offsetLeft = Math.min(Math.max(handleBounds.left, clipLeft), clipRight - handle.offsetWidth);
    const offsetTop = Math.min(Math.max(handleBounds.top, clipTop), clipBottom - handle.offsetHeight);
    if (offsetLeft !== handleBounds.left || offsetTop !== handleBounds.top) {
      handle.style.left = `${offsetLeft}px`;
      handle.style.top = `${offsetTop}px`;
    }
  };
  const refreshWatermarkManipulators = (watermark) => {
    watermarkManipulators.replaceChildren();
    watermarkManipulators.hidden = !watermark || !editor.contains(watermark);
    if (watermarkManipulators.hidden) return;
    const editorBounds = editor.getBoundingClientRect();
    const scaleX = editorBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = editorBounds.height / Math.max(editor.offsetHeight, 1);
    const height = watermark.offsetHeight;
    const locked = watermark.dataset.watermarkLocked === 'true';
    const addControlHandle = (action, label, icon, x) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'watermark-control-handle';
      handle.dataset[action] = 'true';
      handle.setAttribute('aria-label', label);
      handle.title = label;
      if (action === 'watermarkLockToggle') handle.setAttribute('aria-pressed', String(locked));
      handle.innerHTML = icon;
      const point = getWatermarkHandlePoint(watermark, x, -height / 2 - 30);
      handle.style.left = `${point.left}px`;
      handle.style.top = `${point.top}px`;
      watermarkManipulators.append(handle);
      clampFloatingHandle(handle);
    };
    const lockIcon = locked
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2"/></svg>';
    if (locked) {
      addControlHandle('watermarkLockToggle', 'Unlock watermark', lockIcon, 0);
      return;
    }
    addControlHandle('watermarkLockToggle', 'Lock watermark', lockIcon, -36);
    addControlHandle('watermarkRotateHandle',
      'Rotate watermark',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 1-2-5l3 5"/></svg>',
      0);
    addControlHandle('watermarkMoreToggle',
      'Watermark options',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
      36);
    const resizeHandle = document.createElement('button');
    resizeHandle.type = 'button';
    resizeHandle.className = 'watermark-control-handle';
    resizeHandle.dataset.watermarkResizeHandle = 'true';
    resizeHandle.setAttribute('aria-label', 'Resize watermark');
    resizeHandle.title = 'Resize watermark';
    resizeHandle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5"/><path d="M12 19h7V12"/><path d="M5 12v7h7"/></svg>';
    const resizePoint = getWatermarkHandlePoint(watermark, watermark.offsetWidth / 2 + 8 / scaleX,
      watermark.offsetHeight / 2 + 8 / scaleY);
    resizeHandle.style.left = `${resizePoint.left}px`;
    resizeHandle.style.top = `${resizePoint.top}px`;
    watermarkManipulators.append(resizeHandle);
    clampFloatingHandle(resizeHandle);
  };
  const getWatermarkDirection = (text) => /[\u0590-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u.test(text) ? 'rtl' : 'ltr';
  const showWatermarkToolbar = (watermark) => {
    if (activeShape) activeShape.classList.remove('shape-selected');
    activeShape = null;
    hideShapeFormatTabs();
    shapeToolbar.hidden = true;
    shapeManipulators.hidden = true;
    shapeManipulators.replaceChildren();
    if (activeImage) activeImage.classList.remove('image-selected', 'image-crop-active');
    activeImage = null;
    imageCropMode = false;
    pictureFormatTab.hidden = true;
    if (pictureFormatTab.classList.contains('active')) {
      activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
    }
    imageToolbar.hidden = true;
    imageManipulators.hidden = true;
    tableToolbar.hidden = true;
    activeTable = null;
    activeTableCell = null;
    document.body.classList.remove('table-tools-open');
    tableManipulators.replaceChildren();
    if (activeWatermark && activeWatermark !== watermark) {
      activeWatermark.classList.remove('watermark-selected');
    }
    activeWatermark = watermark;
    const isLocked = watermark.dataset.watermarkLocked === 'true';
    activeWatermark.classList.toggle('watermark-selected', !isLocked);
    watermarkToolbar.hidden = true;
    watermarkToolbar.querySelector('[data-watermark-edit-panel]').hidden = true;
    const isText = watermark.dataset.watermark === 'text';
    const opacity = Math.round(Number(watermark.dataset.watermarkOpacity || 0.25) * 100);
    document.getElementById('watermark-edit-text-field').hidden = isLocked || !isText;
    document.getElementById('watermark-edit-text').value = isText ? watermark.textContent : '';
    applyWatermarkTextDirection(watermarkEditTextInput, getWatermarkDirection(watermark.textContent));
    document.getElementById('watermark-edit-opacity').value = String(opacity);
    document.getElementById('watermark-edit-opacity-value').value = `${opacity}%`;
    refreshWatermarkManipulators(watermark);
  };
  const insertWatermark = (type, value, opacity) => {
    const existingWatermark = editor.querySelector('[data-watermark]');
    if (existingWatermark) {
      showWatermarkToolbar(existingWatermark);
      return existingWatermark;
    }
    let watermark;
    if (type === 'text') {
      watermark = document.createElement('div');
      watermark.textContent = value;
      watermark.dir = getWatermarkDirection(value);
      watermark.lang = watermark.dir === 'rtl' ? 'ur' : 'en';
      watermark.style.fontSize = '56px';
      watermark.style.fontWeight = '700';
      watermark.style.color = '#777777';
    } else {
      watermark = document.createElement('img');
      watermark.src = value;
      watermark.alt = 'Watermark';
      watermark.width = 200;
    }
    watermark.dataset.watermark = type;
    watermark.dataset.watermarkCentered = 'true';
    watermark.dataset.watermarkOpacity = (opacity / 100).toFixed(2);
    watermark.dataset.watermarkRotation = '0';
    watermark.tabIndex = 0;
    watermark.setAttribute('role', 'button');
    watermark.setAttribute('aria-label',
      `${type === 'image' ? 'Image' : 'Text'} watermark. Press Enter to open controls.`);
    watermark.contentEditable = 'false';
    watermark.style.position = 'absolute';
    watermark.style.left = '50%';
    watermark.style.transformOrigin = 'center';
    watermark.style.opacity = watermark.dataset.watermarkOpacity;
    if (activeWatermark) activeWatermark.classList.remove('watermark-selected');
    activeWatermark = null;
    watermarkToolbar.hidden = true;
    watermarkManipulators.hidden = true;
    watermarkManipulators.replaceChildren();
    editor.append(watermark);
    const centerWatermark = () => {
      watermark.style.left = '50%';
      watermark.style.top = `${Math.max(0, (editor.offsetHeight - watermark.offsetHeight) / 2)}px`;
      if (activeWatermark === watermark) refreshWatermarkManipulators(watermark);
    };
    if (watermark instanceof HTMLImageElement && !watermark.complete) {
      watermark.addEventListener('load', centerWatermark, { once: true });
    }
    centerWatermark();
    scheduleSave();
    return watermark;
  };
  document.getElementById('watermark-button').addEventListener('click', () => {
    const existingWatermark = editor.querySelector('[data-watermark]');
    if (existingWatermark) {
      showWatermarkToolbar(existingWatermark);
      return;
    }
    watermarkDialog.showModal();
  });
  const watermarkPreview = document.getElementById('watermark-preview');
  const watermarkPreviewText = document.getElementById('watermark-preview-text');
  const watermarkPreviewImage = document.getElementById('watermark-preview-image');
  const watermarkTextInput = document.getElementById('watermark-text');
  const watermarkEditTextInput = document.getElementById('watermark-edit-text');
  const applyWatermarkTextDirection = (input, direction) => {
    input.dir = direction;
    input.lang = direction === 'rtl' ? 'ur' : 'en';
  };
  const enableUrduTyping = (input) => {
    input.addEventListener('keydown', (event) => {
      if (!urduTyping || event.ctrlKey || event.metaKey || event.altKey || event.isComposing ||
        event.key.length !== 1) return;
      const output = UrduKeyboardLayout.mapKey(event);
      if (output === event.key) return;
      event.preventDefault();
      input.setRangeText(output, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const updateWatermarkPreview = () => {
    const imageMode = document.querySelector('input[name="watermark-kind"]:checked').value === 'image';
    watermarkPreviewText.hidden = imageMode;
    watermarkPreviewImage.hidden = !imageMode || !watermarkPreviewImage.hasAttribute('src');
    watermarkPreviewText.textContent = watermarkTextInput.value || ' ';
    applyWatermarkTextDirection(watermarkPreviewText, getWatermarkDirection(watermarkTextInput.value));
    const opacity = String(Number(document.getElementById('watermark-opacity').value) / 100);
    watermarkPreviewText.style.opacity = opacity;
    watermarkPreviewImage.style.opacity = opacity;
  };
  enableUrduTyping(document.getElementById('shape-text'));
  enableUrduTyping(watermarkTextInput);
  enableUrduTyping(watermarkEditTextInput);
  const toggleWatermarkLock = (watermark) => {
    if (!watermark || !editor.contains(watermark)) return;
    if (watermark.dataset.watermarkLocked === 'true') delete watermark.dataset.watermarkLocked;
    else watermark.dataset.watermarkLocked = 'true';
    showWatermarkToolbar(watermark);
    scheduleSave();
  };
  watermarkManipulators.addEventListener('click', (event) => {
    const lockHandle = event.target.closest('[data-watermark-lock-toggle]');
    const moreHandle = event.target.closest('[data-watermark-more-toggle]');
    if (lockHandle) {
      event.preventDefault();
      event.stopPropagation();
      toggleWatermarkLock(activeWatermark);
      return;
    }
    if (!moreHandle || !activeWatermark || activeWatermark.dataset.watermarkLocked === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    const editPanel = watermarkToolbar.querySelector('[data-watermark-edit-panel]');
    const open = editPanel.hidden;
    watermarkToolbar.hidden = !open;
    editPanel.hidden = !open;
    if (open) positionWatermarkToolbar(activeWatermark);
  });
  document.querySelectorAll('input[name="watermark-kind"]').forEach((input) => {
    input.addEventListener('change', () => {
      const isImage = input.value === 'image' && input.checked;
      document.getElementById('watermark-text-field').hidden = isImage;
      document.getElementById('watermark-image-field').hidden = !isImage;
      updateWatermarkPreview();
    });
  });
  watermarkTextInput.addEventListener('input', updateWatermarkPreview);
  applyWatermarkTextDirection(watermarkTextInput, getWatermarkDirection(watermarkTextInput.value));
  document.getElementById('watermark-opacity').addEventListener('input', (event) => {
    document.getElementById('watermark-opacity-value').value = `${event.currentTarget.value}%`;
    updateWatermarkPreview();
  });
  document.getElementById('watermark-image-file').addEventListener('change', (event) => {
    const file = event.currentTarget.files[0];
    if (!file || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      watermarkPreviewImage.removeAttribute('src');
      updateWatermarkPreview();
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return;
      watermarkPreviewImage.src = reader.result;
      updateWatermarkPreview();
    });
    reader.addEventListener('error', () => window.alert('Could not preview the watermark image.'));
    reader.readAsDataURL(file);
  });
  updateWatermarkPreview();
  document.getElementById('watermark-cancel').addEventListener('click', () => watermarkDialog.close());
  document.getElementById('watermark-insert').addEventListener('click', () => {
    const type = document.querySelector('input[name="watermark-kind"]:checked').value;
    const opacity = Number(document.getElementById('watermark-opacity').value);
    if (type === 'text') {
      const text = document.getElementById('watermark-text').value.trim();
      if (!text) {
        showToast('Enter text for the watermark.');
        return;
      }
      watermarkDialog.close();
      insertWatermark('text', text, opacity);
      return;
    }
    const file = document.getElementById('watermark-image-file').files[0];
    if (!file) {
      showToast('Choose an image for the watermark.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      window.alert('Please select a PNG, JPEG, GIF, or WebP image for the watermark.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Watermark image size must be under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return;
      watermarkDialog.close();
      insertWatermark('image', reader.result, opacity);
    });
    reader.addEventListener('error', () => window.alert('Could not read the watermark image.'));
    reader.readAsDataURL(file);
  });
  watermarkManipulators.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-watermark-lock-toggle]')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (activeWatermark?.dataset.watermarkLocked === 'true') return;
    const rotateHandle = event.target.closest('[data-watermark-rotate-handle]');
    if (rotateHandle && activeWatermark && editor.contains(activeWatermark)) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = activeWatermark.getBoundingClientRect();
      watermarkRotateDrag = {
        watermark: activeWatermark,
        pointerId: event.pointerId,
        centerX: (bounds.left + bounds.right) / 2,
        centerY: (bounds.top + bounds.bottom) / 2,
        lastPointerAngle: Math.atan2(event.clientY - (bounds.top + bounds.bottom) / 2,
          event.clientX - (bounds.left + bounds.right) / 2) * 180 / Math.PI,
        rotation: Number(activeWatermark.dataset.watermarkRotation) || 0
      };
      return;
    }
    const resizeHandle = event.target.closest('[data-watermark-resize-handle]');
    if (resizeHandle && activeWatermark && editor.contains(activeWatermark)) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = activeWatermark.getBoundingClientRect();
      const editorBounds = editor.getBoundingClientRect();
      const scaleX = editorBounds.width / Math.max(editor.offsetWidth, 1);
      watermarkResizeDrag = {
        watermark: activeWatermark,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: activeWatermark.offsetWidth,
        startFontSize: Number.parseFloat(getComputedStyle(activeWatermark).fontSize) || 56,
        scaleX: scaleX || 1,
        startBounds: bounds
      };
    }
  });
  document.addEventListener('pointermove', (event) => {
    if (watermarkRotateDrag && watermarkRotateDrag.pointerId === event.pointerId) {
      const drag = watermarkRotateDrag;
      const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) * 180 / Math.PI;
      let delta = angle - drag.lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      drag.rotation = (Math.round(drag.rotation + delta) % 360 + 360) % 360;
      drag.lastPointerAngle = angle;
      drag.watermark.dataset.watermarkRotation = String(drag.rotation);
      drag.watermark.style.rotate = `${drag.rotation}deg`;
      refreshWatermarkManipulators(drag.watermark);
      positionWatermarkToolbar(drag.watermark);
      event.preventDefault();
      return;
    }
    if (watermarkResizeDrag && watermarkResizeDrag.pointerId === event.pointerId) {
      const drag = watermarkResizeDrag;
      const deltaX = (event.clientX - drag.startX) / drag.scaleX;
      const deltaY = (event.clientY - drag.startY) / drag.scaleX;
      const dimension = Math.max(drag.startBounds.width / drag.scaleX,
        drag.startBounds.height / drag.scaleX, 1);
      const scale = Math.max(0.25, 1 + (deltaX + deltaY) / (2 * dimension));
      if (drag.watermark.dataset.watermark === 'text') {
        drag.watermark.style.fontSize = `${Math.max(12, Math.min(200, drag.startFontSize * scale))}px`;
      } else {
        drag.watermark.style.width = `${Math.max(32, drag.startWidth * scale)}px`;
        drag.watermark.style.height = 'auto';
      }
      refreshWatermarkManipulators(drag.watermark);
      if (!watermarkToolbar.hidden) positionWatermarkToolbar(drag.watermark);
      event.preventDefault();
    }
  });
  const finishWatermarkDrag = (event) => {
    if (watermarkRotateDrag && watermarkRotateDrag.pointerId === event.pointerId) {
      watermarkRotateDrag = null;
      scheduleSave();
    }
    if (watermarkResizeDrag && watermarkResizeDrag.pointerId === event.pointerId) {
      watermarkResizeDrag = null;
      scheduleSave();
    }
  };
  document.addEventListener('pointerup', finishWatermarkDrag);
  document.addEventListener('pointercancel', finishWatermarkDrag);
  document.getElementById('watermark-edit-text').addEventListener('input', (event) => {
    if (!activeWatermark || !editor.contains(activeWatermark) ||
      activeWatermark.dataset.watermarkLocked === 'true' || activeWatermark.dataset.watermark !== 'text') return;
    activeWatermark.textContent = event.currentTarget.value;
    activeWatermark.dir = getWatermarkDirection(event.currentTarget.value);
    activeWatermark.lang = activeWatermark.dir === 'rtl' ? 'ur' : 'en';
    applyWatermarkTextDirection(event.currentTarget, activeWatermark.dir);
    refreshWatermarkManipulators(activeWatermark);
    positionWatermarkToolbar(activeWatermark);
    scheduleSave();
  });
  document.getElementById('watermark-edit-opacity').addEventListener('input', (event) => {
    if (!activeWatermark || !editor.contains(activeWatermark) ||
      activeWatermark.dataset.watermarkLocked === 'true') return;
    const opacity = (Number(event.currentTarget.value) / 100).toFixed(2);
    activeWatermark.dataset.watermarkOpacity = opacity;
    activeWatermark.style.opacity = opacity;
    refreshWatermarkManipulators(activeWatermark);
    document.getElementById('watermark-edit-opacity-value').value = `${event.currentTarget.value}%`;
    scheduleSave();
  });
  const removeSelectedWatermark = () => {
    if (!activeWatermark || !editor.contains(activeWatermark) ||
      activeWatermark.dataset.watermarkLocked === 'true') return;
    activeWatermark.remove();
    activeWatermark = null;
    watermarkManipulators.hidden = true;
    watermarkManipulators.replaceChildren();
    watermarkToolbar.hidden = true;
    scheduleSave();
  };
  document.getElementById('watermark-delete').addEventListener('click', removeSelectedWatermark);
  const updateTableCellCaretHeight = (cell, caretStyle) => {
    const cellStyle = getComputedStyle(cell);
    const verticalPadding = Number.parseFloat(cellStyle.paddingTop) + Number.parseFloat(cellStyle.paddingBottom);
    const verticalBorders = Number.parseFloat(cellStyle.borderTopWidth) + Number.parseFloat(cellStyle.borderBottomWidth);
    const availableHeight = Math.max(1, cell.getBoundingClientRect().height - verticalPadding - verticalBorders);
    const fontSize = Number.parseFloat(caretStyle.fontSize) || Number.parseFloat(cellStyle.fontSize);
    const lineHeight = Number.parseFloat(caretStyle.lineHeight) || fontSize * 1.2;
    return Math.max(1, Math.min(availableHeight, fontSize * 1.25, lineHeight * 0.9));
  };
  const updateTableCaretOverlay = () => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const cell = anchor instanceof Element
      ? anchor.closest('td, th')
      : anchor?.parentElement?.closest('td, th');
    if (!selection || !selection.isCollapsed || !cell || !editor.contains(cell)) {
      tableCaretOverlay.hidden = true;
      if (activeCaretTableCell) activeCaretTableCell.classList.remove('table-caret-target');
      activeCaretTableCell = null;
      return;
    }
    if (cell.closest('table').classList.contains('table-caret-suspended')) {
      tableCaretOverlay.hidden = true;
      return;
    }
    if (activeCaretTableCell !== cell) {
      activeCaretTableCell?.classList.remove('table-caret-target');
      activeCaretTableCell = cell;
      activeCaretTableCell.classList.add('table-caret-target');
    }
    const range = selection.getRangeAt(0).cloneRange();
    const caretRect = range.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const caretElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const caretStyle = getComputedStyle(caretElement || cell);
    const caretHeight = updateTableCellCaretHeight(cell, caretStyle);
    const style = getComputedStyle(cell);
    const fallbackX = style.direction === 'rtl'
      ? cellRect.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth) - 1
      : cellRect.left + Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth) + 1;
    const caretX = caretRect.height ? caretRect.left : fallbackX;
    const left = Math.max(cellRect.left + 1, Math.min(cellRect.right - 2, caretX));
    const minTop = cellRect.top + Number.parseFloat(style.borderTopWidth) + 1;
    const maxTop = Math.max(minTop, cellRect.bottom - Number.parseFloat(style.borderBottomWidth) - caretHeight - 1);
    const caretLine = caretElement?.closest('p, li, h1, h2, h3, h4, h5, h6, blockquote, div');
    const fallbackTop = caretLine
      ? caretLine.getBoundingClientRect().top +
        (Number.parseFloat(getComputedStyle(caretLine).getPropertyValue('--table-text-ink-offset')) || 0)
      : cellRect.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop);
    const selectionTop = fallbackTop;
    const top = Math.max(minTop, Math.min(maxTop, selectionTop));
    tableCaretOverlay.style.left = `${left}px`;
    tableCaretOverlay.style.top = `${top}px`;
    tableCaretOverlay.style.height = `${caretHeight}px`;
    tableCaretOverlay.style.backgroundColor = style.color;
    tableCaretOverlay.hidden = false;
  };
  window.addEventListener('resize', updateTableCaretOverlay);
  document.addEventListener('scroll', updateTableCaretOverlay, true);
  const updateTableToolbar = (cell) => {
    activeTableCell = cell;
    if (activeCaretTableCell !== cell) {
      activeCaretTableCell?.classList.remove('table-caret-target');
      activeCaretTableCell = cell;
      activeCaretTableCell?.classList.add('table-caret-target');
    }
    if (cell) {
      updateTableCaretOverlay();
    } else {
      tableCaretOverlay.hidden = true;
    }
    tableToolbar.hidden = !cell;
    if (!cell) {
      activeTable = null;
      document.body.classList.remove('table-tools-open');
      tableManipulators.replaceChildren();
      return;
    }
    tableLayoutTab.hidden = false;
    activateRibbonTab(tableLayoutTab);
    const table = cell.closest('table');
    activeTable = table;
    document.body.classList.add('table-tools-open');
    syncTableDesignControls(table);
    document.getElementById('table-cell-align').value = cell.style.textAlign || 'right';
    const savedWidth = table.style.width || table.getAttribute('width') || '';
    const availableWidth = Math.max(1,
      editor.clientWidth - parseFloat(getComputedStyle(editor).paddingLeft) - parseFloat(getComputedStyle(editor).paddingRight));
    const percentageWidth = /^(\d+(?:\.\d+)?)%$/.exec(savedWidth);
    const tableWidth = percentageWidth
      ? Math.max(10, Math.min(100, Math.round(Number(percentageWidth[1]))))
      : Math.max(10, Math.min(100, Math.round(table.getBoundingClientRect().width / availableWidth * 100)));
    document.getElementById('table-width').value = String(tableWidth);
    document.getElementById('table-width-value').value = `${tableWidth}%`;
    document.getElementById('table-borders').value = table.dataset.borders || 'all';
    document.getElementById('table-border-width').value = table.dataset.borderWidth || '1';
    document.getElementById('table-border-color').value = table.dataset.borderColor || '#000000';
    document.getElementById('table-alignment').value = table.dataset.tableAlign || 'left';
    document.getElementById('table-autofit').value = table.dataset.tableAutofit || 'fixed';
    document.getElementById('table-repeat-header').checked = table.dataset.repeatHeader === 'true';
    const horizontalPadding = cell.style.paddingLeft || '4';
    document.getElementById('table-cell-padding').value = String(Number.parseFloat(horizontalPadding));
    document.getElementById('table-cell-padding-value').value = `${document.getElementById('table-cell-padding').value} px`;
    document.getElementById('table-cell-vertical').value = cell.style.verticalAlign || 'top';
    positionTableToolbar(cell);
    refreshTableManipulators(table);
  };
  const readImageCrop = (image) => (image.dataset.imageCrop || '0,0,0,0').split(',').map(Number);
  const applyImageCrop = (image, insets) => {
    const safeInsets = insets.map((inset) => Math.max(0, Math.min(45, Math.round(inset))));
    image.dataset.imageCrop = safeInsets.join(',');
    image.style.clipPath = `inset(${safeInsets[0]}% ${safeInsets[1]}% ${safeInsets[2]}% ${safeInsets[3]}%)`;
    document.getElementById('image-crop-reset').hidden = safeInsets.every((inset) => inset === 0);
  };
  const setImageRotation = (image, angle) => {
    const rotation = (Math.round(angle) % 360 + 360) % 360;
    image.dataset.imageRotation = String(rotation);
    image.style.rotate = `${rotation}deg`;
    imageRotationIndicator.textContent = `${rotation}°`;
    imageRotationIndicator.hidden = false;
    const point = getImageHandlePoint(image, 0, -image.offsetHeight / 2 - 30);
    imageRotationIndicator.style.left = `${point.left}px`;
    imageRotationIndicator.style.top = `${point.top}px`;
  };
  const getImageHandlePoint = (image, x, y) => {
    const bounds = image.getBoundingClientRect();
    const pageBounds = editor.getBoundingClientRect();
    const scaleX = pageBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = pageBounds.height / Math.max(editor.offsetHeight, 1);
    const width = image.offsetWidth;
    const height = image.offsetHeight;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const rotation = (Number(image.dataset.imageRotation) || 0) * Math.PI / 180;
    return {
      left: centerX + x * scaleX * Math.cos(rotation) - y * scaleY * Math.sin(rotation),
      top: centerY + x * scaleX * Math.sin(rotation) + y * scaleY * Math.cos(rotation),
      width,
      height,
      scaleX,
      scaleY,
      rotation
    };
  };
  const refreshImageManipulators = (image) => {
    imageManipulators.replaceChildren();
    imageManipulators.hidden = !image || !editor.contains(image);
    if (imageManipulators.hidden) return;
    const frame = getImageHandlePoint(image, 0, 0);
    const [cropTop, cropRight, cropBottom, cropLeft] = readImageCrop(image);
    const left = -frame.width / 2 + frame.width * cropLeft / 100;
    const right = frame.width / 2 - frame.width * cropRight / 100;
    const top = -frame.height / 2 + frame.height * cropTop / 100;
    const bottom = frame.height / 2 - frame.height * cropBottom / 100;
    [
      ['nw', left, top, 'top-left'],
      ['ne', right, top, 'top-right'],
      ['se', right, bottom, 'bottom-right'],
      ['sw', left, bottom, 'bottom-left']
    ].forEach(([corner, handleLeft, handleTop, label]) => {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `image-resize-handle image-resize-${corner}${imageCropMode ? ' image-crop-handle' : ''}`;
      handle.dataset.resizeCorner = corner;
      handle.dataset.resizeAction = imageCropMode ? 'crop' : 'resize';
      handle.setAttribute('aria-label', `${imageCropMode ? 'Crop' : 'Resize'} picture from ${label}`);
      const point = getImageHandlePoint(image, handleLeft, handleTop);
      imageManipulators.append(handle);
      positionImageHandle(handle, point);
    });
    if (imageCropMode) {
      [
        ['e', right, (top + bottom) / 2, 'middle-right'],
        ['w', left, (top + bottom) / 2, 'middle-left']
      ].forEach(([side, handleLeft, handleTop, label]) => {
        const handle = document.createElement('button');
        handle.type = 'button';
        handle.className = `image-resize-handle image-resize-${side} image-crop-handle`;
        handle.dataset.resizeCorner = side;
        handle.dataset.resizeAction = 'crop';
        handle.setAttribute('aria-label', `Crop picture from ${label}`);
        const point = getImageHandlePoint(image, handleLeft, handleTop);
        imageManipulators.append(handle);
        positionImageHandle(handle, point);
      });
    }
    if (!imageCropMode) {
      const rotateHandle = document.createElement('button');
      rotateHandle.type = 'button';
      rotateHandle.className = 'image-rotate-handle';
      rotateHandle.dataset.rotateHandle = 'true';
      rotateHandle.setAttribute('aria-label', 'Rotate picture');
      rotateHandle.textContent = '↻';
      const rotatePoint = getImageHandlePoint(image, frame.width / 2 + 26, 0);
      imageManipulators.append(rotateHandle);
      positionImageHandle(rotateHandle, rotatePoint);
    }
  };
  const positionImageHandle = (handle, point) => {
    handle.style.left = `${point.left}px`;
    handle.style.top = `${point.top}px`;
    handle.hidden = false;
    const workspace = document.querySelector('.document-workspace');
    if (!workspace) return;
    const workspaceBounds = workspace.getBoundingClientRect();
    const clipLeft = Math.max(0, workspaceBounds.left + workspace.clientLeft);
    const clipTop = Math.max(0, workspaceBounds.top + workspace.clientTop);
    const clipRight = Math.min(window.innerWidth, clipLeft + workspace.clientWidth);
    const clipBottom = Math.min(window.innerHeight, clipTop + workspace.clientHeight);
    const handleBounds = handle.getBoundingClientRect();
    handle.hidden = handleBounds.left < clipLeft || handleBounds.top < clipTop ||
      handleBounds.right > clipRight || handleBounds.bottom > clipBottom;
  };
  const ensureShapePosition = (shape) => {
    if (shape.style.left && shape.style.top) return;
    const bounds = shape.getBoundingClientRect();
    const pageBounds = editor.getBoundingClientRect();
    const scaleX = pageBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = pageBounds.height / Math.max(editor.offsetHeight, 1);
    shape.style.position = 'absolute';
    shape.style.left = `${Math.max(0, (bounds.left - pageBounds.left) / scaleX)}px`;
    shape.style.top = `${Math.max(0, (bounds.top - pageBounds.top) / scaleY)}px`;
  };
  const getShapeHandlePoint = (shape, x, y) => {
    const bounds = shape.getBoundingClientRect();
    const pageBounds = editor.getBoundingClientRect();
    const scaleX = pageBounds.width / Math.max(editor.offsetWidth, 1);
    const scaleY = pageBounds.height / Math.max(editor.offsetHeight, 1);
    const rotation = (Number(shape.dataset.shapeRotation) || 0) * Math.PI / 180;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    return {
      left: centerX + x * scaleX * Math.cos(rotation) - y * scaleY * Math.sin(rotation),
      top: centerY + x * scaleX * Math.sin(rotation) + y * scaleY * Math.cos(rotation),
      scaleX,
      scaleY,
      rotation
    };
  };
  const getShapeResizePoints = (shape) => {
    if (shape.dataset.shapeType === 'line') return [{ x: -1, y: 0 }, { x: 1, y: 0 }];
    const clipPath = getComputedStyle(shape).clipPath;
    const polygon = clipPath.match(/^polygon\((.*)\)$/i);
    if (polygon) {
      const points = polygon[1].split(',').map((point) => {
        const [x, y] = point.trim().split(/\s+/);
        const toNormalized = (value, size) => {
          const coordinate = Number.parseFloat(value);
          const ratio = value.endsWith('%') ? coordinate / 100 : coordinate / size;
          return Math.max(-1, Math.min(1, ratio * 2 - 1));
        };
        return { x: toNormalized(x, shape.offsetWidth), y: toNormalized(y, shape.offsetHeight) };
      });
      if (points.length >= 3 && points.length <= 64) return points;
    }
    return [
      { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
      { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      { x: -1, y: 1 }, { x: -1, y: 0 }
    ];
  };
  const positionShapeHandle = (handle, point) => {
    handle.style.left = `${point.left}px`;
    handle.style.top = `${point.top}px`;
    handle.hidden = false;
    const workspace = document.querySelector('.document-workspace');
    if (!workspace) return;
    const workspaceBounds = workspace.getBoundingClientRect();
    const clipLeft = Math.max(0, workspaceBounds.left + workspace.clientLeft);
    const clipTop = Math.max(0, workspaceBounds.top + workspace.clientTop);
    const clipRight = Math.min(window.innerWidth, clipLeft + workspace.clientWidth);
    const clipBottom = Math.min(window.innerHeight, clipTop + workspace.clientHeight);
    const handleBounds = handle.getBoundingClientRect();
    handle.hidden = handleBounds.left < clipLeft || handleBounds.top < clipTop ||
      handleBounds.right > clipRight || handleBounds.bottom > clipBottom;
  };
  const refreshShapeManipulators = (shape) => {
    shapeManipulators.replaceChildren();
    shapeManipulators.hidden = !shape || !editor.contains(shape);
    if (shapeManipulators.hidden) return;
    const width = shape.offsetWidth;
    const height = shape.offsetHeight;
    getShapeResizePoints(shape).forEach(({ x, y }, index) => {
      const horizontal = x < -0.01 ? 'w' : x > 0.01 ? 'e' : '';
      const vertical = y < -0.01 ? 'n' : y > 0.01 ? 's' : '';
      const corner = `${vertical}${horizontal}` || 'point';
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `image-resize-handle image-resize-${corner}`;
      handle.dataset.shapeResizeX = String(x);
      handle.dataset.shapeResizeY = String(y);
      handle.setAttribute('aria-label', `Resize shape at point ${index + 1}`);
      const point = getShapeHandlePoint(shape, x * width / 2, y * height / 2);
      shapeManipulators.append(handle);
      positionShapeHandle(handle, point);
    });
    const moveHandle = document.createElement('button');
    moveHandle.type = 'button';
    moveHandle.className = 'shape-move-handle';
    moveHandle.dataset.shapeMoveHandle = 'true';
    moveHandle.setAttribute('aria-label', 'Move shape');
    moveHandle.title = 'Move shape';
    moveHandle.textContent = '⠿';
    const movePoint = getShapeHandlePoint(shape, 0, -height / 2 - 28);
    shapeManipulators.append(moveHandle);
    positionShapeHandle(moveHandle, movePoint);
    const rotateHandle = document.createElement('button');
    rotateHandle.type = 'button';
    rotateHandle.className = 'image-rotate-handle';
    rotateHandle.dataset.shapeRotateHandle = 'true';
    rotateHandle.setAttribute('aria-label', 'Rotate shape');
    rotateHandle.textContent = '↻';
    const rotatePoint = getShapeHandlePoint(shape, width / 2 + 26, 0);
    shapeManipulators.append(rotateHandle);
    positionShapeHandle(rotateHandle, rotatePoint);

  };
  const showShapeToolbar = (shape) => {
    ensureShapePosition(shape);
    if (activeImage) activeImage.classList.remove('image-selected', 'image-crop-active');
    activeImage = null;
    imageCropMode = false;
    pictureFormatTab.hidden = true;
    imageToolbar.hidden = true;
    imageManipulators.hidden = true;
    imageManipulators.replaceChildren();
    if (activeWatermark) activeWatermark.classList.remove('watermark-selected');
    activeWatermark = null;
    watermarkToolbar.hidden = true;
    watermarkManipulators.hidden = true;
    watermarkManipulators.replaceChildren();
    tableToolbar.hidden = true;
    activeTable = null;
    activeTableCell = null;
    document.body.classList.remove('table-tools-open');
    tableManipulators.replaceChildren();
    if (activeShape && activeShape !== shape) activeShape.classList.remove('shape-selected');
    activeShape = shape;
    activeShape.classList.add('shape-selected');
    shapeToolbar.classList.toggle('is-textbox', shape.dataset.editorTextbox === 'true');
    shapeToolbar.hidden = true;
    document.getElementById('shape-fill-color').value = shape.dataset.shapeFill || '#dce8f5';
    document.getElementById('shape-line-color').value = shape.dataset.shapeLine || '#176b9a';
    const lineWidth = Number(shape.dataset.shapeLineWidth ?? 2);
    document.getElementById('shape-line-width').value = String(lineWidth);
    const textBoxBorderToggle = document.getElementById('textbox-border-toggle');
    textBoxBorderToggle.setAttribute('aria-pressed', String(lineWidth > 0));
    textBoxBorderToggle.textContent = lineWidth > 0 ? 'Remove border' : 'Show border';
    const opacity = Number(shape.dataset.shapeOpacity ?? 100);
    document.getElementById('shape-opacity').value = String(opacity);
    document.getElementById('shape-opacity-value').value = `${opacity}%`;
    document.getElementById('shape-text').value = shape.querySelector('[data-shape-label="true"]')?.textContent || '';
    const shapeTextColor = shape.querySelector('[data-shape-label="true"]')?.dataset.shapeTextColor || '#202124';
    document.getElementById('shape-ribbon-text-color').value = shapeTextColor;
    document.querySelector('[data-shape-color-swatch="text"]').style.backgroundColor = shapeTextColor;
    document.getElementById('shape-ribbon-fill').value = shape.dataset.shapeFill || '#dce8f5';
    document.querySelector('[data-shape-color-swatch="fill"]').style.backgroundColor =
      shape.dataset.shapeFill || '#dce8f5';
    document.getElementById('shape-ribbon-outline').value = shape.dataset.shapeLine || '#176b9a';
    document.querySelector('[data-shape-color-swatch="outline"]').style.backgroundColor =
      shape.dataset.shapeLine || '#176b9a';
    document.getElementById('shape-ribbon-outline-width').value = String(lineWidth);
    document.getElementById('shape-ribbon-shadow').checked = shape.dataset.shapeShadow === 'true';
    const isTextBox = shape.dataset.editorTextbox === 'true';
    shapeFormatTab.hidden = isTextBox;
    textboxFormatTab.hidden = !isTextBox;
    activateRibbonTab(isTextBox ? textboxFormatTab : shapeFormatTab);
    refreshShapeManipulators(shape);
  };
  let shapeResizeDrag = null;
  let shapeMoveDrag = null;
  let shapeRotateDrag = null;
  const setShapeRotation = (shape, angle) => {
    const rotation = (Math.round(angle) % 360 + 360) % 360;
    shape.dataset.shapeRotation = String(rotation);
    shape.style.rotate = `${rotation}deg`;
    imageRotationIndicator.textContent = `${rotation}°`;
    imageRotationIndicator.hidden = false;
    const point = getShapeHandlePoint(shape, 0, -shape.offsetHeight / 2 - 34);
    imageRotationIndicator.style.left = `${point.left}px`;
    imageRotationIndicator.style.top = `${point.top}px`;
  };
  const startShapeMove = (shape, event) => {
    ensureShapePosition(shape);
    const pageBounds = editor.getBoundingClientRect();
    shapeMoveDrag = {
      shape,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: Number.parseFloat(shape.style.left) || 0,
      top: Number.parseFloat(shape.style.top) || 0,
      scaleX: pageBounds.width / Math.max(editor.offsetWidth, 1),
      scaleY: pageBounds.height / Math.max(editor.offsetHeight, 1),
      moved: false
    };
  };
  let shapePointerDown = null;
  editor.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      shapePointerDown = null;
      return;
    }
    const shape = event.target.closest('.editor-shape');
    shapePointerDown = shape && editor.contains(shape)
      ? { shape, clientX: event.clientX, clientY: event.clientY }
      : null;
    if (!shapePointerDown) return;
    event.stopPropagation();
    ensureShapePosition(shape);
    showShapeToolbar(shape);
  });
  shapeManipulators.addEventListener('pointerdown', (event) => {
    const moveHandle = event.target.closest('[data-shape-move-handle]');
    if (moveHandle && activeShape && editor.contains(activeShape)) {
      event.preventDefault();
      event.stopPropagation();
      startShapeMove(activeShape, event);
      return;
    }
    const rotateHandle = event.target.closest('[data-shape-rotate-handle]');
    if (rotateHandle && activeShape && editor.contains(activeShape)) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = activeShape.getBoundingClientRect();
      shapeRotateDrag = {
        shape: activeShape,
        pointerId: event.pointerId,
        centerX: (bounds.left + bounds.right) / 2,
        centerY: (bounds.top + bounds.bottom) / 2,
        lastPointerAngle: Math.atan2(event.clientY - (bounds.top + bounds.bottom) / 2,
          event.clientX - (bounds.left + bounds.right) / 2) * 180 / Math.PI,
        rotation: Number(activeShape.dataset.shapeRotation) || 0,
        toolbarWasHidden: shapeToolbar.hidden
      };
      shapeManipulators.hidden = true;
      shapeToolbar.hidden = true;
      activeShape.classList.remove('shape-selected');
      return;
    }
    const handle = event.target.closest('.image-resize-handle[data-shape-resize-x]');
    if (!handle || !activeShape || !editor.contains(activeShape)) return;
    event.preventDefault();
    event.stopPropagation();
    ensureShapePosition(activeShape);
    const width = activeShape.offsetWidth;
    const height = activeShape.offsetHeight;
    const handleX = Number(handle.dataset.shapeResizeX);
    const handleY = Number(handle.dataset.shapeResizeY);
    const fixedPoint = getShapeHandlePoint(activeShape, -handleX * width / 2, -handleY * height / 2);
    shapeResizeDrag = {
      pointerId: event.pointerId,
      handleX,
      handleY,
      startX: event.clientX,
      startY: event.clientY,
      width,
      height,
      scaleX: fixedPoint.scaleX,
      scaleY: fixedPoint.scaleY,
      rotation: fixedPoint.rotation,
      fixedPoint: { left: fixedPoint.left, top: fixedPoint.top }
    };
  });
  document.addEventListener('pointermove', (event) => {
    if (shapeMoveDrag && shapeMoveDrag.pointerId === event.pointerId) {
      const drag = shapeMoveDrag;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      const width = drag.shape.offsetWidth;
      const height = drag.shape.offsetHeight;
      drag.shape.style.left = `${Math.max(0, Math.min(editor.offsetWidth - width,
        drag.left + dx / drag.scaleX))}px`;
      drag.shape.style.top = `${Math.max(0, Math.min(editor.offsetHeight - height,
        drag.top + dy / drag.scaleY))}px`;
      refreshShapeManipulators(drag.shape);
      if (!shapeToolbar.hidden) positionContextToolbar(shapeToolbar, drag.shape.getBoundingClientRect());
      event.preventDefault();
      return;
    }
    if (shapeRotateDrag && shapeRotateDrag.pointerId === event.pointerId) {
      const drag = shapeRotateDrag;
      const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) * 180 / Math.PI;
      let delta = angle - drag.lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      drag.rotation += delta;
      drag.lastPointerAngle = angle;
      setShapeRotation(drag.shape, drag.rotation);
      event.preventDefault();
      return;
    }
    if (!shapeResizeDrag || shapeResizeDrag.pointerId !== event.pointerId || !activeShape) return;
    const drag = shapeResizeDrag;
    const screenX = event.clientX - drag.startX;
    const screenY = event.clientY - drag.startY;
    const smoothing = 0.8;
    const dx = ((screenX * Math.cos(drag.rotation) + screenY * Math.sin(drag.rotation)) / drag.scaleX) * smoothing;
    const dy = ((-screenX * Math.sin(drag.rotation) + screenY * Math.cos(drag.rotation)) / drag.scaleY) * smoothing;
    const widthDelta = Math.abs(drag.handleX) > 0.01 ? 2 * dx / drag.handleX : 0;
    const heightDelta = Math.abs(drag.handleY) > 0.01 ? 2 * dy / drag.handleY : 0;
    const width = Math.abs(drag.handleX) > 0.01
      ? Math.max(20, Math.min(10000, drag.width + widthDelta))
      : drag.width;
    const height = Math.abs(drag.handleY) > 0.01
      ? Math.max(1, Math.min(10000, drag.height + heightDelta))
      : drag.height;
    if (activeShape.dataset.editorTextbox === 'true' && Math.abs(drag.handleX) > 0.01) {
      activeShape.dataset.textboxManualWidth = 'true';
      activeShape.style.minWidth = '20px';
    }
    activeShape.style.width = `${width}px`;
    activeShape.style.height = `${height}px`;
    const anchorX = -drag.handleX * width / 2;
    const anchorY = -drag.handleY * height / 2;
    const centerX = drag.fixedPoint.left - (
      anchorX * drag.scaleX * Math.cos(drag.rotation) - anchorY * drag.scaleY * Math.sin(drag.rotation));
    const centerY = drag.fixedPoint.top - (
      anchorX * drag.scaleX * Math.sin(drag.rotation) + anchorY * drag.scaleY * Math.cos(drag.rotation));
    const pageBounds = editor.getBoundingClientRect();
    activeShape.style.left = `${(centerX - pageBounds.left) / drag.scaleX - width / 2}px`;
    activeShape.style.top = `${(centerY - pageBounds.top) / drag.scaleY - height / 2}px`;
    refreshShapeManipulators(activeShape);
    positionContextToolbar(shapeToolbar, activeShape.getBoundingClientRect());
    event.preventDefault();
  });
  const finishShapeResize = (event) => {
    if (shapeMoveDrag && shapeMoveDrag.pointerId === event.pointerId) {
      if (shapeMoveDrag.moved) scheduleSave();
      shapeMoveDrag = null;
    }
    if (shapeRotateDrag && shapeRotateDrag.pointerId === event.pointerId) {
      const drag = shapeRotateDrag;
      shapeRotateDrag = null;
      imageRotationIndicator.hidden = true;
      if (editor.contains(drag.shape)) {
        drag.shape.classList.add('shape-selected');
        shapeToolbar.hidden = drag.toolbarWasHidden;
        refreshShapeManipulators(drag.shape);
        if (!shapeToolbar.hidden) positionContextToolbar(shapeToolbar, drag.shape.getBoundingClientRect());
        scheduleSave();
      }
    }
    if (!shapeResizeDrag || shapeResizeDrag.pointerId !== event.pointerId) return;
    shapeResizeDrag = null;
    if (activeShape && editor.contains(activeShape)) {
      if (activeShape.dataset.editorTextbox === 'true') resizeTextBoxToFit(activeShape);
      scheduleSave();
    }
  };
  document.addEventListener('pointerup', finishShapeResize);
  document.addEventListener('pointercancel', finishShapeResize);
  document.getElementById('shape-fill-color').addEventListener('input', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    activeShape.dataset.shapeFill = event.currentTarget.value;
    document.getElementById('shape-ribbon-fill').value = event.currentTarget.value;
    activeShape.style.setProperty('--shape-fill-color', event.currentTarget.value);
    if (activeShape.dataset.shapeGeometry !== 'polygon' && activeShape.dataset.shapeType !== 'line') {
      activeShape.style.backgroundColor = event.currentTarget.value;
    }
    scheduleSave();
  });
  document.getElementById('shape-line-color').addEventListener('input', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    activeShape.dataset.shapeLine = event.currentTarget.value;
    document.getElementById('shape-ribbon-outline').value = event.currentTarget.value;
    activeShape.style.setProperty('--shape-line-color', event.currentTarget.value);
    if (activeShape.dataset.shapeGeometry === 'polygon' || activeShape.dataset.shapeType === 'line') {
      activeShape.style.backgroundColor = event.currentTarget.value;
    } else {
      activeShape.style.borderColor = event.currentTarget.value;
    }
    scheduleSave();
  });
  const setShapeLineWidth = (shape, width) => {
    if (!shape || !editor.contains(shape)) return;
    width = Math.max(0, Math.min(100, Number.isFinite(width) ? width : 0));
    shape.dataset.shapeLineWidth = String(width);
    shape.style.borderWidth = `${width}px`;
    shape.style.setProperty('--shape-border-width', `${width}px`);
    if (shape.dataset.shapeType === 'line') {
      shape.style.height = `${Math.max(1, width)}px`;
    }
    const shapeWidthInput = document.getElementById('shape-line-width');
    const ribbonWidthInput = document.getElementById('shape-ribbon-outline-width');
    if (document.activeElement !== shapeWidthInput) shapeWidthInput.value = String(width);
    if (document.activeElement !== ribbonWidthInput) ribbonWidthInput.value = String(width);
    const textBoxBorderToggle = document.getElementById('textbox-border-toggle');
    textBoxBorderToggle.setAttribute('aria-pressed', String(width > 0));
    textBoxBorderToggle.textContent = width > 0 ? 'Remove border' : 'Show border';
    scheduleSave();
  };
  document.getElementById('shape-line-width').addEventListener('input', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    if (event.currentTarget.value === '') return;
    const width = Number(event.currentTarget.value);
    if (Number.isFinite(width) && width >= 0 && width <= 100) setShapeLineWidth(activeShape, width);
  });
  document.getElementById('textbox-border-toggle').addEventListener('click', () => {
    if (!activeShape || activeShape.dataset.editorTextbox !== 'true' || !editor.contains(activeShape)) return;
    const borderVisible = Number(activeShape.dataset.shapeLineWidth ?? 1) > 0;
    setShapeLineWidth(activeShape, borderVisible ? 0 : 1);
    document.getElementById('textbox-border-toggle').setAttribute('aria-pressed', String(!borderVisible));
    document.getElementById('textbox-border-toggle').textContent = borderVisible ? 'Show border' : 'Remove border';
  });
  document.getElementById('shape-opacity').addEventListener('input', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    const opacity = Number(event.currentTarget.value);
    activeShape.dataset.shapeOpacity = String(opacity);
    activeShape.style.opacity = String(opacity / 100);
    document.getElementById('shape-opacity-value').value = `${opacity}%`;
    scheduleSave();
  });
  document.getElementById('shape-text').addEventListener('input', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    let label = activeShape.querySelector('[data-shape-label="true"]');
    if (!label) {
      label = document.createElement('span');
      label.dataset.shapeLabel = 'true';
      activeShape.append(label);
    }
    label.textContent = event.currentTarget.value;
    scheduleSave();
  });
  const removeSelectedShape = () => {
    if (activeShape && editor.contains(activeShape)) activeShape.remove();
    activeShape = null;
    const shapeFormatActive = shapeFormatTab.classList.contains('active') ||
      textboxFormatTab.classList.contains('active');
    hideShapeFormatTabs();
    if (shapeFormatActive) {
      activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
    }
    shapeToolbar.hidden = true;
    shapeManipulators.hidden = true;
    shapeManipulators.replaceChildren();
    updateCounts();
    scheduleSave();
  };
  document.getElementById('shape-delete').addEventListener('click', removeSelectedShape);
  const setImageWrap = (image, wrap) => {
    if (wrap === 'free') {
      const bounds = image.getBoundingClientRect();
      const pageBounds = editor.getBoundingClientRect();
      const scaleX = pageBounds.width / editor.offsetWidth;
      const scaleY = pageBounds.height / editor.offsetHeight;
      image.dataset.imageWrap = wrap;
      image.setAttribute('width', String(Math.max(1, Math.min(10000,
        Math.round(bounds.width / scaleX) || Number(image.getAttribute('width')) || 240))));
      image.style.left = `${Math.max(0, (bounds.left - pageBounds.left) / scaleX)}px`;
      image.style.top = `${Math.max(0, (bounds.top - pageBounds.top) / scaleY)}px`;
      return;
    }
    image.dataset.imageWrap = wrap;
    image.style.removeProperty('left');
    image.style.removeProperty('top');
  };
  const showImageToolbar = (image) => {
    if (activeShape) activeShape.classList.remove('shape-selected');
    activeShape = null;
    hideShapeFormatTabs();
    shapeToolbar.hidden = true;
    shapeManipulators.hidden = true;
    shapeManipulators.replaceChildren();
    if (activeWatermark) activeWatermark.classList.remove('watermark-selected');
    activeWatermark = null;
    watermarkToolbar.hidden = true;
    watermarkManipulators.hidden = true;
    watermarkManipulators.replaceChildren();
    if (activeImage && activeImage !== image) {
      activeImage.classList.remove('image-selected', 'image-crop-active');
    }
    activeImage = image;
    editor.blur();
    activeImage.classList.remove('image-crop-active');
    image.classList.add('image-selected');
    tableToolbar.hidden = true;
    activeTable = null;
    activeTableCell = null;
    document.body.classList.remove('table-tools-open');
    tableManipulators.replaceChildren();
    imageToolbar.hidden = true;
    imageCropMode = false;
    imageToolbar.dataset.cropMode = 'false';
    document.getElementById('image-crop-toggle').setAttribute('aria-pressed', 'false');
    document.getElementById('image-crop-toggle').querySelector('span').textContent = 'Crop';
    document.getElementById('image-crop-toggle').title = 'Crop picture';
    document.getElementById('image-crop-toggle').setAttribute('aria-label', 'Crop picture');
    document.getElementById('image-border-color').value = image.dataset.imageBorderColor || '#176b9a';
    document.querySelector('.image-border-color-tool > span').style.backgroundColor =
      image.dataset.imageBorderColor || '#176b9a';
    document.getElementById('image-border-width').value = image.dataset.imageBorderWidth || '0';
    document.getElementById('image-radius').value = image.dataset.imageRadius || '0';
    document.getElementById('image-radius-value').value = `${image.dataset.imageRadius || 0} px`;
    const opacity = Math.round(Number(image.dataset.imageOpacity ?? 1) * 100);
    document.getElementById('image-opacity').value = String(opacity);
    document.getElementById('image-opacity-value').value = `${opacity}%`;
    applyImageCrop(image, readImageCrop(image));
    pictureFormatTab.hidden = false;
    activateRibbonTab(pictureFormatTab);
    refreshImageManipulators(image);
  };
  let imageDrag = null;
  let imageResizeDrag = null;
  let imageRotateDrag = null;
  editor.addEventListener('pointerdown', (event) => {
    const image = event.target.closest('img');
    if (event.button !== 0 || !image || !editor.contains(image)) return;
    if (image.dataset.imageWrap !== 'free') {
      event.preventDefault();
      return;
    }
    if (image === activeImage && imageCropMode) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    showImageToolbar(image);
    const pageBounds = editor.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    imageDrag = {
      image,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: Number.isFinite(Number.parseFloat(image.style.left))
        ? Number.parseFloat(image.style.left)
        : (imageBounds.left - pageBounds.left) / (pageBounds.width / editor.offsetWidth),
      top: Number.isFinite(Number.parseFloat(image.style.top))
        ? Number.parseFloat(image.style.top)
        : (imageBounds.top - pageBounds.top) / (pageBounds.height / editor.offsetHeight),
      scaleX: pageBounds.width / editor.offsetWidth,
      scaleY: pageBounds.height / editor.offsetHeight,
      moved: false
    };
  });
  imageManipulators.addEventListener('pointerdown', (event) => {
    const rotateHandle = event.target.closest('[data-rotate-handle]');
    if (rotateHandle && activeImage && editor.contains(activeImage)) {
      event.preventDefault();
      event.stopPropagation();
      const bounds = activeImage.getBoundingClientRect();
      imageRotateDrag = {
        image: activeImage,
        pointerId: event.pointerId,
        centerX: (bounds.left + bounds.right) / 2,
        centerY: (bounds.top + bounds.bottom) / 2,
        lastPointerAngle: Math.atan2(event.clientY - (bounds.top + bounds.bottom) / 2,
          event.clientX - (bounds.left + bounds.right) / 2) * 180 / Math.PI,
        rotation: Number(activeImage.dataset.imageRotation) || 0,
        toolbarWasHidden: imageToolbar.hidden,
        wasSelected: activeImage.classList.contains('image-selected')
      };
      imageManipulators.hidden = true;
      imageToolbar.hidden = true;
      activeImage.classList.remove('image-selected');
      return;
    }
    const handle = event.target.closest('[data-resize-corner]');
    if (!handle || !activeImage || !editor.contains(activeImage)) return;
    event.preventDefault();
    event.stopPropagation();
    const pageBounds = editor.getBoundingClientRect();
    const imageBounds = activeImage.getBoundingClientRect();
    const scaleX = pageBounds.width / editor.offsetWidth;
    const scaleY = pageBounds.height / editor.offsetHeight;
    const aspect = activeImage.naturalWidth && activeImage.naturalHeight
      ? activeImage.naturalWidth / activeImage.naturalHeight
      : imageBounds.width / imageBounds.height;
    const rotation = (Number(activeImage.dataset.imageRotation) || 0) * Math.PI / 180;
    const centerX = (imageBounds.left + imageBounds.right) / 2;
    const centerY = (imageBounds.top + imageBounds.bottom) / 2;
    imageResizeDrag = {
      image: activeImage,
      pointerId: event.pointerId,
      corner: handle.dataset.resizeCorner,
      crop: handle.dataset.resizeAction === 'crop',
      startX: event.clientX,
      startY: event.clientY,
      width: activeImage.offsetWidth || imageBounds.width / scaleX,
      height: activeImage.offsetHeight || imageBounds.height / scaleY,
      left: activeImage.dataset.imageWrap === 'free' && Number.isFinite(Number.parseFloat(activeImage.style.left))
        ? Number.parseFloat(activeImage.style.left)
        : (centerX - pageBounds.left) / scaleX - activeImage.offsetWidth / 2,
      top: activeImage.dataset.imageWrap === 'free' && Number.isFinite(Number.parseFloat(activeImage.style.top))
        ? Number.parseFloat(activeImage.style.top)
        : (centerY - pageBounds.top) / scaleY - activeImage.offsetHeight / 2,
      pageWidth: editor.offsetWidth,
      pageHeight: editor.offsetHeight,
      aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
      scaleX,
      scaleY,
      rotation,
      maxWidth: 10000,
      cropInsets: readImageCrop(activeImage),
      fixedPoint: getImageHandlePoint(activeImage,
        handle.dataset.resizeCorner.endsWith('e') ? -activeImage.offsetWidth / 2
          : handle.dataset.resizeCorner.endsWith('w') ? activeImage.offsetWidth / 2 : 0,
        handle.dataset.resizeCorner.startsWith('n') ? activeImage.offsetHeight / 2
          : handle.dataset.resizeCorner.startsWith('s') ? -activeImage.offsetHeight / 2 : 0)
    };
  });
  document.addEventListener('pointermove', (event) => {
    if (imageDrag && imageDrag.pointerId === event.pointerId) {
      const drag = imageDrag;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      event.preventDefault();
      const imageBounds = drag.image.getBoundingClientRect();
      const left = Math.max(0, Math.min(editor.offsetWidth - imageBounds.width / drag.scaleX,
        drag.left + dx / drag.scaleX));
      const top = Math.max(0, Math.min(editor.offsetHeight - imageBounds.height / drag.scaleY,
        drag.top + dy / drag.scaleY));
      drag.image.style.left = `${left}px`;
      drag.image.style.top = `${top}px`;
      refreshImageManipulators(drag.image);
      positionImageToolbar(drag.image.getBoundingClientRect());
      return;
    }
    if (imageRotateDrag && imageRotateDrag.pointerId === event.pointerId) {
      const drag = imageRotateDrag;
      const angle = Math.atan2(event.clientY - drag.centerY, event.clientX - drag.centerX) * 180 / Math.PI;
      let delta = angle - drag.lastPointerAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      drag.rotation += delta;
      drag.lastPointerAngle = angle;
      setImageRotation(drag.image, drag.rotation);
      event.preventDefault();
      return;
    }
    if (!imageResizeDrag || imageResizeDrag.pointerId !== event.pointerId) return;
    const drag = imageResizeDrag;
    const screenDeltaX = event.clientX - drag.startX;
    const screenDeltaY = event.clientY - drag.startY;
    const deltaX = (screenDeltaX * Math.cos(drag.rotation) + screenDeltaY * Math.sin(drag.rotation)) / drag.scaleX;
    const deltaY = (-screenDeltaX * Math.sin(drag.rotation) + screenDeltaY * Math.cos(drag.rotation)) / drag.scaleY;
    const dx = drag.corner.endsWith('e') ? deltaX : drag.corner.endsWith('w') ? -deltaX : 0;
    const dy = drag.corner.startsWith('s') ? deltaY : drag.corner.startsWith('n') ? -deltaY : 0;
    if (drag.crop) {
      const [startTop, startRight, startBottom, startLeft] = drag.cropInsets;
      const width = Math.max(1, drag.width);
      const height = Math.max(1, drag.height);
      const insets = [startTop, startRight, startBottom, startLeft];
      if (drag.corner.startsWith('n')) insets[0] = startTop + deltaY / height * 100;
      if (drag.corner.endsWith('e')) insets[1] = startRight - deltaX / width * 100;
      if (drag.corner.startsWith('s')) insets[2] = startBottom - deltaY / height * 100;
      if (drag.corner.endsWith('w')) insets[3] = startLeft + deltaX / width * 100;
      insets[0] = Math.max(0, Math.min(45, insets[0]));
      insets[1] = Math.max(0, Math.min(45, insets[1]));
      insets[2] = Math.max(0, Math.min(89 - insets[0], insets[2]));
      insets[3] = Math.max(0, Math.min(89 - insets[1], insets[3]));
      applyImageCrop(drag.image, insets);
      refreshImageManipulators(drag.image);
      event.preventDefault();
      return;
    }
    const aspect = Number.isFinite(drag.aspect) && drag.aspect > 0 ? drag.aspect : 1;
    let widthChange;
    if (drag.corner === 'e' || drag.corner === 'w') {
      widthChange = (drag.corner.endsWith('w') ? -1 : 1) * dx;
    } else if (drag.corner === 'n' || drag.corner === 's') {
      widthChange = (drag.corner.startsWith('s') ? 1 : -1) * dy * aspect;
    } else {
      widthChange = (dx + dy / aspect) / (1 + 1 / (aspect * aspect));
    }
    const isWest = drag.corner.endsWith('w');
    const isNorth = drag.corner.startsWith('n');
    const maxWidth = drag.maxWidth;
    const width = Math.max(1, Math.min(maxWidth, drag.width + widthChange));
    const height = width / aspect;
    drag.image.setAttribute('width', String(Math.round(width)));
    if (drag.image.dataset.imageWrap === 'free') {
      const pageBounds = editor.getBoundingClientRect();
      const left = drag.corner.endsWith('w')
        ? drag.left + (drag.width - width)
        : drag.left;
      const top = isNorth
        ? drag.top + (drag.height - height)
        : drag.top;
      const nextLeft = Math.max(-10000, Math.min(drag.pageWidth, left));
      const nextTop = Math.max(-10000, Math.min(drag.pageHeight, top));
      drag.image.style.left = `${nextLeft}px`;
      drag.image.style.top = `${nextTop}px`;
      if (drag.corner === 'n' || drag.corner === 's') {
        const fixedTop = drag.corner.startsWith('s') ? drag.top : nextTop;
        drag.image.style.top = `${fixedTop}px`;
      }
    }
    refreshImageManipulators(drag.image);
    positionImageToolbar(drag.image.getBoundingClientRect());
    event.preventDefault();
  });
  const finishImagePointer = (event) => {
    if (imageDrag && imageDrag.pointerId === event.pointerId) {
      if (imageDrag.moved) scheduleSave();
      imageDrag = null;
    }
    if (imageRotateDrag && imageRotateDrag.pointerId === event.pointerId) {
      const drag = imageRotateDrag;
      imageRotateDrag = null;
      imageManipulators.hidden = false;
      imageToolbar.hidden = drag.toolbarWasHidden;
      if (drag.wasSelected) drag.image.classList.add('image-selected');
      imageRotationIndicator.hidden = true;
      refreshImageManipulators(drag.image);
      if (!imageToolbar.hidden) positionImageToolbar(drag.image.getBoundingClientRect());
      scheduleSave();
    }
    if (imageResizeDrag && imageResizeDrag.pointerId === event.pointerId) {
      imageResizeDrag = null;
      scheduleSave();
    }
  };
  document.addEventListener('pointerup', finishImagePointer);
  document.addEventListener('pointercancel', finishImagePointer);
  const enterShapeTextEdit = (shape, event) => {
    const wasEditing = shape.getAttribute('contenteditable') === 'true';
    let label = shape.querySelector('[data-shape-label="true"]');
    if (!label) {
      label = document.createElement('span');
      label.dataset.shapeLabel = 'true';
      shape.append(label);
    }
    shape.setAttribute('contenteditable', 'true');
    shape.setAttribute('tabindex', '0');
    if (wasEditing) return;
    shape.focus({ preventScroll: true });
    const selection = window.getSelection();
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (selection && range && shape.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (selection) {
      const fallbackRange = document.createRange();
      fallbackRange.selectNodeContents(label);
      fallbackRange.collapse(false);
      selection.removeAllRanges();
      selection.addRange(fallbackRange);
    }
  };
  editor.addEventListener('keydown', (event) => {
    const watermark = event.target.closest('[data-watermark]');
    if (!watermark || !editor.contains(watermark) || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    showWatermarkToolbar(watermark);
  });
  editor.addEventListener('click', (event) => {
    const pointerDownShape = event.detail > 0 ? shapePointerDown : null;
    shapePointerDown = null;
    const shape = event.target.closest('.editor-shape') ||
      (pointerDownShape && editor.contains(pointerDownShape.shape) ? pointerDownShape.shape : null);
    if (shape && editor.contains(shape)) {
      showShapeToolbar(shape);
      if (shape.dataset.editorTextbox !== 'true' && shape.getAttribute('contenteditable') !== 'true') {
        enterShapeTextEdit(shape, pointerDownShape?.shape === shape ? pointerDownShape : event);
      }
      return;
    }
    const watermark = event.target.closest('[data-watermark]') ||
      Array.from(editor.querySelectorAll('[data-watermark]')).reverse().find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return event.clientX >= bounds.left && event.clientX <= bounds.right &&
          event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
    if (watermark && editor.contains(watermark)) {
      showWatermarkToolbar(watermark);
      return;
    }
    const image = event.target.closest('img');
    if (document.body.classList.contains('select-objects-mode')) {
      const target = event.target.closest('table, img, p, h1, h2, h3, li, blockquote, [data-document-region]');
      if (target && editor.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        setSelectedObject(target);
        if (target.closest('table')) updateTableToolbar(target.closest('td, th') || target.querySelector('td, th'));
        else updateTableToolbar(null);
        if (target.tagName === 'IMG') showImageToolbar(target);
        return;
      }
    }
    if (image && editor.contains(image)) {
      if (image === activeImage && imageCropMode) return;
      showImageToolbar(image);
      return;
    }
    if (activeImage) activeImage.classList.remove('image-selected', 'image-crop-active');
    activeImage = null;
    if (activeShape) activeShape.classList.remove('shape-selected');
    activeShape = null;
    hideShapeFormatTabs();
    pictureFormatTab.hidden = true;
    if (shapeFormatTab.classList.contains('active') || textboxFormatTab.classList.contains('active') ||
      pictureFormatTab.classList.contains('active')) {
      document.querySelector('.tab-button[data-tab="home"]').click();
    }
    shapeToolbar.hidden = true;
    shapeManipulators.hidden = true;
    shapeManipulators.replaceChildren();
    imageCropMode = false;
    imageToolbar.hidden = true;
    imageManipulators.hidden = true;
    if (activeWatermark) activeWatermark.classList.remove('watermark-selected');
    activeWatermark = null;
    watermarkManipulators.hidden = true;
    watermarkManipulators.replaceChildren();
    watermarkToolbar.hidden = true;
    const cell = event.target.closest('td, th');
    if (!cell && selectedTableBand) return;
    updateTableToolbar(cell && editor.contains(cell) ? cell : null);
    if (!cell && !tableLayoutTab.hidden) {
      tableLayoutTab.hidden = true;
      if (tableLayoutTab.classList.contains('active')) {
        document.querySelector('.tab-button[data-tab="home"]').click();
      }
    }
  });
  document.addEventListener('click', (event) => {
    if (!imageCropMode || !activeImage) return;
    if (event.target.closest('#editor img, #image-context-toolbar, #image-manipulators, [data-panel="picture-format"]')) return;
    activeImage.classList.remove('image-selected', 'image-crop-active');
    activeImage = null;
    imageCropMode = false;
    pictureFormatTab.hidden = true;
    if (pictureFormatTab.classList.contains('active')) {
      activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
    }
    imageToolbar.dataset.cropMode = 'false';
    imageToolbar.hidden = true;
    imageManipulators.hidden = true;
    imageManipulators.replaceChildren();
  });
  editor.addEventListener('dblclick', (event) => {
    if (event.button !== 0) return;
    const shape = event.target.closest('.editor-shape:not(.editor-textbox)');
    if (shape && editor.contains(shape)) {
      showShapeToolbar(shape);
      if (shape.getAttribute('contenteditable') !== 'true') enterShapeTextEdit(shape, event);
      return;
    }
    const table = event.target.closest('table');
    if (!table || !editor.contains(table)) return;
    const cell = event.target.closest('td, th') || table.querySelector('td, th');
    if (!cell) return;
    updateTableToolbar(cell);
    tableLayoutTab.hidden = false;
    activateRibbonTab(tableLayoutTab);
  });
  editor.addEventListener('focusout', (event) => {
    const shape = event.target.closest('.editor-shape:not(.editor-textbox)');
    if (!shape || shape.contains(event.relatedTarget) || shape.getAttribute('contenteditable') !== 'true') return;
    const selection = window.getSelection();
    if (selection?.anchorNode && shape.contains(selection.anchorNode)) return;
    shape.setAttribute('contenteditable', 'false');
    shape.removeAttribute('tabindex');
    scheduleSave();
  });
  editor.addEventListener('pointerdown', (event) => {
    const shape = activeShape;
    if (!shape || shape.getAttribute('contenteditable') !== 'true' || shape.contains(event.target) ||
      shapeToolbar.contains(event.target) || shapeManipulators.contains(event.target)) return;
    shape.setAttribute('contenteditable', 'false');
    shape.removeAttribute('tabindex');
    scheduleSave();
  });
  editor.addEventListener('pointerover', (event) => {
    const table = event.target.closest('table');
    if (!table || !editor.contains(table) || activeTableCell || activeTable) return;
    activeTable = table;
    refreshTableManipulators(table);
  });
  editor.addEventListener('pointerout', (event) => {
    const table = event.target.closest('table');
    if (!table || table.contains(event.relatedTarget) || tableManipulators.contains(event.relatedTarget) ||
      activeTableCell || (selectedTableBand && selectedTableBand.table === table)) return;
    activeTable = null;
    tableManipulators.replaceChildren();
  });
  const setSelectedObject = (element) => {
    if (selectedObject && selectedObject !== element) selectedObject.classList.remove('selected-object');
    selectedObject = element;
    if (selectedObject) selectedObject.classList.add('selected-object');
    document.getElementById('bring-forward').disabled = !selectedObject;
    document.getElementById('send-backward').disabled = !selectedObject;
  };
  editor.addEventListener('input', () => {
    if (activeTable && !editor.contains(activeTable)) {
      activeTable = null;
      activeTableCell = null;
      tableToolbar.hidden = true;
      tableManipulators.replaceChildren();
      document.body.classList.remove('table-tools-open');
      tableLayoutTab.hidden = true;
      if (tableLayoutTab.classList.contains('active')) {
        activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
      }
    }
    if (selectedObject && !editor.contains(selectedObject)) setSelectedObject(null);
  });
  selectObjectsToggle.addEventListener('click', () => {
    const enabled = !document.body.classList.contains('select-objects-mode');
    document.body.classList.toggle('select-objects-mode', enabled);
    selectObjectsToggle.setAttribute('aria-pressed', String(enabled));
    selectObjectsToggle.classList.toggle('is-active', enabled);
    selectObjectsToggle.querySelector('span').textContent = enabled ? 'Select objects: ON' : 'Select objects';
    if (!enabled) setSelectedObject(null);
  });
  const changeObjectLayer = (amount) => {
    if (!selectedObject || !editor.contains(selectedObject)) {
      setSelectedObject(null);
      return;
    }
    changeElementLayer(selectedObject, amount);
  };
  const changeElementLayer = (element, amount) => {
    if (!element || !editor.contains(element)) return;
    const current = Number(element.dataset.layer || 0);
    const next = Math.max(-10, Math.min(10, current + amount));
    element.dataset.layer = String(next);
    element.style.zIndex = String(next);
    scheduleSave();
  };
  document.querySelectorAll('[data-shape-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      if (activeShape && editor.contains(activeShape)) changeElementLayer(activeShape, Number(button.dataset.shapeLayer));
    });
  });
  document.querySelectorAll('[data-shape-rotate]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!activeShape || !editor.contains(activeShape)) return;
      setShapeRotation(activeShape, (Number(activeShape.dataset.shapeRotation) || 0) + Number(button.dataset.shapeRotate));
      imageRotationIndicator.hidden = true;
      refreshShapeManipulators(activeShape);
      scheduleSave();
    });
  });
  document.querySelectorAll('[data-shape-style]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!activeShape || !editor.contains(activeShape)) return;
      const styles = {
        blue: { fill: '#dce8f5', line: '#176b9a' },
        dark: { fill: '#365c73', line: '#26313b' },
        light: { fill: '#ffffff', line: '#8faec1' }
      };
      const style = styles[button.dataset.shapeStyle];
      if (!style) return;
      const fill = document.getElementById('shape-fill-color');
      fill.value = style.fill;
      fill.dispatchEvent(new Event('input', { bubbles: true }));
      const outline = document.getElementById('shape-line-color');
      outline.value = style.line;
      outline.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('shape-ribbon-fill').value = style.fill;
      document.querySelector('[data-shape-color-swatch="fill"]').style.backgroundColor = style.fill;
      document.getElementById('shape-ribbon-outline').value = style.line;
      document.querySelector('[data-shape-color-swatch="outline"]').style.backgroundColor = style.line;
    });
  });
  document.querySelectorAll('[data-shape-text-style]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!activeShape || !editor.contains(activeShape)) return;
      let label = activeShape.querySelector('[data-shape-label="true"]');
      if (!label) {
        label = document.createElement('span');
        label.dataset.shapeLabel = 'true';
        activeShape.append(label);
      }
      if (button.dataset.shapeTextStyle === 'normal') delete label.dataset.shapeTextStyle;
      else label.dataset.shapeTextStyle = button.dataset.shapeTextStyle;
      scheduleSave();
    });
  });
  document.getElementById('shape-ribbon-fill').addEventListener('input', (event) => {
    document.querySelector('[data-shape-color-swatch="fill"]').style.backgroundColor = event.currentTarget.value;
    const fill = document.getElementById('shape-fill-color');
    fill.value = event.currentTarget.value;
    fill.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.getElementById('shape-ribbon-outline').addEventListener('input', (event) => {
    document.querySelector('[data-shape-color-swatch="outline"]').style.backgroundColor = event.currentTarget.value;
    const outline = document.getElementById('shape-line-color');
    outline.value = event.currentTarget.value;
    outline.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const shapeTextColorInput = document.getElementById('shape-ribbon-text-color');
  let shapeTextColorRange = null;
  const rememberShapeTextSelection = () => {
    const label = activeShape?.querySelector('[data-shape-label="true"]');
    const selection = window.getSelection();
    shapeTextColorRange = label && selection?.rangeCount &&
      label.contains(selection.anchorNode) && label.contains(selection.focusNode)
      ? selection.getRangeAt(0).cloneRange()
      : null;
  };
  shapeTextColorInput.closest('.color-picker').addEventListener('pointerdown', rememberShapeTextSelection, true);
  shapeTextColorInput.closest('.color-picker').addEventListener('keydown', rememberShapeTextSelection, true);
  shapeTextColorInput.addEventListener('input', (event) => {
    document.querySelector('[data-shape-color-swatch="text"]').style.backgroundColor = event.currentTarget.value;
    if (!activeShape || !editor.contains(activeShape)) return;
    let label = activeShape.querySelector('[data-shape-label="true"]');
    if (!label) {
      label = document.createElement('span');
      label.dataset.shapeLabel = 'true';
      activeShape.append(label);
    }
    const color = event.currentTarget.value;
    const range = shapeTextColorRange && label.contains(shapeTextColorRange.commonAncestorContainer)
      ? shapeTextColorRange
      : null;
    shapeTextColorRange = null;
    if (range && !range.collapsed) {
      const coloredText = document.createElement('span');
      coloredText.style.color = color;
      coloredText.append(range.extractContents());
      range.insertNode(coloredText);
      const selection = window.getSelection();
      const updatedRange = document.createRange();
      updatedRange.selectNodeContents(coloredText);
      selection?.removeAllRanges();
      selection?.addRange(updatedRange);
    } else {
      const coloredCaret = document.createElement('span');
      coloredCaret.style.color = color;
      coloredCaret.textContent = '\u200b';
      if (range) {
        range.insertNode(coloredCaret);
        range.setStart(coloredCaret.firstChild, 1);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      } else {
        label.dataset.shapeTextColor = color;
        label.style.color = color;
      }
    }
    scheduleSave();
  });
  document.getElementById('shape-ribbon-outline-width').addEventListener('input', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    if (event.currentTarget.value === '') return;
    const width = Number(event.currentTarget.value);
    if (Number.isFinite(width) && width >= 0 && width <= 100) setShapeLineWidth(activeShape, width);
  });
  [document.getElementById('shape-line-width'), document.getElementById('shape-ribbon-outline-width')]
    .forEach((input) => input.addEventListener('change', (event) => {
      if (!activeShape || !editor.contains(activeShape)) return;
      const current = Number(event.currentTarget.value);
      const width = event.currentTarget.value === '' || !Number.isFinite(current)
        ? Number(activeShape.dataset.shapeLineWidth ?? 2)
        : Math.max(0, Math.min(100, current));
      event.currentTarget.value = String(width);
      setShapeLineWidth(activeShape, width);
    }));
  document.getElementById('shape-ribbon-shadow').addEventListener('change', (event) => {
    if (!activeShape || !editor.contains(activeShape)) return;
    activeShape.dataset.shapeShadow = String(event.currentTarget.checked);
    scheduleSave();
  });
  document.getElementById('shape-ribbon-delete').addEventListener('click', removeSelectedShape);
  document.querySelectorAll('[data-object-layer]').forEach((button) => {
    button.addEventListener('click', () => {
      const object = button.closest('[data-panel="picture-format"], #image-context-toolbar')
        ? activeImage
        : activeShape;
      changeElementLayer(object, Number(button.dataset.objectLayer));
    });
  });
  document.getElementById('bring-forward').addEventListener('click', () => changeObjectLayer(1));
  document.getElementById('send-backward').addEventListener('click', () => changeObjectLayer(-1));
  const makeTableGrip = (kind, index, className, label) => {
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = `table-manipulator ${className}`;
    grip.dataset.gripKind = kind;
    grip.dataset.gripIndex = String(index);
    grip.setAttribute('aria-label', label);
    if (kind === 'move') grip.textContent = '⠿';
    return grip;
  };
  const getColumnDividerX = (first, second) => {
    if (first.left < second.left) return (first.right + second.left) / 2;
    return (first.left + second.right) / 2;
  };
  const clearTableBandSelection = () => {
    if (selectedTableBand) {
      selectedTableBand.table.querySelectorAll('.table-band-selected').forEach((cell) => {
        cell.classList.remove('table-band-selected');
      });
    }
    selectedTableBand = null;
  };
  const selectTableRange = (table, startRow, endRow, startColumn, endColumn, preferredAxis) => {
    clearTableBandSelection();
    if (!table || !editor.contains(table)) return;
    const rowStart = Math.max(0, Math.min(startRow, endRow));
    const rowEnd = Math.min(table.rows.length - 1, Math.max(startRow, endRow));
    const columnStart = Math.max(0, Math.min(startColumn, endColumn));
    const columnEnd = Math.max(startColumn, endColumn);
    if (rowEnd < rowStart) return;
    const rows = Array.from(table.rows);
    const rectangularRows = rows.slice(rowStart, rowEnd + 1);
    rectangularRows.forEach((row) => Array.from(row.cells).forEach((cell) => {
      if (cell.cellIndex >= columnStart && cell.cellIndex <= columnEnd) {
        cell.classList.add('table-band-selected');
      }
    }));
    const columnCount = Math.max(0, ...rows.map((row) => row.cells.length));
    const hasMergedCells = rows.some((row) => Array.from(row.cells).some((cell) =>
      cell.colSpan !== 1 || cell.rowSpan !== 1));
    const coversCompleteRows = !hasMergedCells && rectangularRows.every((row) =>
      columnStart === 0 && columnEnd >= row.cells.length - 1) &&
      (rowStart > 0 || rowEnd < rows.length - 1) &&
      rows.every((row) => row.parentElement === rows[0].parentElement);
    const coversCompleteColumns = !hasMergedCells && rowStart === 0 && rowEnd === rows.length - 1 &&
      rows.every((row) => row.cells.length === columnCount) &&
      (columnStart > 0 || columnEnd < columnCount - 1) && columnEnd < columnCount;
    const axis = coversCompleteRows && coversCompleteColumns
      ? preferredAxis
      : coversCompleteRows ? 'row' : coversCompleteColumns ? 'column' : null;
    selectedTableBand = {
      table, axis,
      startRow: rowStart, endRow: rowEnd,
      startColumn: columnStart, endColumn,
      start: axis === 'row' ? rowStart : columnStart,
      end: axis === 'row' ? rowEnd : columnEnd
    };
    refreshTableManipulators(table);
  };
  const getTableBandHandlePosition = (selection) => {
    const { table, axis, start, end } = selection;
    if (axis === 'row') {
      const first = table.rows[start];
      const last = table.rows[end];
      if (!first || !last) return null;
      const firstBounds = first.getBoundingClientRect();
      const lastBounds = last.getBoundingClientRect();
      return {
        left: table.getBoundingClientRect().left - 12,
        top: (firstBounds.top + lastBounds.bottom) / 2
      };
    }
    const first = table.rows[0] && table.rows[0].cells[start];
    const last = table.rows[0] && table.rows[0].cells[end];
    if (!first || !last) return null;
    const firstBounds = first.getBoundingClientRect();
    const lastBounds = last.getBoundingClientRect();
    return {
      left: (Math.min(firstBounds.left, lastBounds.left) + Math.max(firstBounds.right, lastBounds.right)) / 2,
      top: table.getBoundingClientRect().top - 12
    };
  };
  const getTableCellAtPoint = (table, x, y) => {
    const hitCell = document.elementsFromPoint(x, y)
      .map((element) => element.closest('td, th'))
      .find((cell) => cell && cell.closest('table') === table);
    if (hitCell) return hitCell;
    return Array.from(table.rows).flatMap((row) => Array.from(row.cells))
      .find((cell) => {
        const bounds = cell.getBoundingClientRect();
        return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      }) || null;
  };
  let tableBandDrag = null;
  editor.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const cell = event.target.closest('td, th');
    if (!cell || !editor.contains(cell)) {
      const previousTable = selectedTableBand && selectedTableBand.table;
      clearTableBandSelection();
      if (previousTable) refreshTableManipulators(previousTable);
      return;
    }
    const table = cell.closest('table');
    const existingSelection = selectedTableBand;
    if (event.shiftKey && existingSelection && existingSelection.table === table) {
      event.preventDefault();
      const selection = window.getSelection();
      if (selection) selection.removeAllRanges();
      const preferredAxis = existingSelection.axis || 'row';
      selectTableRange(table, existingSelection.startRow, cell.parentElement.rowIndex,
        existingSelection.startColumn, cell.cellIndex, preferredAxis);
      tableBandDrag = {
        table,
        startCell: cell,
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        active: true
      };
      return;
    }
    const previousTable = selectedTableBand && selectedTableBand.table;
    clearTableBandSelection();
    if (previousTable) refreshTableManipulators(previousTable);
    tableBandDrag = {
      table,
      startCell: cell,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
      active: false
    };
  });
  document.addEventListener('pointermove', (event) => {
    if (!tableBandDrag || tableBandDrag.pointerId !== event.pointerId) return;
    const { table, startCell, startX, startY } = tableBandDrag;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!tableBandDrag.active && Math.hypot(dx, dy) < 6) return;
    const endCell = getTableCellAtPoint(table, event.clientX, event.clientY);
    if (!endCell) return;
    tableBandDrag.active = true;
    event.preventDefault();
    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    const preferredAxis = Math.abs(dx) >= Math.abs(dy) ? 'row' : 'column';
    selectTableRange(table, startCell.parentElement.rowIndex, endCell.parentElement.rowIndex,
      startCell.cellIndex, endCell.cellIndex, preferredAxis);
  });
  document.addEventListener('pointerup', (event) => {
    if (!tableBandDrag || tableBandDrag.pointerId !== event.pointerId) return;
    const selectionTable = tableBandDrag.active ? tableBandDrag.table : null;
    tableBandDrag = null;
    if (selectionTable && editor.contains(selectionTable)) {
      refreshTableManipulators(selectionTable);
      const selectedCell = selectionTable.querySelector('.table-band-selected');
      if (selectedCell) updateTableToolbar(selectedCell);
    }
  });
  const refreshTableManipulators = (table) => {
    if (!table || !editor.contains(table)) {
      tableManipulators.replaceChildren();
      return;
    }
    const bounds = table.getBoundingClientRect();
    const grips = [makeTableGrip('move', 0, 'table-move-grip', 'Move table')];
    grips[0].style.left = `${bounds.left - 20}px`;
    grips[0].style.top = `${bounds.top - 20}px`;

    const columnCount = getTableColumnCount(table);
    if (columnCount) {
      ['left', 'right'].forEach((side) => {
        const grip = makeTableGrip(`${side}-edge`, 0, 'table-edge-grip', `Resize table ${side} edge`);
        grip.style.left = `${side === 'left' ? bounds.left : bounds.right}px`;
        grip.style.top = `${bounds.top}px`;
        grip.style.height = `${bounds.height}px`;
        grips.push(grip);
        if (side === 'right') {
          const isRtl = getComputedStyle(table).direction === 'rtl';
          const addColumn = makeTableGrip(
            'insert-column-edge',
            isRtl ? 0 : columnCount - 1,
            'table-insert-grip',
            'Insert column at the right edge'
          );
          addColumn.dataset.insertPosition = isRtl ? 'left' : 'right';
          addColumn.textContent = '+';
          addColumn.style.left = `${bounds.right}px`;
          addColumn.style.top = `${bounds.top}px`;
          addColumn.style.display = 'none';
          grips.push(addColumn);
        }
      });
    }
    if (columnCount > 1) {
      if (Array.from(table.rows).some((row) => Array.from(row.cells).some((cell) =>
        cell.colSpan > 1 || cell.rowSpan > 1))) ensureTableColumnGroup(table);
      const widths = getTableColumnWidths(table);
      const isRtl = getComputedStyle(table).direction === 'rtl';
      let offset = 0;
      for (let index = 0; index < columnCount - 1; index += 1) {
        offset += widths[index];
        const dividerX = isRtl ? bounds.right - offset : bounds.left + offset;
        const grip = makeTableGrip('column', index, 'column-grip', `Resize column ${index + 1}`);
        grip.style.left = `${dividerX}px`;
        grip.style.top = `${bounds.top}px`;
        grip.style.height = `${bounds.height}px`;
        grips.push(grip);
        const addColumn = makeTableGrip('insert-column', index, 'table-insert-grip', `Insert column after column ${index + 1}`);
        addColumn.textContent = '+';
        addColumn.style.left = `${dividerX}px`;
        addColumn.style.top = `${bounds.top}px`;
        addColumn.style.display = 'none';
        grips.push(addColumn);
      }
    }
    for (let index = 0; index < table.rows.length - 1; index += 1) {
      const first = table.rows[index].getBoundingClientRect();
      const grip = makeTableGrip('row', index, 'row-grip', `Resize row ${index + 1}`);
      grip.style.top = `${first.bottom}px`;
      grip.style.left = `${bounds.left}px`;
      grip.style.width = `${bounds.width}px`;
      grips.push(grip);
      const addRow = makeTableGrip('insert-row', index, 'table-insert-grip', `Insert row below row ${index + 1}`);
      addRow.textContent = '+';
      addRow.style.left = `${bounds.left - 10}px`;
      addRow.style.top = `${first.bottom}px`;
      addRow.style.display = 'none';
      grips.push(addRow);
    }
    const lastRow = table.rows[table.rows.length - 1];
    if (lastRow) {
      const bottomGrip = makeTableGrip('row', table.rows.length - 1, 'row-grip', 'Resize last row');
      bottomGrip.style.top = `${bounds.bottom}px`;
      bottomGrip.style.left = `${bounds.left}px`;
      bottomGrip.style.width = `${bounds.width}px`;
      grips.push(bottomGrip);
      const addRow = makeTableGrip(
        'insert-row',
        table.rows.length - 1,
        'table-insert-grip',
        'Insert row below the last row'
      );
      addRow.textContent = '+';
      addRow.style.left = `${bounds.left - 10}px`;
      addRow.style.top = `${bounds.bottom}px`;
      addRow.style.display = 'none';
      grips.push(addRow);
    }
    if (selectedTableBand && selectedTableBand.table === table && selectedTableBand.axis) {
      const position = getTableBandHandlePosition(selectedTableBand);
      if (position) {
        const kind = selectedTableBand.axis === 'row' ? 'row-reorder' : 'column-reorder';
        const handle = makeTableGrip(kind, selectedTableBand.start, 'table-selection-handle',
          `Move selected ${selectedTableBand.axis === 'row' ? 'row' : 'column'}`);
        const dots = document.createElement('span');
        dots.className = 'table-handle-dots';
        for (let dot = 0; dot < 6; dot += 1) dots.append(document.createElement('span'));
        handle.append(dots);
        handle.style.left = `${position.left}px`;
        handle.style.top = `${position.top}px`;
        grips.push(handle);
      }
    }
    tableManipulators.replaceChildren(...grips);
    tableManipulators.hidden = false;
  };
  tableManipulators.addEventListener('pointermove', (event) => {
    const insertGrip = event.target.closest('.table-insert-grip');
    if (insertGrip) {
      tableManipulators.querySelectorAll('.column-grip, .row-grip, .table-edge-grip')
        .forEach((item) => item.classList.remove('is-insert-hover'));
      const { gripKind, gripIndex } = insertGrip.dataset;
      const sourceKind = gripKind === 'insert-column-edge'
        ? 'right-edge'
        : gripKind === 'insert-column' ? 'column' : 'row';
      tableManipulators.querySelector(
        `[data-grip-kind="${sourceKind}"][data-grip-index="${gripIndex}"]`
      )?.classList.add('is-insert-hover');
      return;
    }
    const grip = event.target.closest('.column-grip, .row-grip, .table-edge-grip');
    tableManipulators.querySelectorAll('.is-insert-hover')
      .forEach((item) => item.classList.remove('is-insert-hover'));
    if (!grip) {
      tableManipulators.querySelectorAll('.table-insert-grip').forEach((item) => { item.style.display = 'none'; });
      return;
    }
    const isEdgeColumn = grip.classList.contains('table-edge-grip') &&
      grip.dataset.gripKind === 'right-edge';
    const isColumn = grip.classList.contains('column-grip') || isEdgeColumn;
    if (grip.classList.contains('table-edge-grip') && !isEdgeColumn) {
      tableManipulators.querySelectorAll('.table-insert-grip').forEach((item) => { item.style.display = 'none'; });
      return;
    }
    const addGrip = tableManipulators.querySelector(
      `[data-grip-kind="${isEdgeColumn ? 'insert-column-edge' : isColumn ? 'insert-column' : 'insert-row'}"][data-grip-index="${grip.dataset.gripIndex}"]`);
    if (!addGrip || !activeTable) {
      tableManipulators.querySelectorAll('.table-insert-grip').forEach((item) => { item.style.display = 'none'; });
      return;
    }
    tableManipulators.querySelectorAll('.table-insert-grip').forEach((item) => { item.style.display = 'none'; });
    const bounds = activeTable.getBoundingClientRect();
    const nearOuterEnd = isColumn
      ? Math.abs(event.clientY - bounds.top) <= 12
      : Math.abs(event.clientX - bounds.left) <= 12;
    if (!nearOuterEnd) return;
    addGrip.style.display = 'grid';
    if (isColumn) {
      addGrip.style.left = `${grip.getBoundingClientRect().left + grip.getBoundingClientRect().width / 2}px`;
      addGrip.style.top = `${bounds.top - 9}px`;
    } else {
      addGrip.style.left = `${bounds.left}px`;
      addGrip.style.top = `${(grip.getBoundingClientRect().top + grip.getBoundingClientRect().bottom) / 2}px`;
    }
  });
  document.addEventListener('pointermove', (event) => {
    if (event.target.closest('.column-grip, .row-grip, .table-edge-grip, .table-insert-grip')) return;
    tableManipulators.querySelectorAll('.is-insert-hover')
      .forEach((grip) => grip.classList.remove('is-insert-hover'));
    tableManipulators.querySelectorAll('.table-insert-grip').forEach((grip) => { grip.style.display = 'none'; });
  });
  tableManipulators.addEventListener('pointerleave', () => {
    tableManipulators.querySelectorAll('.is-insert-hover')
      .forEach((grip) => grip.classList.remove('is-insert-hover'));
    tableManipulators.querySelectorAll('.table-insert-grip').forEach((grip) => { grip.style.display = 'none'; });
  });
  let tableDrag = null;
  const makeTableReorderPreview = () => {
    const preview = document.createElement('div');
    preview.className = 'table-reorder-preview';
    preview.hidden = true;
    const insertionMarker = document.createElement('span');
    insertionMarker.className = 'table-reorder-insertion';
    preview.append(insertionMarker);
    tableManipulators.append(preview);
    return { element: preview, insertionMarker };
  };
  const restoreTableDragCaret = (drag) => {
    drag.table.classList.remove('table-caret-suspended');
    if (!drag.caretRange || !drag.caretCell || !editor.contains(drag.caretCell) ||
      !drag.table.contains(drag.caretCell) || !drag.table.contains(drag.caretRange.startContainer)) {
      updateTableCaretOverlay();
      return;
    }
    const selection = window.getSelection();
    if (!selection) return;
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(drag.caretRange);
    savedEditorRange = drag.caretRange.cloneRange();
    activeCaretTableCell = drag.caretCell;
    updateTableCaretOverlay();
  };
  const hideTableReorderPreview = (drag) => {
    drag.preview.element.hidden = true;
    drag.dropIndex = null;
  };
  const updateTableReorderPreview = (drag, x, y) => {
    const { table, selection, kind, preview } = drag;
    const tableBounds = table.getBoundingClientRect();
    const horizontal = kind === 'row-reorder';
    if (horizontal
      ? x < tableBounds.left - 24 || x > tableBounds.right + 24 ||
        y < tableBounds.top - 12 || y > tableBounds.bottom + 12
      : y < tableBounds.top - 24 || y > tableBounds.bottom + 24 ||
        x < tableBounds.left - 12 || x > tableBounds.right + 12) {
      hideTableReorderPreview(drag);
      return;
    }
    const rows = Array.from(table.rows);
    if (horizontal) {
      const movingRows = rows.slice(selection.start, selection.end + 1);
      const parent = rows[0] && rows[0].parentElement;
      if (!parent || rows.some((row) => row.parentElement !== parent)) {
        hideTableReorderPreview(drag);
        return;
      }
      const remainingRows = rows.filter((row) => !movingRows.includes(row));
      const insertionIndex = remainingRows.filter((row) => {
        const bounds = row.getBoundingClientRect();
        return y >= bounds.top + bounds.height / 2;
      }).length;
      const boundary = insertionIndex === 0
        ? (remainingRows[0] ? remainingRows[0].getBoundingClientRect().top : tableBounds.top)
        : insertionIndex === remainingRows.length
          ? (remainingRows[remainingRows.length - 1]
            ? remainingRows[remainingRows.length - 1].getBoundingClientRect().bottom
            : tableBounds.bottom)
          : (remainingRows[insertionIndex - 1].getBoundingClientRect().bottom +
            remainingRows[insertionIndex].getBoundingClientRect().top) / 2;
      const height = movingRows.reduce((total, row) => total + row.getBoundingClientRect().height, 0);
      drag.dropIndex = insertionIndex;
      preview.element.style.left = `${tableBounds.left}px`;
      preview.element.style.top = `${boundary}px`;
      preview.element.style.width = `${tableBounds.width}px`;
      preview.element.style.height = `${height}px`;
      preview.insertionMarker.style.left = '0';
      preview.insertionMarker.style.top = '0';
      preview.insertionMarker.style.width = '100%';
      preview.insertionMarker.style.height = '3px';
    } else {
      const firstRow = rows[0];
      if (!firstRow || rows.some((row) => row.cells.length !== firstRow.cells.length ||
        Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) {
        hideTableReorderPreview(drag);
        return;
      }
      const movingColumns = Array.from({ length: selection.end - selection.start + 1 },
        (_, offset) => selection.start + offset);
      const remainingColumns = Array.from({ length: firstRow.cells.length }, (_, index) => index)
        .filter((index) => !movingColumns.includes(index));
      const isRtl = getComputedStyle(table).direction === 'rtl';
      const insertionIndex = remainingColumns.filter((index) => {
        const bounds = firstRow.cells[index].getBoundingClientRect();
        const midpoint = bounds.left + bounds.width / 2;
        return isRtl ? x < midpoint : x >= midpoint;
      }).length;
      const boundary = insertionIndex === 0
        ? (isRtl ? tableBounds.right : tableBounds.left)
        : insertionIndex === remainingColumns.length
          ? (isRtl ? tableBounds.left : tableBounds.right)
          : getColumnDividerX(
            firstRow.cells[remainingColumns[insertionIndex - 1]].getBoundingClientRect(),
            firstRow.cells[remainingColumns[insertionIndex]].getBoundingClientRect());
      const width = movingColumns.reduce((total, index) =>
        total + firstRow.cells[index].getBoundingClientRect().width, 0);
      drag.dropIndex = insertionIndex;
      preview.element.style.left = `${isRtl ? boundary - width : boundary}px`;
      preview.element.style.top = `${tableBounds.top}px`;
      preview.element.style.width = `${width}px`;
      preview.element.style.height = `${tableBounds.height}px`;
      preview.insertionMarker.style.left = isRtl ? 'auto' : '0';
      preview.insertionMarker.style.right = isRtl ? '0' : 'auto';
      preview.insertionMarker.style.top = '0';
      preview.insertionMarker.style.width = '3px';
      preview.insertionMarker.style.height = '100%';
    }
    preview.element.hidden = false;
  };
  tableManipulators.addEventListener('pointerdown', (event) => {
    const grip = event.target.closest('[data-grip-kind]');
    if (!grip || !activeTable || !editor.contains(activeTable)) return;
    event.preventDefault();
    const kind = grip.dataset.gripKind;
    if (kind.startsWith('insert-')) return;
    if (kind === 'row-reorder' || kind === 'column-reorder') {
      const axis = kind === 'row-reorder' ? 'row' : 'column';
      if (!selectedTableBand || selectedTableBand.table !== activeTable || selectedTableBand.axis !== axis) return;
      grip.classList.add('is-dragging');
      const preview = makeTableReorderPreview();
      tableDrag = {
        kind,
        table: activeTable,
        selection: { ...selectedTableBand },
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        dropIndex: null,
        preview
      };
      return;
    }
    const index = Number(grip.dataset.gripIndex);
    const table = activeTable;
    const rows = Array.from(table.rows);
    const row = rows[index];
    const rowBounds = row && row.getBoundingClientRect();
    let firstColumnWidth = 0;
    let secondColumnWidth = 0;
    let columnRowsToPreserve = [];
    if (kind === 'column') {
      columnRowsToPreserve = rows.flatMap((tableRow) => {
        const height = tableRow.getBoundingClientRect().height;
        const specifiedHeight = Number.parseFloat(tableRow.style.height);
        const manuallySized = tableRow.dataset.tableRowHeight === 'manual' ||
          (Number.isFinite(specifiedHeight) && height > getMinimumTableRowHeight(tableRow) + 2);
        return manuallySized ? [{ row: tableRow, height }] : [];
      });
      const widths = ensureTableColumnGroup(table);
      firstColumnWidth = widths[index];
      secondColumnWidth = widths[index + 1];
    }
    const isEdgeResize = kind === 'left-edge' || kind === 'right-edge';
    const edgeCells = isEdgeResize
      ? rows.map((tableRow) => {
        const cells = Array.from(tableRow.cells);
        return cells.reduce((edge, cell) => {
          if (!edge) return cell;
          const cellBounds = cell.getBoundingClientRect();
          const edgeBounds = edge.getBoundingClientRect();
          return kind === 'left-edge'
            ? cellBounds.left < edgeBounds.left ? cell : edge
            : cellBounds.right > edgeBounds.right ? cell : edge;
        }, null);
      })
      : [];
    const isFreeMove = kind === 'move';
    const preservesTableCaret = ['move', 'left-edge', 'right-edge', 'column', 'row'].includes(kind);
    const moveTableBounds = isFreeMove ? table.getBoundingClientRect() : null;
    const movePageBounds = isFreeMove ? editor.getBoundingClientRect() : null;
    const moveScaleX = isFreeMove ? movePageBounds.width / editor.offsetWidth : 1;
    const moveScaleY = isFreeMove ? movePageBounds.height / editor.offsetHeight : 1;
    const tableScaleY = table.getBoundingClientRect().height / Math.max(1, table.offsetHeight);
    const currentSelection = window.getSelection();
    const caretRange = preservesTableCaret && currentSelection?.isCollapsed &&
      currentSelection.rangeCount && table.contains(currentSelection.anchorNode)
      ? currentSelection.getRangeAt(0).cloneRange()
      : null;
    const caretAnchor = currentSelection?.anchorNode;
    const caretElement = caretAnchor instanceof Element ? caretAnchor : caretAnchor?.parentElement;
    const caretCell = caretRange ? caretElement?.closest('td, th') : null;
    if (caretRange && caretCell && table.contains(caretCell)) {
      table.classList.add('table-caret-suspended');
      tableCaretOverlay.hidden = true;
    }
    tableDrag = {
      kind, index, table, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      rowBounds, firstColumnWidth, secondColumnWidth,
      columnRowsToPreserve,
      caretRange, caretCell,
      rowHeight: rowBounds ? rowBounds.height : 0,
      scaleY: tableScaleY || 1,
      tableBounds: isEdgeResize ? table.getBoundingClientRect() : null,
      pageBounds: isEdgeResize ? editor.getBoundingClientRect() : null,
      originalMarginLeft: isEdgeResize ? Number.parseFloat(getComputedStyle(table).marginLeft) : 0,
      originalMarginRight: isEdgeResize ? Number.parseFloat(getComputedStyle(table).marginRight) : 0,
      edgeCells: edgeCells.map((cell) => ({ cell, width: cell.getBoundingClientRect().width })),
      freeMove: isFreeMove ? {
        left: (moveTableBounds.left - movePageBounds.left) / moveScaleX,
        top: (moveTableBounds.top - movePageBounds.top) / moveScaleY,
        width: moveTableBounds.width / moveScaleX,
        height: moveTableBounds.height / moveScaleY,
        pageWidth: editor.offsetWidth,
        pageHeight: editor.offsetHeight,
        scaleX: moveScaleX,
        scaleY: moveScaleY
      } : null
    };
  });
  document.addEventListener('pointermove', (event) => {
    if (!tableDrag) return;
    const { kind, index, table, startX, startY } = tableDrag;
    if (tableDrag.pointerId !== event.pointerId) return;
    if (kind === 'row-reorder' || kind === 'column-reorder') {
      if (!tableDrag.active && Math.hypot(event.clientX - startX, event.clientY - startY) < 4) return;
      tableDrag.active = true;
      event.preventDefault();
      updateTableReorderPreview(tableDrag, event.clientX, event.clientY);
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (kind === 'move') {
      const { freeMove } = tableDrag;
      if (!freeMove) return;
      event.preventDefault();
      table.dataset.tablePosition = 'free';
      table.style.width = `${freeMove.width}px`;
      table.style.left = `${Math.max(0, Math.min(freeMove.pageWidth - freeMove.width,
        freeMove.left + dx / freeMove.scaleX))}px`;
      table.style.top = `${Math.max(0, Math.min(freeMove.pageHeight - freeMove.height,
        freeMove.top + dy / freeMove.scaleY))}px`;
    } else if (kind === 'left-edge' || kind === 'right-edge') {
      releaseContentSizedRows(table, true);
      const { tableBounds, pageBounds, originalMarginLeft, originalMarginRight, edgeCells } = tableDrag;
      if (!tableBounds || !pageBounds) return;
      const edgeDelta = kind === 'left-edge' ? -dx : dx;
      const minimumDelta = Math.max(...edgeCells.map(({ width }) => 32 - width));
      const maximumDelta = kind === 'left-edge'
        ? tableBounds.left - pageBounds.left
        : pageBounds.right - tableBounds.right;
      const delta = Math.max(minimumDelta, Math.min(maximumDelta, edgeDelta));
      table.style.tableLayout = 'fixed';
      table.style.width = `${tableBounds.width + delta}px`;
      if (kind === 'left-edge') {
        table.style.marginLeft = `${originalMarginLeft - delta}px`;
        table.style.marginRight = `${originalMarginRight}px`;
      } else {
        table.style.marginLeft = `${originalMarginLeft}px`;
        table.style.marginRight = `${originalMarginRight - delta}px`;
      }
      edgeCells.forEach(({ cell, width }) => {
        cell.style.width = `${width + delta}px`;
      });
    } else if (kind === 'column') {
      tableDrag.columnRowsToPreserve.forEach(({ row }) => {
        row.dataset.tableRowHeight = 'manual';
      });
      releaseContentSizedRows(table);
      const widths = getTableColumnWidths(table);
      const isRtl = getComputedStyle(table).direction === 'rtl';
      const leftColumn = isRtl ? index + 1 : index;
      const rightColumn = isRtl ? index : index + 1;
      const leftWidth = isRtl ? tableDrag.secondColumnWidth : tableDrag.firstColumnWidth;
      const rightWidth = isRtl ? tableDrag.firstColumnWidth : tableDrag.secondColumnWidth;
      const delta = Math.max(32 - leftWidth, Math.min(rightWidth - 32, dx));
      widths[leftColumn] = leftWidth + delta;
      widths[rightColumn] = rightWidth - delta;
      setTableColumnWidths(table, widths);
      tableDrag.columnRowsToPreserve.forEach(({ row, height }) => {
        const preservedHeight = Math.max(height, getMinimumTableRowHeight(row));
        row.style.height = `${preservedHeight}px`;
        Array.from(row.cells).forEach((cell) => {
          cell.style.height = `${preservedHeight}px`;
        });
      });
    } else if (kind === 'row') {
      const row = table.rows[index];
      if (!row) return;
      const rowHeight = Math.max(getMinimumTableRowHeight(row), tableDrag.rowHeight + dy / tableDrag.scaleY);
      row.style.height = `${rowHeight}px`;
      row.dataset.tableRowHeight = 'manual';
      Array.from(row.cells).forEach((cell) => { cell.style.height = `${rowHeight}px`; });
      if (activeTableCell && activeTableCell.parentElement === row) {
        updateTableCaretOverlay();
      }
    }
    if (kind !== 'move' && kind !== 'row-reorder' && kind !== 'column-reorder') {
      normalizeTableRowHeights(table);
    }
    if (kind !== 'row-reorder' && kind !== 'column-reorder') refreshTableManipulators(table);
    positionTableToolbar(activeTableCell || table.querySelector('td, th'));
  });
  const reorderSelectedRows = (selection, insertionIndex) => {
    const { table, start, end } = selection;
    const rows = Array.from(table.rows);
    const parent = rows[0] && rows[0].parentElement;
    if (!parent || rows.some((row) => row.parentElement !== parent)) return false;
    const moving = rows.slice(start, end + 1);
    const remaining = rows.filter((row) => !moving.includes(row));
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > remaining.length) return false;
    remaining.splice(insertionIndex, 0, ...moving);
    if (remaining.every((row, index) => row === rows[index])) return false;
    remaining.forEach((row) => parent.append(row));
    selectTableRange(table, insertionIndex, insertionIndex + moving.length - 1,
      0, Math.max(...rows.map((row) => row.cells.length)) - 1, 'row');
    return true;
  };
  const reorderSelectedColumns = (selection, insertionIndex) => {
    const { table, start, end } = selection;
    const rows = Array.from(table.rows);
    const firstRow = rows[0];
    if (!firstRow || rows.some((row) => row.cells.length !== firstRow.cells.length ||
      Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) return false;
    const movingIndexes = Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    const remainingIndexes = Array.from({ length: firstRow.cells.length }, (_, index) => index)
      .filter((index) => index < start || index > end);
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > remainingIndexes.length) return false;
    remainingIndexes.splice(insertionIndex, 0, ...movingIndexes);
    if (remainingIndexes.every((index, position) => index === position)) return false;
    rows.forEach((row) => {
      const cells = Array.from(row.cells);
      remainingIndexes.forEach((index) => row.append(cells[index]));
    });
    selectTableRange(table, 0, rows.length - 1, insertionIndex,
      insertionIndex + movingIndexes.length - 1, 'column');
    return true;
  };
  document.addEventListener('pointerup', (event) => {
    if (!tableDrag || tableDrag.pointerId !== event.pointerId) return;
    const completedDrag = tableDrag;
    let reordered = false;
    if (tableDrag.active && tableDrag.dropIndex !== null && tableDrag.kind === 'row-reorder') {
      reordered = reorderSelectedRows(tableDrag.selection, tableDrag.dropIndex);
    } else if (tableDrag.active && tableDrag.dropIndex !== null && tableDrag.kind === 'column-reorder') {
      reordered = reorderSelectedColumns(tableDrag.selection, tableDrag.dropIndex);
    }
    const table = tableDrag.table;
    if (tableDrag.preview) tableDrag.preview.element.remove();
    const changed = reordered || (tableDrag.kind !== 'row-reorder' &&
      tableDrag.kind !== 'column-reorder');
    tableDrag = null;
    if (table && editor.contains(table)) refreshTableManipulators(table);
    if (completedDrag.caretRange) {
      window.requestAnimationFrame(() => restoreTableDragCaret(completedDrag));
    }
    if (changed) scheduleSave(historyLabelForTableDrag(completedDrag.kind, completedDrag.index));
  });
  document.addEventListener('pointercancel', (event) => {
    if (tableBandDrag && tableBandDrag.pointerId === event.pointerId) tableBandDrag = null;
    if (!tableDrag || tableDrag.pointerId !== event.pointerId) return;
    const cancelledDrag = tableDrag;
    const table = tableDrag.table;
    const changed = tableDrag.kind !== 'row-reorder' && tableDrag.kind !== 'column-reorder';
    if (tableDrag.preview) tableDrag.preview.element.remove();
    tableDrag = null;
    if (table && editor.contains(table)) refreshTableManipulators(table);
    if (cancelledDrag.caretRange) {
      window.requestAnimationFrame(() => restoreTableDragCaret(cancelledDrag));
    }
    if (changed) scheduleSave(historyLabelForTableDrag(cancelledDrag.kind, cancelledDrag.index));
  });
  window.addEventListener('resize', () => {
    if (activeShape && editor.contains(activeShape)) {
      refreshShapeManipulators(activeShape);
      if (!shapeToolbar.hidden) positionContextToolbar(shapeToolbar, activeShape.getBoundingClientRect());
    }
    if (activeTable) refreshTableManipulators(activeTable);
    if (activeTableCell && !tableToolbar.hidden) positionTableToolbar(activeTableCell);
    if (activeImage && editor.contains(activeImage) && !imageRotateDrag) {
      refreshImageManipulators(activeImage);
      if (!imageToolbar.hidden) positionImageToolbar(activeImage.getBoundingClientRect());
    }
    if (activeWatermark && editor.contains(activeWatermark) && !watermarkToolbar.hidden) {
      refreshWatermarkManipulators(activeWatermark);
      positionWatermarkToolbar(activeWatermark);
    }
  });
  document.addEventListener('scroll', (event) => {
    syncVerticalRuler();
    if (activeShape && editor.contains(activeShape)) {
      refreshShapeManipulators(activeShape);
      if (!shapeToolbar.hidden) positionContextToolbar(shapeToolbar, activeShape.getBoundingClientRect());
    }
    if (activeTable) refreshTableManipulators(activeTable);
    if (activeImage && editor.contains(activeImage) && !imageRotateDrag) {
      refreshImageManipulators(activeImage);
      if (!imageToolbar.hidden) positionImageToolbar(activeImage.getBoundingClientRect());
    }
    if (activeWatermark && editor.contains(activeWatermark) && !watermarkToolbar.contains(event.target)) {
      activeWatermark.classList.remove('watermark-selected');
      watermarkToolbar.hidden = true;
      watermarkManipulators.hidden = true;
      watermarkManipulators.replaceChildren();
    }
  }, true);
  [tableToolbar, imageToolbar, watermarkToolbar, tableLayoutPanel].forEach((toolbar) => {
    toolbar.addEventListener('pointerdown', (event) => {
      rememberEditorSelection();
      if (event.target.closest('button')) event.preventDefault();
    });
  });
  const getActiveTable = () => activeTableCell && activeTableCell.closest('table');
  const getTableColumnCount = (table) => Array.from(table.rows).reduce((maximum, row) =>
    Math.max(maximum, Array.from(row.cells).reduce((total, cell) => total + cell.colSpan, 0)), 0);
  const getTableGrid = (table) => {
    const rows = Array.from(table.rows);
    const grid = rows.map(() => []);
    rows.forEach((row, rowIndex) => {
      let columnIndex = 0;
      Array.from(row.cells).forEach((cell) => {
        while (grid[rowIndex][columnIndex]) columnIndex += 1;
        const rowEnd = Math.min(rows.length, rowIndex + cell.rowSpan);
        const columnEnd = columnIndex + cell.colSpan;
        for (let gridRow = rowIndex; gridRow < rowEnd; gridRow += 1) {
          for (let gridColumn = columnIndex; gridColumn < columnEnd; gridColumn += 1) {
            grid[gridRow][gridColumn] = cell;
          }
        }
        columnIndex = columnEnd;
      });
    });
    return grid;
  };
  const getTableColumnWidths = (table) => {
    const columnCount = getTableColumnCount(table);
    const tableWidth = table.getBoundingClientRect().width;
    const colgroup = table.querySelector(':scope > colgroup');
    if (colgroup && colgroup.children.length === columnCount) {
      return Array.from(colgroup.children, (column) => {
        const width = Number.parseFloat(column.style.width);
        return column.style.width.endsWith('%') && Number.isFinite(width)
          ? tableWidth * width / 100
          : column.getBoundingClientRect().width;
      });
    }
    const widths = Array(columnCount).fill(0);
    const samples = Array(columnCount).fill(0);
    getTableGrid(table).forEach((row) => {
      const cells = new Set(row.filter(Boolean));
      cells.forEach((cell) => {
        if (cell.colSpan !== 1) return;
        const columnIndex = row.indexOf(cell);
        if (columnIndex < 0) return;
        widths[columnIndex] += cell.getBoundingClientRect().width;
        samples[columnIndex] += 1;
      });
    });
    const fallbackWidth = tableWidth / Math.max(1, columnCount);
    return widths.map((width, index) => samples[index] ? width / samples[index] : fallbackWidth);
  };
  const ensureTableColumnGroup = (table) => {
    const columnCount = getTableColumnCount(table);
    if (!columnCount) return [];
    const existing = table.querySelector(':scope > colgroup');
    if (existing && existing.children.length === columnCount) return getTableColumnWidths(table);
    const widths = getTableColumnWidths(table);
    const total = widths.reduce((sum, width) => sum + width, 0) || table.getBoundingClientRect().width;
    const colgroup = document.createElement('colgroup');
    widths.forEach((width) => {
      const column = document.createElement('col');
      column.style.width = `${(width / total) * 100}%`;
      colgroup.append(column);
    });
    if (existing) existing.remove();
    table.insertBefore(colgroup, table.firstChild);
    table.style.tableLayout = 'fixed';
    Array.from(table.rows).forEach((row) => Array.from(row.cells).forEach((cell) => {
      cell.style.removeProperty('width');
    }));
    return widths;
  };
  const setTableColumnWidths = (table, widths) => {
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (!total) return;
    const colgroup = table.querySelector(':scope > colgroup') || document.createElement('colgroup');
    if (!colgroup.parentElement) table.insertBefore(colgroup, table.firstChild);
    colgroup.replaceChildren(...widths.map((width) => {
      const column = document.createElement('col');
      column.style.width = `${(width / total) * 100}%`;
      return column;
    }));
    table.style.tableLayout = 'fixed';
    Array.from(table.rows).forEach((row) => Array.from(row.cells).forEach((cell) => {
      cell.style.removeProperty('width');
    }));
  };
  const canExpandTable = (table, addRows, addColumns) => {
    const rows = table.rows.length + addRows;
    const columns = getTableColumnCount(table) + addColumns;
    if (rows > MAX_TABLE_DIMENSION || columns > MAX_TABLE_DIMENSION || rows * columns > MAX_TABLE_CELLS) {
      showToast(`Tables are limited to ${MAX_TABLE_DIMENSION} rows or columns and ${MAX_TABLE_CELLS} cells.`);
      return false;
    }
    return true;
  };
  const insertTableColumn = (table, index, position = 'right') => {
    const rows = Array.from(table.rows);
    const firstRow = rows[0];
    if (!firstRow || rows.some((row) => row.cells.length !== firstRow.cells.length ||
      Array.from(row.cells).some((cell) => cell.colSpan !== 1 || cell.rowSpan !== 1))) {
      showToast('Add a column after unmerging table cells.');
      return null;
    }
    const sourceIndex = Math.max(0, Math.min(index, firstRow.cells.length - 1));
    const insertionIndex = position === 'left' ? sourceIndex : sourceIndex + 1;
    const hasColumnGroup = Boolean(table.querySelector(':scope > colgroup'));
    const widths = hasColumnGroup
      ? getTableColumnWidths(table)
      : Array.from(firstRow.cells, (cell) => cell.getBoundingClientRect().width);
    const sharedWidth = widths[sourceIndex] / 2;
    widths[sourceIndex] = sharedWidth;
    widths.splice(insertionIndex, 0, sharedWidth);
    rows.forEach((row) => {
      const reference = row.cells[sourceIndex];
      const newCell = createMatchingEmptyCell(reference);
      newCell.removeAttribute('id');
      row.insertBefore(newCell, position === 'left' ? reference : reference.nextSibling);
      if (!hasColumnGroup) {
        Array.from(row.cells).forEach((cell, columnIndex) => {
          cell.style.width = `${widths[columnIndex]}px`;
        });
      }
    });
    if (hasColumnGroup) setTableColumnWidths(table, widths);
    else table.style.tableLayout = 'fixed';
    return insertionIndex;
  };
  const createTableCell = (tagName) => {
    return document.createElement(tagName);
  };
  const createMatchingEmptyCell = (source) => {
    const cell = source ? source.cloneNode(false) : createTableCell('td');
    cell.rowSpan = 1;
    cell.colSpan = 1;
    return cell;
  };
  const focusTableCell = (cell) => {
    if (!cell) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
    updateTableToolbar(cell);
  };
  document.querySelectorAll('[data-table-style]').forEach((button) => {
    button.addEventListener('click', () => {
      const table = getActiveTable();
      if (!table) return;
      table.dataset.tableStyle = button.dataset.tableStyle;
      const picker = document.querySelector('[data-color-picker="table-border"]');
      const borderColor = TABLE_STYLE_PRESETS[button.dataset.tableStyle].border;
      table.dataset.borderColor = borderColor;
      picker.querySelector('input[type="color"]').value = borderColor;
      picker.querySelector('.color-tool > span').style.backgroundColor = borderColor;
      applyTableDesign(table);
    });
  });
  tableManipulators.addEventListener('click', (event) => {
    const grip = event.target.closest('[data-grip-kind^="insert-"]');
    if (!grip || !activeTable || !editor.contains(activeTable)) return;
    const table = activeTable;
    const index = Number(grip.dataset.gripIndex);
    if (grip.dataset.gripKind === 'insert-row') {
      if (!canExpandTable(table, 1, 0)) return;
      const sourceRow = table.rows[index];
      if (!sourceRow) return;
      const sourceHeight = sourceRow.getBoundingClientRect().height;
      const newRow = sourceRow.cloneNode(false);
      newRow.removeAttribute('id');
      newRow.style.height = `${sourceHeight}px`;
      Array.from(sourceRow.cells).forEach((sourceCell) => {
        const newCell = createMatchingEmptyCell(sourceCell);
        newCell.removeAttribute('id');
        newCell.style.height = `${sourceCell.getBoundingClientRect().height}px`;
        newRow.append(newCell);
      });
      sourceRow.parentElement.insertBefore(newRow, sourceRow.nextSibling);
      focusTableCell(newRow.cells[0]);
    } else if (grip.dataset.gripKind === 'insert-column-edge') {
      if (!canExpandTable(table, 0, 1)) return;
      const insertionIndex = insertTableColumn(table, index, grip.dataset.insertPosition);
      if (insertionIndex === null) return;
      focusTableCell(table.rows[0].cells[insertionIndex]);
    } else {
      if (!canExpandTable(table, 0, 1)) return;
      const insertionIndex = insertTableColumn(table, index);
      if (insertionIndex === null) return;
      focusTableCell(table.rows[0].cells[insertionIndex]);
    }
    applyTableDesign(table);
    refreshTableManipulators(table);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertTable' }));
    scheduleSave();
    updateCounts();
  });
  const getSelectedTableCellRectangle = (table) => {
    const selectedCells = new Set(table.querySelectorAll('.table-band-selected'));
    if (selectedCells.size < 2) return null;
    const rows = Array.from(table.rows);
    const grid = rows.map(() => []);
    rows.forEach((row, rowIndex) => {
      let columnIndex = 0;
      Array.from(row.cells).forEach((cell) => {
        while (grid[rowIndex][columnIndex]) columnIndex += 1;
        const rowEnd = Math.min(rows.length, rowIndex + cell.rowSpan);
        const columnEnd = columnIndex + cell.colSpan;
        for (let gridRow = rowIndex; gridRow < rowEnd; gridRow += 1) {
          for (let gridColumn = columnIndex; gridColumn < columnEnd; gridColumn += 1) {
            grid[gridRow][gridColumn] = cell;
          }
        }
        columnIndex = columnEnd;
      });
    });
    const positions = new Map();
    grid.forEach((gridRow, rowIndex) => gridRow.forEach((cell, columnIndex) => {
      if (cell && selectedCells.has(cell)) {
        const position = positions.get(cell) || {
          startRow: rowIndex, endRow: rowIndex,
          startColumn: columnIndex, endColumn: columnIndex
        };
        position.endRow = rowIndex;
        position.endColumn = columnIndex;
        positions.set(cell, position);
      }
    }));
    if (positions.size !== selectedCells.size) return null;
    const bounds = {
      startRow: Math.min(...Array.from(positions.values(), (position) => position.startRow)),
      endRow: Math.max(...Array.from(positions.values(), (position) => position.endRow)),
      startColumn: Math.min(...Array.from(positions.values(), (position) => position.startColumn)),
      endColumn: Math.max(...Array.from(positions.values(), (position) => position.endColumn))
    };
    for (let rowIndex = bounds.startRow; rowIndex <= bounds.endRow; rowIndex += 1) {
      for (let columnIndex = bounds.startColumn; columnIndex <= bounds.endColumn; columnIndex += 1) {
        if (!selectedCells.has(grid[rowIndex][columnIndex])) return null;
      }
    }
    const cells = Array.from(positions.keys()).sort((first, second) => {
      const firstPosition = positions.get(first);
      const secondPosition = positions.get(second);
      return firstPosition.startRow - secondPosition.startRow ||
        firstPosition.startColumn - secondPosition.startColumn;
    });
    return { ...bounds, cells, firstCell: grid[bounds.startRow][bounds.startColumn] };
  };
  const replaceTableCellTag = (cell, tagName) => {
    const replacement = document.createElement(tagName);
    Array.from(cell.attributes).forEach(({ name, value }) => replacement.setAttribute(name, value));
    while (cell.firstChild) replacement.append(cell.firstChild);
    cell.replaceWith(replacement);
    return replacement;
  };
  const setRepeatedHeaderRow = (table, enabled) => {
    if (enabled && !table.tHead && table.rows.length) {
      const firstRow = table.rows[0];
      const rowIndex = firstRow.rowIndex;
      const header = document.createElement('thead');
      Array.from(firstRow.cells).forEach((cell) => replaceTableCellTag(cell, 'th'));
      header.append(firstRow);
      table.insertBefore(header, table.firstChild);
      table.dataset.repeatHeader = 'true';
      return table.rows[rowIndex].cells[0];
    }
    if (!enabled && table.tHead) {
      const header = table.tHead;
      const rows = Array.from(header.rows);
      const body = table.tBodies[0] || table.createTBody();
      rows.forEach((row) => {
        Array.from(row.cells).forEach((cell) => replaceTableCellTag(cell, 'td'));
        body.insertBefore(row, body.firstChild);
      });
      header.remove();
      delete table.dataset.repeatHeader;
      return table.rows[0] && table.rows[0].cells[0];
    }
    return table.rows[0] && table.rows[0].cells[0];
  };
  tableLayoutPanel.querySelectorAll('[data-table-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!activeTableCell || !editor.contains(activeTableCell)) return;
      const table = getActiveTable();
      const row = activeTableCell.parentElement;
      const columnIndex = activeTableCell.cellIndex;
      const action = button.dataset.tableAction;
      if (action === 'row-above' || action === 'row-below') {
        if (!canExpandTable(table, 1, 0)) return;
        const newRow = document.createElement('tr');
        newRow.style.height = `${row.getBoundingClientRect().height}px`;
        Array.from(row.cells).forEach((cell) => newRow.append(createMatchingEmptyCell(cell)));
        row.parentElement.insertBefore(newRow, action === 'row-above' ? row : row.nextSibling);
        updateTableToolbar(newRow.cells[columnIndex]);
      } else if (action === 'column-left' || action === 'column-right') {
        if (!canExpandTable(table, 0, 1)) return;
        insertTableColumn(table, columnIndex, action === 'column-left' ? 'left' : 'right');
        updateTableToolbar(table.rows[row.rowIndex].cells[columnIndex + (action === 'column-right' ? 1 : 0)]);
      } else if (action === 'delete-row') {
        const rowIndexes = selectedTableBand && selectedTableBand.table === table &&
          selectedTableBand.axis === 'row'
          ? Array.from({ length: selectedTableBand.endRow - selectedTableBand.startRow + 1 },
            (_, offset) => selectedTableBand.startRow + offset)
          : [row.rowIndex];
        const firstRemovedRow = rowIndexes[0];
        if (rowIndexes.length >= table.rows.length) {
          table.remove();
          clearTableBandSelection();
          updateTableToolbar(null);
        } else {
          rowIndexes.slice().reverse().forEach((index) => table.rows[index]?.remove());
          clearTableBandSelection();
          const nextRow = table.rows[Math.min(firstRemovedRow, table.rows.length - 1)];
          updateTableToolbar(nextRow && nextRow.cells[Math.min(columnIndex, nextRow.cells.length - 1)]);
        }
      } else if (action === 'delete-column') {
        const columnIndexes = selectedTableBand && selectedTableBand.table === table &&
          selectedTableBand.axis === 'column'
          ? Array.from({ length: selectedTableBand.endColumn - selectedTableBand.startColumn + 1 },
            (_, offset) => selectedTableBand.startColumn + offset)
          : [columnIndex];
        const columnCount = Math.max(0, ...Array.from(table.rows, (tableRow) => tableRow.cells.length));
        if (columnIndexes.length >= columnCount) {
          table.remove();
          clearTableBandSelection();
          updateTableToolbar(null);
        } else {
          Array.from(table.rows).forEach((tableRow) => {
            columnIndexes.slice().reverse().forEach((index) => tableRow.cells[index]?.remove());
          });
          clearTableBandSelection();
          const nextRow = table.rows[Math.min(row.rowIndex, table.rows.length - 1)];
          updateTableToolbar(nextRow && nextRow.cells[Math.min(columnIndex, nextRow.cells.length - 1)]);
        }
      } else if (action === 'merge-cells') {
        const selection = getSelectedTableCellRectangle(table);
        if (!selection) {
          showToast('Select two or more adjacent cells in the same table first.');
          return;
        }
        ensureTableColumnGroup(table);
        const { cells, firstCell, startRow, endRow, startColumn, endColumn } = selection;
        cells.filter((cell) => cell !== firstCell).forEach((cell) => {
          if (cell.textContent.trim()) {
            firstCell.append(document.createElement('br'));
            while (cell.firstChild) firstCell.append(cell.firstChild);
          }
          cell.remove();
        });
        firstCell.colSpan = endColumn - startColumn + 1;
        firstCell.rowSpan = endRow - startRow + 1;
        clearTableBandSelection();
        updateTableToolbar(firstCell);
      } else if (action === 'split-cell') {
        const cell = activeTableCell;
        if (cell.colSpan === 1 && cell.rowSpan === 1) {
          if (!canExpandTable(table, 0, 1)) return;
          const insertionIndex = insertTableColumn(table, cell.cellIndex, 'right');
          if (insertionIndex === null) return;
          clearTableBandSelection();
          updateTableToolbar(cell);
          applyTableDesign(table);
          refreshTableManipulators(table);
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertTable' }));
          scheduleSave();
          updateCounts();
          return;
        }
        ensureTableColumnGroup(table);
        const columnSpan = cell.colSpan;
        const rowSpan = cell.rowSpan;
        cell.colSpan = 1;
        cell.rowSpan = 1;
        for (let offset = 1; offset < columnSpan; offset += 1) {
          cell.parentElement.insertBefore(createMatchingEmptyCell(cell), cell.nextSibling);
        }
        for (let offset = 1; offset < rowSpan; offset += 1) {
          const row = table.rows[cell.parentElement.rowIndex + offset];
          if (!row) continue;
          for (let column = 0; column < columnSpan; column += 1) {
            row.insertBefore(createMatchingEmptyCell(cell), row.cells[cell.cellIndex + column] || null);
          }
        }
        updateTableToolbar(cell);
      } else if (action === 'distribute-columns') {
        const columnCount = getTableColumnCount(table);
        if (columnCount) {
          if (table.querySelector(':scope > colgroup')) {
            const equalWidth = table.getBoundingClientRect().width / columnCount;
            setTableColumnWidths(table, Array(columnCount).fill(equalWidth));
          } else {
            table.style.tableLayout = 'fixed';
            Array.from(table.rows).forEach((tableRow) => Array.from(tableRow.cells).forEach((cell) => {
              cell.style.width = `${100 / columnCount}%`;
            }));
          }
        }
      } else if (action === 'distribute-rows') {
        const rowHeight = table.getBoundingClientRect().height / Math.max(1, table.rows.length);
        Array.from(table.rows).forEach((tableRow) => {
          tableRow.style.height = `${rowHeight}px`;
        });
      } else if (action === 'shade-cell') {
        activeTableCell.style.backgroundColor = document.getElementById('table-cell-color').value;
      } else if (action === 'delete-table') {
        clearTableBandSelection();
        if (selectedObject === table) setSelectedObject(null);
        table.remove();
        updateTableToolbar(null);
        tableLayoutTab.hidden = true;
        if (tableLayoutTab.classList.contains('active')) {
          activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
        }
        scheduleSave();
        updateCounts();
        return;
      } else if (action === 'fit-text') {
        Array.from(table.rows).forEach((tableRow) => Array.from(tableRow.cells).forEach((cell) => {
          cell.style.whiteSpace = 'pre-wrap';
          cell.style.overflowWrap = 'anywhere';
        }));
      }
      applyTableDesign(table);
      refreshTableManipulators(table);
      if (!editor.contains(table)) {
        tableLayoutTab.hidden = true;
        if (tableLayoutTab.classList.contains('active')) {
          activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
        }
      }
      scheduleSave();
      updateCounts();
    });
  });
  document.getElementById('table-borders').addEventListener('change', (event) => {
    const table = getActiveTable();
    if (!table) return;
    table.dataset.borders = event.currentTarget.value;
    scheduleSave();
  });
  document.getElementById('table-alignment').addEventListener('change', (event) => {
    const table = getActiveTable();
    if (!table) return;
    table.dataset.tableAlign = event.currentTarget.value;
    table.style.marginLeft = '';
    table.style.marginRight = '';
    scheduleSave();
  });
  document.getElementById('table-autofit').addEventListener('change', (event) => {
    const table = getActiveTable();
    if (!table) return;
    const mode = event.currentTarget.value;
    table.dataset.tableAutofit = mode;
    table.style.marginLeft = '';
    table.style.marginRight = '';
    if (mode === 'window') {
      table.style.width = '100%';
      table.style.tableLayout = 'auto';
      table.setAttribute('width', '100%');
    } else if (mode === 'contents') {
      table.style.width = 'auto';
      table.style.tableLayout = 'auto';
      table.removeAttribute('width');
    } else {
      table.style.width = table.getAttribute('width') || '100%';
      table.style.tableLayout = 'fixed';
    }
    scheduleSave();
    refreshTableManipulators(table);
  });
  document.getElementById('table-repeat-header').addEventListener('change', (event) => {
    const table = getActiveTable();
    if (!table) return;
    const cell = setRepeatedHeaderRow(table, event.currentTarget.checked);
    updateTableToolbar(cell);
    scheduleSave();
  });
  document.getElementById('table-cell-padding').addEventListener('input', (event) => {
    if (!activeTableCell || !editor.contains(activeTableCell)) return;
    const padding = Math.max(0, Math.min(24, Number(event.currentTarget.value) || 0));
    activeTableCell.style.padding = `${padding}px`;
    updateTableCaretOverlay();
    document.getElementById('table-cell-padding-value').value = `${padding} px`;
    scheduleSave();
  });
  document.getElementById('table-cell-vertical').addEventListener('change', (event) => {
    if (!activeTableCell || !editor.contains(activeTableCell)) return;
    activeTableCell.style.verticalAlign = event.currentTarget.value;
    scheduleSave();
  });
  document.getElementById('table-cell-align').addEventListener('change', (event) => {
    if (!activeTableCell || !editor.contains(activeTableCell)) return;
    activeTableCell.style.textAlign = event.currentTarget.value;
    scheduleSave();
  });
  document.getElementById('table-width').addEventListener('input', (event) => {
    const table = getActiveTable();
    if (!table) return;
    table.setAttribute('width', `${event.currentTarget.value}%`);
    table.style.width = `${event.currentTarget.value}%`;
    table.style.marginLeft = '';
    table.style.marginRight = '';
    document.getElementById('table-width-value').value = `${event.currentTarget.value}%`;
    scheduleSave();
  });
  document.getElementById('table-border-width').addEventListener('input', (event) => {
    const table = getActiveTable();
    if (!table) return;
    const width = Math.max(0, Math.min(8, Number(event.currentTarget.value) || 0));
    event.currentTarget.value = String(width);
    table.dataset.borderWidth = String(width);
    table.style.setProperty('--table-border-width', `${width}px`);
    scheduleSave();
  });
  document.getElementById('table-border-color').addEventListener('input', (event) => {
    const table = getActiveTable();
    if (!table) return;
    table.dataset.borderColor = event.currentTarget.value;
    table.style.setProperty('--table-border-color', event.currentTarget.value);
    const picker = document.querySelector('[data-color-picker="table-border"]');
    picker.querySelector('.color-tool > span').style.backgroundColor = event.currentTarget.value;
    picker.querySelector('input[type="color"]').value = event.currentTarget.value;
    scheduleSave();
  });
  document.getElementById('image-crop-toggle').addEventListener('click', (event) => {
    if (!activeImage || !editor.contains(activeImage)) return;
    imageCropMode = !imageCropMode;
    imageToolbar.dataset.cropMode = String(imageCropMode);
    event.currentTarget.setAttribute('aria-pressed', String(imageCropMode));
    event.currentTarget.querySelector('span').textContent = imageCropMode ? 'Finish' : 'Crop';
    event.currentTarget.title = imageCropMode ? 'Finish cropping' : 'Crop picture';
    event.currentTarget.setAttribute('aria-label', imageCropMode ? 'Finish cropping' : 'Crop picture');
    activeImage.classList.toggle('image-crop-active', imageCropMode);
    refreshImageManipulators(activeImage);
  });
  document.getElementById('image-crop-reset').addEventListener('click', () => {
    if (!activeImage || !editor.contains(activeImage)) return;
    applyImageCrop(activeImage, [0, 0, 0, 0]);
    refreshImageManipulators(activeImage);
    scheduleSave();
  });
  document.getElementById('image-border-color').addEventListener('input', (event) => {
    if (!activeImage || !editor.contains(activeImage)) return;
    activeImage.dataset.imageBorderColor = event.currentTarget.value;
    const borderWidth = Number(activeImage.dataset.imageBorderWidth || 0);
    activeImage.style.border = borderWidth
      ? `${borderWidth}px solid ${event.currentTarget.value}`
      : 'none';
    scheduleSave();
  });
  document.getElementById('image-border-width').addEventListener('input', (event) => {
    if (!activeImage || !editor.contains(activeImage)) return;
    if (event.currentTarget.value === '') return;
    const width = Number(event.currentTarget.value);
    if (!Number.isFinite(width) || width < 0 || width > 100) return;
    activeImage.dataset.imageBorderWidth = String(width);
    activeImage.style.border = width
      ? `${width}px solid ${activeImage.dataset.imageBorderColor || '#176b9a'}`
      : 'none';
    scheduleSave();
  });
  document.getElementById('image-border-width').addEventListener('change', (event) => {
    if (!activeImage || !editor.contains(activeImage)) return;
    const current = Number(event.currentTarget.value);
    const width = event.currentTarget.value === '' || !Number.isFinite(current)
      ? Number(activeImage.dataset.imageBorderWidth || 0)
      : Math.max(0, Math.min(100, current));
    event.currentTarget.value = String(width);
    activeImage.dataset.imageBorderWidth = String(width);
    activeImage.style.border = width
      ? `${width}px solid ${activeImage.dataset.imageBorderColor || '#176b9a'}`
      : 'none';
    scheduleSave();
  });
  document.getElementById('image-radius').addEventListener('input', (event) => {
    if (!activeImage || !editor.contains(activeImage)) return;
    const radius = Number(event.currentTarget.value);
    activeImage.dataset.imageRadius = String(radius);
    activeImage.style.borderRadius = `${radius}px`;
    document.getElementById('image-radius-value').value = `${radius} px`;
    scheduleSave();
  });
  document.getElementById('image-opacity').addEventListener('input', (event) => {
    if (!activeImage || !editor.contains(activeImage)) return;
    const opacity = (Number(event.currentTarget.value) / 100).toFixed(2);
    activeImage.dataset.imageOpacity = opacity;
    activeImage.style.opacity = opacity;
    document.getElementById('image-opacity-value').value = `${event.currentTarget.value}%`;
    scheduleSave();
  });
  document.getElementById('image-delete').addEventListener('click', () => {
    if (activeImage && editor.contains(activeImage)) activeImage.remove();
    activeImage = null;
    pictureFormatTab.hidden = true;
    imageToolbar.hidden = true;
    imageManipulators.hidden = true;
    if (pictureFormatTab.classList.contains('active')) {
      activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
    }
    scheduleSave();
    updateCounts();
  });
  let copiedImage = null;
  let imageCutPending = false;
  const removeSelectedImage = () => {
    if (!activeImage || !editor.contains(activeImage)) return;
    activeImage.remove();
    activeImage = null;
    pictureFormatTab.hidden = true;
    imageToolbar.hidden = true;
    imageManipulators.hidden = true;
    imageManipulators.replaceChildren();
    if (pictureFormatTab.classList.contains('active')) {
      activateRibbonTab(document.querySelector('.tab-button[data-tab="home"]'));
    }
    scheduleSave();
    updateCounts();
  };
  const pasteCopiedImage = () => {
    if (!copiedImage) return false;
    const image = copiedImage.cloneNode(true);
    if (image.dataset.imageWrap === 'free') {
      image.style.left = `${(Number.parseFloat(image.style.left) || 0) + 20}px`;
      image.style.top = `${(Number.parseFloat(image.style.top) || 0) + 20}px`;
      editor.append(image);
    } else if (activeImage && editor.contains(activeImage)) {
      activeImage.insertAdjacentElement('afterend', image);
    } else {
      editor.append(image);
    }
    showImageToolbar(image);
    imageCutPending = false;
    scheduleSave();
    updateCounts();
    return true;
  };
  const previewDialog = document.getElementById('document-preview');
  const previewPages = document.getElementById('preview-pages');
  function openDocumentPreview() {
    const preview = editor.cloneNode(true);
    preview.removeAttribute('id');
    preview.removeAttribute('contenteditable');
    preview.setAttribute('aria-label', 'Print preview document');
    previewPages.replaceChildren(preview);
    previewDialog.showModal();
  }
  document.getElementById('preview-close').addEventListener('click', () => previewDialog.close());
  document.getElementById('preview-print').addEventListener('click', () => {
    previewDialog.close();
    window.setTimeout(() => printDocument(), 100);
  });
  document.getElementById('focus-toggle').addEventListener('click', openDocumentPreview);
  document.getElementById('view-focus-toggle').addEventListener('click', openDocumentPreview);
  document.getElementById('print-button').addEventListener('click', () => printDocument());
  document.getElementById('theme-toggle').addEventListener('click', (event) => {
    const active = document.body.classList.toggle('dark-mode');
    event.currentTarget.setAttribute('aria-pressed', String(active));
    event.currentTarget.querySelector('span:last-child').textContent = active ? 'Light mode' : 'Dark mode';
  });
  document.getElementById('view-ruler-toggle').addEventListener('click', (event) => {
    const visible = document.body.classList.toggle('hide-rulers') === false;
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    event.currentTarget.querySelector('span:last-child').textContent = visible ? 'Ruler' : 'Show ruler';
  });
  document.querySelectorAll('[data-guide-add]').forEach((button) => {
    button.addEventListener('click', () => {
      const axis = button.dataset.guideAdd;
      const existingIndex = alignmentGuides.findIndex((guide) => guide.axis === axis);
      if (existingIndex >= 0) {
        removeAlignmentGuide(existingIndex);
        return;
      }
      const page = Math.max(0, Number(verticalRuler.dataset.pageIndex) || 0);
      const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
      addAlignmentGuide(axis, page, axis === 'x' ? editor.offsetWidth / 2 : pageHeight / 2);
    });
  });
  [
    { id: 'header-toggle', className: 'header-collapsed', name: 'top bar' },
    { id: 'tools-toggle', className: 'tools-collapsed', name: 'tools bar' }
  ].forEach(({ id, className, name }) => {
    const button = document.getElementById(id);
    button.addEventListener('click', () => {
      const expanded = document.body.classList.toggle(className) === false;
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} ${name}`);
      button.title = `${expanded ? 'Hide' : 'Show'} ${name}`;
    });
  });
  const setTypingMode = (enabled) => {
    urduTyping = enabled;
    const toggle = document.getElementById('typing-toggle');
    toggle.classList.toggle('active', urduTyping);
    toggle.setAttribute('aria-pressed', String(urduTyping));
    toggle.querySelector('span:last-child').childNodes[0].textContent = urduTyping ? ' Urdu ' : ' English ';
    toggle.querySelector('strong').textContent = 'ON';
    toggle.setAttribute('aria-label', `Toggle Urdu keyboard mapping; ${urduTyping ? 'Urdu' : 'English'} typing is on`);
    toggle.title = urduTyping ? 'Urdu keyboard mapping is on' : 'English typing is on';
    document.getElementById('typing-status').textContent = urduTyping ? 'Urdu keyboard' : 'English';
  };
  document.getElementById('typing-toggle').addEventListener('click', () => setTypingMode(!urduTyping));
  document.getElementById('typing-help-button').addEventListener('click', () => {
    document.getElementById('shortcuts-dialog').showModal();
  });
  document.getElementById('help-shortcuts-button').addEventListener('click', () => {
    document.getElementById('shortcuts-dialog').showModal();
  });
  const activateRibbonTab = (button) => {
    const homeSelected = button.dataset.tab === 'home';
    const textboxSelected = button === textboxFormatTab || button.dataset.tab === 'textbox-format';
    const shapeSelected = button === shapeFormatTab || button.dataset.tab === 'shape-format' || textboxSelected;
    const pictureSelected = button === pictureFormatTab || button.dataset.tab === 'picture-format';
    document.body.classList.toggle('home-ribbon-active', homeSelected);
    document.body.classList.toggle('shape-ribbon-active', shapeSelected);
    document.body.classList.toggle('picture-ribbon-active', pictureSelected);
    document.body.classList.remove('mobile-ribbon-collapsed');
    const ribbonShell = document.querySelector('.ribbon-shell');
    ribbonShell.classList.toggle('home-ribbon', homeSelected);
    ribbonShell.classList.toggle('shape-format-ribbon', shapeSelected);
    ribbonShell.classList.toggle('picture-format-ribbon', pictureSelected);
    closeLayoutMenus();
    if (button !== tableLayoutTab) tableLayoutTab.hidden = true;
    if (button !== shapeFormatTab) shapeFormatTab.hidden = true;
    if (button !== textboxFormatTab) textboxFormatTab.hidden = true;
    if (button !== pictureFormatTab) pictureFormatTab.hidden = true;
    document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.toggle('active', tab === button));
    const panelName = textboxSelected ? 'shape-format' : button.dataset.tab;
    document.querySelectorAll('.ribbon-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.dataset.panel === panelName);
    });
  };
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      const wasActive = button.classList.contains('active');
      activateRibbonTab(button);
      if (window.matchMedia('(max-width: 767px)').matches && wasActive) {
        document.body.classList.toggle('mobile-ribbon-collapsed');
      }
    });
  });
  const layoutMenus = Array.from(document.querySelectorAll('.layout-menu-trigger')).map((button) => ({
    button,
    menu: document.getElementById(button.getAttribute('aria-controls'))
  }));
  layoutMenus.forEach(({ menu }) => document.body.append(menu));
  const closeLayoutMenus = () => layoutMenus.forEach(({ button, menu }) => {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });
  const positionLayoutMenu = (menu, button) => {
    const bounds = button.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${bounds.bottom + menu.offsetHeight + 4 <= window.innerHeight
      ? bounds.bottom + 4
      : Math.max(4, bounds.top - menu.offsetHeight - 4)}px`;
  };
  layoutMenus.forEach(({ button, menu }) => {
    button.addEventListener('click', () => {
      const opening = menu.hidden;
      closeLayoutMenus();
      if (!opening) return;
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      positionLayoutMenu(menu, button);
    });
  });
  document.addEventListener('pointerdown', (event) => {
    if (!layoutMenus.some(({ button, menu }) => button.contains(event.target) || menu.contains(event.target))) {
      closeLayoutMenus();
    }
  });
  window.addEventListener('resize', () => {
    layoutMenus.forEach(({ button, menu }) => {
      if (!menu.hidden) positionLayoutMenu(menu, button);
    });
  });

  const pageDimensionsMm = {
    Letter: [215.9, 279.4],
    Legal: [215.9, 355.6],
    Executive: [184.1, 266.7],
    A4: [210, 297],
    A5: [148, 210]
  };
  const millimetersToPixels = (millimeters) => millimeters * 96 / 25.4;
  const pageDimensions = Object.fromEntries(
    Object.entries(pageDimensionsMm).map(([name, dimensions]) =>
      [name, dimensions.map(millimetersToPixels)])
  );
  const pageWidthInput = document.getElementById('page-width-input');
  const pageHeightInput = document.getElementById('page-height-input');
  const printPageStyle = document.createElement('style');
  printPageStyle.textContent = '@page { size: 210mm 297mm; margin: 0; }';
  document.head.append(printPageStyle);
  const syncPageSizeInputs = () => {
    const [width, height] = customPageDimensions || pageDimensions[pageSize];
    pageWidthInput.value = (width / 96).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    pageHeightInput.value = (height / 96).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  };
  const applyPageDimensions = () => {
    const [portraitWidth, portraitHeight] = customPageDimensions || pageDimensions[pageSize];
    const width = landscape ? portraitHeight : portraitWidth;
    const height = landscape ? portraitWidth : portraitHeight;
    document.body.classList.toggle('landscape-page', landscape);
    editor.style.setProperty('--layout-page-width', `${width}px`);
    editor.style.setProperty('--layout-page-height', `${height}px`);
    editor.style.width = `${width}px`;
    editor.style.minHeight = `${height}px`;
    syncPageBreakLayout();
    editor.dataset.pageSize = pageSize;
    const pageWidthMm = width * 25.4 / 96;
    const pageHeightMm = height * 25.4 / 96;
    printPageStyle.textContent =
      `@page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0; }`;
    syncRulers();
    queueAutoPagination();
  };
  const closeLayoutMenu = (id) => {
    const entry = layoutMenus.find(({ menu }) => menu.id === id);
    if (!entry) return;
    entry.menu.hidden = true;
    entry.button.setAttribute('aria-expanded', 'false');
  };
  document.querySelectorAll('[data-page-size]').forEach((button) => {
    button.addEventListener('click', () => {
      pageSize = button.dataset.pageSize;
      customPageDimensions = null;
      syncPageSizeInputs();
      applyPageDimensions();
      scheduleSave('Changed Page Size');
      closeLayoutMenu('size-menu');
    });
  });
  document.querySelectorAll('[data-page-orientation]').forEach((button) => {
    button.addEventListener('click', () => {
      landscape = button.dataset.pageOrientation === 'landscape';
      applyPageDimensions();
      scheduleSave('Changed Page Orientation');
      closeLayoutMenu('orientation-menu');
    });
  });
  const marginFields = ['top', 'bottom', 'left', 'right'].map((side) =>
    document.getElementById(`margin-${side}-input`));
  const customMarginsDialog = document.getElementById('custom-margins-dialog');
  let marginGuidesTimer = 0;
  const syncMarginGuides = (values) => {
    const [top, bottom, left, right] = values.map((value) => value * 96);
    const editorStyle = getComputedStyle(editor);
    const pageWidth = editor.offsetWidth;
    const pageHeight = Number.parseFloat(editorStyle.getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(editorStyle.getPropertyValue('--layout-page-gap')) || 20;
    const pageCount = editor.querySelectorAll('.page-break').length + 1;
    marginGuides.replaceChildren();
    marginGuides.style.left = `${editor.offsetLeft}px`;
    marginGuides.style.top = `${editor.offsetTop}px`;
    marginGuides.style.width = `${pageWidth}px`;
    marginGuides.style.height = `${editor.offsetHeight}px`;
    marginGuides.style.transform = `scale(${zoom / 100})`;
    const contentWidth = Math.max(0, pageWidth - left - right);
    const contentHeight = Math.max(0, pageHeight - top - bottom);
    const addLine = (className, x, y, width, height) => {
      const line = document.createElement('span');
      line.className = `margin-guide-line ${className}`;
      line.style.left = `${x}px`;
      line.style.top = `${y}px`;
      line.style.width = `${width}px`;
      line.style.height = `${height}px`;
      marginGuides.append(line);
    };
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const pageTop = pageIndex * (pageHeight + pageGap);
      addLine('margin-guide-top', left, pageTop + top, contentWidth, 0);
      addLine('margin-guide-bottom', left, pageTop + pageHeight - bottom, contentWidth, 0);
      addLine('margin-guide-left', left, pageTop + top, 0, contentHeight);
      addLine('margin-guide-right', pageWidth - right, pageTop + top, 0, contentHeight);
    }
  };
  const showMarginGuides = (values) => {
    window.clearTimeout(marginGuidesTimer);
    syncMarginGuides(values);
    marginGuides.hidden = false;
    marginGuidesTimer = window.setTimeout(() => {
      marginGuides.hidden = true;
      marginGuides.replaceChildren();
    }, 2000);
  };
  const applyMargins = (values, showGuides = true, saveChanges = true) => {
    const [top, bottom, left, right] = values;
    pageMargins = [...values];
    editor.style.padding = `${top * 96}px ${right * 96}px ${bottom * 96}px ${left * 96}px`;
    editor.style.setProperty('--document-margin-top', `${top * 96}px`);
    editor.style.setProperty('--document-margin-bottom', `${bottom * 96}px`);
    editor.style.setProperty('--document-margin-left', `${left * 96}px`);
    editor.style.setProperty('--document-margin-right', `${right * 96}px`);
    syncDocumentHeaderSpacing();
    marginFields.forEach((field, index) => { field.value = String(values[index]); });
    syncRulers();
    queueAutoPagination();
    if (showGuides) showMarginGuides(values);
    if (saveChanges) scheduleSave('Changed Page Margins');
  };
  const marginPresets = {
    normal: [1, 1, 1, 1],
    narrow: [0.5, 0.5, 0.5, 0.5],
    moderate: [1, 1, 0.75, 0.75],
    wide: [1, 1, 2, 2],
    office: [1, 1, 1.25, 1.25]
  };
  syncPageSizeInputs();
  applyPageDimensions();
  applyMargins(pageMargins, false, false);
  document.querySelectorAll('[data-margin-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      applyMargins(marginPresets[button.dataset.marginPreset]);
      closeLayoutMenu('margins-menu');
    });
  });
  document.getElementById('custom-margins-button').addEventListener('click', () => {
    const values = [
      documentMargin('top') / 96,
      documentMargin('bottom') / 96,
      documentMargin('left') / 96,
      documentMargin('right') / 96
    ];
    marginFields.forEach((field, index) => { field.value = String(values[index]); });
    closeLayoutMenu('margins-menu');
    customMarginsDialog.showModal();
  });
  document.getElementById('close-custom-margins').addEventListener('click', () => customMarginsDialog.close());
  document.getElementById('cancel-custom-margins').addEventListener('click', () => customMarginsDialog.close());
  document.getElementById('apply-custom-margins').addEventListener('click', () => {
    const values = marginFields.map((field) => Number(field.value));
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 3)) {
      showToast('Enter page margins between 0 and 3 inches.');
      return;
    }
    applyMargins(values);
    customMarginsDialog.close();
  });
  const applyCustomPageSize = (closeMenu = false) => {
    const width = Number(pageWidthInput.value);
    const height = Number(pageHeightInput.value);
    if (![width, height].every((value) =>
      Number.isFinite(value) && value >= 4 && value <= 20)) return false;
    customPageDimensions = [width * 96, height * 96];
    pageSize = 'Custom';
    applyPageDimensions();
    if (closeMenu) closeLayoutMenu('size-menu');
    return true;
  };
  [pageWidthInput, pageHeightInput].forEach((input) => {
    input.addEventListener('input', () => {
      if (pageWidthInput.value && pageHeightInput.value) applyCustomPageSize();
    });
  });
  document.getElementById('apply-custom-size').addEventListener('click', () => {
    if (!applyCustomPageSize(true)) {
      showToast('Enter page width and height between 4 and 20 inches.');
      return;
    }
    scheduleSave('Changed Page Size');
  });
  document.querySelectorAll('[data-page-border]').forEach((button) => {
    button.addEventListener('click', () => {
      pageBorderStyle = button.dataset.pageBorder;
      applyPageBorder();
      closeLayoutMenu('page-border-menu');
      scheduleSave();
    });
  });
  document.getElementById('page-border-color-input').addEventListener('input', (event) => {
    pageBorderColor = event.currentTarget.value;
    applyPageBorder();
    scheduleSave();
  });
  document.getElementById('page-color-input').addEventListener('input', (event) => {
    pageColor = event.currentTarget.value;
    applyPageColor();
    scheduleSave('Changed Page Color');
  });
  function setZoom(value) {
    zoom = Math.max(70, Math.min(130, value));
    syncZoomControls();
  }
  ['zoom-range', 'status-zoom-range'].forEach((id) => {
    document.getElementById(id).addEventListener('input', (event) => setZoom(Number(event.target.value)));
  });
  ['zoom-out', 'status-zoom-out'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => setZoom(zoom - 10));
  });
  ['zoom-in', 'status-zoom-in'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => setZoom(zoom + 10));
  });
  document.querySelector('.status-fit').addEventListener('click', () => setZoom(100));
  const downloadButton = document.getElementById('download-button');
  const downloadPanel = document.getElementById('download-panel');
  const exportFormat = document.getElementById('export-format');
  const exportPageInput = document.getElementById('export-page-numbers');
  const exportPageError = document.getElementById('export-pages-error');
  const exportPageThumbnails = document.getElementById('export-page-thumbnails');
  const exportCustomPages = document.getElementById('export-custom-pages');
  const exportDownloadAction = document.getElementById('export-download-action');
  const pdfExportHelp = document.getElementById('pdf-export-help');
  let exportPreset = 'digital';
  let exportPageMode = 'all';
  let customExportPages = new Set();
  const pageCount = () => editor.querySelectorAll('.page-break').length + 1;
  const activePageIndex = () => Math.max(0, Math.min(pageCount() - 1, Number(verticalRuler.dataset.pageIndex) || 0));
  const parseExportPages = (value) => {
    const count = pageCount();
    const pages = new Set();
    const items = value.split(',').map((item) => item.trim());
    if (!items.length || items.some((item) => !item)) return null;
    for (const item of items) {
      const match = item.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) return null;
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (start < 1 || end < start || end > count) return null;
      for (let page = start; page <= end; page += 1) pages.add(page - 1);
    }
    return pages;
  };
  const formatExportPageSelection = (pages) => Array.from(pages)
    .sort((a, b) => a - b)
    .map((page) => page + 1)
    .join(', ');
  const syncExportPageThumbnails = () => {
    const count = pageCount();
    const pages = exportPageMode === 'all'
      ? new Set(Array.from({ length: count }, (_, index) => index))
      : exportPageMode === 'current'
        ? new Set([activePageIndex()])
        : customExportPages;
    exportPageThumbnails.replaceChildren();
    for (let page = 0; page < count; page += 1) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'export-page-card';
      card.setAttribute('aria-pressed', String(pages.has(page)));
      card.setAttribute('aria-label', `Page ${page + 1}${pages.has(page) ? ', selected' : ''}`);
      const preview = document.createElement('span');
      preview.className = 'export-page-thumb';
      const text = getPageContentNodes(page).map((node) => node.innerText || node.textContent || '').join(' ').trim();
      const lines = text.split(/\s+/).filter(Boolean).slice(0, 7);
      for (const line of lines.length ? lines : ['']) {
        const linePreview = document.createElement('span');
        linePreview.textContent = line;
        preview.append(linePreview);
      }
      const label = document.createElement('small');
      label.textContent = `Page ${page + 1}`;
      card.append(preview, label);
      card.addEventListener('click', () => {
        if (exportPageMode !== 'custom') {
          customExportPages = exportPageMode === 'all'
            ? new Set(Array.from({ length: pageCount() }, (_, index) => index))
            : new Set([activePageIndex()]);
        }
        if (customExportPages.has(page)) customExportPages.delete(page);
        else customExportPages.add(page);
        exportPageMode = 'custom';
        document.querySelectorAll('[data-export-pages]').forEach((button) =>
          button.setAttribute('aria-pressed', String(button.dataset.exportPages === exportPageMode)));
        exportCustomPages.hidden = false;
        exportPageInput.value = formatExportPageSelection(customExportPages);
        updateExportPageValidation();
        syncExportPageThumbnails();
      });
      exportPageThumbnails.append(card);
    }
    document.querySelector('[data-export-pages="current"]').textContent = `This page (${activePageIndex() + 1})`;
  };
  const updateExportPageValidation = () => {
    if (exportPageMode !== 'custom') {
      exportPageError.textContent = '';
      exportDownloadAction.disabled = false;
      return;
    }
    const pages = parseExportPages(exportPageInput.value);
    if (!pages || !pages.size) {
      exportPageError.textContent = 'Enter valid page numbers within this document.';
      exportDownloadAction.disabled = true;
      return;
    }
    customExportPages = pages;
    exportPageError.textContent = '';
    exportDownloadAction.disabled = false;
  };
  const selectedExportPages = () => {
    if (exportPageMode === 'current') return [activePageIndex()];
    if (exportPageMode === 'custom') return Array.from(customExportPages).sort((a, b) => a - b);
    return Array.from({ length: pageCount() }, (_, index) => index);
  };
  const updateExportButtonLabel = () => {
    const format = exportFormat.value;
    const names = { pdf: 'PDF', png: 'PNG image' };
    exportDownloadAction.textContent = `Download ${names[format] || 'file'}`;
    pdfExportHelp.hidden = format !== 'pdf';
  };
  const positionDownloadPanel = () => {
    const buttonRect = downloadButton.getBoundingClientRect();
    const panelWidth = Math.min(410, window.innerWidth - 20);
    const left = Math.max(10, Math.min(window.innerWidth - panelWidth - 10,
      buttonRect.right - panelWidth));
    downloadPanel.style.left = `${left}px`;
    const maxTop = Math.max(10, window.innerHeight - downloadPanel.offsetHeight - 10);
    downloadPanel.style.top = `${Math.max(10, Math.min(maxTop, buttonRect.bottom + 8))}px`;
  };
  const setDownloadPanelOpen = (open) => {
    if (open) {
      syncExportPageThumbnails();
      updateExportPageValidation();
      updateExportButtonLabel();
      positionDownloadPanel();
      downloadPanel.inert = false;
      downloadPanel.setAttribute('aria-hidden', 'false');
      downloadPanel.classList.add('is-open');
      downloadButton.setAttribute('aria-expanded', 'true');
    } else {
      downloadPanel.classList.remove('is-open');
      downloadPanel.setAttribute('aria-hidden', 'true');
      downloadPanel.inert = true;
      downloadButton.setAttribute('aria-expanded', 'false');
    }
  };
  exportPageInput.value = String(activePageIndex() + 1);
  const createExportBranding = () => {
    const branding = document.createElement('div');
    branding.className = 'export-branding-watermark';
    const mark = document.createElement('span');
    mark.className = 'export-logo-mark';
    mark.textContent = 'UW';
    const name = document.createElement('span');
    name.className = 'export-logo-name';
    name.textContent = 'Urdu Writer';
    branding.append(mark, name);
    return branding;
  };
  const exportPrintDocument = (pages, includeBranding = true) => {
    const branding = includeBranding ? createExportBranding() : null;
    const printDocument = editor.cloneNode(false);
    printDocument.removeAttribute('id');
    printDocument.removeAttribute('contenteditable');
    printDocument.classList.add('pdf-export-document');
    printDocument.dataset.exportPreset = exportPreset;
    const header = editor.querySelector('.document-header');
    const footer = editor.querySelector('.document-footer');
    if (header) printDocument.append(header.cloneNode(true));
    pages.forEach((pageIndex, index) => {
      if (index > 0) {
        const pageBreak = document.createElement('div');
        pageBreak.className = 'page-break';
        printDocument.append(pageBreak);
      }
      getPageContentNodes(pageIndex).forEach((node) => printDocument.append(node.cloneNode(true)));
    });
    if (footer) printDocument.append(footer.cloneNode(true));
    document.body.append(printDocument);
    if (branding) document.body.append(branding);
    document.body.classList.add('pdf-export-active');
    let cleanupTimer;
    const cleanup = () => {
      window.clearTimeout(cleanupTimer);
      document.body.classList.remove('pdf-export-active');
      branding?.remove();
      printDocument.remove();
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    cleanupTimer = window.setTimeout(cleanup, 300000);
    window.print();
  };
  const printSelectedPages = (pages, includeBranding) => {
    try {
      exportPrintDocument(pages, includeBranding);
    } catch (error) {
      console.error('Could not open the document print dialog.', error);
      showToast('Could not open the print dialog. Try again.');
    }
  };
  const printDocument = () => {
    printSelectedPages(Array.from({ length: pageCount() }, (_, index) => index), false);
  };
  const renderExportCanvas = async (pages) => {
    await document.fonts.ready;
    const width = editor.offsetWidth;
    const pageHeight = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-height')) || 1123;
    const pageGap = Number.parseFloat(getComputedStyle(editor).getPropertyValue('--layout-page-gap')) || 20;
    if (!width || !pageHeight || !pages.length) throw new Error('Select at least one valid page to export.');
    const externalImage = Array.from(editor.querySelectorAll('img')).find((image) =>
      image.currentSrc && !image.currentSrc.startsWith('data:') &&
      new URL(image.currentSrc, document.baseURI).origin !== window.location.origin);
    if (externalImage) throw new Error('Download external images before exporting the document as PNG or PDF.');
    const height = pageHeight * pages.length;
    const requestedScale = exportPreset === 'print' ? 2 : 1;
    const scale = Math.min(requestedScale, 8192 / width, 8192 / height, Math.sqrt(64000000 / (width * height)));
    const outputWidth = Math.max(1, Math.floor(width * scale));
    const outputPageHeight = Math.max(1, Math.floor(pageHeight * scale));
    const outputHeight = outputPageHeight * pages.length;
    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create an image canvas.');
    const editorRect = editor.getBoundingClientRect();
    const layoutScale = editorRect.width / width || 1;
    context.scale(outputWidth / width, outputPageHeight / pageHeight);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    const editorStyle = getComputedStyle(editor);
    if (editorStyle.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      context.fillStyle = editorStyle.backgroundColor;
      context.fillRect(0, 0, width, height);
    }
    const drawBorder = (rect, style) => {
      const borders = [
        ['borderTopWidth', 'borderTopStyle', 'borderTopColor', rect.left, rect.top, rect.right, rect.top],
        ['borderRightWidth', 'borderRightStyle', 'borderRightColor', rect.right, rect.top, rect.right, rect.bottom],
        ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', rect.right, rect.bottom, rect.left, rect.bottom],
        ['borderLeftWidth', 'borderLeftStyle', 'borderLeftColor', rect.left, rect.bottom, rect.left, rect.top]
      ];
      borders.forEach(([widthProp, styleProp, colorProp, x1, y1, x2, y2]) => {
        const borderWidth = Number.parseFloat(style[widthProp]);
        if (!borderWidth || style[styleProp] === 'none' || style[styleProp] === 'hidden') return;
        context.beginPath();
        context.lineWidth = borderWidth / layoutScale;
        context.strokeStyle = style[colorProp];
        context.setLineDash(style[styleProp] === 'dashed' ? [4, 3] : style[styleProp] === 'dotted' ? [1, 2] : []);
        context.moveTo((x1 - editorRect.left) / layoutScale, (y1 - editorRect.top) / layoutScale);
        context.lineTo((x2 - editorRect.left) / layoutScale, (y2 - editorRect.top) / layoutScale);
        context.stroke();
      });
      context.setLineDash([]);
    };
    const drawText = (node) => {
      const text = node.textContent;
      if (!text.trim()) return;
      const parent = node.parentElement;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const lineRects = Array.from(range.getClientRects());
      if (!lineRects.length) return;
      const lines = lineRects.map((rect) => ({ rect, text: '', left: rect.right, right: rect.left }));
      const clusters = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
        : (() => {
          let offset = 0;
          return Array.from(text).map((segment) => {
            const cluster = { segment, index: offset };
            offset += segment.length;
            return cluster;
          });
        })();
      clusters.forEach(({ segment, index }) => {
        const start = index;
        const end = start + segment.length;
        if (end > text.length) return;
        range.setStart(node, start);
        range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        let line = lines[0];
        let bestDistance = Number.POSITIVE_INFINITY;
        lines.forEach((candidate) => {
          const distance = Math.abs((candidate.rect.top + candidate.rect.bottom) / 2 - (rect.top + rect.bottom) / 2);
          if (distance < bestDistance) {
            line = candidate;
            bestDistance = distance;
          }
        });
        line.text += segment;
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
      });
      lines.forEach(({ rect, text: lineText, left, right }) => {
        if (!lineText) return;
        context.save();
        const opacity = Number.parseFloat(style.opacity);
        context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
        context.fillStyle = style.color;
        context.font = style.font;
        context.direction = style.direction;
        const textAlign = ['left', 'right', 'center', 'start', 'end'].includes(style.textAlign)
          ? style.textAlign
          : 'start';
        context.textAlign = textAlign;
        context.textBaseline = 'alphabetic';
        const fontSize = Number.parseFloat(style.fontSize) || 16;
        const x = textAlign === 'center'
          ? (left + right) / 2
          : textAlign === 'left' || (textAlign === 'start' && style.direction !== 'rtl') ||
            (textAlign === 'end' && style.direction === 'rtl')
            ? left
            : right;
        const baseline = rect.top + fontSize * 1.12;
        context.fillText(lineText, (x - editorRect.left) / layoutScale, (baseline - editorRect.top) / layoutScale);
        const decorations = style.textDecorationLine.split(/\s+/);
        if (decorations.includes('underline') || decorations.includes('line-through')) {
          context.beginPath();
          context.lineWidth = Math.max(1, fontSize / 16);
          context.strokeStyle = style.color;
          const decorationY = baseline + (decorations.includes('underline') ? fontSize * .08 : -fontSize * .3);
          context.moveTo((left - editorRect.left) / layoutScale, (decorationY - editorRect.top) / layoutScale);
          context.lineTo((right - editorRect.left) / layoutScale, (decorationY - editorRect.top) / layoutScale);
          context.stroke();
        }
        context.restore();
      });
    };
    const drawElement = (element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width && !bounds.height) return;
      const rect = {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom
      };
      if (element === editor && style.outlineStyle !== 'none') {
        const outlineWidth = Number.parseFloat(style.outlineWidth);
        const inset = Math.max(0, -Number.parseFloat(style.outlineOffset));
        if (outlineWidth > 0) {
          context.save();
          context.lineWidth = outlineWidth / layoutScale;
          context.strokeStyle = style.outlineColor;
          context.setLineDash(style.outlineStyle === 'dashed' ? [4, 3] : style.outlineStyle === 'dotted' ? [1, 2] : []);
          context.strokeRect(inset + outlineWidth / 2, inset + outlineWidth / 2,
            Math.max(0, width - inset * 2 - outlineWidth), Math.max(0, height - inset * 2 - outlineWidth));
          context.restore();
        }
      }
      if (element !== editor) {
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
          context.fillStyle = style.backgroundColor;
          context.fillRect((rect.left - editorRect.left) / layoutScale, (rect.top - editorRect.top) / layoutScale,
            bounds.width / layoutScale, bounds.height / layoutScale);
        }
        drawBorder(rect, style);
        if (element instanceof HTMLImageElement && element.complete && element.naturalWidth) {
          const opacity = Number.parseFloat(style.opacity);
          context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
          context.drawImage(element, (rect.left - editorRect.left) / layoutScale,
            (rect.top - editorRect.top) / layoutScale, bounds.width / layoutScale, bounds.height / layoutScale);
          context.globalAlpha = 1;
          return;
        }
      }
      for (const child of element.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) drawText(child);
        else if (child instanceof Element) drawElement(child);
      }
    };
    pages.forEach((pageIndex, outputIndex) => {
      const pageTop = pageIndex * (pageHeight + pageGap);
      context.save();
      context.beginPath();
      context.rect(0, outputIndex * pageHeight, width, pageHeight);
      context.clip();
      context.translate(0, outputIndex * pageHeight - pageTop);
      drawElement(editor);
      context.restore();
      const brandX = 20;
      const brandY = outputIndex * pageHeight + pageHeight - 38;
      context.fillStyle = '#176b9a';
      context.beginPath();
      context.roundRect(brandX, brandY, 22, 22, 5);
      context.fill();
      context.fillStyle = '#fff';
      context.font = '700 11px Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('UW', brandX + 11, brandY + 11);
      context.fillStyle = '#26334a';
      context.font = '600 12px Arial, sans-serif';
      context.textAlign = 'left';
      context.fillText('Urdu Writer', brandX + 27, brandY + 11);
    });
    return { canvas, width, pageHeight, outputPageHeight };
  };
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const createPdfBlob = async ({ canvas, width, pageHeight, outputPageHeight, pages }) => {
    const encoder = new TextEncoder();
    const objectBodies = [];
    objectBodies[1] = encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');
    const pageObjectIds = pages.map((_, index) => 3 + index * 3);
    objectBodies[2] = encoder.encode(
      `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
    );
    const widthPoints = width * .75;
    const heightPoints = pageHeight * .75;
    for (let index = 0; index < pages.length; index += 1) {
      const pageObjectId = pageObjectIds[index];
      const contentObjectId = pageObjectId + 1;
      const imageObjectId = pageObjectId + 2;
      const imageCanvas = document.createElement('canvas');
      imageCanvas.width = canvas.width;
      imageCanvas.height = outputPageHeight;
      const imageContext = imageCanvas.getContext('2d');
      if (!imageContext) throw new Error('This browser could not create a PDF page image.');
      imageContext.drawImage(canvas, 0, index * outputPageHeight, canvas.width, outputPageHeight,
        0, 0, imageCanvas.width, imageCanvas.height);
      const imageBlob = await new Promise((resolve) => imageCanvas.toBlob(
        resolve, 'image/jpeg', exportPreset === 'print' ? .98 : .94
      ));
      if (!imageBlob) throw new Error('The browser could not encode a PDF page.');
      const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
      const contentBytes = encoder.encode(
        `q ${widthPoints.toFixed(2)} 0 0 ${heightPoints.toFixed(2)} 0 0 cm /Im0 Do Q`
      );
      objectBodies[pageObjectId] = encoder.encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPoints.toFixed(2)} ${heightPoints.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
      );
      objectBodies[contentObjectId] = new Blob([
        encoder.encode(`<< /Length ${contentBytes.length} >>\nstream\n`),
        contentBytes,
        encoder.encode('\nendstream')
      ]);
      objectBodies[imageObjectId] = new Blob([
        encoder.encode(
          `<< /Type /XObject /Subtype /Image /Width ${imageCanvas.width} /Height ${imageCanvas.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`
        ),
        imageBytes,
        encoder.encode('\nendstream')
      ]);
    }
    const chunks = [];
    let byteOffset = 0;
    const append = (chunk) => {
      chunks.push(chunk);
      byteOffset += chunk.size ?? chunk.byteLength;
    };
    append(encoder.encode('%PDF-1.4\n'));
    const objectOffsets = [0];
    for (let objectId = 1; objectId < objectBodies.length; objectId += 1) {
      objectOffsets[objectId] = byteOffset;
      append(encoder.encode(`${objectId} 0 obj\n`));
      append(objectBodies[objectId]);
      append(encoder.encode('\nendobj\n'));
    }
    const crossReferenceOffset = byteOffset;
    let crossReference = `xref\n0 ${objectBodies.length}\n0000000000 65535 f \n`;
    for (let objectId = 1; objectId < objectBodies.length; objectId += 1) {
      crossReference += `${String(objectOffsets[objectId]).padStart(10, '0')} 00000 n \n`;
    }
    append(encoder.encode(
      `${crossReference}trailer\n<< /Size ${objectBodies.length} /Root 1 0 R >>\n` +
      `startxref\n${crossReferenceOffset}\n%%EOF`
    ));
    return new Blob(chunks, { type: 'application/pdf' });
  };
  const exportPng = async (pages) => {
    const { canvas } = await renderExportCanvas(pages);
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The browser could not encode the document as a PNG image.');
    downloadBlob(png, safeFilename(pages.length > 1 ? 'png' : `page-${pages[0] + 1}.png`));
  };
  const exportPdf = async (pages) => {
    const rendered = await renderExportCanvas(pages);
    const pdf = await createPdfBlob({ ...rendered, pages });
    downloadBlob(pdf, safeFilename(pages.length > 1 ? 'pdf' : `page-${pages[0] + 1}.pdf`));
  };
  downloadButton.addEventListener('click', () => {
    setDownloadPanelOpen(downloadPanel.getAttribute('aria-hidden') === 'true');
  });
  document.addEventListener('pointerdown', (event) => {
    if (downloadPanel.classList.contains('is-open') &&
      !downloadPanel.contains(event.target) && !downloadButton.contains(event.target)) setDownloadPanelOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && downloadPanel.classList.contains('is-open')) {
      setDownloadPanelOpen(false);
      downloadButton.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (downloadPanel.classList.contains('is-open')) positionDownloadPanel();
  });
  document.querySelectorAll('[data-export-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      exportPreset = button.dataset.exportPreset;
      document.querySelectorAll('[data-export-preset]').forEach((option) =>
        option.setAttribute('aria-pressed', String(option === button)));
    });
  });
  document.querySelectorAll('[data-export-pages]').forEach((button) => {
    button.addEventListener('click', () => {
      exportPageMode = button.dataset.exportPages;
      if (exportPageMode === 'current') customExportPages = new Set([activePageIndex()]);
      if (exportPageMode === 'all') customExportPages = new Set(Array.from({ length: pageCount() }, (_, index) => index));
      if (exportPageMode === 'custom' && !customExportPages.size) customExportPages = new Set([activePageIndex()]);
      exportPageInput.value = formatExportPageSelection(customExportPages);
      exportCustomPages.hidden = exportPageMode !== 'custom';
      document.querySelectorAll('[data-export-pages]').forEach((option) =>
        option.setAttribute('aria-pressed', String(option === button)));
      updateExportPageValidation();
      syncExportPageThumbnails();
    });
  });
  exportPageInput.addEventListener('input', () => {
    const pages = parseExportPages(exportPageInput.value);
    if (pages) customExportPages = pages;
    updateExportPageValidation();
    syncExportPageThumbnails();
  });
  document.getElementById('export-select-all-pages').addEventListener('click', () => {
    customExportPages = new Set(Array.from({ length: pageCount() }, (_, index) => index));
    exportPageInput.value = formatExportPageSelection(customExportPages);
    updateExportPageValidation();
    syncExportPageThumbnails();
  });
  exportFormat.addEventListener('change', updateExportButtonLabel);
  exportDownloadAction.addEventListener('click', () => {
    const pages = selectedExportPages();
    setDownloadPanelOpen(false);
    if (exportFormat.value === 'pdf') {
      exportPdf(pages).catch((error) => {
        console.error('Could not export the document as a PDF.', error);
        showToast(error instanceof Error ? error.message : 'PDF export failed. Try again.');
      });
      return;
    }
    exportPng(pages).catch((error) => {
      console.error('Could not export the document as a PNG image.', error);
      showToast(error instanceof Error ? error.message : 'PNG export failed. Try again.');
    });
  });
  document.getElementById('open-file-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const contents = String(reader.result);
        if (file.name.toLowerCase().endsWith('.json')) {
          const project = JSON.parse(contents);
          if (project.format !== 'urdu-writer' || typeof project.html !== 'string') {
            throw new Error('This is not a supported Urdu Writer project file.');
          }
          editor.innerHTML = sanitizeDocumentHtml(project.html);
          if (typeof project.name === 'string') nameInput.value = project.name;
          pageBorderStyle = ['none', 'solid', 'thick', 'double', 'dashed', 'dotted'].includes(project.pageBorderStyle)
            ? project.pageBorderStyle
            : 'none';
          pageBorderColor = /^#[\da-f]{6}$/i.test(project.pageBorderColor || '')
            ? project.pageBorderColor
            : '#697586';
          document.getElementById('page-border-color-input').value = pageBorderColor;
          applyPageBorder();
          pageColor = /^#[\da-f]{6}$/i.test(project.pageColor || '') ? project.pageColor : '#ffffff';
          applyPageColor();
        } else {
          editor.replaceChildren();
          pageBorderStyle = 'none';
          pageBorderColor = '#697586';
          document.getElementById('page-border-color-input').value = pageBorderColor;
          applyPageBorder();
          pageColor = '#ffffff';
          applyPageColor();
          const lines = contents.split(/\r?\n/);
          lines.forEach((line, index) => {
            editor.append(document.createTextNode(line));
            if (index < lines.length - 1) editor.append(document.createElement('br'));
          });
          editor.setAttribute('dir', 'rtl');
        }
        updateCounts();
        scheduleSave();
      } catch (error) {
        window.alert(`Could not open file: ${error.message}`);
      }
    });
    reader.addEventListener('error', () => window.alert('Could not read the file.'));
    reader.readAsText(file);
    event.target.value = '';
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Space') {
      event.preventDefault();
      setTypingMode(!urduTyping);
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const inEditor = editor.contains(event.target);
    const targetElement = event.target instanceof Element ? event.target : event.target.parentElement;
    const selectionNode = window.getSelection()?.anchorNode;
    const selectionElement = selectionNode instanceof Element ? selectionNode : selectionNode?.parentElement;
    const editingTextBox = targetElement?.closest('.editor-textbox[contenteditable="true"]') ||
      selectionElement?.closest('.editor-textbox[contenteditable="true"]');
    const activeTextBox = activeShape && editor.contains(activeShape) &&
      activeShape.dataset.editorTextbox === 'true';
    if (editingTextBox && (key === 'delete' || key === 'backspace')) {
      if (key === 'backspace' && activeTextBox && !activeShape.textContent) event.preventDefault();
      return;
    }
    if (key === 'backspace' && activeTextBox && !targetElement?.closest('input, textarea, select')) {
      event.preventDefault();
      return;
    }
    const prevent = (action) => {
      event.preventDefault();
      action();
    };
    const shapeSelected = activeShape && editor.contains(activeShape) &&
      !targetElement?.closest('input, textarea, select');
    const editingShapeText = shapeSelected && activeShape.isContentEditable &&
      targetElement && activeShape.contains(targetElement);
    if (shapeSelected && !editingShapeText && (key === 'delete' || key === 'backspace')) {
      prevent(removeSelectedShape);
      return;
    }
    const imageSelected = activeImage && editor.contains(activeImage) &&
      !targetElement?.closest('input, textarea, select, button');
    const watermarkSelected = activeWatermark && editor.contains(activeWatermark) &&
      activeWatermark.dataset.watermarkLocked !== 'true' &&
      !targetElement?.closest('input, textarea, select, button');
    if (watermarkSelected && (key === 'delete' || key === 'backspace')) {
      prevent(removeSelectedWatermark);
      return;
    }
    if (imageSelected) {
      if (key === 'delete' || key === 'backspace') {
        prevent(removeSelectedImage);
        return;
      }
      if (modifier && key === 'c') {
        prevent(() => {
          copiedImage = activeImage.cloneNode(true);
          imageCutPending = false;
        });
        return;
      }
      if (modifier && key === 'x') {
        prevent(() => {
          copiedImage = activeImage.cloneNode(true);
          imageCutPending = true;
          removeSelectedImage();
        });
        return;
      }
    }
    if (modifier && key === 'v' && copiedImage && (inEditor || imageCutPending) &&
      !event.target.closest('input, textarea, select, button')) {
      prevent(pasteCopiedImage);
      return;
    }
    if (!modifier) return;

    if (event.altKey) {
      if (inEditor && !event.shiftKey && /^Digit[1-3]$/.test(event.code)) {
        prevent(() => runCommand('formatBlock', `<h${event.code.slice(-1)}>`));
      }
    } else if (key === 's' && event.shiftKey) {
      prevent(() => setDownloadPanelOpen(true));
    } else if (inEditor && event.shiftKey && key === 'n') {
      prevent(resetTextStyle);
    } else if (inEditor && event.shiftKey && key === 'l') {
      prevent(() => runCommand('insertUnorderedList'));
    } else if (inEditor && event.shiftKey && event.code === 'Digit7') {
      prevent(() => runCommand('insertOrderedList'));
    } else if (key === 's') {
      prevent(saveLocally);
    } else if (key === 'o') {
      prevent(() => document.getElementById('open-file-input').click());
    } else if (key === 'n') {
      prevent(() => {
        saveLocally();
        window.location.href = 'editor.html?new=1';
      });
    } else if (key === 'p') {
      prevent(printDocument);
    } else if (key === 'f') {
      prevent(() => document.getElementById('find-button').click());
    } else if (key === 'h') {
      prevent(() => document.getElementById('replace-button').click());
    } else if (key === 'k' && inEditor) {
      prevent(insertLink);
    } else if (inEditor && ['b', 'i', 'u'].includes(key)) {
      prevent(() => runCommand({ b: 'bold', i: 'italic', u: 'underline' }[key]));
    } else if (inEditor && ['l', 'e', 'r', 'j'].includes(key)) {
      prevent(() => runCommand({ l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight', j: 'justifyFull' }[key]));
    } else if (inEditor && key === ' ') {
      prevent(() => runCommand('removeFormat'));
    }
  });
})();
