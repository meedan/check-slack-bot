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
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Generate a Slack message JSON from a Check media object
// ATTENTION: If you change this structure here, please make sure that Check API is updated too, since Check API updates Slack messages

const formatMessageFromData = function(data) {

  // Build a list of tags

  let tags = [];
  data.tags.edges.forEach(function(tag) {
    tags.push(tag.node.tag);
  });

  // Build a list of verification statuses (core or custom) to be selected
  // Get the current status (label and color)

  let statusColor = '#cccccc';
  let statusLabel = data.last_status;
  const statuses = data.verification_statuses;
  let options = [];
  statuses.statuses.forEach(function(st) {
    if (st.id === data.last_status) {
      statusColor = st.style.color;
      statusLabel = st.label;
    }
    options.push({ text: t(st.label.toLowerCase().replace(/ /g, '_'), true), value: st.id });
  });

  // Formats the fields to be displayed on the Slack card

  let fields = [
    {
      title: t('notes'),
      value: data.log_count,
      short: true
    },
    {
      title: t('added_to_check', true),
      value: '<!date^' + data.created_at + '^{date} {time}|' + data.created_at + '>',
      short: true
    },
    {
      title: t('last_update', true),
      value: '<!date^' + data.updated_at + '^{date} {time}|' + data.updated_at + '>',
      short: true
    },
    {
      title: t('project'),
      value: data.project.title,
      short: true
    }
  ];

  if (parseInt(data.tasks_count.all) > 0) {
    fields.push(
      {
        title: t('tasks_completed', true),
        value: data.tasks_count.completed + '/' + data.tasks_count.all,
        short: true
      }
    );
  }

  if (tags.length > 0) {
    fields.push(
      {
        title: t('tags'),
        value: tags.join(', '),
        short: true
      }
    );
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
      text: t('add_comment', true),
      type: 'button',
      style: 'primary'
    },
    {
      name: 'edit',
      text: t('edit', true),
      type: 'select',
      style: 'primary',
      options: [
        { text: t('title'), value: 'title' },
        { text: t('description'), value: 'description' }
      ]
    }
  ];

  if (data.metadata.picture && /^http/.test(data.metadata.picture)) {
    actions.push({
      name: 'image_search',
      text: t('image_search', true),
      type: 'button',
      style: 'primary'
    });
  }

  let author_icon = data.user.profile_image;
  if (data.user.source && data.user.source.image) {
    author_icon = data.user.source.image;
  }

  let title = data.metadata.title;
  if (title.length > 140) {
    title = title.substring(0, 137) + '...';
  }

  let description = data.metadata.description;
  if (description.length > 500) {
    description = description.substring(0, 497) + '...';
  }

  return [
    {
      title: t(statusLabel.toLowerCase().replace(/ /g, '_')).toUpperCase() + ': ' + title,
      title_link: data.metadata.permalink,
      text: description,
      color: statusColor,
      fields: fields,
      author_name: data.user.name + ' | ' + t(data.author_role, true) + ' ' + t('at').toLowerCase() + ' ' + data.team.name,
      author_icon: author_icon,
      image_url: data.metadata.picture,
      mrkdwn_in: ['title', 'text', 'fields'],
      fallback: data.metadata.permalink,
      callback_id: JSON.stringify({ last_status_id: data.last_status_obj.id, team_slug: data.team.slug, id: data.dbid, graphql_id: data.id, link: data.metadata.permalink }),
      response_type: 'in_channel',
      replace_original: false,
      delete_original: false,
      actions: actions 
    }
  ];
};

const getRedisClient = function() {
  const client = redis.createClient({ host: config.redisHost });

  client.on('error', function(err) {
    console.log('Error when connecting to Redis: ' + err);
  });

  return client;
};

const getGraphqlClient = function(team, token, callback) {
  const handleErrors = function(errors, resp) {
    console.log('Error on GraphQL call: ' + util.inspect(errors));
  };
  
  const headers = {
    'X-Check-Token': token
  };

  if (config.checkApi.httpAuth) {
    const credentials = config.checkApi.httpAuth.split(':');
    const basic = header(credentials[0], credentials[1]);
    headers['Authorization'] = basic;
  }

  const transport = new Transport(config.checkApi.url + '/api/graphql?team=' + team, { handleErrors, headers, credentials: false, timeout: 120000 });
  const client = new Lokka({ transport });

  return client;
};

const getCheckSlackUser = function(uid, fail, done) {
  const url = config.checkApi.url + '/api/admin/user/slack?uid=' + uid;

  request.get({ url: url, json: true, headers: { 'X-Check-Token': config.checkApi.apiKey } }, function(err, res, json) {
    console.log('Code: ' + res.statusCode + ' JSON: ' + JSON.stringify(json));
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
    if (!err && resp) {
      done(resp);
    }
    else {
      console.log('Error when executing mutation: ' + util.inspect(err));
      fail(callback, thread, channel, data.link);
    }
  })
  .catch(function(e) {
    console.log('Error when executing mutation: ' + util.inspect(e));
    fail(callback, thread, channel, data.link);
  });
};

const getTeamConfig = function(slackTeamId) {
  return config.slack[slackTeamId] || {};
};

module.exports = {
  t,
  formatMessageFromData,
  getRedisClient,
  getGraphqlClient,
  getCheckSlackUser,
  verify,
  executeMutation,
  getTeamConfig
};
