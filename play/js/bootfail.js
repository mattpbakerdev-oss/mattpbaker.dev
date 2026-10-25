// Boot errors: only a genuine WebGL failure shows the "can't draw the town" card; anything else
// is a bug and gets the plain "Something went wrong" card. No three.js.

export class WebGLFailure extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'WebGLFailure';
  }
}

export function isWebGLFailure(err) {
  return err instanceof WebGLFailure;
}
