import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHi } from './parseHi.js';

const SAMPLE = `<html><script>
var schoolsA = [{"schoolId":"335","schoolName":"Ahuimanu Elementary","districtName":"Windward","streetCity":"Kaneohe","streetZip":"96744","principal":"Kimi Ikeda","principalEmail":"10014378@k12.hi.us"},{"schoolId":"202","schoolName":"Aiea High School","districtName":"Central","streetCity":"Aiea","streetZip":"96701","principal":"Wayne Guevara","principalEmail":"wayne.guevara@k12.hi.us"}];
var schoolsP = [];
var schoolsC = [{"schoolId":"202","schoolName":"Aiea High School","districtName":"Central","streetCity":"Aiea","streetZip":"96701","principal":"Wayne Guevara","principalEmail":"wayne.guevara@k12.hi.us"}];
</script></html>`;

describe('parseHi', () => {
  it('reads principals from the embedded schoolsA JSON and drops numeric DOE mailboxes', () => {
    const { rows } = parseHi(SAMPLE);
    assert.equal(rows.length, 2);
    const ahuimanu = rows.find((row) => row.school_name === 'Ahuimanu Elementary');
    assert.ok(ahuimanu);
    assert.equal(ahuimanu.first_name, 'Kimi');
    assert.equal(ahuimanu.last_name, 'Ikeda');
    assert.equal(ahuimanu.email, '');
    const aiea = rows.find((row) => row.school_name === 'Aiea High School');
    assert.ok(aiea);
    assert.equal(aiea.email, 'wayne.guevara@k12.hi.us');
  });
});
