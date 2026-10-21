import { afterEach, describe, expect, test } from 'bun:test';
import { type Call, json, MANIFEST, TOKEN, testApp } from './helpers';

const ALICE = 'http://alice-tool:8080';
const ALICE_2 = 'http://alice-tool-2:8080';
const BOB = 'http://bob-tool:8080';

const puts = (calls: Call[]) =>
  calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/api/octoforge/siblings'));

type T = Awaited<ReturnType<typeof testApp>>;
const opened: T[] = [];
async function app(...args: Parameters<typeof testApp>): Promise<T> {
  const t = await testApp(...args);
  opened.push(t);
  return t;
}
afterEach(() => {
  for (const t of opened.splice(0)) t.siblings.stop();
});

/** alice-tool: two instances, the first reports a public URL; bob-tool: own public URL, no manifest. */
async function family(handler: (c: Call) => Response | Promise<Response> | undefined = () => undefined) {
  const t = await app((c) => {
    const own = handler(c);
    if (own) return own;
    if (c.url === `${ALICE}/api/octoforge/manifest`) return json(MANIFEST);
    if (c.url === `${ALICE}/api/octoforge/status`)
      return json({ contract: 1, public_url: 'https://alice.example.com/' });
    if (c.url === `${BOB}/api/octoforge/status`)
      return json({ contract: 1, public_url: 'https://ignored.example.com' });
    if (c.method === 'PUT' && c.url.endsWith('/api/octoforge/siblings'))
      return json({ ok: true, message: 'ok' });
    if (c.method === 'DELETE' && c.url.endsWith('/api/octoforge/siblings'))
      return json({ ok: true, message: 'cleared' });
  });
  await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: ALICE });
  await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: ALICE_2 });
  await t.req('POST', '/api/instances', {
    member: 'bob-tool',
    baseUrl: BOB,
    publicUrl: 'https://bob.example.com',
  });
  return t;
}

describe('sibling list', () => {
  test('forge first, one entry per member: instance URL > reported URL > base URL, absolute icon', async () => {
    const t = await family();
    const list = await t.siblings.build();
    expect(list.forge).toEqual({
      title: 'Octoforge',
      url: 'https://forge.example.com',
      icon: 'https://forge.example.com/favicon.svg',
    });
    expect(list.members).toEqual([
      {
        name: 'alice-tool',
        title: 'Alice tool',
        url: 'https://alice.example.com',
        icon: 'https://alice.example.com/favicon.svg',
      },
      // No manifest anywhere: title from .gitmodules, no icon; its own public URL beats the reported one.
      { name: 'bob-tool', title: 'bob-tool', url: 'https://bob.example.com' },
    ]);
    expect(Number.isNaN(Date.parse(list.updated_at))).toBe(false);
    // Octoforge has a public URL for bob, so it does not ask bob's status.
    expect(t.calls.some((c) => c.url === `${BOB}/api/octoforge/status`)).toBe(false);
  });

  test('base URL when the member reports none; members without an instance are left out', async () => {
    const t = await app((c) => {
      if (c.url === `${ALICE}/api/octoforge/manifest`) return json(MANIFEST);
      if (c.url === `${ALICE}/api/octoforge/status`) return json({ contract: 1 });
    });
    await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: ALICE });
    const list = await t.siblings.build();
    expect(list.members).toEqual([
      { name: 'alice-tool', title: 'Alice tool', url: ALICE, icon: `${ALICE}/favicon.svg` },
    ]);
  });

  test('every instance gets the same list, the receiving member included, with the bearer', async () => {
    const t = await family();
    const run = await t.siblings.sendNow();
    expect(run).toEqual({ skipped: null, total: 3, sent: 3, unsupported: 0, failed: 0 });
    const sent = puts(t.calls);
    expect(sent.map((c) => c.url).sort()).toEqual(
      [ALICE, ALICE_2, BOB].map((u) => `${u}/api/octoforge/siblings`).sort(),
    );
    for (const c of sent) {
      expect(c.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect((c.body as { members: { name: string }[] }).members.map((m) => m.name)).toEqual([
        'alice-tool',
        'bob-tool',
      ]);
    }
    const cards = (await t.req('GET', '/api/members')).body.members;
    expect(cards[0].instances[0].switcher).toMatchObject({ state: 'sent', reason: null });
  });

  test('manual send through the API answers with a summary', async () => {
    const t = await family((c) =>
      c.method === 'PUT' && c.url === `${ALICE_2}/api/octoforge/siblings`
        ? json({ ok: false, message: 'disk full' }, 500)
        : undefined,
    );
    const r = await t.req('POST', '/api/siblings/send');
    expect(r.status).toBe(200);
    expect(r.body.message).toBe('sent to 2 of 3 instances, 1 failed');
    const cards = (await t.req('GET', '/api/members')).body.members;
    expect(cards[0].instances[1].switcher).toMatchObject({ state: 'failed', reason: 'disk full' });
  });
});

describe('sibling scheduler', () => {
  test('one run at a time: triggers during a run queue exactly one more', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const t = await app(
      async (c) => {
        if (c.method !== 'PUT') return new Response('not found', { status: 404 });
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await gate;
        inFlight--;
        return json({ ok: true, message: 'ok' });
      },
      {},
      { siblings: { concurrency: 1 } },
    );
    await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: ALICE,
      publicUrl: 'https://alice.example.com',
    });
    const first = t.siblings.send('a');
    const second = t.siblings.send('b');
    const third = t.siblings.send('c');
    expect(third).toBe(second);
    await Bun.sleep(20);
    expect(puts(t.calls)).toHaveLength(1);
    release();
    await Promise.all([first, second, third]);
    await t.siblings.idle();
    expect(puts(t.calls)).toHaveLength(2);
    expect(maxInFlight).toBe(1);
  });

  test('a 404 marks the instance unsupported: no further sends until an instance changes', async () => {
    const t = await family((c) =>
      c.url === `${BOB}/api/octoforge/siblings` ? new Response('not found', { status: 404 }) : undefined,
    );
    expect(await t.siblings.send('schedule')).toMatchObject({ total: 3, sent: 2, unsupported: 1 });
    const bob = (await t.req('GET', '/api/members')).body.members[1].instances[0];
    expect(bob.switcher).toMatchObject({ state: 'unsupported' });

    expect(await t.siblings.send('schedule')).toMatchObject({ total: 2, sent: 2, unsupported: 0 });
    expect(puts(t.calls).filter((c) => c.url.startsWith(BOB))).toHaveLength(1);

    // An instance change clears the mark (the scheduler is not running: nothing is sent by itself).
    const id = (await t.req('GET', '/api/instances')).body.instances.find(
      (i: { baseUrl: string }) => i.baseUrl === ALICE,
    ).id;
    await t.req('PATCH', `/api/instances/${id}`, { publicUrl: 'https://alice-new.example.com' });
    expect(await t.siblings.send('schedule')).toMatchObject({ total: 3, unsupported: 1 });
    expect(puts(t.calls).filter((c) => c.url.startsWith(BOB))).toHaveLength(2);
  });

  test('instance changes trigger a run once started; removal clears the removed one first', async () => {
    const t = await family();
    t.siblings.start(); // start delay 10 s: only instance changes run here
    const list = (await t.req('GET', '/api/instances')).body.instances as { id: number; baseUrl: string }[];
    const bobId = list.find((i) => i.baseUrl === BOB)?.id;
    const before = t.calls.length;
    expect((await t.req('DELETE', `/api/instances/${bobId}`)).status).toBe(200);
    await t.siblings.idle();
    const after = t.calls.slice(before).filter((c) => c.url.endsWith('/api/octoforge/siblings'));
    expect(after[0]).toMatchObject({ method: 'DELETE', url: `${BOB}/api/octoforge/siblings` });
    expect(
      after
        .slice(1)
        .map((c) => `${c.method} ${c.url}`)
        .sort(),
    ).toEqual([`PUT ${ALICE_2}/api/octoforge/siblings`, `PUT ${ALICE}/api/octoforge/siblings`]);
    for (const c of after.slice(1))
      expect((c.body as { members: { name: string }[] }).members.map((m) => m.name)).toEqual(['alice-tool']);
  });

  test('start-up run after the start delay', async () => {
    const t = await app(() => json({ ok: true, message: 'ok' }), {}, { siblings: { startDelayMs: 5 } });
    await t.req('POST', '/api/instances', {
      member: 'alice-tool',
      baseUrl: ALICE,
      publicUrl: 'https://alice.example.com',
    });
    expect(puts(t.calls)).toHaveLength(0);
    t.siblings.start();
    await Bun.sleep(30);
    await t.siblings.idle();
    expect(puts(t.calls)).toHaveLength(1);
  });

  for (const [variable, reason] of [
    ['OCTOFORGE_TOKEN', 'OCTOFORGE_TOKEN is not set'],
    ['PUBLIC_URL', 'PUBLIC_URL is not set'],
  ] as const) {
    test(`skips without ${variable}`, async () => {
      const t = await app(() => json({ ok: true, message: 'ok' }), { [variable]: '' });
      await t.req('POST', '/api/instances', { member: 'alice-tool', baseUrl: ALICE });
      expect(await t.siblings.send('schedule')).toEqual({
        skipped: reason,
        total: 0,
        sent: 0,
        unsupported: 0,
        failed: 0,
      });
      const r = await t.req('POST', '/api/siblings/send');
      expect(r.status).toBe(503);
      expect(r.body.message).toBe(`sibling list not sent: ${reason}`);
      expect(puts(t.calls)).toHaveLength(0);
    });
  }
});
