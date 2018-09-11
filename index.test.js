const { exec } = require('child_process');
const btoa = require('btoa');
let config = require('./config');
const index = require('./index');
const {
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction
} = require('./test-helpers.js');

const { humanAppName } = require('./helpers');

jest.setTimeout(120000);

const buildData = (token, type, event) => {
  const data = {
    type,
    token,
    team_id: 'T12345ABC',
    challenge: 'challenge',
    event
  };
  return data;
};

test('verify call if team is in config', () => {
  const data = buildData('123456abcdef', 'url_verification');
  const callback = jest.fn();
  index.handler(data, null, callback);
  expect(callback).toHaveBeenCalledWith(null, 'challenge');
});

test('does not verify call if team is not in config', () => {
  const data = buildData('notinconfig', 'url_verification');
  const callback = jest.fn();
  index.handler(data, null, callback);
  expect(callback).toHaveBeenCalledWith('Verification failed');
});

test('default callback', () => {
  const callback = jest.fn();
  index.handler({ type: 'invalid' }, null, callback);
  expect(callback).toHaveBeenCalledWith(null);
});

const testEditMedia = async (field) => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await sleep(1);

  const uuid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  await callCheckApi('user', { provider: 'slack', uuid, token, is_admin: true });
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id' });

  const thread_ts = new Date().getTime();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode: 'edit_' + field, object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id });
  await exec(`redis-cli set ${key} '${value}'`);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: uuid, text: `Changed ${field}` };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,' + field });
  expect(pm.data[field]).not.toBe('Changed ' + field);

  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).not.toMatch('Error when trying to identify Slack user');

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,' + field });
  expect(pm.data[field]).toBe('Changed ' + field);
  expect(callback).toHaveBeenCalledWith(null);
  expect(outputData).toMatch('Response from Slack message update');

  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
};

test('identify Slack user and edit title', async () => {
  await testEditMedia('title');
});

test('identify Slack user and edit description', async () => {
  await testEditMedia('description');
});

test('identify Slack user and create comment', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await sleep(1);

  const uuid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  await callCheckApi('user', { provider: 'slack', uuid, token, is_admin: true });
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id' });

  const thread_ts = new Date().getTime();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode: 'comment', object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id });
  await exec(`redis-cli set ${key} '${value}'`);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: uuid, text: 'Test' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,annotations' });
  const n = pm.data.annotations.length

  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).not.toMatch('Error when trying to identify Slack user');

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'annotations' });
  expect(pm.data.annotations.length).toBeGreaterThan(n);
  expect(callback).toHaveBeenCalledWith(null);
});

test('identify Slack user and create translation', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await sleep(1);

  const uuid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  await callCheckApi('user', { provider: 'slack', uuid, token, is_admin: true });
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id' });

  const thread_ts = new Date().getTime();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode: 'add_translation_en', object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id });
  await exec(`redis-cli set ${key} '${value}'`);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: uuid, text: 'Test' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,annotations' });
  const n = pm.data.annotations.length

  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).not.toMatch('Error when trying to identify Slack user');

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'annotations' });
  expect(pm.data.annotations.length).toBeGreaterThan(n);
  expect(callback).toHaveBeenCalledWith(null);
});

test('identify Slack user and mark translation request as error', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await sleep(1);

  const uuid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  await callCheckApi('user', { provider: 'slack', uuid, token, is_admin: true });
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id,last_translation_status_obj' });

  const thread_ts = new Date().getTime();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode: 'translation_error', object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id, last_status_id: btoa('Dynamic/' + pm.data.last_translation_status_obj.id) });
  await exec(`redis-cli set ${key} '${value}'`);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: uuid, text: 'Test' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,last_translation_status' });
  expect(pm.data.last_translation_status).toBe('pending');

  index.handler(data, null, callback);
  await sleep(10);
  expect(outputData).not.toMatch('Error when trying to identify Slack user');
  
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,last_translation_status' });
  expect(pm.data.last_translation_status).toBe('error');
  expect(callback).toHaveBeenCalledWith(null);
});

test('parse Slack message with Check URL', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', text: `There is a Check URL here http://localhost:13333/${team.data.slug}/project/${project.data.dbid}/media/${pm.data.id} can you see?` };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Slack response status code: 200');
  expect(outputData).toMatch('GraphQL query response');
  expect(callback).toHaveBeenCalledWith(null);
});

test('parse Slack message with Check URL that does not exist', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const event = { channel: 'test', text: 'There is a Check URL here http://localhost:13333/invalid/project/321/media/132 can you see?' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toBe('GraphQL query exception: Error: Invalid status code: 404');
  expect(callback).toHaveBeenCalledWith(null);
});

test('ignore Slack message without Check URL', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const event = { channel: 'test', text: 'No Check URL here' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toBe('');
  expect(callback).toHaveBeenCalledWith(null);
});

test('parse Slack message with bot message', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });

  const callback_id = JSON.stringify({ id: pm.data.id, team_slug: team.data.slug });
  const event = { ts: '123456', bot_id: 'abc', channel: 'test', text: '', attachments: [{ fallback: 'http://localhost:13333/invalid/project/321/media/132', callback_id }] };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,annotations' });
  const n = pm.data.annotations.length

  index.handler(data, null, callback);
  await sleep(3);

  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'annotations' });
  expect(pm.data.annotations.length).toBeGreaterThan(n);
  expect(callback).toHaveBeenCalledWith(null);
});

test('parse Slack message with Check URL posted by bot', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  const url = 'https://ca.ios.ba/'
  let pm = await callCheckApi('link', { url: url, team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', bot_id: 'abc', text: `URL successfully added to ${humanAppName()}: http://localhost:13333/${team.data.slug}/project/${project.data.dbid}/media/${pm.data.id}` };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Slack response status code: 200');
  expect(outputData).toMatch('GraphQL query response');
  expect(callback).toHaveBeenCalledWith(null);
});


test('cannot find Slack thread in Redis', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const event = { channel: 'test', thread_ts: '1234567' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toBe('Could not find Redis key slack_message_ts:1234567');
  expect(callback).toHaveBeenCalledWith(null);
});

const buttonAction = async (mode) => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id' });

  const thread_ts = buildRandomString();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode, object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id });
  await exec(`redis-cli set ${key} '${value}'`);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: '654321' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  if (mode !== 'unknown') {
    expect(outputData).toMatch('Error when trying to identify Slack user');
  }
  expect(callback).toHaveBeenCalledWith(null);
};

test('cannot identify Slack user in comment mode', async () => {
  await buttonAction('comment');
});

test('cannot identify Slack user in translation mode', async () => {
  await buttonAction('add_translation_en');
});

test('cannot identify Slack user in edit_title mode', async () => {
  await buttonAction('edit_title');
});

test('cannot identify Slack user in edit_description mode', async () => {
  await buttonAction('edit_description');
});

test('cannot identify Slack user in unknown mode', async () => {
  await buttonAction('unknown');
});
