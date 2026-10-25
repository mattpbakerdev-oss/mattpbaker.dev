import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebGLFailure, isWebGLFailure } from '../js/bootfail.js';

test('only a WebGL failure shows the WebGL card', () => {
  assert.equal(isWebGLFailure(new WebGLFailure('no context')), true);
  assert.equal(isWebGLFailure(new TypeError('x is undefined')), false);
  assert.equal(isWebGLFailure(new DOMException('denied', 'SecurityError')), false);
  assert.equal(isWebGLFailure(null), false);
});

test('a WebGLFailure keeps the original error as its cause', () => {
  const cause = new Error('Error creating WebGL context.');
  const err = new WebGLFailure('renderer', cause);
  assert.equal(err.cause, cause);
  assert.ok(err instanceof Error);
});
