const config = require('./config.js'),
      request = require('request'),
      util = require('util'),
      aws = require('aws-sdk');
let VERIFICATION_TOKEN = null,
    ACCESS_TOKEN = null;

const { executeMutation, verify, getCheckSlackUser, getRedisClient, formatMessageFromData, t, getGraphqlClient, getTeamConfig, saveToRedisAndReplyToSlack } = require('./helpers.js');

const sendErrorMessage = function(callback, thread, channel, link) {
  callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('Sorry,_seems_that_you_do_not_have_the_permission_to_do_this._Please_go_to_the_app_and_login_by_your_Slack_user,_or_continue_directly_from_there') + ': ' + link });
};

const error = function(data, callback) {
  callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('Sorry,_seems_that_you_do_not_have_the_permission_to_do_this._Please_go_to_the_app_and_login_by_your_Slack_user,_or_continue_directly_from_there') + ': ' + data.original_message.attachments[0].title_link });
};

const changeStatus = function(data, token, callback) {
  const value = JSON.parse(data.callback_id);

  const status = data.actions[0].selected_options[0].value;
  const mapping = { check: 'verification_status_status', bridge: 'translation_status_status' };
  let fields = {};
  fields[mapping[config.appName]] = status;
  const setFields = JSON.stringify(fields)

  const vars = {
    id: value.last_status_id,
    setFields: setFields,
    clientMutationId: `fromSlackMessage:${data.message_ts}`
  };

  const mutationQuery = `($setFields: String!, $id: ID!, $clientMutationId: String!) {
    updateDynamic: updateDynamic(input: { clientMutationId: $clientMutationId, id: $id, set_fields: $setFields }) {
      project_media {
        id
        dbid
        oembed_metadata
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
          source {
            image
          }
        }
        team {
          name
          slug
          get_languages
        }
        verification_statuses
        translation_statuses
        target_languages
      }
    }
  }`;

  data.link = data.original_message.attachments[0].title_link;
  data.team_slug = value.team_slug;

  const done = function(resp) {
    const obj = resp.updateDynamic.project_media;
    obj.oembed_metadata = JSON.parse(obj.oembed_metadata);
    const json = { response_type: 'in_channel', replace_original: true, delete_original: false, attachments: formatMessageFromData(obj) };
    callback(null, json);
  };

  executeMutation(mutationQuery, vars, sendErrorMessage, done, token, callback, {}, data);
};

const saveAndReply = function(data, token, callback, mode, newMessage, attachments) {
  const value = JSON.parse(data.callback_id);
  const redisKey = 'slack_message_ts:' + config.redisPrefix + ':' + data.message_ts;
	const storedData = { mode: mode, object_type: 'project_media', object_id: value.id, link: value.link, team_slug: value.team_slug, graphql_id: value.graphql_id, last_status_id: value.last_status_id };
  let message = { text: newMessage + ':', thread_ts: data.message_ts, replace_original: false, delete_original: false, response_type: 'in_channel' };

  const success = function() {
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
  };
  saveToRedisAndReplyToSlack(redisKey, storedData, message, success, callback);
};

const addComment = function(data, token, callback) {
  const newMessage = t('type_your_note_below');

  let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
  attachments[0].actions[1] = {
    name: 'type_comment',
    text: t('type_your_note_in_the_thread_below'),
    type: 'button',
    style: 'default'
  };
  attachments[0].actions[2] = {
    name: 'edit',
    text: t('edit', true),
    type: 'select',
    options: [
      { text: t('title'), value: 'title' },
      { text: t('description'), value: 'description' }
    ],
    style: 'primary'
  };

  saveAndReply(data, token, callback, 'comment', newMessage, attachments);
};

const markTranslationAsError = function(data, token, callback) {
  const newMessage = t('please_provide_a_reason');

  let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
  attachments[0].actions[1] = {
    name: 'add_comment',
    text: t('add_note', true),
    type: 'button',
    style: 'primary'
  };
  attachments[0].actions[2] = {
    name: 'edit',
    text: t('edit', true),
    type: 'select',
    options: [
      { text: t('title'), value: 'title' },
      { text: t('description'), value: 'description' }
    ],
    style: 'primary'
  };

  saveAndReply(data, token, callback, 'translation_error', newMessage, attachments);
};

const addTranslation = function(data, token, callback, language) {
  const newMessage = t('type_your_translation_below') + ' (' + language.value + ')';

  let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
  attachments[0].actions[1] = {
    name: 'add_comment',
    text: t('add_note', true),
    type: 'button',
    style: 'primary'
  };
  attachments[0].actions[2] = {
    name: 'edit',
    text: t('edit', true),
    type: 'select',
    options: [
      { text: t('title'), value: 'title' },
      { text: t('description'), value: 'description' }
    ],
    style: 'primary'
  };

  saveAndReply(data, token, callback, 'add_translation_' + language.value, newMessage, attachments);
};

const editTitle = function(data, token, callback) {
  const newMessage = t('type_the_title_below');

  let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
  attachments[0].actions[1] = {
    name: 'add_comment',
    text: t('add_note', true),
    type: 'button',
    style: 'primary'
  };
  attachments[0].actions[2] = {
    name: 'edit',
    text: t('edit', true),
    type: 'select',
    options: [
      { text: t('type_title_below'), value: 'type_title' },
      { text: t('description'), value: 'description' }
    ],
    selected_options: [
      { text: t('type_title_below'), value: 'type_title' },
    ],
    style: 'primary'
  };

  saveAndReply(data, token, callback, 'edit_title', newMessage, attachments);
};

const editDescription = function(data, token, callback) {
  const newMessage = t('type_the_description_below');

  let attachments = JSON.parse(JSON.stringify(data.original_message.attachments).replace(/\+/g, ' '));
  attachments[0].actions[1] = {
    name: 'add_comment',
    text: t('add_note', true),
    type: 'button',
    style: 'primary'
  };
  attachments[0].actions[2] = {
    name: 'edit',
    text: t('edit', true),
    type: 'select',
    options: [
      { text: t('title'), value: 'title' },
      { text: t('type_description_below'), value: 'type_description' }
    ],
    selected_options: [
      { text: t('type_description_below'), value: 'type_description' },
    ],
    style: 'primary'
  };

  saveAndReply(data, token, callback, 'edit_description', newMessage, attachments);
};

const imageSearch = function(data, callback, context) {
  const image = data.original_message.attachments[0].image_url;

  if (image) {

    // Invoke Lambda function to get reverse images in background, because Slack doesn't wait more than 3s

    aws.config.loadFromPath('./aws.json');

    try {
      const lambda = new aws.Lambda({
        region: config.awsRegion
      });

      const payload = JSON.stringify({ image_url: image, response_url: data.response_url, thread_ts: data.message_ts, channel: data.channel, access_token: ACCESS_TOKEN });
      const functionName = config.googleImageSearchFunctionName || 'google-image-search';

      const lambdaRequest = lambda.invoke({ FunctionName: functionName, InvocationType: 'Event', Payload: payload });
      lambdaRequest.send();
    } catch (e) {}

    callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_wait_while_I_look_for_similar_images_-_I_will_post_a_reply_inside_a_thread_above') });
  }
  else {
    callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('there_are_no_images_on_this_report') });
  }
};

const process = function(data, callback, context) {
  if (data.token === VERIFICATION_TOKEN) {

    getCheckSlackUser(data.user.id,
      function(err) {
        console.log('Error when trying to identify Slack user: ' + util.inspect(err));
        error(data, callback);
      },

      function(token) {
        console.log('Successfully identified as Slack user with token: ' + token);

        switch (data.actions[0].name) {
          case 'change_status':
            const status = data.actions[0].selected_options[0].value;
            if (config.appName === 'bridge' && status === 'error') {
              markTranslationAsError(data, token, callback);
            }
            else {
              changeStatus(data, token, callback);
            }
            break;
          case 'add_comment':
            addComment(data, token, callback);
            break;
          case 'add_translation':
            const language = data.actions[0].selected_options[0];
            addTranslation(data, token, callback, language);
            break;
          case 'type_comment':
            callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_type_your_note_inside_the_thread_above') });
            break;
          case 'edit':
            const attribute = data.actions[0].selected_options[0].value;
            switch (attribute) {
              case 'title':
                editTitle(data, token, callback);
                break;
              case 'description':
                editDescription(data, token, callback);
                break;
              case 'type_title':
                callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_type_the_new_title_inside_the_thread_above') });
                break;
              case 'type_description':
                callback(null, { response_type: 'ephemeral', replace_original: false, delete_original: false, text: t('please_type_the_new_description_inside_the_thread_above') });
                break;
            }
            break;
          case 'image_search':
            imageSearch(data, callback, context);
            break;
          default:
            console.log('Unknown action: ' + data.actions[0].name);
            error(data, callback);
        }
      }
    );

  }

  else {
    error(data, callback);
  }
};

exports.handler = function(data, context, callback) {
  const body = Buffer.from(data.body, 'base64').toString();
  const payload = JSON.parse(decodeURIComponent(body).replace(/^payload=/, ''));

  switch (data.type) {
    case 'url_verification':
      verify(data, callback);
      break;
    default:
      const teamConfig = getTeamConfig(payload.team.id);
      ACCESS_TOKEN = teamConfig.accessToken;
      VERIFICATION_TOKEN = teamConfig.verificationToken;
      process(payload, callback, context);
  }
};
