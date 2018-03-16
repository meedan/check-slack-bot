const btoa = require('btoa');
const buttons = require('./buttons');

const buildData = (token, type, payload) => {
  if (!payload) {
    payload = {};
  }
  const data = {
    type,
    token: token,
    challenge: 'challenge', 
    body: btoa('payload=' + JSON.stringify(payload)),
  };
  return data;
};

const buildPayload = (teamId) => {
  const payload = {
    team: {
      id: teamId
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
  const payload = buildPayload('T12345ABC');
  const data = buildData('invalid', 'process', payload);
  const callback = jest.fn();
  buttons.handler(data, null, callback);
  expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ text: expect.stringContaining('do not have the permission') }))
});
