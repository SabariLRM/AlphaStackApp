import FormData from 'form-data';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createHarness, login, type Harness } from './helpers.js';

let h: Harness;
let A: ReturnType<typeof api>;
let B: ReturnType<typeof api>;
let C: ReturnType<typeof api>;
const addrA = '9000000010@phonemail.com';
const addrB = '9000000020@phonemail.com';
const addrC = '9000000030@phonemail.com';

beforeAll(async () => {
  h = await createHarness();
  A = api(h, (await login(h, '9000000010')).token!);
  B = api(h, (await login(h, '9000000020')).token!);
  C = api(h, (await login(h, '9000000030')).token!);
  await A.patch('/api/me', { displayName: 'Asha' });
  await B.patch('/api/me', { displayName: 'Bala' });
});
afterAll(async () => h.close());

const convWith = async (client: ReturnType<typeof api>, participants: string[]) => {
  const list = (await client.get('/api/conversations')).body.items as any[];
  return list.find((c) => c.participants.map((p: any) => p.address).sort().join(',') === [...participants].sort().join(','));
};

describe('chats', () => {
  let bInboxEntry: string;

  it('delivers an email and files it into one-to-one chats on both sides', async () => {
    const sent = await A.post('/api/messages', { to: ['9000000020'], subject: 'Hello', body: 'First email' });
    expect(sent.status).toBe(200);
    expect(sent.body.message.to).toEqual([{ address: addrB, name: 'Bala' }]);

    const aConv = await convWith(A, [addrB]);
    expect(aConv).toBeTruthy();
    expect(aConv.isGroup).toBe(false);
    expect(aConv.lastMessage.direction).toBe('out');

    const bConv = await convWith(B, [addrA]);
    expect(bConv.unreadCount).toBe(1);
    expect(bConv.participants[0]).toMatchObject({ address: addrA, name: 'Asha', isLocal: true });
    expect(bConv.lastMessage.subject).toBe('Hello');

    const msgs = await B.get(`/api/conversations/${bConv.id}/messages`);
    expect(msgs.body.items).toHaveLength(1);
    bInboxEntry = msgs.body.items[0].id;
    expect(msgs.body.items[0]).toMatchObject({ direction: 'in', folder: 'inbox', text: 'First email', canReply: true });

    const unread = await B.get('/api/conversations?filter=unread');
    expect(unread.body.items).toHaveLength(1);
    await B.post(`/api/conversations/${bConv.id}/read`, {});
    expect((await B.get('/api/conversations?filter=unread')).body.items).toHaveLength(0);
  });

  it('links replies to the original, hides the subject and allows only one reply per email', async () => {
    const bConv = await convWith(B, [addrA]);
    const reply = await B.post(`/api/conversations/${bConv.id}/messages`, { body: 'Got it', replyToEntryId: bInboxEntry });
    expect(reply.status).toBe(200);
    expect(reply.body.message.subject).toBe('Re: Hello');
    expect(reply.body.message.replyTo).toMatchObject({ id: bInboxEntry, subject: 'Hello' });
    expect(reply.body.conversationId).toBe(bConv.id);

    const again = await B.post(`/api/conversations/${bConv.id}/messages`, { body: 'Second reply', replyToEntryId: bInboxEntry });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_replied');

    const original = await B.get(`/api/messages/${bInboxEntry}`);
    expect(original.body.canReply).toBe(false);
    expect(original.body.repliedAt).toBeTruthy();

    // A sees the reply in the same chat, linked to A's own copy of the original.
    const aConv = await convWith(A, [addrB]);
    const aMsgs = (await A.get(`/api/conversations/${aConv.id}/messages`)).body.items;
    expect(aMsgs).toHaveLength(2);
    expect(aMsgs[0].direction).toBe('in');
    expect(aMsgs[0].replyTo.direction).toBe('out');
    expect(aMsgs[0].replyTo.subject).toBe('Hello');
  });

  it('never lets a chat message add recipients', async () => {
    const aConv = await convWith(A, [addrB]);
    const res = await A.post(`/api/conversations/${aConv.id}/messages`, { subject: 'New topic', body: 'x', to: [addrC] });
    expect(res.status).toBe(200);
    expect(res.body.message.to.map((m: any) => m.address)).toEqual([addrB]);
    expect(await convWith(C, [addrA])).toBeUndefined();
  });

  it('creates a group chat for multiple recipients; individual mail stays one-to-one', async () => {
    const sent = await A.post('/api/messages', { to: [addrB, '9000000030'], subject: 'Team', body: 'Group hello' });
    expect(sent.status).toBe(200);
    const aGroup = await convWith(A, [addrB, addrC]);
    expect(aGroup.isGroup).toBe(true);
    const bGroup = await convWith(B, [addrA, addrC]);
    const cGroup = await convWith(C, [addrA, addrB]);
    expect(bGroup.isGroup && cGroup.isGroup).toBe(true);

    // C replies inside the group: it stays in everyone's group chat.
    const cMsgs = (await C.get(`/api/conversations/${cGroup.id}/messages`)).body.items;
    const r = await C.post(`/api/conversations/${cGroup.id}/messages`, { body: 'Hi all', replyToEntryId: cMsgs[0].id });
    expect(r.body.message.to.map((m: any) => m.address).sort()).toEqual([addrA, addrB].sort());
    expect((await A.get(`/api/conversations/${aGroup.id}/messages`)).body.items).toHaveLength(2);
    expect((await B.get(`/api/conversations/${bGroup.id}/messages`)).body.items).toHaveLength(2);

    // A new email to B alone goes to the original one-to-one chat.
    await A.post('/api/messages', { to: [addrB], subject: 'Private', body: 'Just you' });
    const oneToOne = await convWith(B, [addrA]);
    expect(oneToOne.lastMessage.subject).toBe('Private');
    expect((await B.get(`/api/conversations/${bGroup.id}/messages`)).body.items).toHaveLength(2);
  });

  it('opens a chat by phone number and supports favorites and search', async () => {
    const opened = await C.post('/api/conversations/open', { target: '+91 90000 00020' });
    expect(opened.status).toBe(200);
    expect(opened.body.participants[0].address).toBe(addrB);
    // Empty chats are not listed until something is sent.
    expect(await convWith(C, [addrB])).toBeUndefined();
    await C.post(`/api/conversations/${opened.body.id}/messages`, { subject: 'Quick q', body: 'Lunch?' });
    expect((await convWith(C, [addrB])).id).toBe(opened.body.id);

    const unknown = await C.post('/api/conversations/open', { target: '9999999999' });
    expect(unknown.status).toBe(422);

    await C.patch(`/api/conversations/${opened.body.id}`, { isFavorite: true });
    const favs = (await C.get('/api/conversations?filter=favorites')).body.items;
    expect(favs.map((c: any) => c.id)).toEqual([opened.body.id]);

    expect((await C.get('/api/conversations?q=lunch')).body.items.map((c: any) => c.id)).toEqual([opened.body.id]);
    expect((await C.get('/api/conversations?q=Bala')).body.items.map((c: any) => c.id)).toContain(opened.body.id);
    expect((await C.get('/api/conversations?q=00000020')).body.items.map((c: any) => c.id)).toContain(opened.body.id);
  });

  it('keeps aliases in the same chat as the primary address', async () => {
    await B.post('/api/me/aliases', { alias: 'bala' });
    await C.post('/api/messages', { to: ['bala@phonemail.com'], subject: 'Via alias', body: 'hi' });
    const bConv = await convWith(B, [addrC]);
    expect(bConv.lastMessage.subject).toBe('Via alias');
    const cConvs = (await C.get('/api/conversations')).body.items.filter((c: any) => !c.isGroup);
    expect(cConvs).toHaveLength(1);
    expect(cConvs[0].participants[0].address).toBe(addrB);

    // Sending from an alias is allowed; someone else's address is not.
    const fromAlias = await B.post('/api/messages', { to: [addrC], subject: 'From alias', body: 'x', fromAddress: 'bala@phonemail.com' });
    expect(fromAlias.body.message.from.address).toBe('bala@phonemail.com');
    expect((await B.post('/api/messages', { to: [addrC], body: 'x', fromAddress: addrA })).status).toBe(422);
    expect((await convWith(C, [addrB])).lastMessage.subject).toBe('From alias');
  });

  it('supports messages to yourself', async () => {
    const res = await C.post('/api/messages', { to: [addrC], subject: 'Note to self', body: 'milk' });
    expect(res.status).toBe(200);
    const self = (await C.get('/api/conversations')).body.items.find((c: any) => c.isSelf);
    expect(self.lastMessage.subject).toBe('Note to self');
  });

  it('validates recipients', async () => {
    expect((await A.post('/api/messages', { to: ['nobody@phonemail.com'], body: 'x' })).body.error.code).toBe('unknown_recipient');
    expect((await A.post('/api/messages', { to: ['someone@gmail.com'], body: 'x' })).body.error.code).toBe('external_disabled');
    expect((await A.post('/api/messages', { to: ['not an address'], body: 'x' })).body.error.code).toBe('invalid_recipient');
    expect((await A.post('/api/messages', { to: [], body: 'x' })).body.error.code).toBe('no_recipients');
    expect((await A.post('/api/messages', { to: [addrB] })).body.error.code).toBe('empty_message');
  });
});

describe('attachments', () => {
  it('uploads, sends, filters and downloads attachments', async () => {
    const form = new FormData();
    form.append('file', Buffer.from('hello attachment'), { filename: 'notes.txt', contentType: 'text/plain' });
    const up = await h.app.inject({
      method: 'POST',
      url: '/api/attachments',
      payload: form,
      headers: { ...form.getHeaders(), authorization: `Bearer ${(await login(h, '9000000010')).token}` },
    });
    expect(up.statusCode).toBe(200);
    const att = up.json();
    expect(att).toMatchObject({ filename: 'notes.txt', contentType: 'text/plain', size: 16 });

    const sent = await A.post('/api/messages', { to: [addrC], subject: 'File', body: 'see attached', attachmentIds: [att.id] });
    expect(sent.status).toBe(200);
    expect(sent.body.message.attachments).toHaveLength(1);

    // An attachment cannot be sent twice.
    expect((await A.post('/api/messages', { to: [addrC], body: 'again', attachmentIds: [att.id] })).body.error.code).toBe('invalid_attachment');

    const withFiles = (await C.get('/api/conversations?filter=attachments')).body.items;
    expect(withFiles).toHaveLength(1);
    const cMsgs = (await C.get(`/api/conversations/${withFiles[0].id}/messages`)).body.items;
    const url = cMsgs.find((m: any) => m.hasAttachments).attachments[0].url as string;
    const dl = await h.app.inject({ method: 'GET', url });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('hello attachment');
    expect(dl.headers['content-disposition']).toContain('attachment');

    // Tampered signature is rejected when not signed in.
    const bad = await h.app.inject({ method: 'GET', url: url.replace(/s=[0-9a-f]{4}/, 's=0000') });
    expect(bad.statusCode).toBe(404);
    // B has no copy of that email.
    const bToken = (await login(h, '9000000020')).token!;
    const denied = await h.app.inject({ method: 'GET', url: `/api/attachments/${att.id}/download`, headers: { authorization: `Bearer ${bToken}` } });
    expect(denied.statusCode).toBe(404);
  });
});

describe('folders, drafts, spam and trash', () => {
  it('lists web folders with counts and supports trash/restore', async () => {
    const inbox = await C.get('/api/messages?folder=inbox');
    expect(inbox.body.total).toBeGreaterThan(0);
    const id = inbox.body.items[0].id;
    await C.post(`/api/messages/${id}/move`, { to: 'trash' });
    expect((await C.get('/api/messages?folder=trash')).body.items.map((m: any) => m.id)).toContain(id);
    await C.post('/api/messages/batch', { ids: [id], action: 'restore' });
    expect((await C.get('/api/messages?folder=inbox')).body.items.map((m: any) => m.id)).toContain(id);

    await C.patch(`/api/messages/${id}`, { isStarred: true });
    expect((await C.get('/api/messages?folder=starred')).body.items.map((m: any) => m.id)).toEqual([id]);
    const counts = await C.get('/api/messages/counts');
    expect(counts.body.starred).toBe(1);
  });

  it('report spam blocks future mail from the sender; not-spam restores it', async () => {
    const D = api(h, (await login(h, '9000000040')).token!);
    await D.post('/api/messages', { to: [addrC], subject: 'Buy now', body: 'spam' });
    const conv = await convWith(C, ['9000000040@phonemail.com']);
    await C.post(`/api/conversations/${conv.id}/spam`);
    expect(await convWith(C, ['9000000040@phonemail.com'])).toBeUndefined();

    await D.post('/api/messages', { to: [addrC], subject: 'Buy again', body: 'spam' });
    const spam = (await C.get('/api/messages?folder=spam')).body.items;
    expect(spam.map((m: any) => m.subject).sort()).toEqual(['Buy again', 'Buy now']);
    expect(await convWith(C, ['9000000040@phonemail.com'])).toBeUndefined();

    await C.post('/api/messages/batch', { ids: [spam[0].id], action: 'not_spam' });
    await D.post('/api/messages', { to: [addrC], subject: 'Legit', body: 'hello' });
    const back = await convWith(C, ['9000000040@phonemail.com']);
    expect(back.lastMessage.subject).toBe('Legit');

    const deleted = await C.post(`/api/folders/spam/empty`);
    expect(deleted.body.deleted).toBe(1);
  });

  it('saves chat drafts and compose drafts', async () => {
    const conv = await convWith(A, [addrB]);
    await A.put(`/api/conversations/${conv.id}/draft`, { body: 'half written' });
    expect((await A.get(`/api/conversations/${conv.id}/draft`)).body.draft.body).toBe('half written');
    const listed = await convWith(A, [addrB]);
    expect(listed.draft.body).toBe('half written');
    // Sending in the chat clears its draft.
    await A.post(`/api/conversations/${conv.id}/messages`, { subject: 'done', body: 'final' });
    expect((await A.get(`/api/conversations/${conv.id}/draft`)).body.draft).toBeNull();

    const d = await A.post('/api/drafts', { to: [addrB, addrC], subject: 'Plan', body: 'draft body' });
    expect(d.status).toBe(200);
    expect((await A.get('/api/drafts')).body.items.map((x: any) => x.id)).toContain(d.body.id);
    const upd = await A.put(`/api/drafts/${d.body.id}`, { to: [addrB], subject: 'Plan v2', body: 'draft body 2' });
    expect(upd.body.subject).toBe('Plan v2');
    const sent = await A.post('/api/messages', { to: [addrB], subject: 'Plan v2', body: 'draft body 2', draftId: d.body.id });
    expect(sent.status).toBe(200);
    expect((await A.get('/api/drafts')).body.items.map((x: any) => x.id)).not.toContain(d.body.id);
  });

  it('trashing a chat hides it and restoring brings it back', async () => {
    const conv = await convWith(A, [addrC]);
    const before = (await A.get(`/api/conversations/${conv.id}/messages`)).body.items.length;
    await A.del(`/api/conversations/${conv.id}`);
    expect(await convWith(A, [addrC])).toBeUndefined();
    const trash = (await A.get('/api/messages?folder=trash')).body.items.filter((m: any) => m.conversationId === conv.id);
    expect(trash).toHaveLength(before);
    await A.post('/api/messages/batch', { ids: trash.map((m: any) => m.id), action: 'restore' });
    expect((await A.get(`/api/conversations/${conv.id}/messages`)).body.items).toHaveLength(before);
  });
});
