(() => {
  const keyboard = document.getElementById('keyboard-layout');
  const testInput = document.getElementById('keyboard-test');
  const preview = document.getElementById('keyboard-preview');
  const normalKeyLabels = Object.freeze({
    '.': '.', ',': ',', ';': ';', "'": "'", '[': '[', ']': ']', '\\': '\\', '/': '/'
  });
  const rows = UrduKeyboardLayout.rows;

  rows.forEach((row) => {
    const rowElement = document.createElement('div');
    rowElement.className = 'keyboard-map-row';
    row.forEach(([key, output, shift = false, displayOutput = output]) => {
      const button = document.createElement('button');
      const keyLabel = normalKeyLabels[key] || key.toUpperCase();
      button.type = 'button';
      button.className = 'keyboard-map-key';
      button.setAttribute('aria-label', `${shift ? 'Shift plus ' : ''}${keyLabel} produces ${output}`);
      const physicalKey = document.createElement('span');
      const mappedOutput = document.createElement('span');
      physicalKey.className = 'keyboard-map-physical';
      mappedOutput.className = 'keyboard-map-urdu';
      physicalKey.textContent = shift ? `Shift + ${keyLabel}` : keyLabel;
      mappedOutput.textContent = displayOutput;
      mappedOutput.lang = 'ur';
      button.append(physicalKey, mappedOutput);
      button.addEventListener('click', () => {
        insertIntoTestInput(output);
        testInput.focus();
      });
      rowElement.append(button);
    });
    keyboard.append(rowElement);
  });

  function insertIntoTestInput(text) {
    const start = testInput.selectionStart;
    const end = testInput.selectionEnd;
    testInput.setRangeText(text, start, end, 'end');
    preview.textContent = testInput.value || 'Urdu output appears here';
  }

  testInput.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const output = UrduKeyboardLayout.mapKey(event);
    if (output === event.key) return;
    event.preventDefault();
    insertIntoTestInput(output);
  });
  testInput.addEventListener('input', () => {
    preview.textContent = testInput.value || 'Urdu output appears here';
  });
})();
