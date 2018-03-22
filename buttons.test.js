const btoa = require('btoa');
const fetch = require('node-fetch');
const config = require('./config');
const buttons = require('./buttons');

jest.setTimeout(10000);

const buildData = (token, type, payload) => {
  if (!payload) {
    payload = {};
  }
  const data = {
    type,
    token,
    challenge: 'challenge', 
    body: btoa('payload=' + JSON.stringify(payload)),
  };
  return data;
};

const buildPayload = (token, teamId, userId, action, callback_id) => {
  const payload = {
    token,
    team: {
      id: teamId,
    },
    user: {
      id: userId || 'test',
    },
    original_message: {
      attachments: [
        {
          title_link: 'Test',
          actions: [
            {},
            {},
          ],
        },
      ],
    },
    actions: [action],
    message_ts: new Date().getTime().toString(),
    callback_id: JSON.stringify(callback_id)
  };
  return payload;
};

const sleep = (s) => {
  return new Promise(resolve => setTimeout(resolve, s * 1000));
};

const buildRandomString = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const callCheckApi = async (path, params) => {
  let querystring = [];
  for (let key in params) {
    querystring.push(key + '=' + params[key]);
  }
  if (querystring.length > 0) {
    querystring = '?' + querystring.join('&');
  }
  else {
    querystring = '';
  }
  let url = config.checkApi.url + '/test/' + path + querystring;
  const res = await fetch(url);
  const json = await res.json();
  return json;
};

const sendAction = async (action, callback_id) => {
  let uuid = buildRandomString();
  const payload = buildPayload('123456abcdef', 'T12345ABC', uuid, action, callback_id);
  const data = buildData('123456abcdef', 'process', payload);
  const callback = jest.fn();

  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  let token = buildRandomString();
  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await callCheckApi('user', { provider: 'slack', uuid, token, is_admin: true });

  buttons.handler(data, null, callback);
  await sleep(3);

  return { outputData, callback };
};

test('verify call if team is in config', () => {
  const data = buildData('123456abcdef', 'url_verification');
  const callback = jest.fn();
  buttons.handler(data, null, callback);
  expect(callback).toHaveBeenCalledWith(null, 'challenge'); 
});

test('does not verify call if team is not in config', () => {
  const data = buildData('notinconfig', 'url_verification');
  const callback = jest.fn();
  buttons.handler(data, null, callback);
  expect(callback).toHaveBeenCalledWith('Verification failed');
});

test('does not process call if verification token is not valid', () => {
  const payload = buildPayload('invalid', 'T12345ABC');
  const data = buildData('invalid', 'process', payload);
  const callback = jest.fn();
  buttons.handler(data, null, callback);
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('do not have the permission') }));
});

test('return error if Slack user cannot be identified', async () => {
  const payload = buildPayload('123456abcdef', 'T12345ABC', 'invalid');
  const data = buildData('123456abcdef', 'process', payload);
  const callback = jest.fn();

  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  buttons.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Error when trying to identify Slack user');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('do not have the permission') }));
});

test('identify Slack user and handle invalid action', async () => {
  const { outputData, callback } = await sendAction({ name: 'test' });
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Unknown action: test');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('do not have the permission') }));
});

test('identify Slack user and handle type_comment command', async () => {
  const { outputData, callback } = await sendAction({ name: 'type_comment' });
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('type your comment') }));
});

test('identify Slack user and handle type_title command', async () => {
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'type_title' }] });
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('type the new title') }));
});

test('identify Slack user and handle type_description command', async () => {
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'type_description' }] });
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('type the new description') }));
});

test('identify Slack user and handle change_status command', async () => {
  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,last_status_obj,last_status' });
  const st = await callCheckApi('get', { class: 'status', id: pm.data.last_status_obj.id, fields: 'graphql_id' });
  const callback_id = { last_status_id: st.data.graphql_id, team_slug: team.data.slug };

  expect(pm.data.last_status).toBe('undetermined');
  const { outputData, callback } = await sendAction({ name: 'change_status', selected_options: [{ value: 'verified' }] }, callback_id);
  expect(outputData).not.toMatch('Error');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ attachments: [expect.objectContaining({ title: expect.stringContaining('VERIFIED: Media Title') })] }));
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'last_status' });
  expect(pm.data.last_status).toBe('verified');
});

test('identify Slack user and handle add_comment command', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'add_comment' }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Saved Redis');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Type your comment') }));
});

test('identify Slack user and handle edit title command', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'title' }] }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Saved Redis');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Type the title below') }));
});

test('identify Slack user and handle edit description command', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'description' }] }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Saved Redis');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Type the description below') }));
});

test('identify Slack user and handle image_search command on report without image', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'image_search' }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('There are no images on this report') }));
});
