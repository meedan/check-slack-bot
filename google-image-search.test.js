let config = require('./config');
const request = require('request');
const gis = require('./google-image-search');
const {
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction
} = require('./test-helpers.js');

jest.setTimeout(10000);

test('search for image', async () => {
  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  const callback = jest.fn();
  const data = {
    channel: {
      id: 123
    },
    thread_ts: new Date().getTime(),
    image_url: 'http://ca.ios.ba/files/others/banana.jpg'
  };
  gis.handler(data, null, callback);
  await sleep(8);
  
  expect(outputData).toMatch('Image search name: banana');
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
  await sleep(8);
  
  expect(outputData).not.toMatch('Image search name: banana');
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
  await sleep(8);
  request.get = requestGet;
  
  expect(outputData).not.toMatch('Image search name: banana');
  expect(outputData).not.toMatch('Image search URL: https://');
  expect(outputData).toMatch('Image search error');
  expect(outputData).not.toMatch('No results for image search');
  expect(callback).toHaveBeenCalledWith(null);
});
