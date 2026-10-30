(() => {
  const rows = [
    [
      ['t', 'ت'], ['p', 'پ'], ['b', 'ب'], ['a', 'آ', true], ['a', 'ا']
    ],
    [
      ['h', 'ح', true], ['c', 'چ'], ['j', 'ج'], ['c', 'ث', true], ['t', 'ٹ', true]
    ],
    [
      ['r', 'ر'], ['z', 'ذ', true], ['d', 'ڈ', true], ['d', 'د'], ['k', 'خ', true]
    ],
    [
      ['x', 'ش'], ['s', 'س'], ['x', 'ژ', true], ['z', 'ز'], ['r', 'ڑ', true]
    ],
    [
      ['e', 'ع'], ['v', 'ط'], ['v', 'ظ', true], ['j', 'ض', true], ['s', 'ص', true]
    ],
    [
      ['g', 'گ'], ['k', 'ک'], ['q', 'ق'], ['f', 'ف'], ['g', 'غ', true]
    ],
    [
      ['w', 'و'], ['n', 'ں', true], ['n', 'ن'], ['m', 'م'], ['l', 'ل']
    ],
    [
      ['i', 'ی'], ['u', 'ٔ'], ['h', 'ھ'], ['o', 'ہ'], ['w', 'ؤ', true]
    ],
    [
      ['.', '۔', false, 'ختمہ'], ['p', 'ُ', true, '◌ُ'], [',', 'ِ', true, 'زیر'], ['.', 'َ', true, 'زبر'], ['y', 'ے']
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
  const shiftedCharacters = Object.freeze({
    '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
    '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', '/': '?', '`': '~'
  });

  function mapCharacter(character, isShift = false) {
    if (character.length !== 1) return character;
    const key = character.toLowerCase();
    if (isShift && shifted[key]) return shifted[key];
    return normal[key] || (isShift ? shiftedCharacters[key] || character.toUpperCase() : character);
  }

  function mapKey(event) {
    if (event.key.length !== 1) return event.key;
    const key = codeToKey[event.code] || (event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase());
    return mapCharacter(key, event.shiftKey);
  }

  window.UrduKeyboardLayout = Object.freeze({ rows, mapCharacter, mapKey });
})();
