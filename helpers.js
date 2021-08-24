const config = require('./config.js'),
      Lokka = require('lokka').Lokka,
      Transport = require('lokka-transport-http').Transport,
      header = require('basic-auth-header'),
      request = require('request'),
      util = require('util'),
      redis = require('redis');

// This should be converted to a localization function later on... currently only turns identifiers into readable strings

const t = function(str, capitalizeAll) {
  if (capitalizeAll) {
    return str.replace(/_/g, ' ').replace(/\w\S*/g, function(txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
  }
  str = str.replace(/_/g, ' ');
  str = str.replace('description', 'content');
  str = str.replace('Description', 'Content');
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Generate a Slack message JSON from a Check media object
// ATTENTION: If you change this structure here, please make sure that Check API is updated too, since Check API updates Slack messages

const formatMessageFromData = function(data) {

  // Build a list of verification statuses (core or custom) to be selected
  // Get the current status (label and color)

  let statusColor = '#cccccc';
  let statusLabel = data.last_status;
  let options = [];
  data.team.verification_statuses.statuses.forEach(function(st) {
    if (st.id === data.last_status) {
      statusColor = st.style.color;
      statusLabel = st.label;
    }
    options.push({ text: t(st.label.toLowerCase().replace(/ /g, '_'), true), value: st.id });
  });

  // Formats the fields to be displayed on the Slack card

  let fields = [
    {
      title: t('added_to_' + config.appName, true),
      value: '<!date^' + data.created_at + '^{date} {time}|' + data.created_at + '>',
      short: true
    },
    {
      title: t('last_update', true),
      value: '<!date^' + data.updated_at + '^{date} {time}|' + data.updated_at + '>',
      short: true
    }
  ];
  if (data.media && data.media.url) {
    fields.push({
      title: t('media_URL'),
      value: data.media.url,
      short: false
    });
  }

  let actions = [
    {
      name: 'change_status',
      text: t('change_status', true),
      type: 'select',
      style: 'primary',
      options: options
    },
    {
      name: 'add_comment',
      text: t('add_note', true),
      type: 'button',
      style: 'primary'
    },
    {
      name: 'edit',
      text: t('edit_analysis', true),
      type: 'select',
      style: 'primary',
      options: [
        { text: t('analysis_title'), value: 'title' },
        { text: t('analysis_content'), value: 'description' }
      ]
    }
  ];

  if (data.oembed_metadata.picture && /^http/.test(data.oembed_metadata.picture)) {
    actions.push({
      name: 'image_search',
      text: t('image_search', true),
      type: 'button',
      style: 'primary'
    });
  }

  let author_icon = '';
  if (data.user) {
    author_icon = data.user.profile_image;
    if (data.user.source && data.user.source.image) {
      author_icon = data.user.source.image;
    }
  }

  let title = data.oembed_metadata.title;
  if (title.length > 140) {
    title = title.substring(0, 137) + '...';
  }

  let description = data.oembed_metadata.description;
  if (description.length > 500) {
    description = description.substring(0, 497) + '...';
  }

  return [
    {
      title: t(statusLabel.toLowerCase().replace(/ /g, '_')).toUpperCase() + ': ' + title,
      title_link: data.oembed_metadata.permalink,
      text: description,
      color: statusColor,
      fields: fields,
      author_name: data.user ? (data.user.name + ' | ' + t(data.author_role, true) + ' ' + t('at').toLowerCase() + ' ' + data.team.name) : data.team.name,
      author_icon: author_icon,
      image_url: data.oembed_metadata.picture,
      mrkdwn_in: ['title', 'text', 'fields'],
      fallback: data.oembed_metadata.permalink,
      callback_id: JSON.stringify({ last_status_id: data.last_status_obj.id, team_slug: data.team.slug, id: data.dbid, graphql_id: data.id, link: data.oembed_metadata.permalink }),
      response_type: 'in_channel',
      replace_original: false,
      delete_original: false,
      actions: actions
    }
  ];
};

const getRedisClient = function() {
  const client = redis.createClient({ host: config.redisHost });
  return client;
};

const getGraphqlClient = function(team, token, callback) {
  const headers = {
    'X-Check-Token': token
  };

  if (config.checkApi.httpAuth) {
    const credentials = config.checkApi.httpAuth.split(':');
    const basic = header(credentials[0], credentials[1]);
    headers['Authorization'] = basic;
  }

  let path = '/api/graphql';
  if (team) {
    path += '?team=' + team;
  }
  const transport = new Transport(config.checkApi.url + path, { headers, credentials: false, timeout: 120000 });
  const client = new Lokka({ transport });

  return client;
};

const getCheckSlackUser = function(uid, fail, done) {
  const url = config.checkApi.url + '/api/admin/user/slack?uid=' + uid;

  request.get({ url: url, json: true, headers: { 'X-Check-Token': config.checkApi.apiKey } }, function(err, res, json) {
    if (!err && res.statusCode === 200 && json && json.data && json.data.token) {
      done(json.data.token);
    }
    else {
      fail(err);
    }
  });
};

const verify = function(data, callback) {
  const tokens = [];
  for (let team in config.slack) {
    tokens.push(config.slack[team].verificationToken);
  }

  if (tokens.indexOf(data.token) > -1) {
    callback(null, data.challenge);
  }
  else {
    callback(t('verification_failed'));
  }
};

const executeMutation = function(mutationQuery, vars, fail, done, token, callback, event, data) {
  const thread = event.thread_ts,
        channel = event.channel,
        team = data.team_slug;

  const client = getGraphqlClient(team, token, callback);

  client.mutate(mutationQuery, vars)
  .then(function(resp, err) {
    done(resp);
  })
  .catch(function(e) {
    console.log('Error when executing mutation: ' + util.inspect(e));
    if (fail) {
      fail(callback, thread, channel, data.link, e);
    }
  });
};

const getTeamConfig = function(slackTeamId) {
  return config.slack[slackTeamId] || {};
};

const saveAndReply = function(data, token, callback, mode, newMessage, attachments) {
  const value = JSON.parse(data.callback_id);
  const redisKey = 'slack_message_ts:' + config.redisPrefix + ':' + data.message_ts;
	const storedData = { mode: mode, object_type: 'project_media', object_id: value.id, link: value.link, team_slug: value.team_slug, graphql_id: value.graphql_id, last_status_id: value.last_status_id, currentUser: data.user.id, slackMessageData: data };
  let message = { text: newMessage + ':', thread_ts: data.message_ts, replace_original: false, delete_original: false, response_type: 'in_channel' };

  const success = function() {
    json = { response_type: 'in_channel', replace_original: true, delete_original: false, attachments: attachments, token: token };

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

const saveToRedisAndReplyToSlack = function(redisKey, value, message, done, callback) {
  const redis = getRedisClient();
  redis.on('connect', function() {
    redis.set(redisKey, JSON.stringify(value), function(resp) {
      console.log('Saved on Redis key (' + redisKey + ') :' + util.inspect(value));
      callback(null, message);
      done();
      redis.quit();
    });
  });
};

const projectMediaCreatedMessage = function() {
  return 'URL successfully added to ' + humanAppName() + ': ';
};

const humanAppName = function() {
  return config.appName.charAt(0).toUpperCase() + config.appName.slice(1);
};

const getIdentifier = function(text) {
  let identifier = null;
  // The identifier is different depending on the platform
  if (/WhatsApp Messenger/.test(text)) {
    identifier = text.match(/Phone Number:\s(.*)/)[1];
  }
  else if (/Facebook Messenger/.test(text)) {
    identifier = text.match(/psid=([0-9]+)/)[1];
  }
  else if (/Twitter DM/.test(text)) {
    identifier = text.match(/profile_images\/([0-9]+)\//)[1];
  }
  else if (/Telegram Messenger/.test(text)) {
    // For Telegram, there is no unique piece of information we can use to identify which user this Slack channel belongs to
    identifier = null;
  }
  else if (/Viber Messenger/.test(text)) {
    identifier = text.match(/dlid=([^&]+)/)[1].substring(0, 27);
  }
  else if (/LINE Messenger/.test(text)) {
    identifier = text.match(/sprofile\.line-scdn\.net\/([^|]+)/)[1];
  }

  // Clean up if it's a link
  if (identifier && /\|/.test(identifier)) {
    const unlinked = identifier.replace(/<[^|]+\|/, '').replace('>', '').replace(/\s+/, ' ');
    identifier = decodeURIComponent(unlinked);
  }

  return identifier;
};

module.exports = {
  t,
  formatMessageFromData,
  getRedisClient,
  getGraphqlClient,
  getCheckSlackUser,
  verify,
  executeMutation,
  getTeamConfig,
  saveAndReply,
  saveToRedisAndReplyToSlack,
  projectMediaCreatedMessage,
  humanAppName,
  getIdentifier,
};
