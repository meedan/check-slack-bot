const config = require('./config.js'),
      https = require('https'),
      request = require('request'),
      qs = require('querystring'),
      aws = require('aws-sdk'),
      md5 = require('js-md5'),
      util = require('util');
let ACCESS_TOKEN = null;

const { executeMutation, verify, getCheckSlackUser, getRedisClient, formatMessageFromData, t, getGraphqlClient, getTeamConfig, projectMediaCreatedMessage, saveToRedisAndReplyToSlack, saveAndReply } = require('./helpers.js');

const getField = function(query, callback, done) {
  const client = getGraphqlClient(null, config.checkApi.apiKey, callback);

  const fieldQuery = `
  query dynamic_annotation_field($query: String!) {
    dynamic_annotation_field(query: $query, only_cache: true) {
      annotation {
        id
        dbid
        team {
          slug
          url
        }
      }
    }
  }
  `;

  client.query(fieldQuery, { query })
  .then((resp, errors) => {
    console.log('GraphQL query response: ' + util.inspect(resp));
    done(resp.dynamic_annotation_field);
  });
};

const getProjectMedia = function(teamSlug, projectId, projectMediaId, callback, done) {
  const client = getGraphqlClient(teamSlug, config.checkApi.apiKey, callback);

  const projectMediaQuery = `
  query project_media($ids: String!) {
    project_media(ids: $ids) {
      id
      dbid
      oembed_metadata
      last_status
      last_status_obj {
        id
      }
      created_at
      updated_at
      author_role
      user {
        name
        profile_image
        source {
          image
        }
      }
      team {
        name
        slug
        get_languages
        verification_statuses
      }
      media {
        url
      }
    }
  }
  `;

  client.query(projectMediaQuery, { ids: projectMediaId })
  .then((resp, errors) => {
    console.log('GraphQL query response: ' + util.inspect(resp));
    const pm = resp.project_media;
    pm.oembed_metadata = JSON.parse(pm.oembed_metadata);
    done(pm);
  })
  .catch(function(e) {
    console.log('GraphQL query exception: ' + e.toString());
  });
};

const escapeRegExp = function(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const displayCard = function(checkURLPattern, event) {
  if (!event.text) {
    // Check notifications
    if (event.attachments && event.attachments.length === 1 && JSON.stringify(Object.keys(event.attachments[0]).sort()) === JSON.stringify(['fallback', 'id', 'pretext']) && /^<[^|]+\|[^>]+>$/.test(event.attachments[0].pretext)) {
      console.log('Display card for Check notification');
      return true;
    }
    return false;
  }
  const urlFromBotRegexp = new RegExp('\<' + checkURLPattern + '\>');
  switch(event.bot_id) {
    case undefined:
      return true;
    default:
      return urlFromBotRegexp.test(event.text);
  }
};

const process = function(event, callback, teamConfig) {
  const mainRegexp = new RegExp(escapeRegExp(config.checkWeb.url), 'g');
  const checkURLPattern = escapeRegExp(config.checkWeb.url) + '(?:\/([^/]+)\/project\/([0-9]+)\/media\/([0-9]+)|\/([^/]+)\/media\/([0-9]+))';
  const regexp = new RegExp(checkURLPattern, 'g');

  // Image uploaded for Smooch user

  if (event.type === 'message' && event.subtype === 'file_share' && /^\/sk($| )/.test(event.text)) {
    event.team_id = teamConfig.teamId;
    const functionName = config.slashResponseFunctionName || 'slash-response';
    const payload = { type: 'sendSmoochImage', body: event };
    if (config.awsRegion === 'local') {
      const lambda = require('./' + functionName).handler;
      console.log('Calling local function');
      lambda(payload, {}, function() {});
    }
    else {
      const lambda = new aws.Lambda({ region: config.awsRegion });
      lambdaRequest = lambda.invoke({ FunctionName: functionName, InvocationType: 'Event', Payload: JSON.stringify(payload) });
      lambdaRequest.send();
    }
    callback(null);
  }

  // Two possible cases here:
  // 1) This message is from the Slack user to the Smooch user, so we need to move the conversation to "human mode" if it's still in "bot mode"; or
  // 2) A channel was archived, so we need to move the conversation back to "bot mode" if it's still in "human mode"

  if (event.type === 'channel_archive' || (event.bot_id === teamConfig.smoochBotId && event.text !== '' && / replied$/.test(event.username))) {
    let mode = 'human';
    let action = 'deactivate';
    if (event.type === 'channel_archive') {
      mode = 'bot';
      action = 'reactivate';
    }

    const redis = getRedisClient();
    redis.on('connect', function() {
      const redisKey = 'slack_channel_smooch:' + config.redisPrefix + ':' + event.channel;
      redis.get(redisKey, function(err, reply) {
        const data = JSON.parse(reply.toString());
        const token = config.checkApi.apiKey;
        let done = null;
        let mutationQuery = null;

        if (mode === 'human') {
          const actionData = JSON.stringify({
            channel: event.channel,
            token: ACCESS_TOKEN,
          });
          mutationQuery = `($action: String!, $id: ID!, $clientMutationId: String!, $actionData: String) {
            updateDynamicAnnotationSmoochUser: updateDynamicAnnotationSmoochUser(input: { clientMutationId: $clientMutationId, id: $id, action: $action, action_data: $actionData }) {
              project {
                id
              }
            }
          }`;
          done = function() { };
          executeMutation(mutationQuery, { action: 'refresh_timeout', actionData, id: data.annotation_id, clientMutationId: `fromSlackMessage:${event.ts}` }, null, done, token, callback, event, {});
        }

        if (data.mode !== mode) {
          const newData = Object.assign({}, data);
          newData.mode = mode;
          redis.set(redisKey, JSON.stringify(newData), function() {
            mutationQuery = `($action: String!, $id: ID!, $clientMutationId: String!) {
              updateDynamicAnnotationSmoochUser: updateDynamicAnnotationSmoochUser(input: { clientMutationId: $clientMutationId, id: $id, action: $action }) {
                project {
                  id
                }
              }
            }`;

            done = function() {
              if (event.type !== 'channel_archive') {
                console.log('Bot was deactivated because a message was sent');
                callback(null);
              }
              else {
                console.log('Bot was reactivated because channel was archived');
                callback(null);
              }
            };

            executeMutation(mutationQuery, { action, id: data.annotation_id, clientMutationId: `fromSlackMessage:${event.ts}` }, null, done, token, callback, event, {});

            if (event.type !== 'channel_archive') {
              const message = {
                // FIXME: Localize it with t('function') in the future
                text: "The bot has been de-activated for this conversation. You can now communicate directly to the user in this channel. To reactivate the bot, type `/check bot activate`. <https://intercom.help/meedan/en/articles/3365307-slack-integration|Learn about more features of the Slack integration here.>",
                response_type: 'in_channel',
                channel: event.channel
              };
              const query = qs.stringify(message);
              https.get('https://slack.com/api/chat.postMessage?' + query, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
            }
          });
        }
        else {
          console.log('Already in ' + mode + ' mode');
          callback(null);
        }
        redis.quit();
      });
    });
  }

  // This message is from Smooch Bot when it auto-creates a channel for a user
  // We associate the Smooch Bot project with the Slack channel and store the "smooch_user" annotation related to the Slack channel

  else if (event.bot_id === teamConfig.smoochBotId && event.attachments && event.attachments[0] && event.attachments[0].fields) {
    let appName = null;
    let identifier = null;
    event.attachments[0].fields.forEach(function(field) {
      if (field.title === 'App') {
        appName = field.value;
      }
      if (field.title === 'Device Info') {

        // The identifier is different depending on the platform
        if (/WhatsApp Messenger/.test(field.value)) {
          identifier = field.value.match(/Phone Number: (.*)/)[1];
        }
        else if (/Facebook Messenger/.test(field.value)) {
          identifier = field.value.match(/psid=([0-9]+)/)[1];
        }
        else if (/Twitter DM/.test(field.value)) {
          identifier = field.value.match(/profile_images\/([0-9]+)\//)[1];
        }
        else if (/Telegram Messenger/.test(field.value)) {
          // For Telegram, there is no unique piece of information we can use to identify which user this Slack channel belongs to
          identifier = null;
        }
        else if (/Viber Messenger/.test(field.value)) {
          identifier = field.value.match(/dlid=([^&]+)/)[1].substring(0, 27);
        }
        else if (/LINE Messenger/.test(field.value)) {
          identifier = field.value.match(/sprofile\.line-scdn\.net\/([^|]+)/)[1];
        }

        // Clean up if it's a link
        if (identifier && /\|/.test(identifier)) {
          identifier = decodeURIComponent(identifier.split('|')[1]).replace('>', '');
        }
      }
    });
    if (appName && identifier) {
      const query = JSON.stringify({ field_name: 'smooch_user_data', json: { app_name: appName, identifier: md5(identifier) } });

      let n = 0;

      const fieldCallback = function(resp) {
        if (!resp && n < 60) {
          n++;
          setTimeout(function() { getField(query, callback, fieldCallback) }, 5000);
        }
        else if (resp) {
          const teamUrl = resp.annotation.team.url;
          const teamSlug = resp.annotation.team.slug;
          const value = { team_slug: teamSlug };
          const value2 = { team_slug: teamSlug, annotation_id: resp.annotation.id, mode: 'bot' };
          const message = { text: t('team_set') + ': ' + teamUrl, response_type: 'in_channel', channel: event.channel };

          const redis = getRedisClient();
          redis.on('connect', function() {
            redis.multi()
            .set('slack_channel_project:' + config.redisPrefix + ':' + event.channel, JSON.stringify(value))
            .set('slack_channel_smooch:' + config.redisPrefix + ':' + event.channel, JSON.stringify(value2))
            .exec(function() {
              console.log('Associated with annotation ' + resp.annotation.dbid);
              // Store SmoochUserSlackChannelUrl in Check as well
              setSmoochUserSlackChannelUrl(event, { teamId: teamConfig.teamId, id: resp.annotation.dbid }, config.checkApi.apiKey, callback, function(resp2) {
                console.log('Added Slack channel URL to Smooch user annotation ' + resp2.smoochBotAddSlackChannelUrl.annotation.dbid);
                const query = qs.stringify(message);
                https.get('https://slack.com/api/chat.postMessage?' + query, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } }, function() {
                  callback(null);
                });
              });
            });
            redis.quit();
          });
        }
        else {
          console.log('Could not get an annotation from Check related to the user');
          callback(null);
        }
      };

      getField(query, callback, fieldCallback);
    }
    else {
      console.log('Could not find application name and identifier');
      callback(null);
    }
  }

  // This message contains a Check URL to be parsed
  if (displayCard(checkURLPattern, event)) {
    const text = event.text || event.attachments[0].pretext;
    while (matches = regexp.exec(text)) {
      const teamSlug = matches[1] || matches[4],
            projectId = matches[2],
            projectMediaId = matches[3] || matches[5];

      getProjectMedia(teamSlug, projectId, projectMediaId, callback, function(data) {
        const message = {
          channel: event.channel,
          attachments: JSON.stringify(formatMessageFromData(data))
        };

        const query = qs.stringify(message);
        const options = {
          hostname: 'slack.com',
          port: 443,
          path: '/api/chat.postMessage',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': query.length,
            'Authorization': 'Bearer ' + ACCESS_TOKEN,
          },
        };
        const request = https.request(options, (res) => {
          console.log('Slack response status code: ' + res.statusCode);
        });
        request.write(query);
        request.end();
      });
    }
  }

  // This message is a Check report parsed by the bot

  if (event.bot_id && event.text === '' && event.attachments && event.attachments.length > 0 && regexp.test(event.attachments[0].fallback)) {
    try {
      storeSlackMessage(event, callback);
    }
    catch (e) {
      // Ignore
    }
  }

  // This message is a reply to a button action

  if (!event.bot_id && event.thread_ts) {

    // Look for this thread on Redis to see if it's related to any Check media

    const redis = getRedisClient();
    redis.get('slack_message_ts:' + config.redisPrefix + ':' + event.thread_ts, function(err, reply) {

      if (!reply) {
        console.log('Could not find Redis key slack_message_ts:' + event.thread_ts);
      }

      else {
        const data = JSON.parse(reply.toString());

        if (data.object_type === 'project_media' && (data.mode === 'comment' || data.mode === 'edit_title' || data.mode === 'edit_description') && data.currentUser === event.user) {

          getCheckSlackUser(event.user,

            function(err) {
              console.log('Error when trying to identify Slack user: ' + util.inspect(err));
              sendErrorMessage(callback, event.thread_ts, event.channel, data.link);
            },

            function(token) {

              // Reset mode optimistically
              
              resetMode(data, token, function() {

                // Adding comment

                if (data.mode === 'comment') {
                  createComment(event, data, token, callback, function(resp) {
                    const message = { text: t('your_note_was_added'), thread_ts: event.thread_ts, replace_original: false, delete_original: false,
                                      response_type: 'ephemeral', channel: event.channel };
                    const query = qs.stringify(message);
                    https.get('https://slack.com/api/chat.postMessage?' + query, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
                  });
                }

                // Changing title or description

                else {
                  const attribute = data.mode.replace(/^edit_/, '');

                  updateTitleOrDescription(attribute, event, data, token, callback, function(resp) {
                    console.log('Analysis updated successfully!');
                  });
                }
              });
            }
          );
        }
      }

      redis.quit();
    });
  }

  callback(null);
};

const sendErrorMessage = function(callback, thread, channel, link) {
  const message = { text: t('Sorry,_seems_that_you_do_not_have_the_permission_to_do_this._Please_go_to_the_app_and_login_by_your_Slack_user,_or_continue_directly_from_there') + ' ' + link, thread_ts: thread, replace_original: false, delete_original: false, response_type: 'ephemeral', channel: channel };
  const query = qs.stringify(message);
  https.get('https://slack.com/api/chat.postMessage?' + query, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
};

const createComment = function(event, data, token, callback, done) {
  const pmid = data.object_id.toString(),
        text = event.text;

  const mutationQuery = `($text: String!, $pmid: String!, $clientMutationId: String!) {
    createComment: createComment(input: { clientMutationId: $clientMutationId, text: $text, annotated_id: $pmid, annotated_type: "ProjectMedia" }) {
      project_media {
        dbid
      }
    }
  }`;

  executeMutation(mutationQuery, { text: text, pmid: pmid, clientMutationId: `fromSlackMessage:${event.thread_ts}` }, sendErrorMessage, done, token, callback, event, data);
}

const storeSlackMessage = function(event, callback) {
  const json = JSON.parse(event.attachments[0].callback_id);

  const vars = {
    set_fields: JSON.stringify({ slack_message_id: event.ts, slack_message_channel: event.channel, slack_message_attachments: JSON.stringify(event.attachments), slack_message_token: ACCESS_TOKEN }),
    annotated_id: `${json.id}`,
    clientMutationId: `fromSlackMessage:${event.ts}`
  };

  const mutationQuery = `($set_fields: String!, $annotated_id: String!, $clientMutationId: String!) {
    createDynamic: createDynamic(input: { clientMutationId: $clientMutationId, set_fields: $set_fields, annotated_id: $annotated_id, annotated_type: "ProjectMedia", annotation_type: "slack_message" }) {
      project_media {
        dbid
      }
    }
  }`;

  const ignore = function() { /* Do nothing */ };

  executeMutation(mutationQuery, vars, ignore, ignore, config.checkApi.apiKey, callback, event, { team_slug: json.team_slug });
}

const updateTitleOrDescription = function(attribute, event, data, token, callback, done) {
  const id = data.last_status_id,
        text = event.text;

  const mutationQuery = `($setFields: String!, $id: ID!, $clientMutationId: String!) {
    updateDynamic: updateDynamic(input: { clientMutationId: $clientMutationId, set_fields: $setFields, id: $id }) {
      project_media {
        id
        dbid
        oembed_metadata
        last_status
        last_status_obj {
          id
        }
        created_at
        updated_at
        author_role
        user {
          name
          profile_image
          source {
            image
          }
        }
        team {
          name
          slug
          get_languages
          verification_statuses
        }
        media {
          url
        }
      }
    }
  }`;

  const fields = {};
  if (attribute === 'description') {
    attribute = 'content';
  }
  fields[attribute] = text;

  const vars = {
    setFields: JSON.stringify(fields),
    id: id,
    clientMutationId: `fromSlackMessage:${event.thread_ts}`
  };

  executeMutation(mutationQuery, vars, sendErrorMessage, done, token, callback, event, data);
}

const setSmoochUserSlackChannelUrl = function(event, data, token, callback, done) {
  const slackChannelUrl = 'https://app.slack.com/client/' + data.teamId + '/' + event.channel;
  const setFields = JSON.stringify({ smooch_user_slack_channel_url: slackChannelUrl });
  const vars = {
    id: data.id,
    setFields: setFields,
    clientMutationId: `fromSlackMessage:${event.ts}`
  };
  const mutationQuery = `($setFields: String!, $id: String!, $clientMutationId: String!) {
    smoochBotAddSlackChannelUrl: smoochBotAddSlackChannelUrl(input: { clientMutationId: $clientMutationId, id: $id, set_fields: $setFields }) {
      annotation { dbid }
    }
  }`;

  executeMutation(mutationQuery, vars, null, done, token, callback, event, data);
};

const resetMode = function(data, token, callback) {
  let attachments = JSON.parse(JSON.stringify(data.slackMessageData.original_message.attachments).replace(/\+/g, ' '));
  attachments[0].actions[1] = {
    name: 'add_comment',
    text: t('add_note', true),
    type: 'button',
    style: 'primary'
  };
  attachments[0].actions[2] = {
    name: 'edit',
    text: t('edit_analysis', true),
    type: 'select',
    options: [
      { text: t('analysis_title'), value: 'title' },
      { text: t('analysis_content'), value: 'description' }
    ],
    style: 'primary'
  };
  saveAndReply(data.slackMessageData, token, callback, 'normal', '', attachments);
};

exports.handler = function(event, context, callback) {
  let data = event;
  if (event.headers && event.body) {
    data = event.body;
  }
  if (event.headers && event.headers['X-Slack-Retry-Num'] && event.headers['X-Slack-Retry-Reason'] === 'http_timeout') {
    console.log('Ignoring duplicated event');
    callback(null);
  }
  else {
    switch (data.type) {
      case 'url_verification':
        verify(data, callback);
        break;
      case 'event_callback':
        const teamConfig = getTeamConfig(data.team_id);
        teamConfig.teamId = data.team_id;
        ACCESS_TOKEN = teamConfig.accessToken;
        process(data.event, callback, teamConfig);
        break;
      default:
        callback(null);
    }
  }
};
