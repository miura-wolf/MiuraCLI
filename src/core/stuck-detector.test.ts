import { describe, it, expect } from 'vitest';
import { StuckDetector } from './stuck-detector.js';

describe('StuckDetector', () => {
  it('detects error loop after threshold', () => {
    const detector = new StuckDetector({ errorLoopThreshold: 2 });

    let signal = null;
    for (let i = 0; i < 3; i++) {
      signal = detector.addEntry({
        iteration: i,
        error: 'TypeError: something broke',
        reviewerApproved: false,
        workerTurns: 1,
        reviewerTurns: 0,
      });
    }

    expect(signal).not.toBeNull();
    expect(signal!.type).toBe('error_loop');
    expect(signal!.suggestion).toBeTruthy();
  });

  it('detects revision loop after threshold', () => {
    const detector = new StuckDetector({ revisionLoopThreshold: 4 });

    let signal = null;
    for (let i = 0; i < 5; i++) {
      signal = detector.addEntry({
        iteration: i,
        reviewerApproved: false,
        workerTurns: 0,
        reviewerTurns: 1,
      });
    }

    expect(signal).not.toBeNull();
    expect(signal!.type).toBe('revision_loop');
  });

  it('detects output repeat after threshold', () => {
    const detector = new StuckDetector({ outputRepeatThreshold: 3, revisionLoopThreshold: 10 });

    let signal = null;
    const sameOutput = 'identical response';
    for (let i = 0; i < 4; i++) {
      signal = detector.addEntry({
        iteration: i,
        output: sameOutput,
        reviewerApproved: true,
        workerTurns: 1,
        reviewerTurns: 1,
      });
    }

    expect(signal).not.toBeNull();
    expect(signal!.type).toBe('output_repeat');
  });

  it('returns null when no patterns detected', () => {
    const detector = new StuckDetector();

    const signal = detector.addEntry({
      iteration: 0,
      output: 'good output',
      reviewerApproved: true,
      workerTurns: 1,
      reviewerTurns: 1,
    });

    expect(signal).toBeNull();
  });

  it('can be disabled', () => {
    const detector = new StuckDetector({ enabled: false });

    let signal = null;
    for (let i = 0; i < 5; i++) {
      signal = detector.addEntry({
        iteration: i,
        error: 'same error',
        reviewerApproved: false,
        workerTurns: 1,
        reviewerTurns: 0,
      });
    }

    expect(signal).toBeNull();
  });

  it('reset clears history', () => {
    const detector = new StuckDetector({ errorLoopThreshold: 2 });

    detector.addEntry({
      iteration: 0,
      error: 'err',
      reviewerApproved: false,
      workerTurns: 1,
      reviewerTurns: 0,
    });

    detector.reset();
    expect(detector.getHistory()).toHaveLength(0);
  });
});
