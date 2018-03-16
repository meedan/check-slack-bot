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
