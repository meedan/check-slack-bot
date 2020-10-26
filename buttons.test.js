const btoa = require('btoa');
const fetch = require('node-fetch');
let aws = require('aws-sdk');
const awsMock = require('aws-sdk-mock');
let config = require('./config');
const buttons = require('./buttons');

const {
  buildData,
  buildPayload,
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction
} = require('./test-helpers');

jest.setTimeout(120000);

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
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('type your note') }));
});

test('identify Slack user and handle type_title command', async () => {
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'type_title' }] });
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('type the new analysis title') }));
});

test('identify Slack user and handle type_description command', async () => {
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'type_description' }] });
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('type the new analysis content') }));
});

test('identify Slack user and handle change_status command', async () => {
  const email = buildRandomString() + '@test.com';
  const user = await callCheckApi('user', { email });
  const team = await callCheckApi('team', { email });
  const project = await callCheckApi('project', { team_id: team.data.dbid });
  let pm = await callCheckApi('claim', { quote: 'Media Title', team_id: team.data.dbid, add_to_project_id: project.data.dbid });
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'id,last_status_obj,last_status' });
  const st = await callCheckApi('get', { class: 'dynamic', id: pm.data.last_status_obj.id, fields: 'graphql_id' });
  const callback_id = { last_status_id: st.data.graphql_id, team_slug: team.data.slug };

  let es = config.appName === 'check' ? 'undetermined' : 'pending';
  expect(pm.data.last_status).toBe(es);
  const { outputData, callback } = await sendAction({ name: 'change_status', selected_options: [{ value: 'in_progress' }] }, callback_id);
  expect(outputData).not.toMatch('Error');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ attachments: [expect.objectContaining({ title: expect.stringContaining('IN PROGRESS: Media Title') })] }));
  pm = await callCheckApi('get', { class: 'project_media', id: pm.data.id, fields: 'last_status' });
  expect(pm.data.last_status).toBe('in_progress');
});

test('identify Slack user and return error if user cannot run the change_status command', async () => {
  const callback_id = { last_status_id: 'xyz123', team_slug: 'test' };
  const { outputData, callback } = await sendAction({ name: 'change_status', selected_options: [{ value: 'verified' }] }, callback_id);
  expect(outputData).toMatch('Error when executing mutation');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('continue directly from there: Test') }));
});

test('identify Slack user and handle add_comment command', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'add_comment' }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Saved Redis');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Type your note') }));
});

test('identify Slack user and handle edit title command', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'title' }] }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Saved Redis');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Type the analysis title below') }));
});

test('identify Slack user and handle edit description command', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'edit', selected_options: [{ value: 'description' }] }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(outputData).toMatch('Saved Redis');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Type the analysis content below') }));
});

test('identify Slack user and handle image_search command on report without image', async () => {
  const callback_id = {};
  const { outputData, callback } = await sendAction({ name: 'image_search' }, callback_id);
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('There are no images on this report') }));
});

test('identify Slack user and handle image_search command on report with image', async () => {
  const functionName = config.googleImageSearchFunctionName;
  config.googleImageSearchFunctionName = false;
  const awsConfig = aws.config;
  aws.config = {
    loadFromPath: (path) => {
      console.log('AWS Mocked Config');
    }
  };
  awsMock.mock('Lambda', 'invoke', function() { console.log('AWS Mocked Method'); });

  const { outputData, callback } = await sendAction({ name: 'image_search' }, {}, 'https://picsum.photos/200/300/?random');

  aws.config = awsConfig;
  config.googleImageSearchFunctionName = functionName;

  expect(outputData).toMatch('AWS Mocked Config');
  expect(outputData).toMatch('AWS Mocked Method');
  expect(outputData).toMatch('Successfully identified as Slack user with token: ');
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('Please wait while I look for similar images') }));
});
