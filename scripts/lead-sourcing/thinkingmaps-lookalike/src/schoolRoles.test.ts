import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySchoolRole, ROLE_FILL_ORDER } from './schoolRoles.js';

describe('classifySchoolRole', () => {
  it('ranks curriculum, assistant principal, and principal; drops teachers', () => {
    assert.equal(classifySchoolRole('Instructional Coach'), 'curriculum');
    assert.equal(classifySchoolRole('Director of Curriculum'), 'curriculum');
    assert.equal(classifySchoolRole('Assistant Principal'), 'assistant_principal');
    assert.equal(classifySchoolRole('Vice Principal'), 'assistant_principal');
    assert.equal(classifySchoolRole('Principal'), 'principal');
    assert.equal(classifySchoolRole('3rd Grade Teacher'), 'teacher');
    assert.equal(classifySchoolRole('Administrative Assistant to the Principal'), 'excluded');
    assert.equal(classifySchoolRole('Assistant to the Principal'), 'excluded');
    assert.equal(classifySchoolRole('Ast Principal-Elementary'), 'assistant_principal');
    assert.equal(classifySchoolRole('TEACHR INST COACH ELE ELAR/SS'), 'curriculum');
    assert.equal(classifySchoolRole('TEACHER INSTRUC COACH HS'), 'curriculum');
    assert.deepEqual(ROLE_FILL_ORDER, ['curriculum', 'assistant_principal', 'principal']);
  });
});
