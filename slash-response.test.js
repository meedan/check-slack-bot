const { exec } = require('child_process');
const btoa = require('btoa');
const fetch = require('node-fetch');
let config = require('./config');
const sr = require('./slash-response');

const {
  sleep,
  buildRandomString,
  callCheckApi,
} = require('./test-helpers');

jest.setTimeout(120000);

const createUser = async () => {
  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await sleep(1);

  const uid = buildRandomString();
  const token = buildRandomString();
  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { provider: 'slack', uid, token, is_admin: true });
  console.log(user);
  return user;
};

const projectData = async () => {
  const user = await createUser();
  email = user.data.email;
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  await callCheckApi('get', { class: 'project', id: project.data.dbid, fields: 'id,graphql_id' });
  const projectUrl = config.checkWeb.url + '/' + team.data.slug + '/project/' + project.data.dbid;

  const data = {
    project: project,
    team: team,
    projectUrl: projectUrl,
    user: user
  };
  return data;
};

const sendToRedis = async (response, channelId) => {
  const key = 'slack_channel_project:' + config.redisPrefix + ':' + channelId;
  const value = JSON.stringify({ team_slug: response.team.data.slug, project_id: response.project.data.dbid, project_title: response.project.data.title, project_url: response.projectUrl });
  await exec(`redis-cli set ${key} '${value}'`);
  await sleep(5);
};

test('verify if type is valid on call', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const data = { type: "invalidType", body: { text: 'invalid input', team_id: 'T12345ABC', responseUrl: 'https://hooks.slack.com/', command: '/check'}};
  const callback = jest.fn();

  sr.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('Response from Slack');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Need some help with `/check`?') }));
});

test('call add url if type is createProjectMedia', () => {
  const url = 'https://ca.ios.ba/'
  const data = { type: "createProjectMedia", body: { team_id: 'T12345ABC', responseUrl: 'https://hooks.slack.com/'}, matches: ['', url, '1']};
  const callback = jest.fn();
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  sr.handler(data, null, callback);
  expect(outputData).toMatch('Add URL to Check: ' + url);
});

test('call set project if type is setProject', () => {
  const projectUrl = config.checkWeb.url + '/my-team/project/1';
  const data = { type: "setProject", body: { team_id: 'T02528QUL', responseUrl: 'https://hooks.slack.com/'}, matches: [projectUrl, 'my-team', '1']};
  const callback = jest.fn();
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  sr.handler(data, null, callback);
  expect(outputData).toMatch('Set project: ' + projectUrl);
});

test('return error message if cannot find project and type is setProject', async () => {
  const projectUrl = config.checkWeb.url + '/my-team/project/1';
  const user = await createUser();
  const data = { type: "setProject", body: { team_id: 'T12345ABC', responseUrl: 'https://hooks.slack.com/'}, matches: [projectUrl, 'my-team', '1'], user_token: user.data.token};
  const callback = jest.fn();

  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  sr.handler(data, null, callback);
  await sleep(3);
  expect(outputData).toMatch('GraphQL query exception: Error: Invalid status code: 404');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining("can't find project") }));
});

test('return save to redis and reply to slack when input is valid and type is setProject', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const response = await projectData();
  const data = { type: "setProject", body: { team_id: 'T02528QUL', responseUrl: 'https://hooks.slack.com/', channel_id: 'the-channel'}, matches: [response.projectUrl, response.team.data.slug, response.project.data.dbid], user_token: response.user.data.token};
  const callback = jest.fn();

	sr.handler(data, null, callback);
  await sleep(2);

  expect(outputData).toMatch('GraphQL query response');
  expect(outputData).toMatch('Saved on Redis key');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Project set') }));
});

test('return error message when try to add a url and channel project is not defined', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const response = await projectData();
  const url = 'https://ca.ios.ba/'
  const data = { type: "createProjectMedia", body: { team_id: 'T12345ABC', responseUrl: 'https://hooks.slack.com/'}, matches: ['', url, response.project.data.dbid], user_token: response.user.data.token};

  const callback = jest.fn();

  sr.handler(data, null, callback);
  await sleep(2);

  expect(outputData).toMatch('Could not find Redis key');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Default project not defined') }));
});

test('successfully add url', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const response = await projectData();
  await sendToRedis(response, response.project.data.title);

  const url = 'https://ca.ios.ba/'
  const data = { type: "createProjectMedia", body: { team_id: 'T02528QUL', responseUrl: 'https://hooks.slack.com/', channel_id: response.project.data.title}, matches: ['', url, response.project.data.dbid], user_token: response.user.data.token};
  const callback = jest.fn();

  sr.handler(data, null, callback);
  await sleep(8);

  expect(outputData).toMatch('Add URL to Check: ' + url);
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('URL successfully added to Check') }));
});

test('return error message if duplicated url and its url', async () => {
  const response = await projectData();
  await sendToRedis(response, response.project.data.title);

  const url = 'https://ca.ios.ba/'

  let pm = await callCheckApi('link', { url: url, team_id: response.team.data.dbid, project_id: response.project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'oembed_metadata' });

  const data = { type: "createProjectMedia", body: { team_id: 'T02528QUL', responseUrl: 'https://hooks.slack.com/', channel_id: response.project.data.title}, matches: ['', url, response.project.data.dbid], user_token: response.user.data.token};
  const callback = jest.fn();

  sr.handler(data, null, callback);
  await sleep(8);

  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining("Sorry, can't add the URL") }));
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ attachments: expect.arrayContaining([expect.objectContaining({text: 'This media already exists: ' + JSON.parse(pm.data.oembed_metadata).permalink})])}));
});

test('return error message if project is archived', async () => {
  const response = await projectData();
  await sendToRedis(response, response.project.data.title);

  const url = 'https://ca.ios.ba/'

  const pm = await callCheckApi('link', { url: url, team_id: response.team.data.dbid, project_id: response.project.data.dbid });
  await callCheckApi('archive_project', { project_id: pm.data.project_id });

  const data = { type: "createProjectMedia", body: { team_id: 'T02528QUL', responseUrl: 'https://hooks.slack.com/', channel_id: response.project.data.title}, matches: ['', 'https://meedan.com/en', response.project.data.dbid], user_token: response.user.data.token};
  const callback = jest.fn();

	sr.handler(data, null, callback);
  await sleep(8);

  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining("Sorry, can't add the URL") }));
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ attachments: expect.arrayContaining([expect.objectContaining({text: expect.stringContaining('Validation failed')})])}));
});

test('return error message when try to show project but not defined on channel', async () => {
  const user = await createUser();
  const data = { type: "showProject", body: { team_id: 'T12345ABC', responseUrl: 'https://hooks.slack.com/'}, user_token: user.data.token};

  const callback = jest.fn();

  sr.handler(data, null, callback);
  await sleep(4);

  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Default project not defined') }));
});

test('show project set to channel', async () => {
  const response = await projectData();
  await sendToRedis(response, response.project.data.title);

  const data = { type: "showProject", body: { team_id: 'T12345ABC', responseUrl: 'https://hooks.slack.com/', channel_id: response.project.data.title}, user_token: response.user.data.token};

  const callback = jest.fn();

  sr.handler(data, null, callback);
  await sleep(4);

  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Project set to channel: ' + response.projectUrl) }));
});
