import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleObject} from '../src/lib/objectEvidence';
import {rhythmicSpeech} from '../src/lib/speechMotion';
const box={originX:100,originY:100,width:100,height:180};
test('hand/person primary label does not turn into phone from a secondary guess',()=>{
  assert.equal(visibleObject({categories:[{categoryName:'person',score:.95},{categoryName:'cell phone',score:.85}],boundingBox:box},640,480),null);
});
test('weak phone guesses and missing bounding boxes are rejected',()=>{
  assert.equal(visibleObject({categories:[{categoryName:'cell phone',score:.2}],boundingBox:box},640,480),null);
  assert.equal(visibleObject({categories:[{categoryName:'cell phone',score:.95}]},640,480),null);
});
test('clearly located high-confidence phone is a candidate for independent verification',()=>{
  assert.equal(visibleObject({categories:[{categoryName:'cell phone',score:.95}],boundingBox:box},640,480)?.violationType,'FORBIDDEN_OBJECT_CELL_PHONE');
});
test('invalid geometry cannot be evidence',()=>{
  assert.equal(visibleObject({categories:[{categoryName:'book',score:.95}],boundingBox:{...box,width:NaN}},640,480),null);
});
test('static open mouth is not speech; repeated lip motion can be',()=>{
  assert.equal(rhythmicSpeech([.4,.4,.4,.4,.4,.4,.4,.4]),false);
  assert.equal(rhythmicSpeech([.1,.18,.1,.2,.1,.2,.1,.18]),true);
});
