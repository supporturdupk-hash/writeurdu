(() => {
  const editor = document.getElementById('editor');
  const nameInput = document.getElementById('document-name');
  const saveStatus = document.getElementById('save-status');
  const STORAGE_KEY = 'urdu-writer-document-v1';
  const DOCUMENTS_KEY = 'urdu-writer-documents-v1';
  const RECOVERY_KEY_PREFIX = 'urdu-writer-recovery-v1-';
  let activeDocumentId = '';
  let saveTimer;
  let zoom = 100;
  let phoneticTyping = true;
  let landscape = false;
  let pageSize = 'A4';
  let customPageDimensions = null;
  let lineNumberingMode = 'none';
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
    "'El Messiri', sans-serif", "'Mirza', serif", "'Aref Ruqaa', serif"
  ];
  const fontNames = [
    'Noto Nastaliq Urdu', 'Gulzar', 'Noto Naskh Arabic', 'Lateef', 'Amiri',
    'Markazi Text', 'Scheherazade New', 'Harmattan', 'Noto Sans Arabic',
    'Noto Kufi Arabic', 'Reem Kufi', 'Mada', 'Tajawal', 'Cairo',
    'IBM Plex Sans Arabic', 'Changa', 'Lemonada', 'El Messiri', 'Mirza', 'Aref Ruqaa'
  ];
  const allowedTags = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'DIV', 'EM', 'FONT', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'S', 'SPAN', 'STRIKE',
    'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL'
  ]);

  function sanitizeDocumentHtml(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const cleanNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (!(node instanceof HTMLElement)) return document.createDocumentFragment();
      if (!allowedTags.has(node.tagName)) {
        const fragment = document.createDocumentFragment();
        if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(node.tagName)) {
          Array.from(node.childNodes).forEach((child) => fragment.append(cleanNode(child)));
        }
        return fragment;
      }

      const clean = document.createElement(node.tagName.toLowerCase());
      const documentRegion = node.tagName === 'DIV' && ['header', 'footer'].includes(node.dataset.documentRegion)
        ? node.dataset.documentRegion
        : '';
      const isPageNumberField = node.tagName === 'SPAN' && ['number', 'total'].includes(node.dataset.pageNumberField);
      Array.from(node.attributes).forEach(({ name, value }) => {
        if (name === 'dir' && ['ltr', 'rtl', 'auto'].includes(value.toLowerCase())) {
          clean.setAttribute('dir', value.toLowerCase());
        } else if (name === 'class' && node.tagName === 'DIV' &&
          value.split(/\s+/).some((className) => ['page-break', 'column-break'].includes(className))) {
          clean.className = value.split(/\s+/).find((className) => ['page-break', 'column-break'].includes(className));
          clean.setAttribute('contenteditable', 'false');
        } else if (name === 'class' && node.tagName === 'DIV' && documentRegion &&
          value.split(/\s+/).includes(`document-${documentRegion}`)) {
          clean.className = `document-${documentRegion}`;
        } else if (name === 'data-document-region' && node.tagName === 'DIV' && value === documentRegion) {
          clean.dataset.documentRegion = value;
        } else if (name === 'data-page-number-field' && isPageNumberField) {
          clean.dataset.pageNumberField = value;
        } else if (name === 'data-page-number-set' && node.tagName === 'SPAN' && value === 'true') {
          clean.dataset.pageNumberSet = 'true';
        } else if (name === 'contenteditable' && value === 'false' &&
          (node.classList.contains('page-break') || node.classList.contains('column-break') || isPageNumberField)) {
          clean.setAttribute(name, 'false');
        } else if (['colspan', 'rowspan'].includes(name) && node.tagName === 'TD') {
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
        } else if (name === 'style') {
          const styles = [];
          for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'direction', 'list-style-type', 'line-height', 'margin-top', 'margin-bottom', 'text-indent', 'padding-inline-start', 'color', 'background-color']) {
            const styleValue = node.style.getPropertyValue(property).trim();
            if (!styleValue) continue;
            if (property === 'font-family' && fontFamilies.includes(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'font-size' && /^(?:\d{1,4}(?:\.\d{1,2})?(?:px|pt|em|rem|%))$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'font-weight' && /^(?:normal|bold|[1-9]00)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'font-style' && /^(?:normal|italic|oblique)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'text-decoration' && /^(?:none|underline|line-through|overline)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'text-align' && /^(?:left|right|center|justify)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'direction' && /^(?:ltr|rtl)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'list-style-type' && /^(?:disc|circle|square|decimal|upper-roman|lower-roman|upper-alpha|lower-alpha|decimal-paren|upper-roman-paren|lower-roman-paren|upper-alpha-paren|lower-alpha-paren|decimal-bracket|upper-roman-bracket|lower-roman-bracket|upper-alpha-bracket|lower-alpha-bracket|"(?:•|○|▪|▫|★|➜|\\+|−|♦|♢|❖|➤|☻|☹|✓|✗|□)")$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (property === 'line-height' && /^(?:\d+(?:\.\d+)?|normal)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (['margin-top', 'margin-bottom', 'text-indent', 'padding-inline-start'].includes(property) && /^-?\d+(?:\.\d+)?(?:px|em|rem|%)$/.test(styleValue)) styles.push(`${property}:${styleValue}`);
            if (['color', 'background-color'].includes(property) && CSS.supports('color', styleValue)) styles.push(`${property}:${styleValue}`);
          }
          if (styles.length) clean.setAttribute('style', styles.join(';'));
        }
      });
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

  function updateCounts() {
    const text = editor.innerText.replace(/\u00a0/g, ' ').trim();
    const words = text ? text.split(/\s+/u).filter(Boolean).length : 0;
    const characters = Array.from(text).length;
    document.getElementById('word-count').textContent = `${words} words`;
    document.getElementById('character-count').textContent = `${characters} characters`;
    const pages = Math.max(1, editor.querySelectorAll('.page-break').length + 1);
    document.getElementById('page-total').textContent = String(pages);
    updatePageNumberFields(pages);
  }

  function updatePageNumberFields(pageCount) {
    editor.querySelectorAll('[data-page-number-field="number"]').forEach((field) => {
      const regionName = field.closest('[data-document-region]')?.dataset.documentRegion;
      const page = regionName === 'footer'
        ? pageCount
        : Array.from(editor.querySelectorAll('.page-break')).filter((pageBreak) =>
          pageBreak.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).length + 1;
      field.textContent = String(page);
    });
    editor.querySelectorAll('[data-page-number-field="total"]').forEach((field) => {
      field.textContent = String(pageCount);
    });
  }

  const urduWords = new Map(Object.entries({
    salam: 'سلام', salaam: 'سلام', assalamualaikum: 'السلام علیکم', asalamualaikum: 'السلام علیکم',
    alaikum: 'علیکم', alaykum: 'علیکم', allah: 'اللہ', bismillah: 'بسم اللہ',
    urdu: 'اردو', pakistan: 'پاکستان', khuda: 'خدا', abdul: 'عبدال',
    shukriya: 'شکریہ', meherbani: 'مہربانی', mehrbani: 'مہربانی', bohat: 'بہت',
    bahut: 'بہت', acha: 'اچھا', achha: 'اچھا', achi: 'اچھی', achhi: 'اچھی',
    aap: 'آپ', ap: 'آپ', apka: 'آپ کا', aapka: 'آپ کا', aapki: 'آپ کی',
    main: 'میں', mein: 'میں', hum: 'ہم', tum: 'تم', mera: 'میرا', meri: 'میری',
    mere: 'میرے', naam: 'نام', kya: 'کیا', kiya: 'کیا', hai: 'ہے', hain: 'ہیں',
    he: 'ہے', ho: 'ہو', tha: 'تھا', thi: 'تھی', the: 'تھے', ka: 'کا', ki: 'کی',
    ke: 'کے', ko: 'کو', se: 'سے', mein: 'میں', par: 'پر', aur: 'اور', or: 'اور',
    ye: 'یہ', yeh: 'یہ', wo: 'وہ', woh: 'وہ', is: 'اس', aik: 'ایک', ek: 'ایک',
    likhna: 'لکھنا', likho: 'لکھو', likhen: 'لکھیں', parhna: 'پڑھنا',
    zindagi: 'زندگی', duniya: 'دنیا', dunya: 'دنیا', pyar: 'پیار', pyaar: 'پیار',
    dost: 'دوست', kitab: 'کتاب', kitaab: 'کتاب', ghar: 'گھر', pani: 'پانی',
    paani: 'پانی', aaj: 'آج', kal: 'کل', acha: 'اچھا', mashallah: 'ماشاءاللہ',
    inshallah: 'ان شاء اللہ', inshAllah: 'ان شاء اللہ', khush: 'خوش', waqt: 'وقت',
    mera: 'میرا', apni: 'اپنی', apna: 'اپنا', sath: 'ساتھ', saath: 'ساتھ',
    online: 'آن لائن', likh: 'لکھ', karo: 'کرو', karein: 'کریں', karen: 'کریں',
    nahi: 'نہیں', nahin: 'نہیں',
    subah: 'صبح', raat: 'رات', shaam: 'شام', chahiye: 'چاہیے', mujhe: 'مجھے',
    mujhay: 'مجھے', apko: 'آپ کو', aapko: 'آپ کو', hamara: 'ہمارا',
    bara: 'بڑا', chota: 'چھوٹا', naye: 'نئے', naya: 'نیا'
  }));

  function transliterateRomanUrdu(word) {
    const lower = word.toLocaleLowerCase();
    if (urduWords.has(lower)) return urduWords.get(lower);

    const phonemes = [
      [/sh/g, 'ش'], [/ch/g, 'چ'], [/kh/g, 'خ'], [/gh/g, 'غ'], [/zh/g, 'ژ'],
      [/th/g, 'تھ'], [/dh/g, 'دھ'], [/bh/g, 'بھ'], [/ph/g, 'پھ'], [/jh/g, 'جھ'],
      [/aa/g, 'ا'], [/ee|ii/g, 'ی'], [/oo|uu/g, 'و'], [/ai|ay|ei/g, 'ے'],
      [/au|ou/g, 'و'], [/ng/g, 'نگ']
    ];
    let result = lower;
    phonemes.forEach(([pattern, letter]) => { result = result.replace(pattern, letter); });
    const letters = {
      a: 'ا', b: 'ب', c: 'ک', d: 'د', e: 'ے', f: 'ف', g: 'گ', h: 'ہ', i: 'ی',
      j: 'ج', k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'پ', q: 'ق', r: 'ر',
      s: 'س', t: 'ت', u: 'و', v: 'و', w: 'و', x: 'کس', y: 'ی', z: 'ز',
      "'": 'ع'
    };
    return Array.from(result, (character) => letters[character] || character).join('');
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  function convertTypedRomanWord(finalize = false) {
    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || !selection.rangeCount) return;
    const caret = selection.getRangeAt(0);
    const node = caret.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) return;
    const beforeCaret = node.textContent.slice(0, caret.startOffset);
    const match = beforeCaret.match(finalize
      ? /([A-Za-z']+)([ \t\n\u00a0.,!?;:]?)$/
      : /([A-Za-z']+)([ \t\n\u00a0.,!?;:])$/);
    if (!match) return;
    const romanWord = match[1];
    const replacement = document.createTextNode(transliterateRomanUrdu(romanWord));
    const range = document.createRange();
    range.setStart(node, caret.startOffset - match[0].length);
    range.setEnd(node, caret.startOffset - match[2].length);
    range.deleteContents();
    range.insertNode(replacement);
    const suffix = replacement.nextSibling;
    if (suffix && suffix.nodeType === Node.TEXT_NODE && suffix.textContent) {
      const punctuation = { ',': '،', '?': '؟', ';': '؛' }[suffix.textContent[0]];
      if (punctuation) suffix.textContent = punctuation + suffix.textContent.slice(1);
      range.setStart(suffix, 1);
    } else {
      range.setStartAfter(replacement);
    }
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function syncZoomControls() {
    ['zoom-range', 'status-zoom-range'].forEach((id) => { document.getElementById(id).value = String(zoom); });
    ['zoom-label', 'status-zoom-label'].forEach((id) => { document.getElementById(id).textContent = `${zoom}%`; });
    editor.style.transform = `scale(${zoom / 100})`;
    editor.style.marginBottom = `${(zoom / 100 - 1) * editor.scrollHeight}px`;
    syncRulers();
  }

  const horizontalRuler = document.getElementById('horizontal-ruler');
  const verticalRuler = document.getElementById('vertical-ruler');
  const pageFrame = document.querySelector('.page-frame');
  const rulerIndent = { firstLine: 0, paragraphStart: 0, paragraphEnd: 0 };

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
    pageFrame.style.width = `${editor.getBoundingClientRect().width + 20}px`;
    const paperRect = editor.getBoundingClientRect();
    const rulerRect = horizontalRuler.parentElement.getBoundingClientRect();
    const horizontalScale = paperRect.width / editor.offsetWidth;
    const verticalScale = paperRect.height / editor.offsetHeight;
    const style = getComputedStyle(editor);
    const paddingLeft = rulerPixels(style.paddingLeft);
    const paddingRight = rulerPixels(style.paddingRight);
    const paddingTop = rulerPixels(style.paddingTop);
    const paddingBottom = rulerPixels(style.paddingBottom);
    const horizontalWidth = paperRect.width;
    const verticalHeight = paperRect.height;

    horizontalRuler.style.width = `${horizontalWidth}px`;
    horizontalRuler.style.marginLeft = `${paperRect.left - rulerRect.left}px`;
    horizontalRuler.style.marginRight = '0';
    horizontalRuler.style.setProperty('--ruler-unit', `${96 * horizontalScale}px`);
    horizontalRuler.style.setProperty('--ruler-start', `${paddingLeft / editor.offsetWidth * 100}%`);
    horizontalRuler.style.setProperty('--ruler-end', `${(editor.offsetWidth - paddingRight) / editor.offsetWidth * 100}%`);
    updateRulerLabels(horizontalScale, horizontalWidth);

    const leftMargin = paddingLeft * horizontalScale;
    const rightMargin = horizontalWidth - paddingRight * horizontalScale;
    const firstLine = horizontalWidth - (paddingRight + rulerIndent.paragraphStart + rulerIndent.firstLine) * horizontalScale;
    const paragraphStart = horizontalWidth - (paddingRight + rulerIndent.paragraphStart) * horizontalScale;
    const paragraphEnd = (paddingLeft + rulerIndent.paragraphEnd) * horizontalScale;
    const setMarker = (name, position) => {
      const marker = horizontalRuler.querySelector(`[data-ruler-handle="${name}"]`);
      marker.style.left = `${Math.max(0, Math.min(horizontalWidth - 12, position - 6))}px`;
    };
    setMarker('margin-left', leftMargin);
    setMarker('margin-right', rightMargin);
    setMarker('first-line', firstLine);
    setMarker('paragraph-start', paragraphStart);
    setMarker('paragraph-end', paragraphEnd);

    verticalRuler.style.height = `${verticalHeight}px`;
    verticalRuler.style.setProperty('--ruler-unit', `${96 * verticalScale}px`);
    verticalRuler.style.setProperty('--ruler-start', `${paddingTop / editor.offsetHeight * 100}%`);
    verticalRuler.style.setProperty('--ruler-end', `${(editor.offsetHeight - paddingBottom) / editor.offsetHeight * 100}%`);
    updateRulerLabels(verticalScale, verticalHeight, true);
    verticalRuler.querySelector('[data-ruler-handle="margin-top"]').style.top = `${Math.max(0, paddingTop * verticalScale - 5)}px`;
    verticalRuler.querySelector('[data-ruler-handle="margin-bottom"]').style.top = `${Math.max(0, verticalHeight - paddingBottom * verticalScale - 5)}px`;
    verticalRuler.parentElement.style.left = `${horizontalWidth}px`;
  }

  function rulerDragValue(event, track, vertical) {
    const rect = track.getBoundingClientRect();
    const dimension = vertical ? editor.offsetHeight : editor.offsetWidth;
    const renderedDimension = vertical ? rect.height : rect.width;
    const offset = vertical ? event.clientY - rect.top : event.clientX - rect.left;
    return Math.max(0, Math.min(dimension, offset * dimension / renderedDimension));
  }

  function setRulerValue(handle, value) {
    const style = getComputedStyle(editor);
    const pageWidth = editor.offsetWidth;
    const pageHeight = editor.offsetHeight;
    const minMargin = 36;
    if (handle === 'margin-left' || handle === 'margin-right') {
      const key = handle === 'margin-left' ? 'paddingLeft' : 'paddingRight';
      const maxMargin = Math.max(minMargin, pageWidth - rulerPixels(style.paddingLeft === '' ? 0 : style.paddingLeft) - rulerPixels(style.paddingRight) + rulerPixels(style[key]) - 80);
      const margin = Math.max(minMargin, Math.min(maxMargin, handle === 'margin-left' ? value : pageWidth - value));
      editor.style[key] = `${margin}px`;
    } else if (handle === 'margin-top' || handle === 'margin-bottom') {
      const key = handle === 'margin-top' ? 'paddingTop' : 'paddingBottom';
      const opposite = handle === 'margin-top' ? 'paddingBottom' : 'paddingTop';
      const maxMargin = Math.max(minMargin, pageHeight - rulerPixels(style[opposite]) - 80);
      const margin = Math.max(minMargin, Math.min(maxMargin, handle === 'margin-top' ? value : pageHeight - value));
      editor.style[key] = `${margin}px`;
    } else if (handle === 'first-line') {
      const paragraphStart = rulerIndent.paragraphStart;
      rulerIndent.firstLine = Math.max(0, Math.min(pageWidth / 2, pageWidth - rulerPixels(style.paddingRight) - paragraphStart - value));
      editor.style.setProperty('--ruler-first-line-indent', `${rulerIndent.firstLine}px`);
    } else if (handle === 'paragraph-start') {
      rulerIndent.paragraphStart = Math.max(0, Math.min(pageWidth / 2, pageWidth - rulerPixels(style.paddingRight) - value));
      editor.style.setProperty('--ruler-paragraph-start-indent', `${rulerIndent.paragraphStart}px`);
    } else if (handle === 'paragraph-end') {
      rulerIndent.paragraphEnd = Math.max(0, Math.min(pageWidth / 2, value - rulerPixels(style.paddingLeft)));
      editor.style.setProperty('--ruler-paragraph-end-indent', `${rulerIndent.paragraphEnd}px`);
    }
    syncRulers();
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

  function scheduleSave() {
    setSaveStatus('Saving…');
    saveStatus.title = 'Saving on this device';
    saveRecoveryDraft();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveLocally, 350);
  }

  function flushPendingSave() {
    window.clearTimeout(saveTimer);
    saveLocally();
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
      nameInput.value = 'Untitled document';
      editor.innerHTML = '<p><br></p>';
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
    if (document.activeElement !== editor) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      const range = selection.getRangeAt(0);
      if (protectSelectedRange && range.collapsed) return;
      savedEditorRange = range.cloneRange();
      if (!range.collapsed) {
        protectSelectedRange = false;
        window.clearTimeout(protectRangeTimer);
      }
    }
  }

  function preserveSelectedRange(range) {
    if (!range || range.collapsed) return;
    savedEditorRange = range.cloneRange();
    protectSelectedRange = true;
    window.clearTimeout(protectRangeTimer);
    protectRangeTimer = window.setTimeout(() => { protectSelectedRange = false; }, 400);
  }

  document.querySelector('.ribbon').addEventListener('pointerdown', rememberEditorSelection, true);
  editor.addEventListener('pointerup', () => {
    protectSelectedRange = false;
    lastFormattedSpan = null;
    rememberEditorSelection();
  });
  editor.addEventListener('keyup', () => {
    protectSelectedRange = false;
    lastFormattedSpan = null;
    rememberEditorSelection();
  });

  function cleanPendingSizeMarkers() {
    const selection = window.getSelection();
    editor.querySelectorAll('[data-format-caret]').forEach((span) => {
      if (selection && span.contains(selection.anchorNode) && span.textContent === '\u200b') return;
      span.textContent = span.textContent.replace(/\u200b/g, '');
      span.removeAttribute('data-format-caret');
    });
  }

  document.addEventListener('selectionchange', () => {
    rememberEditorSelection();
    cleanPendingSizeMarkers();
  });

  function focusEditor() {
    rememberEditorSelection();
    editor.focus();
    const selection = window.getSelection();
    if (selection && savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(savedEditorRange);
    }
  }

  function applyInlineStyle(property, value) {
    focusEditor();
    const selection = window.getSelection();
    if (!selection) return;
    let range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range && range.collapsed && lastFormattedSpan && editor.contains(lastFormattedSpan)) {
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
    applyingFontSize = true;
    try {
      applyInlineStyle('font-size', `${size}px`);
    } finally {
      applyingFontSize = false;
    }
    return true;
  }

  function insertHtml(html) {
    focusEditor();
    if (document.queryCommandSupported('insertHTML')) {
      document.execCommand('insertHTML', false, html);
    } else {
      editor.insertAdjacentHTML('beforeend', html);
    }
    scheduleSave();
    updateCounts();
  }

  const keyboardToggle = document.getElementById('onscreen-keyboard-toggle');
  const onscreenKeyboard = document.getElementById('onscreen-keyboard');
  let keyboardShifted = false;
  let keyboardLayout = 'urdu';
  keyboardToggle.addEventListener('click', () => {
    const expanded = keyboardToggle.getAttribute('aria-expanded') !== 'true';
    keyboardToggle.setAttribute('aria-expanded', String(expanded));
    onscreenKeyboard.hidden = !expanded;
    keyboardToggle.closest('.keyboard-sidebar').classList.toggle('keyboard-open', expanded);
  });
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
      if (layout !== 'english') setKeyboardShift(false);
    });
  });
  function setKeyboardShift(shifted) {
    keyboardShifted = shifted;
    document.querySelectorAll('[data-shifted-key]').forEach((key) => {
      key.textContent = shifted ? key.dataset.shiftedKey : key.dataset.onscreenKey;
    });
    const shiftButton = document.querySelector('.keyboard-shift');
    shiftButton.setAttribute('aria-pressed', String(shifted));
  }
  document.querySelector('.keyboard-sidebar').addEventListener('pointerdown', rememberEditorSelection, true);
  document.querySelectorAll('[data-onscreen-action="shift"]').forEach((button) => {
    button.addEventListener('click', () => setKeyboardShift(!keyboardShifted));
  });
  document.querySelectorAll('[data-onscreen-key]').forEach((button) => {
    button.addEventListener('click', () => {
      focusEditor();
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const key = keyboardShifted && button.dataset.shiftedKey
        ? button.dataset.shiftedKey
        : button.dataset.onscreenKey;
      if (key === 'Backspace') {
        if (selection.isCollapsed) selection.modify('extend', 'backward', 'character');
        document.execCommand('delete');
      } else if (key === 'Enter') {
        document.execCommand('insertParagraph');
      } else {
        const wasPhoneticTyping = phoneticTyping;
        if (keyboardLayout === 'english') phoneticTyping = false;
        try {
          document.execCommand('insertText', false, key);
        } finally {
          phoneticTyping = wasPhoneticTyping;
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

  function runCommand(command, value = null) {
    focusEditor();
    let selection = window.getSelection();
    if (selection && selection.isCollapsed && lastFormattedSpan && editor.contains(lastFormattedSpan) &&
      ['bold', 'italic', 'underline', 'fontName', 'foreColor', 'hiliteColor'].includes(command)) {
      const range = document.createRange();
      range.selectNodeContents(lastFormattedSpan);
      selection.removeAllRanges();
      selection.addRange(range);
      savedEditorRange = range.cloneRange();
    }
    const currentRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (command === 'italic' && currentRange && !currentRange.collapsed) {
      applyEnglishItalic(currentRange);
      return;
    }
    document.execCommand(command, false, value);
    if (['bold', 'italic', 'underline', 'fontName', 'foreColor', 'hiliteColor'].includes(command)) {
      preserveSelectedRange(currentRange);
    }
    scheduleSave();
    updateCounts();
  }

  editor.addEventListener('input', () => {
    cleanPendingSizeMarkers();
    if (phoneticTyping) convertTypedRomanWord();
    updateCounts();
    scheduleSave();
  });
  editor.addEventListener('keydown', (event) => {
    if (phoneticTyping && event.key === 'Enter') convertTypedRomanWord(true);
  });
  editor.addEventListener('paste', (event) => {
    const html = event.clipboardData && event.clipboardData.getData('text/html');
    if (!html) return;
    event.preventDefault();
    insertHtml(sanitizeDocumentHtml(html));
  });
  nameInput.addEventListener('input', scheduleSave);
  restoreDocument();
  savedEditorRange = document.createRange();
  savedEditorRange.selectNodeContents(editor);
  savedEditorRange.collapse(false);
  updateCounts();

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.command === 'bold') {
        const hasSavedText = savedEditorRange && !savedEditorRange.collapsed && savedEditorRange.toString();
        if (!hasSavedText && !lastFormattedSpan) return;
      }
      runCommand(button.dataset.command);
    });
  });
  document.getElementById('undo-button').addEventListener('click', () => runCommand('undo'));
  document.getElementById('redo-button').addEventListener('click', () => runCommand('redo'));
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
      if (applyFontSize(fontSizeInput)) focusEditor();
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
    button.addEventListener('click', () => {
      const presets = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
      const current = Number(fontSizeInput.value) || 18;
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
    spacing: document.getElementById('spacing-menu')
  };
  Object.values(paragraphMenus).forEach((menu) => document.body.appendChild(menu));
  const closeParagraphMenus = () => {
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
  const selectedParagraphs = () => {
    focusEditor();
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return [editor.querySelector('p') || editor];
    const range = selection.getRangeAt(0);
    const blocks = new Set();
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return /^(P|LI|H[1-6]|BLOCKQUOTE|DIV)$/.test(node.tagName) && range.intersectsNode(node)
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
      blocks.add(block || editor);
    }
    return [...blocks];
  };
  const applyParagraphSpacing = (value) => {
    selectedParagraphs().forEach((paragraph) => { paragraph.style.lineHeight = value; });
    scheduleSave();
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
      runCommand(alignment === 'justify' ? 'justifyFull' : `justify${alignment[0].toUpperCase()}${alignment.slice(1)}`);
      document.querySelectorAll('[data-paragraph-align]').forEach((item) => item.classList.toggle('active', item === button));
    });
  });
  document.querySelectorAll('[data-line-spacing]').forEach((option) => {
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => {
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
          option.dataset.paragraphSpace === 'before' ? '12px' : '0px';
      });
      scheduleSave();
      closeParagraphMenus();
    });
  });
  document.querySelector('[data-spacing-step]').addEventListener('click', () => {
    const select = document.getElementById('line-spacing');
    const values = [1, 1.15, 1.5, 2, 2.5, 3];
    const next = values.find((value) => value > Number(select.value)) || values[0];
    if (!Array.from(select.options).some((item) => Number(item.value) === next)) {
      select.add(new Option(next, next));
    }
    select.value = String(next);
    applyParagraphSpacing(String(next));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.paragraph-group') && !event.target.closest('.paragraph-menu')) closeParagraphMenus();
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
    editor.style.lineHeight = '1.8';
  }
  document.getElementById('text-color').addEventListener('input', (event) => {
    runCommand('foreColor', event.target.value);
  });
  document.getElementById('highlight-color').addEventListener('input', (event) => {
    runCommand('hiliteColor', event.target.value);
  });
  const paletteColors = [
    '#ffffff', '#000000', '#e7e6e6', '#44546a', '#5b9bd5', '#ed7d31', '#70ad47', '#ffc000', '#4472c4', '#7030a0',
    '#f2f2f2', '#7f7f7f', '#d9e2f3', '#d6dce4', '#deebf7', '#fce4d6', '#e2f0d9', '#fff2cc', '#d9eaf7', '#e4dfec',
    '#d9d9d9', '#595959', '#b4c7e7', '#adb9ca', '#bdd7ee', '#f4b183', '#a9d18e', '#ffe699', '#9bc2e6', '#c5b2d6',
    '#bfbfbf', '#3f3f3f', '#8eaadb', '#8497b0', '#9dc3e6', '#f8cbad', '#c6e0b4', '#ffdf7f', '#70adce', '#a58ab5',
    '#a6a6a6', '#262626', '#4472c4', '#44546a', '#5b9bd5', '#ed7d31', '#70ad47', '#ffc000', '#4472c4', '#7030a0',
    '#808080', '#0d0d0d', '#2f5597', '#26334a', '#2e75b6', '#c65911', '#548235', '#bf9000', '#1f4e78', '#5b2c6f'
  ];
  const standardColors = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
  document.querySelectorAll('.color-picker').forEach((picker) => {
    const palette = picker.querySelector('.color-palette');
    [...paletteColors, 'standard-label', ...standardColors].forEach((color) => {
      if (color === 'standard-label') {
        const label = document.createElement('span');
        label.className = 'standard-colors-label';
        label.textContent = 'Standard colors';
        palette.append(label);
        return;
      }
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.style.backgroundColor = color;
      swatch.title = color;
      swatch.setAttribute('aria-label', color);
      swatch.dataset.color = color;
      palette.append(swatch);
    });
    palette.append(palette.querySelector('.more-colors'));
    picker.querySelector('.color-tool').addEventListener('click', () => {
      document.querySelectorAll('.color-picker.open').forEach((openPicker) => {
        if (openPicker !== picker) openPicker.classList.remove('open');
      });
      picker.classList.toggle('open');
    });
    palette.addEventListener('click', (event) => {
      const swatch = event.target.closest('[data-color]');
      if (!swatch) return;
      picker.classList.remove('open');
      const isHighlight = picker.dataset.colorPicker === 'highlight';
      runCommand(isHighlight ? 'hiliteColor' : 'foreColor', swatch.dataset.color);
      picker.querySelector('.color-tool > span').style.backgroundColor = swatch.dataset.color;
    });
    picker.querySelector('.color-tool').addEventListener('click', () => {
      if (picker.classList.contains('open')) {
        const rect = picker.querySelector('.color-tool').getBoundingClientRect();
        const paletteRect = palette.getBoundingClientRect();
        const paletteHeight = paletteRect.height || 190;
        palette.style.left = `${Math.max(4, Math.min(window.innerWidth - 230, rect.left))}px`;
        palette.style.top = `${Math.min(window.innerHeight - paletteHeight - 4, rect.bottom + 4)}px`;
      }
    });
    picker.querySelector('input[type="color"]').addEventListener('input', (event) => {
      picker.classList.remove('open');
      picker.querySelector('.color-tool > span').style.backgroundColor = event.target.value;
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.color-picker')) {
      document.querySelectorAll('.color-picker.open').forEach((picker) => picker.classList.remove('open'));
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
  function insertTable(rows, columns) {
    const cells = Array.from({ length: rows }, () =>
      `<tr>${Array.from({ length: columns }, () => '<td><br></td>').join('')}</tr>`).join('');
    insertHtml(`<table><tbody>${cells}</tbody></table><p><br></p>`);
  }
  const insertMenus = [
    { button: document.getElementById('table-button'), menu: document.getElementById('table-menu') },
    { button: document.getElementById('page-number-button'), menu: document.getElementById('page-number-menu') },
    { button: document.getElementById('emoji-button'), menu: document.getElementById('emoji-menu') }
  ];
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
  const tablePicker = document.querySelector('.table-picker-grid');
  const tableSizeLabel = document.getElementById('table-size-label');
  const setTablePickerSize = (rows, columns) => {
    tableSizeLabel.textContent = `${columns} × ${rows} Table`;
    tablePicker.querySelectorAll('button').forEach((cell) => {
      const selected = Number(cell.dataset.row) <= rows && Number(cell.dataset.column) <= columns;
      cell.classList.toggle('selected', selected);
      cell.setAttribute('aria-selected', String(selected));
    });
  };
  for (let row = 1; row <= 10; row += 1) {
    for (let column = 1; column <= 8; column += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.setAttribute('role', 'gridcell');
      cell.dataset.row = String(row);
      cell.dataset.column = String(column);
      cell.setAttribute('aria-label', `${row} rows, ${column} columns`);
      cell.addEventListener('pointerdown', (event) => event.preventDefault());
      cell.addEventListener('pointerenter', () => setTablePickerSize(row, column));
      cell.addEventListener('focus', () => setTablePickerSize(row, column));
      cell.addEventListener('click', () => {
        closeInsertMenus();
        insertTable(row, column);
      });
      tablePicker.append(cell);
    }
  }
  tablePicker.addEventListener('pointerleave', () => {
    setTablePickerSize(0, 0);
    tableSizeLabel.textContent = 'Choose row and column';
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
      const pageNumberSet = document.createElement('span');
      pageNumberSet.dataset.pageNumberSet = 'true';
      pageNumberSet.append('Page ');
      const number = document.createElement('span');
      number.dataset.pageNumberField = 'number';
      number.setAttribute('contenteditable', 'false');
      number.textContent = '1';
      pageNumberSet.append(number);
      if (document.getElementById('include-page-count').checked) {
        pageNumberSet.append(' of ');
        const total = document.createElement('span');
        total.dataset.pageNumberField = 'total';
        total.setAttribute('contenteditable', 'false');
        total.textContent = String(Math.max(1, editor.querySelectorAll('.page-break').length + 1));
        pageNumberSet.append(total);
      }
      region.append(document.createTextNode(region.childNodes.length ? ' ' : ''), pageNumberSet);
      closeInsertMenus();
      updateCounts();
      scheduleSave();
      focusDocumentRegion(region);
    });
  });
  document.getElementById('remove-page-numbers').addEventListener('click', () => {
    editor.querySelectorAll('[data-page-number-set="true"]').forEach((field) => field.remove());
    closeInsertMenus();
    updateCounts();
    scheduleSave();
  });
  function ensureDocumentRegion(name, alignment = 'center') {
    let region = editor.querySelector(`[data-document-region="${name}"]`);
    if (!region) {
      region = document.createElement('div');
      region.className = `document-${name}`;
      region.dataset.documentRegion = name;
      region.setAttribute('dir', 'ltr');
      region.style.textAlign = alignment;
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      region.append(paragraph);
      if (name === 'header') editor.insertBefore(region, editor.firstChild);
      else editor.append(region);
    } else {
      region.style.textAlign = alignment;
    }
    return region;
  }
  function focusDocumentRegion(region) {
    const paragraph = region.querySelector('p') || region;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection();
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    savedEditorRange = range.cloneRange();
  }
  document.getElementById('header-insert-button').addEventListener('click', () => {
    focusDocumentRegion(ensureDocumentRegion('header'));
    scheduleSave();
  });
  document.getElementById('footer-insert-button').addEventListener('click', () => {
    focusDocumentRegion(ensureDocumentRegion('footer'));
    scheduleSave();
  });
  document.getElementById('image-button').addEventListener('click', () => {
    document.getElementById('image-input').click();
  });
  document.getElementById('image-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      window.alert('Please select a PNG, JPEG, GIF, or WebP image.');
      event.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      window.alert('Image size must be under 2 MB.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') insertHtml(`<img src="${reader.result}" alt="Inserted image">`);
    });
    reader.addEventListener('error', () => window.alert('Could not read the image.'));
    reader.readAsDataURL(file);
    event.target.value = '';
  });
  document.getElementById('print-button').addEventListener('click', () => window.print());
  document.getElementById('theme-toggle').addEventListener('click', (event) => {
    const active = document.body.classList.toggle('dark-mode');
    event.currentTarget.setAttribute('aria-pressed', String(active));
    event.currentTarget.querySelector('span:last-child').textContent = active ? 'Light mode' : 'Dark mode';
  });
  const focusToggle = document.getElementById('focus-toggle');
  const setFocusMode = (active) => {
    document.body.classList.toggle('focus-mode', active);
    focusToggle.innerHTML = active ? '⛶ <span>Exit focus</span>' : '⛶ <span>Focus</span>';
    focusToggle.setAttribute('aria-pressed', String(active));
    document.getElementById('view-focus-toggle').setAttribute('aria-pressed', String(active));
  };
  focusToggle.addEventListener('click', () => setFocusMode(!document.body.classList.contains('focus-mode')));
  document.getElementById('view-focus-toggle').addEventListener('click', () => setFocusMode(!document.body.classList.contains('focus-mode')));
  document.getElementById('focus-exit-button').addEventListener('click', () => setFocusMode(false));
  document.getElementById('view-ruler-toggle').addEventListener('click', (event) => {
    const visible = document.body.classList.toggle('hide-rulers') === false;
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    event.currentTarget.querySelector('span:last-child').textContent = visible ? 'Ruler' : 'Show ruler';
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('focus-mode') &&
      !document.getElementById('find-panel') && !document.querySelector('dialog[open]')) setFocusMode(false);
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
  document.getElementById('typing-toggle').addEventListener('click', (event) => {
    phoneticTyping = !phoneticTyping;
    event.currentTarget.classList.toggle('active', phoneticTyping);
    event.currentTarget.setAttribute('aria-pressed', String(phoneticTyping));
    event.currentTarget.querySelector('strong').textContent = phoneticTyping ? 'ON' : 'OFF';
    event.currentTarget.title = phoneticTyping ? 'Urdu phonetic typing is on' : 'Urdu phonetic typing is off';
    document.getElementById('typing-status').textContent = phoneticTyping ? 'Urdu phonetic' : 'English';
  });
  document.getElementById('typing-help-button').addEventListener('click', () => {
    document.getElementById('shortcuts-dialog').showModal();
  });
  document.getElementById('help-shortcuts-button').addEventListener('click', () => {
    document.getElementById('shortcuts-dialog').showModal();
  });
  document.querySelectorAll('.tab-button').forEach((button) => {
    button.addEventListener('click', () => {
      const homeSelected = button.dataset.tab === 'home';
      document.body.classList.toggle('home-ribbon-active', homeSelected);
      document.querySelector('.ribbon-shell').classList.toggle('home-ribbon', homeSelected);
      closeLayoutMenus();
      document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.toggle('active', tab === button));
      document.querySelectorAll('.ribbon-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab);
      });
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

  const pageDimensions = {
    Letter: [816, 1056],
    Legal: [816, 1344],
    Executive: [696, 1008],
    A4: [794, 1123],
    A5: [559, 794]
  };
  const applyPageDimensions = () => {
    const [portraitWidth, portraitHeight] = customPageDimensions || pageDimensions[pageSize];
    const width = landscape ? portraitHeight : portraitWidth;
    const height = landscape ? portraitWidth : portraitHeight;
    editor.style.setProperty('--layout-page-width', `${width}px`);
    editor.style.minHeight = `${height}px`;
    editor.dataset.pageSize = pageSize;
    printPageStyle.textContent = customPageDimensions
      ? `@page { size: ${width}px ${height}px; }`
      : `@page { size: ${pageSize} ${landscape ? 'landscape' : 'portrait'}; }`;
    syncRulers();
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
      applyPageDimensions();
      closeLayoutMenu('size-menu');
    });
  });
  document.querySelectorAll('[data-page-orientation]').forEach((button) => {
    button.addEventListener('click', () => {
      landscape = button.dataset.pageOrientation === 'landscape';
      applyPageDimensions();
      closeLayoutMenu('orientation-menu');
    });
  });
  const marginFields = ['top', 'bottom', 'left', 'right'].map((side) =>
    document.getElementById(`margin-${side}-input`));
  const applyMargins = (values) => {
    const [top, bottom, left, right] = values;
    editor.style.padding = `${top * 96}px ${right * 96}px ${bottom * 96}px ${left * 96}px`;
    marginFields.forEach((field, index) => { field.value = String(values[index]); });
    syncRulers();
  };
  const marginPresets = {
    normal: [1, 1, 1, 1],
    narrow: [0.5, 0.5, 0.5, 0.5],
    moderate: [1, 1, 0.75, 0.75],
    wide: [1, 1, 2, 2],
    office: [1, 1, 1.25, 1.25]
  };
  document.querySelectorAll('[data-margin-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      applyMargins(marginPresets[button.dataset.marginPreset]);
      closeLayoutMenu('margins-menu');
    });
  });
  document.getElementById('apply-custom-margins').addEventListener('click', () => {
    const values = marginFields.map((field) => Number(field.value));
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 3)) {
      showToast('Enter page margins between 0 and 3 inches.');
      return;
    }
    applyMargins(values);
    closeLayoutMenu('margins-menu');
  });
  document.getElementById('apply-custom-size').addEventListener('click', () => {
    const width = Number(document.getElementById('page-width-input').value);
    const height = Number(document.getElementById('page-height-input').value);
    if (![width, height].every((value) => Number.isFinite(value) && value >= 4 && value <= 20)) {
      showToast('Enter page width and height between 4 and 20 inches.');
      return;
    }
    customPageDimensions = [Math.round(width * 96), Math.round(height * 96)];
    pageSize = 'Custom';
    applyPageDimensions();
    closeLayoutMenu('size-menu');
  });
  document.querySelectorAll('[data-column-count]').forEach((button) => {
    button.addEventListener('click', () => {
      editor.dataset.columnCount = button.dataset.columnCount;
      closeLayoutMenu('columns-menu');
      scheduleSave();
    });
  });
  document.querySelectorAll('[data-line-numbering]').forEach((button) => {
    button.addEventListener('click', () => {
      lineNumberingMode = button.dataset.lineNumbering;
      if (lineNumberingMode === 'none') delete editor.dataset.lineNumbering;
      else editor.dataset.lineNumbering = lineNumberingMode;
      updateLayoutLineNumbers();
      closeLayoutMenu('line-numbers-menu');
      scheduleSave();
    });
  });
  document.querySelectorAll('[data-page-border]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.pageBorder === 'none') delete editor.dataset.pageBorder;
      else editor.dataset.pageBorder = button.dataset.pageBorder;
      closeLayoutMenu('page-border-menu');
    });
  });
  document.getElementById('page-color-input').addEventListener('input', (event) => {
    editor.style.backgroundColor = event.currentTarget.value;
  });
  function updateLayoutLineNumbers() {
    let line = 0;
    Array.from(editor.children).forEach((child) => {
      if (lineNumberingMode === 'restart' && child.classList.contains('page-break')) line = 0;
      if (child.matches('.document-header, .document-footer')) return;
      const paragraphs = child.matches('p') ? [child] : Array.from(child.querySelectorAll('p'));
      paragraphs.forEach((paragraph) => {
        line += 1;
        paragraph.dataset.layoutLine = String(line);
      });
    });
  }
  editor.addEventListener('input', updateLayoutLineNumbers);
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
  const printPageStyle = document.createElement('style');
  printPageStyle.textContent = '@page { size: A4 portrait; }';
  document.head.append(printPageStyle);
  const downloadProject = () => {
    downloadFile(safeFilename('json'), JSON.stringify({
      format: 'urdu-writer',
      version: 1,
      name: nameInput.value.trim() || 'Untitled document',
      html: editor.innerHTML
    }, null, 2), 'application/json;charset=utf-8');
  };
  document.getElementById('download-button').addEventListener('click', downloadProject);
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
        } else {
          editor.replaceChildren();
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
    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;
    const key = event.key.toLowerCase();
    const inEditor = editor.contains(event.target);
    const prevent = (action) => {
      event.preventDefault();
      action();
    };

    if (event.altKey) {
      if (inEditor && !event.shiftKey && /^Digit[1-3]$/.test(event.code)) {
        prevent(() => runCommand('formatBlock', `<h${event.code.slice(-1)}>`));
      }
    } else if (key === 's' && event.shiftKey) {
      prevent(downloadProject);
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
      prevent(() => window.print());
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
