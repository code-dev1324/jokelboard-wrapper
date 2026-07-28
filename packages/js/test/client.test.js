import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JokelboardClient, findCard } from '../src/client.js';
import {
  JokelboardError,
  JokelboardConfigurationError,
  RateLimitError,
  RevisionConflictError,
} from '../src/errors.js';

// ---- Mock fetch factory ----

function makeFetch(responses) {
  let i = 0;
  return async (_url, _opts) => {
    const r = responses[i++];
    if (!r) throw new Error(`Unexpected fetch call #${i}`);
    if (r.throw) throw r.throw;
    const status = r.status ?? 200;
    return {
      ok: r.ok ?? (status >= 200 && status < 300),
      status,
      headers: { get: (k) => r.headers?.[k] ?? null },
      text: async () => JSON.stringify(r.body ?? null),
    };
  };
}

function makeClient(fetchResponses, extra = {}) {
  return new JokelboardClient({
    token: 'jkb_testtoken',
    fetchImpl: makeFetch(fetchResponses),
    ...extra,
  });
}

const BOARD = {
  id: 'b1',
  revision: 42,
  data: {
    lists: [
      {
        id: 'l1',
        title: 'To Do',
        cards: [
          { id: 'c1', title: 'Fix bug', fieldValues: { 'discord-id': '12345' } },
          { id: 'c2', title: 'Add feature', fieldValues: {} },
        ],
      },
      { id: 'l2', title: 'Done', cards: [] },
    ],
  },
};

// ---- Error classes ----

describe('JokelboardError', () => {
  test('sets all properties', () => {
    const err = new JokelboardError('card_not_found', 'Not found', 404, { raw: true }, { method: 'GET', path: '/boards/x' });
    assert.equal(err.code, 'card_not_found');
    assert.equal(err.status, 404);
    assert.equal(err.method, 'GET');
    assert.equal(err.path, '/boards/x');
    assert.equal(err.retryable, false);
    assert.deepEqual(err.toJSON(), {
      name: 'JokelboardError',
      message: 'Not found',
      code: 'card_not_found',
      status: 404,
      method: 'GET',
      path: '/boards/x',
      retryable: false,
    });
  });

  test('retryable for 5xx', () => {
    const err = new JokelboardError('http_error', 'Server error', 500, null);
    assert.equal(err.retryable, true);
  });

  test('retryable for revision_conflict', () => {
    const err = new JokelboardError('revision_conflict', 'Conflict', 409, null);
    assert.equal(err.retryable, true);
  });

  test('retryable when status is null (network error)', () => {
    const err = new JokelboardError('network_error', 'No network', null, null);
    assert.equal(err.retryable, true);
  });
});

describe('JokelboardConfigurationError', () => {
  test('sets name and code', () => {
    const err = new JokelboardConfigurationError('bad config');
    assert.equal(err.name, 'JokelboardConfigurationError');
    assert.equal(err.code, 'configuration_error');
    assert.equal(err.retryable, false);
  });
});

describe('RateLimitError', () => {
  test('sets retryAfter', () => {
    const err = new RateLimitError('Too many requests', 30, null, { method: 'POST', path: '/boards/x/cards' });
    assert.equal(err.retryAfter, 30);
    assert.equal(err.status, 429);
    assert.equal(err.retryable, true);
    assert.equal(err.method, 'POST');
  });
});

describe('RevisionConflictError', () => {
  test('sets currentRevision', () => {
    const err = new RevisionConflictError('Conflict', 99, null);
    assert.equal(err.currentRevision, 99);
    assert.equal(err.status, 409);
    assert.equal(err.retryable, true);
  });
});

// ---- Constructor validation ----

describe('JokelboardClient constructor', () => {
  test('throws on missing token', () => {
    assert.throws(
      () => new JokelboardClient({ token: '', fetchImpl: makeFetch([]) }),
      JokelboardConfigurationError,
    );
  });

  test('throws on invalid token prefix', () => {
    assert.throws(
      () => new JokelboardClient({ token: 'bad_token', fetchImpl: makeFetch([]) }),
      JokelboardConfigurationError,
    );
  });

  test('throws on non-HTTPS baseUrl', () => {
    assert.throws(
      () => new JokelboardClient({ token: 'jkb_abc', baseUrl: 'http://example.com', fetchImpl: makeFetch([]) }),
      JokelboardConfigurationError,
    );
  });

  test('allows HTTP for localhost', () => {
    assert.doesNotThrow(
      () => new JokelboardClient({ token: 'jkb_abc', baseUrl: 'http://localhost:3000', fetchImpl: makeFetch([]) }),
    );
  });

  test('throws when baseUrl has credentials', () => {
    assert.throws(
      () => new JokelboardClient({ token: 'jkb_abc', baseUrl: 'https://user:pw@api.jokelboard.com', fetchImpl: makeFetch([]) }),
      JokelboardConfigurationError,
    );
  });

  test('throws when baseUrl has query string', () => {
    assert.throws(
      () => new JokelboardClient({ token: 'jkb_abc', baseUrl: 'https://api.jokelboard.com?foo=bar', fetchImpl: makeFetch([]) }),
      JokelboardConfigurationError,
    );
  });

  test('throws on invalid fetchImpl', () => {
    assert.throws(
      () => new JokelboardClient({ token: 'jkb_abc', fetchImpl: 'not-a-function' }),
      JokelboardConfigurationError,
    );
  });

  test('accepts defaultBoardId', () => {
    const client = makeClient([], { defaultBoardId: 'board-x' });
    assert.equal(client.defaultBoardId, 'board-x');
  });
});

// ---- resolveBoardId ----

describe('resolveBoardId', () => {
  test('uses passed boardId', () => {
    const client = makeClient([]);
    assert.equal(client.resolveBoardId('my-board'), 'my-board');
  });

  test('falls back to defaultBoardId', () => {
    const client = makeClient([], { defaultBoardId: 'default-board' });
    assert.equal(client.resolveBoardId(null), 'default-board');
  });

  test('throws when neither is set', () => {
    const client = makeClient([]);
    assert.throws(() => client.resolveBoardId(null), JokelboardConfigurationError);
  });
});

// ---- findCard helper ----

describe('findCard', () => {
  test('returns matching card and list', () => {
    const result = findCard(BOARD, c => c.id === 'c1');
    assert.equal(result?.card.id, 'c1');
    assert.equal(result?.list.id, 'l1');
  });

  test('returns null when no match', () => {
    const result = findCard(BOARD, c => c.id === 'nope');
    assert.equal(result, null);
  });

  test('handles board with no lists', () => {
    const result = findCard({ data: { lists: [] } }, () => true);
    assert.equal(result, null);
  });
});

// ---- _request error handling ----

describe('_request', () => {
  test('throws RateLimitError on 429', async () => {
    const client = makeClient([{ status: 429, body: { error: 'rate_limited', message: 'Too fast', retryAfter: 5 } }], {
      retryOnRateLimit: false,
    });
    await assert.rejects(() => client.listBoards(), RateLimitError);
  });

  test('auto-retries on 429 when retryOnRateLimit is true', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        return {
          ok: false, status: 429,
          headers: { get: () => null },
          text: async () => JSON.stringify({ retryAfter: 0 }),
        };
      }
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ boards: [] }),
      };
    };
    const client = new JokelboardClient({ token: 'jkb_test', fetchImpl, retryOnRateLimit: true, maxRetries: 1 });
    const result = await client.listBoards();
    assert.deepEqual(result, []);
    assert.equal(calls, 2);
  });

  test('throws RevisionConflictError on 409', async () => {
    const client = makeClient([
      { status: 409, body: { error: 'revision_conflict', message: 'Conflict', currentRevision: 7 } },
    ], { retryOnRateLimit: false, maxConflictRetries: 0 });
    await assert.rejects(
      () => client.updateCard('board-id', 'card-id', { title: 'x' }),
      RevisionConflictError,
    );
  });

  test('throws JokelboardError on network failure', async () => {
    const client = new JokelboardClient({
      token: 'jkb_test',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    await assert.rejects(() => client.listBoards(), JokelboardError);
  });

  test('throws request_timeout on AbortError', async () => {
    const client = new JokelboardClient({
      token: 'jkb_test',
      fetchImpl: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; },
    });
    await assert.rejects(
      () => client.listBoards(),
      (err) => err instanceof JokelboardError && err.code === 'request_timeout',
    );
  });

  test('redacts token from error body', async () => {
    const token = 'jkb_secrettoken';
    const client = new JokelboardClient({
      token,
      fetchImpl: async () => ({
        ok: false, status: 400,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: 'invalid_data', message: `bad token: ${token}` }),
      }),
    });
    try {
      await client.listBoards();
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof JokelboardError);
      assert.ok(!JSON.stringify(err.raw).includes(token));
    }
  });

  test('error carries method and path', async () => {
    const client = makeClient([{ status: 404, body: { error: 'not_found', message: 'Not found' } }]);
    try {
      await client.listBoards();
    } catch (err) {
      assert.ok(err instanceof JokelboardError);
      assert.equal(err.method, 'GET');
      assert.equal(err.path, '/boards');
    }
  });
});

// ---- getBoard / getLists ----

describe('getBoard', () => {
  test('returns board', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const board = await client.getBoard('b1');
    assert.equal(board.id, 'b1');
  });

  test('throws on malformed response', async () => {
    const client = makeClient([{ body: { board: null } }]);
    await assert.rejects(() => client.getBoard('b1'), JokelboardError);
  });
});

describe('getLists', () => {
  test('returns lists array', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const lists = await client.getLists('b1');
    assert.equal(lists.length, 2);
    assert.equal(lists[0].id, 'l1');
  });
});

// ---- getCard / findCardByTitle / findCardById ----

describe('getCard', () => {
  test('returns card when found', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const card = await client.getCard('b1', 'c1');
    assert.equal(card.title, 'Fix bug');
  });

  test('throws card_not_found when missing', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    await assert.rejects(
      () => client.getCard('b1', 'nope'),
      (err) => err instanceof JokelboardError && err.code === 'card_not_found',
    );
  });
});

describe('findCardByTitle', () => {
  test('finds card case-insensitively', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const match = await client.findCardByTitle('b1', 'FIX BUG');
    assert.equal(match?.card.id, 'c1');
  });

  test('returns null when not found', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const match = await client.findCardByTitle('b1', 'nonexistent');
    assert.equal(match, null);
  });
});

describe('findCardById', () => {
  test('returns match', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const match = await client.findCardById('b1', 'c2');
    assert.equal(match?.card.title, 'Add feature');
  });
});

// ---- patchCard / write queue ----

describe('patchCard', () => {
  test('sends revision from board', async () => {
    let sentBody;
    const fetchImpl = async (_url, opts) => {
      const body = JSON.parse(opts.body ?? 'null');
      if (opts.method === 'GET') {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ board: BOARD }) };
      }
      sentBody = body;
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ card: { id: 'c1' } }) };
    };
    const client = new JokelboardClient({ token: 'jkb_test', fetchImpl });
    await client.patchCard('b1', 'c1', { title: 'Updated' });
    assert.equal(sentBody.revision, 42);
    assert.equal(sentBody.title, 'Updated');
  });

  test('passes current card to patch function', async () => {
    let receivedCard;
    const fetchImpl = async (_url, opts) => {
      if (opts.method === 'GET') {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ board: BOARD }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ card: {} }) };
    };
    const client = new JokelboardClient({ token: 'jkb_test', fetchImpl });
    await client.patchCard('b1', 'c1', (card) => { receivedCard = card; return {}; });
    assert.equal(receivedCard.title, 'Fix bug');
  });
});

// ---- custom fields ----

describe('getCustomField', () => {
  test('returns field value', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const val = await client.getCustomField('b1', 'c1', 'discord-id');
    assert.equal(val, '12345');
  });

  test('returns null for missing field', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const val = await client.getCustomField('b1', 'c1', 'missing-key');
    assert.equal(val, null);
  });
});

describe('setCustomField', () => {
  test('preserves existing fields', async () => {
    let sentBody;
    const fetchImpl = async (_url, opts) => {
      if (opts.method === 'GET') {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ board: BOARD }) };
      }
      sentBody = JSON.parse(opts.body);
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ card: {} }) };
    };
    const client = new JokelboardClient({ token: 'jkb_test', fetchImpl });
    await client.setCustomField('b1', 'c1', 'new-field', 'hello');
    assert.equal(sentBody.fieldValues['discord-id'], '12345');
    assert.equal(sentBody.fieldValues['new-field'], 'hello');
  });
});

// ---- board() proxy ----

describe('board()', () => {
  test('returns BoardClient with correct id', () => {
    const client = makeClient([]);
    const b = client.board('my-board');
    assert.equal(b.id, 'my-board');
  });

  test('board proxy methods work', async () => {
    const client = makeClient([{ body: { board: BOARD } }]);
    const b = client.board('b1');
    const lists = await b.getLists();
    assert.equal(lists.length, 2);
  });

  test('uses defaultBoardId when no boardId passed', () => {
    const client = makeClient([], { defaultBoardId: 'default-board' });
    const b = client.board();
    assert.equal(b.id, 'default-board');
  });
});
