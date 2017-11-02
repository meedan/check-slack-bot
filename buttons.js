const config = require('./config.js'),
      request = require('request'),
      util = require('util'),
      Lokka = require('lokka').Lokka,
      Transport = require('lokka-transport-http').Transport,
      header = require('basic-auth-header'),
      aws = require('aws-sdk'),
      VERIFICATION_TOKEN = config.slack.verificationToken,
      ACCESS_TOKEN = config.slack.accessToken;

const { formatMessageFromData, t, getRedisClient } = require('./helpers.js');

function verify(data, callback) {
  if (data.token === VERIFICATION_TOKEN) callback(null, data.challenge);
  else callback('Verification failed');
}

var error = function(data, callback) {
  callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('open_Check_to_continue') + ': ' + data.original_message.attachments[0].title_link });
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
        id
        dbid
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

function addComment(data, user, callback) {
  const value = JSON.parse(data.callback_id);
  const redis = getRedisClient();
  redis.on('connect', function() {
    redis.set('slack_message_ts:' + data.message_ts, JSON.stringify({ mode: 'comment', object_type: 'project_media', object_id: value.id, link: value.link, team_slug: value.team_slug }), function(e) {
      if (e) {
        console.log('Redis error: ' + e);
        error(data, callback);
      }
      else {
        let json = { text: t('type_your_comment_below') + ':', thread_ts: data.message_ts, replace_original: false, delete_original: false, response_type: 'in_channel' };
        callback(null, json);

        let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
        attachments[0].actions[1] = {
          name: 'type_comment',
          text: t('type_your_comment_below'),
          type: 'button',
          style: 'default'
        };
        attachments[0].actions[2] = {
          name: 'edit_title',
          text: t('edit_title', true),
          type: 'button',
          style: 'primary'
        };
        json = { response_type: 'in_channel', replace_original: true, delete_original: false, attachments: attachments, token: ACCESS_TOKEN };
        
        const options = {
          uri: data.response_url,
          method: 'POST',
          json: json
        };

        request(options, function(err, response, body) {
          console.log('Output from delayed response: ' + body);
        });
    
        console.log('Saved Redis key slack_message_ts:' + data.message_ts);
      }
      redis.quit();
    });
  });
}

function editTitle(data, user, callback) {
  const value = JSON.parse(data.callback_id);
  const redis = getRedisClient();
  redis.on('connect', function() {
    redis.set('slack_message_ts:' + data.message_ts, JSON.stringify({ mode: 'edit_title', object_type: 'project_media', object_id: value.id, link: value.link, team_slug: value.team_slug, graphql_id: value.graphql_id }), function(e) {
      if (e) {
        console.log('Redis error: ' + e);
        error(data, callback);
      }
      else {
        let json = { text: t('type_the_title_below') + ':', thread_ts: data.message_ts, replace_original: false, delete_original: false, response_type: 'in_channel' };
        callback(null, json);

        let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
        attachments[0].actions[1] = {
          name: 'add_comment',
          text: t('add_comment', true),
          type: 'button',
          style: 'primary'
        };
        attachments[0].actions[2] = {
          name: 'type_title',
          text: t('type_title_below'),
          type: 'button',
          style: 'default'
        };
        json = { response_type: 'in_channel', replace_original: true, delete_original: false, attachments: attachments, token: ACCESS_TOKEN };
        
        const options = {
          uri: data.response_url,
          method: 'POST',
          json: json
        };

        request(options, function(err, response, body) {
          console.log('Output from delayed response: ' + body);
        });
    
        console.log('Saved Redis key slack_message_ts:' + data.message_ts);
      }
      redis.quit();
    });
  });
}

function imageSearch(data, callback, context) {
  const image = data.original_message.attachments[0].image_url;

  if (image) {

    // Invoke Lambda function to get reverse images in background, because Slack doesn't wait more than 3s

    aws.config.loadFromPath('./aws.json');
    
    var lambda = new aws.Lambda({
      region: config.awsRegion
    });
    
    lambda.invoke({
      FunctionName: 'google-image-search',
      InvocationType: 'Event',
      Payload: JSON.stringify({ image_url: image, response_url: data.response_url })
    }, function(error, resp) {
      if (error) {
        console.log('Error from Google Image Search lambda function: ' + util.inspect(error));
      }
      if (resp) {
        console.log('Response from Google Image Search lambda function: ' + util.inspect(resp));
      }
    });
  
    callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_wait_while_I_look_for_similar_images') });
  }
  else {
    callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('there_are_no_images_on_this_report') });
  }
}

function process(data, callback, context) {
  if (data.token === VERIFICATION_TOKEN) {
    
    const url = config.checkApi.url + '/api/admin/user/slack?uid=' + data.user.id;

    request.get({ url: url, json: true, headers: { 'X-Check-Token': config.checkApi.apiKey } }, function(err, res, json) {
      if (!err && res.statusCode === 200 && json && json.data && json.data.token) {
        if (data.actions[0].name === 'change_status') {
          changeStatus(data, json.data, callback);
        }
        else if (data.actions[0].name === 'add_comment') {
          addComment(data, json.data, callback);
        }
        else if (data.actions[0].name === 'type_comment') {
          callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_type_your_comment_inside_the_thread_above') });
        }
        else if (data.actions[0].name === 'edit_title') {
          editTitle(data, json.data, callback);
        }
        else if (data.actions[0].name === 'type_title') {
          callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_type_your_title_inside_the_thread_above') });
        }
        else if (data.actions[0].name === 'image_search') {
          imageSearch(data, callback, context);
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
    default: process(payload, callback, context);
  }
};
