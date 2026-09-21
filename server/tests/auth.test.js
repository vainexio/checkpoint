import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';

import {
  ACCOUNT_LIMIT,
  ADDRESS_LIMIT,
  checkAttempt,
  recordFailure,
  recordSuccess,
  resetLoginThrottle,
} from '../services/loginThrottle.js';

process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';

/* --------------------------------------------------------- the throttle, pure -- */

test('an account is held after repeated failures, and only for a while', () => {
  resetLoginThrottle();
  const who = { account: 'rey', address: '10.0.0.1' };
  const t = 1_000_000;

  for (let i = 0; i < ACCOUNT_LIMIT - 1; i += 1) recordFailure(who, t);
  assert.equal(checkAttempt(who, t).allowed, true, 'a few mistakes are not held against anyone');

  recordFailure(who, t);
  const held = checkAttempt(who, t);
  assert.equal(held.allowed, false);
  assert.equal(held.retryAfterSeconds, 15 * 60);

  assert.equal(checkAttempt(who, t + 15 * 60 * 1000 + 1).allowed, true);
});

test('a correct password clears the account count', () => {
  resetLoginThrottle();
  const who = { account: 'rey', address: '10.0.0.2' };
  for (let i = 0; i < ACCOUNT_LIMIT - 1; i += 1) recordFailure(who, 1);
  recordSuccess(who);
  recordFailure(who, 2);
  assert.equal(checkAttempt(who, 2).allowed, true);
});

test('one address trying many accounts is held too', () => {
  resetLoginThrottle();
  for (let i = 0; i < ADDRESS_LIMIT; i += 1) {
    recordFailure({ account: `guess-${i}`, address: '10.9.9.9' }, 5);
  }
  assert.equal(checkAttempt({ account: 'someone-new', address: '10.9.9.9' }, 5).allowed, false);
  assert.equal(checkAttempt({ account: 'someone-new', address: '10.1.1.1' }, 5).allowed, true);
});

/* ------------------------------------------------------------ through the API -- */

let mongod;
let app;
let User;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const { createApp } = await import('../app.js');
  ({ User } = await import('../models/index.js'));
  app = createApp();
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

let adminToken;
let reyId;
const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  resetLoginThrottle();
  await User.deleteMany({});
  await User.create({
    name: 'Ops Admin',
    username: 'admin',
    role: 'admin',
    passwordHash: await User.hashPassword('checkpoint123'),
  });
  adminToken = (
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'checkpoint123' })
  ).body.token;

  const created = await asAdmin(request(app).post('/api/admin/conductors'))
    .send({ name: 'Rey Santiago', username: 'rey', password: 'temporary1' })
    .expect(201);
  reyId = created.body._id;
});

const login = (username, password) =>
  request(app).post('/api/auth/login').send({ username, password });

test('sign-in is refused after repeated wrong passwords, even with the right one', async () => {
  for (let i = 0; i < ACCOUNT_LIMIT; i += 1) await login('rey', 'wrong-guess').expect(401);

  const held = await login('rey', 'temporary1').expect(429);
  assert.match(held.body.error, /Too many attempts\. Try again in 15 minutes/);
  assert.equal(held.headers['retry-after'], String(15 * 60));

  // Someone else's account is not affected by it.
  await login('admin', 'checkpoint123').expect(200);
});

test('guessing usernames counts too, and still never says which exist', async () => {
  const res = await login('nobody-here', 'whatever').expect(401);
  assert.equal(res.body.error, 'Incorrect username or password.');
});

test('an admin-created account must choose its own password before anything else', async () => {
  const first = await login('rey', 'temporary1').expect(200);
  assert.equal(first.body.user.mustChangePassword, true);
  const temp = first.body.token;

  // Nothing in the product opens with the temporary password...
  const blocked = await request(app).get('/api/conductor/trips').set(bearer(temp)).expect(403);
  assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
  // ...but the session is real, and the change form is reachable.
  await request(app).get('/api/auth/me').set(bearer(temp)).expect(200);

  const changed = await request(app)
    .post('/api/auth/password')
    .set(bearer(temp))
    .send({ currentPassword: 'temporary1', newPassword: 'my-own-secret' })
    .expect(200);
  assert.equal(changed.body.user.mustChangePassword, false);

  await request(app).get('/api/conductor/trips').set(bearer(changed.body.token)).expect(200);
  // The session that knew the temporary password is over.
  await request(app).get('/api/auth/me').set(bearer(temp)).expect(401);

  await login('rey', 'temporary1').expect(401);
  await login('rey', 'my-own-secret').expect(200);
});

test('changing a password needs the current one, and a new one worth having', async () => {
  const token = (await login('rey', 'temporary1')).body.token;
  const change = (body) => request(app).post('/api/auth/password').set(bearer(token)).send(body);

  await change({ currentPassword: 'not-it', newPassword: 'my-own-secret' }).expect(400);
  await change({ currentPassword: 'temporary1', newPassword: 'short' }).expect(400);
  await change({ currentPassword: 'temporary1', newPassword: 'temporary1' }).expect(400);
  await change({ currentPassword: 'temporary1', newPassword: 'REY' + 'rey'.slice(3) }).expect(400);
});

test('a conductor locked out can get back in with a one-time code', async () => {
  // Rey has a password of their own and a session on some phone.
  const temp = (await login('rey', 'temporary1')).body.token;
  const own = (
    await request(app)
      .post('/api/auth/password')
      .set(bearer(temp))
      .send({ currentPassword: 'temporary1', newPassword: 'forgotten-one' })
  ).body.token;

  const issued = await asAdmin(request(app).post(`/api/admin/users/${reyId}/reset-code`)).expect(201);
  assert.match(issued.body.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(issued.body.validMinutes, 30);

  // Typed loosely, the way someone reads a code off a phone call.
  const code = issued.body.code.toLowerCase().replace('-', ' ');
  const reset = await request(app)
    .post('/api/auth/reset')
    .send({ username: 'Rey', code, newPassword: 'brand-new-one' })
    .expect(200);
  assert.equal(reset.body.user.username, 'rey');
  assert.equal(reset.body.user.mustChangePassword, false);

  // Single use.
  await request(app)
    .post('/api/auth/reset')
    .send({ username: 'rey', code: issued.body.code, newPassword: 'another-one-1' })
    .expect(400);

  // The old session and the old password are both finished.
  await request(app).get('/api/auth/me').set(bearer(own)).expect(401);
  await login('rey', 'forgotten-one').expect(401);
  await login('rey', 'brand-new-one').expect(200);
});

test('an expired code is refused', async () => {
  const issued = await asAdmin(request(app).post(`/api/admin/users/${reyId}/reset-code`)).expect(201);
  await User.updateOne({ _id: reyId }, { resetCodeExpiresAt: new Date(Date.now() - 1000) });

  await request(app)
    .post('/api/auth/reset')
    .send({ username: 'rey', code: issued.body.code, newPassword: 'brand-new-one' })
    .expect(400);
});

test('guessing reset codes is throttled like guessing passwords', async () => {
  await asAdmin(request(app).post(`/api/admin/users/${reyId}/reset-code`)).expect(201);
  for (let i = 0; i < ACCOUNT_LIMIT; i += 1) {
    await request(app)
      .post('/api/auth/reset')
      .send({ username: 'rey', code: 'AAAA-AAAA', newPassword: 'brand-new-one' })
      .expect(400);
  }
  await request(app)
    .post('/api/auth/reset')
    .send({ username: 'rey', code: 'AAAA-AAAA', newPassword: 'brand-new-one' })
    .expect(429);
});

test('only an admin can issue a reset code, and the code never appears in account lists', async () => {
  await User.updateOne({ _id: reyId }, { mustChangePassword: false });
  const rey = (await login('rey', 'temporary1')).body.token;
  await request(app).post(`/api/admin/users/${reyId}/reset-code`).set(bearer(rey)).expect(403);

  await asAdmin(request(app).post(`/api/admin/users/${reyId}/reset-code`)).expect(201);
  const list = await asAdmin(request(app).get('/api/admin/conductors')).expect(200);
  assert.equal(list.body[0].resetCodeHash, undefined);
  assert.equal(list.body[0].passwordHash, undefined);
});

test('an admin resetting a password makes it temporary and ends old sessions', async () => {
  await User.updateOne({ _id: reyId }, { mustChangePassword: false });
  const before = (await login('rey', 'temporary1')).body.token;

  await asAdmin(request(app).put(`/api/admin/conductors/${reyId}`))
    .send({ password: 'set-by-admin' })
    .expect(200);

  await request(app).get('/api/auth/me').set(bearer(before)).expect(401);
  const after = await login('rey', 'set-by-admin').expect(200);
  assert.equal(after.body.user.mustChangePassword, true);
});
