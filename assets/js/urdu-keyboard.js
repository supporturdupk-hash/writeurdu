(() => {
  const rows = [
    [
      ['t', 'ت'], ['p', 'پ'], ['b', 'ب'], ['a', 'آ', true], ['a', 'ا']
    ],
    [
      ['h', 'ح', true], ['c', 'چ'], ['j', 'ج'], ['c', 'ث', true], ['t', 'ط', true]
    ],
    [
      ['r', 'ر'], ['z', 'ذ', true], ['d', 'ڈ', true], ['d', 'د'], ['k', 'خ', true]
    ],
    [
      ['x', 'ش'], ['s', 'س'], ['x', 'ژ', true], ['z', 'ز'], ['r', 'ڑ', true]
    ],
    [
      ['e', 'ع'], ['v', 'ظ', true], ['v', 'ط'], ['j', 'ض', true], ['s', 'ص', true]
    ],
    [
      ['g', 'گ'], ['k', 'ک'], ['q', 'ق'], ['f', 'ف'], ['g', 'غ', true]
    ],
    [
      ['w', 'و'], ['n', 'ں', true], ['n', 'ن'], ['m', 'م'], ['l', 'ل']
    ],
    [
      ['i', 'ی'], ['u', 'ء'], ['h', 'ھ'], ['o', 'ہ'], ['w', 'ؤ', true]
    ],
    [
      ['.', '۔', false, 'ختمہ'], ['p', 'ٹ', true], [',', 'ِ', true, 'زیر'], ['.', 'َ', true, 'زبر'], ['y', 'ے']
    ]
  ];
  const normal = Object.create(null);
  const shifted = Object.create(null);
  rows.flat().forEach(([key, output, shift = false]) => {
    (shift ? shifted : normal)[key] = output;
  });
  const codeToKey = Object.freeze({
    Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Slash: '/', Minus: '-', Equal: '=', Backquote: '`'
  });

  function mapKey(event) {
    if (event.key.length !== 1) return event.key;
    const key = codeToKey[event.code] || (event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase());
    if (event.shiftKey && shifted[key]) return shifted[key];
    return normal[key] || event.key;
  }

  window.UrduKeyboardLayout = Object.freeze({ rows, mapKey });
})();
