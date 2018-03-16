const btoa = require('btoa');
const buttons = require('./buttons');

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

const buildPayload = (token, teamId, userId) => {
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
        },
      ],
    },
  };
  return payload;
};

const sleep = (s) => {
  return new Promise(resolve => setTimeout(resolve, s * 1000));
};

const callCheckApi = () => {
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
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('do not have the permission') }))
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
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('do not have the permission') }))
});
