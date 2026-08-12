import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isChallengeResponse } from './collectRosters.ts';
import {
  buildMasterIndexes,
  dedupeRosterAgents,
  matchRosterToMaster,
  normalizeEmail,
  normalizePhone,
  type MasterAgent,
} from './rosterMatch.ts';

function master(partial: Partial<MasterAgent> & { id: string }): MasterAgent {
  return {
    first_name: 'Test',
    last_name: 'Agent',
    email: '',
    phone: '',
    city: 'Austin',
    state: 'TX',
    country: 'US',
    bio: '',
    ...partial,
  };
}

describe('roster identity matching', () => {
  it('matches email before name/state and phone', () => {
    const indexes = buildMasterIndexes([
      master({
        id: '1',
        first_name: 'Steve',
        last_name: 'Rettig',
        email: 'il.broker@exprealty.net',
        state: 'IL',
      }),
      master({
        id: '2',
        first_name: 'Steve',
        last_name: 'Rettig',
        email: 'other@example.com',
        phone: '8885749405',
        state: 'IL',
      }),
    ]);
    const emailMatch = matchRosterToMaster(
      {
        agentid: 1,
        fname: 'Steve',
        lname: 'Rettig',
        email: 'IL.Broker@exprealty.net',
        title: '',
        position_types: [],
        description: '',
      },
      indexes,
      'IL',
    );
    assert.equal(emailMatch.matchMethod, 'email');
    assert.equal(emailMatch.master?.id, '1');
  });

  it('uses unique name+state and unique phone fallbacks', () => {
    const indexes = buildMasterIndexes([
      master({
        id: 'a',
        first_name: 'Jay',
        last_name: 'Rodgers',
        email: 'jay@example.com',
        state: 'IL',
      }),
      master({
        id: 'b',
        first_name: 'Ron',
        last_name: 'Rank',
        email: 'ron@example.com',
        phone: '(847) 341-4376',
        state: 'IL',
      }),
    ]);
    const nameMatch = matchRosterToMaster(
      {
        agentid: 2,
        fname: 'Jay',
        lname: 'Rodgers',
        email: '',
        title: '',
        position_types: [],
        description: '',
      },
      indexes,
      'IL',
    );
    assert.equal(nameMatch.matchMethod, 'name_state');
    assert.equal(nameMatch.master?.id, 'a');

    const phoneMatch = matchRosterToMaster(
      {
        agentid: 3,
        fname: 'Different',
        lname: 'Name',
        email: '',
        cellphone: '8473414376',
        title: '',
        position_types: [],
        description: '',
      },
      indexes,
      'IL',
    );
    assert.equal(phoneMatch.matchMethod, 'phone');
    assert.equal(phoneMatch.master?.id, 'b');
  });

  it('dedupes roster agents and normalizes contact fields', () => {
    assert.equal(normalizeEmail(' A@B.com '), 'a@b.com');
    assert.equal(normalizePhone('+1 (512) 555-1212'), '5125551212');
    const deduped = dedupeRosterAgents([
      {
        sourceHost: 'https://il.exprealty.com',
        agent: {
          agentid: 1,
          fname: 'A',
          lname: 'B',
          email: 'a@b.com',
          title: '',
          position_types: [],
          description: '',
        },
      },
      {
        sourceHost: 'https://www.il.exprealty.com',
        agent: {
          agentid: 1,
          fname: 'A',
          lname: 'B',
          email: 'a@b.com',
          title: 'Team Leader',
          position_types: ['Team Leader'],
          description: 'Leads a team',
        },
      },
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].agent.title, 'Team Leader');
  });

  it('rejects challenge HTML responses', () => {
    assert.equal(
      isChallengeResponse(403, '<html>Just a moment... Cloudflare</html>'),
      true,
    );
    assert.equal(isChallengeResponse(200, '[{"agentid":1}]'), false);
  });
});
