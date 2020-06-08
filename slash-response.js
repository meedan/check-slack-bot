// This function adds a ProjectMedia to Check and sends a message back to Slack

const config = require('./config.js'),
      request = require('request'),
      util = require('util'),
      qs = require('querystring'),
      https = require('https'),
      CheckError = require ('./CheckError'),
      imgur = require('imgur');

const { executeMutation, getRedisClient, t, getGraphqlClient, getTeamConfig, saveToRedisAndReplyToSlack, projectMediaCreatedMessage, humanAppName } = require('./helpers.js');

const replyToSlack = function(team, responseUrl, message, callback) {
  request.post({ url: responseUrl, json: true, body: message, headers: { 'Content-type': 'application/json' } }, function(err, res, resjson) {
    console.log('Response from Slack message update: ' + util.inspect(res));
  });
  if (callback) {
    callback(null, message);
  }
};

const getProject = function(teamSlug, projectId, token, done, fail, callback) {
  const client = getGraphqlClient(teamSlug, token, callback);
  const projectQuery = `
  query project($ids: String!) {
    project(ids: $ids) {
      dbid
      title
      description
      team {
        name
        slug
      }
    }
  }
  `;
  client.query(projectQuery, { ids: projectId.toString() })
  .then((resp, errors) => {
    console.log('GraphQL query response: ' + util.inspect(resp));
    done(resp);
  })
  .catch(function(e) {
    fail(e);
    console.log('GraphQL query exception: ' + e.toString());
  });
};

const sendErrorMessage = function(e, vars, text, team_id, responseUrl, callback) {
  const message = { response_type: "ephemeral", text: text };
  if (e.rawError && (error = e.rawError[0])) {
    let error_message = error.message;
    if (error && error.code === CheckError.codes.DUPLICATED ) { error_message += ': ' + error.data.url; };

    message.attachments = [{
      color: 'warning',
      text: error_message,
      footer: vars.url,
      fallback: error_message
    }]
  };
  console.log('Error: ' + util.inspect(e));
  replyToSlack(team_id, responseUrl, message, callback);
};

const createProjectMedia = function(team_id, responseUrl, vars, token, data, callback) {
  const mutationQuery = `($pid: Int!, $url: String!, $clientMutationId: String!) {
    createProjectMedia: createProjectMedia(input: { clientMutationId: $clientMutationId, url: $url, add_to_project_id: $pid }) {
      project_media {
        dbid
        oembed_metadata
        url
        quote
      }
    }
  }`;

  const fail = function(callback, thread, channel, link, e) {
    const text = t("sorry,_can't_add_the_URL") + ' ' + link;
    sendErrorMessage(e, vars, text, team_id, responseUrl, callback);
  };

  const done = function(resp) {
    console.log('GraphQL query response: ' + util.inspect(resp));
    const oembedMetadata = JSON.parse(resp.createProjectMedia.project_media.oembed_metadata);
    let message = { response_type: "in_channel", text: projectMediaCreatedMessage() + oembedMetadata.permalink };
    replyToSlack(team_id, responseUrl, message, callback);
    callback(null, message);
  };

  executeMutation(mutationQuery, vars, fail, done, token, callback, {}, data);
};

const addUrl = function(payload, redisKey, callback) {
  const responseUrl = payload.body.response_url;
  const team_id = payload.body.team_id;
  const url = payload.matches[1];
  const vars =  { url: url, clientMutationId: `fromSlackMessage:${payload.body.trigger_id}`};
  const redis = getRedisClient();
  redis.get(redisKey, function(err, reply) {
    if (!reply) {
      console.log('Could not find Redis key for channel' + ' #' + payload.body.channel_name);
      let message = { text: t('default_project_not_defined_for_this_channel'), response_type: 'ephemeral' };
      replyToSlack(team_id, responseUrl, message, callback);
    }
    else {
      const data = JSON.parse(reply.toString());
      data.link = url;
      vars.pid = parseInt(data.project_id);
      createProjectMedia(team_id, responseUrl, vars, payload.user_token, data, callback);
    }
    redis.quit();
  });
  console.log('Add URL to ' + humanAppName() + ': ' + url);
};

const setProject = function(payload, redisKey, callback) {
  const projectUrl = payload.matches[0],
        teamSlug = payload.matches[1],
        projectId = payload.matches[2];

  const fail = function(e) {
    const text = t("sorry,_can't_find_project") + ' ' + projectUrl;
    const vars = { url: projectUrl };
    sendErrorMessage(e, vars, text, payload.body.team_id, payload.body.response_url, callback);
  };

  const done = function(data) {
    const value = { team_slug: teamSlug, project_id: data.project.dbid, project_title: data.project.title, project_url: payload.matches[0]};
    const message = { text: t('project_set') + ': ' + value['project_url'], response_type: 'in_channel' };

    const success = function() {
      replyToSlack(payload.body.team_id, payload.body.response_url, message, callback);
    };

    saveToRedisAndReplyToSlack(redisKey, value, message, success, callback);
  };

  //Handle if project doesn't exist
  getProject(teamSlug, projectId, payload.user_token, done, fail, callback);
  console.log('Set project: ' + projectUrl);
};

const showProject = function(payload, redisKey, callback) {
  let message = ''
  const redis = getRedisClient();
  redis.on('connect', function() {
    redis.get(redisKey, function(err, reply) {
      if (!reply) {
        console.log('Could not find Redis key for channel' + ' #' + payload.body.channel_name);
        message = { text: t('default_project_not_defined_for_this_channel'), response_type: 'ephemeral' };
      }
      else {
        const data = JSON.parse(reply.toString());
        message = { text: t('project_set_to_channel') + ': ' + data.project_url, response_type: 'ephemeral' };
      }
      replyToSlack(payload.body.team_id, payload.body.response_url, message, callback);
    });
    redis.quit();
  });
};

const sendActionToSmoochBot = function(payload, redisKey, callback, action) {
  let message = ''
  const redis = getRedisClient();
  redis.on('connect', function() {
    redis.get(redisKey, function(err, reply) {
      if (!reply) {
        console.log('Could not find Redis key for channel' + ' #' + payload.body.channel_name);
        message = { text: t('this_channel_is_not_related_to_a_bot_conversation'), response_type: 'ephemeral' };
        replyToSlack(payload.body.team_id, payload.body.response_url, message, callback);
      }
      else {
        const data = JSON.parse(reply.toString());
        if (action === 'send') {
          message = { text: t('message_sent_to_the_bot'), response_type: 'in_channel' };

          const mutationQuery = `($action: String!, $id: ID!, $clientMutationId: String!) {
            updateDynamicAnnotationSmoochUser: updateDynamicAnnotationSmoochUser(input: { clientMutationId: $clientMutationId, id: $id, action: $action }) {
              project {
                id
              }
            }
          }`;

          const done = function() {
            console.log(message.text);
            callback(null, message);
          }

          const token = config.checkApi.apiKey;
          executeMutation(mutationQuery, { action: 'send ' + payload.matches[1], id: data.annotation_id, clientMutationId: `fromSlackMessage:${payload.body.trigger_id}` }, null, done, token, callback, {}, {});
          replyToSlack(payload.body.team_id, payload.body.response_url, message, null);
        }
        else {
          if (data.mode === 'human') {
            const newData = Object.assign({}, data);
            newData.mode = 'bot';
            redis.set(redisKey, JSON.stringify(newData), function() {
              message = { text: t('conversation_is_now_in_bot_mode'), response_type: 'in_channel' };

              const mutationQuery = `($action: String!, $id: ID!, $clientMutationId: String!) {
                updateDynamicAnnotationSmoochUser: updateDynamicAnnotationSmoochUser(input: { clientMutationId: $clientMutationId, id: $id, action: $action }) {
                  project {
                    id
                  }
                }
              }`;

              const done = function() {
                console.log(message.text);
                callback(null, message);
              }

              const token = config.checkApi.apiKey;
              executeMutation(mutationQuery, { action, id: data.annotation_id, clientMutationId: `fromSlackMessage:${payload.body.trigger_id}` }, null, done, token, callback, {}, {});
              replyToSlack(payload.body.team_id, payload.body.response_url, message, null);
            });
          }
          else {
            message = { text: t('conversation_is_already_in_bot_mode'), response_type: 'ephemeral' };
            console.log(message.text);
            replyToSlack(payload.body.team_id, payload.body.response_url, message, callback);
          }
        }
      }
      redis.quit();
    });
  });
};

const sendSmoochImage = function(payload, callback) {
  const redis = getRedisClient();
  redis.on('connect', function() {
    const redisKey = 'slack_channel_smooch:' + config.redisPrefix + ':' + payload.body.channel;
    redis.get(redisKey, function(err, reply) {
      if (reply) {
        const teamConfig = getTeamConfig(payload.body.team_id);
        const token = teamConfig.legacyToken;
        payload.body.files.forEach(function(file) {
          request({
            url: file.url_private,
            encoding: null,
            headers: {
              'Authorization': 'Bearer ' + teamConfig.legacyToken
            }
          }, function(err2, res, body) {
            if (!err2) {
              const data = Buffer.from(body).toString('base64');
              imgur.uploadBase64(data)
              .then(function(json) {
                const link = json.data.link;
                const text = payload.body.text.replace(/^\/sk /, '');
                const message = { token: teamConfig.legacyToken, channel: payload.body.channel, command: '/sk', text: '![' + text + '](' + link + ')' };
                const query = qs.stringify(message);
                https.get('https://slack.com/api/chat.command?' + query, function() {
                  callback(null);
                });
                console.log('Sent image: ' + link);
              });
            }
            else {
              console.log('Could not send image');
            }
          });
        });
      }
      else {
        console.log('Not found in Redis: ' + redisKey);
        callback(null);
      }
      redis.quit();
    });
  });
};

const showTips = function(payload, callback) {
  let message = {
    response_type: 'ephemeral',
    text: ':wave: ' + t('need_some_help_with') + ' `' + payload.body.command + '`?',
    attachments: [
      {
        text: t('define_the_default_project_for_this_channel') + ':\n `' + payload.body.command + ' set ' + config.checkWeb.url + '/[team slug]/project/[project id]`',
        mrkdwn_in: ['text'],
        fallback: t('define_the_default_project_for_this_channel') + ':\n `' + payload.body.command + ' set ' + config.checkWeb.url + '/[team slug]/project/[project id]`'
      },
      {
        text: t('show_the_default_project_for_this_channel') + ':\n `' + payload.body.command + ' show`',
        mrkdwn_in: ['text'],
        fallback: t('show_the_default_project_for_this_channel') + ':\n `' + payload.body.command + ' show`'
      },
      {
        text: t('send_a_URL_to') + ' ' + humanAppName() + '. ' + t('a_default_project_for_this_channel_must_be_already_defined') + ':\n `' + payload.body.command + ' [URL]`',
        mrkdwn_in: ['text'],
        fallback: t('send_the_URL_to') + ' ' + humanAppName() + '. ' + t('a_default_project_for_this_channel_must_be_already_defined') + ':\n `' + payload.body.command + ' [URL]`'
      },
      {
        text: t('reactivate_Smooch_bot_for_this_conversation') + ':\n `' + payload.body.command + ' bot activate`',
        mrkdwn_in: ['text'],
        fallback: t('reactivate_Smooch_bot_for_this_conversation') + ':\n `' + payload.body.command + ' bot activate`',
      },
      {
        text: t('send_message_to_Smooch_bot') + ':\n `' + payload.body.command + ' bot send [message]`',
        mrkdwn_in: ['text'],
        fallback: t('send_message_to_Smooch_bot') + ':\n `' + payload.body.command + ' bot send [message]`',
      },
      {
        text: t('Or_see_our_detailed_user_guide') + ' ' + 'https://medium.com/meedan-user-guides/add-to-check-from-slack-5fee91dadc35',
        mrkdwn_in: ['text'],
        fallback: t('Or_see_our_detailed_user_guide') + ' ' + 'https://medium.com/meedan-user-guides/add-to-check-from-slack-5fee91dadc35'
      }]
  };
  replyToSlack(payload.body.team_id, payload.body.response_url, message, callback);
};

exports.handler = function(event, context, callback) {
  const redisKey = 'slack_channel_project:' + config.redisPrefix + ':' + event.body.channel_id;
  const smoochRedisKey = 'slack_channel_smooch:' + config.redisPrefix + ':' + event.body.channel_id;
  switch (event.type) {
    case 'createProjectMedia':
      addUrl(event, redisKey, callback);
      break;
    case 'setProject':
      setProject(event, redisKey, callback);
      break;
    case 'showProject':
      showProject(event, redisKey, callback);
      break;
    case 'reactivateBot':
      sendActionToSmoochBot(event, smoochRedisKey, callback, 'reactivate');
      break;
    case 'sendBot':
      sendActionToSmoochBot(event, smoochRedisKey, callback, 'send');
      break;
    case 'sendSmoochImage':
      sendSmoochImage(event, callback);
      break;
    default:
      showTips(event, callback);
  }
};
