(() => {
  if (window.fabric) fabric.Text.prototype.textBaseline = 'alphabetic';

  const DEFAULT_CELL = Object.freeze({
    text: '',
    fill: '#ffffff',
    borderColor: '#aeb6c5',
    borderWidth: 1,
    textAlign: 'right',
    rowSpan: 1,
    colSpan: 1
  });
  const MAX_DIMENSION = 20;
  const MAX_CELLS = 400;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const validColor = (value, fallback) => /^#[\da-f]{6}$/i.test(value) ? value : fallback;
  const normalizeColor = (value, fallback) => {
    if (/^#[\da-f]{6}$/i.test(value || '')) return value;
    const match = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value || '');
    return match
      ? `#${[match[1], match[2], match[3]].map((part) => clamp(Number(part), 0, 255).toString(16).padStart(2, '0')).join('')}`
      : fallback;
  };
  const createCell = (values = {}) => ({ ...DEFAULT_CELL, ...values });

  class CanvasTableManager {
    constructor(canvasElement, {
      onChange = () => {},
      mapKey = (event) => event.key,
      focusContainer = null
    } = {}) {
      if (!window.fabric) throw new Error('Fabric.js must be loaded before CanvasTableManager.');
      this.canvas = new fabric.Canvas(canvasElement, {
        selection: false,
        preserveObjectStacking: true,
        stopContextMenu: true
      });
      this.onChange = onChange;
      this.mapKey = mapKey;
      this.focusContainer = focusContainer;
      this.rows = 0;
      this.columns = 0;
      this.cellWidth = 120;
      this.cellHeight = 56;
      this.cells = [];
      this.activeCell = null;
      this.selection = null;
      this.isDeleted = false;
      this.objectsByCell = new Map();
      this.lastCellClick = null;

      this.canvas.on('mouse:down', (event) => this.handleCellClick(event));
    }

    createTable(rows, columns, cellWidth = 120, cellHeight = 56) {
      this.setDimensions(rows, columns, cellWidth, cellHeight);
      this.cells = Array.from({ length: this.rows }, (_, row) =>
        Array.from({ length: this.columns }, (_, column) => createCell({ row, column })));
      this.activeCell = { row: 0, column: 0 };
      this.selection = null;
      this.isDeleted = false;
      this.render();
    }

    setDimensions(rows, columns, cellWidth = this.cellWidth, cellHeight = this.cellHeight) {
      const parsedRows = Number(rows);
      const parsedColumns = Number(columns);
      const parsedWidth = Number(cellWidth);
      const parsedHeight = Number(cellHeight);
      if (!Number.isInteger(parsedRows) || !Number.isInteger(parsedColumns) ||
        parsedRows < 1 || parsedColumns < 1 || parsedRows > MAX_DIMENSION ||
        parsedColumns > MAX_DIMENSION || parsedRows * parsedColumns > MAX_CELLS) {
        throw new RangeError(`Choose between 1 and ${MAX_DIMENSION} rows and columns, with no more than ${MAX_CELLS} cells.`);
      }
      if (!Number.isFinite(parsedWidth) || parsedWidth < 40 || parsedWidth > 240 ||
        !Number.isFinite(parsedHeight) || parsedHeight < 28 || parsedHeight > 120) {
        throw new RangeError('Cell width must be 40–240 px and cell height 28–120 px.');
      }
      this.rows = parsedRows;
      this.columns = parsedColumns;
      this.cellWidth = parsedWidth;
      this.cellHeight = parsedHeight;
    }

    getAnchors() {
      const unique = new Set();
      this.cells.forEach((row) => row.forEach((cell) => {
        if (cell) unique.add(cell);
      }));
      return [...unique];
    }

    rebuildGrid() {
      const grid = Array.from({ length: this.rows }, () => Array(this.columns));
      this.getAnchors().forEach((cell) => {
        if (cell.row < 0 || cell.column < 0 || cell.row >= this.rows || cell.column >= this.columns) return;
        for (let row = cell.row; row < Math.min(this.rows, cell.row + cell.rowSpan); row += 1) {
          for (let column = cell.column; column < Math.min(this.columns, cell.column + cell.colSpan); column += 1) {
            grid[row][column] = row === cell.row && column === cell.column ? cell : null;
          }
        }
      });
      for (let row = 0; row < this.rows; row += 1) {
        for (let column = 0; column < this.columns; column += 1) {
          if (grid[row][column] === undefined) grid[row][column] = createCell({ row, column });
        }
      }
      this.cells = grid;
    }

    cellAt(row, column) {
      const cell = this.cells[row] && this.cells[row][column];
      if (cell) return cell;
      return this.getAnchors().find((anchor) =>
        row >= anchor.row && row < anchor.row + anchor.rowSpan &&
        column >= anchor.column && column < anchor.column + anchor.colSpan) || null;
    }

    getSelectedCells() {
      const selection = this.selection || this.activeCell;
      if (!selection) return [];
      const top = Math.min(selection.startRow ?? selection.row, selection.endRow ?? selection.row);
      const bottom = Math.max(selection.startRow ?? selection.row, selection.endRow ?? selection.row);
      const left = Math.min(selection.startColumn ?? selection.column, selection.endColumn ?? selection.column);
      const right = Math.max(selection.startColumn ?? selection.column, selection.endColumn ?? selection.column);
      const selected = new Set();
      for (let row = top; row <= bottom; row += 1) {
        for (let column = left; column <= right; column += 1) {
          const cell = this.cellAt(row, column);
          if (cell) selected.add(cell);
        }
      }
      return [...selected];
    }

    getCellFromEvent(event) {
      const objects = [...(event.subTargets || []), event.target].filter(Boolean);
      const hit = objects.find((object) => object.tableRole === 'text' || object.tableRole === 'cell');
      return hit && Number.isInteger(hit.tableRow) && Number.isInteger(hit.tableColumn)
        ? { row: hit.tableRow, column: hit.tableColumn }
        : null;
    }

    selectFromEvent(event) {
      const point = this.getCellFromEvent(event);
      if (!point) return;
      if (event.e && event.e.shiftKey && this.activeCell) {
        this.selection = {
          startRow: this.selection ? this.selection.startRow : this.activeCell.row,
          startColumn: this.selection ? this.selection.startColumn : this.activeCell.column,
          endRow: point.row,
          endColumn: point.column
        };
      } else {
        this.selection = null;
      }
      this.activeCell = point;
      this.onChange(this);
    }

    handleCellClick(event) {
      const point = this.getCellFromEvent(event);
      if (!point) return;
      const now = Date.now();
      const isDoubleClick = this.lastCellClick &&
        this.lastCellClick.row === point.row &&
        this.lastCellClick.column === point.column &&
        now - this.lastCellClick.time < 500;
      this.lastCellClick = { ...point, time: now };
      this.selectFromEvent(event);
      if (isDoubleClick) this.beginEditing(point);
    }

    beginEditing(point) {
      const cellObjects = this.objectsByCell.get(`${point.row}:${point.column}`);
      const text = cellObjects && cellObjects.text;
      if (!text || text.isEditing || typeof text.enterEditing !== 'function') return;
      this.activeCell = point;
      this.selection = null;
      text.enterEditing();
      const hiddenTextarea = text.hiddenTextarea;
      if (hiddenTextarea) {
        if (this.focusContainer && !this.focusContainer.contains(hiddenTextarea)) {
          this.focusContainer.append(hiddenTextarea);
          hiddenTextarea.style.position = 'fixed';
        }
        const mapTextKey = (keyEvent) => {
          if (keyEvent.ctrlKey || keyEvent.metaKey || keyEvent.altKey || keyEvent.isComposing ||
            keyEvent.key.length !== 1) return;
          const mapped = this.mapKey(keyEvent);
          if (mapped === keyEvent.key) return;
          keyEvent.preventDefault();
          text.insertChars(mapped);
        };
        hiddenTextarea.addEventListener('keydown', mapTextKey, true);
        text.once('editing:exited', () => hiddenTextarea.removeEventListener('keydown', mapTextKey, true));
        hiddenTextarea.focus();
      }
    }

    render() {
      this.syncText();
      this.canvas.clear();
      this.objectsByCell.clear();
      this.canvas.setDimensions({
        width: this.columns * this.cellWidth,
        height: this.rows * this.cellHeight
      });
      const objects = [];
      this.getAnchors().forEach((cell) => {
        const left = cell.column * this.cellWidth;
        const top = cell.row * this.cellHeight;
        const width = cell.colSpan * this.cellWidth;
        const height = cell.rowSpan * this.cellHeight;
        const key = `${cell.row}:${cell.column}`;
        const rect = new fabric.Rect({
          left, top, width, height,
          originX: 'left',
          originY: 'top',
          fill: cell.fill,
          stroke: cell.borderColor,
          strokeWidth: cell.borderWidth,
          selectable: false,
          evented: true,
          objectCaching: false
        });
        rect.tableRole = 'cell';
        rect.tableRow = cell.row;
        rect.tableColumn = cell.column;
        const text = new fabric.IText(cell.text, {
          left: left + 8,
          top: top + 6,
          width: Math.max(16, width - 16),
          height: Math.max(16, height - 12),
          originX: 'left',
          originY: 'top',
          fontFamily: "'Noto Nastaliq Urdu', serif",
          fontSize: 18,
          lineHeight: 1.35,
          fill: '#20252b',
          textAlign: cell.textAlign,
          direction: 'rtl',
          splitByGrapheme: true,
          editable: true,
          selectable: false,
          evented: true,
          objectCaching: false
        });
        text.tableRole = 'text';
        text.tableRow = cell.row;
        text.tableColumn = cell.column;
        text.on('changed', () => {
          cell.text = text.text;
          this.onChange(this);
        });
        objects.push(rect, text);
        this.objectsByCell.set(key, { rect, text });
      });
      if (objects.length) {
        const group = new fabric.Group(objects, {
          left: 0,
          top: 0,
          subTargetCheck: true,
          interactive: true,
          selectable: false,
          evented: true,
          objectCaching: false
        });
        this.canvas.add(group);
      }
      this.canvas.requestRenderAll();
      this.onChange(this);
    }

    insertRow(position = 'below') {
      if (!this.activeCell) return;
      if (this.rows >= MAX_DIMENSION || (this.rows + 1) * this.columns > MAX_CELLS) {
        throw new RangeError(`Tables are limited to ${MAX_DIMENSION} rows and ${MAX_CELLS} cells.`);
      }
      const index = this.activeCell.row + (position === 'below' ? 1 : 0);
      const anchors = this.getAnchors();
      anchors.forEach((cell) => {
        if (cell.row < index && cell.row + cell.rowSpan > index) cell.rowSpan += 1;
        else if (cell.row >= index) cell.row += 1;
      });
      this.rows += 1;
      this.rebuildGrid();
      this.activeCell = { row: index, column: Math.min(this.activeCell.column, this.columns - 1) };
      this.selection = null;
      this.render();
    }

    insertColumn(position = 'right') {
      if (!this.activeCell) return;
      if (this.columns >= MAX_DIMENSION || this.rows * (this.columns + 1) > MAX_CELLS) {
        throw new RangeError(`Tables are limited to ${MAX_DIMENSION} columns and ${MAX_CELLS} cells.`);
      }
      const index = this.activeCell.column + (position === 'right' ? 1 : 0);
      const anchors = this.getAnchors();
      anchors.forEach((cell) => {
        if (cell.column < index && cell.column + cell.colSpan > index) cell.colSpan += 1;
        else if (cell.column >= index) cell.column += 1;
      });
      this.columns += 1;
      this.rebuildGrid();
      this.activeCell = { row: Math.min(this.activeCell.row, this.rows - 1), column: index };
      this.selection = null;
      this.render();
    }

    deleteRow() {
      if (!this.activeCell || this.rows <= 1) return false;
      const index = this.activeCell.row;
      this.getAnchors().forEach((cell) => {
        if (cell.row === index && cell.rowSpan > 1) cell.rowSpan -= 1;
        else if (cell.row < index && cell.row + cell.rowSpan > index) cell.rowSpan -= 1;
        else if (cell.row > index) cell.row -= 1;
        else if (cell.row === index && cell.rowSpan === 1) cell.row = -1;
      });
      this.rows -= 1;
      this.rebuildGrid();
      this.activeCell = { row: Math.min(index, this.rows - 1), column: Math.min(this.activeCell.column, this.columns - 1) };
      this.selection = null;
      this.render();
      return true;
    }

    deleteColumn() {
      if (!this.activeCell || this.columns <= 1) return false;
      const index = this.activeCell.column;
      this.getAnchors().forEach((cell) => {
        if (cell.column === index && cell.colSpan > 1) cell.colSpan -= 1;
        else if (cell.column < index && cell.column + cell.colSpan > index) cell.colSpan -= 1;
        else if (cell.column > index) cell.column -= 1;
        else if (cell.column === index && cell.colSpan === 1) cell.column = -1;
      });
      this.columns -= 1;
      this.rebuildGrid();
      this.activeCell = { row: Math.min(this.activeCell.row, this.rows - 1), column: Math.min(index, this.columns - 1) };
      this.selection = null;
      this.render();
      return true;
    }

    mergeCells() {
      const selected = this.getSelectedCells();
      if (selected.length < 2 || selected.some((cell) => cell.rowSpan !== 1 || cell.colSpan !== 1)) return false;
      const selection = this.selection;
      const top = Math.min(selection.startRow, selection.endRow);
      const bottom = Math.max(selection.startRow, selection.endRow);
      const left = Math.min(selection.startColumn, selection.endColumn);
      const right = Math.max(selection.startColumn, selection.endColumn);
      if ((bottom - top + 1) * (right - left + 1) !== selected.length) return false;
      const anchor = this.cellAt(top, left);
      anchor.text = selected.map((cell) => cell.text).filter(Boolean).join('\n');
      anchor.row = top;
      anchor.column = left;
      anchor.rowSpan = bottom - top + 1;
      anchor.colSpan = right - left + 1;
      this.cells[bottom][right] = anchor;
      for (let row = top; row <= bottom; row += 1) {
        for (let column = left; column <= right; column += 1) {
          this.cells[row][column] = row === top && column === left ? anchor : null;
        }
      }
      this.activeCell = { row: top, column: left };
      this.selection = null;
      this.render();
      return true;
    }

    splitCell() {
      if (!this.activeCell) return false;
      const cell = this.cellAt(this.activeCell.row, this.activeCell.column);
      if (!cell || (cell.rowSpan === 1 && cell.colSpan === 1)) return false;
      const oldRowSpan = cell.rowSpan;
      const oldColSpan = cell.colSpan;
      cell.rowSpan = 1;
      cell.colSpan = 1;
      for (let row = cell.row; row < cell.row + oldRowSpan; row += 1) {
        for (let column = cell.column; column < cell.column + oldColSpan; column += 1) {
          if (row !== cell.row || column !== cell.column) {
            this.cells[row][column] = createCell({ row, column });
          }
        }
      }
      this.activeCell = { row: cell.row, column: cell.column };
      this.selection = null;
      this.render();
      return true;
    }

    setSelectedCell(property, value) {
      const cells = this.getSelectedCells();
      if (!cells.length) return false;
      cells.forEach((cell) => { cell[property] = value; });
      this.render();
      return true;
    }

    syncText() {
      this.getAnchors().forEach((cell) => {
        const objects = this.objectsByCell.get(`${cell.row}:${cell.column}`);
        if (objects && typeof objects.text.text === 'string') cell.text = objects.text.text;
      });
    }

    deleteTable() {
      this.isDeleted = true;
      this.canvas.clear();
      this.activeCell = null;
      this.selection = null;
      this.objectsByCell.clear();
      this.onChange(this);
    }

    toJSON() {
      this.syncText();
      return JSON.stringify({
        version: 1,
        rows: this.rows,
        columns: this.columns,
        cellWidth: this.cellWidth,
        cellHeight: this.cellHeight,
        cells: this.getAnchors().map((cell) => ({ ...cell }))
      });
    }

    loadFromJSON(value) {
      const data = typeof value === 'string' ? JSON.parse(value) : value;
      if (!data || data.version !== 1 || !Array.isArray(data.cells)) {
        throw new TypeError('The saved table has an unsupported format.');
      }
      this.setDimensions(data.rows, data.columns, data.cellWidth, data.cellHeight);
      this.cells = Array.from({ length: this.rows }, () => Array(this.columns));
      data.cells.forEach((valueCell) => {
        const row = Number(valueCell.row);
        const column = Number(valueCell.column);
        if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 ||
          column < 0 || row >= this.rows || column >= this.columns) return;
        this.cells[row][column] = createCell({
          ...valueCell,
          text: typeof valueCell.text === 'string' ? valueCell.text : '',
          fill: validColor(valueCell.fill, DEFAULT_CELL.fill),
          borderColor: validColor(valueCell.borderColor, DEFAULT_CELL.borderColor),
          borderWidth: clamp(Number(valueCell.borderWidth) || 0, 0, 8),
          textAlign: ['left', 'center', 'right'].includes(valueCell.textAlign) ? valueCell.textAlign : 'right',
          rowSpan: clamp(Number(valueCell.rowSpan) || 1, 1, this.rows - row),
          colSpan: clamp(Number(valueCell.colSpan) || 1, 1, this.columns - column)
        });
      });
      this.rebuildGrid();
      this.activeCell = { row: 0, column: 0 };
      this.selection = null;
      this.isDeleted = false;
      this.render();
    }

    loadFromTable(table) {
      const rows = Array.from(table.rows);
      if (!rows.length) throw new TypeError('The selected table has no rows.');
      let columns = 0;
      rows.forEach((row) => {
        columns = Math.max(columns, Array.from(row.cells).reduce((sum, cell) =>
          sum + Math.max(1, cell.colSpan || 1), 0));
      });
      columns = clamp(columns, 1, MAX_DIMENSION);
      const rowCount = clamp(rows.length, 1, MAX_DIMENSION);
      this.setDimensions(rowCount, columns, this.readCellWidth(table), this.readCellHeight(table));
      this.cells = Array.from({ length: this.rows }, () => Array(this.columns));
      rows.slice(0, this.rows).forEach((row, rowIndex) => {
        let column = 0;
        Array.from(row.cells).forEach((element) => {
          while (column < this.columns && this.cells[rowIndex][column] !== undefined) column += 1;
          if (column >= this.columns) return;
          const rowSpan = clamp(element.rowSpan || 1, 1, this.rows - rowIndex);
          const colSpan = clamp(element.colSpan || 1, 1, this.columns - column);
          const cell = createCell({
            row: rowIndex,
            column,
            text: element.innerText.replace(/\u00a0/g, ' ').trim(),
            fill: normalizeColor(element.style.backgroundColor, DEFAULT_CELL.fill),
            borderColor: validColor(element.dataset.cellBorderColor || table.dataset.borderColor, DEFAULT_CELL.borderColor),
            borderWidth: clamp(Number(element.dataset.cellBorderWidth ?? table.dataset.borderWidth ?? 1), 0, 8),
            textAlign: ['left', 'center', 'right'].includes(element.style.textAlign) ? element.style.textAlign : 'right',
            rowSpan,
            colSpan
          });
          this.cells[rowIndex][column] = cell;
          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
            for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
              if (rowOffset || columnOffset) this.cells[rowIndex + rowOffset][column + columnOffset] = null;
            }
          }
          column += colSpan;
        });
      });
      this.rebuildGrid();
      this.activeCell = { row: 0, column: 0 };
      this.selection = null;
      this.isDeleted = false;
      this.render();
    }

    readCellWidth(table) {
      const width = Number.parseFloat(table.rows[0]?.cells[0]?.style.width);
      return Number.isFinite(width) ? clamp(width, 40, 240) : 120;
    }

    readCellHeight(table) {
      const height = Number.parseFloat(table.rows[0]?.cells[0]?.style.height);
      return Number.isFinite(height) ? clamp(height, 28, 120) : 56;
    }

    toTableElement(availableWidth = 600) {
      this.syncText();
      const table = document.createElement('table');
      table.dataset.canvasTable = 'true';
      table.dataset.borderWidth = '1';
      table.dataset.borderColor = '#aeb6c5';
      table.style.width = `${clamp(Math.round(this.columns * this.cellWidth / availableWidth * 100), 10, 100)}%`;
      table.style.tableLayout = 'fixed';
      const body = table.createTBody();
      for (let row = 0; row < this.rows; row += 1) {
        const tableRow = body.insertRow();
        for (let column = 0; column < this.columns; column += 1) {
          const cell = this.cells[row][column];
          if (!cell) continue;
          const element = tableRow.insertCell();
          element.rowSpan = cell.rowSpan;
          element.colSpan = cell.colSpan;
          element.textContent = cell.text;
          element.style.width = `${cell.colSpan * this.cellWidth}px`;
          element.style.height = `${cell.rowSpan * this.cellHeight}px`;
          element.style.backgroundColor = cell.fill;
          element.style.textAlign = cell.textAlign;
          element.style.direction = 'rtl';
          element.style.fontFamily = "'Noto Nastaliq Urdu', serif";
          element.dataset.cellBorderColor = cell.borderColor;
          element.dataset.cellBorderWidth = String(cell.borderWidth);
        }
      }
      return table;
    }

    dispose() {
      this.canvas.dispose();
    }
  }

  window.CanvasTableManager = CanvasTableManager;
})();
