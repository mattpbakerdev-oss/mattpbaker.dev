// Lets `node --test play/test/` work on Node 22+, which treats the argument as a module path
// rather than a folder to scan. Each import registers its tests.
import './physics.test.mjs';
import './places.test.mjs';
import './input.test.mjs';
import './proximity.test.mjs';
import './joystick.test.mjs';
import './collect.test.mjs';
import './tumble.test.mjs';
import './walkers.test.mjs';
import './occlusion.test.mjs';
import './audio.test.mjs';
import './storage.test.mjs';
import './bootfail.test.mjs';
import './sheet.test.mjs';
import './camrig.test.mjs';
import './rim.test.mjs';
import './speedo.test.mjs';
import './arrival.test.mjs';
import './objectives.test.mjs';
import './titlecam.test.mjs';
import './promptgate.test.mjs';
