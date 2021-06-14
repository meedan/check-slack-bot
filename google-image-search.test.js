let config = require('./config');
const request = require('request');
const gis = require('./google-image-search');
const {
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction
} = require('./test-helpers.js');

jest.setTimeout(120000);

const timeout = 60;

test('search for image', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const callback = jest.fn();
  const t = new Date().getTime();
  const data = {
    channel: {
      id: 123
    },
    thread_ts: t,
    image_url: 'https://ca.ios.ba/files/others/moon.jpg?t=' + t
  };
  gis.handler(data, null, callback);
  await sleep(timeout);

  expect(outputData).toMatch('Image search name: ');
  expect(outputData).toMatch('Image search URL: https://');
  expect(outputData).not.toMatch('Image search error');
  expect(outputData).not.toMatch('No results for image search');
  expect(callback).toHaveBeenCalledWith(null);
});

test('search for image but return no data', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const callback = jest.fn();
  const data = {
    channel: {
      id: 123
    },
    thread_ts: new Date().getTime(),
    image_url: 'nothing'
  };
  gis.handler(data, null, callback);
  await sleep(timeout);

  expect(outputData).not.toMatch('moon');
  expect(outputData).not.toMatch('Image search URL: https://');
  expect(outputData).not.toMatch('Image search error');
  expect(outputData).toMatch('No results for image search');
  expect(callback).toHaveBeenCalledWith(null);
});

test('search for image but return error', async () => {
  const requestReturnsError = function(options, callbackFunction) {
    callbackFunction('Error', null, null);
  };

  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const callback = jest.fn();
  const data = {
    channel: {
      id: 123
    },
    thread_ts: new Date().getTime(),
    image_url: 'error'
  };

  const requestGet = request.get;
  request.get = requestReturnsError;
  await gis.handler(data, null, callback);
  await sleep(timeout);
  request.get = requestGet;

  expect(outputData).not.toMatch('moon');
  expect(outputData).not.toMatch('Image search URL: https://');
  expect(outputData).toMatch('Image search error');
  expect(outputData).not.toMatch('No results for image search');
  expect(callback).toHaveBeenCalledWith(null);
});
