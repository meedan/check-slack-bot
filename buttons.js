const config = require('./config.js'),
      request = require('request'),
      util = require('util'),
      Lokka = require('lokka').Lokka,
      Transport = require('lokka-transport-http').Transport,
      header = require('basic-auth-header'),
      VERIFICATION_TOKEN = config.slack.verificationToken,
      ACCESS_TOKEN = config.slack.accessToken;

const { formatMessageFromData, t } = require('./helpers.js');

function verify(data, callback) {
  if (data.token === VERIFICATION_TOKEN) callback(null, data.challenge);
  else callback('Verification failed');
}

var error = function(data, callback) {
  callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('open_check_to_continue') + ': ' + data.original_message.attachments[0].title_link });
};

function getClient(data, user, callback) {
  var handleErrors = function(errors, resp) {
    console.log('Error on mutation: ' + util.inspect(errors));
    error(data, callback);
  };
  
  const headers = {
    'X-Check-Token': user.token
  };

  if (config.checkApi.httpAuth) {
    var credentials = config.checkApi.httpAuth.split(':');
    var basic = header(credentials[0], credentials[1]);
    headers['Authorization'] = basic;
  }

  const transport = new Transport(config.checkApi.url + '/api/graphql?team=' + data.team.slug, { handleErrors, headers, credentials: false, timeout: 120000 });
  const client = new Lokka({ transport });

  return client;
};

function sendReply(obj, data, callback) {
  const json = { response_type: 'in_channel', replace_original: true, delete_original: false, attachments: formatMessageFromData(obj) };
  callback(null, json);
  
  /*
  console.log('Sending delayed response');

  json.token = ACCESS_TOKEN;
  
  const options = {
    uri: data.response_url,
    method: 'POST',
    json: json
  };

  request(options, function(err, response, body) {
    console.log('Output from delayed response: ' + body);
  });
  */
}

function changeStatus(data, user, callback) {
  const mutationQuery = `($status: String!, $id: ID!) {
    updateStatus: updateStatus(input: { clientMutationId: "1", id: $id, status: $status }) {
      project_media {
        metadata
        last_status
        last_status_obj {
          id
        }
        log_count
        created_at
        updated_at
        tasks_count
        project {
          title
        }
        tags {
          edges {
            node {
              tag
            }
          }
        }
        author_role
        user {
          name
          profile_image
        }
        verification_statuses
      }
    }
  }`;
  
  console.log('Calling updateStatus mutation for callback_id ' + data.callback_id);

  const value = JSON.parse(data.callback_id);
  const vars = {
    id: value.last_status_id,
    status: data.actions[0].selected_options[0].value
  };

  data.team = { slug: value.team_slug };
  const client = getClient(data, user, callback);

  client.mutate(mutationQuery, vars).then(function(resp, err) {
    if (!err && resp) {
      const obj = resp.updateStatus.project_media;
      obj.metadata = JSON.parse(obj.metadata);
      obj.team = { slug: value.team_slug };
      sendReply(obj, data, callback);
    }
    else {
      console.log('Error when changing status: ' + util.inspect(err));
      error(data, callback);
    }
  }).catch(function(e) {
    console.log('Error when changing status: ' + util.inspect(e));
    error(data, callback);
  });
}

function process(data, callback) {
  if (data.token === VERIFICATION_TOKEN) {
    
    const url = config.checkApi.url + '/api/admin/user/slack?uid=' + data.user.id;

    request.get({ url: url, json: true, headers: { 'X-Check-Token': config.checkApi.apiKey } }, function(err, res, json) {
      if (!err && res.statusCode === 200 && json && json.data && json.data.token) {
        if (data.actions[0].name === 'change_status') {
          changeStatus(data, json.data, callback);
        }
        else {
          error(data, callback);
        }
      }
      else {
        console.log('Error when trying to identify Slack user: ' + util.inspect(err));
        error(data, callback);
      }
    });

  }
  else {
    error(data, callback);
  }
}

exports.handler = (data, context, callback) => {
  const body = Buffer.from(data.body, 'base64').toString();
  const payload = JSON.parse(decodeURIComponent(body).replace(/^payload=/, ''));
  switch (data.type) {
    case 'url_verification': verify(data, callback); break;
    default: process(payload, callback);
  }
};
