/** Bounded document history with named actions and optional time-based grouping. */
class WordStyleHistoryManager {
  constructor({
    captureState,
    restoreState,
    onStateChange = () => {},
    getStateKey = JSON.stringify,
    maxHistory = 100,
    groupingWindow = 900
  } = {}) {
    if (typeof captureState !== 'function') throw new TypeError('captureState must be a function.');
    if (typeof restoreState !== 'function') throw new TypeError('restoreState must be a function.');
    if (typeof onStateChange !== 'function') throw new TypeError('onStateChange must be a function.');
    if (typeof getStateKey !== 'function') throw new TypeError('getStateKey must be a function.');
    if (!Number.isInteger(maxHistory) || maxHistory < 1) {
      throw new RangeError('maxHistory must be a positive integer.');
    }
    if (!Number.isFinite(groupingWindow) || groupingWindow < 0) {
      throw new RangeError('groupingWindow must be a non-negative number.');
    }

    this.captureState = captureState;
    this.restoreState = restoreState;
    this.onStateChange = onStateChange;
    this.getStateKey = getStateKey;
    this.maxHistory = maxHistory;
    this.groupingWindow = groupingWindow;
    this.entries = [];
    this.currentIndex = -1;
    this.busy = false;
    this.lastOperationWasNavigation = false;
  }

  /** Start a new history at the current document state. */
  initialize(action = 'Document opened') {
    const state = this.cloneState(this.captureState());
    this.entries = [{
      action,
      timestamp: new Date().toISOString(),
      groupedAt: Date.now(),
      groupKey: null,
      state,
      stateKey: this.getStateKey(state)
    }];
    this.currentIndex = 0;
    this.lastOperationWasNavigation = false;
    this.notifyStateChange();
  }

  /** Capture a changed state, merging it with a recent entry that has the same group key. */
  record(action = 'Edited Document', { groupKey = null } = {}) {
    if (this.busy || this.currentIndex < 0) return false;
    const state = this.cloneState(this.captureState());
    const stateKey = this.getStateKey(state);
    const currentEntry = this.entries[this.currentIndex];
    if (currentEntry && currentEntry.stateKey === stateKey) return false;

    this.entries.splice(this.currentIndex + 1);
    const now = Date.now();
    const canGroup = !this.lastOperationWasNavigation && groupKey &&
      currentEntry?.groupKey === groupKey &&
      now - currentEntry.groupedAt <= this.groupingWindow;

    if (canGroup) {
      currentEntry.state = state;
      currentEntry.stateKey = stateKey;
      currentEntry.groupedAt = now;
    } else {
      this.entries.push({
        action,
        timestamp: new Date(now).toISOString(),
        groupedAt: now,
        groupKey,
        state,
        stateKey
      });
      this.currentIndex += 1;
    }

    while (this.entries.length > this.maxHistory + 1) {
      this.entries.shift();
      this.currentIndex -= 1;
    }
    this.lastOperationWasNavigation = false;
    this.notifyStateChange();
    return true;
  }

  /** Restore up to count earlier states and resolve with the number of steps restored. */
  async undoSteps(count = 1) {
    const steps = this.validateStepCount(count);
    const targetIndex = Math.max(0, this.currentIndex - steps);
    if (targetIndex === this.currentIndex || this.busy) return 0;
    const previousIndex = this.currentIndex;
    await this.restoreIndex(targetIndex);
    return previousIndex - this.currentIndex;
  }

  /** Restore up to count later states and resolve with the number of steps restored. */
  async redoSteps(count = 1) {
    const steps = this.validateStepCount(count);
    const targetIndex = Math.min(this.entries.length - 1, this.currentIndex + steps);
    if (targetIndex === this.currentIndex || this.busy) return 0;
    const previousIndex = this.currentIndex;
    await this.restoreIndex(targetIndex);
    return this.currentIndex - previousIndex;
  }

  /** Return action names, timestamps, and navigation status without exposing stored snapshots. */
  getHistoryLog() {
    return this.entries.slice(1).map((entry, offset) => ({
      index: offset + 1,
      action: entry.action,
      timestamp: entry.timestamp,
      isCurrent: offset + 1 === this.currentIndex,
      isUndone: offset + 1 > this.currentIndex
    }));
  }

  getState() {
    return {
      canUndo: this.currentIndex > 0,
      canRedo: this.currentIndex >= 0 && this.currentIndex < this.entries.length - 1,
      undoCount: Math.max(0, this.currentIndex),
      redoCount: Math.max(0, this.entries.length - 1 - this.currentIndex),
      currentIndex: this.currentIndex,
      historyDepth: Math.max(0, this.entries.length - 1),
      maxHistory: this.maxHistory,
      nextUndoAction: this.entries[this.currentIndex]?.action || null,
      nextRedoAction: this.entries[this.currentIndex + 1]?.action || null,
      historyLog: this.getHistoryLog()
    };
  }

  async restoreIndex(targetIndex) {
    this.busy = true;
    try {
      await this.restoreState(this.cloneState(this.entries[targetIndex].state));
      this.currentIndex = targetIndex;
      this.lastOperationWasNavigation = true;
      this.notifyStateChange();
    } finally {
      this.busy = false;
    }
  }

  notifyStateChange() {
    this.onStateChange(this.getState());
  }

  validateStepCount(count) {
    if (!Number.isInteger(count) || count < 1) {
      throw new RangeError('History step count must be a positive integer.');
    }
    return count;
  }

  cloneState(state) {
    if (typeof structuredClone === 'function') return structuredClone(state);
    return JSON.parse(JSON.stringify(state));
  }
}

window.WordStyleHistoryManager = WordStyleHistoryManager;
