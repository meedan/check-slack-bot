const config = require('./config.js'),
      https = require('https'),
      request = require('request'),
      qs = require('querystring'),
      util = require('util');
let ACCESS_TOKEN = null;
      
const { executeMutation, verify, getCheckSlackUser, getRedisClient, formatMessageFromData, t, getGraphqlClient, getTeamConfig, projectMediaCreatedMessage } = require('./helpers.js');

const getProjectMedia = function(teamSlug, projectId, projectMediaId, callback, done) {
  const client = getGraphqlClient(teamSlug, config.checkApi.apiKey, callback);

  const projectMediaQuery = `
  query project_media($ids: String!) {
    project_media(ids: $ids) {
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
        get_languages
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
        source {
          image
        }
      }
      team {
        name
        slug
      }
      verification_statuses
      translation_statuses
      target_languages
    }
  }
  `;

  client.query(projectMediaQuery, { ids: projectMediaId + ',' + projectId })
  .then((resp, errors) => {
    console.log('GraphQL query response: ' + util.inspect(resp));
    const pm = resp.project_media;
    pm.metadata = JSON.parse(pm.metadata);
    done(pm);
  })
  .catch(function(e) {
    console.log('GraphQL query exception: ' + e.toString());
  });
};

const displayCard = function(checkURLPattern, bot_id, text) {
  if (!text) { return false }
  const botCreatedPMRegexp = new RegExp(projectMediaCreatedMessage());
  const urlFromBotRegexp = new RegExp('\<' + checkURLPattern + '(?!\|)\>');
  switch(bot_id) {
    case undefined:
      return true;
    case config.bot_id:
      return botCreatedPMRegexp.test(text)
    default:
      return urlFromBotRegexp.test(text)
  }
};

const process = function(event, callback) {
  const mainRegexp = new RegExp(config.checkWeb.url, 'g');
  const checkURLPattern = config.checkWeb.url + '/([^/]+)/project/([0-9]+)/media/([0-9]+)';
  const regexp = new RegExp(checkURLPattern, 'g');

  // This message contains a Check URL to be parsed
  if (displayCard(checkURLPattern, event.bot_id, event.text)) {
    while (matches = regexp.exec(event.text)) {
      const teamSlug = matches[1],
            projectId = matches[2],
            projectMediaId = matches[3];

      getProjectMedia(teamSlug, projectId, projectMediaId, callback, function(data) {
        const message = {
          token: ACCESS_TOKEN,
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
            'Content-Length': query.length
          }
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

        // Adding comment or changing title or changing description or adding translation or marking a translation as error

        if (data.object_type === 'project_media' && (data.mode === 'comment' || data.mode === 'edit_title' || data.mode === 'edit_description' || /^add_translation_/.test(data.mode) || data.mode === 'translation_error')) {

          getCheckSlackUser(event.user,
            
            function(err) {
              console.log('Error when trying to identify Slack user: ' + util.inspect(err));
              sendErrorMessage(callback, event.thread_ts, event.channel, data.link);
            },
            
            function(token) {

              // Adding comment

              if (data.mode === 'comment') {
                createComment(event, data, token, callback, function(resp) {
                  const message = { text: t('your_comment_was_added') + ': ' + data.link, thread_ts: event.thread_ts, replace_original: false, delete_original: false,
                                    response_type: 'ephemeral', token: ACCESS_TOKEN, channel: event.channel };
                  const query = qs.stringify(message);
                  https.get('https://slack.com/api/chat.postMessage?' + query);
                });
              }

              // Adding translation

              else if (/^add_translation_/.test(data.mode)) {
                addTranslation(event, data, token, callback, function(resp) {
                  const message = { text: t('your_translation_was_added') + ': ' + data.link, thread_ts: event.thread_ts, replace_original: false, delete_original: false,
                                    response_type: 'ephemeral', token: ACCESS_TOKEN, channel: event.channel };
                  const query = qs.stringify(message);
                  https.get('https://slack.com/api/chat.postMessage?' + query);
                });
              }

              // Marking translation as error

              else if (data.mode === 'translation_error') {
                markTranslationAsError(event, data, token, callback, function(resp) {
                  const obj = resp.updateDynamic.project_media;
                  obj.metadata = JSON.parse(obj.metadata);
                  
                  let message = { ts: event.thread_ts, channel: event.channel, attachments: formatMessageFromData(obj) };
                  const headers = { 'Authorization': 'Bearer ' + ACCESS_TOKEN, 'Content-type': 'application/json' }; 

                  request.post({ url: 'https://slack.com/api/chat.update', json: true, body: message, headers: headers }, function(err, res, resjson) {
                    console.log('Response from Slack message update: ' + res);
                  });

                  message = { text: t('translation_marked_as_error'), thread_ts: event.thread_ts, replace_original: false, delete_original: false,
                              response_type: 'ephemeral', token: ACCESS_TOKEN, channel: event.channel };
                  query = qs.stringify(message);
                  https.get('https://slack.com/api/chat.postMessage?' + query);
                });
              }

              // Changing title or description

              else {
                const attribute = data.mode.replace(/^edit_/, '');

                updateTitleOrDescription(attribute, event, data, token, callback, function(resp) {
                  const obj = resp.updateProjectMedia.project_media;
                  obj.metadata = JSON.parse(obj.metadata);
                  
                  let message = { ts: event.thread_ts, channel: event.channel, attachments: formatMessageFromData(obj) };
                  const headers = { 'Authorization': 'Bearer ' + ACCESS_TOKEN, 'Content-type': 'application/json' }; 

                  request.post({ url: 'https://slack.com/api/chat.update', json: true, body: message, headers: headers }, function(err, res, resjson) {
                    console.log('Response from Slack message update: ' + res);
                  });

                  message = { text: t(attribute + '_was_changed_to') + ': ' + obj.metadata[attribute], thread_ts: event.thread_ts, replace_original: false, delete_original: false,
                              response_type: 'ephemeral', token: ACCESS_TOKEN, channel: event.channel };
                  query = qs.stringify(message);
                  https.get('https://slack.com/api/chat.postMessage?' + query);
                });
              }
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
  const message = { text: t('Sorry,_seems_that_you_do_not_have_the_permission_to_do_this._Please_go_to_the_app_and_login_by_your_Slack_user,_or_continue_directly_from_there') + ' ' + link, thread_ts: thread, replace_original: false, delete_original: false,
                    response_type: 'ephemeral', token: ACCESS_TOKEN, channel: channel };
  const query = qs.stringify(message);
  https.get('https://slack.com/api/chat.postMessage?' + query);
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

const addTranslation = function(event, data, token, callback, done) {
  const pmid = data.object_id.toString(),
        text = event.text;

  const setFields = JSON.stringify({
    translation_text: text,
    translation_language: data.mode.replace(/^add_translation_/, ''),
    translation_note: '', // FIXME: Support translation note
  });

  const mutationQuery = `($setFields: String!, $pmid: String!, $clientMutationId: String!) {
    createDynamic: createDynamic(input: { clientMutationId: $clientMutationId, set_fields: $setFields, annotated_id: $pmid, annotated_type: "ProjectMedia", annotation_type: "translation" }) {
      project_media {
        dbid
      }
    }
  }`;
  
  executeMutation(mutationQuery, { setFields: setFields, pmid: pmid, clientMutationId: `fromSlackMessage:${event.thread_ts}` }, sendErrorMessage, done, token, callback, event, data);
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
  const id = data.graphql_id,
        text = event.text;
  
  const mutationQuery = `($embed: String!, $id: ID!, $clientMutationId: String!) {
    updateProjectMedia: updateProjectMedia(input: { clientMutationId: $clientMutationId, embed: $embed, id: $id }) {
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
          get_languages
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
          source {
            image
          }
        }
        team {
          name
          slug
        }
        verification_statuses
        translation_statuses
        target_languages
      }
    }
  }`;

  let embed = {};
  embed[attribute] = text;
  
  const vars = {
    embed: JSON.stringify(embed),
    id: id,
    clientMutationId: `fromSlackMessage:${event.thread_ts}`
  };

  executeMutation(mutationQuery, vars, sendErrorMessage, done, token, callback, event, data);
}

const markTranslationAsError = function(event, data, token, callback, done) {
  const setFields = JSON.stringify({ translation_status_status: 'error', translation_status_note: event.text });
  
  const vars = {
    id: data.last_status_id,
    setFields: setFields,
    clientMutationId: `fromSlackMessage:${event.thread_ts}`
  };

  console.log('ID is ' + vars.id);

  const mutationQuery = `($setFields: String!, $id: ID!, $clientMutationId: String!) {
    updateDynamic: updateDynamic(input: { clientMutationId: $clientMutationId, id: $id, set_fields: $setFields }) {
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
          get_languages
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
          source {
            image
          }
        }
        team {
          name
          slug
        }
        verification_statuses
        translation_statuses
        target_languages
      }
    }
  }`;

  executeMutation(mutationQuery, vars, sendErrorMessage, done, token, callback, event, data);
};

exports.handler = function(data, context, callback) {
  switch (data.type) {
    case 'url_verification':
      verify(data, callback);
      break;
    case 'event_callback':
      const teamConfig = getTeamConfig(data.team_id);
      ACCESS_TOKEN = teamConfig.accessToken;
      process(data.event, callback);
      break;
    default:
      callback(null);
  }
};
