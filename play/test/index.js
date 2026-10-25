// Lets `node --test play/test/` work on Node 22+, which treats the argument as a module path
// rather than a folder to scan. Each import registers its tests.
import './physics.test.mjs';
import './places.test.mjs';
import './input.test.mjs';
import './proximity.test.mjs';
import './joystick.test.mjs';
