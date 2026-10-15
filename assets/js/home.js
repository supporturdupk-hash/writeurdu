(() => {
  const STORAGE_KEY = 'urdu-writer-document-v1';
  const DOCUMENTS_KEY = 'urdu-writer-documents-v1';
  const editorUrl = 'editor.html';
  const toast = document.getElementById('home-toast');
  let toastTimer;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
  }

  function cleanPreviewHtml(html) {
    const allowedTags = new Set([
      'A', 'B', 'BLOCKQUOTE', 'BR', 'DIV', 'EM', 'FONT', 'H1', 'H2', 'H3', 'H4',
      'H5', 'H6', 'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'S', 'SPAN', 'STRIKE',
      'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL'
    ]);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const cleanNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

      const element = node;
      if (!allowedTags.has(element.tagName)) {
        const fragment = document.createDocumentFragment();
        if (!['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(element.tagName)) {
          Array.from(element.childNodes).forEach((child) => fragment.append(cleanNode(child)));
        }
        return fragment;
      }

      const clean = document.createElement(element.tagName.toLowerCase());
      if (element.tagName === 'IMG') {
        const src = element.getAttribute('src') || '';
        if (/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)) clean.setAttribute('src', src);
        const alt = element.getAttribute('alt');
        if (alt) clean.setAttribute('alt', alt.slice(0, 200));
      } else if (element.tagName === 'DIV' && element.classList.contains('page-break')) {
        clean.className = 'page-break';
      }

      const styles = [];
      for (const property of ['font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'direction', 'color', 'background-color']) {
        const value = element.style.getPropertyValue(property).trim();
        if (!value || /url\s*\(|expression|[<>]/i.test(value)) continue;
        if (property === 'font-family' && /^[\w\s'",-]{1,100}$/.test(value)) styles.push(`${property}:${value}`);
        if (property === 'font-size' && /^(?:\d{1,3}(?:\.\d{1,2})?(?:px|pt|em|rem|%))$/.test(value)) styles.push(`${property}:${value}`);
        if (property === 'font-weight' && /^(?:normal|bold|[1-9]00)$/.test(value)) styles.push(`${property}:${value}`);
        if (property === 'font-style' && /^(?:normal|italic|oblique)$/.test(value)) styles.push(`${property}:${value}`);
        if (property === 'text-decoration' && /^(?:none|underline|line-through|overline)$/.test(value)) styles.push(`${property}:${value}`);
        if (property === 'text-align' && /^(?:left|right|center|justify)$/.test(value)) styles.push(`${property}:${value}`);
        if (property === 'direction' && /^(?:ltr|rtl)$/.test(value)) styles.push(`${property}:${value}`);
        if (['color', 'background-color'].includes(property) && CSS.supports('color', value)) styles.push(`${property}:${value}`);
      }
      if (styles.length) clean.setAttribute('style', styles.join(';'));
      Array.from(element.childNodes).forEach((child) => clean.append(cleanNode(child)));
      return clean;
    };

    const container = document.createElement('div');
    Array.from(parsed.body.childNodes).forEach((child) => container.append(cleanNode(child)));
    return container.innerHTML;
  }

  function renderRecentPreview(html, name, preview) {
    const frame = document.createElement('iframe');
    frame.className = 'document-preview';
    frame.title = `Preview of ${name}`;
    frame.tabIndex = -1;
    frame.setAttribute('sandbox', '');
    const content = cleanPreviewHtml(html);
    frame.srcdoc = `<!doctype html>
      <html lang="ur" dir="rtl"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap">
      <style>
        *{box-sizing:border-box}html,body{width:794px;min-height:1123px;margin:0;background:#fff}
        body{color:#26334a;font:18px/1.8 'Noto Nastaliq Urdu','Noto Naskh Arabic',serif}
        main{min-height:1123px;padding:78px 86px;direction:rtl;text-align:right;overflow-wrap:anywhere}
        p{min-height:1.8em;margin:0 0 12px}h1,h2,h3{line-height:1.9}
        h1{margin:0 0 16px;font-size:1.55em}img{max-width:100%;height:auto}
        table{width:100%;margin:12px 0;border-collapse:collapse}td,th{min-width:50px;padding:8px;border:1px solid #aeb6c5}
        .page-break{height:1px;margin:26px 0;border-top:1px dashed #aeb6c5}
      </style></head><body><main>${content || '<p><br></p>'}</main></body></html>`;
    preview.replaceChildren(frame);
    const fitFrame = () => {
      const scale = preview.clientWidth / 794;
      frame.style.transform = `scale(${scale})`;
    };
    fitFrame();
    if ('ResizeObserver' in window) new ResizeObserver(fitFrame).observe(preview);
  }

  function createDocumentId() {
    return window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function safeFilename(name, extension) {
    const base = (name || 'urdu-document')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 70);
    return `${base || 'urdu-document'}.${extension}`;
  }

  function downloadDocument(documentData) {
    const project = {
      format: 'urdu-writer',
      name: documentData.name || 'Untitled document',
      html: documentData.html
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFilename(project.name, 'json');
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function printDocument(documentData) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('Allow pop-ups to print this document.');
      return;
    }

    const content = cleanPreviewHtml(documentData.html);
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="ur" dir="rtl"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${documentData.name.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character])}</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap">
      <style>*{box-sizing:border-box}body{margin:0;padding:25mm;color:#26334a;font:18px/1.8 'Noto Nastaliq Urdu','Noto Naskh Arabic',serif}
      main{direction:rtl;text-align:right;overflow-wrap:anywhere}p{min-height:1.8em;margin:0 0 12px}
      h1,h2,h3{line-height:1.9}h1{margin:0 0 16px;font-size:1.55em}img{max-width:100%;height:auto}
      table{width:100%;margin:12px 0;border-collapse:collapse}td,th{min-width:50px;padding:8px;border:1px solid #aeb6c5}
      .page-break{break-after:page;border:0}@media print{body{padding:0}}</style>
      </head><body><main>${content || '<p><br></p>'}</main><script>window.addEventListener('load',()=>window.print())<\/script></body></html>`);
    printWindow.document.close();
  }

  function deleteDocument(id) {
    const documents = readSavedDocuments().filter((documentData) => documentData.id !== id);
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(documents));
    const latest = localStorage.getItem(STORAGE_KEY);
    if (latest) {
      try {
        if ((JSON.parse(latest).id || 'legacy-document') === id) {
          if (documents.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(documents[0]));
          else localStorage.removeItem(STORAGE_KEY);
        }
      } catch (error) {
        console.error('Could not update the recent document after deleting a file.', error);
      }
    }
    loadSavedDocuments();
    showToast('File deleted.');
  }

  function readSavedDocuments() {
    const savedList = localStorage.getItem(DOCUMENTS_KEY);
    if (savedList) {
      const documents = JSON.parse(savedList);
      if (!Array.isArray(documents) || documents.some((documentData) =>
        !documentData || typeof documentData.id !== 'string' ||
        typeof documentData.name !== 'string' || typeof documentData.html !== 'string')) {
        throw new Error('The saved files do not have a valid format.');
      }
      return documents;
    }

    const previousDocument = localStorage.getItem(STORAGE_KEY);
    if (!previousDocument) return [];
    const documentData = JSON.parse(previousDocument);
    if (typeof documentData.name !== 'string' || typeof documentData.html !== 'string') {
      throw new Error('The saved document does not have a valid format.');
    }
    const migrated = [{
      ...documentData,
      id: documentData.id || 'legacy-document',
      name: documentData.name || 'Untitled document'
    }];
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(migrated));
    return migrated;
  }

  function loadSavedDocuments() {
    const filesGrid = document.getElementById('saved-files-grid');
    const emptyCard = document.getElementById('empty-recent');
    try {
      const documents = readSavedDocuments()
        .sort((first, second) => Date.parse(second.updatedAt || 0) - Date.parse(first.updatedAt || 0));
      filesGrid.replaceChildren();
      documents.forEach((documentData) => {
        const card = document.createElement('article');
        card.className = 'saved-file-card';
        const openLink = document.createElement('a');
        openLink.className = 'saved-file-link';
        openLink.href = `${editorUrl}?document=${encodeURIComponent(documentData.id)}`;
        const preview = document.createElement('div');
        preview.className = 'recent-preview';
        preview.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'recent-name';
        name.textContent = documentData.name || 'Untitled document';
        renderRecentPreview(documentData.html, documentData.name || 'Untitled document', preview);
        openLink.append(preview, name);

        const menuWrap = document.createElement('div');
        menuWrap.className = 'file-menu-wrap';
        const menuButton = document.createElement('button');
        menuButton.className = 'file-menu-button';
        menuButton.type = 'button';
        menuButton.setAttribute('aria-label', `Options for ${documentData.name || 'Untitled document'}`);
        menuButton.setAttribute('aria-expanded', 'false');
        menuButton.textContent = '⋯';
        const menu = document.createElement('div');
        menu.className = 'file-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        [
          ['Open', 'open'],
          ['Download', 'download'],
          ['Print', 'print'],
          ['Delete', 'delete']
        ].forEach(([label, action]) => {
          const item = document.createElement('button');
          item.className = 'file-menu-item';
          item.type = 'button';
          item.setAttribute('role', 'menuitem');
          item.dataset.action = action;
          item.textContent = label;
          menu.append(item);
        });
        menuWrap.append(menuButton, menu);
        card.append(openLink, menuWrap);
        filesGrid.append(card);

        menuButton.addEventListener('click', () => {
          const willOpen = menu.hidden;
          document.querySelectorAll('.file-menu').forEach((otherMenu) => { otherMenu.hidden = true; });
          document.querySelectorAll('.file-menu-button').forEach((otherButton) => otherButton.setAttribute('aria-expanded', 'false'));
          menu.hidden = !willOpen;
          menuButton.setAttribute('aria-expanded', String(willOpen));
        });
        menu.addEventListener('click', (event) => {
          const item = event.target.closest('[data-action]');
          if (!item) return;
          menu.hidden = true;
          menuButton.setAttribute('aria-expanded', 'false');
          if (item.dataset.action === 'open') {
            window.location.href = openLink.href;
          } else if (item.dataset.action === 'download') {
            try {
              downloadDocument(documentData);
            } catch (error) {
              console.error('Could not download the saved file.', error);
              showToast('Could not download this file.');
            }
          } else if (item.dataset.action === 'print') {
            printDocument(documentData);
          } else if (item.dataset.action === 'delete') {
            if (window.confirm(`Delete "${documentData.name || 'Untitled document'}"? This cannot be undone.`)) {
              try {
                deleteDocument(documentData.id);
              } catch (error) {
                console.error('Could not delete the saved file.', error);
                showToast('Could not delete this file.');
              }
            }
          }
        });
      });
      emptyCard.hidden = documents.length !== 0;
    } catch (error) {
      filesGrid.replaceChildren();
      emptyCard.hidden = false;
      console.error('Could not load saved files on the home page.', error);
      showToast('Could not load saved files.');
    }
  }

  function saveDocument(documentData) {
    const documents = readSavedDocuments();
    const existingIndex = documents.findIndex((saved) => saved.id === documentData.id);
    if (existingIndex === -1) documents.push(documentData);
    else documents[existingIndex] = documentData;
    localStorage.setItem(DOCUMENTS_KEY, JSON.stringify(documents));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(documentData));
  }

  function startProject(name, html) {
    try {
      const documentData = {
        id: createDocumentId(),
        name: name || 'Untitled document',
        html,
        updatedAt: new Date().toISOString()
      };
      saveDocument(documentData);
      window.location.href = `${editorUrl}?document=${encodeURIComponent(documentData.id)}`;
    } catch (error) {
      console.error('Could not prepare the project for the editor.', error);
      showToast('Could not save the document. Check available browser storage.');
    }
  }

  const templates = {
    blank: { html: '<p><br></p>' },
    letter: { html: '<h1>درخواست برائے دو روزہ رخصت</h1><p>تاریخ: ۱۲ اکتوبر ۲۰۲۶ء</p><p>بخدمت جناب پرنسپل صاحب،<br>گورنمنٹ ہائی اسکول، لاہور۔</p><p><strong>موضوع: دو روز کی رخصت کی درخواست</strong></p><p>جنابِ عالی!</p><p>نہایت ادب سے گزارش ہے کہ گھر میں ایک ضروری کام کے باعث میں ۱۴ اکتوبر سے ۱۵ اکتوبر ۲۰۲۶ء تک اسکول حاضر نہیں ہو سکوں گا۔ براہِ کرم مجھے دو دن کی رخصت عنایت فرمائیں۔ میں واپسی پر رہ جانے والا تمام تعلیمی کام مکمل کر لوں گا۔</p><p>آپ کی مہربانی ہوگی۔</p><p>آپ کا فرمانبردار طالب علم،<br>احمد علی<br>جماعت: ہشتم<br>رول نمبر: ۲۳</p>' },
    essay: { html: '<h1>علم کی اہمیت</h1><p><strong>تمہید</strong></p><p>علم انسان کو شعور، سمجھ اور اچھے بُرے میں فرق کرنے کی صلاحیت دیتا ہے۔ یہی وجہ ہے کہ تعلیم کو ہر فرد اور ہر معاشرے کی ترقی کی بنیاد سمجھا جاتا ہے۔</p><p><strong>فرد اور معاشرے کی ترقی</strong></p><p>تعلیم یافتہ انسان اپنے حقوق اور ذمہ داریوں کو بہتر طور پر سمجھتا ہے۔ علم ہمیں مسائل کا حل تلاش کرنا، دوسروں کے ساتھ تعاون کرنا اور نئی مہارتیں سیکھنا سکھاتا ہے۔ ڈاکٹر، استاد، انجینئر اور دوسرے ماہرین اپنی تعلیم کے ذریعے لوگوں کی خدمت کرتے ہیں۔ جب معاشرے کے افراد علم حاصل کرتے ہیں تو ملک ترقی کرتا ہے اور غربت و جہالت میں کمی آتی ہے۔</p><p><strong>علم حاصل کرنے کے طریقے</strong></p><p>کتابیں پڑھنا، اساتذہ سے سیکھنا، سوال کرنا اور اپنے تجربات پر غور کرنا علم حاصل کرنے کے اہم طریقے ہیں۔ طالب علم کو چاہیے کہ وہ باقاعدگی سے مطالعہ کرے، وقت کی قدر کرے اور سیکھی ہوئی باتوں کو اپنی عملی زندگی میں استعمال کرے۔</p><p><strong>نتیجہ</strong></p><p>علم ایک ایسی دولت ہے جو بانٹنے سے کم نہیں ہوتی بلکہ بڑھتی ہے۔ ہمیں زندگی بھر سیکھنے کی کوشش کرنی چاہیے تاکہ اپنی ذات، اپنے خاندان اور اپنے وطن کے لیے مفید ثابت ہو سکیں۔</p>' },
    poetry: { html: '<h1>امید کا چراغ</h1><p><br></p><p>اندھیری رات میں امید کا چراغ جلاؤ<br>قدم قدم پہ نئے راستوں کے پھول کھلاؤ</p><p>ہوا کے شور سے حوصلہ کبھی نہ ہارنا<br>یقیں کی روشنی سے اپنا راستہ بناؤ</p><p>جو علم بانٹتے ہیں، وہ دلوں میں رہتے ہیں<br>محبتوں کے دیے ہر طرف جلاتے جاؤ</p><p>محنتوں سے ہی منزل کا راستہ ملتا ہے<br>ہر ایک دن کو نئے عزم سے سجاؤ</p><p><br></p><p>— ایک طالبِ علم</p>' },
    invoice: { html: '<h1>بل / انوائس</h1><p>انوائس نمبر: ۰۰۱<br>تاریخ: __________</p><p><strong>فروخت کنندہ:</strong> دکان / کاروبار کا نام<br>پتہ: ______________________________<br>فون: __________________</p><p><strong>کسٹمر:</strong> ______________________________<br>پتہ: ______________________________</p><table><thead><tr><th>تفصیل</th><th>تعداد</th><th>فی قیمت</th><th>کل رقم</th></tr></thead><tbody><tr><td>________________</td><td>____</td><td>________</td><td>________</td></tr><tr><td>________________</td><td>____</td><td>________</td><td>________</td></tr><tr><td>________________</td><td>____</td><td>________</td><td>________</td></tr></tbody></table><p>ذیلی رقم: __________<br>ٹیکس: __________<br><strong>قابلِ ادائیگی کل: __________ روپے</strong></p><p>ادائیگی کا طریقہ: __________<br>آپ کے کاروبار کا شکریہ۔</p>' },
    'job-application': { html: '<h1>ملازمت کے لیے درخواست</h1><p>تاریخ: __________</p><p>بخدمت جناب منیجر صاحب،<br>ادارے کا نام: __________________</p><p><strong>موضوع: __________ کے عہدے کے لیے درخواست</strong></p><p>جنابِ عالی!</p><p>آپ کے ادارے میں __________ کے عہدے کے لیے درخواست پیش کر رہا / رہی ہوں۔ میری تعلیمی قابلیت __________ ہے اور مجھے __________ کے شعبے میں تجربہ / دلچسپی حاصل ہے۔ میں محنت، ذمہ داری اور دیانت داری کے ساتھ اپنے فرائض انجام دے سکتا / سکتی ہوں۔</p><p>درخواست کے ساتھ اپنا تعلیمی ریکارڈ اور ضروری دستاویزات شامل کر رہا / رہی ہوں۔ ملاقات کا موقع دینے پر ممنون ہوں گا / گی۔</p><p>مخلص،<br>نام: __________________<br>فون: __________________<br>ای میل: __________________</p>' },
    dialogue: { html: '<h1>مکالمہ: مطالعے کی اہمیت</h1><p><strong>علی:</strong> سلام احمد! تم روزانہ کتابیں پڑھنے کے لیے وقت کیسے نکالتے ہو؟</p><p><strong>احمد:</strong> وعلیکم السلام! میں نے ہر روز آدھا گھنٹہ مطالعے کے لیے مقرر کیا ہے۔ اس سے نئی باتیں سیکھنے کو ملتی ہیں۔</p><p><strong>علی:</strong> کیا صرف درسی کتابیں پڑھنا کافی ہے؟</p><p><strong>احمد:</strong> درسی کتابوں کے ساتھ کہانیاں، سوانح اور معلوماتی مضامین بھی پڑھنے چاہییں۔ اس سے زبان اور سوچ بہتر ہوتی ہے۔</p><p><strong>علی:</strong> تم ٹھیک کہتے ہو۔ میں بھی آج سے مطالعے کا معمول بناؤں گا۔</p><p><strong>احمد:</strong> بہت خوب! کتاب اچھی دوست ہے، بس اسے باقاعدگی سے پڑھنا چاہیے۔</p>' },
    assignment: { html: '<h1>تعلیمی اسائنمنٹ</h1><p><strong>عنوان:</strong> ______________________________</p><p>طالب علم کا نام: __________________<br>جماعت / شعبہ: __________________<br>رول نمبر: __________________<br>مضمون: __________________<br>استاد کا نام: __________________<br>جمع کرانے کی تاریخ: __________</p><p><strong>تعارف</strong></p><p>موضوع کا مختصر تعارف یہاں لکھیں اور بتائیں کہ یہ کیوں اہم ہے۔</p><p><strong>اہم نکات</strong></p><ol><li>پہلا نکتہ اور اس کی وضاحت۔</li><li>دوسرا نکتہ اور متعلقہ مثال۔</li><li>تیسرا نکتہ اور حاصلِ مطالعہ۔</li></ol><p><strong>نتیجہ</strong></p><p>موضوع کے بنیادی خیال کا خلاصہ اور اپنی رائے یہاں درج کریں۔</p><p><strong>حوالہ جات:</strong> کتاب / مضمون / ذریعہ __________</p>' },
    'study-notes': { html: '<h1>مطالعے کے نوٹس</h1><p>مضمون: __________________<br>باب / موضوع: __________________<br>تاریخ: __________</p><p><strong>اہم خیال</strong></p><p>اس موضوع کا مرکزی خیال ایک یا دو جملوں میں لکھیں۔</p><p><strong>اہم اصطلاحات</strong></p><ul><li>اصطلاح: تعریف اور مثال۔</li><li>اصطلاح: تعریف اور مثال۔</li><li>اصطلاح: تعریف اور مثال۔</li></ul><p><strong>اہم نکات</strong></p><ol><li>پہلا اہم نکتہ۔</li><li>دوسرا اہم نکتہ۔</li><li>تیسرا اہم نکتہ۔</li></ol><p><strong>مختصر خلاصہ</strong></p><p>موضوع کو اپنے الفاظ میں مختصراً بیان کریں۔</p><p><strong>سوالات / مزید یاد رکھنے کی باتیں</strong></p><p>________________________________________</p>' },
    report: { html: '<h1>مختصر رپورٹ</h1><p><strong>عنوان:</strong> ______________________________</p><p>رپورٹ مرتب کرنے والے کا نام: __________________<br>مقام: __________________<br>تاریخ: __________</p><p><strong>تعارف</strong></p><p>سرگرمی یا واقعے کا مختصر تعارف، مقصد اور پس منظر بیان کریں۔</p><p><strong>تفصیل</strong></p><p>کیا ہوا، کون شریک تھا، اور اہم سرگرمیاں کیا رہیں؟ معلومات واضح ترتیب سے لکھیں۔</p><p><strong>نتائج</strong></p><p>سرگرمی کے اہم نتائج اور حاصل ہونے والے تجربات درج کریں۔</p><p><strong>اختتام</strong></p><p>آئندہ کے لیے مختصر تجاویز یا نتیجہ لکھیں۔</p>' },
    invitation: { html: '<h1>دعوت نامہ</h1><p>بسم اللہ الرحمن الرحیم</p><p>محترم / محترمہ __________________!</p><p>آپ کو خوشی کے ساتھ اطلاع دی جاتی ہے کہ ہم __________ کی تقریب منعقد کر رہے ہیں۔ آپ کی شرکت ہمارے لیے باعثِ مسرت ہوگی۔</p><p><strong>تقریب:</strong> __________________<br><strong>دن اور تاریخ:</strong> __________________<br><strong>وقت:</strong> __________________<br><strong>مقام:</strong> __________________</p><p>براہِ کرم اپنی شرکت سے آگاہ فرمائیں۔ آپ کی آمد کے منتظر،</p><p>میزبان: __________________<br>رابطہ نمبر: __________________</p>' },
    notice: { html: '<h1>اطلاع نامہ</h1><p>ادارے کا نام: ______________________________</p><p>تاریخ: __________</p><p><strong>موضوع: ______________________________</strong></p><p>تمام متعلقہ افراد کو مطلع کیا جاتا ہے کہ ______________________________۔</p><p>یہ سرگرمی / اجلاس / پروگرام __________ کے دن، __________ بجے، مقام __________ پر منعقد ہوگا۔ تمام متعلقہ افراد سے وقت پر شرکت کی درخواست ہے۔</p><p>مزید معلومات کے لیے __________ سے رابطہ کریں۔</p><p>دستخط: __________________<br>نام و عہدہ: __________________</p>' }
  };

  function renderTemplatePreviews() {
    document.querySelectorAll('[data-template-preview]').forEach((preview) => {
      const html = cleanPreviewHtml(templates[preview.dataset.templatePreview].html);
      const frame = document.createElement('iframe');
      frame.className = 'template-page-preview';
      frame.title = `${preview.dataset.templatePreview} template page preview`;
      frame.tabIndex = -1;
      frame.setAttribute('sandbox', '');
      frame.srcdoc = `<!doctype html><html lang="ur" dir="rtl"><head><meta charset="utf-8">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600&family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap">
        <style>*{box-sizing:border-box}html,body{width:794px;min-height:1123px;margin:0;background:#fff}
        body{color:#26334a;font:18px/1.8 'Noto Nastaliq Urdu','Noto Naskh Arabic',serif}
        main{min-height:1123px;padding:78px 86px;direction:rtl;text-align:right;overflow-wrap:anywhere}
        p{min-height:1.8em;margin:0 0 12px}h1,h2,h3{line-height:1.9}h1{margin:0 0 16px;font-size:1.55em}
        img{max-width:100%;height:auto}table{width:100%;margin:12px 0;border-collapse:collapse}
        td,th{min-width:50px;padding:8px;border:1px solid #aeb6c5}</style></head>
        <body><main>${html || '<p><br></p>'}</main></body></html>`;
      preview.append(frame);
      const fitFrame = () => {
        const scale = preview.clientWidth / 794;
        frame.style.transform = `translateX(-50%) scale(${scale})`;
      };
      fitFrame();
      if ('ResizeObserver' in window) new ResizeObserver(fitFrame).observe(preview);
    });
  }

  document.getElementById('upload-button').addEventListener('click', () => {
    document.getElementById('upload-input').click();
  });
  document.getElementById('upload-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['txt', 'json'].includes(extension)) {
      showToast('Choose a TXT or Urdu Writer JSON project file.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const contents = String(reader.result);
        if (extension === 'json') {
          const project = JSON.parse(contents);
          if (project.format !== 'urdu-writer' || typeof project.html !== 'string') {
            throw new Error('This is not a valid Urdu Writer project file.');
          }
          startProject(typeof project.name === 'string' ? project.name : file.name.replace(/\.json$/i, ''), project.html);
        } else {
          const paragraphs = contents.split(/\r?\n/).map((line) =>
            `<p>${line.replace(/[&<>"']/g, (character) => ({
              '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[character]) || '<br>'}</p>`).join('');
          startProject(file.name.replace(/\.txt$/i, ''), paragraphs || '<p><br></p>');
        }
      } catch (error) {
        console.error('Could not open the selected project file.', error);
        showToast(error instanceof SyntaxError ? 'The JSON file is not valid.' : error.message);
      }
    });
    reader.addEventListener('error', () => showToast('Could not read the selected file.'));
    reader.readAsText(file);
    event.target.value = '';
  });

  document.querySelectorAll('[data-template]').forEach((button) => {
    const openButton = button.querySelector('.template-open');
    openButton.addEventListener('click', () => {
      const template = templates[button.dataset.template];
      if (template) startProject(button.dataset.title, template.html);
    });
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.file-menu-wrap')) return;
    document.querySelectorAll('.file-menu').forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll('.file-menu-button').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.file-menu').forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll('.file-menu-button').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  });

  const authModal = document.getElementById('auth-modal');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const authTitle = document.getElementById('auth-title');
  function setAuthMode(mode) {
    const signup = mode === 'signup';
    loginForm.hidden = signup;
    signupForm.hidden = !signup;
    authTitle.textContent = signup ? 'Create your account' : 'Welcome back';
    document.querySelectorAll('[data-auth-mode]').forEach((tab) => {
      const active = tab.dataset.authMode === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
  }
  document.getElementById('login-button').addEventListener('click', () => {
    authModal.hidden = false;
    document.getElementById('auth-close').focus();
  });
  document.getElementById('auth-close').addEventListener('click', () => { authModal.hidden = true; });
  authModal.addEventListener('click', (event) => {
    if (event.target === authModal) authModal.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !authModal.hidden) authModal.hidden = true;
  });
  document.querySelectorAll('[data-auth-mode]').forEach((tab) => {
    tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode));
  });
  signupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = signupForm.elements.password;
    const confirmation = signupForm.elements['confirm-password'];
    confirmation.setCustomValidity(password.value === confirmation.value ? '' : 'Passwords do not match.');
    if (!signupForm.reportValidity()) return;
    showToast('Sign-up needs an authentication server before it can create an account.');
  });
  signupForm.elements['confirm-password'].addEventListener('input', (event) => {
    event.target.setCustomValidity('');
  });
  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;
    showToast('Login needs an authentication server before it can sign you in.');
  });
  document.getElementById('google-signin').addEventListener('click', () => {
    showToast('Google sign-in needs OAuth setup before it can continue.');
  });

  document.getElementById('footer-year').textContent = String(new Date().getFullYear());
  renderTemplatePreviews();
  loadSavedDocuments();
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === DOCUMENTS_KEY) loadSavedDocuments();
  });
})();
