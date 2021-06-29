const btoa = require('btoa');
const atob = require('atob');
let aws = require('aws-sdk');
const awsMock = require('aws-sdk-mock');
const md5 = require('js-md5');
let config = require('./config');
const index = require('./index');
const {
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction,
  redisSet,
} = require('./test-helpers.js');

const { humanAppName } = require('./helpers');

jest.setTimeout(900000);

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

  const uid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  await callCheckApi('user', { provider: 'slack', uid, token, is_admin: true });
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id,last_status_obj' });

  const thread_ts = new Date().getTime();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const st = await callCheckApi('get', { class: 'dynamic', id: pm.data.last_status_obj.id, fields: 'graphql_id' });
  const value = JSON.stringify({ mode: 'edit_' + field, object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id, last_status_id: st.data.graphql_id, currentUser: uid, slackMessageData: { user: { id: uid }, callback_id: JSON.stringify({ id: buildRandomString() }), original_message: { attachments: [{ actions: [] }] } } });
  await redisSet(key, value);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: uid, text: `Changed ${field}` };
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
  expect(outputData).toMatch('Analysis updated successfully');

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

  const uid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  await callCheckApi('user', { provider: 'slack', uid, token, is_admin: true });
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id' });

  const thread_ts = new Date().getTime();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode: 'comment', object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id, currentUser: uid, slackMessageData: { user: { id: uid }, callback_id: JSON.stringify({ id: buildRandomString() }), original_message: { attachments: [{ actions: [] }] } } });
  await redisSet(key, value);
  await sleep(3);

  const event = { channel: 'test', thread_ts, user: uid, text: 'Test' };
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

test('parse Slack message with Check URL', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', text: `There is a Check URL here http://localhost:3333/${team.data.slug}/project/${project.data.dbid}/media/${pm.data.id} can you see?` };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Slack response status code: 200');
  expect(outputData).toMatch('GraphQL query response');
  expect(callback).toHaveBeenCalledWith(null);
});

test('parse Slack message with Check URL without project', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', text: `There is a Check URL here http://localhost:3333/${team.data.slug}/media/${pm.data.id} can you see?` };
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

  const event = { channel: 'test', text: 'There is a Check URL here http://localhost:3333/invalid/project/321/media/132 can you see?' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch("RecordNotFound");
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
  const event = { ts: '123456', bot_id: 'abc', channel: 'test', text: '', attachments: [{ fallback: 'http://localhost:3333/invalid/project/321/media/132', callback_id }] };
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

test('parse Slack message with Check URL posted by slash bot', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  const url = 'https://ca.ios.ba/'
  let pm = await callCheckApi('link', { url: url, team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', bot_id: config.bot_id, text: `URL successfully added to ${humanAppName()}: <http://localhost:3333/${team.data.slug}/project/${project.data.dbid}/media/${pm.data.id}>` };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Slack response status code: 200');
  expect(outputData).toMatch('GraphQL query response');
  expect(callback).toHaveBeenCalledWith(null);
});

test('parse Slack message with Check URL posted as a Check notification', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  const url = 'https://ca.ios.ba/'
  let pm = await callCheckApi('link', { url: url, team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', bot_id: config.bot_id, text: '', attachments: [{ fallback: 'Fallback', id: 1, pretext: `<http://localhost:3333/${team.data.slug}/project/${project.data.dbid}/media/${pm.data.id}|A new URL was added>`}] }
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Slack response status code: 200');
  expect(outputData).toMatch('GraphQL query response');
  expect(outputData).toMatch('Display card for Check notification');
  expect(callback).toHaveBeenCalledWith(null);
});

test('ignore Slack message with Check URL and `|` posted by bot', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { is_admin: true });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  const url = 'https://ca.ios.ba/'
  let pm = await callCheckApi('link', { url: url, team_id: team.data.dbid, project_id: project.data.dbid });

  const event = { channel: 'test', bot_id: 'abc', text: `*John* answered task <http://localhost:3333/${team.data.slug}/project/${project.data.dbid}/media/${pm.data.id}|Agree?> in *Doe Project*: \n&gt;No\n` };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toBe('');
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

  const uid = '654321';
  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,graphql_id' });

  const thread_ts = buildRandomString();
  const key = 'slack_message_ts:' + config.redisPrefix + ':' + thread_ts;
  const value = JSON.stringify({ mode, object_type: 'project_media', object_id: pm.data.id, link: '', team_slug: team.data.slug, graphql_id: pm.data.graphql_id, currentUser: uid, slackMessageData: { user: { id: uid }, callback_id: JSON.stringify({ id: buildRandomString() }), original_message: { attachments: [{ actions: [] }] } } });
  await redisSet(key, value);
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

test('cannot identify Slack user in edit_title mode', async () => {
  await buttonAction('edit_title');
});

test('cannot identify Slack user in edit_description mode', async () => {
  await buttonAction('edit_description');
});

test('cannot identify Slack user in unknown mode', async () => {
  await buttonAction('unknown');
});

test('call Lambda function when image is uploaded to Smooch conversation', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);
  const event = { type: 'message', subtype: 'file_share', text: '/sk Sending image' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  awsMock.mock('Lambda', 'invoke', function({}) { console.log('AWS Mocked Method'); });
  index.handler(data, null, callback);
  await sleep(3);

  expect(outputData).toMatch('AWS Mocked Method');
  expect(callback).toHaveBeenCalledWith(null);
});

test('call Lambda function locally when image is uploaded to Smooch conversation', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const functionName = config.slashResponseFunctionName;
  config.slashResponseFunctionName = false;
  const awsRegion = config.awsRegion;
  config.awsRegion = 'local';

  const event = { type: 'message', subtype: 'file_share', text: '/sk Sending image', files: [{ url_private: 'https://picsum.photos/id/237/200/300' }] };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Calling local function');
  expect(callback).toHaveBeenCalledWith(null);
  config.slashResponseFunctionName = functionName;
  config.awsRegion = awsRegion;
});

test('move Smooch conversation to "human mode" in Smooch conversation', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  const annotation = await callCheckApi('dynamic_annotation', { annotated_type: 'Project', annotated_id: project.data.dbid, annotation_type: 'smooch_user', fields: 'id,app_id,data', types: 'text,text,json', values: 'test,test,' + JSON.stringify({ identifier: '123', app_name: 'Test' }) });
  const key = 'slack_channel_smooch:' + config.redisPrefix + ':test';
  const value = JSON.stringify({ mode: 'bot', annotation_id: annotation.data.graphql_id });
  await redisSet(key, value);
  await sleep(3);

  const event = { bot_id: 'ABCDEFGH', text: 'Test', username: 'Test replied', channel: 'test' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Bot was deactivated because a message was sent');
  expect(callback).toHaveBeenCalledWith(null);
});

test('move Smooch conversation to "bot mode" in Smooch conversation', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  const annotation = await callCheckApi('dynamic_annotation', { annotated_type: 'Project', annotated_id: project.data.dbid, annotation_type: 'smooch_user', fields: 'id,app_id,data', types: 'text,text,json', values: 'test,test,' + JSON.stringify({ identifier: '123', app_name: 'Test' }) });
  const key = 'slack_channel_smooch:' + config.redisPrefix + ':test';
  const value = JSON.stringify({ mode: 'human', annotation_id: annotation.data.graphql_id });
  await redisSet(key, value);
  await sleep(3);

  const event = { type: 'channel_archive', channel: 'test' };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Bot was reactivated because channel was archived');
  expect(callback).toHaveBeenCalledWith(null);

  index.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Already in bot mode');
  expect(callback).toHaveBeenCalledWith(null);
});

test('get annotation related to Smooch conversation', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  outputData = ''
  const identifier = new Date().getTime().toString();
  const event = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: WhatsApp Messenger | Phone Number: ' + identifier }] }] };
  const data = buildData('123456abcdef', 'event_callback', event);
  const callback = jest.fn();
  index.handler(data, null, callback);
  await sleep(600);

  expect(callback).toHaveBeenCalledWith(null);
  expect(outputData).toMatch('Could not get an annotation from Check related to the user');

  outputData = ''
  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });

  const annotation = await callCheckApi('dynamic_annotation', { annotated_type: 'Project', annotated_id: project.data.dbid, annotation_type: 'smooch_user', fields: 'id,app_id,data', types: 'text,text,json', values: 'test,test,' + JSON.stringify({ identifier: md5(identifier), app_name: 'Test' }) });
  const id = atob(annotation.data.graphql_id).split('/')[1];
  const annotation2 = await callCheckApi('get', { class: 'dynamic', id: parseInt(id, 10), fields: 'get_fields' });
  let value = '';
  annotation2.data.get_fields.forEach((field) => {
    if (field.field_name == 'smooch_user_data') {
      value = field.id;
    }
  });

  const key = 'dynamic-annotation-field-' + md5(JSON.stringify({ field_name: 'smooch_user_data', json: { app_name: 'Test', identifier: md5(identifier) } }));
  await callCheckApi('cache_key', { key, value });

  index.handler(data, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event2 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'Foo', value: 'Bar' }] }] };
  const data2 = buildData('123456abcdef', 'event_callback', event2);
  index.handler(data2, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Could not find application name and identifier');
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event3 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: WhatsApp Messenger | Phone Number: \u003ctel:' + identifier + '|' + identifier + '\u003e' }] }] };
  const data3 = buildData('123456abcdef', 'event_callback', event3);
  index.handler(data3, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event4 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: WhatsApp Messenger | Phone Number: <tel:' + identifier + '|' + identifier + '>' }] }] };
  const data4 = buildData('123456abcdef', 'event_callback', event4);
  index.handler(data4, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event5 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: Facebook Messenger | Profile Image: https://facebook.com/psid=' + identifier }] }] };
  const data5 = buildData('123456abcdef', 'event_callback', event5);
  index.handler(data5, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event6 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: Twitter DM | Profile Image: https://twitter.com/profile_images/' + identifier + '/image.png' }] }] };
  const data6 = buildData('123456abcdef', 'event_callback', event6);
  index.handler(data6, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event7 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: Other' }] }] };
  const data7 = buildData('123456abcdef', 'event_callback', event7);
  index.handler(data7, null, callback);
  await sleep(3);

  outputData = ''
  const event8 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: Telegram Messenger' }] }] };
  const data8 = buildData('123456abcdef', 'event_callback', event8);
  index.handler(data8, null, callback);
  await sleep(3);

  outputData = ''
  const event9 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: Viber Messenger | Profile Photo: https://media-direct.cdn.viber.com/download_photo?dlid=' + identifier + '&fltp=jpg&imsz=0000' }] }] };
  const data9 = buildData('123456abcdef', 'event_callback', event9);
  index.handler(data9, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);

  outputData = ''
  const event10 = { channel: 'test', bot_id: 'ABCDEFGH', attachments: [{ fields: [{ title: 'App', value: 'Test' }, { title: 'Device Info', value: 'Device: LINE Messenger | Profile Photo: https://sprofile.line-scdn.net/' + identifier }] }] };
  const data10 = buildData('123456abcdef', 'event_callback', event10);
  index.handler(data10, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Associated with annotation ' + id);
  expect(callback).toHaveBeenCalledWith(null);
});

test('avoid parsing the same Slack event more than once', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const event = { body: 'Test', headers: { 'X-Slack-Retry-Num': 2, 'X-Slack-Retry-Reason': 'http_timeout' } };
  const callback = jest.fn();
  index.handler(event, null, callback);
  await sleep(3);

  expect(outputData).toMatch('Ignoring duplicated event');
  expect(callback).toHaveBeenCalledWith(null);
});
