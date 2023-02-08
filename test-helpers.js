const { exec } = require('child_process');
const btoa = require('btoa');
const fetch = require('node-fetch');
const config = require('./config');
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

const buildPayload = (token, teamId, userId, action, callback_id, image_url) => {
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
          image_url: !!image_url,
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

const buildRandomString = (times) => {
  if (!times) {
    times = 1;
  }
  let str = '';
  for (let i = 0; i < times; i++) {
    str += Math.random().toString(36).substring(2, 7);
    str += Math.random().toString(36).substring(2, 7);
  }
  return str;
};

const callCheckApi = async (path, params) => {
  console.log("path: ", path)
  console.log("params: ", params)
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
  console.log("res: ", res)
  const json = await res.json();
  console.log("json: ", json)
  if (path === 'user') {
    json.data["uid"] = params.uid
  }
  return json;
};

const sendAction = async (action, callback_id, image_url) => {
  let uid = buildRandomString();
  const payload = buildPayload('123456abcdef', 'T12345ABC', uid, action, callback_id, image_url);
  const data = buildData('123456abcdef', 'process', payload);
  const callback = jest.fn();

  let outputData = '';
  storeLog = inputs => (outputData += inputs);
  console['log'] = jest.fn(storeLog);

  let token = buildRandomString();
  await callCheckApi('new_api_key', { access_token: config.checkApi.apiKey });
  await callCheckApi('user', { provider: 'slack', uid, token, is_admin: true });

  buttons.handler(data, null, callback);
  await sleep(3);

  return { outputData, callback };
};

const redisSet = async (key, value) => {
  await exec(`redis-cli -h ${config.redisHost} set ${key} '${value}'`);
};

module.exports = {
  buildData,
  buildPayload,
  sleep,
  buildRandomString,
  callCheckApi,
  sendAction,
  redisSet,
};
