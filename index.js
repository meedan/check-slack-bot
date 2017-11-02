const config = require('./config.js'),
      https = require('https'),
      request = require('request'),
      qs = require('querystring'),
      os = require('os'),
      Lokka = require('lokka').Lokka,
      Transport = require('lokka-transport-http').Transport,
      util = require('util'),
      header = require('basic-auth-header'),
      VERIFICATION_TOKEN = config.slack.verificationToken,
      ACCESS_TOKEN = config.slack.accessToken;
      
const { getRedisClient, formatMessageFromData, t } = require('./helpers.js');

var handleErrors = function(errors, data) {
  console.log('ERROR: ' + util.inspect(errors));
};

var getProjectMedia = function(teamSlug, projectId, projectMediaId, callback) {
  var headers = {
    'X-Check-Token': config.checkApi.apiKey
  };

  if (config.checkApi.httpAuth) {
    var credentials = config.checkApi.httpAuth.split(':');
    var basic = header(credentials[0], credentials[1]);
    headers['Authorization'] = basic;
  }

  const transport = new Transport(config.checkApi.url + '/api/graphql?team=' + teamSlug, { handleErrors, headers, credentials: false, timeout: 120000 });
  const client = new Lokka({ transport });

  const projectMediaQuery = `
  query project_media($ids: String!) {
    project_media(ids: $ids) {
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
  `;

  client.query(projectMediaQuery, { ids: projectMediaId + ',' + projectId })
  .then((resp, errors) => {
    if (errors) {
      console.log('ERROR: ' + util.inspect(errors));
    }
    else {
      console.log('DEBUG: Asked for project media and got response: ' + util.inspect(resp));
      var pm = resp.project_media;
      pm.metadata = JSON.parse(pm.metadata);
      pm.team = { slug: teamSlug };
      callback(pm);
    }
  })
  .catch((e) => {
    console.log('ERROR: ' + e.toString());
  });
};

function verify(data, callback) {
  if (data.token === VERIFICATION_TOKEN) callback(null, data.challenge);
  else callback(t('verification_failed'));   
}

function process(event, callback) {
  console.log('Request: ' + util.inspect(event));
  const mainRegexp = new RegExp(config.checkWeb.url, 'g');

  // This message contains a Check URL to be parsed

  if (!event.bot_id && mainRegexp.test(event.text)) {
    const regexp = new RegExp(config.checkWeb.url + '/([^/]+)/project/([0-9]+)/media/([0-9]+)', 'g');

    while (matches = regexp.exec(event.text)) {

      var teamSlug = matches[1],
          projectId = matches[2],
          projectMediaId = matches[3];

      getProjectMedia(teamSlug, projectId, projectMediaId, function(data) {
        var message = { 
          token: ACCESS_TOKEN,
          channel: event.channel,
          attachments: JSON.stringify(formatMessageFromData(data))
        };

        var query = qs.stringify(message);
        https.get('https://slack.com/api/chat.postMessage?' + query);
      });
    }
  }

  // This message is a comment to a media

  if (!event.bot_id && event.thread_ts) {
    const redis = getRedisClient();
    redis.get('slack_message_ts:' + event.thread_ts, function(err, reply) {
      if (err) {
        console.log('Error when getting information from Redis: ' + err);
      }
      else if (!reply) {
        console.log('Could not find Redis key slack_message_ts:' + event.thread_ts);
      }
      else {
        const data = JSON.parse(reply.toString());

        if (data.object_type === 'project_media' && data.mode === 'comment') {
          const url = config.checkApi.url + '/api/admin/user/slack?uid=' + event.user;

          request.get({ url: url, json: true, headers: { 'X-Check-Token': config.checkApi.apiKey } }, function(err, res, json) {
            if (!err && res.statusCode === 200 && json && json.data && json.data.token) {
              createComment(event, data, json.data.token, callback, function(resp) {
                const message = { text: t('your_comment_was_added') + ': ' + data.link, thread_ts: event.thread_ts, replace_original: false, delete_original: false,
                                  response_type: 'ephemeral', token: ACCESS_TOKEN, channel: event.channel };
                const query = qs.stringify(message);
                https.get('https://slack.com/api/chat.postMessage?' + query);
              });
            }
            else {
              console.log('Error when trying to identify Slack user: ' + util.inspect(err));
              sendErrorMessage(callback, event.thread_ts, event.channel, data.link);
            }
          });
        }
      }
        
      redis.quit();
    });   
  }

  callback(null);
}

function sendErrorMessage(callback, thread, channel, link) {
  const message = { text: t('open_Check_to_continue') + ': ' + link, thread_ts: thread, replace_original: false, delete_original: false,
                    response_type: 'ephemeral', token: ACCESS_TOKEN, channel: channel };
  const query = qs.stringify(message);
  https.get('https://slack.com/api/chat.postMessage?' + query);
}

function getClient(team, token, callback) {
  var handleErrors = function(errors, resp) {
    console.log('Error on mutation: ' + util.inspect(errors));
  };
  
  const headers = {
    'X-Check-Token': token
  };

  if (config.checkApi.httpAuth) {
    var credentials = config.checkApi.httpAuth.split(':');
    var basic = header(credentials[0], credentials[1]);
    headers['Authorization'] = basic;
  }

  const transport = new Transport(config.checkApi.url + '/api/graphql?team=' + team, { handleErrors, headers, credentials: false, timeout: 120000 });
  const client = new Lokka({ transport });

  return client;
};

function createComment(event, data, token, callback, done) {
  const pmid = data.object_id.toString(),
        text = event.text,
        thread = event.thread_ts,
        channel = event.channel,
        team = data.team_slug;

  const mutationQuery = `($text: String!, $pmid: String!) {
    createComment: createComment(input: { clientMutationId: "1", text: $text, annotated_id: $pmid, annotated_type: "ProjectMedia" }) {
      project_media {
        dbid
      }
    }
  }`;
  
  const vars = {
    text: text,
    pmid: pmid
  };

  const client = getClient(team, token, callback);

  client.mutate(mutationQuery, vars).then(function(resp, err) {
    if (!err && resp) {
      done(resp);
    }
    else {
      console.log('Error when creating comment: ' + util.inspect(err));
      sendErrorMessage(callback, thread, channel, data.link);
    }
  }).catch(function(e) {
    console.log('Error when creating comment: ' + util.inspect(e));
    sendErrorMessage(callback, thread, channel, data.link);
  });
}

exports.handler = (data, context, callback) => {
  switch (data.type) {
    case 'url_verification': verify(data, callback); break;
    case 'event_callback': process(data.event, callback); break;
    default: callback(null);
  }
};
